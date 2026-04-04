import json
from collections.abc import AsyncGenerator

import litellm

from app.core.exceptions import NotFoundError
from app.models.agent import Agent
from app.repositories.settings_repo import SettingsRepository
from app.services.provider_service import ProviderService


class LLMService:
    def __init__(self, provider_service: ProviderService, settings_repo: SettingsRepository):
        self.provider_service = provider_service
        self.settings_repo = settings_repo

    async def _get_enabled_provider_types(self) -> set[str]:
        """Get the set of provider_type strings for all enabled providers."""
        providers = await self.provider_service.list_providers()
        return {p.provider_type for p in providers if p.is_enabled}

    async def _is_model_available(self, model: str, enabled_types: set[str]) -> bool:
        """Check if a model's provider is enabled."""
        provider_prefix = model.split("/")[0] if "/" in model else model
        return provider_prefix in enabled_types

    async def resolve_model(
        self, preferred: str | None, fallbacks: list[str] | None = None
    ) -> str:
        """Resolve a model through the fallback chain: preferred → fallbacks → system default."""
        enabled_types = await self._get_enabled_provider_types()

        # 1. Preferred model
        if preferred and await self._is_model_available(preferred, enabled_types):
            return preferred

        # 2. Fallback models
        for fb in fallbacks or []:
            if await self._is_model_available(fb, enabled_types):
                return fb

        # 3. System default
        settings = await self.settings_repo.get()
        if settings.default_model and await self._is_model_available(
            settings.default_model, enabled_types
        ):
            return settings.default_model

        raise NotFoundError(
            "Model",
            "no available model found — set a system default model or configure a provider",
        )

    async def _get_model_kwargs(self, model: str) -> dict:
        """Get litellm kwargs (api_key, api_base) for the given model."""
        provider_prefix = model.split("/")[0] if "/" in model else model
        providers = await self.provider_service.list_providers()
        kwargs: dict = {}
        for p in providers:
            if p.provider_type == provider_prefix:
                if p.api_key_encrypted:
                    kwargs["api_key"] = self.provider_service._decrypt_key(p.api_key_encrypted)
                if p.api_base:
                    kwargs["api_base"] = p.api_base
                break
        return kwargs

    async def complete(
        self,
        model: str,
        messages: list[dict],
        agent: Agent | None = None,
    ) -> dict:
        """Non-streaming completion. Returns the full message."""
        kwargs = await self._get_model_kwargs(model)

        full_messages = self._build_messages(messages, agent)
        response = await litellm.acompletion(
            model=model,
            messages=full_messages,
            temperature=agent.temperature if agent else 0.7,
            max_tokens=agent.max_tokens if agent else 4096,
            **kwargs,
        )
        choice = response.choices[0]
        return {
            "content": choice.message.content,
            "model_used": response.model,
            "token_count": response.usage.total_tokens if response.usage else None,
        }

    async def stream_completion(
        self,
        model: str,
        messages: list[dict],
        agent: Agent | None = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming completion. Yields SSE-formatted events."""
        yield json.dumps({
            "type": "status",
            "status": "thinking",
            "agent_name": agent.name if agent else None,
            "model": model,
        })

        kwargs = await self._get_model_kwargs(model)
        full_messages = self._build_messages(messages, agent)

        yield json.dumps({"type": "status", "status": "connecting"})

        response = await litellm.acompletion(
            model=model,
            messages=full_messages,
            temperature=agent.temperature if agent else 0.7,
            max_tokens=agent.max_tokens if agent else 4096,
            stream=True,
            **kwargs,
        )

        yield json.dumps({"type": "status", "status": "generating"})

        full_content = ""
        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                full_content += delta.content
                yield json.dumps({"type": "token", "content": delta.content})

        yield json.dumps({
            "type": "done",
            "model_used": model,
            "content": full_content,
        })

    def _build_messages(self, messages: list[dict], agent: Agent | None) -> list[dict]:
        full_messages = []
        if agent and agent.system_prompt:
            full_messages.append({"role": "system", "content": agent.system_prompt})
        full_messages.extend(messages)
        return full_messages
