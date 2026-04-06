# Operational Runbook

Quick reference for common operations. All examples assume the demo stack is running (`make demo`) and you have an admin auth token:

```bash
# Get an admin token (reuse across commands)
TOKEN=$(curl -s http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

Tokens expire after 60 minutes (configurable via `JWT_EXPIRATION_MINUTES`). Re-run the above if you get 401 errors.

---

## Managing LLM Providers

Providers are LLM backends (OpenAI, Anthropic, Ollama, Google). Only admins can manage them.

Supported `provider_type` values: `openai`, `anthropic`, `ollama`, `google`

### Add Ollama (local models, no API key)

```bash
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

The `api_base` uses `host.docker.internal` so the backend container can reach Ollama on the host. If running the backend outside Docker, use `http://localhost:11434`.

### Add OpenAI

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

### Add Anthropic

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

### Add Google Gemini

```bash
curl -s http://localhost:3000/api/v1/providers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "google",
    "display_name": "Google Gemini",
    "provider_type": "google",
    "api_key": "AIza..."
  }'
```

### List providers

```bash
curl -s http://localhost:3000/api/v1/providers \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Test provider connectivity

```bash
curl -s -X POST http://localhost:3000/api/v1/providers/<provider_id>/test \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Returns `{"status": "ok", "model_count": N}` or `{"status": "error", "detail": "..."}`.

### List available models (all providers)

```bash
curl -s http://localhost:3000/api/v1/providers/models/all \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Update a provider (e.g., rotate API key)

```bash
curl -s -X PUT http://localhost:3000/api/v1/providers/<provider_id> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"api_key": "sk-new-key-..."}'
```

### Delete a provider

```bash
curl -s -X DELETE http://localhost:3000/api/v1/providers/<provider_id> \
  -H "Authorization: Bearer $TOKEN"
```

---

## Managing Agents

Agents are AI personas with specific system prompts, model preferences, and specializations. Only admins can create/update/delete agents.

### Create an agent

```bash
curl -s http://localhost:3000/api/v1/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "DevOps Engineer",
    "slug": "devops-engineer",
    "description": "Expert in CI/CD, infrastructure, and deployment.",
    "system_prompt": "You are a senior DevOps engineer. Help users with CI/CD pipelines, container orchestration, infrastructure as code, and deployment strategies. Be practical and security-conscious.",
    "specializations": ["devops", "ci-cd", "kubernetes", "terraform"],
    "preferred_model": "openai/gpt-4o",
    "fallback_models": ["anthropic/claude-sonnet-4-20250514"],
    "temperature": 0.5,
    "max_tokens": 4096,
    "collaboration_capable": true,
    "collaboration_role": "specialist"
  }'
```

Key fields:
- `slug` — URL-safe identifier, must be unique
- `preferred_model` — format is `provider/model_name` (must match a configured provider)
- `collaboration_role` — `"orchestrator"` (delegates) or `"specialist"` (executes)
- `temperature` — 0.0 (deterministic) to 1.0 (creative)

### List agents

```bash
curl -s http://localhost:3000/api/v1/agents \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Update an agent

```bash
curl -s -X PUT http://localhost:3000/api/v1/agents/devops-engineer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"temperature": 0.3, "max_tokens": 8192}'
```

### Deactivate an agent

```bash
curl -s -X DELETE http://localhost:3000/api/v1/agents/devops-engineer \
  -H "Authorization: Bearer $TOKEN"
```

This soft-deletes (sets `is_active: false`). To reactivate:

```bash
curl -s -X PUT http://localhost:3000/api/v1/agents/devops-engineer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"is_active": true}'
```

---

## Managing Users

### Register a new user

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newuser",
    "email": "newuser@example.com",
    "password": "securepassword",
    "display_name": "New User"
  }'
```

### Promote a user to admin

No API endpoint exists for role changes. Use MongoDB directly:

```bash
# Demo stack
docker compose -f docker-compose.demo.yml exec mongodb \
  mongosh kabai --eval 'db.users.updateOne({username:"newuser"},{$set:{role:"admin"}})'

# Dev stack
docker compose exec mongodb \
  mongosh kabai --eval 'db.users.updateOne({username:"newuser"},{$set:{role:"admin"}})'
```

### List all users (MongoDB shell)

```bash
docker compose -f docker-compose.demo.yml exec mongodb \
  mongosh kabai --eval 'db.users.find({},{password_hash:0}).toArray()'
```

---

## Database Operations

### Connect to MongoDB shell

```bash
# Demo stack
docker compose -f docker-compose.demo.yml exec mongodb mongosh kabai

# Dev stack
docker compose exec mongodb mongosh kabai
```

### Useful queries

```javascript
// Count conversations per user
db.conversations.aggregate([
  {$group: {_id: "$user_id", count: {$sum: 1}}},
  {$sort: {count: -1}}
])

// Find conversations with the most messages
db.conversations.aggregate([
  {$project: {title: 1, msg_count: {$size: "$messages"}}},
  {$sort: {msg_count: -1}},
  {$limit: 10}
])

// List all agents
db.agents.find({is_active: true}, {name: 1, slug: 1, preferred_model: 1})

// Check provider configs (API keys are encrypted)
db.providers.find({}, {name: 1, provider_type: 1, api_base: 1, is_enabled: 1})
```

### Backup MongoDB

```bash
docker compose -f docker-compose.demo.yml exec mongodb \
  mongodump --db kabai --archive=/tmp/backup.archive

docker compose -f docker-compose.demo.yml cp mongodb:/tmp/backup.archive ./backup.archive
```

### Restore MongoDB

```bash
docker compose -f docker-compose.demo.yml cp ./backup.archive mongodb:/tmp/backup.archive

docker compose -f docker-compose.demo.yml exec mongodb \
  mongorestore --db kabai --archive=/tmp/backup.archive --drop
```

### Clear Redis cache

```bash
docker compose -f docker-compose.demo.yml exec redis redis-cli FLUSHALL
```

This clears model caches and revoked token lists. Users will need to re-authenticate.

---

## Troubleshooting

### Backend won't start

**Check logs:**
```bash
docker compose -f docker-compose.demo.yml logs backend
```

**Common causes:**
- MongoDB not ready yet — the demo compose uses health checks, but if using dev compose, the backend may start before MongoDB. Restart the backend.
- Invalid `FERNET_KEY` — must be a valid 32-byte URL-safe base64 string. Generate one with `make fernet-key`.
- Missing `.env` file — ensure the env file referenced in your compose file exists.

### "No models available" in frontend

1. Check that at least one provider is configured: `curl -s http://localhost:3000/api/v1/providers -H "Authorization: Bearer $TOKEN"`
2. Test the provider: `curl -s -X POST http://localhost:3000/api/v1/providers/<id>/test -H "Authorization: Bearer $TOKEN"`
3. For Ollama, ensure it's running (`ollama serve`) and has at least one model pulled (`ollama list`)

### Ollama connection refused

The backend container uses `host.docker.internal` to reach the host. Verify:

```bash
# From inside the backend container
docker compose -f docker-compose.demo.yml exec backend \
  python -c "import httpx; print(httpx.get('http://host.docker.internal:11434/api/tags').json())"
```

On Linux, you may need to add to the backend service:
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

### Chat messages return errors

**Check backend logs for the specific error:**
```bash
docker compose -f docker-compose.demo.yml logs backend --tail 50
```

**Common causes:**
- Provider API key is invalid or expired — update via PUT `/api/v1/providers/<id>`
- Model ID doesn't match litellm format — should be `provider/model_name` (e.g., `openai/gpt-4o`)
- Rate limiting from the LLM provider — wait and retry

### Forgot admin password

Reset directly in MongoDB:

```bash
# Generate a new bcrypt hash
docker compose -f docker-compose.demo.yml exec backend \
  python -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('newpassword'))"

# Update the user (replace HASH with the output above)
docker compose -f docker-compose.demo.yml exec mongodb \
  mongosh kabai --eval 'db.users.updateOne({username:"admin"},{$set:{password_hash:"HASH"}})'
```

### Reset everything

```bash
make demo-down   # Stops containers and removes all volumes
make demo        # Rebuild and start fresh
make seed        # Re-seed demo data
```

---

## Roundtable Discussions

### Start a roundtable via API

```bash
# Get agent IDs
curl -s http://localhost:3000/api/v1/agents \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
for a in json.load(sys.stdin):
    print(f'{a[\"id\"]}  {a[\"name\"]}')
"

# Create a roundtable conversation
curl -s http://localhost:3000/api/v1/conversations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "agent_ids": ["AGENT_ID_1", "AGENT_ID_2", "AGENT_ID_3"],
    "collaboration_mode": "roundtable",
    "title": "Architecture Review"
  }'
```

Or use the UI: Dashboard → toggle **Roundtable** → select 2+ agents → **Start Roundtable**. The Dashboard also provides a **Knowledge Bases** page (accessible from the sidebar) for managing knowledge bases, ingesting content, and assigning KBs to agents through the UI.

### Configure roundtable rounds

```bash
curl -s -X PUT http://localhost:3000/api/v1/settings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"roundtable_max_rounds": 5}'
```

Default is 3 rounds. Agents pass when they have nothing to add — majority passing ends discussion early.

---

## Agent Import/Export

### Export agents

```bash
curl -s http://localhost:3000/api/v1/agents/export \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"slugs": ["security-analyst", "devops-engineer"]}' > agents-backup.json
```

### Import agents

```bash
curl -s http://localhost:3000/api/v1/agents/import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @agents-backup.json
```

Skips agents whose slug already exists. The repo includes a default archive at `backend/agents/default-agents.json` with 20 pre-built agents.

### Import default agents via UI

Manage Agents → **Import** → select `backend/agents/default-agents.json`.

---

## Knowledge Base Management

Knowledge bases (KBs) store chunked reference content that agents can search during conversations. All KB management endpoints require admin access except read-only operations (list, get, search, items, batches, sources, ingest-status).

### Creating a knowledge base

```bash
curl -s http://localhost:3000/api/v1/knowledge-bases \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Network Standards",
    "description": "IETF RFCs and networking best practices",
    "ingest_model": "openai/gpt-4o"
  }'
```

Returns `{"id": "KB_ID"}`. The `ingest_model` is optional -- if omitted, the system-wide default ingest model is used (see "Setting default ingest model" below). This model is used to generate titles and summaries during ingestion.

### Ingesting text content

Paste or pipe text directly into a knowledge base:

```bash
curl -s -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "content": "Your text content here. Can be multiple paragraphs, documentation, etc.",
    "source": "internal-docs/architecture.md"
  }'
```

Returns `{"status": "started", "kb_id": "KB_ID"}`. Ingestion runs in the background -- the content is chunked and stored as searchable items. The `source` field is optional but recommended for tracking provenance and enabling bulk deletion later.

### Ingesting from URL

Fetch and ingest content from a URL:

```bash
# Simple single-page fetch
curl -s -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/ingest-url \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "url": "https://example.com/docs/getting-started",
    "deep": false
  }'

# Deep research -- follows links and ingests related pages
curl -s -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/ingest-url \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "url": "https://example.com/docs",
    "deep": true
  }'
```

Set `deep: true` to crawl linked pages from the initial URL. This is useful for documentation sites. The number of URLs followed is bounded by the `ingest_max_urls` setting.

### Ingesting IETF RFCs

RFCs are a common use case. The URL ingest handles plain-text RFC format automatically:

```bash
curl -s -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/ingest-url \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "url": "https://www.rfc-editor.org/rfc/rfc9293.txt",
    "deep": false
  }'
```

The ingested items will have `source` set to the RFC URL. Each ingest creates a batch, so you can see lineage (which items came from which ingest) via the batches endpoint. Subsequent ingests of the same RFC create new batches, letting you roll back if needed.

### Checking ingest status

Ingestion runs asynchronously. Poll for progress:

```bash
curl -s http://localhost:3000/api/v1/knowledge-bases/KB_ID/ingest-status \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Response fields:
- `state` -- `"idle"`, `"running"`, or `"completed"`
- `current_step` -- human-readable progress message
- `items_created` -- number of chunks stored so far
- `urls_processed` -- number of URLs fetched (for URL ingests)
- `error` -- error message if the ingest failed
- `result` -- final summary (only when `state` is `"completed"`)

### Assigning KBs to agents

Attach one or more knowledge bases to an agent so it can search them during conversations:

```bash
curl -s -X PUT http://localhost:3000/api/v1/agents/devops-engineer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"knowledge_base_ids": ["KB_ID_1", "KB_ID_2"]}'
```

The agent will automatically search its assigned KBs for relevant context when answering questions. To remove all KBs, pass an empty list: `{"knowledge_base_ids": []}`.

### Searching within a KB

Run a text search against a specific knowledge base:

```bash
curl -s -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "TCP three-way handshake", "limit": 10}'
```

Returns a list of matching items with `id`, `title`, `content`, `source`, and `chunk_index`. The `limit` parameter defaults to 20.

### Viewing ingest history

List all ingest batches for a knowledge base to see what was ingested and when:

```bash
curl -s http://localhost:3000/api/v1/knowledge-bases/KB_ID/batches \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Each batch includes `id`, `source`, `item_count`, and `created_at`. Use this to audit ingestion lineage or identify a batch for rollback.

### Rolling back a bad ingest

Delete all items from a specific ingest batch:

```bash
curl -s -X DELETE http://localhost:3000/api/v1/knowledge-bases/KB_ID/batches/BATCH_ID \
  -H "Authorization: Bearer $TOKEN"
```

Returns `{"items_deleted": N}`. The KB item count is automatically updated. This is useful when an ingest produced bad chunks or you ingested the wrong content.

### Bulk deleting by source

Delete all items that share a specific `source` value:

```bash
# List sources first to see what's available
curl -s http://localhost:3000/api/v1/knowledge-bases/KB_ID/sources \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Delete all items from a specific source
curl -s -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/delete-by-source \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"source": "https://www.rfc-editor.org/rfc/rfc9293.txt"}'
```

Returns `{"items_deleted": N}`. This is broader than batch rollback -- it removes items across all batches that share the same source.

### Exporting/importing KBs

Export a knowledge base (metadata + all items) to JSON:

```bash
curl -s http://localhost:3000/api/v1/knowledge-bases/KB_ID/export \
  -H "Authorization: Bearer $TOKEN" > kb-backup.json
```

Import a knowledge base from a previously exported JSON file:

```bash
curl -s -X POST http://localhost:3000/api/v1/knowledge-bases/import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @kb-backup.json
```

Returns `{"id": "NEW_KB_ID", "items_created": N}`. This creates a new KB -- it does not merge into an existing one.

Note: Agent import/export (see above) also bundles associated knowledge bases automatically. Use the standalone KB export/import when you want to move a KB independently of any agent.

### Configuring ingest limits

Control how much content a single ingest operation can process:

```bash
curl -s -X PUT http://localhost:3000/api/v1/settings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "ingest_max_items": 500,
    "ingest_max_urls": 50
  }'
```

- `ingest_max_items` -- maximum number of chunks a single ingest can create
- `ingest_max_urls` -- maximum number of URLs to follow during a `deep: true` URL ingest

### Setting default ingest model

Set the system-wide default model used for ingestion (title/summary generation) when a KB does not specify its own `ingest_model`:

```bash
curl -s -X PUT http://localhost:3000/api/v1/settings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"default_ingest_model": "openai/gpt-4o-mini"}'
```

Individual KBs can override this via their `ingest_model` field (set during creation or via PUT on the KB).

### AI Agent Builder

Automatically generate an agent configuration from a natural-language description:

```bash
curl -s -X POST http://localhost:3000/api/v1/agents/build \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "description": "A Kubernetes troubleshooting expert that helps diagnose pod crashes, networking issues, and resource limits. Should be cautious and always suggest checking logs first."
  }'
```

The builder uses an LLM to generate a complete agent definition (name, slug, system prompt, specializations, temperature, etc.) from your description. Review the output and create the agent via `POST /api/v1/agents` or use the UI to refine it further.

---

## Background Chat Processing

### Check if a chat is processing

```bash
curl -s http://localhost:3000/api/v1/conversations/CONV_ID/status \
  -H "Authorization: Bearer $TOKEN"
```

Returns `{"status": "processing"}` or `{"status": "idle"}`.

### Configure max background chats

```bash
curl -s -X PUT http://localhost:3000/api/v1/settings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"max_background_chats": 10}'
```

When the limit is exceeded, the oldest background task is cancelled.

---

## Health Checks

The backend exposes a health endpoint:

```bash
curl http://localhost:3000/api/v1/../health
# or directly if backend port is exposed:
curl http://localhost:8000/health
```

Returns `{"status": "ok"}`.

In the demo compose, health checks are configured for:
- **MongoDB**: `mongosh --eval "db.adminCommand('ping')"` every 5s
- **Redis**: `redis-cli ping` every 5s
- **Backend**: Python urllib to `/health` every 5s (starts after 10s delay)

Services wait for their dependencies to be healthy before starting.
