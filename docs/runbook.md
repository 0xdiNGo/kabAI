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
  mongosh tiger_team --eval 'db.users.updateOne({username:"newuser"},{$set:{role:"admin"}})'

# Dev stack
docker compose exec mongodb \
  mongosh tiger_team --eval 'db.users.updateOne({username:"newuser"},{$set:{role:"admin"}})'
```

### List all users (MongoDB shell)

```bash
docker compose -f docker-compose.demo.yml exec mongodb \
  mongosh tiger_team --eval 'db.users.find({},{password_hash:0}).toArray()'
```

---

## Database Operations

### Connect to MongoDB shell

```bash
# Demo stack
docker compose -f docker-compose.demo.yml exec mongodb mongosh tiger_team

# Dev stack
docker compose exec mongodb mongosh tiger_team
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
  mongodump --db tiger_team --archive=/tmp/backup.archive

docker compose -f docker-compose.demo.yml cp mongodb:/tmp/backup.archive ./backup.archive
```

### Restore MongoDB

```bash
docker compose -f docker-compose.demo.yml cp ./backup.archive mongodb:/tmp/backup.archive

docker compose -f docker-compose.demo.yml exec mongodb \
  mongorestore --db tiger_team --archive=/tmp/backup.archive --drop
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
  mongosh tiger_team --eval 'db.users.updateOne({username:"admin"},{$set:{password_hash:"HASH"}})'
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

Or use the UI: Dashboard → toggle **Roundtable** → select 2+ agents → **Start Roundtable**.

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
