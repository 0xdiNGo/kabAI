# Tiger Team

Multi-agent AI chat platform. Users select from configured AI agents (or raw models) to chat with. Agents can collaborate via orchestrator or roundtable modes to solve complex problems.

## Quick Start (Demo)

Prerequisites: [Rancher Desktop](https://rancherdesktop.io/) or Docker Desktop.

```bash
# 1. Copy and configure environment
cp .env.docker .env.demo
# Edit .env.demo — add at least one LLM API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)

# 2. Start the stack
make demo

# 3. Seed demo data (in another terminal)
make seed

# 4. Open http://localhost
#    Login: admin / admin123
#    Add an LLM provider, then start chatting.
```

See [docs/deployment.md](docs/deployment.md) for full demo and production deployment instructions.

## Quick Start (Development)

```bash
# Install dependencies
make install

# Start all services (backend + frontend + MongoDB + Redis)
make dev

# Open http://localhost:5173
```

See [docs/development.md](docs/development.md) for the full development guide.

## Tech Stack

| Layer      | Technology                                          |
|------------|-----------------------------------------------------|
| Frontend   | React 18, TypeScript, Vite, Tailwind CSS            |
| Backend    | Python 3.12, FastAPI, litellm                       |
| Database   | MongoDB 7 (Motor async driver)                      |
| Cache      | Redis 7 (sessions, token revocation, model cache)   |
| Auth       | Local username/password, OAuth/OIDC (planned)       |
| LLM Access | litellm — OpenAI, Anthropic, Ollama, Google Gemini  |
| Deployment | Docker Compose (dev/demo), Kubernetes (prod planned)|

## Project Structure

```
tiger-team/
├── backend/
│   ├── app/
│   │   ├── api/v1/          # FastAPI routers (auth, agents, providers, conversations)
│   │   ├── core/            # Database, Redis, security, exceptions
│   │   ├── models/          # Pydantic data models
│   │   ├── repositories/    # MongoDB data access layer
│   │   ├── schemas/         # Request/response DTOs
│   │   ├── services/        # Business logic
│   │   │   └── orchestration/  # Multi-agent collaboration (planned)
│   │   ├── config.py        # Environment-based settings
│   │   ├── dependencies.py  # FastAPI dependency injection wiring
│   │   └── main.py          # App entry point
│   ├── scripts/
│   │   └── seed_demo.py     # Demo data seeding
│   └── tests/               # pytest test suite
├── frontend/
│   ├── src/
│   │   ├── pages/           # LoginPage, DashboardPage, ChatPage
│   │   ├── stores/          # Zustand state management
│   │   ├── lib/             # API client, SSE streaming, utilities
│   │   └── types/           # TypeScript type definitions
│   └── nginx.conf           # Production reverse proxy config
├── docker-compose.yml       # Development stack
├── docker-compose.demo.yml  # Demo/production-like stack
├── .env.example             # Environment variable template
├── .env.docker              # Pre-configured for Docker networking
├── Makefile                 # Common commands
└── docs/                    # Documentation
    ├── development.md       # Development setup guide
    ├── deployment.md        # Demo and production deployment
    ├── runbook.md           # Operational runbook
    └── api.md               # API reference
```

## Documentation

- [Development Guide](docs/development.md) — Local setup, testing, linting
- [Deployment Guide](docs/deployment.md) — Demo on Rancher Desktop, production considerations
- [Operational Runbook](docs/runbook.md) — Adding providers, managing agents, troubleshooting
- [API Reference](docs/api.md) — All REST endpoints with examples

## Architecture

Three-layer backend: **Routers** (HTTP) → **Services** (business logic) → **Repositories** (data access). FastAPI dependency injection wires everything together.

LLM calls go through [litellm](https://github.com/BerriAI/litellm), which provides a unified interface to OpenAI, Anthropic, Ollama, Google, and 100+ other providers. Model IDs use the `provider/model_name` format (e.g., `openai/gpt-4o`, `ollama/llama3`).

See [CLAUDE.md](CLAUDE.md) for detailed architecture notes.

## License

Proprietary. All rights reserved.
