from fastapi import APIRouter, Depends

from app.dependencies import get_agent_repo, get_current_user, require_admin
from app.models.agent import Agent
from app.repositories.agent_repo import AgentRepository
from app.schemas.agent import AgentCreate, AgentResponse, AgentUpdate

router = APIRouter(prefix="/agents", tags=["agents"])


def _to_response(agent: Agent) -> AgentResponse:
    return AgentResponse(
        id=agent.id,
        name=agent.name,
        slug=agent.slug,
        description=agent.description,
        avatar_url=agent.avatar_url,
        specializations=agent.specializations,
        preferred_model=agent.preferred_model,
        collaboration_capable=agent.collaboration_capable,
        collaboration_role=agent.collaboration_role,
        is_active=agent.is_active,
    )


@router.get("", response_model=list[AgentResponse])
async def list_agents(
    _user=Depends(get_current_user),
    repo: AgentRepository = Depends(get_agent_repo),
):
    agents = await repo.find_all(active_only=True)
    return [_to_response(a) for a in agents]


@router.get("/{slug}", response_model=AgentResponse)
async def get_agent(
    slug: str,
    _user=Depends(get_current_user),
    repo: AgentRepository = Depends(get_agent_repo),
):
    from app.core.exceptions import NotFoundError

    agent = await repo.find_by_slug(slug)
    if not agent:
        raise NotFoundError("Agent", slug)
    return _to_response(agent)


@router.post("", response_model=dict, status_code=201)
async def create_agent(
    body: AgentCreate,
    admin=Depends(require_admin),
    repo: AgentRepository = Depends(get_agent_repo),
):
    from app.core.exceptions import ConflictError

    if await repo.find_by_slug(body.slug):
        raise ConflictError(f"Agent with slug '{body.slug}' already exists")

    agent = Agent(
        **body.model_dump(),
        created_by=admin.id,
    )
    agent_id = await repo.create(agent)
    return {"id": agent_id}


@router.put("/{slug}", response_model=dict)
async def update_agent(
    slug: str,
    body: AgentUpdate,
    _admin=Depends(require_admin),
    repo: AgentRepository = Depends(get_agent_repo),
):
    updates = body.model_dump(exclude_none=True)
    await repo.update(slug, updates)
    return {"message": "Agent updated"}


@router.delete("/{slug}", response_model=dict)
async def delete_agent(
    slug: str,
    _admin=Depends(require_admin),
    repo: AgentRepository = Depends(get_agent_repo),
):
    await repo.delete(slug)
    return {"message": "Agent deactivated"}
