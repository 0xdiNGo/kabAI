# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

kabAI is a multi-agent AI chat platform. Users select from configured AI agents (or raw models) to chat with. Agents can collaborate via roundtable mode — multi-round discussions where agents take turns, respond to each other, and work toward consensus. The platform includes a knowledge base system with hybrid vector+keyword retrieval (via Qdrant) for ingesting and organizing reference material (text, URLs, files, RFCs, HuggingFace datasets) that agents can draw on. Chat responses are rendered as rich markdown.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS (gruvbox dark theme)
- **Backend**: Python 3.12 + FastAPI + litellm (unified LLM provider access)
- **Database**: MongoDB (Motor async driver) + Redis (sessions/cache) + Qdrant (vector search)
- **Auth**: Local username/password (OAuth/OIDC planned)
- **Deployment**: Docker Compose (dev + demo)

## Commands

```bash
# Local dev (starts backend, frontend, MongoDB, Redis)
make dev

# Demo stack (production-like, nginx frontend on port 3000)
make demo

# Seed demo data (admin user + agents)
make seed

# Tear down demo
make demo-down

# Run backend only (needs MongoDB + Redis running)
make dev-backend

# Run frontend only
make dev-frontend

# Install dependencies
make install

# Run all backend tests
make test

# Run a single test by keyword
make test-one TEST="test_login"

# Lint / format backend
make lint
make format

# Build docker images
make build

# Generate a Fernet encryption key
make fernet-key
```

## Architecture

### Backend (`backend/app/`)

Three-layer architecture with FastAPI dependency injection:

- **Routers** (`api/v1/`) — HTTP concerns only. Each file is an `APIRouter` with a prefix.
- **Services** (`services/`) — Business logic. Never touches HTTP request/response objects.
- **Repositories** (`repositories/`) — Data access. Each wraps a single MongoDB collection via Motor.

Key wiring: `dependencies.py` defines all FastAPI `Depends` functions that compose repos → services → routers.

Entry point: `main.py` — FastAPI app with lifespan hooks for MongoDB/Redis connections and BackgroundTaskManager initialization.

### LLM Integration

`services/provider_service.py` manages provider configurations (API keys encrypted with Fernet) and model enumeration. `services/llm_service.py` wraps `litellm.acompletion()` for completions and streaming.

**Model resolution chain**: `llm_service.resolve_model()` checks: agent preferred_model → agent fallback_models → system default model (from settings collection). A model is "available" if its provider type matches an enabled provider.

Model IDs use the format `provider/model_name` (e.g., `openai/gpt-4o`, `anthropic/claude-sonnet-4-20250514`, `ollama/llama3`). This maps directly to litellm's model naming.

**Prompt augmentation**: A markdown formatting instruction is appended to all agent system prompts. When knowledge base context is available, grounding instructions are added that tell the agent to prioritize KB context and allow general knowledge to fill gaps.

### Background Task Manager (`services/background_manager.py`)

LLM streaming is decoupled from SSE connections via `BackgroundTaskManager` (singleton on `app.state`). When a user sends a message:
1. A background `asyncio.Task` runs the LLM call to completion
2. Events are pushed to an `asyncio.Queue` per conversation
3. The SSE endpoint reads from the queue
4. If the client disconnects, the task keeps running and saves the response to DB
5. Reconnecting clients pick up from the queue's buffer

Admin-configurable `max_background_chats` limit. Excess tasks are cancelled (oldest first).

### Multi-Agent Roundtable (`services/orchestration/`)

Roundtable mode: multiple agents discuss a topic across configurable rounds (default 3).

- Each round: every agent responds in turn, seeing the full thread including other agents' responses
- Agents can `[PASS]` when they have nothing to add
- Consensus: if majority passes in a round, discussion ends early
- Between rounds: a system message prompts agents to build on each other's points

**Collaboration roles** shape agent behavior in roundtables:
- `orchestrator` — guides discussion, delegates, drives decisions
- `specialist` — deep domain expertise
- `critic` — evaluates ideas, finds flaws
- `synthesizer` — combines viewpoints, drafts conclusions
- `researcher` — provides data and evidence
- `devil_advocate` — challenges prevailing opinion

### Knowledge Base System

Models: `KnowledgeBase`, `KnowledgeItem`, `IngestBatch` (in `models/`). Repository in `repositories/`, service in `services/knowledge_service.py`, API router in `api/v1/knowledge.py` (registered in `api/v1/router.py`).

**Ingestion** supports text, URL, and file sources. Content is chunked and enqueued to a persistent MongoDB queue (`ingest_queue` collection). The `IngestWorker` (started at app boot) polls for pending items and processes them — scripted titles by default (first-line extraction, instant, no LLM cost) or AI-generated titles (opt-in via `ai_titles` flag). See [docs/knowledge-ingestion.md](docs/knowledge-ingestion.md) for detailed diagrams.

**RFC-aware ingestion** (`services/rfc_ingestor.py`): integrates with the IETF datatracker to pull RFCs, map lineage (obsoletes/updates chains), and analyze changes between versions.

**Deep research mode**: when enabled, the ingestor follows related links discovered on ingested pages, recursively pulling in connected content.

**Ingest model resolution**: KB-level override → system ingest default → system agent default. This allows each knowledge base to specify which model handles title generation and summarization.

**IngestManager** (`services/ingest_manager.py`): enqueues chunks into the persistent ingest queue and starts background crawl/chunking tasks with status polling so the UI can track progress. Respects configurable limits: `max_items` (per batch) and `max_urls` (per URL crawl).

**Persistent Ingest Queue**: `IngestQueueItem` model in `models/ingest_queue.py`, repository in `repositories/ingest_queue_repo.py`. Each chunk is a queue document with state (`pending` | `processing` | `done` | `failed`). The `IngestWorker` (`services/ingest_worker.py`) runs as a long-lived asyncio task started at app boot. It claims pending items, generates titles (scripted or AI), generates vector embeddings via `litellm.aembedding()`, persists `KnowledgeItem`s, and auto-purges completed jobs. Crash-safe: on startup, stale `processing` items are reset to `pending`.

**Hybrid retrieval**: Knowledge base queries use Qdrant vector search combined with MongoDB keyword search. Results are merged with weighted score fusion (0.7 vector + 0.3 text). The embedding model is configurable in settings (any litellm-supported embedding model).

**HuggingFace dataset ingestion**: `POST /knowledge-bases/{kb_id}/ingest-hf` imports HuggingFace datasets directly into a knowledge base.

**Vector cleanup**: When a knowledge base is deleted, its associated vectors are removed from Qdrant.

### Vector Search

Qdrant runs as a container in Docker Compose. `VectorService` in `services/vector_service.py` wraps the Qdrant async client. Collection `knowledge_vectors` uses cosine similarity with a `kb_id` payload index for filtered queries. Embeddings are generated during ingest worker processing via `litellm.aembedding()`. When no embedding model is configured in settings, retrieval falls back to keyword-only search.

### HuggingFace Integration

Global toggle: `huggingface_enabled` in settings, with an optional encrypted token (`huggingface_token_encrypted`). `HuggingFaceService` in `services/huggingface_service.py` provides three capabilities:

1. **Dataset-to-KB import** — ingest HuggingFace datasets into knowledge bases
2. **Intelligent repo router** — `POST /huggingface/inspect` examines a HuggingFace repo and routes it to the appropriate handler (dataset, model, etc.)
3. **LoRA adapter metadata inspection** — inspect LoRA adapter repos for base model info and config

Dataset format detection supports chat, instruction, and text column layouts. The `HFImportRouter` frontend component on the Dashboard provides the UI for this workflow.

### Agent Model

The `Agent` model (`models/agent.py`) includes:
- **`tags`**: Free-form string list replacing the old categories system. Used for filtering and grouping agents in the UI.
- **`search_provider_ids`**: Per-agent assignment of search providers. When an agent has search providers assigned, it can use web search during conversations via tool use. Falls back to the system default search provider if none assigned.
- **`exemplar_set_ids`**: Links to exemplar sets for few-shot prompting.
- **`knowledge_base_ids`**: Links to knowledge bases for RAG context injection.
- **LoRA adapted models**: Adapted models are registered as regular Ollama models via Modelfile and selected through the existing `preferred_model` field.

### AI Agent Builder

`POST /agents/build` generates full agent profiles (name, system prompt, collaboration role, etc.) from a free-text description. Uses an LLM call to produce a ready-to-save agent configuration.

### Web Search via Tool Use

Agents with search providers can perform web searches during conversations. Implemented via LLM function calling (tool use):

1. `llm_service.py` defines a `web_search` tool (JSON function schema) and passes it to `litellm.acompletion()`
2. If the LLM requests a `web_search` tool call, the agentic loop executes it via `SearchService`
3. `SearchService` (`services/search_service.py`) dispatches to the appropriate search backend (Kagi, Google Custom Search, Bing, Brave, DuckDuckGo, SearXNG)
4. Results are formatted and injected as a tool response, then the LLM generates the final answer with search context

Provider resolution: agent's `search_provider_ids` (first enabled) -> system default search provider.

### Search Providers

`SearchProvider` model in `models/search_provider.py`. Repository in `repositories/search_provider_repo.py`. API router at `api/v1/search.py` (prefix `/search-providers`). Supports Kagi, Google, Bing, Brave, DuckDuckGo, and SearXNG (self-hosted). API keys are stored encrypted. Each provider can be enabled/disabled and one can be set as the system default.

### Exemplar Sets

`ExemplarSet` and `ExemplarPair` models in `models/exemplar.py`. Repository in `repositories/exemplar_repo.py`. Service in `services/exemplar_service.py`. API router at `api/v1/exemplars.py` (prefix `/exemplar-sets`). Exemplar sets contain user/assistant message pairs used for few-shot prompting. Sets can be imported from HuggingFace datasets (e.g., `source_dataset` field). Agents link to exemplar sets via `exemplar_set_ids`.

### Frontend (`frontend/src/`)

- **State**: Zustand stores (`stores/`) for auth state
- **Routing**: React Router v6 (`routes.tsx`) with `ProtectedRoute` wrapper
- **SSE Streaming**: `lib/sse.ts` — POST-based SSE via fetch + ReadableStream (not EventSource)
- **API Client**: `lib/api.ts` — typed fetch wrapper with JWT auth headers
- **Theme**: Gruvbox dark palette defined in `tailwind.config.ts` under `colors.matrix.*`
- **Markdown Rendering**: `MarkdownContent` component renders chat responses as rich markdown with syntax highlighting
- **Toast Notifications**: Global toast notification system for user feedback
- **Pages**: Login, Dashboard, Chat, Agents (admin), Providers (admin + settings), KnowledgeBasePage, SearchProvidersPage (admin), ExemplarSetPage
- **Components**: `HFImportRouter` (Dashboard — HuggingFace dataset/model import workflow)

### MongoDB Collections

`users`, `agents`, `conversations` (messages embedded), `providers`, `settings`, `knowledge_bases`, `knowledge_items`, `ingest_batches`, `search_providers`, `ingest_queue`, `exemplar_sets`, `exemplar_pairs`

Qdrant collection: `knowledge_vectors` (cosine similarity, `kb_id` payload index)

### REST API

All endpoints under `/api/v1`:
- **Auth**: register, login, refresh, me
- **Agents**: CRUD + bulk-model + export/import + `POST /agents/build` (AI agent builder)
- **Providers**: CRUD + model enumeration + test connectivity + `POST /{provider_id}/ollama/create-model` + `POST /{provider_id}/ollama/delete-model`
- **Conversations**: CRUD + streaming (with background task support) + status + event reconnection
- **Settings**: get/update system settings (default model, max background chats, roundtable rounds, `huggingface_enabled`, `huggingface_token_encrypted`, `embedding_model`)
- **Knowledge Bases**: CRUD + ingestion (text/URL/file/RFC/HuggingFace) + batch status + items listing + queue status + `POST /{kb_id}/ingest-hf` + `POST /{kb_id}/ingest-cancel` + `GET /{kb_id}/jobs` + `DELETE /{kb_id}/jobs/{job_id}` + `GET /queue-status`
- **Search Providers**: CRUD + set-default + test connectivity
- **Exemplar Sets**: CRUD + pair management + HuggingFace import
- **HuggingFace**: `POST /huggingface/inspect` (intelligent repo router)

Auth required on all except register/login. Admin role required for provider/agent/settings/search-provider management.

### Agent Archives

Default agent profiles stored in `backend/agents/default-agents.json`. Importable via the `POST /agents/import` endpoint or the UI's Import button on the Manage Agents page.

## Testing

Backend tests use pytest with mocked MongoDB (via AsyncMock) and mocked Redis. Test fixtures in `tests/conftest.py` provide `client`, `auth_headers`, `admin_headers`, and mock DB/Redis.

```bash
# From backend/
python -m pytest -v
python -m pytest -v -k "test_login"
```
