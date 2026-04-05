"""Exemplar set service — retrieval and HF dataset import."""

import logging

import httpx

from app.models.exemplar import ExemplarPair
from app.repositories.exemplar_repo import ExemplarRepository

logger = logging.getLogger(__name__)


class ExemplarService:
    def __init__(self, exemplar_repo: ExemplarRepository):
        self.repo = exemplar_repo

    async def retrieve(
        self, query: str, set_ids: list[str], limit: int = 3
    ) -> list[ExemplarPair]:
        """Retrieve the most relevant exemplar pairs for a query."""
        return await self.repo.search(query, set_ids, limit)

    async def import_huggingface(
        self, set_id: str, repo_id: str,
        subset: str | None = None,
        split: str = "train",
        max_pairs: int = 100,
    ) -> int:
        """Import conversation pairs from a Hugging Face dataset.

        Expects datasets with a `messages` column containing arrays of
        {role, content} objects (the standard HF chat format).
        """
        # Build the HF API URL for streaming rows
        config = subset or "default"
        url = (
            f"https://datasets-server.huggingface.co/rows"
            f"?dataset={repo_id}&config={config}&split={split}"
            f"&offset=0&length={max_pairs}"
        )

        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        rows = data.get("rows", [])
        pairs = []

        for row_data in rows:
            row = row_data.get("row", row_data)
            messages = row.get("messages", [])

            # Extract user/assistant pairs from the messages array
            i = 0
            while i < len(messages) - 1:
                msg = messages[i]
                next_msg = messages[i + 1]

                if (
                    msg.get("role") == "user"
                    and next_msg.get("role") == "assistant"
                    and msg.get("content")
                    and next_msg.get("content")
                ):
                    user_content = msg["content"].strip()
                    assistant_content = next_msg["content"].strip()

                    # Skip very short or very long pairs
                    if 20 < len(user_content) < 10000 and 20 < len(assistant_content) < 50000:
                        pairs.append(ExemplarPair(
                            exemplar_set_id=set_id,
                            user_content=user_content,
                            assistant_content=assistant_content,
                            source=repo_id,
                        ))
                    i += 2
                else:
                    i += 1

            if len(pairs) >= max_pairs:
                pairs = pairs[:max_pairs]
                break

        count = await self.repo.add_pairs_bulk(pairs)
        await self.repo.update_pair_count(set_id)
        return count
