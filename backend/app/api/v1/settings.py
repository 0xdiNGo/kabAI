from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import settings as app_config
from app.dependencies import get_current_user, get_settings_repo, require_admin
from app.repositories.settings_repo import SettingsRepository

try:
    from cryptography.fernet import Fernet
    _fernet = Fernet(app_config.fernet_key.encode()) if app_config.fernet_key else None
except Exception:
    _fernet = None

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    default_model: str | None
    default_ingest_model: str | None
    max_background_chats: int
    kabainet_max_rounds: int
    ingest_max_items: int
    ingest_max_urls: int
    huggingface_enabled: bool
    huggingface_has_token: bool
    embedding_model: str | None
    kagi_summarizer_enabled: bool
    kagi_summarizer_engine: str
    prompt_guard_enabled: bool
    prompt_guard_default_sensitivity: str
    prompt_guard_default_action: str
    prompt_guard_max_message_length: int
    prompt_guard_log_flagged: bool


class SettingsUpdate(BaseModel):
    default_model: str | None = None
    default_ingest_model: str | None = None
    max_background_chats: int | None = None
    kabainet_max_rounds: int | None = None
    ingest_max_items: int | None = None
    ingest_max_urls: int | None = None
    huggingface_enabled: bool | None = None
    huggingface_token: str | None = None
    embedding_model: str | None = None
    kagi_summarizer_enabled: bool | None = None
    kagi_summarizer_engine: str | None = None
    prompt_guard_enabled: bool | None = None
    prompt_guard_default_sensitivity: str | None = None
    prompt_guard_default_action: str | None = None
    prompt_guard_max_message_length: int | None = None
    prompt_guard_custom_patterns: list[dict] | None = None
    prompt_guard_log_flagged: bool | None = None


@router.get("", response_model=SettingsResponse)
async def get_settings(
    _user=Depends(get_current_user),
    repo: SettingsRepository = Depends(get_settings_repo),
):
    settings = await repo.get()
    return SettingsResponse(
        default_model=settings.default_model,
        default_ingest_model=settings.default_ingest_model,
        max_background_chats=settings.max_background_chats,
        kabainet_max_rounds=settings.kabainet_max_rounds,
        ingest_max_items=settings.ingest_max_items,
        ingest_max_urls=settings.ingest_max_urls,
        huggingface_enabled=settings.huggingface_enabled,
        huggingface_has_token=settings.huggingface_token_encrypted is not None,
        embedding_model=settings.embedding_model,
        kagi_summarizer_enabled=settings.kagi_summarizer_enabled,
        kagi_summarizer_engine=settings.kagi_summarizer_engine,
        prompt_guard_enabled=settings.prompt_guard_enabled,
        prompt_guard_default_sensitivity=settings.prompt_guard_default_sensitivity,
        prompt_guard_default_action=settings.prompt_guard_default_action,
        prompt_guard_max_message_length=settings.prompt_guard_max_message_length,
        prompt_guard_log_flagged=settings.prompt_guard_log_flagged,
    )


@router.put("", response_model=dict)
async def update_settings(
    body: SettingsUpdate,
    _admin=Depends(require_admin),
    repo: SettingsRepository = Depends(get_settings_repo),
):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    # Allow explicitly setting nullable fields to null
    raw = body.model_dump(exclude_unset=False)
    for field in ("default_model", "default_ingest_model", "embedding_model"):
        if field in raw:
            updates[field] = raw[field]
    # Encrypt HF token before storage
    if "huggingface_token" in updates:
        token = updates.pop("huggingface_token")
        if token:
            updates["huggingface_token_encrypted"] = (
                _fernet.encrypt(token.encode()).decode() if _fernet else token
            )
        else:
            updates["huggingface_token_encrypted"] = None
    await repo.update(updates)
    return {"message": "Settings updated"}
