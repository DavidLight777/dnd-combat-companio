"""Stage 10 — Session Announcements API."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Session, SessionAnnouncement, Character

router = APIRouter(prefix="/api/announcements", tags=["announcements"])


def _ser(a: SessionAnnouncement, author_name: str | None = None) -> dict:
    return {
        "id": a.id,
        "session_id": a.session_id,
        "author_id": a.author_id,
        "author_name": author_name,
        "content": a.content,
        "is_pinned": a.is_pinned,
        "posted_at": a.posted_at.isoformat() if a.posted_at else None,
    }


@router.get("/{session_code}")
async def list_announcements(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    rows = await db.execute(
        select(SessionAnnouncement)
        .where(SessionAnnouncement.session_id == session.id)
        .order_by(SessionAnnouncement.is_pinned.desc(), SessionAnnouncement.posted_at.desc())
    )
    announcements = rows.scalars().all()

    # Resolve author names
    out = []
    for a in announcements:
        name = None
        if a.author_id:
            ch = await db.get(Character, a.author_id)
            name = ch.name if ch else None
        out.append(_ser(a, name))
    return out


@router.post("/{session_code}")
async def post_announcement(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    content = body.get("content", "").strip()
    if not content:
        raise HTTPException(400, "Content is required")

    a = SessionAnnouncement(
        session_id=session.id,
        author_id=body.get("author_id"),
        content=content,
        is_pinned=body.get("is_pinned", False),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)

    name = None
    if a.author_id:
        ch = await db.get(Character, a.author_id)
        name = ch.name if ch else None
    return _ser(a, name)


@router.patch("/{announcement_id}/pin")
async def toggle_pin(announcement_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    a = await db.get(SessionAnnouncement, announcement_id)
    if not a:
        raise HTTPException(404)
    a.is_pinned = body.get("is_pinned", not a.is_pinned)
    await db.commit()
    await db.refresh(a)
    return _ser(a)


@router.delete("/{announcement_id}")
async def delete_announcement(announcement_id: int, db: AsyncSession = Depends(get_session)):
    a = await db.get(SessionAnnouncement, announcement_id)
    if not a:
        raise HTTPException(404)
    await db.delete(a)
    await db.commit()
    return {"ok": True}
