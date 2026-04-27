import random

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Ability,
    CharacterAbility,
)
from app.routers.wizard.common import (
    RARITIES_ORDER,
    StatChoiceBody,
    _broadcast,
    _d20_to_rarity,
    _data,
    _ensure_state,
    _save_data,
    _ser,
    router,
)


# STEP 4 — Stat choice
# ══════════════════════════════════════════════════════════════
@router.post("/{char_id}/stat-choice")
async def stat_choice(char_id: int, body: StatChoiceBody, db: AsyncSession = Depends(get_session)):
    """Accept (stats=1) or decline (stats=0, advantage on feature roll)."""
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")

    val = 0 if body.declined else 1
    char.strength = val
    char.dexterity = val
    char.constitution = val
    char.intelligence = val
    char.wisdom = val
    char.charisma = val
    char.declined_stats = bool(body.declined)

    data = _data(ws)
    data["stat_choice"] = {"declined": bool(body.declined)}
    _save_data(ws, data)
    if ws.current_step < 4:
        ws.current_step = 4
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return _ser(ws)


# ══════════════════════════════════════════════════════════════
# STEP 5 — Feature roll
# ══════════════════════════════════════════════════════════════
async def _available_pool(db: AsyncSession, session_id: int, rarity: str):
    """Return GM-authored starting-pool abilities of the given rarity,
    scoped to this session first then falling back to global (session_id is null).
    Deterministic order by id so the d4 always maps to the same 4 entries.
    """
    # Session-scoped first
    q = await db.execute(
        select(Ability)
        .where(Ability.is_in_starting_pool == True)          # noqa: E712
        .where(Ability.rarity == rarity)
        .where((Ability.session_id == session_id) | (Ability.session_id.is_(None)))
        .order_by(Ability.id)
    )
    return list(q.scalars().all())


@router.post("/{char_id}/roll-feature")
async def roll_feature(char_id: int, db: AsyncSession = Depends(get_session)):
    """d20 (or 2d20-max if declined) → rarity → d4 → pick from GM pool.
    Grants a CharacterAbility immediately \u2014 no GM approval for features.
    """
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "feature_roll" in data and data["feature_roll"].get("ability_id"):
        return {
            "already_rolled": True,
            "roll": data["feature_roll"],
            "state": _ser(ws),
        }

    advantage = bool(char.declined_stats)
    rolls = [random.randint(1, 20) for _ in range(2 if advantage else 1)]
    kept = max(rolls) if advantage else rolls[0]
    rarity = _d20_to_rarity(kept)

    # Find pool; downgrade if empty
    pool = await _available_pool(db, char.session_id, rarity)
    original_rarity = rarity
    downgrades = 0
    while not pool and rarity in RARITIES_ORDER:
        idx = RARITIES_ORDER.index(rarity)
        if idx == 0:
            break
        rarity = RARITIES_ORDER[idx - 1]
        pool = await _available_pool(db, char.session_id, rarity)
        downgrades += 1

    if not pool:
        raise HTTPException(
            400,
            "No abilities in the starting pool. Ask the GM to add some (Abilities editor → Starting Pool).",
        )

    # First 4 ordered by id (per spec — "d4 picks one of four").
    bucket = pool[:4]
    d_size = len(bucket)
    d_rolled = random.randint(1, d_size)
    chosen = bucket[d_rolled - 1]

    # Grant the ability
    cab = CharacterAbility(
        character_id=char.id,
        ability_id=chosen.id,
        is_unlocked=True,
        cooldown_remaining=0,
        current_uses=chosen.max_uses,
        granted_from="wizard",
    )
    db.add(cab)

    data["feature_roll"] = {
        "d20_rolls": rolls,
        "kept_d20": kept,
        "advantage": advantage,
        "rarity": rarity,
        "rarity_rolled": original_rarity,
        "rarity_downgrades": downgrades,
        "bucket_size": len(pool),
        "d_size": d_size,
        "d_rolled": d_rolled,
        "ability_id": chosen.id,
    }
    _save_data(ws, data)
    if ws.current_step < 5:
        ws.current_step = 5
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return {
        "roll": data["feature_roll"],
        "ability": {
            "id": chosen.id,
            "name": chosen.name,
            "description": chosen.description,
            "rarity": chosen.rarity,
            "icon": chosen.icon,
            "color": chosen.color,
            "max_uses": chosen.max_uses,
            "is_conditional": chosen.is_conditional,
            "conditional_text": chosen.conditional_text,
        },
        "state": _ser(ws),
    }


# ══════════════════════════════════════════════════════════════
# STEP 6 — Finalize
# ══════════════════════════════════════════════════════════════
