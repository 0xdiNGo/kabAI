from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dependencies import get_current_user, get_settings_repo, require_admin
from app.repositories.settings_repo import SettingsRepository

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    default_model: str | None
    max_background_chats: int
    roundtable_max_rounds: int


class SettingsUpdate(BaseModel):
    default_model: str | None = None
    max_background_chats: int | None = None
    roundtable_max_rounds: int | None = None


@router.get("", response_model=SettingsResponse)
async def get_settings(
    _user=Depends(get_current_user),
    repo: SettingsRepository = Depends(get_settings_repo),
):
    settings = await repo.get()
    return SettingsResponse(
        default_model=settings.default_model,
        max_background_chats=settings.max_background_chats,
        roundtable_max_rounds=settings.roundtable_max_rounds,
    )


@router.put("", response_model=dict)
async def update_settings(
    body: SettingsUpdate,
    _admin=Depends(require_admin),
    repo: SettingsRepository = Depends(get_settings_repo),
):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "default_model" in body.model_dump(exclude_unset=False):
        updates["default_model"] = body.default_model
    await repo.update(updates)
    return {"message": "Settings updated"}
