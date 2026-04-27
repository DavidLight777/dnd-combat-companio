"""Combat flow: start, next-turn, end."""
from datetime import UTC, datetime

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Character, CombatParticipant
from app.routers.combat_events.common import (
    _get_combat,
    _has_skip_turn,
    _process_participant_turn_end,
    _serialize_combat,
    router,
)


@router.post("/{combat_id}/start")
async def start_combat(combat_id: int, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    if ce.status != "preparing":
        raise HTTPException(400, f"Combat is already {ce.status}")

    result = await db.execute(
        select(CombatParticipant).where(CombatParticipant.combat_event_id == combat_id)
    )
    participants = result.scalars().all()

    if not participants:
        raise HTTPException(400, "No participants in combat")

    # Load characters for sorting
    char_map = {}
    for p in participants:
        char_map[p.id] = await db.get(Character, p.character_id)

    # Sort by final_initiative DESC, tiebreak by dexterity
    def sort_key(p):
        fi = p.final_initiative if p.final_initiative is not None else 0
        ch = char_map.get(p.id)
        dex = ch.dexterity if ch else 0
        return (-fi, -dex)

    sorted_parts = sorted(participants, key=sort_key)
    for i, p in enumerate(sorted_parts):
        p.turn_order = i

    # Set first active participant as current
    first_active = next((p for p in sorted_parts if p.is_active and char_map.get(p.id) and char_map[p.id].is_alive), None)
    ce.status = "active"
    ce.round_number = 1
    ce.started_at = datetime.now(UTC)
    ce.current_participant_id = first_active.id if first_active else None

    # Rework v3 Phase 4: clear everyone's movement budget at combat
    # start so whatever was left over from the last fight doesn't carry
    # into this one.
    try:
        from app.routers.map import reset_movement_for
        for p in participants:
            await reset_movement_for(p.character_id, db)
    except Exception:
        pass

    await db.commit()
    await db.refresh(ce)
    return await _serialize_combat(ce, db)


@router.post("/{combat_id}/next-turn")
async def next_turn(combat_id: int, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    if ce.status != "active":
        raise HTTPException(400, "Combat is not active")

    result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id
        ).order_by(CombatParticipant.turn_order)
    )
    participants = result.scalars().all()
    if not participants:
        raise HTTPException(400, "No participants")

    # Process turn-end effects for current participant
    turn_end_events = []
    current_p = next((p for p in participants if p.id == ce.current_participant_id), None)
    if current_p:
        turn_end_events = await _process_participant_turn_end(current_p.character_id, db)

    # Find current index
    current_idx = 0
    for i, p in enumerate(participants):
        if p.id == ce.current_participant_id:
            current_idx = i
            break

    # Advance to next active+alive participant (skip dead, skip_turn)
    tried = 0
    next_idx = current_idx
    skipped = []
    new_round = False
    while tried < len(participants):
        next_idx = (next_idx + 1) % len(participants)
        if next_idx == 0:
            new_round = True

        p = participants[next_idx]
        char = await db.get(Character, p.character_id)
        if p.is_active and char and char.is_alive:
            # Check skip_turn
            if await _has_skip_turn(char.id, db):
                skipped.append({"character_id": char.id, "name": char.name, "reason": "skip_turn"})
                await _process_participant_turn_end(char.id, db)
                tried += 1
                continue
            break
        tried += 1

    if new_round:
        ce.round_number += 1

    ce.current_participant_id = participants[next_idx].id

    # Rework v3 Phase 4: refresh the movement budget of the incoming
    # actor so their turn starts with a full allowance.
    try:
        from app.routers.map import reset_movement_for
        await reset_movement_for(participants[next_idx].character_id, db)
    except Exception:
        pass

    await db.commit()
    await db.refresh(ce)

    next_char = await db.get(Character, participants[next_idx].character_id)
    return {
        "combat": await _serialize_combat(ce, db),
        "turn_end_events": turn_end_events,
        "skipped": skipped,
        "current_character_id": next_char.id if next_char else None,
        "current_character_name": next_char.name if next_char else "?",
    }


@router.post("/{combat_id}/end")
async def end_combat(combat_id: int, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    ce.status = "ended"
    ce.ended_at = datetime.now(UTC)
    # Rework v3 Phase 4: clear movement budget for everyone when the
    # fight wraps — prevents stale "used 6/6" stickiness if a new
    # combat starts immediately.
    try:
        from app.routers.map import reset_movement_for
        for p in (ce.participants or []):
            await reset_movement_for(p.character_id, db)
    except Exception:
        pass

    # FIX 5: Collect player participants + defeated NPCs BEFORE commit
    player_ids: list[int] = []
    defeated_names: list[str] = []
    try:
        for p in (ce.participants or []):
            ch = await db.get(Character, p.character_id)
            if not ch:
                continue
            if ch.is_npc and not ch.is_alive:
                defeated_names.append(ch.name)
            elif not ch.is_npc:
                player_ids.append(ch.id)
    except Exception:
        pass

    await db.commit()

    # FIX 5: Auto-memory entry for each player who was in this combat
    if defeated_names and player_ids:
        try:
            from app.routers.memory import create_memory_entry
            combat_name = ce.name or "Combat"
            content = f"Fought and defeated: {', '.join(defeated_names)}."
            for pid in player_ids:
                # Make title unique per combat to avoid dedup collision on repeat battles
                title = f"Battle: {combat_name} #{ce.id}"
                await create_memory_entry(
                    db, pid, "event", title, content,
                )
        except Exception:
            pass

    # Broadcast combat.ended (existing client code expects it)
    try:
        from app.models import Session as SessionModel
        from app.websocket_manager import manager
        sess = await db.get(SessionModel, ce.session_id)
        if sess:
            await manager.broadcast_to_session(sess.code, "combat.ended", {
                "combat_id": ce.id, "combat_name": ce.name,
            })
    except Exception:
        pass

    return {"ok": True, "status": "ended"}


