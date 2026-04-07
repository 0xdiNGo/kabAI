# kabAI

**kabAI** */kah-BYE/* — from *kabbalah* (קַבָּלָה): the received wisdom. **AI that receives, reasons, and reveals.** A self-hosted agent orchestration platform for building agents that think together. Configure agents with distinct expertise and personalities, ground them in knowledge bases with hybrid vector+keyword retrieval, and run structured roundtable discussions where multiple agents debate, critique, and synthesize until they reach consensus. Solo chat when you need a quick answer. Roundtable when you need the right one.

Built on FastAPI, React, and MongoDB with support for any LLM provider through litellm — Ollama, OpenAI, Anthropic, Google. Hybrid retrieval combines Qdrant vector search with MongoDB keyword search for knowledge bases that scale to millions of items. Persistent background processing handles large-scale ingestion with crash recovery. LoRA adapters, web search via tool use, exemplar sets for few-shot reasoning, and HuggingFace integration for pulling datasets and adapters. Runs entirely on your infrastructure — Docker Compose brings up the full stack in one command, every API key is Fernet-encrypted at rest, and no data leaves your network unless you configure an external provider.

## Features

- Multi-agent roundtable discussions with configurable rounds and consensus detection
- 6 collaboration roles: orchestrator, specialist, critic, synthesizer, researcher, devil's advocate
- Knowledge bases with hybrid vector+keyword retrieval (Qdrant + MongoDB)
- Ingestion from text, URLs, files, IETF RFCs, and HuggingFace datasets
- Deep research mode — follows related links from ingested pages
- RFC-aware ingestion with full lineage tracking and AI change analysis
- Configurable embedding model for semantic search
- AI Agent Builder — generate full agent profiles from a free-text description
- LoRA adapter registration for Ollama models
- Web search via LLM tool use �� Kagi, Google, Bing, Brave, DuckDuckGo, SearXNG
- HuggingFace integration — intelligent repo router, dataset import, adapter registration
- Exemplar sets for few-shot prompting (HuggingFace dataset import)
- Background chat processing — LLM calls continue when you navigate away
- Persistent ingest queue with crash recovery
- Markdown rendering with syntax-highlighted code blocks
- Global toast notifications for error visibility
- Agent import/export archives
- Gruvbox dark theme
- All API keys Fernet-encrypted at rest

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

See [docs/deployment.md](docs/deployment.md) for full deployment instructions.

## Quick Start (Development)

```bash
# Install dependencies
make install

# Start all services (backend + frontend + MongoDB + Redis + Qdrant)
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
| Vector DB  | Qdrant (hybrid semantic+keyword retrieval)          |
| Cache      | Redis 7 (sessions, token revocation, model cache)   |
| Auth       | Local username/password (OAuth/OIDC planned)        |
| LLM Access | litellm — OpenAI, Anthropic, Ollama, Google Gemini  |
| Deployment | Docker Compose (dev/demo)                           |

## Project Structure

```
kabai/
├── backend/
│   ├── app/
│   │   ├── api/v1/            # Routers: auth, agents, providers, conversations, settings, knowledge, huggingface
│   │   ├── core/              # Database, Redis, Qdrant, security, exceptions
│   │   ├── models/            # Pydantic data models
│   │   ├── repositories/      # MongoDB data access layer
│   │   ├── schemas/           # Request/response DTOs
│   │   ├── services/          # Business logic
│   │   │   ├── orchestration/ # Roundtable multi-agent collaboration
│   │   │   ├── llm_service.py         # LLM calls + model resolution
│   │   │   ├── vector_service.py      # Qdrant embeddings + vector search
│   │   │   ├── knowledge_service.py   # Knowledge base CRUD + hybrid retrieval
│   │   │   ├── huggingface_service.py # HuggingFace API client
│   │   │   ├── ingest_worker.py       # Persistent background ingest processor
│   │   │   └── ...
│   │   ├── config.py          # Environment-based settings
│   │   ├── dependencies.py    # FastAPI dependency injection wiring
│   │   └── main.py            # App entry point
│   ├── agents/
│   │   └── default-agents.json  # 20 default agent profiles
│   └── tests/                 # pytest test suite
├── frontend/
│   ├── src/
│   │   ├── pages/             # Login, Dashboard, Chat, Agents, Providers, KnowledgeBase, SearchProviders, ExemplarSets
│   │   ├── components/        # MarkdownContent, HFImportRouter, Toast, Tooltip
│   │   ├── stores/            # Zustand state management
│   │   ├── lib/               # API client, SSE streaming
│   │   └── types/             # TypeScript type definitions
│   └── nginx.conf             # Production reverse proxy config
├── docker-compose.yml         # Development stack
├── docker-compose.demo.yml    # Demo stack (nginx frontend, port 3000)
├── .env.example               # Environment variable template
├── Makefile                   # Common commands
└── docs/
    ├── development.md         # Development setup guide
    ├── deployment.md          # Deployment guide
    ├── runbook.md             # Operational runbook
    ├── api.md                 # API reference
    └── knowledge-ingestion.md # Ingestion architecture + diagrams
```

## Documentation

- [Development Guide](docs/development.md) — Local setup, testing, linting
- [Deployment Guide](docs/deployment.md) — Demo and production deployment
- [Operational Runbook](docs/runbook.md) — Adding providers, managing agents, troubleshooting
- [API Reference](docs/api.md) — All REST endpoints with examples
- [Knowledge Ingestion](docs/knowledge-ingestion.md) — Ingestion architecture, RFC handling, deep research mode

## Architecture

Three-layer backend: **Routers** (HTTP) → **Services** (business logic) → **Repositories** (data access). FastAPI dependency injection wires everything together.

LLM calls go through [litellm](https://github.com/BerriAI/litellm), providing a unified interface to OpenAI, Anthropic, Ollama, Google, and 100+ other providers. Model IDs use the `provider/model_name` format (e.g., `openai/gpt-4o`, `ollama/llama3`).

Knowledge retrieval uses hybrid search — Qdrant vector similarity for semantic matches combined with MongoDB text search for keyword matches, merged with weighted score fusion.

Background chat processing via `BackgroundTaskManager` decouples LLM streaming from client connections — chats continue when users navigate away and reconnect seamlessly on return.

## License

MIT
