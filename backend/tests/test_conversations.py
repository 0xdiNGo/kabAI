from unittest.mock import AsyncMock

from tests.conftest import AsyncIteratorMock


def test_create_conversation(client, mock_db, auth_headers, test_user_doc):
    """User can create a conversation."""
    mock_db["users"].find_one = AsyncMock(return_value=test_user_doc)

    resp = client.post(
        "/api/v1/conversations",
        headers=auth_headers,
        json={"model": "openai/gpt-4o"},
    )
    assert resp.status_code == 201
    assert "id" in resp.json()


def test_list_conversations(client, mock_db, auth_headers, test_user_doc):
    """User can list their conversations."""
    mock_db["users"].find_one = AsyncMock(return_value=test_user_doc)
    mock_db["conversations"].find = lambda query: AsyncIteratorMock([
        {
            "_id": "conv1",
            "user_id": "test_user_id",
            "title": "Test Chat",
            "agent_id": None,
            "model": "openai/gpt-4o",
            "messages": [],
            "is_collaboration": False,
            "collaboration_session_id": None,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
    ])

    resp = client.get("/api/v1/conversations", headers=auth_headers)
    assert resp.status_code == 200
    convos = resp.json()
    assert len(convos) == 1
    assert convos[0]["title"] == "Test Chat"


def test_delete_conversation(client, mock_db, auth_headers, test_user_doc):
    """User can delete their conversation."""
    mock_db["users"].find_one = AsyncMock(return_value=test_user_doc)

    resp = client.delete("/api/v1/conversations/conv1", headers=auth_headers)
    assert resp.status_code == 200
