from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.exceptions import NotFoundError
from app.dependencies import get_huggingface_service, require_admin
from app.services.huggingface_service import HuggingFaceService

router = APIRouter(prefix="/huggingface", tags=["huggingface"])


class HFInspectRequest(BaseModel):
    repo_id: str


class HFInspectResponse(BaseModel):
    repo_id: str
    repo_type: str
    suggestion: str
    reason: str
    details: dict


@router.post("/inspect", response_model=HFInspectResponse)
async def inspect_repo(
    body: HFInspectRequest,
    _admin=Depends(require_admin),
    hf_svc: HuggingFaceService = Depends(get_huggingface_service),
):
    if not await hf_svc.is_enabled():
        raise NotFoundError("HuggingFace integration is disabled")

    info = await hf_svc.inspect_repo(body.repo_id)
    repo_type = info["repo_type"]
    repo_id = info["repo_id"]

    if repo_type == "dataset":
        fmt_info = await hf_svc.detect_dataset_format(repo_id)
        fmt = fmt_info["format"]

        if fmt in ("chat", "instruction"):
            return HFInspectResponse(
                repo_id=repo_id,
                repo_type="dataset",
                suggestion="exemplar_set",
                reason=f"This dataset has {fmt}-format data suitable for few-shot exemplar pairs.",
                details=fmt_info,
            )
        elif fmt == "text":
            return HFInspectResponse(
                repo_id=repo_id,
                repo_type="dataset",
                suggestion="knowledge_base",
                reason="This dataset contains text documents suitable for knowledge base ingestion.",
                details=fmt_info,
            )
        else:
            return HFInspectResponse(
                repo_id=repo_id,
                repo_type="dataset",
                suggestion="knowledge_base",
                reason="Dataset format not auto-detected. You can try importing as knowledge base content.",
                details=fmt_info,
            )

    elif repo_type == "model":
        model_info = await hf_svc.inspect_model_files(repo_id)
        if model_info["is_lora"]:
            return HFInspectResponse(
                repo_id=repo_id,
                repo_type="model",
                suggestion="lora_adapter",
                reason="This model contains LoRA adapter files. Register it with an Ollama provider.",
                details=model_info,
            )
        else:
            return HFInspectResponse(
                repo_id=repo_id,
                repo_type="model",
                suggestion="unknown",
                reason="This appears to be a base model, not an adapter. Use Ollama to pull it directly.",
                details=model_info,
            )

    return HFInspectResponse(
        repo_id=repo_id,
        repo_type="unknown",
        suggestion="unknown",
        reason="Could not determine repository type. Check that the repo ID is correct.",
        details={},
    )
