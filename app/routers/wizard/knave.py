import random

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Session
from app.routers.wizard.common import _broadcast, _data, _ensure_state, _save_data, _ser, router


KNAVE_STATS = ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")


class KnaveProfileBody(BaseModel):
    profile: dict = {}


class KnaveStatSwapBody(BaseModel):
    stat_a: str
    stat_b: str


class KnaveHpRerollBody(BaseModel):
    reroll_type: str = "physical"


async def _ensure_knave_session(char, db: AsyncSession) -> Session:
    session = await db.get(Session, char.session_id)
    if not session or (session.rules_system or "legacy") != "knave_like":
        raise HTTPException(400, "Knave-like wizard is only available in knave_like sessions")
    return session


def _roll_3d6() -> dict:
    rolls = [random.randint(1, 6) for _ in range(3)]
    return {"rolls": rolls, "total": sum(rolls)}


def _roll_hp() -> dict:
    physical = [random.randint(1, 6)]
    spiritual = [random.randint(1, 4)]
    return {
        "hp_rolls": physical,
        "hp_total": max(1, sum(physical)),
        "spirit_hp_rolls": spiritual,
        "spirit_hp_total": max(1, sum(spiritual)),
        "hp_die": 6,
        "spirit_hp_die": 4,
    }


@router.post("/{char_id}/knave/profile")
async def knave_profile(char_id: int, body: KnaveProfileBody, db: AsyncSession = Depends(get_session)):
    char, ws = await _ensure_state(char_id, db)
    await _ensure_knave_session(char, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    data["rules_system"] = "knave_like"
    data["knave_profile"] = body.profile or {}
    _save_data(ws, data)
    if ws.current_step < 2:
        ws.current_step = 2
    await db.commit()
    await db.refresh(ws)
    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return _ser(ws)


@router.post("/{char_id}/knave/roll-stats")
async def knave_roll_stats(char_id: int, db: AsyncSession = Depends(get_session)):
    char, ws = await _ensure_state(char_id, db)
    await _ensure_knave_session(char, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "knave_stats" in data:
        return {"already_rolled": True, "stats": data["knave_stats"], "state": _ser(ws)}

    stats = {stat: _roll_3d6() for stat in KNAVE_STATS}
    for stat, roll in stats.items():
        setattr(char, stat, int(roll["total"]))
    char.declined_stats = False
    data["rules_system"] = "knave_like"
    data["knave_stats"] = stats
    data["stat_swap_used"] = False
    _save_data(ws, data)
    if ws.current_step < 3:
        ws.current_step = 3
    await db.commit()
    await db.refresh(ws)
    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return {"stats": stats, "state": _ser(ws)}


@router.post("/{char_id}/knave/swap-stats")
async def knave_swap_stats(char_id: int, body: KnaveStatSwapBody, db: AsyncSession = Depends(get_session)):
    char, ws = await _ensure_state(char_id, db)
    await _ensure_knave_session(char, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    stat_a = body.stat_a.lower()
    stat_b = body.stat_b.lower()
    if stat_a not in KNAVE_STATS or stat_b not in KNAVE_STATS or stat_a == stat_b:
        raise HTTPException(400, "Choose two different valid stats")
    data = _data(ws)
    if "knave_stats" not in data:
        raise HTTPException(400, "Roll stats first")
    if data.get("stat_swap_used"):
        raise HTTPException(400, "Stat swap already used")

    before = {stat_a: getattr(char, stat_a), stat_b: getattr(char, stat_b)}
    val_a = getattr(char, stat_a)
    val_b = getattr(char, stat_b)
    setattr(char, stat_a, val_b)
    setattr(char, stat_b, val_a)
    data["stat_swap_used"] = True
    data["stat_swap"] = {"stat_a": stat_a, "stat_b": stat_b, "before": before, "after": {stat_a: val_b, stat_b: val_a}}
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)
    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return _ser(ws)


@router.post("/{char_id}/knave/roll-hp")
async def knave_roll_hp(char_id: int, db: AsyncSession = Depends(get_session)):
    char, ws = await _ensure_state(char_id, db)
    await _ensure_knave_session(char, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "knave_hp" in data:
        return {"already_rolled": True, "hp": data["knave_hp"], "state": _ser(ws)}

    hp = _roll_hp()
    char.max_hp = hp["hp_total"]
    char.current_hp = hp["hp_total"]
    char.spiritual_max_hp = hp["spirit_hp_total"]
    char.spiritual_hp = hp["spirit_hp_total"]
    char.armor_class = 0
    char.max_inventory_slots = 10 + max(0, int(char.constitution or 0))
    data["knave_hp"] = hp
    data["knave_hp_reroll_used"] = False
    _save_data(ws, data)
    if ws.current_step < 4:
        ws.current_step = 4
    await db.commit()
    await db.refresh(ws)
    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return {"hp": hp, "state": _ser(ws)}


@router.post("/{char_id}/knave/reroll-hp")
async def knave_reroll_hp(char_id: int, body: KnaveHpRerollBody, db: AsyncSession = Depends(get_session)):
    char, ws = await _ensure_state(char_id, db)
    await _ensure_knave_session(char, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "knave_hp" not in data:
        raise HTTPException(400, "Roll HP first")
    if data.get("knave_hp_reroll_used"):
        raise HTTPException(400, "HP reroll already used")

    reroll_type = body.reroll_type if body.reroll_type in ("physical", "spiritual", "both") else "physical"
    old_hp = data["knave_hp"]
    new_hp = dict(old_hp)
    if reroll_type in ("physical", "both"):
        rolls = [random.randint(1, 6)]
        new_hp["hp_rolls"] = rolls
        new_hp["hp_total"] = max(1, sum(rolls))
        char.max_hp = new_hp["hp_total"]
        char.current_hp = new_hp["hp_total"]
    if reroll_type in ("spiritual", "both"):
        rolls = [random.randint(1, 4)]
        new_hp["spirit_hp_rolls"] = rolls
        new_hp["spirit_hp_total"] = max(1, sum(rolls))
        char.spiritual_max_hp = new_hp["spirit_hp_total"]
        char.spiritual_hp = new_hp["spirit_hp_total"]
    data["knave_hp_before_reroll"] = old_hp
    data["knave_hp"] = new_hp
    data["knave_hp_reroll_used"] = True
    data["knave_hp_reroll_type"] = reroll_type
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)
    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return {"hp": new_hp, "state": _ser(ws)}


@router.post("/{char_id}/knave/finalize")
async def knave_finalize(char_id: int, db: AsyncSession = Depends(get_session)):
    char, ws = await _ensure_state(char_id, db)
    await _ensure_knave_session(char, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "knave_stats" not in data:
        raise HTTPException(400, "Roll stats first")
    if "knave_hp" not in data:
        raise HTTPException(400, "Roll HP first")
    ws.is_completed = True
    ws.current_step = 6
    data["knave_finalize"] = {"max_hp": char.max_hp, "spiritual_max_hp": char.spiritual_max_hp, "slots": char.max_inventory_slots}
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)
    await _broadcast(char.session_id, "wizard.completed", {"character_id": char_id, "rules_system": "knave_like"})
    return _ser(ws)
