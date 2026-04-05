import json
from collections.abc import AsyncGenerator

import litellm

from app.core.exceptions import NotFoundError
from app.models.agent import Agent
from app.repositories.settings_repo import SettingsRepository
from app.services.provider_service import ProviderService

SEARCH_TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the internet for current information. Use this when you need up-to-date facts, documentation, or information not in your training data or knowledge base context.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query",
                },
            },
            "required": ["query"],
        },
    },
}
MAX_TOOL_ROUNDS = 3  # Prevent infinite tool-call loops


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
        context: list | None = None,
        exemplars: list | None = None,
    ) -> dict:
        """Non-streaming completion. Returns the full message."""
        kwargs = await self._get_model_kwargs(model)

        full_messages = self._build_messages(messages, agent, context, exemplars)
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
        context: list | None = None,
        exemplars: list | None = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming completion. Yields SSE-formatted events."""
        yield json.dumps({
            "type": "status",
            "status": "thinking",
            "agent_name": agent.name if agent else None,
            "model": model,
        })

        kwargs = await self._get_model_kwargs(model)
        full_messages = self._build_messages(messages, agent, context, exemplars)

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

    async def stream_completion_with_search(
        self,
        model: str,
        messages: list[dict],
        search_service,
        agent: Agent | None = None,
        context: list | None = None,
        exemplars: list | None = None,
        search_provider_ids: list[str] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming completion with web search tool available.

        Uses an agentic loop: non-streaming call with tools to check if the LLM
        wants to search, execute searches, then final streaming call with results.
        """
        yield json.dumps({
            "type": "status", "status": "thinking",
            "agent_name": agent.name if agent else None, "model": model,
        })

        kwargs = await self._get_model_kwargs(model)
        full_messages = self._build_messages(messages, agent, context, exemplars)

        # Agentic loop: let LLM call search tool, inject results, repeat
        for round_num in range(MAX_TOOL_ROUNDS):
            yield json.dumps({"type": "status", "status": "connecting"})

            response = await litellm.acompletion(
                model=model,
                messages=full_messages,
                temperature=agent.temperature if agent else 0.7,
                max_tokens=agent.max_tokens if agent else 4096,
                tools=[SEARCH_TOOL_DEFINITION],
                tool_choice="auto",
                **kwargs,
            )

            choice = response.choices[0]

            # If no tool calls, we have the final answer — stream it
            if not choice.message.tool_calls:
                # The non-streaming call already has the full response
                content = choice.message.content or ""
                # Simulate streaming by yielding the content in chunks
                yield json.dumps({"type": "status", "status": "generating"})
                chunk_size = 20
                for i in range(0, len(content), chunk_size):
                    yield json.dumps({"type": "token", "content": content[i:i + chunk_size]})
                yield json.dumps({
                    "type": "done", "model_used": model, "content": content,
                })
                return

            # Process tool calls
            full_messages.append(choice.message.model_dump())

            for tool_call in choice.message.tool_calls:
                if tool_call.function.name == "web_search":
                    try:
                        args = json.loads(tool_call.function.arguments)
                        query = args.get("query", "")
                        yield json.dumps({
                            "type": "status", "status": "searching",
                            "query": query,
                        })

                        results = await search_service.search(query, provider_ids=search_provider_ids)
                        result_text = search_service.format_results_for_context(results)

                        full_messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": result_text,
                        })
                    except Exception as e:
                        full_messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": f"Search failed: {e}",
                        })

        # If we hit max rounds, do a final streaming call without tools
        yield json.dumps({"type": "status", "status": "generating"})
        response = await litellm.acompletion(
            model=model, messages=full_messages,
            temperature=agent.temperature if agent else 0.7,
            max_tokens=agent.max_tokens if agent else 4096,
            stream=True, **kwargs,
        )
        full_content = ""
        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                full_content += delta.content
                yield json.dumps({"type": "token", "content": delta.content})
        yield json.dumps({"type": "done", "model_used": model, "content": full_content})

    def _build_messages(
        self, messages: list[dict], agent: Agent | None,
        context: list | None = None, exemplars: list | None = None,
    ) -> list[dict]:
        full_messages = []

        # 1. Inject knowledge base context
        if context:
            context_block = (
                "[CONTEXT — Answer ONLY from this information. "
                "If the answer is not here, say so.]\n\n"
            )
            for item in context:
                context_block += f"--- {item.title} ---\n{item.content}\n\n"
            full_messages.append({"role": "system", "content": context_block})

        # 2. Agent system prompt with grounding instruction
        if agent and agent.system_prompt:
            prompt = agent.system_prompt
            if context:
                prompt += (
                    "\n\nIMPORTANT: You have been provided with a knowledge base context. "
                    "Base your answers on that context. If the context doesn't contain enough "
                    "information to answer accurately, say \"I don't have that information in "
                    "my knowledge base\" — never fabricate information."
                )
            if exemplars:
                prompt += (
                    "\n\nYou have been provided with example conversations that demonstrate "
                    "the expected reasoning style and depth. Follow these patterns in your responses."
                )
            full_messages.append({"role": "system", "content": prompt})

        # 3. Inject few-shot exemplar pairs
        if exemplars:
            for pair in exemplars:
                full_messages.append({"role": "user", "content": pair.user_content})
                full_messages.append({"role": "assistant", "content": pair.assistant_content})

        # 4. Conversation history + current message
        full_messages.extend(messages)
        return full_messages
