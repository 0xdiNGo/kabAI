import asyncio

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.dependencies import get_current_user, get_provider_service, get_settings_repo, get_usage_repo, require_admin
from app.schemas.provider import ModelInfo, ProviderCreate, ProviderResponse, ProviderUpdate
from app.services.provider_service import ProviderService


async def _trigger_model_evaluation(svc: ProviderService) -> None:
    """Fire-and-forget model router re-evaluation after provider changes."""
    try:
        from app.repositories.settings_repo import SettingsRepository
        from app.repositories.usage_repo import UsageRepository
        from app.core.database import db
        from app.services.model_router import ModelRouter
        settings_repo = SettingsRepository(db.db)
        usage_repo = UsageRepository(db.db)
        router = ModelRouter(svc, settings_repo, usage_repo)
        await router.save_recommendations()
    except Exception:
        pass  # Non-critical


class OllamaModelCreateRequest(BaseModel):
    model_name: str
    base_model: str
    adapter_path: str
    system_prompt: str | None = None


class OllamaModelDeleteRequest(BaseModel):
    model_name: str

router = APIRouter(prefix="/providers", tags=["providers"])


@router.get("", response_model=list[ProviderResponse])
async def list_providers(
    _user=Depends(get_current_user),
    svc: ProviderService = Depends(get_provider_service),
):
    providers = await svc.list_providers()
    return [
        ProviderResponse(
            id=p.id,
            name=p.name,
            display_name=p.display_name,
            provider_type=p.provider_type,
            api_base=p.api_base,
            has_api_key=p.api_key_encrypted is not None,
            is_enabled=p.is_enabled,
        )
        for p in providers
    ]


@router.post("", response_model=dict, status_code=201)
async def create_provider(
    body: ProviderCreate,
    _admin=Depends(require_admin),
    svc: ProviderService = Depends(get_provider_service),
):
    provider_id = await svc.create_provider(
        name=body.name,
        display_name=body.display_name,
        provider_type=body.provider_type,
        api_base=body.api_base,
        api_key=body.api_key,
    )
    asyncio.create_task(_trigger_model_evaluation(svc))
    return {"id": provider_id}


@router.put("/{provider_id}", response_model=dict)
async def update_provider(
    provider_id: str,
    body: ProviderUpdate,
    _admin=Depends(require_admin),
    svc: ProviderService = Depends(get_provider_service),
):
    updates = body.model_dump(exclude_none=True)
    await svc.update_provider(provider_id, updates)
    asyncio.create_task(_trigger_model_evaluation(svc))
    return {"message": "Provider updated"}


@router.delete("/{provider_id}", response_model=dict)
async def delete_provider(
    provider_id: str,
    _admin=Depends(require_admin),
    svc: ProviderService = Depends(get_provider_service),
):
    await svc.delete_provider(provider_id)
    asyncio.create_task(_trigger_model_evaluation(svc))
    return {"message": "Provider deleted"}


@router.get("/{provider_id}/models", response_model=list[ModelInfo])
async def list_provider_models(
    provider_id: str,
    _user=Depends(get_current_user),
    svc: ProviderService = Depends(get_provider_service),
):
    return await svc.list_models_for_provider(provider_id)


@router.get("/models/all", response_model=list[ModelInfo])
async def list_all_models(
    _user=Depends(get_current_user),
    svc: ProviderService = Depends(get_provider_service),
):
    return await svc.list_all_models()


@router.post("/{provider_id}/test", response_model=dict)
async def test_provider(
    provider_id: str,
    _admin=Depends(require_admin),
    svc: ProviderService = Depends(get_provider_service),
):
    return await svc.test_provider(provider_id)


@router.post("/{provider_id}/ollama/create-model", response_model=dict)
async def create_ollama_model(
    provider_id: str,
    body: OllamaModelCreateRequest,
    _admin=Depends(require_admin),
    svc: ProviderService = Depends(get_provider_service),
):
    return await svc.create_ollama_model(
        provider_id,
        model_name=body.model_name,
        base_model=body.base_model,
        adapter_path=body.adapter_path,
        system_prompt=body.system_prompt,
    )


@router.post("/{provider_id}/ollama/delete-model", response_model=dict)
async def delete_ollama_model(
    provider_id: str,
    body: OllamaModelDeleteRequest,
    _admin=Depends(require_admin),
    svc: ProviderService = Depends(get_provider_service),
):
    return await svc.delete_ollama_model(provider_id, body.model_name)
