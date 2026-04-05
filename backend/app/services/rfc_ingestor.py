"""IETF RFC-aware ingestion.

When given a datatracker.ietf.org URL, this module:
1. Extracts the RFC number from the URL
2. Fetches RFC metadata from the IETF datatracker API
3. Identifies the full RFC lineage: obsoletes, obsoleted_by, updates, updated_by
4. Ingests all related RFCs
5. Uses the LLM to generate a changes analysis between versions
"""

import logging
import re

import httpx
import litellm

from app.services.llm_service import LLMService

logger = logging.getLogger(__name__)

IETF_URL_PATTERN = re.compile(
    r"datatracker\.ietf\.org/doc/(?:html/)?rfc(\d+)", re.IGNORECASE
)
DATATRACKER_API = "https://datatracker.ietf.org/api/v1/doc/document"
RFC_HTML_BASE = "https://datatracker.ietf.org/doc/html/rfc"


def extract_rfc_number(url: str) -> str | None:
    """Extract RFC number from a datatracker URL."""
    match = IETF_URL_PATTERN.search(url)
    return match.group(1) if match else None


def is_ietf_url(url: str) -> bool:
    return extract_rfc_number(url) is not None


async def fetch_rfc_metadata(rfc_num: str, client: httpx.AsyncClient) -> dict | None:
    """Fetch RFC metadata from the IETF datatracker API."""
    url = f"{DATATRACKER_API}/rfc{rfc_num}/?format=json"
    try:
        resp = await client.get(url)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        logger.warning("Failed to fetch metadata for RFC %s: %s", rfc_num, e)
    return None


def extract_rfc_numbers_from_relations(meta: dict, field: str) -> list[str]:
    """Extract RFC numbers from relation fields in metadata."""
    nums = []
    relations = meta.get(field, [])
    if isinstance(relations, list):
        for rel in relations:
            if isinstance(rel, str):
                # Could be a URI like /api/v1/doc/document/rfc1234/
                m = re.search(r"rfc(\d+)", rel)
                if m:
                    nums.append(m.group(1))
            elif isinstance(rel, dict):
                target = rel.get("target", "") or rel.get("document", "")
                m = re.search(r"rfc(\d+)", str(target))
                if m:
                    nums.append(m.group(1))
    return nums


async def fetch_rfc_text(rfc_num: str, client: httpx.AsyncClient) -> str | None:
    """Fetch the text content of an RFC from the HTML version."""
    url = f"{RFC_HTML_BASE}{rfc_num}"
    try:
        resp = await client.get(url)
        if resp.status_code == 200:
            return resp.text
    except Exception as e:
        logger.warning("Failed to fetch text for RFC %s: %s", rfc_num, e)
    return None


def strip_rfc_html(html: str) -> str:
    """Extract clean text from an RFC HTML page."""
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<nav[^>]*>.*?</nav>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<header[^>]*>.*?</header>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<footer[^>]*>.*?</footer>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<(br|p|div|h[1-6]|li|tr|pre)[^>]*>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", html)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n", "\n\n", text)
    return text.strip()


class RFCIngestResult:
    def __init__(self):
        self.rfcs_ingested: list[str] = []
        self.total_items: int = 0
        self.lineage_summary: str = ""


async def ingest_rfc_lineage(
    rfc_num: str,
    kb_id: str,
    ingest_fn,
    llm_service: LLMService,
    include_analysis: bool = False,
) -> RFCIngestResult:
    """Ingest an RFC and its full lineage (obsoletes, updates, etc.)."""
    result = RFCIngestResult()

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        # 1. Fetch primary RFC metadata
        meta = await fetch_rfc_metadata(rfc_num, client)
        if not meta:
            # Fall back to just ingesting the HTML
            html = await fetch_rfc_text(rfc_num, client)
            if html:
                text = strip_rfc_html(html)
                count = await ingest_fn(kb_id, text, source=f"RFC {rfc_num}")
                result.rfcs_ingested.append(rfc_num)
                result.total_items += count
            return result

        title = meta.get("title", f"RFC {rfc_num}")

        # 2. Build the lineage — all related RFCs
        obsoletes = extract_rfc_numbers_from_relations(meta, "obsoletes")
        obsoleted_by = extract_rfc_numbers_from_relations(meta, "obsoleted_by")
        updates = extract_rfc_numbers_from_relations(meta, "updates")
        updated_by = extract_rfc_numbers_from_relations(meta, "updated_by")

        # Collect all unique RFC numbers to ingest (primary + related)
        all_rfcs = [rfc_num]
        related = set(obsoletes + obsoleted_by + updates + updated_by)
        related.discard(rfc_num)
        all_rfcs.extend(sorted(related))

        # 3. Build a lineage summary as the first ingested item
        lineage_text = _build_lineage_summary(
            rfc_num, title, obsoletes, obsoleted_by, updates, updated_by
        )
        result.lineage_summary = lineage_text

        # Ingest the lineage summary
        count = await ingest_fn(
            kb_id, lineage_text,
            source=f"RFC {rfc_num} lineage analysis"
        )
        result.total_items += count

        # 4. Ingest each RFC in the lineage
        rfc_texts: dict[str, str] = {}
        for num in all_rfcs:
            html = await fetch_rfc_text(num, client)
            if not html:
                logger.warning("Could not fetch RFC %s, skipping", num)
                continue

            text = strip_rfc_html(html)
            rfc_texts[num] = text

            # Fetch metadata for title
            rel_meta = meta if num == rfc_num else await fetch_rfc_metadata(num, client)
            rel_title = (rel_meta or {}).get("title", f"RFC {num}")

            source_label = f"RFC {num}: {rel_title}"
            count = await ingest_fn(kb_id, text, source=source_label)
            result.rfcs_ingested.append(num)
            result.total_items += count

        # 5. Generate changes analysis between versions (LLM-powered, opt-in)
        if include_analysis and (obsoletes or updated_by or obsoleted_by):
            changes = await _generate_changes_analysis(
                rfc_num, title, rfc_texts, obsoletes, obsoleted_by,
                updates, updated_by, llm_service
            )
            if changes:
                count = await ingest_fn(
                    kb_id, changes,
                    source=f"RFC {rfc_num} changes analysis"
                )
                result.total_items += count

    return result


def _build_lineage_summary(
    rfc_num: str, title: str,
    obsoletes: list[str], obsoleted_by: list[str],
    updates: list[str], updated_by: list[str],
) -> str:
    """Build a human-readable lineage summary for the RFC."""
    lines = [
        f"# RFC {rfc_num} Lineage Summary",
        f"## {title}",
        "",
        f"Primary document: RFC {rfc_num}",
    ]

    if obsoletes:
        lines.append(f"Obsoletes: {', '.join(f'RFC {n}' for n in obsoletes)}")
    if obsoleted_by:
        lines.append(
            f"OBSOLETED BY: {', '.join(f'RFC {n}' for n in obsoleted_by)} "
            f"— this RFC is no longer current. Implementations should follow the newer RFC."
        )
    if updates:
        lines.append(f"Updates: {', '.join(f'RFC {n}' for n in updates)}")
    if updated_by:
        lines.append(
            f"Updated by: {', '.join(f'RFC {n}' for n in updated_by)} "
            f"— these RFCs modify or extend this one. Some behavior that was compliant "
            f"under this RFC alone may no longer be correct."
        )

    if not any([obsoletes, obsoleted_by, updates, updated_by]):
        lines.append("No known related RFCs (standalone document).")
    else:
        lines.append("")
        lines.append(
            "COMPLIANCE NOTE: When checking protocol compliance, always verify against "
            "the latest RFC in the lineage chain. Behavior that was valid under an older "
            "RFC may be non-compliant, deprecated, or explicitly prohibited by newer versions."
        )

    return "\n".join(lines)


async def _generate_changes_analysis(
    rfc_num: str, title: str, rfc_texts: dict[str, str],
    obsoletes: list[str], obsoleted_by: list[str],
    updates: list[str], updated_by: list[str],
    llm_service: LLMService,
) -> str | None:
    """Use the LLM to analyze changes between RFC versions."""
    # Build pairs to compare
    pairs = []
    for old_num in obsoletes:
        if old_num in rfc_texts:
            pairs.append((old_num, rfc_num, "obsoleted"))
    for new_num in obsoleted_by:
        if new_num in rfc_texts:
            pairs.append((rfc_num, new_num, "obsoleted"))
    for new_num in updated_by:
        if new_num in rfc_texts:
            pairs.append((rfc_num, new_num, "updated"))

    if not pairs:
        return None

    try:
        model = await llm_service.resolve_model(None)
        kwargs = await llm_service._get_model_kwargs(model)

        sections = [f"# Changes Analysis for RFC {rfc_num}: {title}\n"]

        for old_num, new_num, relation in pairs:
            # Truncate texts to fit context — use beginnings which have abstracts/intros
            old_excerpt = rfc_texts.get(old_num, "")[:4000]
            new_excerpt = rfc_texts.get(new_num, "")[:4000]

            prompt = (
                f"Compare RFC {old_num} and RFC {new_num} (which {relation} it). "
                f"Identify the key changes, focusing on:\n"
                f"1. What behavior was valid under RFC {old_num} but is changed or prohibited in RFC {new_num}\n"
                f"2. New requirements or features added\n"
                f"3. Deprecated features or behaviors\n"
                f"4. Security-relevant changes\n\n"
                f"Be specific and reference section numbers where possible.\n\n"
                f"--- RFC {old_num} (excerpt) ---\n{old_excerpt}\n\n"
                f"--- RFC {new_num} (excerpt) ---\n{new_excerpt}"
            )

            response = await litellm.acompletion(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=2048,
                **kwargs,
            )
            analysis = response.choices[0].message.content.strip()
            sections.append(
                f"\n## RFC {old_num} → RFC {new_num} ({relation})\n\n{analysis}\n"
            )

        return "\n".join(sections)

    except Exception as e:
        logger.warning("Failed to generate changes analysis: %s", e)
        return None
