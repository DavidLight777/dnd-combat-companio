"""Ability resolution helpers."""
import json
import random

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ability, Character, CharacterAbility
from app.routers.abilities.common import _ability_dict


async def _apply_ability_damage_only(
    ca_id: int,
    body: dict,
    db: AsyncSession,
) -> dict:
    """Replay only the deferred damage effects of an ability use.
    Called by defense_reactions when defense fails so the ability damage lands.
    Assumes costs / cooldown / non-damage effects were already applied.
    """

    ca = await db.get(CharacterAbility, ca_id)
    if not ca:
        raise HTTPException(404, "Character ability not found")
    ability = ca.ability
    char = await db.get(Character, ca.character_id)
    target_char = char
    target_id = body.get("target_id")
    if target_id and int(target_id) != char.id:
        t = await db.get(Character, int(target_id))
        if t:
            target_char = t

    hit_info = body.get("hit_roll") or None
    is_crit = bool(hit_info.get("critical", False)) if hit_info else False

    def _override_dc(default_dc):
        v = body.get("override_dice_count")
        return int(v) if (v is not None and int(v) > 0) else int(default_dc)
    def _override_dt(default_dt):
        v = body.get("override_dice_type")
        return int(v) if (v is not None and int(v) > 0) else int(default_dt)

    # Re-parse effects
    try:
        eff_data = json.loads(ability.effect) if isinstance(ability.effect, str) else ability.effect
        effects_list = eff_data.get("effects", []) if isinstance(eff_data, dict) else eff_data if isinstance(eff_data, list) else []
    except Exception:
        effects_list = []

    if (
        ability.damage_dice_count
        and ability.damage_dice_type
        and not any(isinstance(e, dict) and e.get("type") == "damage" for e in effects_list)
    ):
        effects_list = list(effects_list) + [{
            "type": "damage",
            "dice_count": int(ability.damage_dice_count),
            "dice_type": int(ability.damage_dice_type),
            "flat_bonus": 0,
            "_implicit_from_top_level": True,
        }]

    results = []
    for eff in effects_list:
        if not isinstance(eff, dict) or eff.get("type") != "damage":
            continue
        dc = _override_dc(eff.get("dice_count", 1))
        dt = _override_dt(eff.get("dice_type", 6))
        fb = eff.get("flat_bonus", 0)
        actual_dc = dc * 2 if is_crit else dc
        rolls = [random.randint(1, dt) for _ in range(max(1, actual_dc))]
        total = sum(rolls) + fb
        old_hp = target_char.current_hp
        target_char.current_hp = max(0, target_char.current_hp - total)
        if target_char.current_hp <= 0:
            target_char.is_alive = False
        crit_tag = " CRIT×2" if is_crit else ""
        results.append(
            f"Damage{crit_tag}: {actual_dc}d{dt}+{fb}={total} → "
            f"-{old_hp - target_char.current_hp} HP to {target_char.name}"
        )

    await db.commit()
    await db.refresh(target_char)
    return {
        "ok": True,
        "ability_name": ability.name,
        "results": results,
        "character_id": char.id,
        "target_id": target_char.id,
        "target_hp_before": old_hp if 'old_hp' in locals() else target_char.current_hp,
        "target_hp_after": target_char.current_hp,
        "target_downed": target_char.current_hp <= 0,
        "mana_current": char.mana_current,
    }


# ══════════════════════════════════════════════════════════════
# ABILITY CONFIG HELPERS
# ══════════════════════════════════════════════════════════════
_CONFIG_SCALAR_FIELDS = [
    "ability_type", "target_type", "aoe_radius",
    "damage_type", "custom_damage_type",
    "mana_cost", "hp_cost", "cooldown_turns",
    "requires_hit_roll", "hit_stat", "damage_stat",
    "damage_dice_count", "damage_dice_type",
    "is_passive", "range_cells", "max_uses",
    "is_conditional", "conditional_text", "notes",
]
_CONFIG_JSON_FIELDS = ["passive_effect", "effect"]

def _resolve_ability(
    ability: Ability,
    level: int = 0,
    rank: str = "common",
    level_configs=None,
    rank_configs=None,
) -> dict:
    """Return a flat dict of ability fields after applying level & rank configs.
    Non-null fields on configs override base ability fields.
    `level_configs` and `rank_configs` can be provided explicitly to avoid lazy-load issues in async sessions."""
    base = _ability_dict(ability)
    # Apply level config
    _level_configs = level_configs if level_configs is not None else (ability.level_configs or [])
    for lc in _level_configs:
        if lc.level == level:
            for f in _CONFIG_SCALAR_FIELDS + _CONFIG_JSON_FIELDS:
                v = getattr(lc, f, None)
                if v is not None:
                    if f in _CONFIG_JSON_FIELDS:
                        try:
                            base[f] = json.loads(v)
                        except Exception:
                            base[f] = v
                    else:
                        base[f] = v
            break
    # Apply rank config
    _rank_configs = rank_configs if rank_configs is not None else (ability.rank_configs or [])
    for rc in _rank_configs:
        if rc.rank == rank:
            for f in _CONFIG_SCALAR_FIELDS + _CONFIG_JSON_FIELDS:
                v = getattr(rc, f, None)
                if v is not None:
                    if f in _CONFIG_JSON_FIELDS:
                        try:
                            base[f] = json.loads(v)
                        except Exception:
                            base[f] = v
                    else:
                        base[f] = v
            break
    return base


# ══════════════════════════════════════════════════════════════
# GM MANUAL ABILITY RANK PROMOTION
