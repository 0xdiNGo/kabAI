# Tiger Team

Multi-agent AI chat platform. Users select from configured AI agents (or raw models) to chat with. Agents collaborate via multi-round roundtable discussions to solve complex problems — each agent brings a unique perspective and role, and the group works toward consensus.

## Features

- Multi-agent roundtable discussions with configurable rounds and consensus detection
- 6 collaboration roles: orchestrator, specialist, critic, synthesizer, researcher, devil's advocate
- Knowledge bases with ingestion from text, URLs, files, and IETF RFCs
- Deep research mode — follows related links from ingested pages to pull in connected content
- Ingest version control and rollback via tracked ingest batches
- AI Agent Builder — generate full agent profiles from a free-text description
- Background chat processing — LLM calls continue even when you navigate away
- Agent import/export archives for sharing agent profiles
- Bulk model assignment across multiple agents
- System default model with automatic fallback chain
- Real-time SSE streaming with thinking indicators
- Admin UI for managing agents, providers, and system settings
- Gruvbox dark theme

## Quick Start (Demo)

Prerequisites: [Rancher Desktop](https://rancherdesktop.io/) or Docker Desktop.

```bash
# 1. Edit .env.docker — set OLLAMA_API_BASE to your Ollama server, or add API keys
#    (defaults to host.docker.internal:11434 for local Ollama)

# 2. Start the stack
make demo

# 3. Seed demo data (in another terminal)
make seed

# 4. Open http://localhost:3000
#    Login: admin / admin123
#    Add an LLM provider via Manage Providers, then start chatting.
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
| Frontend   | React 18, TypeScript, Vite, Tailwind CSS (gruvbox)  |
| Backend    | Python 3.12, FastAPI, litellm                       |
| Database   | MongoDB 7 (Motor async driver)                      |
| Cache      | Redis 7 (sessions, token revocation, model cache)   |
| Auth       | Local username/password (OAuth/OIDC planned)        |
| LLM Access | litellm — OpenAI, Anthropic, Ollama, Google Gemini  |
| Deployment | Docker Compose (dev/demo)                           |

## Project Structure

```
tiger-team/
├── backend/
│   ├── app/
│   │   ├── api/v1/            # Routers: auth, agents, providers, conversations, settings, knowledge
│   │   ├── core/              # Database, Redis, security, exceptions
│   │   ├── models/            # Pydantic data models
│   │   ├── repositories/      # MongoDB data access layer
│   │   ├── schemas/           # Request/response DTOs
│   │   ├── services/          # Business logic
│   │   │   ├── orchestration/ # Roundtable multi-agent collaboration
│   │   │   ├── background_manager.py  # Persistent background chat tasks
│   │   │   ├── llm_service.py         # LLM calls + model resolution
│   │   │   ├── knowledge_service.py   # Knowledge base CRUD + ingestion logic
│   │   │   ├── rfc_ingestor.py        # IETF RFC ingestion + lineage mapping
│   │   │   ├── ingest_manager.py      # Background ingest tasks + status polling
│   │   │   └── ...
│   │   ├── config.py          # Environment-based settings
│   │   ├── dependencies.py    # FastAPI dependency injection wiring
│   │   └── main.py            # App entry point + BackgroundTaskManager init
│   ├── agents/
│   │   └── default-agents.json  # 20 default agent profiles (importable archive)
│   ├── scripts/
│   │   └── seed_demo.py       # Demo data seeding
│   └── tests/                 # pytest test suite
├── frontend/
│   ├── src/
│   │   ├── pages/             # Login, Dashboard, Chat, Agents, Providers, KnowledgeBasePage
│   │   ├── stores/            # Zustand state management
│   │   ├── lib/               # API client, SSE streaming, utilities
│   │   └── types/             # TypeScript type definitions
│   └── nginx.conf             # Production reverse proxy config
├── docker-compose.yml         # Development stack
├── docker-compose.demo.yml    # Demo stack (nginx frontend, port 3000)
├── .env.example               # Environment variable template
├── .env.docker                # Pre-configured for Docker networking
├── Makefile                   # Common commands
└── docs/
    ├── development.md         # Development setup guide
    ├── deployment.md          # Demo and production deployment
    ├── runbook.md             # Operational runbook
    ├── api.md                 # API reference
    └── knowledge-ingestion.md # Knowledge ingestion architecture + diagrams
```

## Documentation

- [Development Guide](docs/development.md) — Local setup, testing, linting
- [Deployment Guide](docs/deployment.md) — Demo on Rancher Desktop, production considerations
- [Operational Runbook](docs/runbook.md) — Adding providers, managing agents, troubleshooting
- [API Reference](docs/api.md) — All REST endpoints with examples
- [Knowledge Ingestion](docs/knowledge-ingestion.md) — Ingestion architecture, RFC handling, deep research mode
- [CLAUDE.md](CLAUDE.md) — Detailed architecture notes for Claude Code

## Architecture

Three-layer backend: **Routers** (HTTP) → **Services** (business logic) → **Repositories** (data access). FastAPI dependency injection wires everything together.

LLM calls go through [litellm](https://github.com/BerriAI/litellm), which provides a unified interface to OpenAI, Anthropic, Ollama, Google, and 100+ other providers. Model IDs use the `provider/model_name` format (e.g., `openai/gpt-4o`, `ollama/llama3`).

Background chat processing via `BackgroundTaskManager` decouples LLM streaming from client connections — chats continue processing when users navigate away and reconnect seamlessly on return.

## License

Proprietary. All rights reserved.
