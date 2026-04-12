"""Initiative tracker — roll, order, advance turn, start/end combat."""

import random
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Session, Character, InitiativeOrder

router = APIRouter(prefix="/api/initiative", tags=["initiative"])


# ── Roll initiative for all characters in session ────────────
@router.post("/{session_code}/roll-all")
async def roll_all_initiative(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    chars_result = await db.execute(
        select(Character).where(Character.session_id == session.id, Character.is_alive == True)
    )
    chars = chars_result.scalars().all()
    if not chars:
        raise HTTPException(400, "No alive characters to roll for")

    # Clear old initiative
    await db.execute(delete(InitiativeOrder).where(InitiativeOrder.session_id == session.id))

    rolls = []
    for c in chars:
        d20 = random.randint(1, 20)
        total = d20 + c.initiative_bonus
        c.initiative_roll = total
        rolls.append({"character_id": c.id, "name": c.name, "d20": d20, "bonus": c.initiative_bonus, "total": total})

    # Sort descending by total, tiebreak by dexterity
    rolls.sort(key=lambda r: (-r["total"], -next((c.dexterity for c in chars if c.id == r["character_id"]), 0)))

    for i, r in enumerate(rolls):
        char = next(c for c in chars if c.id == r["character_id"])
        char.initiative_order = i
        order = InitiativeOrder(
            session_id=session.id,
            character_id=r["character_id"],
            roll_result=r["total"],
            final_order=i,
            is_active=True,
        )
        db.add(order)

    await db.commit()
    return {"order": rolls}


# ── Get current initiative order ─────────────────────────────
@router.get("/{session_code}/order")
async def get_initiative_order(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    order_result = await db.execute(
        select(InitiativeOrder).where(
            InitiativeOrder.session_id == session.id,
            InitiativeOrder.is_active == True,
        ).order_by(InitiativeOrder.final_order)
    )
    entries = order_result.scalars().all()

    items = []
    for e in entries:
        char = await db.get(Character, e.character_id)
        if char:
            items.append({
                "order": e.final_order,
                "character_id": e.character_id,
                "name": char.name,
                "is_npc": char.is_npc,
                "roll_result": e.roll_result,
                "current_hp": char.current_hp,
                "max_hp": char.max_hp,
                "is_alive": char.is_alive,
                "is_current_turn": session.current_turn_character_id == char.id,
            })
    return {"order": items, "current_turn_character_id": session.current_turn_character_id, "turn_number": session.turn_number}


# ── Start combat ─────────────────────────────────────────────
@router.post("/{session_code}/start-combat")
async def start_combat(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    # Get first in initiative order
    order_result = await db.execute(
        select(InitiativeOrder).where(
            InitiativeOrder.session_id == session.id,
            InitiativeOrder.is_active == True,
        ).order_by(InitiativeOrder.final_order).limit(1)
    )
    first = order_result.scalar_one_or_none()

    session.status = "active"
    session.turn_number = 1
    if first:
        session.current_turn_character_id = first.character_id
    await db.commit()
    return {"status": "active", "turn_number": 1, "current_turn_character_id": session.current_turn_character_id}


# ── Advance turn ─────────────────────────────────────────────
@router.post("/{session_code}/next-turn")
async def next_turn(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    order_result = await db.execute(
        select(InitiativeOrder).where(
            InitiativeOrder.session_id == session.id,
            InitiativeOrder.is_active == True,
        ).order_by(InitiativeOrder.final_order)
    )
    entries = order_result.scalars().all()
    if not entries:
        raise HTTPException(400, "No initiative order set")

    # Find current index
    current_idx = 0
    for i, e in enumerate(entries):
        if e.character_id == session.current_turn_character_id:
            current_idx = i
            break

    # Move to next alive character
    tried = 0
    next_idx = current_idx
    while tried < len(entries):
        next_idx = (next_idx + 1) % len(entries)
        char = await db.get(Character, entries[next_idx].character_id)
        if char and char.is_alive:
            break
        tried += 1

    if next_idx <= current_idx:
        session.turn_number += 1

    session.current_turn_character_id = entries[next_idx].character_id
    await db.commit()

    char = await db.get(Character, entries[next_idx].character_id)
    return {
        "current_turn_character_id": session.current_turn_character_id,
        "character_name": char.name if char else "?",
        "turn_number": session.turn_number,
    }


# ── End combat ───────────────────────────────────────────────
@router.post("/{session_code}/end-combat")
async def end_combat(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    session.status = "waiting"
    session.current_turn_character_id = None
    session.turn_number = 0
    await db.execute(delete(InitiativeOrder).where(InitiativeOrder.session_id == session.id))
    await db.commit()
    return {"status": "waiting"}
