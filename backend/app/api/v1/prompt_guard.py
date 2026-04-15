from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.dependencies import (
    get_prompt_guard_repo,
    get_prompt_guard_service,
    require_admin,
)
from app.repositories.prompt_guard_repo import PromptGuardRepository
from app.services.prompt_guard_service import PromptGuardService

router = APIRouter(prefix="/prompt-guard", tags=["prompt-guard"])


class TestRequest(BaseModel):
    content: str
    agent_id: str | None = None
    source: str = "web"


class TestResponse(BaseModel):
    passed: bool
    action: str
    score: float
    flags: list[str]
    sanitized_content: str | None
    details: str | None


@router.get("/logs")
async def get_logs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    agent_id: str | None = None,
    action: str | None = None,
    source: str | None = None,
    _admin=Depends(require_admin),
    repo: PromptGuardRepository = Depends(get_prompt_guard_repo),
):
    """View flagged messages (admin only)."""
    return await repo.find_recent(
        limit=limit, offset=offset,
        agent_id=agent_id, action=action, source=source,
    )


@router.get("/stats")
async def get_stats(
    days: int = Query(7, ge=1, le=90),
    _admin=Depends(require_admin),
    repo: PromptGuardRepository = Depends(get_prompt_guard_repo),
):
    """Aggregate stats for flagged messages (admin only)."""
    return await repo.get_stats(days=days)


@router.post("/test", response_model=TestResponse)
async def test_message(
    body: TestRequest,
    _admin=Depends(require_admin),
    guard: PromptGuardService = Depends(get_prompt_guard_service),
):
    """Dry-run a message against the guard (admin only).

    Useful for tuning sensitivity and testing custom patterns.
    The message is NOT saved to any conversation.
    """
    # Load agent if specified
    agent = None
    if body.agent_id:
        from app.dependencies import get_agent_repo, get_db
        from app.repositories.agent_repo import AgentRepository
        from app.core.database import db
        agent_repo = AgentRepository(db.db)
        agent = await agent_repo.find_by_id(body.agent_id)

    result = await guard.evaluate(
        body.content, agent=agent, source=body.source,
    )
    return TestResponse(
        passed=result.passed,
        action=result.action,
        score=result.score,
        flags=result.flags,
        sanitized_content=result.sanitized_content,
        details=result.details,
    )
