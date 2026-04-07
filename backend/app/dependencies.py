from fastapi import Depends, Header

from app.core.database import db
from app.core.exceptions import AuthenticationError, AuthorizationError
from app.core.redis import redis_client
from app.core.security import decode_token
from app.repositories.agent_repo import AgentRepository
from app.repositories.conversation_repo import ConversationRepository
from app.repositories.exemplar_repo import ExemplarRepository
from app.repositories.ingest_queue_repo import IngestQueueRepository
from app.repositories.knowledge_repo import KnowledgeRepository
from app.repositories.search_provider_repo import SearchProviderRepository
from app.repositories.provider_repo import ProviderRepository
from app.repositories.settings_repo import SettingsRepository
from app.repositories.user_repo import UserRepository
from app.services.auth_service import AuthService
from app.services.conversation_service import ConversationService
from app.services.exemplar_service import ExemplarService
from app.services.huggingface_service import HuggingFaceService
from app.services.vector_service import VectorService
from app.services.search_service import SearchService
from app.services.knowledge_service import KnowledgeService
from app.services.llm_service import LLMService
from app.services.orchestration.roundtable_service import RoundtableService
from app.services.provider_service import ProviderService


def get_db():
    return db.db


def get_redis():
    return redis_client.client


# Repositories
def get_user_repo(database=Depends(get_db)):
    return UserRepository(database)


def get_provider_repo(database=Depends(get_db)):
    return ProviderRepository(database)


def get_agent_repo(database=Depends(get_db)):
    return AgentRepository(database)


def get_conversation_repo(database=Depends(get_db)):
    return ConversationRepository(database)


def get_settings_repo(database=Depends(get_db)):
    return SettingsRepository(database)


def get_knowledge_repo(database=Depends(get_db)):
    return KnowledgeRepository(database)


def get_exemplar_repo(database=Depends(get_db)):
    return ExemplarRepository(database)


def get_ingest_queue_repo(database=Depends(get_db)):
    return IngestQueueRepository(database)


def get_search_provider_repo(database=Depends(get_db)):
    return SearchProviderRepository(database)


def get_search_service(
    repo: SearchProviderRepository = Depends(get_search_provider_repo),
):
    from cryptography.fernet import Fernet, InvalidToken
    from app.config import settings as app_config
    fernet = Fernet(app_config.fernet_key.encode()) if app_config.fernet_key else None

    def decrypt_fn(val: str) -> str:
        if not fernet:
            return val
        try:
            return fernet.decrypt(val.encode()).decode()
        except (InvalidToken, Exception):
            return val  # Stored unencrypted (legacy) — use as-is

    return SearchService(repo, decrypt_fn=decrypt_fn)


# Services
def get_auth_service(
    user_repo: UserRepository = Depends(get_user_repo),
    redis=Depends(get_redis),
):
    return AuthService(user_repo, redis)


def get_provider_service(
    provider_repo: ProviderRepository = Depends(get_provider_repo),
    redis=Depends(get_redis),
):
    return ProviderService(provider_repo, redis)


def get_llm_service(
    provider_service: ProviderService = Depends(get_provider_service),
    settings_repo: SettingsRepository = Depends(get_settings_repo),
):
    return LLMService(provider_service, settings_repo)


def get_vector_service(
    settings_repo: SettingsRepository = Depends(get_settings_repo),
    llm_service: LLMService = Depends(get_llm_service),
):
    from app.core.qdrant import qdrant_conn
    if qdrant_conn.client:
        return VectorService(qdrant_conn.client, llm_service, settings_repo)
    return None


def get_knowledge_service(
    knowledge_repo: KnowledgeRepository = Depends(get_knowledge_repo),
    llm_service: LLMService = Depends(get_llm_service),
    queue_repo: IngestQueueRepository = Depends(get_ingest_queue_repo),
    vector_service: VectorService | None = Depends(get_vector_service),
    search_service: SearchService = Depends(get_search_service),
):
    return KnowledgeService(knowledge_repo, llm_service, queue_repo, vector_service, search_service)


def get_exemplar_service(
    exemplar_repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    return ExemplarService(exemplar_repo)


def get_huggingface_service(
    settings_repo: SettingsRepository = Depends(get_settings_repo),
):
    return HuggingFaceService(settings_repo)


def get_conversation_service(
    conversation_repo: ConversationRepository = Depends(get_conversation_repo),
    agent_repo: AgentRepository = Depends(get_agent_repo),
    llm_service: LLMService = Depends(get_llm_service),
    knowledge_service: KnowledgeService = Depends(get_knowledge_service),
    exemplar_service: ExemplarService = Depends(get_exemplar_service),
    search_service: SearchService = Depends(get_search_service),
):
    return ConversationService(conversation_repo, agent_repo, llm_service, knowledge_service, exemplar_service, search_service)


def get_roundtable_service(
    conversation_repo: ConversationRepository = Depends(get_conversation_repo),
    agent_repo: AgentRepository = Depends(get_agent_repo),
    llm_service: LLMService = Depends(get_llm_service),
    settings_repo: SettingsRepository = Depends(get_settings_repo),
    knowledge_service: KnowledgeService = Depends(get_knowledge_service),
    exemplar_service: ExemplarService = Depends(get_exemplar_service),
):
    return RoundtableService(conversation_repo, agent_repo, llm_service, settings_repo, knowledge_service, exemplar_service)


# Auth dependencies
async def get_current_user(
    authorization: str = Header(...),
    user_repo: UserRepository = Depends(get_user_repo),
):
    if not authorization.startswith("Bearer "):
        raise AuthenticationError("Invalid authorization header")

    token = authorization[7:]
    payload = decode_token(token)
    if not payload:
        raise AuthenticationError("Invalid or expired token")

    user = await user_repo.find_by_id(payload["sub"])
    if not user:
        raise AuthenticationError("User not found")
    return user


async def require_admin(user=Depends(get_current_user)):
    if user.role != "admin":
        raise AuthorizationError()
    return user
