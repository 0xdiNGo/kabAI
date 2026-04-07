import json
import time
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
SUMMARIZE_URL_TOOL = {
    "type": "function",
    "function": {
        "name": "summarize_url",
        "description": "Summarize a webpage or document URL. Use when a URL is mentioned in conversation and you need to understand its content before answering.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to summarize",
                },
            },
            "required": ["url"],
        },
    },
}
MAX_TOOL_ROUNDS = 3  # Prevent infinite tool-call loops


class LLMService:
    def __init__(self, provider_service: ProviderService, settings_repo: SettingsRepository):
        self.provider_service = provider_service
        self.settings_repo = settings_repo
        self._provider_cache: set[str] | None = None
        self._cache_time: float = 0.0

    async def _get_enabled_provider_types(self) -> set[str]:
        """Get the set of provider_type strings for all enabled providers (cached 60s)."""
        now = time.monotonic()
        if self._provider_cache is not None and (now - self._cache_time) < 60:
            return self._provider_cache
        providers = await self.provider_service.list_providers()
        self._provider_cache = {p.provider_type for p in providers if p.is_enabled}
        self._cache_time = now
        return self._provider_cache

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

        # Build available tools and system message
        settings = await self.settings_repo.get()
        available_tools = [SEARCH_TOOL_DEFINITION]
        tool_descriptions = (
            "You have access to a web_search tool that can search the internet for current information. "
            "When a question requires up-to-date facts, real-time data, or information not in your "
            "knowledge base, use the web_search tool by calling it with a search query. "
            "You can search multiple times to refine your results. "
            "Do NOT tell the user you cannot search the web — you can."
        )
        if settings.kagi_summarizer_enabled:
            available_tools.append(SUMMARIZE_URL_TOOL)
            tool_descriptions += (
                " You also have a summarize_url tool that can summarize any webpage or document. "
                "Use it when a URL is mentioned and you need to understand its content."
            )

        full_messages.insert(-1, {
            "role": "system",
            "content": tool_descriptions,
        })

        # Try tool-use call. If the model doesn't support tools, fall back to regular streaming.
        try:
            yield json.dumps({"type": "status", "status": "connecting"})

            # Agentic loop: let LLM call search/summarize tools, inject results, repeat
            for round_num in range(MAX_TOOL_ROUNDS):
                response = await litellm.acompletion(
                    model=model,
                    messages=full_messages,
                    temperature=agent.temperature if agent else 0.7,
                    max_tokens=agent.max_tokens if agent else 4096,
                    tools=available_tools,
                    tool_choice="auto",
                    **kwargs,
                )

                choice = response.choices[0]

                # If no tool calls, we have the final answer
                if not choice.message.tool_calls:
                    content = choice.message.content or ""
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
                    elif tool_call.function.name == "summarize_url":
                        try:
                            args = json.loads(tool_call.function.arguments)
                            url = args.get("url", "")
                            yield json.dumps({
                                "type": "status", "status": "summarizing",
                                "url": url,
                            })
                            api_key = await search_service.get_kagi_api_key()
                            summary = await search_service.kagi_summarize(
                                url=url, api_key=api_key,
                                engine=settings.kagi_summarizer_engine,
                            )
                            full_messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": f"Summary of {url}:\n{summary}" if summary else f"Could not summarize {url}",
                            })
                        except Exception as e:
                            full_messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": f"Summarization failed: {e}",
                            })

        except Exception:
            # Model doesn't support tools (Anthropic, some Ollama models) —
            # fall back to regular streaming without search capability
            pass

        # Final streaming call (either after max tool rounds or tool-use fallback)
        yield json.dumps({"type": "status", "status": "generating"})
        # Strip tool-related messages that would confuse a non-tool model
        clean_messages = []
        for m in full_messages:
            if isinstance(m, dict):
                if m.get("role") == "tool":
                    continue
                # Strip tool_calls from assistant messages
                if m.get("tool_calls"):
                    m = {k: v for k, v in m.items() if k != "tool_calls"}
            clean_messages.append(m)
        response = await litellm.acompletion(
            model=model, messages=clean_messages,
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
                "[KNOWLEDGE BASE CONTEXT — Use this information to inform your answer. "
                "Prioritize this context but you may also reason from your general knowledge "
                "when the context is relevant but incomplete.]\n\n"
            )
            for item in context:
                context_block += f"--- {item.title} ---\n{item.content}\n\n"
            full_messages.append({"role": "system", "content": context_block})

        # 2. Agent system prompt with grounding instruction
        if agent and agent.system_prompt:
            prompt = agent.system_prompt
            prompt += (
                "\n\nFormat your responses using Markdown. Use headers, lists, "
                "bold, and tables where appropriate. IMPORTANT: Always wrap code, "
                "configuration, terminal output, ASCII art, and any monospaced content "
                "in fenced code blocks (```language). Never use inline backticks for "
                "multi-line code — always use a single fenced block. "
                "For ASCII art, use extended Unicode block characters (█▓▒░▄▀│─┌┐└┘├┤┬┴┼) "
                "in a plain code block. For colored IRC/terminal art, use mIRC color codes: "
                "\\x03FG,BG for colors (0-15), \\x0F to reset, \\x02 for bold."
            )
            if context:
                prompt += (
                    "\n\nYou have been provided with knowledge base context. "
                    "Draw primarily from this context when answering. If the context is "
                    "relevant but doesn't fully cover the question, combine it with your "
                    "general knowledge and note which parts come from the knowledge base. "
                    "Only say you lack information if the topic is genuinely not covered."
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
