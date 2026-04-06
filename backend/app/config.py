from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Tiger Team"

    # MongoDB
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "tiger_team"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # JWT
    jwt_secret: str = "change-me-to-a-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 60
    jwt_refresh_expiration_days: int = 7

    # OAuth/OIDC
    oauth_enabled: bool = False
    oidc_discovery_url: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None

    # Encryption key for provider API keys stored in DB
    fernet_key: str | None = None

    # CORS
    cors_origins: str = "http://localhost:5173"

    # Ollama
    ollama_api_base: str = "http://localhost:11434"

    # Qdrant (vector search)
    qdrant_url: str = "http://localhost:6333"


settings = Settings()
