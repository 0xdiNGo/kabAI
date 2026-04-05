from fastapi import APIRouter

from app.api.v1 import agents, auth, conversations, exemplars, huggingface, knowledge, providers, search, settings

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(providers.router)
router.include_router(agents.router)
router.include_router(conversations.router)
router.include_router(settings.router)
router.include_router(knowledge.router)
router.include_router(exemplars.router)
router.include_router(search.router)
router.include_router(huggingface.router)
