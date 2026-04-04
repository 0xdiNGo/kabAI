from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.exceptions import ConflictError, NotFoundError
from app.dependencies import get_agent_repo, get_current_user, require_admin
from app.models.agent import Agent
from app.repositories.agent_repo import AgentRepository
from app.schemas.agent import AgentCreate, AgentDetailResponse, AgentResponse, AgentUpdate

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


class BulkModelUpdate(BaseModel):
    agent_slugs: list[str]
    preferred_model: str | None


@router.put("/bulk-model", response_model=dict)
async def bulk_update_model(
    body: BulkModelUpdate,
    _admin=Depends(require_admin),
    repo: AgentRepository = Depends(get_agent_repo),
):
    count = await repo.bulk_update_model(body.agent_slugs, body.preferred_model)
    return {"message": f"Updated {count} agents"}


class ExportRequest(BaseModel):
    slugs: list[str]


class AgentArchiveEntry(BaseModel):
    name: str
    slug: str
    description: str
    avatar_url: str | None = None
    system_prompt: str
    specializations: list[str] = []
    preferred_model: str | None = None
    fallback_models: list[str] = []
    temperature: float = 0.7
    max_tokens: int = 4096
    collaboration_capable: bool = False
    collaboration_role: str | None = None


class AgentArchive(BaseModel):
    version: int = 1
    agents: list[AgentArchiveEntry]


@router.post("/export", response_model=AgentArchive)
async def export_agents(
    body: ExportRequest,
    _admin=Depends(require_admin),
    repo: AgentRepository = Depends(get_agent_repo),
):
    """Export selected agents as a JSON archive."""
    agents = await repo.find_by_slugs(body.slugs)
    entries = [
        AgentArchiveEntry(
            name=a.name,
            slug=a.slug,
            description=a.description,
            avatar_url=a.avatar_url,
            system_prompt=a.system_prompt,
            specializations=a.specializations,
            preferred_model=a.preferred_model,
            fallback_models=a.fallback_models,
            temperature=a.temperature,
            max_tokens=a.max_tokens,
            collaboration_capable=a.collaboration_capable,
            collaboration_role=a.collaboration_role,
        )
        for a in agents
    ]
    return AgentArchive(agents=entries)


class ImportResult(BaseModel):
    created: int
    skipped: int
    skipped_slugs: list[str]


@router.post("/import", response_model=ImportResult)
async def import_agents(
    body: AgentArchive,
    admin=Depends(require_admin),
    repo: AgentRepository = Depends(get_agent_repo),
):
    """Import agents from a JSON archive. Skips agents whose slug already exists."""
    created = 0
    skipped = 0
    skipped_slugs: list[str] = []

    for entry in body.agents:
        existing = await repo.find_by_slug(entry.slug)
        if existing:
            skipped += 1
            skipped_slugs.append(entry.slug)
            continue

        agent = Agent(
            **entry.model_dump(),
            created_by=admin.id,
        )
        await repo.create(agent)
        created += 1

    return ImportResult(created=created, skipped=skipped, skipped_slugs=skipped_slugs)


@router.get("/{slug}", response_model=AgentDetailResponse)
async def get_agent(
    slug: str,
    _user=Depends(get_current_user),
    repo: AgentRepository = Depends(get_agent_repo),
):
    agent = await repo.find_by_slug(slug)
    if not agent:
        raise NotFoundError("Agent", slug)
    return AgentDetailResponse(
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
        system_prompt=agent.system_prompt,
        fallback_models=agent.fallback_models,
        temperature=agent.temperature,
        max_tokens=agent.max_tokens,
    )


@router.post("", response_model=dict, status_code=201)
async def create_agent(
    body: AgentCreate,
    admin=Depends(require_admin),
    repo: AgentRepository = Depends(get_agent_repo),
):
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
