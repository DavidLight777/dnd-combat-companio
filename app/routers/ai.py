"""AI chat endpoints."""

import os, json, httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Session, AIConversation
from app.ai_agent import chat_with_ai, get_conversation_history

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/chat")
async def ai_chat(body: dict, db: AsyncSession = Depends(get_session)):
    session_code = body.get("session_code")
    message = body.get("message", "").strip()
    if not session_code or not message:
        raise HTTPException(400, "session_code and message required")

    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    response = await chat_with_ai(session.id, message, db)
    return response


@router.get("/history/{session_code}")
async def ai_history(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    history = await get_conversation_history(session.id, db, limit=40)
    return {"messages": history}


@router.delete("/history/{session_code}")
async def clear_ai_history(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    from sqlalchemy import delete
    await db.execute(delete(AIConversation).where(AIConversation.session_id == session.id))
    await db.commit()
    return {"ok": True}


NPC_GEN_PROMPT = """You are an NPC generator for a D&D-style tabletop RPG.
Given a description, create an NPC with the following JSON fields:
{
  "name": "string",
  "description": "string (1-2 sentences)",
  "max_hp": integer,
  "armor_class": integer,
  "strength": integer (1-20),
  "dexterity": integer (1-20),
  "constitution": integer (1-20),
  "intelligence": integer (1-20),
  "wisdom": integer (1-20),
  "charisma": integer (1-20),
  "initiative_bonus": integer,
  "is_merchant": boolean,
  "notes": "string (personality traits, motivations, secrets)"
}
Respond ONLY with valid JSON, no markdown fences, no extra text."""


@router.post("/generate-npc")
async def generate_npc(body: dict):
    description = body.get("description", "").strip()
    if not description:
        raise HTTPException(400, "description is required")

    config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "config.json")
    config = {}
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)

    api_key = config.get("openrouter_api_key", "")
    if not api_key:
        raise HTTPException(500, "Set openrouter_api_key in config.json")

    model = config.get("ai_npc_model", "google/gemma-3-27b-it:free")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": NPC_GEN_PROMPT},
                        {"role": "user", "content": f"Create an NPC: {description}"},
                    ],
                    "temperature": 0.9,
                },
            )
        if resp.status_code != 200:
            raise HTTPException(502, f"AI API error ({resp.status_code})")

        data = resp.json()
        reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        # Parse JSON from reply (strip markdown fences if any)
        reply = reply.strip()
        if reply.startswith("```"):
            reply = reply.split("\n", 1)[1] if "\n" in reply else reply[3:]
            if reply.endswith("```"):
                reply = reply[:-3]
            reply = reply.strip()

        npc = json.loads(reply)
        return npc

    except json.JSONDecodeError:
        raise HTTPException(502, "AI returned invalid JSON. Try again.")
    except httpx.TimeoutException:
        raise HTTPException(504, "AI request timed out.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"AI request failed: {str(e)[:200]}")
