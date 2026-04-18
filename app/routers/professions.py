"""Rework Phase 4 — Multi-profession management for characters.

A character may have multiple professions simultaneously. Each profession has
its own level (1..5). The GM controls add/remove/level-up. All active
professions contribute their class bonuses to the character.

Endpoints:
  GET    /api/characters/{char_id}/professions           list
  POST   /api/characters/{char_id}/professions           add (body: class_id, level=1)
  PATCH  /api/characters/{char_id}/professions/{cp_id}   update (body: level, is_active)
  DELETE /api/characters/{char_id}/professions/{cp_id}   remove
"""
from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character, CharacterClass, CharacterProfession,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api", tags=["professions"])

MIN_LEVEL = 1
MAX_LEVEL = 5


# ── Schemas ──────────────────────────────────────────────────
class AddProfessionBody(BaseModel):
    class_id: int
    level: int = Field(default=1, ge=MIN_LEVEL, le=MAX_LEVEL)
    is_active: bool = True


class UpdateProfessionBody(BaseModel):
    level: int | None = Field(default=None, ge=MIN_LEVEL, le=MAX_LEVEL)
    is_active: bool | None = None


# ── Helpers ──────────────────────────────────────────────────
def _ser_profession(cp: CharacterProfession) -> dict:
    cls = cp.character_class
    return {
        "id": cp.id,
        "character_id": cp.character_id,
        "class_id": cp.class_id,
        "level": cp.level,
        "is_active": cp.is_active,
        "name": cls.name if cls else None,
        "description": cls.description if cls else "",
        "hit_die": cls.hit_die if cls else None,
        "bonuses": json.loads(cls.bonuses) if (cls and cls.bonuses) else [],
        "special_abilities": json.loads(cls.special_abilities) if (cls and cls.special_abilities) else [],
        "acquired_at": cp.acquired_at.isoformat() if cp.acquired_at else None,
    }


async def _ensure_character(char_id: int, db: AsyncSession) -> Character:
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    return c


async def _broadcast_char_update(session_id: int, character_id: int):
    try:
        await manager.broadcast(session_id, {
            "event": "character.update",
            "character_id": character_id,
        })
    except Exception:
        pass


# ── Endpoints ────────────────────────────────────────────────
@router.get("/characters/{char_id}/professions")
async def list_professions(char_id: int, db: AsyncSession = Depends(get_session)):
    await _ensure_character(char_id, db)
    result = await db.execute(
        select(CharacterProfession)
        .where(CharacterProfession.character_id == char_id)
        .order_by(CharacterProfession.acquired_at.asc())
    )
    return [_ser_profession(cp) for cp in result.scalars().all()]


@router.post("/characters/{char_id}/professions")
async def add_profession(char_id: int, body: AddProfessionBody, db: AsyncSession = Depends(get_session)):
    char = await _ensure_character(char_id, db)

    cls = await db.get(CharacterClass, body.class_id)
    if not cls:
        raise HTTPException(404, "Class not found")

    # Prevent duplicates
    existing = await db.execute(
        select(CharacterProfession).where(
            CharacterProfession.character_id == char_id,
            CharacterProfession.class_id == body.class_id,
        )
    )
    if existing.scalars().first() is not None:
        raise HTTPException(409, "Character already has this profession")

    cp = CharacterProfession(
        character_id=char_id,
        class_id=body.class_id,
        level=max(MIN_LEVEL, min(MAX_LEVEL, int(body.level))),
        is_active=bool(body.is_active),
    )
    db.add(cp)
    await db.commit()
    await db.refresh(cp)
    # eager-load class for serializer
    cp_loaded = await db.execute(
        select(CharacterProfession).where(CharacterProfession.id == cp.id)
    )
    cp = cp_loaded.scalars().first()

    await _broadcast_char_update(char.session_id, char_id)
    return _ser_profession(cp)


@router.patch("/characters/{char_id}/professions/{cp_id}")
async def update_profession(
    char_id: int, cp_id: int,
    body: UpdateProfessionBody,
    db: AsyncSession = Depends(get_session),
):
    char = await _ensure_character(char_id, db)
    cp = await db.get(CharacterProfession, cp_id)
    if not cp or cp.character_id != char_id:
        raise HTTPException(404, "Profession entry not found for this character")

    if body.level is not None:
        cp.level = max(MIN_LEVEL, min(MAX_LEVEL, int(body.level)))
    if body.is_active is not None:
        cp.is_active = bool(body.is_active)
    await db.commit()
    await db.refresh(cp)

    await _broadcast_char_update(char.session_id, char_id)
    return _ser_profession(cp)


@router.delete("/characters/{char_id}/professions/{cp_id}")
async def delete_profession(char_id: int, cp_id: int, db: AsyncSession = Depends(get_session)):
    char = await _ensure_character(char_id, db)
    cp = await db.get(CharacterProfession, cp_id)
    if not cp or cp.character_id != char_id:
        raise HTTPException(404, "Profession entry not found for this character")

    await db.delete(cp)
    await db.commit()

    await _broadcast_char_update(char.session_id, char_id)
    return {"ok": True, "removed_id": cp_id}
