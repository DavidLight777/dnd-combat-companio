"""Combat calculation endpoints — damage intake, attack roll, damage roll, HP recovery."""

import random
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.database import get_session
from app.models import Character, InventoryItem
from app.schemas import DamageIntakeRequest, HpRecoveryRequest
from app.game_mechanics import (
    calculate_damage_intake, calculate_attack_roll,
    calculate_damage_roll, calculate_hp_recovery, calculate_enemy_damage,
    get_all_active_bonuses,
)


async def _load_item_bonuses(character_id: int, db: AsyncSession) -> dict:
    """Load equipped items for a character and aggregate their bonuses."""
    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == character_id,
            InventoryItem.is_equipped == True,
        )
    )
    equipped = result.scalars().all()
    return get_all_active_bonuses(equipped)

router = APIRouter(prefix="/api/calc", tags=["combat"])


# ── Damage intake ────────────────────────────────────────────
@router.post("/damage-intake")
async def calc_damage_intake(body: DamageIntakeRequest, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, body.character_id)
    if not c:
        raise HTTPException(404, "Character not found")

    active_effects = [
        {"name": e.name, "effect_type": e.effect_type, "value": e.value}
        for e in c.effects if e.is_active
    ]

    item_bonuses = await _load_item_bonuses(c.id, db)

    result = calculate_damage_intake(
        enemy_roll=body.enemy_roll,
        character_kd=c.armor_class,
        raw_damage=body.damage_rolled,
        active_effects=active_effects,
        item_bonuses=item_bonuses,
    )

    return {
        "enemy_roll": body.enemy_roll,
        "armor_class": c.armor_class,
        "hit_diff": result.hit_diff,
        "multiplier": result.multiplier,
        "tier_label": result.tier_label,
        "damage_rolled": body.damage_rolled,
        "base_damage": result.base_damage,
        "total_percent_reduction": result.total_percent_reduction,
        "combined_multiplier": result.combined_multiplier,
        "effect_breakdown": result.effect_breakdown,
        "after_percent": result.after_percent,
        "flat_sum": result.flat_sum,
        "final_damage": result.final_damage,
    }


# ── Attack roll ──────────────────────────────────────────────
@router.post("/attack-roll")
async def calc_attack_roll(body: dict, db: AsyncSession = Depends(get_session)):
    d20 = body.get("d20", 0)
    base_mod = body.get("base_mod", 0)
    modifier_values = body.get("modifier_values", [])
    character_id = body.get("character_id")

    item_bonuses = await _load_item_bonuses(character_id, db) if character_id else None
    result = calculate_attack_roll(d20, base_mod, modifier_values, item_bonuses=item_bonuses)
    return {
        "d20": result.d20, "base_mod": result.base_mod,
        "modifier_values": result.modifier_values,
        "total": result.total, "attack_bonus": result.attack_bonus,
    }


# ── Damage roll ──────────────────────────────────────────────
@router.post("/damage-roll")
async def calc_damage_roll(body: dict, db: AsyncSession = Depends(get_session)):
    weapon_bonus = body.get("weapon_bonus", 0)
    attack_bonus = body.get("attack_bonus", 0)
    modifier_values = body.get("modifier_values", [])
    character_id = body.get("character_id")

    dice_groups = body.get("dice_groups", None)
    if dice_groups is None:
        dice_count = body.get("dice_count", 1)
        die_type = body.get("die_type", 8)
        dice_groups = [{"count": dice_count, "die": die_type, "active": True}]

    item_bonuses = await _load_item_bonuses(character_id, db) if character_id else None
    result = calculate_damage_roll(dice_groups, weapon_bonus, attack_bonus, modifier_values, item_bonuses=item_bonuses)
    return {
        "rolls": result.rolls,
        "group_results": result.group_results,
        "weapon_bonus": result.weapon_bonus,
        "attack_bonus": result.attack_bonus,
        "modifier_values": modifier_values,
        "total": result.total,
    }


# ── HP Recovery ──────────────────────────────────────────────
@router.post("/hp-recovery")
async def calc_hp_recovery(body: HpRecoveryRequest, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, body.character_id)
    if not c:
        raise HTTPException(404, "Character not found")

    item_bonuses = await _load_item_bonuses(c.id, db)

    result = calculate_hp_recovery(
        current_hp=c.current_hp, max_hp=c.max_hp,
        dice_count=body.dice_count, die_type=body.die_type,
        modifier=body.modifier,
        item_bonuses=item_bonuses,
    )

    c.current_hp = result.new_hp
    c.is_alive = c.current_hp > 0
    await db.commit()

    return {
        "rolls": result.rolls,
        "modifier": result.modifier,
        "total_heal": result.heal_amount,
        "new_hp": result.new_hp,
        "max_hp": result.max_hp,
    }


# ── Enemy damage calc (standalone) ──────────────────────────
@router.post("/enemy-damage")
async def calc_enemy_damage(body: dict):
    result = calculate_enemy_damage(
        my_roll=body.get("my_roll", 0),
        enemy_kd=body.get("enemy_kd", 10),
        damage_rolled=body.get("damage_rolled", 0),
        defense_bonuses=body.get("defense_bonuses", []),
    )
    return result
