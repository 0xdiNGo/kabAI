"""Seed demo data into MongoDB. Idempotent — safe to run multiple times."""

import asyncio
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = [
    {
        "username": "admin",
        "email": "admin@example.com",
        "password": "admin123",
        "display_name": "Admin",
        "role": "admin",
        "auth_provider": "local",
    },
    {
        "username": "demo",
        "email": "demo@example.com",
        "password": "demo123",
        "display_name": "Demo User",
        "role": "user",
        "auth_provider": "local",
    },
]

AGENTS = [
    {
        "name": "Code Architect",
        "slug": "code-architect",
        "description": "Expert in software design patterns, system architecture, and code review.",
        "system_prompt": (
            "You are an expert software architect. You help users design robust, "
            "scalable systems. You review code for quality, suggest design patterns, "
            "and provide clear architectural guidance. Be concise and practical."
        ),
        "specializations": ["architecture", "code-review", "design-patterns"],
        "preferred_model": "openai/gpt-4o",
        "fallback_models": ["anthropic/claude-sonnet-4-20250514"],
        "temperature": 0.5,
        "max_tokens": 4096,
        "collaboration_capable": True,
        "collaboration_role": "specialist",
    },
    {
        "name": "Research Analyst",
        "slug": "research-analyst",
        "description": "Skilled at deep research, summarization, and fact-checking.",
        "system_prompt": (
            "You are a meticulous research analyst. You help users investigate topics "
            "thoroughly, summarize findings clearly, and verify claims with evidence. "
            "Always cite your reasoning and flag uncertainty."
        ),
        "specializations": ["research", "summarization", "analysis"],
        "preferred_model": "anthropic/claude-sonnet-4-20250514",
        "fallback_models": ["openai/gpt-4o"],
        "temperature": 0.3,
        "max_tokens": 8192,
        "collaboration_capable": True,
        "collaboration_role": "specialist",
    },
    {
        "name": "Team Lead",
        "slug": "team-lead",
        "description": "Orchestrates multi-agent collaboration and delegates tasks to specialists.",
        "system_prompt": (
            "You are a team lead who coordinates work across specialist agents. "
            "You break down complex problems, delegate to the right specialists, "
            "and synthesize their responses into a coherent answer. Be organized "
            "and decisive."
        ),
        "specializations": ["orchestration", "planning", "delegation"],
        "preferred_model": "openai/gpt-4o",
        "fallback_models": ["anthropic/claude-sonnet-4-20250514"],
        "temperature": 0.7,
        "max_tokens": 4096,
        "collaboration_capable": True,
        "collaboration_role": "orchestrator",
    },
]


async def seed():
    url = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("MONGODB_DB_NAME", "tiger_team")

    client = AsyncIOMotorClient(url)
    db = client[db_name]
    now = datetime.now(timezone.utc)

    # Seed users
    for user_data in USERS:
        existing = await db.users.find_one({"username": user_data["username"]})
        if existing:
            print(f"  User '{user_data['username']}' already exists, skipping.")
            continue
        doc = {**user_data, "created_at": now, "updated_at": now}
        doc["password_hash"] = pwd_context.hash(doc.pop("password"))
        await db.users.insert_one(doc)
        print(f"  Created user '{user_data['username']}' (password: {user_data['password']})")

    # Seed agents
    for agent_data in AGENTS:
        existing = await db.agents.find_one({"slug": agent_data["slug"]})
        if existing:
            print(f"  Agent '{agent_data['slug']}' already exists, skipping.")
            continue
        doc = {**agent_data, "is_active": True, "created_at": now, "updated_at": now}
        await db.agents.insert_one(doc)
        print(f"  Created agent '{agent_data['name']}'")

    client.close()
    print("\nSeed complete.")


if __name__ == "__main__":
    print("Seeding demo data...\n")
    asyncio.run(seed())
