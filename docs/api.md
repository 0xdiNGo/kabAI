# API Reference

Base URL: `/api/v1`

All endpoints except register and login require a Bearer token in the `Authorization` header.

Admin endpoints require a user with `role: "admin"`.

---

## Authentication

### POST /auth/register

Create a new user account.

**Auth required:** No

**Request:**
```json
{
  "username": "jdoe",
  "email": "jdoe@example.com",
  "password": "securepassword",
  "display_name": "Jane Doe"
}
```

| Field          | Type   | Required | Notes                    |
|----------------|--------|----------|--------------------------|
| `username`     | string | yes      | Must be unique           |
| `email`        | string | yes      | Must be valid email      |
| `password`     | string | yes      |                          |
| `display_name` | string | no       | Defaults to username     |

**Response (201):**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "message": "User registered successfully"
}
```

**Errors:** 409 if username or email already exists.

---

### POST /auth/login

Authenticate and receive JWT tokens.

**Auth required:** No

**Request:**
```json
{
  "username": "jdoe",
  "password": "securepassword"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbG...",
  "refresh_token": "eyJhbG...",
  "token_type": "bearer"
}
```

**Errors:** 401 if credentials are invalid.

**Notes:**
- Access token expires after `JWT_EXPIRATION_MINUTES` (default: 60)
- Refresh token expires after `JWT_REFRESH_EXPIRATION_DAYS` (default: 7)

---

### POST /auth/refresh

Exchange a refresh token for new access + refresh tokens.

**Auth required:** No (uses refresh token in body)

**Request:**
```json
{
  "refresh_token": "eyJhbG..."
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbG...",
  "refresh_token": "eyJhbG...",
  "token_type": "bearer"
}
```

**Notes:** The old refresh token is revoked in Redis after use.

---

### GET /auth/me

Get the current authenticated user's profile.

**Auth required:** Yes

**Response (200):**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "username": "jdoe",
  "email": "jdoe@example.com",
  "display_name": "Jane Doe",
  "role": "user",
  "auth_provider": "local"
}
```

---

## Agents

### GET /agents

List all active agents.

**Auth required:** Yes

**Response (200):**
```json
[
  {
    "id": "507f1f77bcf86cd799439011",
    "name": "Code Architect",
    "slug": "code-architect",
    "description": "Expert in software design patterns...",
    "avatar_url": null,
    "specializations": ["architecture", "code-review"],
    "preferred_model": "openai/gpt-4o",
    "collaboration_capable": true,
    "collaboration_role": "specialist",
    "is_active": true
  }
]
```

---

### GET /agents/{slug}

Get a single agent by slug.

**Auth required:** Yes

**Response (200):** Same shape as list item above.

**Errors:** 404 if slug not found.

---

### POST /agents

Create a new agent.

**Auth required:** Admin

**Request:**
```json
{
  "name": "DevOps Engineer",
  "slug": "devops-engineer",
  "description": "Expert in CI/CD and infrastructure.",
  "system_prompt": "You are a senior DevOps engineer...",
  "specializations": ["devops", "ci-cd", "kubernetes"],
  "preferred_model": "openai/gpt-4o",
  "fallback_models": ["anthropic/claude-sonnet-4-20250514"],
  "temperature": 0.5,
  "max_tokens": 4096,
  "collaboration_capable": true,
  "collaboration_role": "specialist"
}
```

| Field                   | Type     | Required | Default | Notes                              |
|-------------------------|----------|----------|---------|------------------------------------|
| `name`                  | string   | yes      |         | Display name                       |
| `slug`                  | string   | yes      |         | URL-safe, unique                   |
| `description`           | string   | yes      |         |                                    |
| `system_prompt`         | string   | yes      |         | Sent as system message to LLM      |
| `avatar_url`            | string   | no       | null    |                                    |
| `specializations`       | string[] | no       | []      | Tags for categorization            |
| `preferred_model`       | string   | yes      |         | Format: `provider/model_name`      |
| `fallback_models`       | string[] | no       | []      | Tried in order if preferred fails  |
| `temperature`           | float    | no       | 0.7     | 0.0 to 1.0                        |
| `max_tokens`            | int      | no       | 4096    |                                    |
| `collaboration_capable` | bool     | no       | false   |                                    |
| `collaboration_role`    | string   | no       | null    | `"orchestrator"` or `"specialist"` |

**Response (201):**
```json
{ "id": "507f1f77bcf86cd799439011" }
```

**Errors:** 409 if slug already exists.

---

### PUT /agents/{slug}

Update an agent. Only include fields you want to change.

**Auth required:** Admin

**Request:**
```json
{
  "temperature": 0.3,
  "max_tokens": 8192
}
```

All fields from AgentCreate are accepted (except `slug`), all optional.

**Response (200):**
```json
{ "message": "Agent updated" }
```

---

### DELETE /agents/{slug}

Soft-delete (deactivate) an agent. Sets `is_active: false`.

**Auth required:** Admin

**Response (200):**
```json
{ "message": "Agent deactivated" }
```

---

### PUT /agents/bulk-model

Bulk-update the preferred model for multiple agents.

**Auth required:** Admin

**Request:**
```json
{
  "agent_slugs": ["security-analyst", "devops-engineer", "frontend-lead"],
  "preferred_model": "ollama/llama3"
}
```

Set `preferred_model` to `null` to clear (agents will use system default).

**Response (200):**
```json
{ "message": "Updated 3 agents" }
```

---

### POST /agents/export

Export selected agents as a JSON archive.

**Auth required:** Admin

**Request:**
```json
{ "slugs": ["security-analyst", "devops-engineer"] }
```

**Response (200):**
```json
{
  "version": 1,
  "agents": [
    {
      "name": "Security Analyst",
      "slug": "security-analyst",
      "description": "...",
      "system_prompt": "...",
      "specializations": ["appsec", "threat-modeling"],
      "preferred_model": null,
      "fallback_models": [],
      "temperature": 0.4,
      "max_tokens": 4096,
      "collaboration_capable": true,
      "collaboration_role": "critic"
    }
  ]
}
```

---

### POST /agents/import

Import agents from a JSON archive. Skips agents whose slug already exists.

**Auth required:** Admin

**Request:** Same format as export response (the archive JSON).

**Response (200):**
```json
{
  "created": 3,
  "skipped": 1,
  "skipped_slugs": ["security-analyst"]
}
```

---

## Providers

### GET /providers

List all LLM providers.

**Auth required:** Yes

**Response (200):**
```json
[
  {
    "id": "507f1f77bcf86cd799439011",
    "name": "openai",
    "display_name": "OpenAI",
    "provider_type": "openai",
    "api_base": null,
    "has_api_key": true,
    "is_enabled": true
  }
]
```

**Notes:** `has_api_key` indicates whether a key is stored (never exposes the actual key).

---

### POST /providers

Add a new LLM provider.

**Auth required:** Admin

**Request:**
```json
{
  "name": "ollama",
  "display_name": "Ollama (Local)",
  "provider_type": "ollama",
  "api_base": "http://host.docker.internal:11434",
  "api_key": null,
  "is_enabled": true
}
```

| Field           | Type   | Required | Default | Notes                                      |
|-----------------|--------|----------|---------|--------------------------------------------|
| `name`          | string | yes      |         | Unique identifier                          |
| `display_name`  | string | yes      |         | Shown in UI                                |
| `provider_type` | string | yes      |         | `openai`, `anthropic`, `ollama`, `google`  |
| `api_base`      | string | no       | null    | Custom API URL (required for Ollama)       |
| `api_key`       | string | no       | null    | Encrypted at rest with Fernet              |
| `is_enabled`    | bool   | no       | true    |                                            |

**Response (201):**
```json
{ "id": "507f1f77bcf86cd799439011" }
```

**Errors:** 409 if name already exists.

---

### PUT /providers/{provider_id}

Update a provider. Only include fields you want to change.

**Auth required:** Admin

**Request:**
```json
{
  "api_key": "sk-new-key-...",
  "is_enabled": true
}
```

**Response (200):**
```json
{ "message": "Provider updated" }
```

---

### DELETE /providers/{provider_id}

Delete a provider.

**Auth required:** Admin

**Response (200):**
```json
{ "message": "Provider deleted" }
```

---

### GET /providers/{provider_id}/models

List models available from a specific provider.

**Auth required:** Yes

**Response (200):**
```json
[
  {
    "id": "openai/gpt-4o",
    "name": "gpt-4o",
    "provider": "openai",
    "provider_display_name": "OpenAI"
  }
]
```

**Notes:**
- Results are cached in Redis for 5 minutes
- For Ollama, queries the `/api/tags` endpoint
- For OpenAI, queries `/v1/models`
- For Anthropic and Google, returns a hardcoded list of known models

---

### GET /providers/models/all

List models from all enabled providers.

**Auth required:** Yes

**Response (200):** Same shape as above, aggregated across providers. Providers that fail to respond are silently skipped.

---

### POST /providers/{provider_id}/test

Test connectivity to a provider.

**Auth required:** Admin

**Response (200):**
```json
{ "status": "ok", "model_count": 12 }
```

Or on failure:
```json
{ "status": "error", "detail": "Connection refused" }
```

---

## Conversations

### GET /conversations

List the current user's conversations.

**Auth required:** Yes

**Query parameters:**

| Param    | Type | Default | Notes           |
|----------|------|---------|-----------------|
| `limit`  | int  | 50      | Max results     |
| `offset` | int  | 0       | Pagination skip |

**Response (200):**
```json
[
  {
    "id": "507f1f77bcf86cd799439011",
    "title": "Help with Docker setup",
    "agent_id": "507f1f77bcf86cd799439012",
    "model": "openai/gpt-4o",
    "message_count": 5,
    "created_at": "2026-04-04T10:00:00Z",
    "updated_at": "2026-04-04T10:05:00Z"
  }
]
```

---

### POST /conversations

Create a new conversation. Provide either `agent_id` (agent-based chat) or `model` (direct model chat).

**Auth required:** Yes

**Request (agent-based):**
```json
{
  "agent_id": "507f1f77bcf86cd799439012",
  "title": "Architecture review"
}
```

**Request (direct model):**
```json
{
  "model": "openai/gpt-4o",
  "title": "Quick question"
}
```

| Field      | Type   | Required | Notes                               |
|------------|--------|----------|-------------------------------------|
| `agent_id` | string | no       | Use agent's model and system prompt |
| `model`    | string | no       | Required if `agent_id` is null      |
| `title`    | string | no       | Auto-generated if omitted           |

**Response (201):**
```json
{ "id": "507f1f77bcf86cd799439011" }
```

---

### GET /conversations/{conversation_id}

Get a conversation with full message history.

**Auth required:** Yes (must be conversation owner)

**Response (200):**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "title": "Architecture review",
  "agent_id": "507f1f77bcf86cd799439012",
  "model": "openai/gpt-4o",
  "message_count": 2,
  "created_at": "2026-04-04T10:00:00Z",
  "updated_at": "2026-04-04T10:01:00Z",
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "How should I structure my microservices?",
      "agent_id": null,
      "model_used": null,
      "created_at": "2026-04-04T10:00:30Z"
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "Here are the key principles...",
      "agent_id": "507f1f77bcf86cd799439012",
      "model_used": "openai/gpt-4o",
      "created_at": "2026-04-04T10:00:35Z"
    }
  ]
}
```

---

### POST /conversations/{conversation_id}/messages

Send a message and receive the full response (non-streaming).

**Auth required:** Yes (must be conversation owner)

**Request:**
```json
{ "content": "How should I structure my microservices?" }
```

**Response (200):**
```json
{
  "message": {
    "id": "msg_002",
    "role": "assistant",
    "content": "Here are the key principles...",
    "agent_id": "507f1f77bcf86cd799439012",
    "model_used": "openai/gpt-4o",
    "created_at": "2026-04-04T10:00:35Z"
  },
  "model_used": "openai/gpt-4o"
}
```

---

### POST /conversations/{conversation_id}/messages/stream

Send a message and receive the response as a Server-Sent Events (SSE) stream. Runs as a background task — if the client disconnects, processing continues and the response is saved to the DB.

**Auth required:** Yes (must be conversation owner)

**Request:**
```json
{ "content": "Explain Docker networking" }
```

To reconnect to an active stream (no new message), send empty content:
```json
{ "content": "" }
```

**Response:** `Content-Type: text/event-stream`

Each `data:` line contains a JSON event. See [SSE Event Types](#sse-event-types) below for the full format.

---

### GET /conversations/{conversation_id}/status

Check if a conversation has an active background processing task.

**Auth required:** Yes (must be conversation owner)

**Response (200):**
```json
{ "status": "processing" }
```

Values: `"processing"` (LLM call in progress) or `"idle"`.

---

### GET /conversations/{conversation_id}/events

Reconnect to an active background stream via GET-based SSE.

**Auth required:** Yes (must be conversation owner)

**Response:** `Content-Type: text/event-stream` — same format as the POST stream endpoint.

---

### DELETE /conversations/{conversation_id}

Delete a conversation and all its messages. Kills any active background task.

**Auth required:** Yes (must be conversation owner)

**Response (200):**
```json
{ "message": "Conversation deleted" }
```

---

## Settings

### GET /settings

Get system settings.

**Auth required:** Yes

**Response (200):**
```json
{
  "default_model": "ollama/llama3",
  "max_background_chats": 5,
  "roundtable_max_rounds": 3
}
```

---

### PUT /settings

Update system settings.

**Auth required:** Admin

**Request:**
```json
{
  "default_model": "ollama/llama3",
  "max_background_chats": 10,
  "roundtable_max_rounds": 5
}
```

All fields optional — only include what you want to change. Set `default_model` to `null` to clear.

**Response (200):**
```json
{ "message": "Settings updated" }
```

---

## Health Check

### GET /health

Basic health check (not under `/api/v1`).

**Auth required:** No

**Response (200):**
```json
{ "status": "ok" }
```

---

## SSE Event Types

Streaming endpoints return JSON events in SSE `data:` lines. Each event has a `type` field.

### Single-Agent Chat

| Event | Payload | When |
|-------|---------|------|
| `status` | `{type, status, agent_name, model}` | Thinking, connecting, generating phases |
| `token` | `{type, content}` | Each text chunk from the LLM |
| `done` | `{type, content, model_used}` | Full response complete |
| `error` | `{type, detail}` | Fatal error |
| `keepalive` | `{type}` | Sent every 30s to keep connection alive |

### Roundtable Chat

All single-agent events plus:

| Event | Payload | When |
|-------|---------|------|
| `round_start` | `{type, round, max_rounds}` | Beginning of each discussion round |
| `agent_turn` | `{type, agent_id, agent_name, round}` | Before each agent speaks |
| `done` | `{type, content, model_used, agent_id, agent_name}` | Agent finished (includes agent metadata) |
| `agent_pass` | `{type, agent_id, agent_name}` | Agent has nothing to add |
| `agent_error` | `{type, agent_id, agent_name, detail}` | Agent's LLM call failed (round continues) |
| `consensus` | `{type, round, passes, total}` | Majority of agents passed — discussion ends |
| `round_done` | `{type}` | All rounds complete |

### Example Roundtable Flow

```
data: {"type":"round_start","round":1,"max_rounds":3}
data: {"type":"agent_turn","agent_id":"abc","agent_name":"Security Analyst","round":1}
data: {"type":"status","status":"thinking","agent_name":"Security Analyst","model":"ollama/llama3"}
data: {"type":"status","status":"connecting"}
data: {"type":"status","status":"generating"}
data: {"type":"token","content":"The main "}
data: {"type":"token","content":"concern here..."}
data: {"type":"done","content":"The main concern here...","model_used":"ollama/llama3","agent_id":"abc","agent_name":"Security Analyst"}
data: {"type":"agent_turn","agent_id":"def","agent_name":"DevOps Engineer","round":1}
...
data: {"type":"round_start","round":2,"max_rounds":3}
...
data: {"type":"consensus","round":2,"passes":3,"total":4}
data: {"type":"round_done"}
```

---

## Error Responses

All errors follow this format:

```json
{ "detail": "Error message here" }
```

| Status | Meaning                                         |
|--------|-------------------------------------------------|
| 400    | Bad request (invalid input)                     |
| 401    | Unauthorized (missing or invalid token)         |
| 403    | Forbidden (not admin for admin-only endpoints)  |
| 404    | Resource not found                              |
| 409    | Conflict (duplicate username, slug, etc.)       |
| 422    | Validation error (Pydantic)                     |
| 500    | Internal server error                           |

---

## Model ID Format

Model IDs throughout the API use the `provider/model_name` format, which maps directly to [litellm's naming convention](https://docs.litellm.ai/docs/providers):

| Provider  | Example Model IDs                                           |
|-----------|-------------------------------------------------------------|
| OpenAI    | `openai/gpt-4o`, `openai/gpt-4o-mini`                      |
| Anthropic | `anthropic/claude-opus-4-20250514`, `anthropic/claude-sonnet-4-20250514` |
| Ollama    | `ollama/llama3`, `ollama/mistral`, `ollama/codellama`       |
| Google    | `gemini/gemini-2.5-pro`, `gemini/gemini-2.5-flash`         |

---

## Collaboration Roles

Agents can have a `collaboration_role` that shapes their behavior in roundtable discussions:

| Role | Behavior |
|------|----------|
| `orchestrator` | Guides discussion, delegates questions, drives decisions |
| `specialist` | Deep domain expertise, specific detailed answers |
| `critic` | Evaluates ideas, finds flaws, identifies risks |
| `synthesizer` | Combines viewpoints, drafts conclusions |
| `researcher` | Provides data, evidence, factual grounding |
| `devil_advocate` | Challenges prevailing opinion, stress-tests ideas |
