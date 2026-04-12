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
) -> AttackResult:
    total = d20 + base_modifier + sum(active_modifier_values)
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
) -> DamageRollResult:
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
    total = sum(all_rolls) + weapon_bonus + attack_bonus + mod_total

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
) -> HealResult:
    rolls = [random.randint(1, die_type) for _ in range(dice_count)]
    heal_amount = max(0, sum(rolls) + modifier)
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
