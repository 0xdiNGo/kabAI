import asyncio

from fastapi import APIRouter, Depends, Request
from sse_starlette.sse import EventSourceResponse

from app.dependencies import (
    get_connector_repo,
    get_conversation_repo,
    get_conversation_service,
    get_current_user,
)
from app.models.connector import Connector, ConnectorRules
from app.models.conversation import Message
from app.repositories.connector_repo import ConnectorRepository
from app.repositories.conversation_repo import ConversationRepository
from app.schemas.connector import (
    ConnectorCreate,
    ConnectorResponse,
    ConnectorSendRequest,
    ConnectorStatusResponse,
    ConnectorUpdate,
    TakeoverRequest,
)
from app.schemas.conversation import ConversationResponse
from app.services.conversation_service import ConversationService

router = APIRouter(prefix="/connectors", tags=["connectors"])


def _to_response(c: Connector) -> ConnectorResponse:
    return ConnectorResponse(
        id=c.id,  # type: ignore[arg-type]
        name=c.name,
        connector_type=c.connector_type,
        owner_user_id=c.owner_user_id,
        agent_id=c.agent_id,
        is_enabled=c.is_enabled,
        auto_start=c.auto_start,
        status=c.status,
        status_message=c.status_message,
        rules=c.rules,
        irc_config=c.irc_config,
        last_connected_at=c.last_connected_at,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


# ── CRUD ──────────────────────────────────────────────────────────────

@router.get("", response_model=list[ConnectorResponse])
async def list_connectors(
    user=Depends(get_current_user),
    repo: ConnectorRepository = Depends(get_connector_repo),
):
    connectors = await repo.find_by_user(user.id)
    return [_to_response(c) for c in connectors]


@router.post("", response_model=dict, status_code=201)
async def create_connector(
    body: ConnectorCreate,
    user=Depends(get_current_user),
    repo: ConnectorRepository = Depends(get_connector_repo),
):
    connector = Connector(
        name=body.name,
        connector_type=body.connector_type,
        owner_user_id=user.id,
        agent_id=body.agent_id,
        is_enabled=body.is_enabled,
        auto_start=body.auto_start,
        rules=body.rules or ConnectorRules(),
        irc_config=body.irc_config,
    )
    connector_id = await repo.create(connector)
    return {"id": connector_id}


@router.get("/{connector_id}", response_model=ConnectorResponse)
async def get_connector(
    connector_id: str,
    user=Depends(get_current_user),
    repo: ConnectorRepository = Depends(get_connector_repo),
):
    connector = await repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)
    return _to_response(connector)


@router.put("/{connector_id}", response_model=ConnectorResponse)
async def update_connector(
    connector_id: str,
    body: ConnectorUpdate,
    user=Depends(get_current_user),
    repo: ConnectorRepository = Depends(get_connector_repo),
):
    connector = await repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    updates = body.model_dump(exclude_none=True)
    if updates:
        # Serialize nested models
        if "rules" in updates:
            updates["rules"] = updates["rules"].model_dump()
        if "irc_config" in updates:
            updates["irc_config"] = updates["irc_config"].model_dump()
        await repo.update(connector_id, updates)

    updated = await repo.find_by_id(connector_id)
    return _to_response(updated)  # type: ignore[arg-type]


@router.delete("/{connector_id}", response_model=dict)
async def delete_connector(
    connector_id: str,
    request: Request,
    user=Depends(get_current_user),
    repo: ConnectorRepository = Depends(get_connector_repo),
):
    connector = await repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    # Stop if running
    manager = request.app.state.connector_manager
    try:
        await manager.stop_connector(connector_id)
    except Exception:
        pass
    await repo.delete(connector_id)
    return {"message": "Connector deleted"}


# ── Lifecycle ─────────────────────────────────────────────────────────

@router.post("/{connector_id}/start", response_model=dict)
async def start_connector(
    connector_id: str,
    request: Request,
    user=Depends(get_current_user),
    repo: ConnectorRepository = Depends(get_connector_repo),
):
    connector = await repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    manager = request.app.state.connector_manager
    await manager.start_connector(connector_id)
    return {"status": "started"}


@router.post("/{connector_id}/stop", response_model=dict)
async def stop_connector(
    connector_id: str,
    request: Request,
    user=Depends(get_current_user),
    repo: ConnectorRepository = Depends(get_connector_repo),
):
    connector = await repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    manager = request.app.state.connector_manager
    await manager.stop_connector(connector_id)
    return {"status": "stopped"}


@router.post("/{connector_id}/restart", response_model=dict)
async def restart_connector(
    connector_id: str,
    request: Request,
    user=Depends(get_current_user),
    repo: ConnectorRepository = Depends(get_connector_repo),
):
    connector = await repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    manager = request.app.state.connector_manager
    await manager.restart_connector(connector_id)
    return {"status": "restarted"}


@router.get("/{connector_id}/status", response_model=ConnectorStatusResponse)
async def connector_status(
    connector_id: str,
    request: Request,
    user=Depends(get_current_user),
    repo: ConnectorRepository = Depends(get_connector_repo),
):
    connector = await repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    manager = request.app.state.connector_manager
    status = manager.get_status(connector_id)
    instance = manager.get_instance(connector_id)
    health = await instance.get_health() if instance and instance.is_running else None
    return ConnectorStatusResponse(
        status=status["status"],
        running=status["running"],
        health=health,
    )


# ── Conversations (via unified API) ──────────────────────────────────

@router.get("/{connector_id}/conversations", response_model=list[ConversationResponse])
async def list_connector_conversations(
    connector_id: str,
    limit: int = 50,
    offset: int = 0,
    user=Depends(get_current_user),
    connector_repo: ConnectorRepository = Depends(get_connector_repo),
    conversation_repo: ConversationRepository = Depends(get_conversation_repo),
):
    connector = await connector_repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    convos = await conversation_repo.find_by_connector(connector_id, limit=limit, offset=offset)
    return [
        ConversationResponse(
            id=c.id,  # type: ignore[arg-type]
            title=c.title,
            agent_id=c.agent_id,
            agent_ids=c.agent_ids,
            model=c.model,
            is_collaboration=c.is_collaboration,
            collaboration_mode=c.collaboration_mode,
            message_count=len(c.messages),
            source=c.source,
            connector_id=c.connector_id,
            channel=c.channel,
            is_taken_over=c.is_taken_over,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in convos
    ]


# ── Takeover ──────────────────────────────────────────────────────────

@router.post("/{connector_id}/conversations/{conversation_id}/takeover", response_model=dict)
async def takeover_conversation(
    connector_id: str,
    conversation_id: str,
    body: TakeoverRequest,
    user=Depends(get_current_user),
    connector_repo: ConnectorRepository = Depends(get_connector_repo),
    svc: ConversationService = Depends(get_conversation_service),
):
    connector = await connector_repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    await svc.set_takeover(conversation_id, user.id, body.take_over)
    return {"is_taken_over": body.take_over}


@router.post("/{connector_id}/conversations/{conversation_id}/release", response_model=dict)
async def release_conversation(
    connector_id: str,
    conversation_id: str,
    user=Depends(get_current_user),
    connector_repo: ConnectorRepository = Depends(get_connector_repo),
    svc: ConversationService = Depends(get_conversation_service),
):
    connector = await connector_repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    await svc.set_takeover(conversation_id, user.id, False)
    return {"is_taken_over": False}


@router.post("/{connector_id}/conversations/{conversation_id}/send", response_model=dict)
async def takeover_send(
    connector_id: str,
    conversation_id: str,
    body: ConnectorSendRequest,
    request: Request,
    user=Depends(get_current_user),
    connector_repo: ConnectorRepository = Depends(get_connector_repo),
    conversation_repo: ConversationRepository = Depends(get_conversation_repo),
):
    """Send a message as the human operator during takeover."""
    connector = await connector_repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    convo = await conversation_repo.find_by_id(conversation_id)
    if not convo or not convo.is_taken_over:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Conversation is not in takeover mode")

    # Save as assistant message (from the external user's perspective, it's the bot talking)
    msg = Message(
        role="assistant",
        content=body.content,
        sender_name=user.display_name if hasattr(user, "display_name") else user.username,
    )
    await conversation_repo.add_message(conversation_id, msg)

    # Send through the connector to the external service
    manager = request.app.state.connector_manager
    target = convo.channel or convo.external_id.split("@")[0] if convo.external_id else None
    if target:
        await manager.send_to_external(connector_id, target, body.content)

    return {"message": msg.model_dump()}


# ── SSE Monitoring ────────────────────────────────────────────────────

@router.get("/{connector_id}/events")
async def connector_events(
    connector_id: str,
    request: Request,
    user=Depends(get_current_user),
    connector_repo: ConnectorRepository = Depends(get_connector_repo),
):
    """SSE stream of live connector events (messages, status changes, etc.)."""
    connector = await connector_repo.find_by_id(connector_id)
    if not connector or connector.owner_user_id != user.id:
        from app.core.exceptions import NotFoundError
        raise NotFoundError("Connector", connector_id)

    event_bus = request.app.state.connector_event_bus
    queue = event_bus.subscribe(connector_id)

    async def event_generator():
        try:
            while True:
                try:
                    event_data = await asyncio.wait_for(queue.get(), timeout=30)
                    yield {"data": event_data}
                except asyncio.TimeoutError:
                    yield {"data": '{"type": "heartbeat"}'}
        except asyncio.CancelledError:
            pass
        finally:
            event_bus.unsubscribe(connector_id, queue)

    return EventSourceResponse(event_generator())
