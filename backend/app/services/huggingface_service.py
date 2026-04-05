"""Shared HuggingFace Hub & Datasets Server API client."""

import logging
import re

import httpx
from cryptography.fernet import Fernet

from app.config import settings as app_config
from app.repositories.settings_repo import SettingsRepository

logger = logging.getLogger(__name__)

HF_HUB_BASE = "https://huggingface.co/api"
HF_DATASETS_SERVER = "https://datasets-server.huggingface.co"

# Column names that indicate specific dataset formats
CHAT_COLUMNS = {"messages", "conversations"}
TEXT_COLUMNS = {"text", "content", "document", "passage", "paragraph", "body"}
INSTRUCTION_COLUMNS = {"instruction", "input", "prompt", "question"}
RESPONSE_COLUMNS = {"response", "output", "answer", "completion"}


class HuggingFaceService:
    def __init__(self, settings_repo: SettingsRepository):
        self.settings_repo = settings_repo
        self._fernet = (
            Fernet(app_config.fernet_key.encode()) if app_config.fernet_key else None
        )

    async def _get_token(self) -> str | None:
        settings = await self.settings_repo.get()
        enc = settings.huggingface_token_encrypted
        if not enc:
            return None
        if self._fernet:
            return self._fernet.decrypt(enc.encode()).decode()
        return enc

    def _auth_headers(self, token: str | None) -> dict:
        if token:
            return {"Authorization": f"Bearer {token}"}
        return {}

    async def is_enabled(self) -> bool:
        settings = await self.settings_repo.get()
        return settings.huggingface_enabled

    # --- Repo Inspection ---

    async def inspect_repo(self, repo_id: str) -> dict:
        """Inspect an HF repo to determine type and metadata."""
        repo_id = normalize_repo_id(repo_id)
        token = await self._get_token()
        headers = self._auth_headers(token)

        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            # Try datasets first
            resp = await client.get(
                f"{HF_HUB_BASE}/datasets/{repo_id}", headers=headers
            )
            if resp.status_code == 200:
                data = resp.json()
                return {"repo_type": "dataset", "repo_id": repo_id, "metadata": data}

            # Try models
            resp = await client.get(
                f"{HF_HUB_BASE}/models/{repo_id}", headers=headers
            )
            if resp.status_code == 200:
                data = resp.json()
                return {"repo_type": "model", "repo_id": repo_id, "metadata": data}

        return {"repo_type": "unknown", "repo_id": repo_id, "metadata": {}}

    async def detect_dataset_format(self, repo_id: str) -> dict:
        """Detect column format of an HF dataset.

        Returns dict with 'format' (chat|instruction|text|unknown),
        'columns' (list of column names), and 'config' (first config name).
        """
        repo_id = normalize_repo_id(repo_id)
        token = await self._get_token()
        headers = self._auth_headers(token)

        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            # Get dataset info including features
            resp = await client.get(
                f"{HF_DATASETS_SERVER}/info",
                params={"dataset": repo_id},
                headers=headers,
            )
            if resp.status_code != 200:
                return {"format": "unknown", "columns": [], "config": None}

            info = resp.json()
            # Extract first config
            dataset_info = info.get("dataset_info", {})
            if not dataset_info:
                return {"format": "unknown", "columns": [], "config": None}

            first_config = next(iter(dataset_info), None)
            if not first_config:
                return {"format": "unknown", "columns": [], "config": None}

            features = dataset_info[first_config].get("features", {})
            columns = set(features.keys()) if isinstance(features, dict) else set()

            fmt = "unknown"
            if columns & CHAT_COLUMNS:
                fmt = "chat"
            elif columns & INSTRUCTION_COLUMNS and columns & RESPONSE_COLUMNS:
                fmt = "instruction"
            elif columns & TEXT_COLUMNS:
                fmt = "text"

            return {
                "format": fmt,
                "columns": sorted(columns),
                "config": first_config,
            }

    async def inspect_model_files(self, repo_id: str) -> dict:
        """Check if a model repo contains LoRA adapter files."""
        repo_id = normalize_repo_id(repo_id)
        token = await self._get_token()
        headers = self._auth_headers(token)

        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(
                f"{HF_HUB_BASE}/models/{repo_id}", headers=headers
            )
            if resp.status_code != 200:
                return {"is_lora": False, "gguf_files": [], "base_model": None}

            data = resp.json()
            siblings = data.get("siblings", [])
            filenames = [s.get("rfilename", "") for s in siblings]

            has_adapter_config = "adapter_config.json" in filenames
            gguf_files = [f for f in filenames if f.endswith(".gguf")]

            # Try to extract base model from tags or card data
            base_model = None
            tags = data.get("tags", [])
            for tag in tags:
                if tag.startswith("base_model:"):
                    base_model = tag.split(":", 1)[1]
                    break

            return {
                "is_lora": has_adapter_config or bool(gguf_files),
                "gguf_files": gguf_files,
                "base_model": base_model,
                "model_id": data.get("modelId", repo_id),
                "description": (data.get("cardData", {}) or {}).get(
                    "description", ""
                ),
            }

    # --- Dataset Row Streaming ---

    async def stream_rows(
        self,
        repo_id: str,
        config: str | None = None,
        split: str = "train",
        offset: int = 0,
        length: int = 100,
    ) -> dict:
        """Fetch rows from the HF Datasets Server.

        Returns dict with 'rows' list and 'num_rows_total'.
        """
        repo_id = normalize_repo_id(repo_id)
        token = await self._get_token()
        headers = self._auth_headers(token)

        params: dict = {
            "dataset": repo_id,
            "split": split,
            "offset": offset,
            "length": min(length, 100),
        }
        if config:
            params["config"] = config

        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.get(
                f"{HF_DATASETS_SERVER}/rows",
                params=params,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        rows = []
        for item in data.get("rows", []):
            row = item.get("row", item)
            rows.append(row)

        return {
            "rows": rows,
            "num_rows_total": data.get("num_rows_total", len(rows)),
        }


def normalize_repo_id(repo_id: str) -> str:
    """Strip HF URLs down to bare owner/name repo ID."""
    repo_id = repo_id.strip()
    # Remove full URL prefixes
    repo_id = re.sub(
        r"^https?://(www\.)?huggingface\.co/(datasets/|models/)?", "", repo_id
    )
    # Remove trailing slashes or fragments
    repo_id = repo_id.split("?")[0].split("#")[0].rstrip("/")
    return repo_id
