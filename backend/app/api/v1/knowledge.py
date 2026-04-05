from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.core.exceptions import NotFoundError
from app.dependencies import get_current_user, get_knowledge_repo, get_knowledge_service, require_admin
from app.models.knowledge_base import KnowledgeBase
from app.repositories.knowledge_repo import KnowledgeRepository
from app.services.knowledge_service import KnowledgeService

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


class IngestRequest(BaseModel):
    content: str
    source: str | None = None


class IngestURLRequest(BaseModel):
    url: str
    deep: bool = False


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


@router.post("/{kb_id}/ingest", response_model=dict)
async def ingest_content(
    kb_id: str,
    body: IngestRequest,
    request: Request,
    _admin=Depends(require_admin),
    repo: KnowledgeRepository = Depends(get_knowledge_repo),
    svc: KnowledgeService = Depends(get_knowledge_service),
):
    kb = await repo.find_base_by_id(kb_id)
    if not kb:
        raise NotFoundError("KnowledgeBase", kb_id)

    # Run in background
    mgr = request.app.state.ingest_manager

    def update_status(msg, **kwargs):
        status = mgr.get_status(kb_id)
        if status:
            status.current_step = msg

    svc._status_callback = update_status
    coro = svc.ingest(kb_id, body.content, body.source)
    await mgr.start_ingest(kb_id, coro)
    return {"status": "started", "kb_id": kb_id}


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

    # Run in background
    mgr = request.app.state.ingest_manager

    def update_status(msg, **kwargs):
        status = mgr.get_status(kb_id)
        if status:
            status.current_step = msg

    svc._status_callback = update_status
    coro = svc.ingest_url(kb_id, body.url, deep=body.deep)
    await mgr.start_ingest(kb_id, coro)
    return {"status": "started", "kb_id": kb_id}


@router.get("/{kb_id}/ingest-status", response_model=dict)
async def get_ingest_status(
    kb_id: str,
    request: Request,
    _user=Depends(get_current_user),
):
    """Poll for ingest task status."""
    mgr = request.app.state.ingest_manager
    status = mgr.get_status(kb_id)
    if not status:
        return {"state": "idle"}
    return {
        "state": status.state,
        "current_step": status.current_step,
        "items_created": status.items_created,
        "urls_processed": status.urls_processed,
        "error": status.error,
        "result": status.result if status.state == "completed" else None,
    }


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
    from app.models.knowledge_base import IngestBatch, KnowledgeItem as KBItem

    kb = KnowledgeBase(
        name=body.name, description=body.description,
        ingest_model=body.ingest_model, created_by=admin.id,
    )
    kb_id = await repo.create_base(kb)
    batch_id = await repo.create_batch(kb_id, source="import")

    items = [
        KBItem(
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
