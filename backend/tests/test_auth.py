from unittest.mock import AsyncMock, MagicMock

from app.core.security import hash_password


def test_register_success(client, mock_db):
    """User can register with valid credentials."""
    users_col = mock_db["users"]
    users_col.find_one = AsyncMock(return_value=None)  # no existing user

    resp = client.post("/api/v1/auth/register", json={
        "username": "newuser",
        "email": "new@example.com",
        "password": "securepass",
    })
    assert resp.status_code == 201
    assert "id" in resp.json()


def test_register_duplicate_username(client, mock_db, test_user_doc):
    """Registration fails if username exists."""
    users_col = mock_db["users"]
    users_col.find_one = AsyncMock(return_value=test_user_doc)

    resp = client.post("/api/v1/auth/register", json={
        "username": "testuser",
        "email": "different@example.com",
        "password": "securepass",
    })
    assert resp.status_code == 409


def test_login_success(client, mock_db, mock_redis, test_user_doc):
    """User can log in with correct credentials."""
    users_col = mock_db["users"]
    users_col.find_one = AsyncMock(return_value=test_user_doc)

    resp = client.post("/api/v1/auth/login", json={
        "username": "testuser",
        "password": "testpass",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


def test_login_wrong_password(client, mock_db, test_user_doc):
    """Login fails with wrong password."""
    users_col = mock_db["users"]
    users_col.find_one = AsyncMock(return_value=test_user_doc)

    resp = client.post("/api/v1/auth/login", json={
        "username": "testuser",
        "password": "wrongpass",
    })
    assert resp.status_code == 401


def test_me_authenticated(client, mock_db, auth_headers, test_user_doc):
    """Authenticated user can access /me."""
    users_col = mock_db["users"]
    users_col.find_one = AsyncMock(return_value=test_user_doc)

    resp = client.get("/api/v1/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["username"] == "testuser"


def test_me_unauthenticated(client):
    """Unauthenticated request to /me fails."""
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 422  # missing header
