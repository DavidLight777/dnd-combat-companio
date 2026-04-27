"""AI chat endpoints.

Rework v3: the former ``/generate-npc`` route had its own bespoke prompt that
duplicated — and disagreed with — the main system prompt. It's now a thin
shim around the envelope agent so both routes speak the same schema.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_agent import (
    _call_openrouter,
    _load_config,
    _load_system_prompt,
    chat_with_ai,
    get_conversation_history,
    parse_envelope,
    run_actions,
)
from app.database import get_session
from app.models import AIConversation, Session

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/chat")
async def ai_chat(body: dict, db: AsyncSession = Depends(get_session)):
    session_code = body.get("session_code")
    message = body.get("message", "").strip() if isinstance(body.get("message"), str) else ""
    if not session_code or not message:
        raise HTTPException(400, "session_code and message required")

    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    return await chat_with_ai(session.id, message, db)


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

    await db.execute(delete(AIConversation).where(AIConversation.session_id == session.id))
    await db.commit()
    return {"ok": True}


# ── Legacy generate-npc shim ────────────────────────────────────────
# Old clients expected a flat JSON NPC dict back. Keep that contract but
# now fuelled by the full envelope prompt, so the model has the right
# schema in its context and won't hallucinate fields.
@router.post("/generate-npc")
async def generate_npc(body: dict, db: AsyncSession = Depends(get_session)):
    description = (body.get("description") or "").strip()
    if not description:
        raise HTTPException(400, "description is required")

    config = _load_config()
    system_prompt = _load_system_prompt()
    session_code = body.get("session_code")
    session_id = None
    if session_code:
        res = await db.execute(select(Session).where(Session.code == session_code))
        session_obj = res.scalar_one_or_none()
        if session_obj:
            session_id = session_obj.id

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": (
            f"Create an NPC based on this description and emit a single "
            f'create_npc action. Description: "{description}".'
        )},
    ]

    reply, err = await _call_openrouter(messages, config)
    if err:
        # Preserve the old status code semantics: 500 for missing key,
        # 504 for timeout, 502 otherwise — all without crashing the chat.
        if "timed out" in err:
            raise HTTPException(504, err)
        if "API key" in err:
            raise HTTPException(500, err)
        raise HTTPException(502, err)

    say, actions, parse_err = parse_envelope(reply)
    npc_actions = [a for a in actions if a["kind"] == "create_npc"]
    if not npc_actions:
        raise HTTPException(502, f"AI returned no NPC action ({parse_err or 'bad shape'})")

    if session_id is not None:
        # Actually persist; return the created row + hint.
        results = await run_actions(session_id, npc_actions[:1], db)
        created = results[0] if results else {"ok": False, "error": "dispatch-failed"}
        return {"say": say, "created": created, "payload": npc_actions[0]["payload"]}

    # No session context → legacy behaviour: return the payload only.
    return {"say": say, "payload": npc_actions[0]["payload"]}
