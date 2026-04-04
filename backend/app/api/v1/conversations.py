from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

from app.dependencies import get_conversation_service, get_current_user
from app.schemas.conversation import (
    ConversationCreate,
    ConversationDetailResponse,
    ConversationResponse,
    MessageResponse,
    MessageSend,
)
from app.services.conversation_service import ConversationService

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationResponse])
async def list_conversations(
    limit: int = 50,
    offset: int = 0,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    convos = await svc.list_conversations(user.id, limit, offset)
    return [
        ConversationResponse(
            id=c.id,
            title=c.title,
            agent_id=c.agent_id,
            model=c.model,
            message_count=len(c.messages),
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in convos
    ]


@router.post("", response_model=dict, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    conversation_id = await svc.create_conversation(
        user_id=user.id,
        agent_id=body.agent_id,
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
        model=convo.model,
        message_count=len(convo.messages),
        created_at=convo.created_at,
        updated_at=convo.updated_at,
        messages=[
            MessageResponse(
                id=m.id,
                role=m.role,
                content=m.content,
                agent_id=m.agent_id,
                model_used=m.model_used,
                created_at=m.created_at,
            )
            for m in convo.messages
        ],
    )


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
            model_used=msg.model_used,
            created_at=msg.created_at,
        ).model_dump(),
        "model_used": result["model_used"],
    }


@router.post("/{conversation_id}/messages/stream")
async def send_message_stream(
    conversation_id: str,
    body: MessageSend,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    async def event_generator():
        async for event_data in svc.send_message_stream(
            conversation_id, user.id, body.content
        ):
            yield {"data": event_data}

    return EventSourceResponse(event_generator())


@router.delete("/{conversation_id}", response_model=dict)
async def delete_conversation(
    conversation_id: str,
    user=Depends(get_current_user),
    svc: ConversationService = Depends(get_conversation_service),
):
    await svc.delete_conversation(conversation_id, user.id)
    return {"message": "Conversation deleted"}
