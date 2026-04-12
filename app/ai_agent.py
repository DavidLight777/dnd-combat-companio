"""AI Agent — context builder and OpenRouter integration."""

import os
import json
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Session, Character, CharacterEffect, InventoryItem, Item, CombatLog, AIConversation

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPT_PATH = os.path.join(BASE_DIR, "ai_system_prompt.txt")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {}


def _load_system_prompt() -> str:
    if os.path.exists(PROMPT_PATH):
        with open(PROMPT_PATH) as f:
            return f.read().strip()
    return "You are a helpful tabletop RPG assistant."


async def build_game_context(session_id: int, db: AsyncSession) -> str:
    """Assemble a structured text summary of current game state."""
    session = await db.get(Session, session_id)
    if not session:
        return "No active session."

    lines = [
        f"## Game State",
        f"- Session: {session.name} (code: {session.code})",
        f"- Status: {session.status}",
        f"- Turn/Round: {session.turn_number}",
        "",
        "## Characters:",
    ]

    chars_result = await db.execute(
        select(Character).where(Character.session_id == session_id)
    )
    chars = chars_result.scalars().all()

    for c in chars:
        role = "NPC" if c.is_npc else "Player"
        status = "ALIVE" if c.is_alive else "DEAD"
        effects_list = []
        if c.effects:
            effects_list = [f"{e.name}({'ON' if e.is_active else 'OFF'})" for e in c.effects]

        inv_result = await db.execute(
            select(InventoryItem).where(InventoryItem.character_id == c.id, InventoryItem.is_equipped == True)
        )
        equipped = inv_result.scalars().all()
        eq_names = []
        for ei in equipped:
            item = await db.get(Item, ei.item_id)
            if item:
                eq_names.append(item.name)

        lines.append(
            f"- {c.name} [{role}] HP:{c.current_hp}/{c.max_hp} KD:{c.armor_class} "
            f"STR:{c.strength} DEX:{c.dexterity} CON:{c.constitution} "
            f"INT:{c.intelligence} WIS:{c.wisdom} CHA:{c.charisma} "
            f"Status:{status} Effects:[{','.join(effects_list)}] "
            f"Equipped:[{','.join(eq_names)}] Gold:{c.gold}"
        )

    # Last 10 combat log entries
    log_result = await db.execute(
        select(CombatLog)
        .where(CombatLog.session_id == session_id)
        .order_by(CombatLog.timestamp.desc())
        .limit(10)
    )
    logs = log_result.scalars().all()
    if logs:
        lines.append("")
        lines.append("## Recent Combat Log:")
        for entry in reversed(logs):
            lines.append(f"- [{entry.event_type}] {entry.description}")

    return "\n".join(lines)


async def get_conversation_history(session_id: int, db: AsyncSession, limit: int = 20) -> list[dict]:
    """Get last N conversation messages."""
    result = await db.execute(
        select(AIConversation)
        .where(AIConversation.session_id == session_id)
        .order_by(AIConversation.created_at.desc())
        .limit(limit)
    )
    entries = result.scalars().all()
    return [{"role": e.role, "content": e.content} for e in reversed(entries)]


async def chat_with_ai(session_id: int, user_message: str, db: AsyncSession) -> dict:
    """Send message to AI with full game context. Returns {"reply": str} or {"error": str}."""
    config = _load_config()
    api_key = config.get("openrouter_api_key", "")
    if not api_key:
        return {"error": "Set your OpenRouter API key in config.json (field: openrouter_api_key)"}

    model = config.get("ai_model", "google/gemma-3-27b-it:free")
    system_prompt = _load_system_prompt()
    context = await build_game_context(session_id, db)
    history = await get_conversation_history(session_id, db)

    # Build messages
    messages = [
        {"role": "system", "content": f"{system_prompt}\n\n---\n\n{context}"},
    ]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    # Save user message
    db.add(AIConversation(session_id=session_id, role="user", content=user_message))
    await db.commit()

    # Call OpenRouter
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.8,
                },
            )
        if resp.status_code != 200:
            return {"error": f"AI API error ({resp.status_code}): {resp.text[:200]}"}

        data = resp.json()
        reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not reply:
            return {"error": "AI returned empty response"}

        # Save assistant reply
        db.add(AIConversation(session_id=session_id, role="assistant", content=reply))
        await db.commit()

        return {"reply": reply}

    except httpx.TimeoutException:
        return {"error": "AI request timed out (60s). Try again."}
    except Exception as e:
        return {"error": f"AI request failed: {str(e)[:200]}"}
