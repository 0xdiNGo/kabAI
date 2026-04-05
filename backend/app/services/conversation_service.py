import asyncio
import json

from app.core.exceptions import NotFoundError
from app.models.conversation import Conversation, Message
from app.repositories.agent_repo import AgentRepository
from app.repositories.conversation_repo import ConversationRepository
from app.services.exemplar_service import ExemplarService
from app.services.knowledge_service import KnowledgeService
from app.services.llm_service import LLMService
from app.services.search_service import SearchService


class ConversationService:
    def __init__(
        self,
        conversation_repo: ConversationRepository,
        agent_repo: AgentRepository,
        llm_service: LLMService,
        knowledge_service: KnowledgeService,
        exemplar_service: ExemplarService,
        search_service: SearchService,
    ):
        self.conversation_repo = conversation_repo
        self.agent_repo = agent_repo
        self.llm_service = llm_service
        self.knowledge_service = knowledge_service
        self.exemplar_service = exemplar_service
        self.search_service = search_service

    async def create_conversation(
        self, user_id: str, agent_id: str | None = None,
        agent_ids: list[str] | None = None,
        collaboration_mode: str | None = None,
        model: str | None = None, title: str | None = None,
    ) -> str:
        conversation = Conversation(
            user_id=user_id,
            agent_id=agent_id,
            agent_ids=agent_ids or [],
            model=model,
            title=title,
            is_collaboration=collaboration_mode is not None,
            collaboration_mode=collaboration_mode,
        )
        return await self.conversation_repo.create(conversation)

    async def get_conversation(self, conversation_id: str, user_id: str) -> Conversation:
        convo = await self.conversation_repo.find_by_id(conversation_id)
        if not convo or convo.user_id != user_id:
            raise NotFoundError("Conversation", conversation_id)
        return convo

    async def list_conversations(
        self, user_id: str, limit: int = 50, offset: int = 0
    ) -> list[Conversation]:
        return await self.conversation_repo.find_by_user(user_id, limit, offset)

    async def _retrieve_exemplars(self, agent, query: str):
        """Retrieve few-shot exemplar pairs for an agent."""
        if not agent or not getattr(agent, "exemplar_set_ids", None):
            return None
        pairs = await self.exemplar_service.retrieve(query, agent.exemplar_set_ids)
        return pairs if pairs else None

    async def _retrieve_context(self, agent, query: str):
        """Retrieve knowledge base context for an agent if it has KBs assigned."""
        if not agent or not getattr(agent, "knowledge_base_ids", None):
            return None
        items = await self.knowledge_service.retrieve(query, agent.knowledge_base_ids)
        return items if items else None

    async def send_message(
        self, conversation_id: str, user_id: str, content: str
    ) -> dict:
        """Send a message and get a non-streaming response."""
        convo = await self.get_conversation(conversation_id, user_id)

        # Save user message
        user_msg = Message(role="user", content=content)
        await self.conversation_repo.add_message(conversation_id, user_msg)

        # Determine model and agent
        agent = None
        if convo.agent_id:
            agent = await self.agent_repo.find_by_id(convo.agent_id)

        model = await self.llm_service.resolve_model(
            agent.preferred_model if agent else convo.model,
            agent.fallback_models if agent else None,
        )

        # Retrieve knowledge base context and exemplars
        context = await self._retrieve_context(agent, content)
        exemplars = await self._retrieve_exemplars(agent, content)

        # Build message history
        messages = [{"role": m.role, "content": m.content} for m in convo.messages]
        messages.append({"role": "user", "content": content})

        # Get LLM response
        result = await self.llm_service.complete(model, messages, agent, context, exemplars)

        # Save assistant message
        assistant_msg = Message(
            role="assistant",
            content=result["content"],
            agent_id=convo.agent_id,
            model_used=result["model_used"],
            token_count=result.get("token_count"),
        )
        await self.conversation_repo.add_message(conversation_id, assistant_msg)

        return {
            "message": assistant_msg,
            "model_used": result["model_used"],
        }

    async def run_message_stream(
        self,
        conversation_id: str,
        user_id: str,
        content: str,
        queue: asyncio.Queue[str | None],
        web_search: bool = False,
    ) -> None:
        """Run streaming message and push events to queue. Saves message to DB on completion."""
        convo = await self.get_conversation(conversation_id, user_id)

        # Save user message
        user_msg = Message(role="user", content=content)
        await self.conversation_repo.add_message(conversation_id, user_msg)

        # Determine model and agent
        agent = None
        if convo.agent_id:
            agent = await self.agent_repo.find_by_id(convo.agent_id)

        model = await self.llm_service.resolve_model(
            agent.preferred_model if agent else convo.model,
            agent.fallback_models if agent else None,
        )

        # Retrieve knowledge base context and exemplars
        context = await self._retrieve_context(agent, content)
        exemplars = await self._retrieve_exemplars(agent, content)

        # Build message history
        messages = [{"role": m.role, "content": m.content} for m in convo.messages]
        messages.append({"role": "user", "content": content})

        # Determine if search should be enabled
        # Search is available if: checkbox is on, OR agent has search providers assigned
        agent_has_search = agent and getattr(agent, "search_provider_ids", None)
        use_search = web_search or bool(agent_has_search)

        # Stream LLM response, pushing events to queue
        full_content = ""
        search_pids = agent.search_provider_ids if agent and agent.search_provider_ids else None
        stream_fn = (
            self.llm_service.stream_completion_with_search(
                model, messages, self.search_service, agent, context, exemplars,
                search_provider_ids=search_pids,
            ) if use_search
            else self.llm_service.stream_completion(
                model, messages, agent, context, exemplars
            )
        )
        async for event_data in stream_fn:
            event = json.loads(event_data)
            if event["type"] == "token":
                full_content += event["content"]
            elif event["type"] == "done":
                # Save the complete assistant message
                assistant_msg = Message(
                    role="assistant",
                    content=full_content,
                    agent_id=convo.agent_id,
                    model_used=event.get("model_used"),
                )
                await self.conversation_repo.add_message(conversation_id, assistant_msg)
            await queue.put(event_data)

    async def delete_conversation(self, conversation_id: str, user_id: str) -> bool:
        return await self.conversation_repo.delete(conversation_id, user_id)
