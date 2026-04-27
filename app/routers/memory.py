"""Phase 6 — Character Memory / Journal CRUD."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Character, CharacterMemory

router = APIRouter(prefix="/api", tags=["memory"])


def _mem_dict(m: CharacterMemory) -> dict:
    return {
        "id": m.id,
        "character_id": m.character_id,
        "session_id": m.session_id,
        "entry_type": m.entry_type,
        "title": m.title,
        "content": m.content,
        "related_npc_id": m.related_npc_id,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.get("/characters/{char_id}/memory")
async def get_memory(char_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CharacterMemory)
        .where(CharacterMemory.character_id == char_id)
        .order_by(CharacterMemory.created_at.desc())
    )
    return [_mem_dict(m) for m in result.scalars().all()]


@router.post("/characters/{char_id}/memory")
async def add_memory(char_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    m = CharacterMemory(
        character_id=char_id,
        session_id=char.session_id,
        entry_type=body.get("entry_type", "note"),
        title=body.get("title", "Note"),
        content=body.get("content", ""),
        related_npc_id=body.get("related_npc_id"),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _mem_dict(m)


@router.put("/memory/{mem_id}")
async def update_memory(mem_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    m = await db.get(CharacterMemory, mem_id)
    if not m:
        raise HTTPException(404, "Memory entry not found")
    if "title" in body:
        m.title = body["title"]
    if "content" in body:
        m.content = body["content"]
    await db.commit()
    await db.refresh(m)
    return _mem_dict(m)


@router.delete("/memory/{mem_id}")
async def delete_memory(mem_id: int, db: AsyncSession = Depends(get_session)):
    m = await db.get(CharacterMemory, mem_id)
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await db.commit()
    return {"ok": True}


async def create_memory_entry(
    db: AsyncSession,
    character_id: int,
    entry_type: str,
    title: str,
    content: str = "",
    related_npc_id: int | None = None,
    session_id: int | None = None,
):
    """FIX 5: Internal helper for auto-populating memory entries.

    - Skips duplicates (same character_id + title).
    - Auto-commits.
    - Broadcasts `memory.entry_added` to the character's player over WS
      so they see a notification toast.
    """
    if not db:
        return None

    # Duplicate check — skip if same character+title already exists
    existing = await db.execute(
        select(CharacterMemory).where(
            CharacterMemory.character_id == character_id,
            CharacterMemory.title == title,
        )
    )
    if existing.scalar_one_or_none():
        return None

    # Resolve session_id if not given
    if session_id is None:
        char = await db.get(Character, character_id)
        if char:
            session_id = char.session_id

    m = CharacterMemory(
        character_id=character_id,
        session_id=session_id,
        entry_type=entry_type,
        title=title,
        content=content,
        related_npc_id=related_npc_id,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)

    # Broadcast to all clients of the session; player-side filters by character_id
    try:
        from app.models import Session as SessionModel
        from app.websocket_manager import manager
        if session_id is not None:
            sess = await db.get(SessionModel, session_id)
            if sess:
                await manager.broadcast_to_session(sess.code, "memory.entry_added", {
                    "character_id": character_id,
                    "entry_type": entry_type,
                    "title": title,
                })
    except Exception:
        pass

    return m


async def update_memory_by_title(
    db: AsyncSession,
    character_id: int,
    title: str,
    append_content: str,
):
    """FIX 5: Append text to an existing memory entry matched by title.
    Returns the entry or None if not found.
    """
    res = await db.execute(
        select(CharacterMemory).where(
            CharacterMemory.character_id == character_id,
            CharacterMemory.title == title,
        )
    )
    m = res.scalar_one_or_none()
    if not m:
        return None
    m.content = (m.content or "") + append_content
    await db.commit()
    await db.refresh(m)
    return m
