from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dependencies import get_current_user, get_settings_repo, require_admin
from app.repositories.settings_repo import SettingsRepository

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    default_model: str | None
    default_ingest_model: str | None
    max_background_chats: int
    roundtable_max_rounds: int
    ingest_max_items: int
    ingest_max_urls: int


class SettingsUpdate(BaseModel):
    default_model: str | None = None
    default_ingest_model: str | None = None
    max_background_chats: int | None = None
    roundtable_max_rounds: int | None = None
    ingest_max_items: int | None = None
    ingest_max_urls: int | None = None


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
        roundtable_max_rounds=settings.roundtable_max_rounds,
        ingest_max_items=settings.ingest_max_items,
        ingest_max_urls=settings.ingest_max_urls,
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
    for field in ("default_model", "default_ingest_model"):
        if field in raw:
            updates[field] = raw[field]
    await repo.update(updates)
    return {"message": "Settings updated"}
