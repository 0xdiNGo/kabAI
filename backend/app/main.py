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
from app.repositories.agent_repo import AgentRepository
from app.repositories.connector_repo import ConnectorRepository
from app.repositories.conversation_repo import ConversationRepository
from app.repositories.exemplar_repo import ExemplarRepository
from app.repositories.ingest_queue_repo import IngestQueueRepository
from app.repositories.knowledge_repo import KnowledgeRepository
from app.repositories.prompt_guard_repo import PromptGuardRepository
from app.repositories.usage_repo import UsageRepository
from app.services.background_manager import BackgroundTaskManager
from app.services.connector_manager import ConnectorManager
from app.services.connectors.event_bus import ConnectorEventBus
from app.services.ingest_manager import IngestManager
from app.services.ingest_worker import IngestWorker
from app.services.prompt_guard_service import PromptGuardService


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
    prompt_guard_repo = PromptGuardRepository(db.db)
    await prompt_guard_repo.ensure_indexes()

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

    # Run initial model router evaluation
    from app.services.model_router import ModelRouter
    model_router = ModelRouter(provider_service, settings_repo_inst, usage_repo)
    try:
        await model_router.save_recommendations()
    except Exception:
        pass  # Non-critical — may fail if no providers configured yet

    worker = IngestWorker(queue_repo, knowledge_repo, llm_service, vector_service)
    app.state.ingest_worker = worker
    app.state.ingest_queue_repo = queue_repo
    await worker.start()

    # Connector manager — manages long-lived IRC/Discord/Telegram connections
    from app.repositories.search_provider_repo import SearchProviderRepository
    from app.services.conversation_service import ConversationService
    from app.services.exemplar_service import ExemplarService
    from app.services.knowledge_service import KnowledgeService
    from app.services.search_service import SearchService

    agent_repo = AgentRepository(db.db)
    conversation_repo = ConversationRepository(db.db)
    # Ensure connector indexes
    connector_repo = ConnectorRepository(db.db)
    await connector_repo.ensure_indexes()
    await conversation_repo.collection.create_index(
        [("connector_id", 1), ("external_id", 1)],
    )

    # Build a ConversationService for connectors to use
    search_provider_repo = SearchProviderRepository(db.db)
    search_service = SearchService(search_provider_repo)
    knowledge_service = KnowledgeService(
        knowledge_repo, llm_service, queue_repo, vector_service, search_service,
    )
    exemplar_service = ExemplarService(ExemplarRepository(db.db))
    connector_prompt_guard = PromptGuardService(
        settings_repo_inst, log_repo=prompt_guard_repo, llm_service=llm_service,
    )
    connector_conversation_service = ConversationService(
        conversation_repo, agent_repo, llm_service,
        knowledge_service, exemplar_service, search_service,
        prompt_guard=connector_prompt_guard,
    )

    event_bus = ConnectorEventBus()
    app.state.connector_event_bus = event_bus
    connector_manager = ConnectorManager(
        connector_repo, connector_conversation_service, event_bus,
    )
    app.state.connector_manager = connector_manager
    await connector_manager.start_auto_start_connectors()

    yield
    # Shutdown
    await app.state.connector_manager.shutdown()
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
