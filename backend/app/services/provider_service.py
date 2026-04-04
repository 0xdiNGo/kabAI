import json
from datetime import datetime, timezone

import httpx
from cryptography.fernet import Fernet

from app.config import settings
from app.core.exceptions import ConflictError, NotFoundError
from app.models.provider import Provider
from app.repositories.provider_repo import ProviderRepository
from app.schemas.provider import ModelInfo


class ProviderService:
    def __init__(self, provider_repo: ProviderRepository, redis_client):
        self.provider_repo = provider_repo
        self.redis = redis_client
        self._fernet = Fernet(settings.fernet_key.encode()) if settings.fernet_key else None

    def _encrypt_key(self, api_key: str) -> str:
        if not self._fernet:
            return api_key  # fallback: store unencrypted if no fernet key configured
        return self._fernet.encrypt(api_key.encode()).decode()

    def _decrypt_key(self, encrypted_key: str) -> str:
        if not self._fernet:
            return encrypted_key
        return self._fernet.decrypt(encrypted_key.encode()).decode()

    async def create_provider(
        self,
        name: str,
        display_name: str,
        provider_type: str,
        api_base: str | None = None,
        api_key: str | None = None,
    ) -> str:
        if await self.provider_repo.find_by_name(name):
            raise ConflictError(f"Provider '{name}' already exists")

        provider = Provider(
            name=name,
            display_name=display_name,
            provider_type=provider_type,
            api_base=api_base,
            api_key_encrypted=self._encrypt_key(api_key) if api_key else None,
        )
        return await self.provider_repo.create(provider)

    async def list_providers(self) -> list[Provider]:
        return await self.provider_repo.find_all()

    async def get_provider(self, provider_id: str) -> Provider:
        provider = await self.provider_repo.find_by_id(provider_id)
        if not provider:
            raise NotFoundError("Provider", provider_id)
        return provider

    async def update_provider(self, provider_id: str, updates: dict) -> bool:
        if "api_key" in updates:
            api_key = updates.pop("api_key")
            if api_key:
                updates["api_key_encrypted"] = self._encrypt_key(api_key)
        return await self.provider_repo.update(provider_id, updates)

    async def delete_provider(self, provider_id: str) -> bool:
        return await self.provider_repo.delete(provider_id)

    async def list_models_for_provider(self, provider_id: str) -> list[ModelInfo]:
        """Enumerate models available from a specific provider."""
        # Check Redis cache first
        cache_key = f"models:{provider_id}"
        cached = await self.redis.get(cache_key)
        if cached:
            return [ModelInfo(**m) for m in json.loads(cached)]

        provider = await self.get_provider(provider_id)
        models = await self._fetch_models(provider)

        # Cache for 5 minutes
        await self.redis.set(cache_key, json.dumps([m.model_dump() for m in models]), ex=300)

        # Also update the provider's cache in MongoDB
        await self.provider_repo.update(
            provider_id,
            {
                "models_cache": [m.model_dump() for m in models],
                "models_cache_updated_at": datetime.now(timezone.utc),
            },
        )
        return models

    async def list_all_models(self) -> list[ModelInfo]:
        """List models across all enabled providers."""
        providers = await self.provider_repo.find_all(enabled_only=True)
        all_models = []
        for provider in providers:
            try:
                models = await self.list_models_for_provider(provider.id)
                all_models.extend(models)
            except Exception:
                continue  # skip providers that fail to enumerate
        return all_models

    async def _fetch_models(self, provider: Provider) -> list[ModelInfo]:
        """Fetch models from a provider's API."""
        models = []
        api_key = self._decrypt_key(provider.api_key_encrypted) if provider.api_key_encrypted else None

        async with httpx.AsyncClient(timeout=10) as client:
            if provider.provider_type == "openai":
                headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                base = provider.api_base or "https://api.openai.com"
                resp = await client.get(f"{base}/v1/models", headers=headers)
                resp.raise_for_status()
                for m in resp.json().get("data", []):
                    models.append(ModelInfo(
                        id=f"openai/{m['id']}",
                        name=m["id"],
                        provider=provider.name,
                        provider_display_name=provider.display_name,
                    ))

            elif provider.provider_type == "anthropic":
                # Anthropic doesn't have a model list API; use known models
                known = [
                    "claude-opus-4-20250514",
                    "claude-sonnet-4-20250514",
                    "claude-haiku-4-5-20251001",
                ]
                for m in known:
                    models.append(ModelInfo(
                        id=f"anthropic/{m}",
                        name=m,
                        provider=provider.name,
                        provider_display_name=provider.display_name,
                    ))

            elif provider.provider_type == "ollama":
                base = provider.api_base or "http://localhost:11434"
                resp = await client.get(f"{base}/api/tags")
                resp.raise_for_status()
                for m in resp.json().get("models", []):
                    models.append(ModelInfo(
                        id=f"ollama/{m['name']}",
                        name=m["name"],
                        provider=provider.name,
                        provider_display_name=provider.display_name,
                    ))

            elif provider.provider_type == "google":
                known = ["gemini-2.5-pro", "gemini-2.5-flash"]
                for m in known:
                    models.append(ModelInfo(
                        id=f"gemini/{m}",
                        name=m,
                        provider=provider.name,
                        provider_display_name=provider.display_name,
                    ))

        return models

    async def test_provider(self, provider_id: str) -> dict:
        """Test connectivity to a provider."""
        provider = await self.get_provider(provider_id)
        try:
            models = await self._fetch_models(provider)
            return {"status": "ok", "model_count": len(models)}
        except Exception as e:
            return {"status": "error", "detail": str(e)}
