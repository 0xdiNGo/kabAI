# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tiger Team is a multi-agent AI chat platform. Users select from configured AI agents (or raw models) to chat with. Agents can collaborate via roundtable mode — multi-round discussions where agents take turns, respond to each other, and work toward consensus. The platform also includes a knowledge base system for ingesting and organizing reference material (text, URLs, files, RFCs) that agents can draw on.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS (gruvbox dark theme)
- **Backend**: Python 3.12 + FastAPI + litellm (unified LLM provider access)
- **Database**: MongoDB (Motor async driver) + Redis (sessions/cache)
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

**Ingestion** supports text, URL, and file sources. Content is chunked and each chunk gets an LLM-generated title. See [docs/knowledge-ingestion.md](docs/knowledge-ingestion.md) for detailed diagrams.

**RFC-aware ingestion** (`services/rfc_ingestor.py`): integrates with the IETF datatracker to pull RFCs, map lineage (obsoletes/updates chains), and analyze changes between versions.

**Deep research mode**: when enabled, the ingestor follows related links discovered on ingested pages, recursively pulling in connected content.

**Ingest model resolution**: KB-level override → system ingest default → system agent default. This allows each knowledge base to specify which model handles title generation and summarization.

**IngestManager** (`services/ingest_manager.py`): runs ingestion as background tasks with status polling so the UI can track progress. Respects configurable limits: `max_items` (per batch) and `max_urls` (per URL crawl).

### AI Agent Builder

`POST /agents/build` generates full agent profiles (name, system prompt, collaboration role, etc.) from a free-text description. Uses an LLM call to produce a ready-to-save agent configuration.

### Frontend (`frontend/src/`)

- **State**: Zustand stores (`stores/`) for auth state
- **Routing**: React Router v6 (`routes.tsx`) with `ProtectedRoute` wrapper
- **SSE Streaming**: `lib/sse.ts` — POST-based SSE via fetch + ReadableStream (not EventSource)
- **API Client**: `lib/api.ts` — typed fetch wrapper with JWT auth headers
- **Theme**: Gruvbox dark palette defined in `tailwind.config.ts` under `colors.matrix.*`
- **Pages**: Login, Dashboard, Chat, Agents (admin), Providers (admin + settings), KnowledgeBasePage

### MongoDB Collections

`users`, `agents`, `conversations` (messages embedded), `providers`, `settings`, `knowledge_bases`, `knowledge_items`, `ingest_batches`

### REST API

All endpoints under `/api/v1`:
- **Auth**: register, login, refresh, me
- **Agents**: CRUD + bulk-model + export/import + `POST /agents/build` (AI agent builder)
- **Providers**: CRUD + model enumeration + test connectivity
- **Conversations**: CRUD + streaming (with background task support) + status + event reconnection
- **Settings**: get/update system settings (default model, max background chats, roundtable rounds)
- **Knowledge Bases**: CRUD + ingestion (text/URL/file/RFC) + batch status + items listing

Auth required on all except register/login. Admin role required for provider/agent/settings management.

### Agent Archives

Default agent profiles stored in `backend/agents/default-agents.json`. Importable via the `POST /agents/import` endpoint or the UI's Import button on the Manage Agents page.

## Testing

Backend tests use pytest with mocked MongoDB (via AsyncMock) and mocked Redis. Test fixtures in `tests/conftest.py` provide `client`, `auth_headers`, `admin_headers`, and mock DB/Redis.

```bash
# From backend/
python -m pytest -v
python -m pytest -v -k "test_login"
```
