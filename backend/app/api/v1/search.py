from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.exceptions import NotFoundError
from app.dependencies import get_current_user, get_search_provider_repo, require_admin
from app.repositories.search_provider_repo import SearchProviderRepository

router = APIRouter(prefix="/search-providers", tags=["search"])


class SPCreate(BaseModel):
    name: str  # kagi, google, bing, brave, duckduckgo, searxng
    display_name: str
    api_key: str | None = None
    api_base: str | None = None
    custom_params: dict = {}
    is_enabled: bool = True


class SPUpdate(BaseModel):
    display_name: str | None = None
    api_key: str | None = None
    api_base: str | None = None
    custom_params: dict | None = None
    is_enabled: bool | None = None


class SPResponse(BaseModel):
    id: str
    name: str
    display_name: str
    api_base: str | None
    has_api_key: bool
    custom_params: dict
    is_enabled: bool
    is_default: bool


@router.get("", response_model=list[SPResponse])
async def list_providers(
    _user=Depends(get_current_user),
    repo: SearchProviderRepository = Depends(get_search_provider_repo),
):
    providers = await repo.find_all()
    return [
        SPResponse(
            id=p.id, name=p.name, display_name=p.display_name,
            api_base=p.api_base, has_api_key=p.api_key_encrypted is not None,
            custom_params=p.custom_params, is_enabled=p.is_enabled,
            is_default=p.is_default,
        )
        for p in providers
    ]


@router.post("", response_model=dict, status_code=201)
async def create_provider(
    body: SPCreate,
    _admin=Depends(require_admin),
    repo: SearchProviderRepository = Depends(get_search_provider_repo),
):
    from app.models.search_provider import SearchProvider
    # Encrypt API key if provider service is available
    sp = SearchProvider(
        name=body.name, display_name=body.display_name,
        api_key_encrypted=body.api_key,  # TODO: encrypt via provider_service
        api_base=body.api_base, custom_params=body.custom_params,
        is_enabled=body.is_enabled,
    )
    sp_id = await repo.create(sp)
    return {"id": sp_id}


@router.put("/{sp_id}", response_model=dict)
async def update_provider(
    sp_id: str,
    body: SPUpdate,
    _admin=Depends(require_admin),
    repo: SearchProviderRepository = Depends(get_search_provider_repo),
):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "api_key" in body.model_dump(exclude_unset=False) and body.api_key is not None:
        updates["api_key_encrypted"] = body.api_key
        del updates["api_key"]
    await repo.update(sp_id, updates)
    return {"message": "Search provider updated"}


@router.post("/{sp_id}/set-default", response_model=dict)
async def set_default(
    sp_id: str,
    _admin=Depends(require_admin),
    repo: SearchProviderRepository = Depends(get_search_provider_repo),
):
    await repo.set_default(sp_id)
    return {"message": "Default search provider updated"}


@router.delete("/{sp_id}", response_model=dict)
async def delete_provider(
    sp_id: str,
    _admin=Depends(require_admin),
    repo: SearchProviderRepository = Depends(get_search_provider_repo),
):
    await repo.delete(sp_id)
    return {"message": "Search provider deleted"}


@router.post("/test", response_model=dict)
async def test_search(
    _admin=Depends(require_admin),
    repo: SearchProviderRepository = Depends(get_search_provider_repo),
):
    """Test the default search provider with a sample query."""
    from cryptography.fernet import Fernet
    from app.config import settings as app_config
    from app.services.search_service import SearchService
    fernet = Fernet(app_config.fernet_key.encode()) if app_config.fernet_key else None
    decrypt_fn = (lambda x: fernet.decrypt(x.encode()).decode()) if fernet else (lambda x: x)
    svc = SearchService(repo, decrypt_fn=decrypt_fn)
    results = await svc.search("test query", num_results=3)
    return {
        "results": len(results),
        "items": [{"title": r.title, "url": r.url, "snippet": r.snippet[:100]} for r in results],
    }
