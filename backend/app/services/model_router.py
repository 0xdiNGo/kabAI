"""Model Router — auto-assigns cost-efficient LLMs to tasks and agents.

Scores available models by cost, latency, and capability tier, then
recommends the most cost-efficient model for each task type.
"""

import logging
from dataclasses import dataclass, field

import litellm

from app.services.provider_service import ProviderService
from app.repositories.settings_repo import SettingsRepository
from app.repositories.usage_repo import UsageRepository

logger = logging.getLogger(__name__)

# Task tier definitions — higher tier = needs more capable model
TASK_TIERS = {
    "title": 1,
    "classify": 1,
    "embedding": 1,
    "digest": 2,
    "summarize": 2,
    "search": 2,
    "chat": 3,
    "analysis": 3,
}

# Embedding-only model patterns — tier 0, excluded from generation tasks
EMBEDDING_PATTERNS = [
    "embed", "embedding", "nomic", "bge-", "e5-", "gte-",
    "text-embedding", "voyage",
]

# Minimum tier a model qualifies for based on known model families
# Models not listed default to tier 3 (assume capable)
MODEL_TIER_MAP = {
    # Tier 1 — fast, cheap, good for simple tasks
    "haiku": 1,
    "gpt-4o-mini": 1,
    "gpt-3.5": 1,
    "gemini-flash": 1,
    "gemma": 1,
    "llama3:": 1,
    "llama3.2": 1,
    "mistral": 1,
    "phi": 1,
    "qwen": 1,
    # Tier 2 — balanced
    "sonnet": 2,
    "gpt-4o": 2,
    "gemini-pro": 2,
    "llama3.1": 2,
    "llama3.3": 2,
    "mixtral": 2,
    "command-r": 2,
    "deepseek": 2,
    # Tier 3 — most capable
    "opus": 3,
    "gpt-4": 3,
    "o1": 3,
    "o3": 3,
    "gemini-ultra": 3,
    "claude-3-5": 3,
    "claude-sonnet-4": 3,
    "claude-opus": 3,
}


@dataclass
class ModelScore:
    """Scored model for routing decisions."""
    model_id: str  # e.g. "anthropic/claude-sonnet-4-20250514"
    provider: str  # provider type prefix, e.g. "anthropic"
    tier: int  # capability tier (1-3)
    cost_per_1k_input: float  # USD per 1k input tokens
    cost_per_1k_output: float  # USD per 1k output tokens
    avg_latency_ms: float = 0.0  # from usage logs
    context_window: int = 4096  # max context
    total_requests: int = 0  # historical usage count
    efficiency_score: float = 0.0  # computed: lower = more cost efficient


class ModelRouter:
    def __init__(
        self,
        provider_service: ProviderService,
        settings_repo: SettingsRepository,
        usage_repo: UsageRepository | None = None,
    ):
        self.provider_service = provider_service
        self.settings_repo = settings_repo
        self.usage_repo = usage_repo
        self._model_scores: list[ModelScore] = []
        self._recommendations: dict[str, str] = {}  # task_type -> model_id

    def _classify_model_tier(self, model_id: str) -> int:
        """Determine a model's capability tier from its name.

        Returns 0 for embedding-only models (excluded from generation tasks).
        """
        model_lower = model_id.lower()
        # Check for embedding models first
        if any(p in model_lower for p in EMBEDDING_PATTERNS):
            return 0
        for pattern, tier in MODEL_TIER_MAP.items():
            if pattern in model_lower:
                return tier
        return 3  # default: assume capable

    def _get_model_cost(self, model_id: str) -> tuple[float, float]:
        """Get cost per 1k tokens (input, output) from litellm's pricing data."""
        try:
            # litellm maintains a cost map for known models
            info = litellm.get_model_info(model_id)
            input_cost = info.get("input_cost_per_token", 0) * 1000
            output_cost = info.get("output_cost_per_token", 0) * 1000
            return (input_cost, output_cost)
        except Exception:
            pass
        # Fallback: try without provider prefix
        try:
            short_name = model_id.split("/", 1)[-1] if "/" in model_id else model_id
            info = litellm.get_model_info(short_name)
            input_cost = info.get("input_cost_per_token", 0) * 1000
            output_cost = info.get("output_cost_per_token", 0) * 1000
            return (input_cost, output_cost)
        except Exception:
            return (0.0, 0.0)  # Unknown cost (e.g. local Ollama models)

    def _get_context_window(self, model_id: str) -> int:
        """Get model's max context window from litellm."""
        try:
            info = litellm.get_model_info(model_id)
            return info.get("max_input_tokens", 4096) or 4096
        except Exception:
            try:
                short_name = model_id.split("/", 1)[-1] if "/" in model_id else model_id
                info = litellm.get_model_info(short_name)
                return info.get("max_input_tokens", 4096) or 4096
            except Exception:
                return 4096

    async def evaluate_models(self) -> list[ModelScore]:
        """Score all available models across all enabled providers."""
        # list_all_models() already filters to enabled providers and returns
        # ModelInfo objects where .id is the fully-prefixed model ID
        # (e.g. "openai/gpt-4o") and .provider is the provider name string.
        # We derive the provider type prefix from the id itself.
        try:
            all_model_infos = await self.provider_service.list_all_models()
        except Exception as e:
            logger.warning("Failed to enumerate models: %s", e)
            all_model_infos = []

        # Get historical performance data from usage logs
        perf_data: dict[str, dict] = {}
        if self.usage_repo:
            try:
                summary = await self.usage_repo.get_summary(days=30, group_by="model")
                for row in summary:
                    model = row.get("model")
                    if model:
                        perf_data[model] = {
                            "avg_duration_ms": row.get("avg_duration_ms", 0),
                            "total_requests": row.get("total_requests", 0),
                        }
            except Exception:
                pass

        # Score each model
        scores: list[ModelScore] = []
        for model_info in all_model_infos:
            # ModelInfo.id is already the full prefixed ID, e.g. "openai/gpt-4o"
            full_id = model_info.id
            if not full_id:
                continue

            # Extract provider type from the id prefix
            provider_prefix = full_id.split("/")[0] if "/" in full_id else full_id

            tier = self._classify_model_tier(full_id)
            input_cost, output_cost = self._get_model_cost(full_id)
            context = self._get_context_window(full_id)

            perf = perf_data.get(full_id, {})
            avg_latency = perf.get("avg_duration_ms", 0)
            total_requests = perf.get("total_requests", 0)

            # Efficiency score: weighted combination of cost and latency
            # Lower is better. Cost dominates (80%), latency secondary (20%).
            cost_score = (input_cost + output_cost) / 2
            latency_score = avg_latency / 10000 if avg_latency > 0 else 0.5  # normalize
            efficiency = cost_score * 0.8 + latency_score * 0.2

            scores.append(ModelScore(
                model_id=full_id,
                provider=provider_prefix,
                tier=tier,
                cost_per_1k_input=input_cost,
                cost_per_1k_output=output_cost,
                avg_latency_ms=avg_latency,
                context_window=context,
                total_requests=total_requests,
                efficiency_score=efficiency,
            ))

        self._model_scores = sorted(scores, key=lambda s: s.efficiency_score)
        logger.info("Model router evaluated %d models", len(scores))
        return scores

    def recommend_for_task(self, task_type: str) -> str | None:
        """Return the most cost-efficient model for a given task type."""
        if task_type in self._recommendations:
            return self._recommendations[task_type]

        required_tier = TASK_TIERS.get(task_type, 3)

        for score in self._model_scores:
            if task_type == "embedding":
                # Embedding tasks prefer tier-0 (embedding) models
                if score.tier == 0:
                    return score.model_id
            elif score.tier >= required_tier and score.tier > 0:
                # Non-embedding tasks: must meet tier and exclude embedding models
                return score.model_id

        return None

    async def generate_recommendations(self) -> dict[str, str]:
        """Generate model recommendations for all task types."""
        if not self._model_scores:
            await self.evaluate_models()

        recommendations: dict[str, str] = {}
        for task_type, required_tier in TASK_TIERS.items():
            for score in self._model_scores:
                if task_type == "embedding":
                    if score.tier == 0:
                        recommendations[task_type] = score.model_id
                        break
                elif score.tier >= required_tier and score.tier > 0:
                    recommendations[task_type] = score.model_id
                    break

        self._recommendations = recommendations
        logger.info(
            "Model router recommendations: %s",
            {k: v.split("/")[-1] for k, v in recommendations.items()},
        )
        return recommendations

    async def save_recommendations(self) -> dict[str, str]:
        """Evaluate models and persist recommendations to system settings."""
        recommendations = await self.generate_recommendations()
        scores_data = [
            {
                "model_id": s.model_id,
                "provider": s.provider,
                "tier": s.tier,
                "cost_per_1k_input": s.cost_per_1k_input,
                "cost_per_1k_output": s.cost_per_1k_output,
                "avg_latency_ms": s.avg_latency_ms,
                "context_window": s.context_window,
                "total_requests": s.total_requests,
                "efficiency_score": round(s.efficiency_score, 6),
            }
            for s in self._model_scores
        ]
        await self.settings_repo.update({
            "model_recommendations": recommendations,
            "model_scores": scores_data,
        })
        return recommendations

    async def get_recommendations(self) -> dict[str, str]:
        """Get current recommendations (from cache or settings)."""
        if self._recommendations:
            return self._recommendations
        settings = await self.settings_repo.get()
        self._recommendations = getattr(settings, "model_recommendations", {}) or {}
        return self._recommendations

    async def resolve_for_task(self, task_type: str, override: str | None = None) -> str | None:
        """Resolve the best model for a task, respecting overrides.

        Resolution order:
        1. Explicit override (user/agent preference)
        2. Router recommendation for the task tier
        3. System default model
        """
        if override:
            return override

        recommendations = await self.get_recommendations()
        if task_type in recommendations:
            return recommendations[task_type]

        # Fallback to system default
        settings = await self.settings_repo.get()
        return settings.default_model
