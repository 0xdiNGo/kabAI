import pytest
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from app.config import settings
from app.core.security import create_access_token, hash_password
from app.main import app
from app.dependencies import get_db, get_redis


@pytest.fixture
def mock_db():
    """Mock MongoDB database with collection mocking."""
    db = MagicMock()
    collections = {}

    def get_collection(name):
        if name not in collections:
            col = AsyncMock()
            col.find_one = AsyncMock(return_value=None)
            col.insert_one = AsyncMock(
                return_value=MagicMock(inserted_id="test_id_123")
            )
            col.find = MagicMock(return_value=AsyncIteratorMock([]))
            col.update_one = AsyncMock(return_value=MagicMock(modified_count=1))
            col.delete_one = AsyncMock(return_value=MagicMock(deleted_count=1))
            collections[name] = col
        return collections[name]

    db.__getitem__ = get_collection
    db._collections = collections
    return db


@pytest.fixture
def mock_redis():
    """Mock Redis client."""
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.set = AsyncMock()
    redis.delete = AsyncMock()
    return redis


@pytest.fixture
def client(mock_db, mock_redis):
    """Test client with mocked dependencies."""
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_redis] = lambda: mock_redis
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers():
    """Generate auth headers with a valid JWT."""
    token = create_access_token("test_user_id", "user")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers():
    """Generate auth headers with an admin JWT."""
    token = create_access_token("admin_user_id", "admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_user_doc():
    """A user document as it would appear from MongoDB."""
    return {
        "_id": "test_user_id",
        "username": "testuser",
        "email": "test@example.com",
        "password_hash": hash_password("testpass"),
        "auth_provider": "local",
        "display_name": "Test User",
        "role": "user",
    }


@pytest.fixture
def admin_user_doc():
    return {
        "_id": "admin_user_id",
        "username": "admin",
        "email": "admin@example.com",
        "password_hash": hash_password("adminpass"),
        "auth_provider": "local",
        "display_name": "Admin",
        "role": "admin",
    }


class AsyncIteratorMock:
    """Mock for MongoDB async cursors."""

    def __init__(self, items):
        self.items = list(items)
        self._index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self.items):
            raise StopAsyncIteration
        item = self.items[self._index]
        self._index += 1
        return item

    def sort(self, *args, **kwargs):
        return self

    def skip(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self
