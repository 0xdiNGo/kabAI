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
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://kagi.com/api/v0/search",
                params={"q": query, "limit": n},
                headers={"Authorization": f"Bot {api_key}"} if api_key else {},
            )
            resp.raise_for_status()
            data = resp.json()
        results = []
        for item in data.get("data", [])[:n]:
            if item.get("t") == 0:  # organic result
                results.append(SearchResult(
                    title=item.get("title", ""),
                    url=item.get("url", ""),
                    snippet=item.get("snippet", ""),
                ))
        return results

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
