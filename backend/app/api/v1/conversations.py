import asyncio

from fastapi import APIRouter, Depends, Request
from sse_starlette.sse import EventSourceResponse

from app.dependencies import (
    get_conversation_service,
    get_current_user,
    get_kabainet_service,
    get_settings_repo,
)
from app.repositories.settings_repo import SettingsRepository
from app.schemas.conversation import (
    ConversationCreate,
    ConversationDetailResponse,
    ConversationResponse,
    MessageResponse,
    MessageSend,
)
from app.services.conversation_service import ConversationService
from app.services.orchestration.kabainet_service import KabAInetService

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationResponse])
async def list_conversations(
    limit: int = 50,
    offset: int = 0,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    convos = await svc.list_conversations(user.id, limit, offset)
    results = []
    for c in convos:
        # Generate a quick summary from the first user message if none stored
        summary = c.summary
        if not summary and c.messages:
            first_user = next((m for m in c.messages if m.role == "user"), None)
            if first_user:
                summary = first_user.content[:120].strip()
                if len(first_user.content) > 120:
                    summary += "..."

        # Derive agent name if not stored
        agent_name = c.last_agent_name
        if not agent_name and c.agent_id:
            agent = await svc.agent_repo.find_by_id(c.agent_id)
            if agent:
                agent_name = agent.name

        results.append(ConversationResponse(
            id=c.id,
            title=c.title,
            agent_id=c.agent_id,
            agent_ids=c.agent_ids,
            model=c.model,
            is_collaboration=c.is_collaboration,
            collaboration_mode=c.collaboration_mode,
            message_count=len(c.messages),
            summary=summary,
            last_agent_name=agent_name,
            created_at=c.created_at,
            updated_at=c.updated_at,
        ))
    return results


@router.post("", response_model=dict, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    conversation_id = await svc.create_conversation(
        user_id=user.id,
        agent_id=body.agent_id,
        agent_ids=body.agent_ids,
        collaboration_mode=body.collaboration_mode,
        model=body.model,
        title=body.title,
    )
    return {"id": conversation_id}


@router.get("/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation(
    conversation_id: str,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    convo = await svc.get_conversation(conversation_id, user.id)
    return ConversationDetailResponse(
        id=convo.id,
        title=convo.title,
        agent_id=convo.agent_id,
        agent_ids=convo.agent_ids,
        model=convo.model,
        is_collaboration=convo.is_collaboration,
        collaboration_mode=convo.collaboration_mode,
        message_count=len(convo.messages),
        created_at=convo.created_at,
        updated_at=convo.updated_at,
        messages=[
            MessageResponse(
                id=m.id,
                role=m.role,
                content=m.content,
                agent_id=m.agent_id,
                agent_name=m.agent_name,
                model_used=m.model_used,
                created_at=m.created_at,
            )
            for m in convo.messages
        ],
    )


@router.get("/{conversation_id}/status", response_model=dict)
async def get_conversation_status(
    conversation_id: str,
    request: Request,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    """Check if a conversation has an active background processing task."""
    await svc.get_conversation(conversation_id, user.id)
    bg = request.app.state.background_manager
    return {"status": bg.get_status(conversation_id)}


@router.post("/{conversation_id}/messages", response_model=dict)
async def send_message(
    conversation_id: str,
    body: MessageSend,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    result = await svc.send_message(conversation_id, user.id, body.content)
    msg = result["message"]
    return {
        "message": MessageResponse(
            id=msg.id,
            role=msg.role,
            content=msg.content,
            agent_id=msg.agent_id,
            agent_name=msg.agent_name,
            model_used=msg.model_used,
            created_at=msg.created_at,
        ).model_dump(),
        "model_used": result["model_used"],
    }


@router.post("/{conversation_id}/messages/stream")
async def send_message_stream(
    conversation_id: str,
    body: MessageSend,
    request: Request,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
    kabainet_svc: KabAInetService = Depends(get_kabainet_service),
    settings_repo: SettingsRepository = Depends(get_settings_repo),
):
    bg = request.app.state.background_manager

    # If no content and already processing, this is a reconnect
    is_reconnect = not body.content and bg.get_status(conversation_id) == "processing"

    if not is_reconnect:
        convo = await svc.get_conversation(conversation_id, user.id)
        settings = await settings_repo.get()

        # Create queue first, then build coroutine with it
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        if convo.collaboration_mode == "kabainet":
            coro = kabainet_svc.run_message_stream(
                conversation_id, user.id, body.content, queue
            )
        else:
            coro = svc.run_message_stream(
                conversation_id, user.id, body.content, queue,
                web_search=body.web_search,
            )

        await bg.start_chat_with_queue(
            conversation_id, user.id, coro, queue, settings.max_background_chats
        )

    async def event_generator():
        async for event_data in bg.read_events(conversation_id):
            yield {"data": event_data}

    return EventSourceResponse(event_generator())


@router.get("/{conversation_id}/events")
async def reconnect_events(
    conversation_id: str,
    request: Request,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    """Reconnect to an active background stream via GET."""
    await svc.get_conversation(conversation_id, user.id)
    bg = request.app.state.background_manager

    async def event_generator():
        async for event_data in bg.read_events(conversation_id):
            yield {"data": event_data}

    return EventSourceResponse(event_generator())


@router.delete("/{conversation_id}", response_model=dict)
async def delete_conversation(
    conversation_id: str,
    request: Request,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    bg = request.app.state.background_manager
    await bg.kill(conversation_id)
    await svc.delete_conversation(conversation_id, user.id)
    return {"message": "Conversation deleted"}
