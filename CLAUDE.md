# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tiger Team is a multi-agent AI chat platform. Users select from configured AI agents (or raw models) to chat with. Agents can collaborate with each other via orchestrator or roundtable modes to solve complex problems (e.g., tech support).

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Python 3.12 + FastAPI + litellm (unified LLM provider access)
- **Database**: MongoDB (Motor async driver) + Redis (sessions/cache)
- **Auth**: Local username/password + OAuth/OIDC (dual auth at login screen)
- **Deployment**: Docker Compose (dev), Kubernetes + Kustomize (prod)

## Commands

```bash
# Local dev (starts backend, frontend, MongoDB, Redis)
make dev

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
```

## Architecture

### Backend (`backend/app/`)

Three-layer architecture with FastAPI dependency injection:

- **Routers** (`api/v1/`) — HTTP concerns only. Each file is an `APIRouter` with a prefix.
- **Services** (`services/`) — Business logic. Never touches HTTP request/response objects.
- **Repositories** (`repositories/`) — Data access. Each wraps a single MongoDB collection via Motor.

Key wiring: `dependencies.py` defines all FastAPI `Depends` functions that compose repos → services → routers.

Entry point: `main.py` — FastAPI app with lifespan hooks for MongoDB/Redis connections.

### LLM Integration

`services/provider_service.py` manages provider configurations (API keys encrypted with Fernet) and model enumeration. `services/llm_service.py` wraps `litellm.acompletion()` for completions and streaming.

Model IDs use the format `provider/model_name` (e.g., `openai/gpt-4o`, `anthropic/claude-sonnet-4-20250514`, `ollama/llama3`). This maps directly to litellm's model naming.

### Multi-Agent Orchestration (`services/orchestration/`)

Two collaboration modes:
- **Orchestrator**: Lead agent plans which specialists to consult → concurrent specialist calls → orchestrator synthesizes response
- **Roundtable**: Round-robin turns with full thread visibility, agents can `[PASS]`, user can interject

### Frontend (`frontend/src/`)

- **State**: Zustand stores (`stores/`) for auth, chat, and agent state
- **Routing**: React Router v6 (`routes.tsx`) with `ProtectedRoute` wrapper
- **SSE Streaming**: `lib/sse.ts` — POST-based SSE via fetch + ReadableStream (not EventSource)
- **API Client**: `lib/api.ts` — typed fetch wrapper with JWT auth headers

### MongoDB Collections

`users`, `agents`, `conversations` (messages embedded), `providers`, `collaboration_sessions`

### REST API

All endpoints under `/api/v1`. Auth required on all except register/login. Admin role required for provider/agent management. Streaming endpoints return `text/event-stream`.

## Testing

Backend tests use pytest with mocked MongoDB (via AsyncMock) and mocked Redis. Test fixtures in `tests/conftest.py` provide `client`, `auth_headers`, `admin_headers`, and mock DB/Redis.

```bash
# From backend/
python -m pytest -v
python -m pytest -v -k "test_login"
```
