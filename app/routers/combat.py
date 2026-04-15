"""Combat calculation endpoints — damage intake, attack roll, damage roll, HP recovery."""

import random
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.database import get_session
from app.models import Character, InventoryItem, CharacterStatusEffect
from app.schemas import DamageIntakeRequest, HpRecoveryRequest
from app.game_mechanics import (
    calculate_damage_intake, calculate_attack_roll,
    calculate_damage_roll, calculate_hp_recovery, calculate_enemy_damage,
    get_all_active_bonuses, aggregate_status_penalties,
    apply_advantage, format_advantage_breakdown, resolve_advantage_mode,
)
import json as _json


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


async def _load_status_penalties(character_id: int, db: AsyncSession) -> dict:
    """Load active status effects and aggregate penalties."""
    status_result = await db.execute(
        select(CharacterStatusEffect).where(
            CharacterStatusEffect.character_id == character_id,
            CharacterStatusEffect.remaining_turns != 0,
        )
    )
    active_effects = status_result.scalars().all()
    effects_list = []
    for se in active_effects:
        try:
            effects_list.append(_json.loads(se.effects) if se.effects else [])
        except Exception:
            effects_list.append([])
    return aggregate_status_penalties(effects_list)

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

    # Build breakdown string
    parts = [f"Roll({body.enemy_roll}) vs KD({c.armor_class})"]
    parts.append(f"→ {result.tier_label}({result.multiplier:.0%})")
    if result.effect_breakdown:
        for eb in result.effect_breakdown:
            parts.append(f"{eb.get('source', 'Effect')}({eb.get('value', 0):+.0f}%)")
    parts.append(f"= {result.final_damage} dmg")
    breakdown = " ".join(parts)

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
        "breakdown": breakdown,
    }


# ── Attack roll ──────────────────────────────────────────────
@router.post("/attack-roll")
async def calc_attack_roll(body: dict, db: AsyncSession = Depends(get_session)):
    d20 = body.get("d20", 0)
    base_mod = body.get("base_mod", 0)
    modifier_values = body.get("modifier_values", [])
    character_id = body.get("character_id")
    advantage_mode = body.get("advantage_mode", "normal")

    item_bonuses = await _load_item_bonuses(character_id, db) if character_id else None
    penalties = await _load_status_penalties(character_id, db) if character_id else None
    item_atk = int(item_bonuses.get("attack_bonus", 0)) if item_bonuses else 0
    status_atk = penalties.get("attack_penalty", 0) if penalties else 0
    advantage_mode = resolve_advantage_mode(advantage_mode, penalties)

    # If advantage/disadvantage, do server-side rolling
    if advantage_mode in ("advantage", "disadvantage"):
        def _single():
            d = random.randint(1, 20)
            t = d + base_mod + sum(modifier_values) + item_atk + status_atk
            return t, d
        adv = apply_advantage(_single, advantage_mode)
        d20 = adv.all_details[adv.chosen_index]
        result = calculate_attack_roll(d20, base_mod, modifier_values, item_bonuses=item_bonuses, status_penalties=penalties)
        adv_bd = format_advantage_breakdown(advantage_mode, list(adv.all_details), adv.chosen_index, "D20")
        all_d20s = list(adv.all_details)
        chosen_idx = adv.chosen_index
    else:
        result = calculate_attack_roll(d20, base_mod, modifier_values, item_bonuses=item_bonuses, status_penalties=penalties)
        adv_bd = ""
        all_d20s = [d20]
        chosen_idx = 0

    # Build breakdown string
    parts = [f"D20({d20})"]
    if base_mod: parts.append(f"Base mod({base_mod:+d})")
    for i, v in enumerate(modifier_values):
        if v: parts.append(f"Mod{i+1}({v:+d})")
    if item_atk: parts.append(f"Items({item_atk:+d})")
    if status_atk: parts.append(f"Status({status_atk:+d})")
    adv_prefix = f"({adv_bd}) " if adv_bd else ""
    breakdown = f"{adv_prefix}{' + '.join(parts)} = {result.total}"

    return {
        "d20": result.d20, "base_mod": result.base_mod,
        "modifier_values": result.modifier_values,
        "total": result.total, "attack_bonus": result.attack_bonus,
        "item_attack_bonus": item_atk,
        "status_attack_penalty": status_atk,
        "breakdown": breakdown,
        "advantage_mode": advantage_mode,
        "all_d20s": all_d20s,
        "chosen_d20_index": chosen_idx,
        "advantage_breakdown": adv_bd,
    }


# ── Damage roll ──────────────────────────────────────────────
@router.post("/damage-roll")
async def calc_damage_roll(body: dict, db: AsyncSession = Depends(get_session)):
    weapon_bonus = body.get("weapon_bonus", 0)
    attack_bonus = body.get("attack_bonus", 0)
    modifier_values = body.get("modifier_values", [])
    character_id = body.get("character_id")
    advantage_mode = body.get("advantage_mode", "normal")

    dice_groups = body.get("dice_groups", None)
    if dice_groups is None:
        dice_count = body.get("dice_count", 1)
        die_type = body.get("die_type", 8)
        dice_groups = [{"count": dice_count, "die": die_type, "active": True}]

    item_bonuses = await _load_item_bonuses(character_id, db) if character_id else None
    penalties = await _load_status_penalties(character_id, db) if character_id else None
    advantage_mode = resolve_advantage_mode(advantage_mode, penalties)

    # Advantage/disadvantage: roll twice, pick best/worst
    if advantage_mode in ("advantage", "disadvantage"):
        def _roll_once():
            r = calculate_damage_roll(dice_groups, weapon_bonus, attack_bonus, modifier_values, item_bonuses=item_bonuses, status_penalties=penalties)
            return r.total, r
        adv = apply_advantage(_roll_once, advantage_mode)
        result = adv.all_details[adv.chosen_index]
        other_result = adv.all_details[1 - adv.chosen_index] if len(adv.all_details) > 1 else None
        adv_bd = format_advantage_breakdown(advantage_mode, adv.all_totals, adv.chosen_index, "Dmg")
    else:
        result = calculate_damage_roll(dice_groups, weapon_bonus, attack_bonus, modifier_values, item_bonuses=item_bonuses, status_penalties=penalties)
        adv_bd = ""

    # Build breakdown string
    item_dmg = int(item_bonuses.get("damage_bonus", 0)) if item_bonuses else 0
    status_dmg = penalties.get("damage_penalty", 0) if penalties else 0
    dice_str = ", ".join(str(r) for r in result.rolls)
    parts = [f"Dice[{dice_str}]"]
    if weapon_bonus: parts.append(f"Weapon({weapon_bonus:+d})")
    if attack_bonus: parts.append(f"AtkBonus({attack_bonus:+d})")
    mod_total = sum(modifier_values)
    if mod_total: parts.append(f"Mods({mod_total:+d})")
    if item_dmg: parts.append(f"Items({item_dmg:+d})")
    if status_dmg: parts.append(f"Status({status_dmg:+d})")
    adv_prefix = f"({adv_bd}) " if adv_bd else ""
    breakdown = f"{adv_prefix}{' + '.join(parts)} = {result.total}"

    return {
        "rolls": result.rolls,
        "group_results": result.group_results,
        "weapon_bonus": result.weapon_bonus,
        "attack_bonus": result.attack_bonus,
        "modifier_values": modifier_values,
        "total": result.total,
        "item_damage_bonus": item_dmg,
        "status_damage_penalty": status_dmg,
        "breakdown": breakdown,
        "advantage_mode": advantage_mode,
        "advantage_breakdown": adv_bd,
    }


# ── HP Recovery ──────────────────────────────────────────────
@router.post("/hp-recovery")
async def calc_hp_recovery(body: HpRecoveryRequest, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, body.character_id)
    if not c:
        raise HTTPException(404, "Character not found")

    item_bonuses = await _load_item_bonuses(c.id, db)
    penalties = await _load_status_penalties(c.id, db)
    advantage_mode = resolve_advantage_mode(body.advantage_mode or "normal", penalties)

    # Advantage/disadvantage: roll twice, pick best/worst
    if advantage_mode in ("advantage", "disadvantage"):
        def _roll_once():
            r = calculate_hp_recovery(
                current_hp=c.current_hp, max_hp=c.max_hp,
                dice_count=body.dice_count, die_type=body.die_type,
                modifier=body.modifier, item_bonuses=item_bonuses,
            )
            return r.heal_amount, r
        adv = apply_advantage(_roll_once, advantage_mode)
        result = adv.all_details[adv.chosen_index]
        adv_bd = format_advantage_breakdown(advantage_mode, adv.all_totals, adv.chosen_index, "Heal")
    else:
        result = calculate_hp_recovery(
            current_hp=c.current_hp, max_hp=c.max_hp,
            dice_count=body.dice_count, die_type=body.die_type,
            modifier=body.modifier, item_bonuses=item_bonuses,
        )
        adv_bd = ""

    c.current_hp = result.new_hp
    c.is_alive = c.current_hp > 0
    await db.commit()

    # Build breakdown string
    item_hp = int(item_bonuses.get("hp_bonus", 0)) if item_bonuses else 0
    dice_str = ", ".join(str(r) for r in result.rolls)
    parts = [f"Dice[{dice_str}]"]
    if body.modifier: parts.append(f"Mod({body.modifier:+d})")
    if item_hp: parts.append(f"Items({item_hp:+d})")
    adv_prefix = f"({adv_bd}) " if adv_bd else ""
    breakdown = f"{adv_prefix}{' + '.join(parts)} = +{result.heal_amount} HP"

    return {
        "rolls": result.rolls,
        "modifier": result.modifier,
        "total_heal": result.heal_amount,
        "new_hp": result.new_hp,
        "max_hp": result.max_hp,
        "item_hp_bonus": item_hp,
        "breakdown": breakdown,
        "advantage_mode": advantage_mode,
        "advantage_breakdown": adv_bd,
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
