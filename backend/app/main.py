from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import router as v1_router
from app.config import settings
from app.core.database import db
from app.core.exceptions import TigerTeamError
from app.core.redis import redis_client
from app.services.background_manager import BackgroundTaskManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db.connect(settings.mongodb_url, settings.mongodb_db_name)
    await redis_client.connect(settings.redis_url)
    app.state.background_manager = BackgroundTaskManager()
    yield
    # Shutdown
    await app.state.background_manager.shutdown()
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
@app.exception_handler(TigerTeamError)
async def tiger_team_error_handler(request: Request, exc: TigerTeamError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


# Health check
@app.get("/health")
async def health():
    return {"status": "ok"}
