from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.exceptions import NotFoundError
from app.dependencies import get_current_user, get_exemplar_repo, get_exemplar_service, require_admin
from app.models.exemplar import ExemplarPair, ExemplarSet
from app.repositories.exemplar_repo import ExemplarRepository
from app.services.exemplar_service import ExemplarService

router = APIRouter(prefix="/exemplar-sets", tags=["exemplars"])


class ESCreate(BaseModel):
    name: str
    description: str = ""
    source_dataset: str | None = None


class ESUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    source_dataset: str | None = None


class ESResponse(BaseModel):
    id: str
    name: str
    description: str
    source_dataset: str | None
    pair_count: int


class PairCreate(BaseModel):
    user_content: str
    assistant_content: str
    topic_tags: list[str] = []


class PairResponse(BaseModel):
    id: str
    user_content: str
    assistant_content: str
    topic_tags: list[str]
    source: str | None


class HFImportRequest(BaseModel):
    repo_id: str
    subset: str | None = None
    split: str = "train"
    max_pairs: int = 100


# --- Set CRUD ---

@router.get("", response_model=list[ESResponse])
async def list_sets(
    _user=Depends(get_current_user),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    sets = await repo.find_all_sets()
    return [
        ESResponse(
            id=s.id, name=s.name, description=s.description,
            source_dataset=s.source_dataset, pair_count=s.pair_count,
        )
        for s in sets
    ]


@router.post("", response_model=dict, status_code=201)
async def create_set(
    body: ESCreate,
    admin=Depends(require_admin),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    es = ExemplarSet(
        name=body.name, description=body.description,
        source_dataset=body.source_dataset, created_by=admin.id,
    )
    set_id = await repo.create_set(es)
    return {"id": set_id}


@router.get("/{set_id}", response_model=ESResponse)
async def get_set(
    set_id: str,
    _user=Depends(get_current_user),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    es = await repo.find_set_by_id(set_id)
    if not es:
        raise NotFoundError("ExemplarSet", set_id)
    return ESResponse(
        id=es.id, name=es.name, description=es.description,
        source_dataset=es.source_dataset, pair_count=es.pair_count,
    )


@router.put("/{set_id}", response_model=dict)
async def update_set(
    set_id: str,
    body: ESUpdate,
    _admin=Depends(require_admin),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await repo.update_set(set_id, updates)
    return {"message": "Exemplar set updated"}


@router.delete("/{set_id}", response_model=dict)
async def delete_set(
    set_id: str,
    _admin=Depends(require_admin),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    await repo.delete_set(set_id)
    return {"message": "Exemplar set deleted"}


# --- Pairs ---

@router.post("/{set_id}/pairs", response_model=dict, status_code=201)
async def add_pair(
    set_id: str,
    body: PairCreate,
    _admin=Depends(require_admin),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    pair = ExemplarPair(
        exemplar_set_id=set_id,
        user_content=body.user_content,
        assistant_content=body.assistant_content,
        topic_tags=body.topic_tags,
    )
    pair_id = await repo.add_pair(pair)
    await repo.update_pair_count(set_id)
    return {"id": pair_id}


@router.get("/{set_id}/pairs", response_model=list[PairResponse])
async def list_pairs(
    set_id: str,
    limit: int = 50,
    offset: int = 0,
    _user=Depends(get_current_user),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    pairs = await repo.find_pairs_by_set(set_id, limit, offset)
    return [
        PairResponse(
            id=p.id, user_content=p.user_content,
            assistant_content=p.assistant_content,
            topic_tags=p.topic_tags, source=p.source,
        )
        for p in pairs
    ]


@router.delete("/{set_id}/pairs/{pair_id}", response_model=dict)
async def delete_pair(
    set_id: str,
    pair_id: str,
    _admin=Depends(require_admin),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    await repo.delete_pair(pair_id)
    await repo.update_pair_count(set_id)
    return {"message": "Pair deleted"}


# --- HF Import ---

@router.post("/{set_id}/import-hf", response_model=dict)
async def import_hf(
    set_id: str,
    body: HFImportRequest,
    _admin=Depends(require_admin),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
    svc: ExemplarService = Depends(get_exemplar_service),
):
    es = await repo.find_set_by_id(set_id)
    if not es:
        raise NotFoundError("ExemplarSet", set_id)
    count = await svc.import_huggingface(
        set_id, body.repo_id, body.subset, body.split, body.max_pairs,
    )
    # Update source_dataset reference
    await repo.update_set(set_id, {"source_dataset": body.repo_id})
    return {"pairs_imported": count, "source": body.repo_id}


# --- Export/Import ---

class ESExportResponse(BaseModel):
    name: str
    description: str
    source_dataset: str | None
    pairs: list[PairResponse]


@router.get("/{set_id}/export", response_model=ESExportResponse)
async def export_set(
    set_id: str,
    _admin=Depends(require_admin),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    es = await repo.find_set_by_id(set_id)
    if not es:
        raise NotFoundError("ExemplarSet", set_id)
    pairs = await repo.find_all_pairs_by_set(set_id)
    return ESExportResponse(
        name=es.name, description=es.description,
        source_dataset=es.source_dataset,
        pairs=[
            PairResponse(
                id=p.id, user_content=p.user_content,
                assistant_content=p.assistant_content,
                topic_tags=p.topic_tags, source=p.source,
            )
            for p in pairs
        ],
    )


class ESImportRequest(BaseModel):
    name: str
    description: str = ""
    source_dataset: str | None = None
    pairs: list[dict]


@router.post("/import", response_model=dict, status_code=201)
async def import_set(
    body: ESImportRequest,
    admin=Depends(require_admin),
    repo: ExemplarRepository = Depends(get_exemplar_repo),
):
    es = ExemplarSet(
        name=body.name, description=body.description,
        source_dataset=body.source_dataset, created_by=admin.id,
    )
    set_id = await repo.create_set(es)
    pairs = [
        ExemplarPair(
            exemplar_set_id=set_id,
            user_content=p.get("user_content", ""),
            assistant_content=p.get("assistant_content", ""),
            topic_tags=p.get("topic_tags", []),
            source=p.get("source"),
        )
        for p in body.pairs
    ]
    count = await repo.add_pairs_bulk(pairs)
    await repo.update_pair_count(set_id)
    return {"id": set_id, "pairs_imported": count}
