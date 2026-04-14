"""
Pure calculation functions for all game mechanics.
No database access — route handlers call these and handle DB.

CUSTOM DAMAGE FORMULA (SACRED — do not modify):
    hit_diff = enemy_roll - character_kd
    hit_diff <= 0  → MISS (0%)
    hit_diff 1-2   → 50%
    hit_diff 3-4   → 60%
    hit_diff 5-6   → 70%
    hit_diff 7-8   → 80%
    hit_diff 9-10  → 90%
    hit_diff 11+   → 100%

Effect application: percent reductions ADD to tier reduction (not multiply).
    Example: tier 70% (30% reduction) + effect 10% = 40% total reduction → 60% damage
Flat reductions subtracted after percent.
"""

import math
import random
from dataclasses import dataclass, field
from typing import Any


# ══════════════════════════════════════════════════════════════
# DATA CLASSES
# ══════════════════════════════════════════════════════════════
@dataclass
class DamageResult:
    hit: bool
    multiplier: float
    tier_label: str
    final_damage: int
    breakdown: str
    # Detailed fields for frontend
    hit_diff: int = 0
    tier_reduction_pct: float = 0
    total_percent_reduction: float = 0
    combined_multiplier: float = 0
    base_damage: float = 0
    after_percent: float = 0
    flat_sum: float = 0
    effect_breakdown: list = field(default_factory=list)


@dataclass
class AttackResult:
    d20: int
    base_mod: int
    modifier_values: list
    total: int
    attack_bonus: int


@dataclass
class DamageRollResult:
    rolls: list
    group_results: list
    weapon_bonus: int
    attack_bonus: int
    mod_total: int
    total: int


@dataclass
class HealResult:
    rolls: list
    modifier: int
    heal_amount: int
    new_hp: int
    max_hp: int


# ══════════════════════════════════════════════════════════════
# EQUIPPED ITEM BONUS AGGREGATION
# ══════════════════════════════════════════════════════════════
def get_all_active_bonuses(equipped_items: list[Any]) -> dict:
    """
    Aggregates bonuses from all equipped inventory items.
    equipped_items: list of InventoryItem ORM objects with .item.bonuses loaded.
    Returns dict: {
      "percent_damage_reduction": float,
      "flat_damage_reduction": float,
      "attack_bonus": float,
      "damage_bonus": float,
      "damage_dice_count": float,
      "damage_dice_type": float,
      "hp_bonus": float,
      "initiative_bonus": float,
      "speed_bonus": float,
      "stat_bonus_strength": float, ...
      "breakdown": [{"source": str, "bonus_type": str, "stat_name": str|None, "value": float}]
    }
    """
    result = {
        "percent_damage_reduction": 0,
        "flat_damage_reduction": 0,
        "attack_bonus": 0,
        "damage_bonus": 0,
        "damage_dice_count": 0,
        "damage_dice_type": 0,
        "hp_bonus": 0,
        "initiative_bonus": 0,
        "speed_bonus": 0,
        "breakdown": [],
    }
    for inv in equipped_items:
        if not inv.is_equipped or not inv.item:
            continue
        item = inv.item
        for bonus in (item.bonuses or []):
            if bonus.is_conditional:
                continue  # skip conditional bonuses (only applied manually)
            bt = bonus.bonus_type
            val = bonus.value or 0
            entry = {"source": item.name, "bonus_type": bt, "stat_name": bonus.stat_name, "value": val}
            result["breakdown"].append(entry)
            if bt == "stat_bonus" and bonus.stat_name:
                key = f"stat_bonus_{bonus.stat_name}"
                result[key] = result.get(key, 0) + val
            elif bt in result and bt != "breakdown":
                result[bt] += val
    return result


# ══════════════════════════════════════════════════════════════
# CURRENCY HELPERS
# ══════════════════════════════════════════════════════════════
DEFAULT_RATES = {"platinum": 1000, "gold": 100, "silver": 10, "copper": 1}


def copper_to_display(copper: int, rates: dict | None = None) -> dict:
    """Convert a total copper value into multi-currency breakdown."""
    r = rates or DEFAULT_RATES
    remainder = max(0, copper)
    platinum = remainder // r["platinum"]
    remainder %= r["platinum"]
    gold = remainder // r["gold"]
    remainder %= r["gold"]
    silver = remainder // r["silver"]
    remainder %= r["silver"]
    return {"platinum": platinum, "gold": gold, "silver": silver, "copper": remainder}


def display_to_copper(platinum: int = 0, gold: int = 0, silver: int = 0, copper: int = 0,
                      rates: dict | None = None) -> int:
    """Convert multi-currency amounts to total copper."""
    r = rates or DEFAULT_RATES
    return platinum * r["platinum"] + gold * r["gold"] + silver * r["silver"] + copper * r["copper"]


def calculate_item_price(base_price_copper: int, reputation: int = 0,
                         price_override: int | None = None) -> int:
    """
    Calculate item price adjusted by NPC reputation.
    reputation: -100 = prices doubled, 0 = normal, +100 = 50% discount
    """
    base = price_override if price_override is not None else base_price_copper
    multiplier = 1.0 - (reputation / 200.0)  # range: 1.5x to 0.5x
    return max(1, int(base * multiplier))


# ══════════════════════════════════════════════════════════════
# STATUS EFFECT PENALTIES (Stage 4)
# ══════════════════════════════════════════════════════════════
def aggregate_status_penalties(active_effects_json_list: list[list[dict]]) -> dict:
    """
    Aggregates mechanical penalties from all active status effects on a character.
    active_effects_json_list: list of parsed effects JSON arrays (one per CharacterStatusEffect).
    Returns dict of aggregated penalties.
    """
    result = {
        "attack_penalty": 0,
        "damage_penalty": 0,
        "stat_penalties": {},  # {stat_name: total_penalty}
        "damage_reduction_penalty": 0.0,
        "skip_turn": False,
        "hp_change_per_turn": 0,
        "custom_notes": [],
    }
    for effects in active_effects_json_list:
        for eff in effects:
            etype = eff.get("type", "")
            val = eff.get("value", 0)
            if etype == "attack_penalty":
                result["attack_penalty"] += val
            elif etype == "damage_penalty":
                result["damage_penalty"] += val
            elif etype == "stat_penalty":
                stat = eff.get("stat", "")
                if stat:
                    result["stat_penalties"][stat] = result["stat_penalties"].get(stat, 0) + val
            elif etype == "skip_turn":
                if val:
                    result["skip_turn"] = True
            elif etype == "hp_change_per_turn":
                result["hp_change_per_turn"] += val
            elif etype == "damage_reduction_penalty":
                result["damage_reduction_penalty"] += val
            elif etype == "custom_note":
                result["custom_notes"].append(eff.get("text", ""))
    return result


# ══════════════════════════════════════════════════════════════
# DAMAGE MULTIPLIER TABLE
# ══════════════════════════════════════════════════════════════
def _get_damage_multiplier(hit_diff: int) -> float:
    if hit_diff <= 0:
        return 0.0
    elif hit_diff <= 2:
        return 0.50
    elif hit_diff <= 4:
        return 0.60
    elif hit_diff <= 6:
        return 0.70
    elif hit_diff <= 8:
        return 0.80
    elif hit_diff <= 10:
        return 0.90
    else:
        return 1.00


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


# ══════════════════════════════════════════════════════════════
# 1. DAMAGE INTAKE
# ══════════════════════════════════════════════════════════════
def calculate_damage_intake(
    enemy_roll: int,
    character_kd: int,
    raw_damage: int,
    active_effects: list,  # list of dicts: {"name", "effect_type", "value"}
    item_bonuses: dict | None = None,  # from get_all_active_bonuses()
    status_penalties: dict | None = None,  # from aggregate_status_penalties()
) -> DamageResult:
    hit_diff = enemy_roll - character_kd
    multiplier = _get_damage_multiplier(hit_diff)
    tier_label = _multiplier_label(hit_diff)

    if hit_diff <= 0:
        return DamageResult(
            hit=False, multiplier=0, tier_label=tier_label,
            final_damage=0, breakdown=f"Diff: {hit_diff} → MISS",
            hit_diff=hit_diff,
        )

    # Percent reductions ADD to tier reduction
    tier_reduction_pct = (1.0 - multiplier) * 100.0
    total_percent_reduction = tier_reduction_pct
    flat_sum = 0.0
    effect_breakdown = []

    for e in active_effects:
        etype = e.get("effect_type") or e.get("type", "")
        if etype == "percent_reduction":
            total_percent_reduction += e["value"]
            effect_breakdown.append({"name": e["name"], "type": "percent_reduction", "value": e["value"]})
        elif etype == "flat_reduction":
            flat_sum += e["value"]
            effect_breakdown.append({"name": e["name"], "type": "flat_reduction", "value": e["value"]})

    # Apply status effect damage reduction penalty (makes character MORE vulnerable)
    if status_penalties and status_penalties.get("damage_reduction_penalty"):
        drp = status_penalties["damage_reduction_penalty"]
        total_percent_reduction += drp  # negative value = less protection
        effect_breakdown.append({"name": "Status effects", "type": "percent_reduction", "value": drp})

    # Apply equipped item bonuses
    if item_bonuses:
        ib_pdr = item_bonuses.get("percent_damage_reduction", 0)
        ib_fdr = item_bonuses.get("flat_damage_reduction", 0)
        if ib_pdr:
            total_percent_reduction += ib_pdr
            # Build breakdown entries from item sources
            for bd in item_bonuses.get("breakdown", []):
                if bd["bonus_type"] == "percent_damage_reduction":
                    effect_breakdown.append({"name": bd["source"], "type": "percent_reduction", "value": bd["value"]})
        if ib_fdr:
            flat_sum += ib_fdr
            for bd in item_bonuses.get("breakdown", []):
                if bd["bonus_type"] == "flat_damage_reduction":
                    effect_breakdown.append({"name": bd["source"], "type": "flat_reduction", "value": bd["value"]})

    total_percent_reduction = min(total_percent_reduction, 100.0)
    combined_multiplier = 1.0 - total_percent_reduction / 100.0
    base_damage = raw_damage * combined_multiplier
    after_percent = base_damage
    final_damage = max(0, math.floor(after_percent - flat_sum))

    # Build breakdown string
    breakdown = f"Diff: {hit_diff} → {tier_label}"
    breakdown += f"\nTier reduction: {tier_reduction_pct:.0f}%"
    for eb in effect_breakdown:
        if eb["type"] == "percent_reduction":
            breakdown += f" + {eb['name']}: {eb['value']}%"
        else:
            breakdown += f"\n{eb['name']}: -{eb['value']} flat"
    breakdown += f"\nTotal reduction: {total_percent_reduction:.1f}% → ×{combined_multiplier:.4f}"
    breakdown += f"\n{raw_damage} × {combined_multiplier:.4f} = {base_damage:.2f}"
    if flat_sum > 0:
        breakdown += f" - {flat_sum} flat"
    breakdown += f"\nFinal: {final_damage} damage"

    return DamageResult(
        hit=True, multiplier=multiplier, tier_label=tier_label,
        final_damage=final_damage, breakdown=breakdown,
        hit_diff=hit_diff,
        tier_reduction_pct=round(tier_reduction_pct, 1),
        total_percent_reduction=round(total_percent_reduction, 1),
        combined_multiplier=round(combined_multiplier, 4),
        base_damage=round(base_damage, 2),
        after_percent=round(after_percent, 2),
        flat_sum=flat_sum,
        effect_breakdown=effect_breakdown,
    )


# ══════════════════════════════════════════════════════════════
# 2. ATTACK ROLL
# ══════════════════════════════════════════════════════════════
def calculate_attack_roll(
    d20: int,
    base_modifier: int,
    active_modifier_values: list[int],
    item_bonuses: dict | None = None,
    status_penalties: dict | None = None,  # from aggregate_status_penalties()
) -> AttackResult:
    item_atk = int(item_bonuses.get("attack_bonus", 0)) if item_bonuses else 0
    status_atk = status_penalties.get("attack_penalty", 0) if status_penalties else 0
    total = d20 + base_modifier + sum(active_modifier_values) + item_atk + status_atk
    attack_bonus = (total // 5) * 2
    return AttackResult(
        d20=d20, base_mod=base_modifier,
        modifier_values=active_modifier_values,
        total=total, attack_bonus=attack_bonus,
    )


# ══════════════════════════════════════════════════════════════
# 3. DAMAGE ROLL (multi-group)
# ══════════════════════════════════════════════════════════════
def calculate_damage_roll(
    dice_groups: list[dict],  # [{"count": N, "die": D, "active": bool}]
    weapon_bonus: int,
    attack_bonus: int,
    active_modifier_values: list[int],
    item_bonuses: dict | None = None,
    status_penalties: dict | None = None,  # from aggregate_status_penalties()
) -> DamageRollResult:
    item_dmg = int(item_bonuses.get("damage_bonus", 0)) if item_bonuses else 0
    status_dmg = status_penalties.get("damage_penalty", 0) if status_penalties else 0
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

    mod_total = sum(active_modifier_values)
    total = max(0, sum(all_rolls) + weapon_bonus + attack_bonus + mod_total + item_dmg + status_dmg)

    return DamageRollResult(
        rolls=all_rolls, group_results=group_results,
        weapon_bonus=weapon_bonus, attack_bonus=attack_bonus,
        mod_total=mod_total, total=total,
    )


# ══════════════════════════════════════════════════════════════
# 4. HP RECOVERY
# ══════════════════════════════════════════════════════════════
def calculate_hp_recovery(
    current_hp: int,
    max_hp: int,
    dice_count: int,
    die_type: int,
    modifier: int,
    item_bonuses: dict | None = None,
) -> HealResult:
    item_hp = int(item_bonuses.get("hp_bonus", 0)) if item_bonuses else 0
    rolls = [random.randint(1, die_type) for _ in range(dice_count)]
    heal_amount = max(0, sum(rolls) + modifier + item_hp)
    new_hp = min(max_hp, current_hp + heal_amount)
    return HealResult(
        rolls=rolls, modifier=modifier,
        heal_amount=heal_amount, new_hp=new_hp, max_hp=max_hp,
    )


# ══════════════════════════════════════════════════════════════
# 5. ENEMY DAMAGE CALC (standalone)
# ══════════════════════════════════════════════════════════════
def calculate_enemy_damage(
    my_roll: int,
    enemy_kd: int,
    damage_rolled: int,
    defense_bonuses: list[dict],  # [{"type": "percent"/"flat", "value": N}]
) -> dict:
    hit_diff = my_roll - enemy_kd
    multiplier = _get_damage_multiplier(hit_diff)
    tier_label = _multiplier_label(hit_diff)
    base_damage = damage_rolled * multiplier

    for b in defense_bonuses:
        if b.get("type") == "percent":
            base_damage *= (1 - b["value"] / 100)
        elif b.get("type") == "flat":
            base_damage -= b["value"]

    final = max(0, math.floor(base_damage))
    return {
        "hit_diff": hit_diff, "multiplier": multiplier, "tier_label": tier_label,
        "base_damage": round(damage_rolled * multiplier, 2),
        "final_damage": final,
    }
