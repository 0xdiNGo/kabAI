from fastapi import APIRouter, Depends

from app.dependencies import get_auth_service, get_current_user
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=dict, status_code=201)
async def register(body: RegisterRequest, auth: AuthService = Depends(get_auth_service)):
    user_id = await auth.register(
        username=body.username,
        email=body.email,
        password=body.password,
        display_name=body.display_name,
    )
    return {"id": user_id, "message": "User registered successfully"}


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, auth: AuthService = Depends(get_auth_service)):
    access_token, refresh_token = await auth.login(body.username, body.password)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, auth: AuthService = Depends(get_auth_service)):
    access_token, refresh_token = await auth.refresh(body.refresh_token)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.get("/me", response_model=UserResponse)
async def me(user=Depends(get_current_user)):
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        auth_provider=user.auth_provider,
    )
