import math
import random
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_session
from models import Character, CharacterEffect, TurnTimer

router = APIRouter(prefix="/api", tags=["characters"])


# ── Pydantic schemas ──────────────────────────────────────────────

class CharacterCreate(BaseModel):
    name: str
    armor_class: int = 10
    max_hp: int = 20
    current_hp: Optional[int] = None
    strength: int = 10
    dexterity: int = 10
    constitution: int = 10
    intelligence: int = 10
    wisdom: int = 10
    charisma: int = 10
    hp_dice_count: int = 2
    hp_dice_type: int = 12
    hp_recovery_modifier: int = 0


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    armor_class: Optional[int] = None
    max_hp: Optional[int] = None
    current_hp: Optional[int] = None
    strength: Optional[int] = None
    dexterity: Optional[int] = None
    constitution: Optional[int] = None
    intelligence: Optional[int] = None
    wisdom: Optional[int] = None
    charisma: Optional[int] = None
    hp_dice_count: Optional[int] = None
    hp_dice_type: Optional[int] = None
    hp_recovery_modifier: Optional[int] = None


class HPPatch(BaseModel):
    delta: Optional[int] = None
    set: Optional[int] = None


class DamageIntakeRequest(BaseModel):
    character_id: int
    enemy_roll: int
    damage_rolled: int


class HPRecoveryRequest(BaseModel):
    character_id: int
    dice_count: int
    die_type: int
    modifier: int = 0


# ── Helpers ───────────────────────────────────────────────────────

def _char_to_dict(c: Character) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "armor_class": c.armor_class,
        "current_hp": c.current_hp,
        "max_hp": c.max_hp,
        "strength": c.strength,
        "dexterity": c.dexterity,
        "constitution": c.constitution,
        "intelligence": c.intelligence,
        "wisdom": c.wisdom,
        "charisma": c.charisma,
        "hp_dice_count": c.hp_dice_count,
        "hp_dice_type": c.hp_dice_type,
        "hp_recovery_modifier": c.hp_recovery_modifier,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "effects": [
            {"id": e.id, "name": e.name, "effect_type": e.effect_type, "value": e.value, "is_active": e.is_active}
            for e in c.effects
        ],
        "stat_modifiers": [
            {"id": m.id, "stat_name": m.stat_name, "name": m.name, "value": m.value, "is_active": m.is_active}
            for m in c.stat_modifiers
        ],
        "attack_modifiers": [
            {"id": m.id, "name": m.name, "value": m.value, "is_active": m.is_active}
            for m in c.attack_modifiers
        ],
        "damage_modifiers": [
            {"id": m.id, "name": m.name, "value": m.value, "is_active": m.is_active}
            for m in c.damage_modifiers
        ],
        "turn_count": c.turn_count,
        "turn_timers": [
            {"id": t.id, "name": t.name, "initial_value": t.initial_value,
             "current_value": t.current_value, "is_active": t.is_active}
            for t in c.turn_timers
        ],
    }


def _get_damage_multiplier(hit_diff: int) -> float:
    if hit_diff <= 0:
        return 0.0
    elif hit_diff <= 2:
        return 0.5
    elif hit_diff <= 4:
        return 0.6
    elif hit_diff <= 6:
        return 0.7
    elif hit_diff <= 8:
        return 0.8
    elif hit_diff <= 10:
        return 0.9
    else:
        return 1.0


def _multiplier_label(hit_diff: int) -> str:
    if hit_diff <= 0:
        return "MISS — 0%"
    elif hit_diff <= 2:
        return "50%"
    elif hit_diff <= 4:
        return "60%"
    elif hit_diff <= 6:
        return "70%"
    elif hit_diff <= 8:
        return "80%"
    elif hit_diff <= 10:
        return "90%"
    else:
        return "100%"


# ── Routes ────────────────────────────────────────────────────────

@router.get("/characters")
async def list_characters(db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Character).order_by(Character.id))
    chars = result.scalars().all()
    return [_char_to_dict(c) for c in chars]


@router.post("/characters", status_code=201)
async def create_character(body: CharacterCreate, db: AsyncSession = Depends(get_session)):
    c = Character(
        name=body.name,
        armor_class=body.armor_class,
        max_hp=body.max_hp,
        current_hp=body.current_hp if body.current_hp is not None else body.max_hp,
        strength=body.strength,
        dexterity=body.dexterity,
        constitution=body.constitution,
        intelligence=body.intelligence,
        wisdom=body.wisdom,
        charisma=body.charisma,
        hp_dice_count=body.hp_dice_count,
        hp_dice_type=body.hp_dice_type,
        hp_recovery_modifier=body.hp_recovery_modifier,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _char_to_dict(c)


@router.get("/characters/{char_id}")
async def get_character(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    return _char_to_dict(c)


@router.put("/characters/{char_id}")
async def update_character(char_id: int, body: CharacterUpdate, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(c, field, val)
    if c.current_hp > c.max_hp:
        c.current_hp = c.max_hp
    await db.commit()
    await db.refresh(c)
    return _char_to_dict(c)


@router.delete("/characters/{char_id}")
async def delete_character(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


@router.patch("/characters/{char_id}/hp")
async def patch_hp(char_id: int, body: HPPatch, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    if body.set is not None:
        c.current_hp = max(0, min(c.max_hp, body.set))
    elif body.delta is not None:
        c.current_hp = max(0, min(c.max_hp, c.current_hp + body.delta))
    else:
        raise HTTPException(400, "Provide 'delta' or 'set'")
    await db.commit()
    await db.refresh(c)
    return {"current_hp": c.current_hp, "max_hp": c.max_hp}


# ── Calculations ──────────────────────────────────────────────────

@router.post("/calc/damage-intake")
async def calc_damage_intake(body: DamageIntakeRequest, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, body.character_id)
    if not c:
        raise HTTPException(404, "Character not found")

    hit_diff = body.enemy_roll - c.armor_class
    multiplier = _get_damage_multiplier(hit_diff)
    tier_label = _multiplier_label(hit_diff)

    base_damage = body.damage_rolled * multiplier

    # Apply effects
    effect_breakdown = []
    percent_product = 1.0
    flat_sum = 0.0

    active_effects = [e for e in c.effects if e.is_active]
    for e in active_effects:
        if e.effect_type == "percent_reduction":
            factor = 1.0 - e.value / 100.0
            percent_product *= factor
            effect_breakdown.append({"name": e.name, "type": "percent_reduction", "value": e.value, "factor": factor})
        elif e.effect_type == "flat_reduction":
            flat_sum += e.value
            effect_breakdown.append({"name": e.name, "type": "flat_reduction", "value": e.value})

    after_percent = base_damage * percent_product
    final_damage = max(0, math.floor(after_percent - flat_sum))

    return {
        "enemy_roll": body.enemy_roll,
        "armor_class": c.armor_class,
        "hit_diff": hit_diff,
        "multiplier": multiplier,
        "tier_label": tier_label,
        "damage_rolled": body.damage_rolled,
        "base_damage": round(base_damage, 2),
        "effect_breakdown": effect_breakdown,
        "after_percent": round(after_percent, 2),
        "flat_sum": flat_sum,
        "final_damage": final_damage,
    }


@router.post("/calc/attack-roll")
async def calc_attack_roll(body: dict):
    d20 = body.get("d20", 0)
    base_mod = body.get("base_mod", 0)
    modifier_values = body.get("modifier_values", [])

    total = d20 + base_mod + sum(modifier_values)
    attack_bonus = math.floor(total / 5) * 2
    return {"d20": d20, "base_mod": base_mod, "modifier_values": modifier_values, "total": total, "attack_bonus": attack_bonus}


@router.post("/calc/damage-roll")
async def calc_damage_roll(body: dict):
    weapon_bonus = body.get("weapon_bonus", 0)
    attack_bonus = body.get("attack_bonus", 0)
    modifier_values = body.get("modifier_values", [])

    # Support multiple dice groups
    dice_groups = body.get("dice_groups", None)
    if dice_groups is None:
        # Fallback for legacy single-dice format
        dice_count = body.get("dice_count", 1)
        die_type = body.get("die_type", 8)
        dice_groups = [{"count": dice_count, "die": die_type, "active": True}]

    group_results = []
    all_rolls = []
    for g in dice_groups:
        if not g.get("active", True):
            continue
        cnt = max(1, g.get("count", 1))
        die = max(1, g.get("die", 8))
        rolls = [random.randint(1, die) for _ in range(cnt)]
        all_rolls.extend(rolls)
        group_results.append({"count": cnt, "die": die, "rolls": rolls, "subtotal": sum(rolls)})

    total = sum(all_rolls) + weapon_bonus + attack_bonus + sum(modifier_values)
    return {
        "rolls": all_rolls,
        "group_results": group_results,
        "weapon_bonus": weapon_bonus,
        "attack_bonus": attack_bonus,
        "modifier_values": modifier_values,
        "total": total,
    }


@router.post("/calc/enemy-damage")
async def calc_enemy_damage(body: dict):
    my_roll = body.get("my_roll", 0)
    enemy_kd = body.get("enemy_kd", 10)
    damage_rolled = body.get("damage_rolled", 0)
    defense_bonuses = body.get("defense_bonuses", [])

    hit_diff = my_roll - enemy_kd
    multiplier = _get_damage_multiplier(hit_diff)
    tier_label = _multiplier_label(hit_diff)
    base_damage = damage_rolled * multiplier

    percent_product = 1.0
    flat_sum = 0.0
    breakdown = []
    for d in defense_bonuses:
        if d.get("type") == "percent_reduction":
            factor = 1.0 - d["value"] / 100.0
            percent_product *= factor
            breakdown.append({"name": d.get("name", ""), "type": "percent_reduction", "value": d["value"], "factor": factor})
        elif d.get("type") == "flat_reduction":
            flat_sum += d["value"]
            breakdown.append({"name": d.get("name", ""), "type": "flat_reduction", "value": d["value"]})

    after_percent = base_damage * percent_product
    final_damage = max(0, math.floor(after_percent - flat_sum))

    return {
        "my_roll": my_roll,
        "enemy_kd": enemy_kd,
        "hit_diff": hit_diff,
        "multiplier": multiplier,
        "tier_label": tier_label,
        "damage_rolled": damage_rolled,
        "base_damage": round(base_damage, 2),
        "defense_breakdown": breakdown,
        "after_percent": round(after_percent, 2),
        "flat_sum": flat_sum,
        "final_damage": final_damage,
    }


@router.post("/calc/hp-recovery")
async def calc_hp_recovery(body: HPRecoveryRequest, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, body.character_id)
    if not c:
        raise HTTPException(404, "Character not found")

    rolls = [random.randint(1, body.die_type) for _ in range(body.dice_count)]
    total_heal = sum(rolls) + body.modifier
    new_hp = min(c.max_hp, c.current_hp + total_heal)
    c.current_hp = new_hp
    await db.commit()
    await db.refresh(c)

    return {
        "rolls": rolls,
        "modifier": body.modifier,
        "total_heal": total_heal,
        "new_hp": new_hp,
        "max_hp": c.max_hp,
    }


# ── Turn Counter ──────────────────────────────────────────────

@router.post("/characters/{char_id}/advance-turn")
async def advance_turn(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    c.turn_count += 1
    # Decrement active timers
    for t in c.turn_timers:
        if t.is_active and t.current_value > 0:
            t.current_value -= 1
    await db.commit()
    await db.refresh(c)
    return _char_to_dict(c)


@router.post("/characters/{char_id}/reset-turns")
async def reset_turns(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    c.turn_count = 0
    await db.commit()
    await db.refresh(c)
    return _char_to_dict(c)


class TurnTimerCreate(BaseModel):
    name: str = "Timer"
    initial_value: int = 3
    is_active: bool = True


class TurnTimerUpdate(BaseModel):
    name: Optional[str] = None
    initial_value: Optional[int] = None
    current_value: Optional[int] = None
    is_active: Optional[bool] = None


@router.post("/characters/{char_id}/turn-timers", status_code=201)
async def create_turn_timer(char_id: int, body: TurnTimerCreate, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    t = TurnTimer(character_id=char_id, name=body.name,
                  initial_value=body.initial_value, current_value=body.initial_value,
                  is_active=body.is_active)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "name": t.name, "initial_value": t.initial_value,
            "current_value": t.current_value, "is_active": t.is_active}


@router.put("/turn-timers/{timer_id}")
async def update_turn_timer(timer_id: int, body: TurnTimerUpdate, db: AsyncSession = Depends(get_session)):
    t = await db.get(TurnTimer, timer_id)
    if not t:
        raise HTTPException(404, "Timer not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(t, field, val)
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "name": t.name, "initial_value": t.initial_value,
            "current_value": t.current_value, "is_active": t.is_active}


@router.post("/turn-timers/{timer_id}/reset")
async def reset_turn_timer(timer_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(TurnTimer, timer_id)
    if not t:
        raise HTTPException(404, "Timer not found")
    t.current_value = t.initial_value
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "name": t.name, "initial_value": t.initial_value,
            "current_value": t.current_value, "is_active": t.is_active}


@router.delete("/turn-timers/{timer_id}")
async def delete_turn_timer(timer_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(TurnTimer, timer_id)
    if not t:
        raise HTTPException(404, "Timer not found")
    await db.delete(t)
    await db.commit()
    return {"ok": True}
