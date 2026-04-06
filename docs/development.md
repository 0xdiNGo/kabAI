# Development Guide

## Prerequisites

- Python 3.12+
- Node.js 20+
- Docker and Docker Compose (for MongoDB and Redis, or run them natively)
- Make

## Initial Setup

### 1. Clone and install dependencies

```bash
git clone <repo-url> kabai
cd kabai
make install
```

This runs:
- `pip install -e ".[dev]"` in `backend/`
- `npm install` in `frontend/`

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:
- `JWT_SECRET` — any random string (e.g., `openssl rand -hex 32`)
- `FERNET_KEY` — run `make fernet-key` to generate one

For LLM functionality, add at least one provider key:
- `OPENAI_API_KEY` for OpenAI models
- `ANTHROPIC_API_KEY` for Claude models
- `OLLAMA_API_BASE` defaults to `http://localhost:11434` if you have Ollama running locally

### 3. Start services

**Full stack via Docker Compose** (recommended for first run):

```bash
make dev
```

This starts the backend (port 8000), frontend (port 5173), MongoDB (27017), and Redis (6379) with hot reload enabled.

Open http://localhost:5173

**Backend only** (requires MongoDB and Redis running separately):

```bash
make dev-backend
```

**Frontend only**:

```bash
make dev-frontend
```

### 4. Create your first user

Register via the UI at http://localhost:5173, or via curl:

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@example.com","password":"admin123","display_name":"Admin"}'
```

Note: The first user does not automatically get admin role. To promote a user to admin, update MongoDB directly:

```bash
docker compose exec mongodb mongosh kabai \
  --eval 'db.users.updateOne({username:"admin"},{$set:{role:"admin"}})'
```

Or use `make seed` with the demo compose to get pre-configured admin/demo users.

## Running Tests

```bash
# Run all backend tests
make test

# Run a specific test by keyword
make test-one TEST="test_login"

# Run with verbose pytest output
cd backend && python -m pytest -v

# Run a specific test file
cd backend && python -m pytest tests/test_auth.py -v
```

Tests use mocked MongoDB (via `mongomock-motor`) and mocked Redis (`AsyncMock`). No running database needed.

Test fixtures are defined in `backend/tests/conftest.py` and provide:
- `client` — FastAPI `TestClient` with mocked dependencies
- `auth_headers` — Authorization headers for a regular user
- `admin_headers` — Authorization headers for an admin user
- `mock_db` / `mock_redis` — Mock database and cache instances

## Linting and Formatting

```bash
# Check for lint errors
make lint

# Auto-format code
make format
```

Uses [Ruff](https://docs.astral.sh/ruff/) configured for Python 3.12, 100-character line length.

## Project Conventions

### Backend

- **Routers** handle HTTP only — parsing requests, returning responses, status codes
- **Services** contain business logic — never import FastAPI request/response types
- **Repositories** handle data access — one repo per MongoDB collection
- **Dependencies** (`dependencies.py`) wire repos → services → routers via FastAPI `Depends`
- Model IDs use `provider/model_name` format (e.g., `openai/gpt-4o`, `ollama/llama3`)
- All database operations are async (Motor driver)

### Frontend

- Pages in `src/pages/`, one per route
- Zustand stores in `src/stores/` for global state
- API calls through `src/lib/api.ts` (typed fetch wrapper)
- SSE streaming through `src/lib/sse.ts` (POST-based, not EventSource)
- Types in `src/types/`

### Environment Variables

All backend config is in `backend/app/config.py` via `pydantic-settings`. Variables are read from `.env` automatically. See `.env.example` for the full list.

## Docker Development

The dev `docker-compose.yml` mounts source directories as volumes for hot reload:
- `./backend/app` → `/app/app` (uvicorn `--reload`)
- `./frontend/src` → `/app/src` (Vite HMR)

MongoDB data persists in a Docker volume (`mongo_data`). To reset:

```bash
docker compose down -v
docker compose up --build
```

## Makefile Reference

| Command              | Description                          |
|----------------------|--------------------------------------|
| `make dev`           | Start full stack (Docker Compose)    |
| `make dev-backend`   | Start backend only (needs DB/Redis)  |
| `make dev-frontend`  | Start frontend only                  |
| `make install`       | Install all dependencies             |
| `make test`          | Run all backend tests                |
| `make test-one TEST="name"` | Run test matching keyword    |
| `make lint`          | Lint backend code                    |
| `make format`        | Auto-format backend code             |
| `make build`         | Build Docker images                  |
| `make demo`          | Start demo stack (production-like)   |
| `make seed`          | Seed demo data into MongoDB          |
| `make demo-down`     | Tear down demo stack and volumes     |
| `make fernet-key`    | Generate a Fernet encryption key     |
