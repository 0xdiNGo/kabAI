from fastapi import APIRouter

from app.api.v1 import agents, auth, conversations, knowledge, providers, settings

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(providers.router)
router.include_router(agents.router)
router.include_router(conversations.router)
router.include_router(settings.router)
router.include_router(knowledge.router)
