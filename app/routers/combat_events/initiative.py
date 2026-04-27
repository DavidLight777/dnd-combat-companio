"""Initiative rolling."""
import random

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Character, CombatEvent, CombatParticipant, Session
from app.routers.combat_events.common import (
    ManualInitiativeBody,
    SetInitiativeBody,
    _calc_initiative_bonus,
    _get_combat,
    _serialize_combat,
    router,
)
from app.websocket_manager import manager


@router.post("/{combat_id}/roll-npc-initiative")
async def roll_npc_initiative(combat_id: int, db: AsyncSession = Depends(get_session)):
    """Roll initiative for ALL NPC participants at once."""
    ce = await _get_combat(combat_id, db)

    result = await db.execute(
        select(CombatParticipant).where(CombatParticipant.combat_event_id == combat_id)
    )
    participants = result.scalars().all()

    rolls = []
    for p in participants:
        char = await db.get(Character, p.character_id)
        if not char or not char.is_npc:
            continue
        d20 = random.randint(1, 20)
        p.initiative_roll = d20
        p.initiative_bonus = _calc_initiative_bonus(char)
        p.final_initiative = d20 + p.initiative_bonus
        rolls.append({
            "participant_id": p.id,
            "character_id": p.character_id,
            "name": char.name,
            "d20": d20,
            "bonus": p.initiative_bonus,
            "final": p.final_initiative,
        })

    await db.commit()
    await db.refresh(ce)
    return {"ok": True, "rolls": rolls, "combat": await _serialize_combat(ce, db)}


@router.post("/{combat_id}/request-player-initiative")
async def request_player_initiative(combat_id: int, db: AsyncSession = Depends(get_session)):
    """GM requests initiative rolls from all player participants. Broadcasts WS events to session."""
    result = await db.execute(
        select(CombatEvent).where(CombatEvent.id == combat_id)
    )
    ce = result.scalar_one_or_none()
    if not ce:
        raise HTTPException(404, "Combat not found")

    # Get session code
    sess = await db.get(Session, ce.session_id)
    session_code = sess.code if sess else None
    if not session_code:
        raise HTTPException(404, "Session not found")

    # Get player participants
    parts_result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id,
            CombatParticipant.is_active == True,
        )
    )
    parts = parts_result.scalars().all()

    sent_to = []
    for p in parts:
        char = await db.get(Character, p.character_id)
        if not char or char.is_npc:
            continue
        # Broadcast to entire session — each player JS filters by character_id
        await manager.broadcast_to_session(session_code, "combat.roll_initiative_request", {
            "combat_id": combat_id,
            "character_id": char.id,
            "initiative_bonus": p.initiative_bonus,
        })
        sent_to.append({"character_id": char.id, "name": char.name})

    return {"ok": True, "sent_to": sent_to}


@router.post("/{combat_id}/set-player-initiative")
async def set_player_initiative(combat_id: int, body: SetInitiativeBody, db: AsyncSession = Depends(get_session)):
    """Player submits their d20 roll."""
    result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id,
            CombatParticipant.character_id == body.character_id,
        )
    )
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Participant not found")

    char = await db.get(Character, p.character_id)
    p.initiative_roll = body.roll
    p.initiative_bonus = _calc_initiative_bonus(char) if char else 0
    p.final_initiative = body.roll + p.initiative_bonus
    await db.commit()
    return {
        "ok": True,
        "participant_id": p.id,
        "character_id": p.character_id,
        "d20": body.roll,
        "bonus": p.initiative_bonus,
        "final": p.final_initiative,
    }


@router.post("/{combat_id}/set-manual-initiative")
async def set_manual_initiative(combat_id: int, body: ManualInitiativeBody, db: AsyncSession = Depends(get_session)):
    """GM manually sets final initiative for any participant."""
    p = await db.get(CombatParticipant, body.participant_id)
    if not p or p.combat_event_id != combat_id:
        raise HTTPException(404, "Participant not found")
    p.final_initiative = body.final_initiative
    await db.commit()
    return {"ok": True, "participant_id": p.id, "final_initiative": p.final_initiative}


# ══════════════════════════════════════════════════════════════
# COMBAT FLOW
