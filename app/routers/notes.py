"""Stage 10 — Character Notes API."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Character, CharacterNote

router = APIRouter(prefix="/api/notes", tags=["notes"])


def _ser(n: CharacterNote) -> dict:
    return {
        "id": n.id,
        "character_id": n.character_id,
        "title": n.title,
        "content": n.content,
        "is_gm_note": n.is_gm_note,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


# Player notes: only their own non-GM notes
@router.get("/character/{character_id}")
async def list_character_notes(character_id: int, db: AsyncSession = Depends(get_session)):
    rows = await db.execute(
        select(CharacterNote)
        .where(CharacterNote.character_id == character_id, CharacterNote.is_gm_note == False)
        .order_by(CharacterNote.updated_at.desc())
    )
    return [_ser(n) for n in rows.scalars().all()]


# GM view: all notes for a character (player notes + GM notes)
@router.get("/character/{character_id}/all")
async def list_all_notes(character_id: int, db: AsyncSession = Depends(get_session)):
    rows = await db.execute(
        select(CharacterNote)
        .where(CharacterNote.character_id == character_id)
        .order_by(CharacterNote.updated_at.desc())
    )
    return [_ser(n) for n in rows.scalars().all()]


@router.post("/character/{character_id}")
async def create_note(character_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    ch = await db.get(Character, character_id)
    if not ch:
        raise HTTPException(404, "Character not found")

    n = CharacterNote(
        character_id=character_id,
        title=body.get("title", ""),
        content=body.get("content", ""),
        is_gm_note=body.get("is_gm_note", False),
    )
    db.add(n)
    await db.commit()
    await db.refresh(n)
    return _ser(n)


@router.put("/{note_id}")
async def update_note(note_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    n = await db.get(CharacterNote, note_id)
    if not n:
        raise HTTPException(404)
    if "title" in body:
        n.title = body["title"]
    if "content" in body:
        n.content = body["content"]
    n.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(n)
    return _ser(n)


@router.delete("/{note_id}")
async def delete_note(note_id: int, db: AsyncSession = Depends(get_session)):
    n = await db.get(CharacterNote, note_id)
    if not n:
        raise HTTPException(404)
    await db.delete(n)
    await db.commit()
    return {"ok": True}
