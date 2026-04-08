from fastapi import APIRouter, Depends

from app.dependencies import get_current_user, get_usage_repo
from app.repositories.usage_repo import UsageRepository

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/summary")
async def get_usage_summary(
    days: int = 7,
    group_by: str = "model",
    _user=Depends(get_current_user),
    repo: UsageRepository = Depends(get_usage_repo),
):
    """Get aggregated usage stats grouped by model, provider, or task_type."""
    return await repo.get_summary(days=days, group_by=group_by)


@router.get("/trend")
async def get_usage_trend(
    days: int = 30,
    provider: str | None = None,
    _user=Depends(get_current_user),
    repo: UsageRepository = Depends(get_usage_repo),
):
    """Get daily usage trend for charting."""
    return await repo.get_daily_trend(days=days, provider=provider)


@router.get("/recent")
async def get_recent_usage(
    days: int = 7,
    provider: str | None = None,
    model: str | None = None,
    task_type: str | None = None,
    limit: int = 100,
    _user=Depends(get_current_user),
    repo: UsageRepository = Depends(get_usage_repo),
):
    """Get recent usage log entries with optional filters."""
    entries = await repo.query(
        days=days, provider=provider, model=model,
        task_type=task_type, limit=limit,
    )
    return [
        {
            "id": e.id,
            "provider": e.provider,
            "model": e.model,
            "task_type": e.task_type,
            "tokens_in": e.tokens_in,
            "tokens_out": e.tokens_out,
            "total_tokens": e.total_tokens,
            "cost_usd": e.cost_usd,
            "balance_usd": e.balance_usd,
            "duration_ms": e.duration_ms,
            "created_at": e.created_at.isoformat(),
        }
        for e in entries
    ]
