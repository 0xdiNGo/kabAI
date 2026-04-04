import json
from collections.abc import AsyncGenerator

import litellm

from app.models.agent import Agent
from app.services.provider_service import ProviderService


class LLMService:
    def __init__(self, provider_service: ProviderService):
        self.provider_service = provider_service

    async def _configure_litellm_for_model(self, model: str) -> None:
        """Ensure litellm has the right API keys/base URLs for the given model."""
        # model format is "provider/model_name" e.g. "openai/gpt-4o"
        provider_prefix = model.split("/")[0] if "/" in model else model
        providers = await self.provider_service.list_providers()
        for p in providers:
            if p.provider_type == provider_prefix and p.api_key_encrypted:
                api_key = self.provider_service._decrypt_key(p.api_key_encrypted)
                # Set env-style keys that litellm picks up
                if provider_prefix == "openai":
                    litellm.openai_key = api_key
                elif provider_prefix == "anthropic":
                    litellm.anthropic_key = api_key
                if p.api_base:
                    litellm.api_base = p.api_base
                break

    async def complete(
        self,
        model: str,
        messages: list[dict],
        agent: Agent | None = None,
    ) -> dict:
        """Non-streaming completion. Returns the full message."""
        await self._configure_litellm_for_model(model)

        full_messages = self._build_messages(messages, agent)
        response = await litellm.acompletion(
            model=model,
            messages=full_messages,
            temperature=agent.temperature if agent else 0.7,
            max_tokens=agent.max_tokens if agent else 4096,
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
        await self._configure_litellm_for_model(model)

        full_messages = self._build_messages(messages, agent)
        response = await litellm.acompletion(
            model=model,
            messages=full_messages,
            temperature=agent.temperature if agent else 0.7,
            max_tokens=agent.max_tokens if agent else 4096,
            stream=True,
        )

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
