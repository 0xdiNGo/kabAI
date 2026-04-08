from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import router as v1_router
from app.config import settings
from app.core.database import db
from app.core.exceptions import KabAIError
from app.core.qdrant import qdrant_conn
from app.core.redis import redis_client
from app.repositories.exemplar_repo import ExemplarRepository
from app.repositories.ingest_queue_repo import IngestQueueRepository
from app.repositories.knowledge_repo import KnowledgeRepository
from app.repositories.usage_repo import UsageRepository
from app.services.background_manager import BackgroundTaskManager
from app.services.ingest_manager import IngestManager
from app.services.ingest_worker import IngestWorker


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db.connect(settings.mongodb_url, settings.mongodb_db_name)
    await redis_client.connect(settings.redis_url)
    await qdrant_conn.connect(settings.qdrant_url)
    app.state.background_manager = BackgroundTaskManager()
    app.state.ingest_manager = IngestManager()
    # Ensure indexes
    knowledge_repo = KnowledgeRepository(db.db)
    await knowledge_repo.ensure_indexes()
    exemplar_repo = ExemplarRepository(db.db)
    await exemplar_repo.ensure_indexes()
    # Agent indexes
    agents_coll = db.db["agents"]
    await agents_coll.create_index("tags")
    await agents_coll.create_index([("created_at", -1)])
    queue_repo = IngestQueueRepository(db.db)
    await queue_repo.ensure_indexes()
    usage_repo = UsageRepository(db.db)
    await usage_repo.ensure_indexes()
    app.state.usage_repo = usage_repo

    # Start ingest worker
    from app.repositories.provider_repo import ProviderRepository
    from app.repositories.settings_repo import SettingsRepository
    from app.services.llm_service import LLMService
    from app.services.provider_service import ProviderService
    from app.services.vector_service import VectorService

    provider_repo = ProviderRepository(db.db)
    settings_repo_inst = SettingsRepository(db.db)
    provider_service = ProviderService(provider_repo, redis_client.client)
    llm_service = LLMService(provider_service, settings_repo_inst)
    llm_service.usage_repo = usage_repo

    vector_service = VectorService(qdrant_conn.client, llm_service, settings_repo_inst)
    app.state.vector_service = vector_service

    worker = IngestWorker(queue_repo, knowledge_repo, llm_service, vector_service)
    app.state.ingest_worker = worker
    app.state.ingest_queue_repo = queue_repo
    await worker.start()
    yield
    # Shutdown
    await app.state.ingest_worker.stop()
    await app.state.ingest_manager.shutdown()
    await app.state.background_manager.shutdown()
    await qdrant_conn.disconnect()
    await redis_client.disconnect()
    await db.disconnect()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(v1_router)


# Global exception handler
@app.exception_handler(KabAIError)
async def kabai_error_handler(request: Request, exc: KabAIError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


# Health check
@app.get("/health")
async def health():
    return {"status": "ok"}
