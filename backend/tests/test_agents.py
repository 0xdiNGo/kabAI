from unittest.mock import AsyncMock

from tests.conftest import AsyncIteratorMock


def test_list_agents(client, mock_db, auth_headers, test_user_doc):
    """List agents returns active agents."""
    mock_db["users"].find_one = AsyncMock(return_value=test_user_doc)
    mock_db["agents"].find = lambda query: AsyncIteratorMock([
        {
            "_id": "agent1",
            "name": "Linux Admin",
            "slug": "linux-admin",
            "description": "Linux expert",
            "avatar_url": None,
            "system_prompt": "You are a Linux admin.",
            "specializations": ["linux", "bash"],
            "preferred_model": "anthropic/claude-sonnet-4-20250514",
            "fallback_models": [],
            "temperature": 0.7,
            "max_tokens": 4096,
            "collaboration_capable": True,
            "collaboration_role": "specialist",
            "created_by": "admin_id",
            "is_active": True,
        }
    ])

    resp = client.get("/api/v1/agents", headers=auth_headers)
    assert resp.status_code == 200
    agents = resp.json()
    assert len(agents) == 1
    assert agents[0]["slug"] == "linux-admin"


def test_create_agent_requires_admin(client, mock_db, auth_headers, test_user_doc):
    """Non-admin cannot create agents."""
    mock_db["users"].find_one = AsyncMock(return_value=test_user_doc)

    resp = client.post("/api/v1/agents", headers=auth_headers, json={
        "name": "Test Agent",
        "slug": "test-agent",
        "description": "A test agent",
        "system_prompt": "You are a test.",
        "preferred_model": "openai/gpt-4o",
    })
    assert resp.status_code == 403


def test_create_agent_as_admin(client, mock_db, admin_headers, admin_user_doc):
    """Admin can create agents."""
    mock_db["users"].find_one = AsyncMock(return_value=admin_user_doc)
    mock_db["agents"].find_one = AsyncMock(return_value=None)  # no slug conflict

    resp = client.post("/api/v1/agents", headers=admin_headers, json={
        "name": "Test Agent",
        "slug": "test-agent",
        "description": "A test agent",
        "system_prompt": "You are a test.",
        "preferred_model": "openai/gpt-4o",
    })
    assert resp.status_code == 201
    assert "id" in resp.json()
