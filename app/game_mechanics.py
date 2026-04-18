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
from typing import Any, Callable


# ══════════════════════════════════════════════════════════════
# ADVANTAGE / DISADVANTAGE (cross-cutting)
# ══════════════════════════════════════════════════════════════
@dataclass
class AdvantageResult:
    """Result of applying advantage/disadvantage to any roll."""
    chosen_total: int         # The total that was ultimately used
    all_totals: list          # [total1, total2] (or [total] for normal)
    chosen_index: int         # 0 or 1 — which roll was chosen
    all_details: list         # [detail1, detail2] — full details for each roll
    mode: str                 # "normal" | "advantage" | "disadvantage"


ADV_DICE_CAP = 5  # hard cap on number of d20s a player can roll per check


def apply_advantage(
    roll_func: Callable,
    mode: str = "normal",
    dice_count: int | None = None,
) -> AdvantageResult:
    """
    Wraps any roll function with advantage/disadvantage logic.

    roll_func:    callable returning (total: int, details: Any)
    mode:         "normal" | "advantage" | "disadvantage"
    dice_count:   how many times to call ``roll_func``.
                  None → legacy behaviour: 1 roll for normal, 2 rolls for adv/disadv.
                  Player-facing: clamped to [1, ADV_DICE_CAP].
                  For adv/disadv we force ``max(2, dice_count)`` so the pick is
                  meaningful (ADV on a single die collapses to normal).

    Selection policy:
        normal        → take the first roll; extras are logged but unused.
        advantage     → take the HIGHEST.
        disadvantage  → take the LOWEST.

    Returns AdvantageResult with ``all_totals`` / ``all_details`` of length N.
    """
    if mode not in ("normal", "advantage", "disadvantage"):
        mode = "normal"

    if dice_count is None:
        n = 1 if mode == "normal" else 2
    else:
        try:
            n = int(dice_count)
        except (TypeError, ValueError):
            n = 1 if mode == "normal" else 2
    n = max(1, min(ADV_DICE_CAP, n))
    if mode != "normal" and n < 2:
        n = 2  # adv/disadv need at least 2 rolls to pick from

    totals: list = []
    details: list = []
    for _ in range(n):
        t, d = roll_func()
        totals.append(t)
        details.append(d)

    if mode == "advantage":
        chosen = max(range(n), key=lambda i: totals[i])
    elif mode == "disadvantage":
        chosen = min(range(n), key=lambda i: totals[i])
    else:
        chosen = 0

    return AdvantageResult(
        chosen_total=totals[chosen],
        all_totals=totals,
        chosen_index=chosen,
        all_details=details,
        mode=mode,
    )


def resolve_advantage_mode(player_choice: str, penalties: dict | None) -> str:
    """
    Resolve effective advantage mode considering player choice + forced status effects.
    If both forced_advantage and forced_disadvantage are active, they cancel out → normal.
    Forced status overrides player choice.
    """
    if not penalties:
        return player_choice if player_choice in ("normal", "advantage", "disadvantage") else "normal"

    forced_adv = penalties.get("forced_advantage", False)
    forced_disadv = penalties.get("forced_disadvantage", False)

    if forced_adv and forced_disadv:
        return "normal"  # cancel out
    if forced_adv:
        return "advantage"
    if forced_disadv:
        return "disadvantage"

    return player_choice if player_choice in ("normal", "advantage", "disadvantage") else "normal"


def format_advantage_breakdown(mode: str, all_totals: list, chosen_index: int,
                                 base_label: str = "D20") -> str:
    """Format advantage/disadvantage prefix for breakdown strings.

    Works for arbitrary dice counts (1..N). "normal" with a single die
    returns "" so the caller can skip prefix entirely.
    """
    if mode == "normal" and len(all_totals) < 2:
        return ""
    if mode == "normal":
        label = "NORM"
    elif mode == "advantage":
        label = "ADV"
    else:
        label = "DISADV"
    chosen = all_totals[chosen_index] if 0 <= chosen_index < len(all_totals) else all_totals[0]
    inner = ", ".join(str(x) for x in all_totals)
    return f"{label}: {base_label}[{inner}] took {chosen}"


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
        "mana_bonus": 0,
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
DEFAULT_RATES = {"platinum": 1000, "gold": 100, "silver": 10, "bronze": 1}


def bronze_to_display(bronze: int, rates: dict | None = None) -> dict:
    """Convert a total bronze value into multi-currency breakdown."""
    r = rates or DEFAULT_RATES
    remainder = max(0, bronze)
    platinum = remainder // r["platinum"]
    remainder %= r["platinum"]
    gold = remainder // r["gold"]
    remainder %= r["gold"]
    silver = remainder // r["silver"]
    remainder %= r["silver"]
    return {"platinum": platinum, "gold": gold, "silver": silver, "bronze": remainder}


def display_to_bronze(platinum: int = 0, gold: int = 0, silver: int = 0, bronze: int = 0,
                      rates: dict | None = None) -> int:
    """Convert multi-currency amounts to total bronze."""
    r = rates or DEFAULT_RATES
    return platinum * r["platinum"] + gold * r["gold"] + silver * r["silver"] + bronze * r.get("bronze", r.get("copper", 1))


def format_currency(bronze: int, rates: dict | None = None) -> str:
    """Format bronze amount as human-readable string e.g. '3G 5S 2B'."""
    d = bronze_to_display(bronze, rates)
    parts = []
    if d["platinum"]: parts.append(f"{d['platinum']}P")
    if d["gold"]:     parts.append(f"{d['gold']}G")
    if d["silver"]:   parts.append(f"{d['silver']}S")
    if d["bronze"]:   parts.append(f"{d['bronze']}B")
    return " ".join(parts) if parts else "0B"


# Backward-compat aliases
copper_to_display = bronze_to_display
display_to_copper = display_to_bronze


def calculate_item_price(base_price_bronze: int, reputation: int = 0,
                         price_override: int | None = None) -> int:
    """
    Calculate item price adjusted by NPC reputation.
    reputation: -100 = prices doubled, 0 = normal, +100 = 50% discount
    """
    base = price_override if price_override is not None else base_price_bronze
    multiplier = 1.0 - (reputation / 200.0)  # range: 1.5x to 0.5x
    return max(1, int(base * multiplier))


# ══════════════════════════════════════════════════════════════
# MANA SYSTEM (Phase 3)
# ══════════════════════════════════════════════════════════════
def get_effective_mana_max(base_mana_max: int, mana_bonus: int = 0) -> int:
    """Calculate effective max mana including item/status bonuses."""
    return max(0, base_mana_max + mana_bonus)


def spend_mana(current: int, effective_max: int, cost: int) -> dict:
    """
    Attempt to spend mana. Pure function — caller handles DB update.
    Returns {"success": bool, "mana_current": int, "mana_max": int, ...}
    """
    if cost <= 0:
        return {"success": True, "mana_current": current, "mana_max": effective_max}
    if current < cost:
        return {
            "success": False,
            "error": "NOT_ENOUGH_MANA",
            "message": f"Need {cost} mana, have {current}/{effective_max}",
            "mana_current": current,
            "mana_max": effective_max,
        }
    return {"success": True, "mana_current": current - cost, "mana_max": effective_max}


def restore_mana(current: int, effective_max: int, amount: int | None = None, full: bool = False) -> int:
    """
    Restore mana. If full=True, set to max. Otherwise add amount.
    Returns new mana_current value.
    """
    if full:
        return effective_max
    return min(effective_max, current + (amount or 0))


def apply_mana_regen(current: int, effective_max: int, regen: int, mana_change_per_turn: int = 0) -> int:
    """Apply per-turn mana regen and status effect mana changes. Returns new mana_current."""
    new_val = current + regen + mana_change_per_turn
    return max(0, min(effective_max, new_val))


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
        "mana_change_per_turn": 0,
        "custom_notes": [],
        "forced_advantage": False,
        "forced_disadvantage": False,
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
            elif etype == "mana_change_per_turn":
                result["mana_change_per_turn"] += val
            elif etype == "damage_reduction_penalty":
                result["damage_reduction_penalty"] += val
            elif etype == "custom_note":
                result["custom_notes"].append(eff.get("text", ""))
            elif etype == "forced_advantage":
                result["forced_advantage"] = True
            elif etype == "forced_disadvantage":
                result["forced_disadvantage"] = True
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


# ══════════════════════════════════════════════════════════════
# 6. STAGE 11 — COMBAT TARGETING: ROLL DICE STRING
# ══════════════════════════════════════════════════════════════
def roll_dice(dice_str: str) -> tuple[list[int], int]:
    """Roll a dice string like '2d6' or '1d8+2'. Returns (individual_rolls, total)."""
    import re
    dice_str = dice_str.strip().lower()
    bonus = 0
    # Handle +/- bonus at end
    m = re.match(r'^(\d+)d(\d+)([+-]\d+)?$', dice_str)
    if not m:
        return [0], 0
    count = int(m.group(1))
    die = int(m.group(2))
    if m.group(3):
        bonus = int(m.group(3))
    rolls = [random.randint(1, die) for _ in range(max(1, count))]
    return rolls, sum(rolls) + bonus


def stat_modifier(stat_value: int) -> int:
    """Rework: stat value IS the bonus (str 2 → +2). No D&D formula."""
    try:
        return int(stat_value or 0)
    except (TypeError, ValueError):
        return 0


_STAT_KEYS = ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")


def _resolve_stat_from_weapon(attacker_stats: dict, weapon: dict | None, kind: str) -> tuple[int, str]:
    """Pick the stat configured on the weapon (hit_stat / damage_stat) and return (value, stat_name).

    kind: 'hit' or 'damage'.
    If damage_stat is explicitly None → returns (0, '') meaning no stat contribution.
    Falls back to legacy STR/DEX/finesse inference when the weapon has no binding.
    """
    # Explicit binding on weapon takes priority
    if weapon:
        field = "hit_stat" if kind == "hit" else "damage_stat"
        stat_name = weapon.get(field, None) if field in weapon else None
        if stat_name is None and kind == "damage" and "damage_stat" in weapon and weapon["damage_stat"] is None:
            # explicit null → no stat bonus to damage
            return 0, ""
        if stat_name in _STAT_KEYS:
            return stat_modifier(attacker_stats.get(stat_name, 0)), stat_name
    # Legacy fallback — infer from properties
    if weapon:
        props, wrange, _ = _resolve_weapon_props(weapon)
        if wrange == "ranged" or "finesse" in props:
            if "finesse" in props:
                dex_v = stat_modifier(attacker_stats.get("dexterity", 0))
                str_v = stat_modifier(attacker_stats.get("strength", 0))
                return (dex_v, "dexterity") if dex_v >= str_v else (str_v, "strength")
            return stat_modifier(attacker_stats.get("dexterity", 0)), "dexterity"
    return stat_modifier(attacker_stats.get("strength", 0)), "strength"


# ══════════════════════════════════════════════════════════════
# 7. STAGE 11 — COMBAT ATTACK ROLL (targeting system)
# ══════════════════════════════════════════════════════════════
@dataclass
class CombatAttackResult:
    d20: int
    stat_mod: int
    weapon_bonus: int
    item_bonuses: int
    status_penalty: int
    total: int
    hit: bool
    critical: bool
    fumble: bool
    target_ac: int
    # Advantage/disadvantage fields
    advantage_mode: str = "normal"
    all_d20s: list = field(default_factory=list)  # [d20_1, d20_2] or [d20]
    chosen_d20_index: int = 0
    advantage_breakdown: str = ""


def _resolve_weapon_props(weapon):
    """Extract stat_mod and weapon_bonus from weapon dict."""
    if weapon:
        props = weapon.get("weapon_properties", [])
        if isinstance(props, str):
            import json
            try:
                props = json.loads(props)
            except Exception:
                props = []
        wrange = weapon.get("weapon_range", "melee")
        return props, wrange, weapon.get("attack_bonus", 0)
    return [], "melee", 0


def _calc_attack_stat_mod(attacker_stats, weapon):
    """Rework: prefer weapon.hit_stat, fallback to legacy STR/DEX inference."""
    val, _ = _resolve_stat_from_weapon(attacker_stats, weapon, "hit")
    return val


def calculate_combat_attack(
    attacker_stats: dict,  # {strength, dexterity, ...}
    target_ac: int,
    weapon: dict | None = None,  # {attack_bonus, weapon_range, weapon_properties, ...}
    item_atk_bonus: int = 0,
    status_atk_penalty: int = 0,
    advantage_mode: str = "normal",
    dice_count: int | None = None,
) -> CombatAttackResult:
    """
    Full D&D-style attack roll with advantage/disadvantage support.
    advantage_mode: "normal" | "advantage" | "disadvantage"
    dice_count: optional number of d20s to roll (1..ADV_DICE_CAP).
    """
    sm = _calc_attack_stat_mod(attacker_stats, weapon)
    _, _, wb = _resolve_weapon_props(weapon) if weapon else ([], "melee", 0)

    def _single_roll():
        d = random.randint(1, 20)
        t = d + sm + wb + item_atk_bonus - status_atk_penalty
        return t, d

    adv = apply_advantage(_single_roll, advantage_mode, dice_count=dice_count)
    chosen_d20 = adv.all_details[adv.chosen_index]
    total = adv.chosen_total

    fumble = (chosen_d20 == 1)
    critical = (chosen_d20 == 20)
    hit = False if fumble else (critical or total >= target_ac)

    adv_breakdown = format_advantage_breakdown(
        advantage_mode, [d for d in adv.all_details], adv.chosen_index, "D20"
    )

    return CombatAttackResult(
        d20=chosen_d20, stat_mod=sm, weapon_bonus=wb,
        item_bonuses=item_atk_bonus, status_penalty=status_atk_penalty,
        total=total, hit=hit, critical=critical, fumble=fumble,
        target_ac=target_ac,
        advantage_mode=advantage_mode,
        all_d20s=list(adv.all_details),
        chosen_d20_index=adv.chosen_index,
        advantage_breakdown=adv_breakdown,
    )


# ══════════════════════════════════════════════════════════════
# 8. STAGE 11 — COMBAT DAMAGE ROLL (targeting system)
# ══════════════════════════════════════════════════════════════
@dataclass
class CombatDamageResult:
    dice_rolls: list
    base_damage: int
    stat_mod: int
    weapon_damage_bonus: int
    item_damage_bonus: int
    status_penalty: int
    raw_damage: int
    target_reduction: int
    final_damage: int
    target_new_hp: int
    target_killed: bool
    # Advantage/disadvantage fields
    advantage_mode: str = "normal"
    all_rolls: list = field(default_factory=list)  # [[rolls1], [rolls2]] or [[rolls]]
    all_totals: list = field(default_factory=list)
    chosen_index: int = 0
    advantage_breakdown: str = ""


def _calc_damage_stat_mod(attacker_stats, weapon):
    """Rework: prefer weapon.damage_stat (None → 0), fallback to legacy."""
    val, _ = _resolve_stat_from_weapon(attacker_stats, weapon, "damage")
    return val


def _single_damage_roll(dc, dt, critical):
    """Roll damage dice once, with crit doubling."""
    dice_rolls = [random.randint(1, dt) for _ in range(max(1, dc))]
    base_damage = sum(dice_rolls)
    if critical:
        crit_rolls = [random.randint(1, dt) for _ in range(max(1, dc))]
        dice_rolls.extend(crit_rolls)
        base_damage += sum(crit_rolls)
    return base_damage, dice_rolls


def calculate_combat_damage(
    attacker_stats: dict,
    target_hp: int,
    target_max_hp: int,
    weapon: dict | None = None,  # {dice_count, dice_type, damage_bonus, weapon_range, weapon_properties}
    critical: bool = False,
    item_dmg_bonus: int = 0,
    status_dmg_penalty: int = 0,
    target_damage_reduction: int = 0,
    advantage_mode: str = "normal",
) -> CombatDamageResult:
    """Full damage roll after a successful attack hit, with advantage/disadvantage."""
    if weapon:
        dc = weapon.get("dice_count", 1)
        dt = weapon.get("dice_type", 6)
        weapon_damage_bonus = weapon.get("damage_bonus", 0)
    else:
        dc, dt = 1, 4
        weapon_damage_bonus = 0

    sm = _calc_damage_stat_mod(attacker_stats, weapon)

    def _roll_once():
        base, rolls = _single_damage_roll(dc, dt, critical)
        raw = max(0, base + sm + weapon_damage_bonus + item_dmg_bonus - status_dmg_penalty)
        return raw, rolls

    adv = apply_advantage(_roll_once, advantage_mode)
    chosen_rolls = adv.all_details[adv.chosen_index]
    base_damage = sum(chosen_rolls)
    raw_damage = adv.chosen_total
    final_damage = max(0, raw_damage - target_damage_reduction)
    target_new_hp = max(0, target_hp - final_damage)
    target_killed = target_new_hp <= 0

    adv_breakdown = format_advantage_breakdown(
        advantage_mode, adv.all_totals, adv.chosen_index, "Dmg"
    )

    return CombatDamageResult(
        dice_rolls=chosen_rolls, base_damage=base_damage,
        stat_mod=sm, weapon_damage_bonus=weapon_damage_bonus,
        item_damage_bonus=item_dmg_bonus, status_penalty=status_dmg_penalty,
        raw_damage=raw_damage, target_reduction=target_damage_reduction,
        final_damage=final_damage, target_new_hp=target_new_hp,
        target_killed=target_killed,
        advantage_mode=advantage_mode,
        all_rolls=list(adv.all_details),
        all_totals=list(adv.all_totals),
        chosen_index=adv.chosen_index,
        advantage_breakdown=adv_breakdown,
    )
