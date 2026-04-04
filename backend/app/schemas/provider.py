from pydantic import BaseModel


class ProviderCreate(BaseModel):
    name: str
    display_name: str
    provider_type: str
    api_base: str | None = None
    api_key: str | None = None
    is_enabled: bool = True


class ProviderUpdate(BaseModel):
    display_name: str | None = None
    api_base: str | None = None
    api_key: str | None = None
    is_enabled: bool | None = None


class ProviderResponse(BaseModel):
    id: str
    name: str
    display_name: str
    provider_type: str
    api_base: str | None
    has_api_key: bool
    is_enabled: bool


class ModelInfo(BaseModel):
    id: str
    name: str
    provider: str
    provider_display_name: str
