"""Stage 10 — Session Timer API."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Session

router = APIRouter(prefix="/api/sessions", tags=["session-timer"])


def _elapsed(session: Session) -> int:
    """Return total elapsed seconds including current running segment."""
    total = session.total_play_seconds or 0
    if session.play_timer_started_at:
        now = datetime.now(UTC)
        started = session.play_timer_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=UTC)
        total += int((now - started).total_seconds())
    return total


@router.get("/{session_code}/timer")
async def get_timer(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    return {
        "running": session.play_timer_started_at is not None,
        "total_seconds": _elapsed(session),
        "started_at": session.play_timer_started_at.isoformat() if session.play_timer_started_at else None,
    }


@router.post("/{session_code}/timer/start")
async def start_timer(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if session.play_timer_started_at:
        return {"running": True, "total_seconds": _elapsed(session), "message": "Already running"}
    session.play_timer_started_at = datetime.now(UTC)
    await db.commit()
    return {"running": True, "total_seconds": _elapsed(session)}


@router.post("/{session_code}/timer/pause")
async def pause_timer(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if not session.play_timer_started_at:
        return {"running": False, "total_seconds": session.total_play_seconds or 0, "message": "Not running"}
    now = datetime.now(UTC)
    started = session.play_timer_started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=UTC)
    session.total_play_seconds = (session.total_play_seconds or 0) + int((now - started).total_seconds())
    session.play_timer_started_at = None
    await db.commit()
    return {"running": False, "total_seconds": session.total_play_seconds}
