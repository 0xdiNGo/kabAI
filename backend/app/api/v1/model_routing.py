from fastapi import APIRouter, Depends, Request

from app.dependencies import get_current_user, get_provider_service, get_settings_repo, get_usage_repo, require_admin
from app.repositories.settings_repo import SettingsRepository
from app.repositories.usage_repo import UsageRepository
from app.services.model_router import ModelRouter
from app.services.provider_service import ProviderService

router = APIRouter(prefix="/model-router", tags=["model-router"])


def _get_router(
    provider_service: ProviderService = Depends(get_provider_service),
    settings_repo: SettingsRepository = Depends(get_settings_repo),
    usage_repo: UsageRepository = Depends(get_usage_repo),
) -> ModelRouter:
    return ModelRouter(provider_service, settings_repo, usage_repo)


@router.post("/evaluate", response_model=dict)
async def evaluate_and_save(
    _admin=Depends(require_admin),
    router_svc: ModelRouter = Depends(_get_router),
):
    """Evaluate all available models and save recommendations."""
    recommendations = await router_svc.save_recommendations()
    scores = router_svc._model_scores
    return {
        "recommendations": recommendations,
        "models_evaluated": len(scores),
        "scores": [
            {
                "model_id": s.model_id,
                "provider": s.provider,
                "tier": s.tier,
                "cost_per_1k_input": round(s.cost_per_1k_input, 6),
                "cost_per_1k_output": round(s.cost_per_1k_output, 6),
                "avg_latency_ms": round(s.avg_latency_ms),
                "context_window": s.context_window,
                "total_requests": s.total_requests,
                "efficiency_score": round(s.efficiency_score, 6),
            }
            for s in scores
        ],
    }


@router.get("/recommendations")
async def get_recommendations(
    _user=Depends(get_current_user),
    settings_repo: SettingsRepository = Depends(get_settings_repo),
):
    """Get current model recommendations and scores."""
    settings = await settings_repo.get()
    return {
        "auto_routing_enabled": getattr(settings, "auto_routing_enabled", True),
        "recommendations": getattr(settings, "model_recommendations", None) or {},
        "scores": getattr(settings, "model_scores", None) or [],
    }


@router.put("/toggle")
async def toggle_auto_routing(
    _admin=Depends(require_admin),
    settings_repo: SettingsRepository = Depends(get_settings_repo),
):
    """Toggle auto-routing on/off."""
    settings = await settings_repo.get()
    new_state = not getattr(settings, "auto_routing_enabled", True)
    await settings_repo.update({"auto_routing_enabled": new_state})
    return {"auto_routing_enabled": new_state}
