"""Phase 6 — Character Memory / Journal CRUD."""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import CharacterMemory, Character

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
    character_id: int, entry_type: str, title: str,
    content: str = "", npc_id: int | None = None,
    session_id: int | None = None, db: AsyncSession = None,
):
    """Internal helper for auto-populating memory entries."""
    if not db:
        return
    m = CharacterMemory(
        character_id=character_id,
        session_id=session_id,
        entry_type=entry_type,
        title=title,
        content=content,
        related_npc_id=npc_id,
    )
    db.add(m)
