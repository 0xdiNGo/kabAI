from fastapi import APIRouter, Depends
from pydantic import BaseModel

import json as json_mod

import litellm

from app.core.exceptions import ConflictError, NotFoundError
from app.dependencies import get_agent_repo, get_current_user, get_knowledge_repo, get_llm_service, require_admin
from app.models.agent import Agent
from app.services.llm_service import LLMService
from app.models.knowledge_base import KnowledgeBase, KnowledgeItem
from app.repositories.agent_repo import AgentRepository
from app.repositories.knowledge_repo import KnowledgeRepository
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
        knowledge_base_ids=agent.knowledge_base_ids,
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
    knowledge_base_names: list[str] = []  # KB names for export/import mapping
    collaboration_capable: bool = False
    collaboration_role: str | None = None


class KBArchiveItem(BaseModel):
    title: str
    content: str
    source: str | None = None
    chunk_index: int = 0


class KBArchiveEntry(BaseModel):
    name: str
    description: str = ""
    items: list[KBArchiveItem] = []


class AgentArchive(BaseModel):
    version: int = 2
    agents: list[AgentArchiveEntry]
    knowledge_bases: list[KBArchiveEntry] = []


@router.post("/export", response_model=AgentArchive)
async def export_agents(
    body: ExportRequest,
    _admin=Depends(require_admin),
    repo: AgentRepository = Depends(get_agent_repo),
    kb_repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    """Export selected agents with their knowledge bases."""
    agents = await repo.find_by_slugs(body.slugs)

    # Collect all referenced KB IDs
    all_kb_ids = set()
    for a in agents:
        all_kb_ids.update(a.knowledge_base_ids)

    # Load KBs and their items
    kb_entries = []
    kb_id_to_name: dict[str, str] = {}
    if all_kb_ids:
        kbs = await kb_repo.find_bases_by_ids(list(all_kb_ids))
        for kb in kbs:
            kb_id_to_name[kb.id] = kb.name
            items = await kb_repo.find_all_items_by_base(kb.id)
            kb_entries.append(KBArchiveEntry(
                name=kb.name,
                description=kb.description,
                items=[
                    KBArchiveItem(
                        title=item.title,
                        content=item.content,
                        source=item.source,
                        chunk_index=item.chunk_index,
                    )
                    for item in items
                ],
            ))

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
            knowledge_base_names=[kb_id_to_name[kid] for kid in a.knowledge_base_ids if kid in kb_id_to_name],
            collaboration_capable=a.collaboration_capable,
            collaboration_role=a.collaboration_role,
        )
        for a in agents
    ]
    return AgentArchive(agents=entries, knowledge_bases=kb_entries)


class ImportResult(BaseModel):
    created: int
    skipped: int
    skipped_slugs: list[str]
    knowledge_bases_created: int = 0


@router.post("/import", response_model=ImportResult)
async def import_agents(
    body: AgentArchive,
    admin=Depends(require_admin),
    repo: AgentRepository = Depends(get_agent_repo),
    kb_repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    """Import agents and knowledge bases from an archive."""
    # Import knowledge bases first
    kb_name_to_id: dict[str, str] = {}
    kbs_created = 0

    for kb_entry in body.knowledge_bases:
        existing = await kb_repo.find_base_by_name(kb_entry.name)
        if existing:
            kb_name_to_id[kb_entry.name] = existing.id
        else:
            kb = KnowledgeBase(
                name=kb_entry.name,
                description=kb_entry.description,
                created_by=admin.id,
            )
            kb_id = await kb_repo.create_base(kb)
            kb_name_to_id[kb_entry.name] = kb_id

            # Import items
            items = [
                KnowledgeItem(
                    knowledge_base_id=kb_id,
                    title=item.title,
                    content=item.content,
                    source=item.source,
                    chunk_index=item.chunk_index,
                )
                for item in kb_entry.items
            ]
            await kb_repo.add_items_bulk(items)
            await kb_repo.update_item_count(kb_id)
            kbs_created += 1

    # Import agents
    created = 0
    skipped = 0
    skipped_slugs: list[str] = []

    for entry in body.agents:
        existing = await repo.find_by_slug(entry.slug)
        if existing:
            skipped += 1
            skipped_slugs.append(entry.slug)
            continue

        # Map KB names to IDs
        kb_ids = [kb_name_to_id[name] for name in entry.knowledge_base_names if name in kb_name_to_id]

        agent_data = entry.model_dump(exclude={"knowledge_base_names"})
        agent_data["knowledge_base_ids"] = kb_ids
        agent = Agent(
            **agent_data,
            created_by=admin.id,
        )
        await repo.create(agent)
        created += 1

    return ImportResult(
        created=created, skipped=skipped, skipped_slugs=skipped_slugs,
        knowledge_bases_created=kbs_created,
    )


class AgentBuilderRequest(BaseModel):
    description: str  # What the user wants: "A Kubernetes expert who is sarcastic"


AGENT_BUILDER_PROMPT = """\
You are an AI agent builder. Given a user's description of what kind of agent they want, \
generate a complete agent profile as JSON. Be creative with the personality.

The JSON must have exactly these fields:
{
  "name": "Display Name",
  "slug": "url-safe-slug",
  "description": "One-line description for card display",
  "system_prompt": "Detailed personality and behavior instructions (2-4 sentences)",
  "specializations": ["tag1", "tag2", "tag3"],
  "temperature": 0.7,
  "max_tokens": 4096,
  "collaboration_role": "specialist"
}

Rules:
- slug must be lowercase, hyphens only, no spaces
- system_prompt should define personality, expertise, tone, and any quirks
- temperature: 0.3-0.5 for factual/precise agents, 0.6-0.8 for creative/conversational, 0.9+ for chaotic
- collaboration_role must be one of: orchestrator, specialist, critic, synthesizer, researcher, devil_advocate
- Pick the role that best fits the agent's personality
- Return ONLY valid JSON, no markdown fences, no explanation
"""


@router.post("/build", response_model=dict)
async def build_agent(
    body: AgentBuilderRequest,
    _admin=Depends(require_admin),
    llm_service: LLMService = Depends(get_llm_service),
):
    """Use AI to generate an agent profile from a description."""
    model = await llm_service.resolve_model(None)
    kwargs = await llm_service._get_model_kwargs(model)

    response = await litellm.acompletion(
        model=model,
        messages=[
            {"role": "system", "content": AGENT_BUILDER_PROMPT},
            {"role": "user", "content": body.description},
        ],
        temperature=0.7,
        max_tokens=1024,
        **kwargs,
    )

    raw = response.choices[0].message.content.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        profile = json_mod.loads(raw)
    except json_mod.JSONDecodeError:
        return {"error": "Failed to parse AI response", "raw": raw}

    # Ensure required fields have defaults
    profile.setdefault("name", "New Agent")
    profile.setdefault("slug", "new-agent")
    profile.setdefault("description", "")
    profile.setdefault("system_prompt", "")
    profile.setdefault("specializations", [])
    profile.setdefault("temperature", 0.7)
    profile.setdefault("max_tokens", 4096)
    profile.setdefault("collaboration_role", "specialist")

    return {"profile": profile}


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
        knowledge_base_ids=agent.knowledge_base_ids,
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
