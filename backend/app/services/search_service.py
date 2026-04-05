"""Web search service — executes searches via configured providers.

Supports: Kagi, Google Custom Search, Bing, Brave, DuckDuckGo, SearXNG.
Used as a tool by the LLM during conversation via function calling.
"""

import logging

import httpx

from app.repositories.search_provider_repo import SearchProviderRepository

logger = logging.getLogger(__name__)


class SearchResult:
    def __init__(self, title: str, url: str, snippet: str):
        self.title = title
        self.url = url
        self.snippet = snippet

    def to_text(self) -> str:
        return f"[{self.title}]({self.url})\n{self.snippet}"


class SearchService:
    def __init__(self, repo: SearchProviderRepository, decrypt_fn=None):
        self.repo = repo
        self._decrypt = decrypt_fn or (lambda x: x)

    async def search(
        self, query: str, num_results: int = 5,
        provider_ids: list[str] | None = None,
    ) -> list[SearchResult]:
        """Search using assigned providers (first available) or the default."""
        provider = None
        if provider_ids:
            for pid in provider_ids:
                p = await self.repo.find_by_id(pid)
                if p and p.is_enabled:
                    provider = p
                    break
        if not provider:
            provider = await self.repo.find_default()
        if not provider:
            return []

        api_key = self._decrypt(provider.api_key_encrypted) if provider.api_key_encrypted else None

        try:
            if provider.name == "kagi":
                # Kagi mode from custom_params: "search" (default), "fastgpt", "enrich_web", "enrich_news"
                mode = provider.custom_params.get("mode", "search")
                if mode == "fastgpt":
                    return await self._kagi_fastgpt(query, api_key, num_results)
                elif mode == "enrich_web":
                    return await self._kagi_enrich(query, api_key, "web", num_results)
                elif mode == "enrich_news":
                    return await self._kagi_enrich(query, api_key, "news", num_results)
                else:
                    return await self._search_kagi(query, api_key, num_results)
            elif provider.name == "google":
                cx = provider.custom_params.get("cx", "")
                return await self._search_google(query, api_key, cx, num_results)
            elif provider.name == "bing":
                return await self._search_bing(query, api_key, num_results)
            elif provider.name == "brave":
                return await self._search_brave(query, api_key, num_results)
            elif provider.name == "duckduckgo":
                return await self._search_duckduckgo(query, num_results)
            elif provider.name == "searxng":
                base = provider.api_base or "http://localhost:8888"
                return await self._search_searxng(query, base, num_results)
            else:
                logger.warning("Unknown search provider: %s", provider.name)
                return []
        except Exception as e:
            logger.warning("Search failed (%s): %s", provider.name, e)
            return []

    async def _search_kagi(self, query: str, api_key: str | None, n: int) -> list[SearchResult]:
        """Kagi Search API — ranked web results."""
        headers = {"Authorization": f"Bot {api_key}"} if api_key else {}
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://kagi.com/api/v0/search",
                params={"q": query, "limit": n},
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
        results = []
        for item in data.get("data", [])[:n]:
            if item.get("t") == 0:  # organic result
                snippet = item.get("snippet", "")
                published = item.get("published")
                if published:
                    snippet = f"[{published}] {snippet}"
                results.append(SearchResult(
                    title=item.get("title", ""),
                    url=item.get("url", ""),
                    snippet=snippet,
                ))
        return results

    async def _kagi_fastgpt(self, query: str, api_key: str | None, n: int) -> list[SearchResult]:
        """Kagi FastGPT API — LLM-synthesized answer with citations."""
        headers = {"Authorization": f"Bot {api_key}"} if api_key else {}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://kagi.com/api/v0/fastgpt",
                json={"query": query, "web_search": True, "cache": True},
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json().get("data", {})

        results = []
        # The synthesized answer is the primary result
        output = data.get("output", "")
        if output:
            results.append(SearchResult(
                title=f"FastGPT: {query[:60]}",
                url="",
                snippet=output,
            ))
        # References as additional results
        for ref in data.get("references", [])[:n - 1]:
            results.append(SearchResult(
                title=ref.get("title", ""),
                url=ref.get("url", ""),
                snippet=ref.get("snippet", ""),
            ))
        return results

    async def _kagi_enrich(self, query: str, api_key: str | None, index: str, n: int) -> list[SearchResult]:
        """Kagi Enrichment API — non-commercial web/news results."""
        headers = {"Authorization": f"Bot {api_key}"} if api_key else {}
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://kagi.com/api/v0/enrich/{index}",
                params={"q": query},
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            SearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                snippet=item.get("snippet", ""),
            )
            for item in data.get("data", [])[:n]
        ]

    async def kagi_summarize(self, url: str, api_key: str | None,
                              summary_type: str = "takeaway",
                              engine: str = "cecil") -> str | None:
        """Kagi Universal Summarizer — summarize a URL or document.

        Useful for KB ingestion: summarize a page before chunking.
        summary_type: "summary" (prose) or "takeaway" (bullet points)
        engine: "cecil" (friendly), "agnes" (technical), "muriel" ($1/summary enterprise)
        """
        headers = {"Authorization": f"Bot {api_key}"} if api_key else {}
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(
                "https://kagi.com/api/v0/summarize",
                params={"url": url, "summary_type": summary_type, "engine": engine},
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json().get("data", {})
        return data.get("output")

    async def _search_google(self, query: str, api_key: str | None, cx: str, n: int) -> list[SearchResult]:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://www.googleapis.com/customsearch/v1",
                params={"q": query, "key": api_key, "cx": cx, "num": min(n, 10)},
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            SearchResult(
                title=item.get("title", ""),
                url=item.get("link", ""),
                snippet=item.get("snippet", ""),
            )
            for item in data.get("items", [])[:n]
        ]

    async def _search_bing(self, query: str, api_key: str | None, n: int) -> list[SearchResult]:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.bing.microsoft.com/v7.0/search",
                params={"q": query, "count": n},
                headers={"Ocp-Apim-Subscription-Key": api_key or ""},
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            SearchResult(
                title=item.get("name", ""),
                url=item.get("url", ""),
                snippet=item.get("snippet", ""),
            )
            for item in data.get("webPages", {}).get("value", [])[:n]
        ]

    async def _search_brave(self, query: str, api_key: str | None, n: int) -> list[SearchResult]:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": n},
                headers={"X-Subscription-Token": api_key or ""},
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            SearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                snippet=item.get("description", ""),
            )
            for item in data.get("web", {}).get("results", [])[:n]
        ]

    async def _search_duckduckgo(self, query: str, n: int) -> list[SearchResult]:
        # DuckDuckGo Instant Answer API (free, no key)
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": 1},
            )
            resp.raise_for_status()
            data = resp.json()
        results = []
        # Abstract
        if data.get("Abstract"):
            results.append(SearchResult(
                title=data.get("Heading", query),
                url=data.get("AbstractURL", ""),
                snippet=data.get("Abstract", ""),
            ))
        # Related topics
        for item in data.get("RelatedTopics", [])[:n]:
            if isinstance(item, dict) and item.get("Text"):
                results.append(SearchResult(
                    title=item.get("Text", "")[:80],
                    url=item.get("FirstURL", ""),
                    snippet=item.get("Text", ""),
                ))
        return results[:n]

    async def _search_searxng(self, query: str, base: str, n: int) -> list[SearchResult]:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base.rstrip('/')}/search",
                params={"q": query, "format": "json", "pageno": 1},
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            SearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                snippet=item.get("content", ""),
            )
            for item in data.get("results", [])[:n]
        ]

    def format_results_for_context(self, results: list[SearchResult]) -> str:
        """Format search results as text for LLM context injection."""
        if not results:
            return "No search results found."
        lines = ["[WEB SEARCH RESULTS]", ""]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. {r.title}")
            lines.append(f"   URL: {r.url}")
            lines.append(f"   {r.snippet}")
            lines.append("")
        return "\n".join(lines)
