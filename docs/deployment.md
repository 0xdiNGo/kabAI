# Deployment Guide

## Demo on Rancher Desktop

This runs a production-like stack locally: nginx serving the built frontend, FastAPI backend without hot reload, MongoDB, Redis, and Qdrant — all with health checks and proper startup ordering.

### Prerequisites

- [Rancher Desktop](https://rancherdesktop.io/) (or Docker Desktop)
- Port 80 available on localhost
- At least one LLM provider (API key or local Ollama)

### Step-by-Step

#### 1. Configure environment

The repo includes `.env.docker` pre-configured for Docker networking. Copy it and add your API keys:

```bash
cp .env.docker .env.demo
```

Edit `.env.demo` and add at least one LLM provider key:

```bash
# For OpenAI
OPENAI_API_KEY=sk-...

# For Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# For local Ollama (already configured — just ensure Ollama is running)
OLLAMA_API_BASE=http://host.docker.internal:11434
```

If you only want Ollama, no API keys are needed — Ollama is configured by default.

Then update `docker-compose.demo.yml` to use your env file:

```yaml
# In docker-compose.demo.yml, change env_file on backend and seed services:
env_file: .env.demo
```

Or just edit `.env.docker` directly (it's committed with placeholder values only).

#### 2. Generate a Fernet key (optional)

`.env.docker` ships with a demo Fernet key. For a real demo with provider API keys stored in the database, generate a fresh one:

```bash
make fernet-key
# Copy the output into FERNET_KEY= in your env file
```

#### 3. Start the stack

```bash
make demo
```

This builds both Docker images and starts all services (frontend, backend, MongoDB, Redis, Qdrant). Wait for health checks to pass. The frontend is ready when you see nginx startup messages.

### Demo Stack Architecture

```mermaid
graph TD
    Browser -->|:3000| Nginx[nginx / Frontend]
    Nginx -->|proxy /api| Backend[FastAPI Backend]
    Backend --> MongoDB[(MongoDB)]
    Backend --> Redis[(Redis)]
    Backend --> Qdrant[(Qdrant)]
    Backend -->|litellm| Ollama[Ollama Host]
    Backend -->|litellm| Cloud[Cloud LLM APIs]
```

#### 4. Seed demo data

In a separate terminal:

```bash
make seed
```

This creates:
- **admin** user (password: `admin123`) with admin role
- **demo** user (password: `demo123`) with regular role
- Three AI agents: Code Architect, Research Analyst, Team Lead

The seed script is idempotent — safe to run multiple times.

#### 5. Access the app

Open http://localhost:3000 and log in with `admin` / `admin123`.

#### 6. Add an LLM provider

Before you can chat, the app needs at least one configured LLM provider. You can do this via the API:

**Ollama (local, no API key needed):**

```bash
# Get an auth token
TOKEN=$(curl -s http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Add Ollama provider
curl -s http://localhost:3000/api/v1/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "ollama",
    "display_name": "Ollama (Local)",
    "provider_type": "ollama",
    "api_base": "http://host.docker.internal:11434"
  }'
```

**OpenAI:**

```bash
curl -s http://localhost:3000/api/v1/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "openai",
    "display_name": "OpenAI",
    "provider_type": "openai",
    "api_key": "sk-..."
  }'
```

**Anthropic:**

```bash
curl -s http://localhost:3000/api/v1/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "anthropic",
    "display_name": "Anthropic",
    "provider_type": "anthropic",
    "api_key": "sk-ant-..."
  }'
```

#### 7. Verify models are available

```bash
curl -s http://localhost:3000/api/v1/providers/models/all \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

#### 8. Tear down

```bash
make demo-down
```

This stops all containers and removes volumes (including MongoDB data).

### Troubleshooting Demo

**Frontend shows blank page or 502:**
Backend may still be starting. Check `docker compose -f docker-compose.demo.yml logs backend` for health check status.

**"Connection refused" on Ollama:**
Ensure Ollama is running on your host machine (`ollama serve`). On macOS with Rancher Desktop, `host.docker.internal` should resolve automatically. On Linux, add this to the backend service in `docker-compose.demo.yml`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

**"Provider not found" errors:**
Providers must be created after each `make demo-down` since volumes are removed. Re-run the provider creation curl commands above.

**Models not appearing:**
Test provider connectivity:

```bash
curl -s http://localhost:3000/api/v1/providers/<provider_id>/test \
  -H "Authorization: Bearer $TOKEN" -X POST
```

---

## Production Deployment Considerations

The demo stack is close to production-ready but has these gaps:

### Security

- Change `JWT_SECRET` to a cryptographically random value (`openssl rand -hex 64`)
- Generate a new `FERNET_KEY` (`make fernet-key`)
- Remove or change the demo user passwords
- Enable HTTPS (terminate TLS at an ingress controller or load balancer)
- Restrict `CORS_ORIGINS` to your actual domain
- Add rate limiting middleware (not yet implemented)

### Database

- Run MongoDB as a replica set for durability (single-node demo has no replication)
- Enable MongoDB authentication (`MONGODB_URL=mongodb://user:pass@host:27017/kabai?authSource=admin`)
- Set up automated backups for MongoDB and Qdrant
- Add Redis persistence configuration or use a managed Redis

### Vector Database (Qdrant)

- Qdrant stores embedding vectors for semantic search — data volume should be persistent
- For large deployments (10M+ vectors), consider Qdrant's distributed mode or managed Qdrant Cloud
- Back up Qdrant snapshots: `POST http://qdrant:6333/collections/knowledge_vectors/snapshots`
- Monitor via Qdrant dashboard at port 6333 (don't expose externally in production)
- If Qdrant is unavailable, the system gracefully falls back to keyword-only search

### Networking

- Don't expose MongoDB (27017), Redis (6379), or Qdrant (6333) ports externally — the demo compose intentionally doesn't for Mongo/Redis
- Use a reverse proxy or ingress controller for TLS termination
- Configure proper DNS

### Monitoring

- Add health check endpoints for all services (backend `/health` exists)
- Set up log aggregation (no structured logging yet)
- Add metrics (Prometheus, Grafana)

### Kubernetes

The project is designed for eventual Kubernetes deployment but K8s manifests don't exist yet. When creating them:

- Backend: Deployment + Service + ConfigMap + Secret
- Frontend: Deployment + Service (or serve from CDN)
- MongoDB: StatefulSet with PVC (or use a managed service like Atlas)
- Redis: Deployment with PVC (or use managed ElastiCache/Memorystore)
- Qdrant: StatefulSet with PVC (or use Qdrant Cloud)
- Ingress: nginx-ingress or equivalent for TLS + routing
- Use Kustomize overlays for dev/staging/prod environment differences
