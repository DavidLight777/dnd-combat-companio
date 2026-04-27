import random

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Race,
)
from app.routers.wizard.common import _broadcast, _data, _ensure_state, _save_data, _ser, router


@router.post("/{char_id}/finalize")
async def finalize(char_id: int, db: AsyncSession = Depends(get_session)):
    """Roll race HP die, compute slot cap, lock the character into level 0 play state."""
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")

    data = _data(ws)
    if "stat_choice" not in data:
        raise HTTPException(400, "Complete Step 4 (stat choice) first")
    if "feature_roll" not in data:
        raise HTTPException(400, "Complete Step 5 (feature roll) first")

    # Resolve race's HP die (default to d8 × 1 if no race).
    hp_die = 8
    hp_dice_count = 1
    spirit_hp_die = 4
    spirit_hp_dice_count = 1
    if char.race_id:
        race = await db.get(Race, char.race_id)
        if race:
            hp_die = int(race.hp_die or 8)
            hp_dice_count = int(race.hp_dice_count or 1)
            spirit_hp_die = int(race.spiritual_hp_die or 4)
            spirit_hp_dice_count = int(race.spiritual_hp_dice_count or 1)

    rolls = [random.randint(1, hp_die) for _ in range(hp_dice_count)]
    hp_from_roll = sum(rolls)

    # Roll spiritual HP
    spirit_rolls = [random.randint(1, spirit_hp_die) for _ in range(spirit_hp_dice_count)]
    spirit_hp_from_roll = sum(spirit_rolls)

    # char.max_hp already carries any race hp_bonus from /join. Add the roll.
    new_max_hp = max(1, char.max_hp + hp_from_roll)
    char.max_hp = new_max_hp
    char.current_hp = new_max_hp

    # Set spiritual HP
    char.spiritual_max_hp = spirit_hp_from_roll
    char.spiritual_hp = spirit_hp_from_roll

    # Mana / AC stay at level-0 defaults (10 / 0) \u2014 no feature logic yet.
    # Slot cap \u2014 see formula in REWORK_PLAN.md §1 Step 6.
    # Slot cap — canonical formula:
    #     slots = 10 + 2 × constitution
    # CON 0 (declined) → 10, CON 1 (accepted) → 12, +2 per extra CON.
    # The decline branch is already encoded in the CON value itself
    # (Step 4 zeroes every stat on decline), so we MUST NOT add a
    # second "+2 on accept" baseline — that produced a 14-slot off-by-one
    # bug for fresh L0 accepted characters.
    declined = bool(char.declined_stats)
    char.max_inventory_slots = 10 + 2 * max(0, int(char.constitution))

    # Mark wizard completed. is_completed=True even if the GM hasn't approved
    # the item yet \u2014 player enters /player and sees a "waiting" banner there.
    ws.is_completed = True
    ws.current_step = 6
    data["finalize"] = {
        "hp_rolls": rolls,
        "race_hp_die": hp_die,
        "race_hp_count": hp_dice_count,
        "max_hp": new_max_hp,
        "spirit_hp_rolls": spirit_rolls,
        "race_spirit_hp_die": spirit_hp_die,
        "race_spirit_hp_count": spirit_hp_dice_count,
        "spirit_max_hp": spirit_hp_from_roll,
        "slots": char.max_inventory_slots,
        "declined": declined,
    }
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.completed", {"character_id": char_id})
    return _ser(ws)


# ══════════════════════════════════════════════════════════════

# STEP 7 — HP Reroll (optional, after finalize)
# ══════════════════════════════════════════════════════════════
class RerollHpBody(BaseModel):
    reroll_type: str = Field(..., description="physical, spiritual, or both")

@router.post("/{char_id}/reroll-hp")
async def reroll_hp(char_id: int, body: RerollHpBody, db: AsyncSession = Depends(get_session)):
    """Reroll physical HP, spiritual HP, or both. Only available after finalize."""
    char, ws = await _ensure_state(char_id, db)
    if not ws.is_completed:
        raise HTTPException(400, "Complete Step 6 (finalize) first")

    data = _data(ws)
    if "finalize" not in data:
        raise HTTPException(400, "HP not rolled yet")

    reroll_type = body.reroll_type  # physical, spiritual, both

    # Resolve race's HP die
    hp_die = int(data["finalize"].get("race_hp_die", 8))
    hp_dice_count = int(data["finalize"].get("race_hp_count", 1))
    spirit_hp_die = int(data["finalize"].get("race_spirit_hp_die", 4))
    spirit_hp_dice_count = int(data["finalize"].get("race_spirit_hp_count", 1))

    # Get base HP (race bonus) - subtract current roll to get base
    current_hp_roll_total = sum(data["finalize"].get("hp_rolls", []))
    base_hp = char.max_hp - current_hp_roll_total

    # Roll physical HP if requested
    if reroll_type in ("physical", "both"):
        rolls = [random.randint(1, hp_die) for _ in range(hp_dice_count)]
        hp_from_roll = sum(rolls)
        char.max_hp = max(1, base_hp + hp_from_roll)
        char.current_hp = char.max_hp
        data["finalize"]["hp_rolls"] = rolls
    else:
        rolls = data["finalize"].get("hp_rolls", [])

    # Roll spiritual HP if requested
    if reroll_type in ("spiritual", "both"):
        spirit_rolls = [random.randint(1, spirit_hp_die) for _ in range(spirit_hp_dice_count)]
        spirit_hp_from_roll = sum(spirit_rolls)
        char.spiritual_max_hp = spirit_hp_from_roll
        char.spiritual_hp = spirit_hp_from_roll
        data["finalize"]["spirit_hp_rolls"] = spirit_rolls
    else:
        spirit_rolls = data["finalize"].get("spirit_hp_rolls", [])

    data["reroll_hp"] = {
        "reroll_type": reroll_type,
        "hp_rolls": rolls,
        "spirit_hp_rolls": spirit_rolls,
    }
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)

    return {
        "max_hp": char.max_hp,
        "current_hp": char.current_hp,
        "spiritual_max_hp": char.spiritual_max_hp,
        "spiritual_hp": char.spiritual_hp,
        "hp_rolls": rolls,
        "spirit_hp_rolls": spirit_rolls,
    }


# ══════════════════════════════════════════════════════════════
