from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.core.exceptions import NotFoundError
from app.dependencies import get_current_user, get_huggingface_service, get_knowledge_repo, get_knowledge_service, get_llm_service, require_admin
from app.services.huggingface_service import HuggingFaceService
from app.models.knowledge_base import KnowledgeBase, KnowledgeItem as KBItemModel
from app.repositories.knowledge_repo import KnowledgeRepository
from app.services.knowledge_service import KnowledgeService
from app.services.llm_service import LLMService

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge"])


class KBCreate(BaseModel):
    name: str
    description: str = ""
    ingest_model: str | None = None
    chronological_mode: str = "off"  # "on" | "off" | "auto"
    retrieval_mode: str = "search"  # "search" | "full"


class KBUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    ingest_model: str | None = None
    chronological_mode: str | None = None
    retrieval_mode: str | None = None


class KBResponse(BaseModel):
    id: str
    name: str
    description: str
    ingest_model: str | None
    chronological_mode: str
    retrieval_mode: str
    item_count: int
    created_at: str
    updated_at: str


class KBItemResponse(BaseModel):
    id: str
    title: str
    content: str
    source: str | None
    chunk_index: int
    item_type: str = "chunk"


class AnalyzeRequest(BaseModel):
    content_sample: str  # First ~2000 chars of the content
    source: str | None = None


class IngestRequest(BaseModel):
    content: str
    source: str | None = None
    chunk_size: str = "medium"  # small, medium, large, xlarge


class IngestURLRequest(BaseModel):
    url: str
    deep: bool = False
    chunk_size: str = "medium"

    ai_deep_research: bool = False  # Use LLM for link selection (vs heuristic)
    rfc_analysis: bool = True  # Generate AI analysis comparing RFC versions


class IngestHFRequest(BaseModel):
    repo_id: str
    subset: str | None = None
    split: str = "train"
    max_rows: int = 500
    chunk_size: str = "medium"



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
            chronological_mode=getattr(kb, "chronological_mode", "off"),
            retrieval_mode=getattr(kb, "retrieval_mode", "search"),
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
        ingest_model=body.ingest_model,
        chronological_mode=body.chronological_mode,
        retrieval_mode=body.retrieval_mode,
        created_by=admin.id,
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


def _analyze_content_heuristic(sample: str, source: str | None) -> dict:
    """Classify content for KB ingestion using pure CPU heuristics (no LLM)."""
    import re

    ext = ""
    if source and "." in source:
        ext = source.rsplit(".", 1)[-1].lower()

    lines = sample.split("\n")
    avg_line_len = sum(len(l) for l in lines) / max(len(lines), 1)

    # --- Detect content_type ---
    code_extensions = {"py", "js", "go", "rs", "java", "c", "cpp", "ts", "rb", "sh"}
    code_patterns = {"def ", "function ", "class ", "import "}
    config_extensions = {"json", "yaml", "yml", "toml", "ini", "env", "cfg"}
    doc_extensions = {"md", "rst", "adoc"}
    html_extensions = {"html", "htm"}
    data_extensions = {"csv", "tsv", "xml"}

    content_type = "plain-text"

    if ext in code_extensions or any(p in sample[:2000] for p in code_patterns):
        content_type = "code"
    elif ext in config_extensions or sample.lstrip()[:1] in ("{", "["):
        content_type = "config"
    elif ext == "log" or ext == "weechatlog" or re.search(
        r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}", sample[:2000]
    ):
        content_type = "log-file"
    elif ext in doc_extensions or re.search(r"^#{1,3}\s", sample[:2000], re.MULTILINE):
        content_type = "documentation"
    elif (
        sample.upper().count("RFC") >= 3
        or sum(1 for kw in ("MUST", "SHALL", "SHOULD") if kw in sample[:3000]) >= 3
    ):
        content_type = "RFC/specification"
    elif ext in html_extensions or sample.lstrip().lower().startswith("<html"):
        content_type = "HTML"
    elif ext in data_extensions:
        content_type = "structured-data"

    # --- Detect complexity ---
    technical_terms = sum(
        1 for term in (
            "async", "await", "mutex", "semaphore", "protocol", "algorithm",
            "encryption", "authentication", "schema", "middleware", "namespace",
            "deprecated", "idempotent", "serialization", "concurrency",
        )
        if term in sample.lower()
    )

    has_nested = sample.count("{") > 3 or sample.count("(") > 10

    if avg_line_len < 60 and technical_terms < 3 and content_type not in ("code", "RFC/specification"):
        complexity = "simple"
    elif technical_terms >= 6 or (avg_line_len > 100 and has_nested) or content_type == "RFC/specification":
        complexity = "complex"
    else:
        complexity = "moderate"

    # --- Suggest chunk_size ---
    if content_type in ("RFC/specification", "code"):
        chunk_size = "small"
    elif content_type in ("documentation", "HTML", "structured-data", "plain-text"):
        chunk_size = "medium"
    else:  # log-file, config
        chunk_size = "large"

    # --- Suggest tier ---
    tier_map = {"simple": "local", "moderate": "mid", "complex": "premium"}
    tier = tier_map[complexity]

    reasoning_map = {
        "simple": f"Simple {content_type} content; a local model is sufficient.",
        "moderate": f"Moderate {content_type} with some technical content; a mid-tier model helps.",
        "complex": f"Complex {content_type} with dense technical references; a premium model is recommended.",
    }

    return {
        "content_type": content_type,
        "complexity": complexity,
        "recommended_tier": tier,
        "reasoning": reasoning_map[complexity],
        "suggested_chunk_size": chunk_size,
    }


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

    # Run heuristic analysis (no LLM call)
    analysis = _analyze_content_heuristic(body.content_sample, body.source)

    # Map tier to actual model suggestion
    tier = analysis.get("recommended_tier", "local")
    suggested_model = None
    if available_models.get(tier):
        suggested_model = available_models[tier][0]
    else:
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
        "analyzed_with": "heuristic",
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
        ingest_model=kb.ingest_model,
        chronological_mode=getattr(kb, "chronological_mode", "off"),
        retrieval_mode=getattr(kb, "retrieval_mode", "search"),
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
    raw = body.model_dump(exclude_unset=False)
    updates = {k: v for k, v in raw.items() if v is not None}
    if "ingest_model" in raw:
        updates["ingest_model"] = raw["ingest_model"]
    if "name" in raw and raw["name"]:
        updates["name"] = raw["name"]
    if "chronological_mode" in raw and raw["chronological_mode"]:
        updates["chronological_mode"] = raw["chronological_mode"]
    if "retrieval_mode" in raw and raw["retrieval_mode"]:
        updates["retrieval_mode"] = raw["retrieval_mode"]
    if updates:
        await repo.update_base(kb_id, updates)
    return {"message": "Knowledge base updated"}


@router.delete("/{kb_id}", response_model=dict)
async def delete_knowledge_base(
    kb_id: str,
    request: Request,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
):
    await repo.delete_base(kb_id)
    # Clean up vectors from Qdrant
    vector_svc = getattr(request.app.state, "vector_service", None)
    if vector_svc:
        await vector_svc.delete_by_kb(kb_id)
    return {"message": "Knowledge base deleted"}


@router.post("/{kb_id}/summarize", response_model=dict)
async def summarize_kb(
    kb_id: str,
    request: Request,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
    svc: KnowledgeService = Depends(get_knowledge_service),
):
    """Generate Kagi summaries for KB items (runs as background task)."""
    kb = await repo.find_base_by_id(kb_id)
    if not kb:
        raise NotFoundError("KnowledgeBase", kb_id)

    mgr = request.app.state.ingest_manager
    svc._status_callback = _make_status_callback(mgr, kb_id)
    coro = svc.summarize_kb_items(kb_id)
    await mgr.start_ingest(kb_id, coro)
    return {"status": "started", "kb_id": kb_id}


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

    result = await svc.ingest(kb_id, body.content, body.source, chunk_size=body.chunk_size)
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
    coro = svc.ingest_url(
        kb_id, body.url, deep=body.deep,
        ai_deep_research=body.ai_deep_research,
        rfc_analysis=body.rfc_analysis,
    )
    await mgr.start_ingest(kb_id, coro)
    return {"status": "started", "kb_id": kb_id}


@router.post("/{kb_id}/ingest-hf", response_model=dict)
async def ingest_huggingface(
    kb_id: str,
    body: IngestHFRequest,
    request: Request,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
    svc: KnowledgeService = Depends(get_knowledge_service),
    hf_svc: HuggingFaceService = Depends(get_huggingface_service),
):
    if not await hf_svc.is_enabled():
        raise NotFoundError("HuggingFace integration is disabled")

    kb = await repo.find_base_by_id(kb_id)
    if not kb:
        raise NotFoundError("KnowledgeBase", kb_id)

    mgr = request.app.state.ingest_manager
    svc._status_callback = _make_status_callback(mgr, kb_id)
    coro = svc.ingest_huggingface_dataset(
        kb_id, body.repo_id, hf_svc,
        subset=body.subset, split=body.split, max_rows=body.max_rows,
        chunk_size=body.chunk_size,
    )
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
            item_type=getattr(item, "item_type", "chunk"),
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
            item_type=getattr(item, "item_type", "chunk"),
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
