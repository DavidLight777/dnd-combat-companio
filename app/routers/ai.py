"""AI chat endpoints."""

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
