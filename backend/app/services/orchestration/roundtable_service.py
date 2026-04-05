import asyncio
import json

from app.core.exceptions import NotFoundError
from app.models.conversation import Message
from app.repositories.agent_repo import AgentRepository
from app.repositories.conversation_repo import ConversationRepository
from app.repositories.settings_repo import SettingsRepository
from app.services.knowledge_service import KnowledgeService
from app.services.llm_service import LLMService


class RoundtableService:
    def __init__(
        self,
        conversation_repo: ConversationRepository,
        agent_repo: AgentRepository,
        llm_service: LLMService,
        settings_repo: SettingsRepository,
        knowledge_service: KnowledgeService,
    ):
        self.conversation_repo = conversation_repo
        self.agent_repo = agent_repo
        self.llm_service = llm_service
        self.settings_repo = settings_repo
        self.knowledge_service = knowledge_service

    async def run_message_stream(
        self,
        conversation_id: str,
        user_id: str,
        content: str,
        queue: asyncio.Queue[str | None],
    ) -> None:
        """Run a multi-round roundtable discussion, pushing events to queue."""
        convo = await self.conversation_repo.find_by_id(conversation_id)
        if not convo or convo.user_id != user_id:
            raise NotFoundError("Conversation", conversation_id)

        settings = await self.settings_repo.get()
        max_rounds = settings.roundtable_max_rounds

        # Save user message
        user_msg = Message(role="user", content=content)
        await self.conversation_repo.add_message(conversation_id, user_msg)

        # Load participating agents in order
        agents = await self.agent_repo.find_by_ids(convo.agent_ids)
        if not agents:
            raise NotFoundError("Agents", "no agents found for roundtable")

        # Build message history (existing + new user message)
        thread = [{"role": m.role, "content": m.content} for m in convo.messages]
        thread.append({"role": "user", "content": content})

        agent_names = [a.name for a in agents]

        for round_num in range(1, max_rounds + 1):
            # Signal round start
            await queue.put(json.dumps({
                "type": "round_start",
                "round": round_num,
                "max_rounds": max_rounds,
            }))

            passes_this_round = 0

            for agent in agents:
                await queue.put(json.dumps({
                    "type": "agent_turn",
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "round": round_num,
                }))

                try:
                    other_names = [n for n in agent_names if n != agent.name]
                    round_instruction = self._build_round_instruction(
                        other_names, round_num, max_rounds, agent.collaboration_role
                    )
                    augmented_agent = agent.model_copy(update={
                        "system_prompt": f"{round_instruction}\n\n{agent.system_prompt}"
                    })

                    model = await self.llm_service.resolve_model(
                        agent.preferred_model, agent.fallback_models
                    )

                    # Retrieve knowledge base context for this agent
                    context = None
                    if getattr(agent, "knowledge_base_ids", None):
                        context = await self.knowledge_service.retrieve(
                            content, agent.knowledge_base_ids
                        )
                        context = context if context else None

                    agent_content = ""
                    async for event_data in self.llm_service.stream_completion(
                        model, thread, augmented_agent, context
                    ):
                        event = json.loads(event_data)

                        if event["type"] == "token":
                            agent_content += event["content"]
                            await queue.put(event_data)
                        elif event["type"] == "done":
                            agent_content = event["content"]
                            if agent_content.strip().upper().startswith("[PASS]"):
                                passes_this_round += 1
                                pass_msg = Message(
                                    role="assistant",
                                    content="[PASS]",
                                    agent_id=agent.id,
                                    agent_name=agent.name,
                                    model_used=event.get("model_used"),
                                )
                                await self.conversation_repo.add_message(
                                    conversation_id, pass_msg
                                )
                                thread.append({
                                    "role": "assistant",
                                    "content": f"[{agent.name}]: [PASS]",
                                })
                                await queue.put(json.dumps({
                                    "type": "agent_pass",
                                    "agent_id": agent.id,
                                    "agent_name": agent.name,
                                }))
                            else:
                                assistant_msg = Message(
                                    role="assistant",
                                    content=agent_content,
                                    agent_id=agent.id,
                                    agent_name=agent.name,
                                    model_used=event.get("model_used"),
                                )
                                await self.conversation_repo.add_message(
                                    conversation_id, assistant_msg
                                )
                                thread.append({
                                    "role": "assistant",
                                    "content": f"[{agent.name}]: {agent_content}",
                                })
                                await queue.put(json.dumps({
                                    "type": "done",
                                    "content": agent_content,
                                    "model_used": event.get("model_used"),
                                    "agent_id": agent.id,
                                    "agent_name": agent.name,
                                }))
                        else:
                            await queue.put(event_data)

                except Exception as e:
                    await queue.put(json.dumps({
                        "type": "agent_error",
                        "agent_id": agent.id,
                        "agent_name": agent.name,
                        "detail": str(e),
                    }))
                    thread.append({
                        "role": "assistant",
                        "content": f"[{agent.name}]: [ERROR: {e}]",
                    })

            # Check if consensus reached (majority passed)
            majority = len(agents) // 2 + 1
            if passes_this_round >= majority:
                await queue.put(json.dumps({
                    "type": "consensus",
                    "round": round_num,
                    "passes": passes_this_round,
                    "total": len(agents),
                }))
                break

            # If not the last round, inject a continuation prompt into the thread
            if round_num < max_rounds:
                continuation = (
                    f"[System: Round {round_num} of {max_rounds} complete. "
                    f"{passes_this_round} of {len(agents)} agents passed. "
                    f"Continue discussing — build on each other's points, "
                    f"challenge disagreements, and work toward consensus. "
                    f"Pass if you have nothing new to add.]"
                )
                thread.append({"role": "system", "content": continuation})

        # Signal discussion complete
        await queue.put(json.dumps({"type": "round_done"}))

    _ROLE_INSTRUCTIONS = {
        "orchestrator": (
            "Your role is ORCHESTRATOR: guide the discussion, identify key points of "
            "agreement and disagreement, delegate questions to appropriate specialists, "
            "and keep the group on track toward a conclusion."
        ),
        "specialist": (
            "Your role is SPECIALIST: contribute deep domain expertise on topics in "
            "your area. Provide specific, detailed answers and correct inaccuracies."
        ),
        "critic": (
            "Your role is CRITIC: rigorously evaluate ideas and proposals. Point out "
            "flaws, edge cases, risks, and unstated assumptions. Be constructive but "
            "thorough in your critique."
        ),
        "synthesizer": (
            "Your role is SYNTHESIZER: find common ground between different viewpoints. "
            "Combine the best elements of what others have said into coherent, actionable "
            "conclusions. Summarize the group's position."
        ),
        "researcher": (
            "Your role is RESEARCHER: provide factual context, data, and evidence to "
            "ground the discussion. Cite specifics, compare alternatives objectively, "
            "and flag areas where more information is needed."
        ),
        "devil_advocate": (
            "Your role is DEVIL'S ADVOCATE: challenge the prevailing opinion, even if "
            "you agree with it. Present the strongest counter-arguments and alternative "
            "perspectives to stress-test the group's conclusions."
        ),
    }

    def _build_round_instruction(
        self, other_names: list[str], round_num: int, max_rounds: int,
        role: str | None = None,
    ) -> str:
        base = (
            f"You are in a roundtable discussion with: {', '.join(other_names)}. "
            f"This is round {round_num} of {max_rounds}. "
            f"You can see the full conversation including other agents' responses. "
        )
        if role and role in self._ROLE_INSTRUCTIONS:
            base += self._ROLE_INSTRUCTIONS[role] + " "
        if round_num == 1:
            base += (
                "Share your perspective on the topic. Be substantive and specific. "
                "If you have nothing to add, respond with just [PASS]."
            )
        else:
            base += (
                "Build on the discussion so far. Respond to other agents' points — "
                "agree, disagree, refine, or synthesize. Push toward a conclusion. "
                "If the group has covered the topic well and you have nothing new to add, "
                "respond with just [PASS]."
            )
        return base
