from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

import litellm

from app.core.exceptions import NotFoundError
from app.dependencies import get_current_user, get_knowledge_repo, get_knowledge_service, get_llm_service, require_admin
from app.models.knowledge_base import KnowledgeBase, KnowledgeItem as KBItemModel
from app.repositories.knowledge_repo import KnowledgeRepository
from app.services.knowledge_service import KnowledgeService
from app.services.llm_service import LLMService

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge"])


class KBCreate(BaseModel):
    name: str
    description: str = ""
    ingest_model: str | None = None


class KBUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    ingest_model: str | None = None


class KBResponse(BaseModel):
    id: str
    name: str
    description: str
    ingest_model: str | None
    item_count: int
    created_at: str
    updated_at: str


class KBItemResponse(BaseModel):
    id: str
    title: str
    content: str
    source: str | None
    chunk_index: int


class AnalyzeRequest(BaseModel):
    content_sample: str  # First ~2000 chars of the content
    source: str | None = None


class IngestRequest(BaseModel):
    content: str
    source: str | None = None
    chunk_size: str = "medium"  # small, medium, large, xlarge
    ai_titles: bool = False  # Use LLM for titles (slower, costs tokens)


class IngestURLRequest(BaseModel):
    url: str
    deep: bool = False
    chunk_size: str = "medium"
    ai_titles: bool = False


@router.get("", response_model=list[KBResponse])
async def list_knowledge_bases(
    _user=Depends(get_current_user),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    bases = await repo.find_all_bases()
    return [
        KBResponse(
            id=kb.id,
            name=kb.name,
            description=kb.description,
            ingest_model=kb.ingest_model,
            item_count=kb.item_count,
            created_at=kb.created_at.isoformat(),
            updated_at=kb.updated_at.isoformat(),
        )
        for kb in bases
    ]


@router.post("", response_model=dict, status_code=201)
async def create_knowledge_base(
    body: KBCreate,
    admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    kb = KnowledgeBase(
        name=body.name, description=body.description,
        ingest_model=body.ingest_model, created_by=admin.id,
    )
    kb_id = await repo.create_base(kb)
    return {"id": kb_id}


@router.get("/queue-status", response_model=dict)
async def queue_status(
    request: Request,
    _user=Depends(get_current_user),
):
    """Global ingest queue depth and worker status."""
    queue_repo = request.app.state.ingest_queue_repo
    worker = request.app.state.ingest_worker
    status = await queue_repo.get_global_queue_status()
    status["worker_running"] = worker._running
    status["worker_task_alive"] = worker._task is not None and not worker._task.done()
    return status


ANALYZE_PROMPT = """\
Analyze this content sample and classify it for knowledge base ingestion.

Content type possibilities: plain-text, documentation, code, log-file, config, \
structured-data (JSON/CSV/XML), RFC/specification, legal/compliance, mixed.

Complexity levels:
- simple: Straightforward prose, logs, configs. Any small model handles titling fine.
- moderate: Technical docs, code with comments, structured data. A mid-tier model helps.
- complex: Specifications, legal text, dense technical content with cross-references. \
A capable model produces significantly better titles and analysis.

Return ONLY valid JSON:
{
  "content_type": "documentation",
  "complexity": "moderate",
  "recommended_tier": "local",
  "reasoning": "One sentence why",
  "suggested_chunk_size": "medium"
}

recommended_tier must be one of:
- "local": Any local/free model (Ollama). Fine for simple content. Saves money.
- "mid": A capable but affordable cloud model. Good for moderate complexity.
- "premium": Best available model. Worth the cost for complex/dense content.

suggested_chunk_size must be one of: small, medium, large, xlarge.
- small for dense reference material where precise retrieval matters
- medium for general docs
- large/xlarge for logs, configs, or prose where speed matters more than granularity
"""


@router.post("/analyze", response_model=dict)
async def analyze_content(
    body: AnalyzeRequest,
    _admin=Depends(require_admin),
    llm_service: LLMService = Depends(get_llm_service),
):
    """Analyze content and suggest the best model and chunk size for ingestion."""
    # Get available models grouped by tier
    providers = await llm_service.provider_service.list_providers()
    available_models: dict[str, list[str]] = {"local": [], "mid": [], "premium": []}

    for p in providers:
        if not p.is_enabled:
            continue
        if p.provider_type == "ollama":
            # Fetch Ollama model list
            try:
                models = await llm_service.provider_service.list_models_for_provider(p.id)
                available_models["local"].extend([m.id for m in models])
            except Exception:
                pass
        elif p.provider_type in ("openai", "google"):
            try:
                models = await llm_service.provider_service.list_models_for_provider(p.id)
                for m in models:
                    name_lower = m.name.lower()
                    if "mini" in name_lower or "flash" in name_lower:
                        available_models["mid"].append(m.id)
                    else:
                        available_models["premium"].append(m.id)
            except Exception:
                pass
        elif p.provider_type == "anthropic":
            try:
                models = await llm_service.provider_service.list_models_for_provider(p.id)
                for m in models:
                    if "haiku" in m.name.lower():
                        available_models["mid"].append(m.id)
                    else:
                        available_models["premium"].append(m.id)
            except Exception:
                pass

    # Use the cheapest available model for the analysis itself (prefer local)
    analysis_model = None
    for tier in ("local", "mid", "premium"):
        if available_models[tier]:
            analysis_model = available_models[tier][0]
            break
    if not analysis_model:
        analysis_model = await llm_service.resolve_model(None)

    kwargs = await llm_service._get_model_kwargs(analysis_model)

    # Truncate sample
    sample = body.content_sample[:3000]

    try:
        response = await litellm.acompletion(
            model=analysis_model,
            messages=[
                {"role": "system", "content": ANALYZE_PROMPT},
                {"role": "user", "content": f"Source: {body.source or 'unknown'}\n\n{sample}"},
            ],
            temperature=0.2,
            max_tokens=200,
            **kwargs,
        )
        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        import json
        analysis = json.loads(raw)
    except Exception:
        # Fallback heuristic
        analysis = {
            "content_type": "unknown",
            "complexity": "moderate",
            "recommended_tier": "local",
            "reasoning": "Could not analyze content; defaulting to local model.",
            "suggested_chunk_size": "medium",
        }

    # Map tier to actual model suggestion
    tier = analysis.get("recommended_tier", "local")
    suggested_model = None
    if available_models.get(tier):
        suggested_model = available_models[tier][0]
    else:
        # Fall back through tiers
        for fallback_tier in ("local", "mid", "premium"):
            if available_models.get(fallback_tier):
                suggested_model = available_models[fallback_tier][0]
                break

    return {
        "analysis": analysis,
        "suggested_model": suggested_model,
        "available_models": {
            tier: models for tier, models in available_models.items() if models
        },
        "analyzed_with": analysis_model,
    }


@router.get("/{kb_id}", response_model=KBResponse)
async def get_knowledge_base(
    kb_id: str,
    _user=Depends(get_current_user),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    kb = await repo.find_base_by_id(kb_id)
    if not kb:
        raise NotFoundError("KnowledgeBase", kb_id)
    return KBResponse(
        id=kb.id,
        name=kb.name,
        description=kb.description,
        item_count=kb.item_count,
        created_at=kb.created_at.isoformat(),
        updated_at=kb.updated_at.isoformat(),
    )


@router.put("/{kb_id}", response_model=dict)
async def update_knowledge_base(
    kb_id: str,
    body: KBUpdate,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    kb = await repo.find_base_by_id(kb_id)
    if not kb:
        raise NotFoundError("KnowledgeBase", kb_id)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    raw = body.model_dump(exclude_unset=False)
    if "ingest_model" in raw:
        updates["ingest_model"] = raw["ingest_model"]
    if "name" in raw and raw["name"]:
        updates["name"] = raw["name"]
    if updates:
        await repo.update_base(kb_id, updates)
    return {"message": "Knowledge base updated"}


@router.delete("/{kb_id}", response_model=dict)
async def delete_knowledge_base(
    kb_id: str,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    await repo.delete_base(kb_id)
    return {"message": "Knowledge base deleted"}


def _make_status_callback(mgr, kb_id: str):
    """Create a status callback that updates the IngestStatus with rich data."""
    def update(msg: str, **kwargs):
        status = mgr.get_status(kb_id)
        if not status:
            return
        status.current_step = msg
        if "steps_log" not in kwargs:
            status.steps_log.append(msg)
            if len(status.steps_log) > 100:
                status.steps_log = status.steps_log[-100:]
        if "chunks_total" in kwargs:
            status.chunks_total = kwargs["chunks_total"]
        if "chunks_completed" in kwargs:
            status.chunks_completed = kwargs["chunks_completed"]
        if "tokens_delta" in kwargs:
            status.tokens_used += kwargs["tokens_delta"]
    return update


@router.post("/{kb_id}/ingest", response_model=dict)
async def ingest_content(
    kb_id: str,
    body: IngestRequest,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
    svc: KnowledgeService = Depends(get_knowledge_service),
):
    """Chunk content and enqueue for persistent background processing."""
    kb = await repo.find_base_by_id(kb_id)
    if not kb:
        raise NotFoundError("KnowledgeBase", kb_id)

    result = await svc.ingest(kb_id, body.content, body.source, chunk_size=body.chunk_size, ai_titles=body.ai_titles)
    return {"status": "queued", **result}


@router.post("/{kb_id}/ingest-url", response_model=dict)
async def ingest_url(
    kb_id: str,
    body: IngestURLRequest,
    request: Request,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
    svc: KnowledgeService = Depends(get_knowledge_service),
):
    kb = await repo.find_base_by_id(kb_id)
    if not kb:
        raise NotFoundError("KnowledgeBase", kb_id)

    mgr = request.app.state.ingest_manager
    svc._status_callback = _make_status_callback(mgr, kb_id)
    coro = svc.ingest_url(kb_id, body.url, deep=body.deep)
    await mgr.start_ingest(kb_id, coro)
    return {"status": "started", "kb_id": kb_id}


@router.get("/{kb_id}/ingest-status", response_model=dict)
async def get_ingest_status(
    kb_id: str,
    request: Request,
    _user=Depends(get_current_user),
):
    """Poll for ingest task status with detailed metrics."""
    mgr = request.app.state.ingest_manager
    status = mgr.get_status(kb_id)
    if not status:
        return {"state": "idle"}
    return {
        "state": status.state,
        "current_step": status.current_step,
        "steps_log": status.steps_log[-20:],
        "chunks_total": status.chunks_total,
        "chunks_completed": status.chunks_completed,
        "items_created": status.items_created,
        "urls_processed": status.urls_processed,
        "tokens_used": status.tokens_used,
        "elapsed_seconds": round(status.elapsed_seconds, 1),
        "estimated_remaining_seconds": (
            round(status.estimated_remaining_seconds, 1)
            if status.estimated_remaining_seconds is not None else None
        ),
        "estimated_remaining_tokens": status.estimated_remaining_tokens,
        "error": status.error,
        "result": status.result if status.state == "completed" else None,
    }


@router.post("/{kb_id}/ingest-cancel", response_model=dict)
async def cancel_ingest(
    kb_id: str,
    request: Request,
    _admin=Depends(require_admin),
):
    """Cancel a running ingest task."""
    mgr = request.app.state.ingest_manager
    await mgr.cancel(kb_id)
    return {"message": "Ingestion cancelled"}


@router.get("/{kb_id}/jobs", response_model=list[dict])
async def list_jobs(
    kb_id: str,
    request: Request,
    _user=Depends(get_current_user),
):
    """List ingest jobs for a KB with per-job progress."""
    queue_repo = request.app.state.ingest_queue_repo
    return await queue_repo.get_jobs_for_kb(kb_id)


@router.delete("/{kb_id}/jobs/{job_id}", response_model=dict)
async def cancel_job(
    kb_id: str,
    job_id: str,
    request: Request,
    _admin=Depends(require_admin),
):
    """Cancel a queued ingest job — removes all pending chunks."""
    queue_repo = request.app.state.ingest_queue_repo
    deleted = await queue_repo.cancel_job(job_id)
    return {"pending_deleted": deleted}




@router.get("/{kb_id}/items", response_model=list[KBItemResponse])
async def list_items(
    kb_id: str,
    limit: int = 100,
    offset: int = 0,
    _user=Depends(get_current_user),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    items = await repo.find_items_by_base(kb_id, limit, offset)
    return [
        KBItemResponse(
            id=item.id,
            title=item.title,
            content=item.content,
            source=item.source,
            chunk_index=item.chunk_index,
        )
        for item in items
    ]


@router.delete("/{kb_id}/items/{item_id}", response_model=dict)
async def delete_item(
    kb_id: str,
    item_id: str,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    await repo.delete_item(item_id)
    await repo.update_item_count(kb_id)
    return {"message": "Item deleted"}


# --- Batches / Version Control ---

@router.get("/{kb_id}/batches", response_model=list[dict])
async def list_batches(
    kb_id: str,
    _user=Depends(get_current_user),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    batches = await repo.find_batches_by_base(kb_id)
    return [
        {
            "id": b.id,
            "source": b.source,
            "item_count": b.item_count,
            "created_at": b.created_at.isoformat(),
        }
        for b in batches
    ]


@router.delete("/{kb_id}/batches/{batch_id}", response_model=dict)
async def rollback_batch(
    kb_id: str,
    batch_id: str,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    """Rollback an ingest batch — deletes all items from that batch."""
    count = await repo.rollback_batch(batch_id)
    await repo.update_item_count(kb_id)
    return {"items_deleted": count}


# --- Sources / Bulk Delete ---

@router.get("/{kb_id}/sources", response_model=list[dict])
async def list_sources(
    kb_id: str,
    _user=Depends(get_current_user),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    return await repo.get_sources(kb_id)


class BulkDeleteRequest(BaseModel):
    source: str


@router.post("/{kb_id}/delete-by-source", response_model=dict)
async def delete_by_source(
    kb_id: str,
    body: BulkDeleteRequest,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    count = await repo.delete_items_by_source(kb_id, body.source)
    await repo.update_item_count(kb_id)
    return {"items_deleted": count}


# --- Search within KB ---

class SearchRequest(BaseModel):
    query: str
    limit: int = 20


@router.post("/{kb_id}/search", response_model=list[KBItemResponse])
async def search_kb(
    kb_id: str,
    body: SearchRequest,
    _user=Depends(get_current_user),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    items = await repo.search_within_base(body.query, kb_id, body.limit)
    return [
        KBItemResponse(
            id=item.id,
            title=item.title,
            content=item.content,
            source=item.source,
            chunk_index=item.chunk_index,
        )
        for item in items
    ]


# --- KB Export/Import ---

class KBExportResponse(BaseModel):
    name: str
    description: str
    ingest_model: str | None = None
    items: list[KBItemResponse]


@router.get("/{kb_id}/export", response_model=KBExportResponse)
async def export_kb(
    kb_id: str,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    kb = await repo.find_base_by_id(kb_id)
    if not kb:
        raise NotFoundError("KnowledgeBase", kb_id)
    items = await repo.find_all_items_by_base(kb_id)
    return KBExportResponse(
        name=kb.name,
        description=kb.description,
        ingest_model=kb.ingest_model,
        items=[
            KBItemResponse(
                id=item.id, title=item.title, content=item.content,
                source=item.source, chunk_index=item.chunk_index,
            )
            for item in items
        ],
    )


class KBImportRequest(BaseModel):
    name: str
    description: str = ""
    ingest_model: str | None = None
    items: list[dict]


@router.post("/import", response_model=dict, status_code=201)
async def import_kb(
    body: KBImportRequest,
    admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    kb = KnowledgeBase(
        name=body.name, description=body.description,
        ingest_model=body.ingest_model, created_by=admin.id,
    )
    kb_id = await repo.create_base(kb)
    batch_id = await repo.create_batch(kb_id, source="import")

    items = [
        KBItemModel(
            knowledge_base_id=kb_id,
            batch_id=batch_id,
            title=item.get("title", "Untitled"),
            content=item.get("content", ""),
            source=item.get("source"),
            chunk_index=item.get("chunk_index", i),
        )
        for i, item in enumerate(body.items)
    ]
    count = await repo.add_items_bulk(items)
    await repo.update_batch_count(batch_id, count)
    await repo.update_item_count(kb_id)
    return {"id": kb_id, "items_created": count}
