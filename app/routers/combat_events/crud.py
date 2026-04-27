"""Combat CRUD + participants."""
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Character, CombatEvent, CombatParticipant, Session
from app.routers.combat_events.common import (
    AddParticipantBody,
    AddParticipantsBody,
    CreateCombatBody,
    _calc_initiative_bonus,
    _get_combat,
    _serialize_combat,
    _serialize_participant,
    router,
)


@router.post("/create")
async def create_combat(body: CreateCombatBody, db: AsyncSession = Depends(get_session)):
    # Verify session exists
    sess = await db.get(Session, body.session_id)
    if not sess:
        raise HTTPException(404, "Session not found")

    ce = CombatEvent(session_id=body.session_id, name=body.name)
    db.add(ce)
    await db.commit()
    await db.refresh(ce)
    return await _serialize_combat(ce, db)


@router.get("/{combat_id}/state")
async def get_combat_state(combat_id: int, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    return await _serialize_combat(ce, db)


@router.get("/session/{session_code}/active")
async def get_active_combat(session_code: str, db: AsyncSession = Depends(get_session)):
    """Get the currently active or preparing combat for a session."""
    result = await db.execute(select(Session).where(Session.code == session_code))
    sess = result.scalar_one_or_none()
    if not sess:
        raise HTTPException(404, "Session not found")

    result = await db.execute(
        select(CombatEvent).where(
            CombatEvent.session_id == sess.id,
            CombatEvent.status.in_(["preparing", "active"]),
        ).order_by(CombatEvent.id.desc()).limit(1)
    )
    ce = result.scalar_one_or_none()
    if not ce:
        return {"active": False}
    return {"active": True, "combat": await _serialize_combat(ce, db)}


# ══════════════════════════════════════════════════════════════
# PARTICIPANTS
# ══════════════════════════════════════════════════════════════
@router.post("/{combat_id}/add-participant")
async def add_participant(combat_id: int, body: AddParticipantBody, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    if ce.status == "ended":
        raise HTTPException(400, "Combat already ended")

    char = await db.get(Character, body.character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    # Check duplicate
    existing = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id,
            CombatParticipant.character_id == body.character_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Character already in combat")

    bonus = _calc_initiative_bonus(char)
    p = CombatParticipant(
        combat_event_id=combat_id,
        character_id=body.character_id,
        initiative_bonus=bonus,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _serialize_participant(p)


@router.post("/{combat_id}/add-participants")
async def add_participants(combat_id: int, body: AddParticipantsBody, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    if ce.status == "ended":
        raise HTTPException(400, "Combat already ended")

    added = []
    for cid in body.character_ids:
        char = await db.get(Character, cid)
        if not char:
            continue
        # Skip duplicates
        existing = await db.execute(
            select(CombatParticipant).where(
                CombatParticipant.combat_event_id == combat_id,
                CombatParticipant.character_id == cid,
            )
        )
        if existing.scalar_one_or_none():
            continue

        bonus = _calc_initiative_bonus(char)
        p = CombatParticipant(
            combat_event_id=combat_id,
            character_id=cid,
            initiative_bonus=bonus,
        )
        db.add(p)
        added.append(cid)

    await db.commit()
    await db.refresh(ce)
    return {"ok": True, "added": added, "combat": await _serialize_combat(ce, db)}


@router.delete("/{combat_id}/participants/{char_id}")
async def remove_participant(combat_id: int, char_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id,
            CombatParticipant.character_id == char_id,
        )
    )
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Participant not found")
    await db.delete(p)
    await db.commit()
    return {"ok": True}


