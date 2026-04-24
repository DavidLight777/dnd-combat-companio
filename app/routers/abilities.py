"""Phase 6 — Abilities CRUD, assign to characters, use ability, cooldown."""

import json
import random
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Ability, CharacterAbility, Character, CharacterStatusEffect,
    StatusEffectTemplate, StatModifier, AttackModifier, DamageModifier,
    Session, AbilityLevelConfig, AbilityRankConfig,
)

router = APIRouter(prefix="/api", tags=["abilities"])


# ── Ability templates CRUD ───────────────────────────────────
@router.get("/abilities")
async def list_abilities(
    session_id: int | None = None,
    in_starting_pool: bool | None = None,
    rarity: str | None = None,
    db: AsyncSession = Depends(get_session),
):
    """Rework v2: optional `in_starting_pool` / `rarity` filters for the GM
    starting-pool manager UI."""
    q = select(Ability)
    if session_id is not None:
        q = q.where((Ability.session_id == session_id) | (Ability.session_id == None))
    if in_starting_pool is True:
        q = q.where(Ability.is_in_starting_pool == True)      # noqa: E712
    elif in_starting_pool is False:
        q = q.where(Ability.is_in_starting_pool == False)     # noqa: E712
    if rarity:
        q = q.where(Ability.rarity == rarity)
    result = await db.execute(q.order_by(Ability.rarity, Ability.name))
    return [_ability_dict(a) for a in result.scalars().all()]


_ABILITY_FIELDS = (
    "name", "description", "session_id",
    "icon", "color", "flavor_text", "notes",
    "ability_type", "target_type", "aoe_radius",
    "damage_type", "custom_damage_type",
    "mana_cost", "hp_cost", "cooldown_turns",
    "requires_hit_roll", "hit_stat", "damage_stat",
    "damage_dice_count", "damage_dice_type",
    "is_passive", "range", "range_cells",
    # Rework v2: unified "особенность или умение" pool fields
    "rarity", "is_in_starting_pool", "max_uses",
    "is_conditional", "conditional_text",
)
_ABILITY_JSON_FIELDS = ("effect", "passive_effect", "tags")


def _set_ability_fields(a: Ability, body: dict):
    for f in _ABILITY_FIELDS:
        if f in body:
            setattr(a, f, body[f])
    for f in _ABILITY_JSON_FIELDS:
        if f in body:
            v = body[f]
            setattr(a, f, json.dumps(v) if isinstance(v, (dict, list)) else v)


@router.post("/abilities")
async def create_ability(body: dict, db: AsyncSession = Depends(get_session)):
    a = Ability(name=body.get("name", "Ability"))
    _set_ability_fields(a, body)
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return _ability_dict(a)


@router.put("/abilities/{ability_id}")
async def update_ability(ability_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    _set_ability_fields(a, body)
    await db.commit()
    await db.refresh(a)
    return _ability_dict(a)


@router.post("/abilities/{ability_id}/duplicate")
async def duplicate_ability(ability_id: int, db: AsyncSession = Depends(get_session)):
    src = await db.get(Ability, ability_id)
    if not src:
        raise HTTPException(404, "Ability not found")
    dup = Ability(
        name=f"Copy of {src.name}",
        description=src.description,
        session_id=src.session_id,
        icon=src.icon, color=src.color,
        flavor_text=src.flavor_text, notes=src.notes, tags=src.tags,
        ability_type=src.ability_type, target_type=src.target_type, aoe_radius=src.aoe_radius,
        damage_type=src.damage_type, custom_damage_type=src.custom_damage_type,
        mana_cost=src.mana_cost, hp_cost=src.hp_cost, cooldown_turns=src.cooldown_turns,
        requires_hit_roll=src.requires_hit_roll, hit_stat=src.hit_stat, damage_stat=src.damage_stat,
        damage_dice_count=src.damage_dice_count, damage_dice_type=src.damage_dice_type,
        is_passive=src.is_passive, passive_effect=src.passive_effect,
        effect=src.effect, range=src.range,
        # Rework v2: carry the pool flags on duplicate
        rarity=src.rarity,
        is_in_starting_pool=src.is_in_starting_pool,
        max_uses=src.max_uses,
        is_conditional=src.is_conditional,
        conditional_text=src.conditional_text,
    )
    db.add(dup)
    await db.commit()
    await db.refresh(dup)
    return _ability_dict(dup)


@router.delete("/abilities/{ability_id}")
async def delete_ability(ability_id: int, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404)
    await db.delete(a)
    await db.commit()
    return {"ok": True}


def _parse_json_field(val, fallback=None):
    if fallback is None:
        fallback = {}
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return fallback
    return val if val is not None else fallback


def _ability_dict(a: Ability) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "description": a.description,
        "session_id": a.session_id,
        # Identity
        "icon": a.icon,
        "color": a.color,
        "flavor_text": a.flavor_text,
        "notes": a.notes,
        "tags": _parse_json_field(a.tags, []),
        # Type & Targeting
        "ability_type": a.ability_type,
        "target_type": a.target_type,
        "aoe_radius": a.aoe_radius,
        # Damage typing
        "damage_type": a.damage_type,
        "custom_damage_type": a.custom_damage_type,
        # Costs
        "mana_cost": a.mana_cost,
        "hp_cost": a.hp_cost,
        "cooldown_turns": a.cooldown_turns,
        # Hit
        "requires_hit_roll": a.requires_hit_roll,
        "hit_stat": a.hit_stat,
        "damage_stat": a.damage_stat,
        # Dice
        "damage_dice_count": a.damage_dice_count,
        "damage_dice_type": a.damage_dice_type,
        # Rework v3 Phase 7: range in battle-grid cells.
        "range_cells": a.range_cells if a.range_cells is not None else 1,
        # Passive
        "is_passive": a.is_passive,
        "passive_effect": _parse_json_field(a.passive_effect),
        # Effects
        "effect": _parse_json_field(a.effect),
        "range": a.range,
        # Rework v2: pool-related fields
        "rarity": a.rarity or "common",
        "is_in_starting_pool": bool(a.is_in_starting_pool),
        "max_uses": a.max_uses,
        "is_conditional": bool(a.is_conditional),
        "conditional_text": a.conditional_text,
    }


# ── Assign / unassign abilities to characters ────────────────
@router.get("/characters/{char_id}/abilities")
async def get_character_abilities(char_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CharacterAbility).where(CharacterAbility.character_id == char_id)
    )
    out = []
    for ca in result.scalars().all():
        d = _ability_dict(ca.ability)
        d["character_ability_id"] = ca.id
        d["is_unlocked"] = ca.is_unlocked
        d["cooldown_remaining"] = ca.cooldown_remaining
        # Rework v2: uses counter + provenance
        d["current_uses"] = ca.current_uses
        d["granted_from"] = ca.granted_from
        d["ability_level"] = ca.ability_level or 0
        d["ability_rank"] = ca.ability_rank or "common"
        out.append(d)
    return out


@router.post("/characters/{char_id}/abilities")
async def assign_ability(char_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    ability_id = body.get("ability_id")
    if not ability_id:
        raise HTTPException(400, "ability_id required")
    ability = await db.get(Ability, ability_id)
    if not ability:
        raise HTTPException(404, "Ability not found")
    # Check if already assigned
    existing = await db.execute(
        select(CharacterAbility).where(
            CharacterAbility.character_id == char_id,
            CharacterAbility.ability_id == ability_id,
        )
    )
    if existing.scalars().first():
        raise HTTPException(400, "Ability already assigned")
    ca = CharacterAbility(
        character_id=char_id,
        ability_id=ability_id,
        is_unlocked=body.get("is_unlocked", True),
        # Rework v2: mirror the template's max_uses on grant
        current_uses=ability.max_uses,
        granted_from=body.get("granted_from", "gm"),
    )
    db.add(ca)
    # Auto-apply passive bonuses
    if ability.is_passive and ca.is_unlocked:
        await _apply_passive_bonuses(char_id, ability, db)
    await db.commit()
    await db.refresh(ca)
    d = _ability_dict(ca.ability)
    d["character_ability_id"] = ca.id
    d["is_unlocked"] = ca.is_unlocked
    d["cooldown_remaining"] = ca.cooldown_remaining
    d["current_uses"] = ca.current_uses
    d["granted_from"] = ca.granted_from
    return d


@router.delete("/character-abilities/{ca_id}")
async def unassign_ability(ca_id: int, db: AsyncSession = Depends(get_session)):
    ca = await db.get(CharacterAbility, ca_id)
    if not ca:
        raise HTTPException(404)
    ability = ca.ability
    # Remove passive bonuses
    if ability and ability.is_passive:
        await _remove_passive_bonuses(ca.character_id, ability, db)
    await db.delete(ca)
    await db.commit()
    return {"ok": True}


async def _apply_passive_bonuses(char_id: int, ability: Ability, db: AsyncSession):
    """Apply passive ability bonuses as permanent modifiers.

    Supported bonus types:
      * stat_bonus                — +N to a stat (stored in StatModifier)
      * attack_bonus              — +N to attack rolls
      * damage_bonus              — +N to damage rolls
      * damage_reduction_flat/pct — flat / percent damage reduction
      * max_hp_bonus              — +N to max HP (directly mutates character)
      * max_mana_bonus            — +N to mana_max (directly mutates)
      * mana_regen_bonus          — +N to mana_regen_per_turn (directly mutates)
      * hp_die_bonus              — +N to race HP die size for level-up rolls
      * hp_die_count_bonus        — +N to race HP dice count for level-up rolls
    """
    pe = _parse_json_field(ability.passive_effect)
    bonuses = pe.get("bonuses", []) if isinstance(pe, dict) else []
    source_name = f"Ability: {ability.name}"

    # Load character once for direct-mutation bonuses.
    char = await db.get(Character, char_id)

    for b in bonuses:
        btype = b.get("bonus_type", "")
        val = int(b.get("value", 0) or 0)

        if btype == "stat_bonus":
            stat = b.get("stat", "strength")
            db.add(StatModifier(
                character_id=char_id, stat_name=stat,
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "attack_bonus":
            db.add(AttackModifier(
                character_id=char_id, name=source_name, value=val, is_active=True,
            ))
        elif btype == "damage_bonus":
            db.add(DamageModifier(
                character_id=char_id, name=source_name, value=val, is_active=True,
            ))
        elif btype in ("damage_reduction_flat", "damage_reduction_pct"):
            db.add(StatModifier(
                character_id=char_id, stat_name=btype,
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype in ("hp_die_bonus", "hp_die_count_bonus"):
            # Consumed by the level-up HP roll; stored as StatModifier rows so
            # they clean up automatically on unassign.
            db.add(StatModifier(
                character_id=char_id, stat_name=btype,
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "max_hp_bonus" and char:
            char.max_hp = (char.max_hp or 0) + val
            char.current_hp = (char.current_hp or 0) + val
            db.add(StatModifier(
                character_id=char_id, stat_name="max_hp_bonus",
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "max_mana_bonus" and char:
            char.mana_max = (char.mana_max or 0) + val
            char.mana_current = (char.mana_current or 0) + val
            db.add(StatModifier(
                character_id=char_id, stat_name="max_mana_bonus",
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "mana_regen_bonus" and char:
            char.mana_regen_per_turn = (char.mana_regen_per_turn or 0) + val
            db.add(StatModifier(
                character_id=char_id, stat_name="mana_regen_bonus",
                name=source_name, value=val, is_active=True, source="ability",
            ))


async def _remove_passive_bonuses(char_id: int, ability: Ability, db: AsyncSession):
    """Remove all modifiers created by a passive ability.

    For bonuses that directly mutate the character (max_hp / max_mana /
    mana_regen), we reverse the mutation before deleting the StatModifier row.
    """
    source_name = f"Ability: {ability.name}"
    char = await db.get(Character, char_id)

    # First reverse direct-mutation bonuses.
    if char is not None:
        result = await db.execute(
            select(StatModifier).where(
                StatModifier.character_id == char_id,
                StatModifier.name == source_name,
                StatModifier.stat_name.in_(("max_hp_bonus", "max_mana_bonus", "mana_regen_bonus")),
            )
        )
        for m in result.scalars().all():
            if m.stat_name == "max_hp_bonus":
                char.max_hp = max(0, (char.max_hp or 0) - int(m.value or 0))
                char.current_hp = max(0, min(char.max_hp, (char.current_hp or 0) - int(m.value or 0)))
            elif m.stat_name == "max_mana_bonus":
                char.mana_max = max(0, (char.mana_max or 0) - int(m.value or 0))
                char.mana_current = max(0, min(char.mana_max, (char.mana_current or 0) - int(m.value or 0)))
            elif m.stat_name == "mana_regen_bonus":
                char.mana_regen_per_turn = max(0, (char.mana_regen_per_turn or 0) - int(m.value or 0))

    for Model in (StatModifier, AttackModifier, DamageModifier):
        result = await db.execute(
            select(Model).where(Model.character_id == char_id, Model.name == source_name)
        )
        for m in result.scalars().all():
            await db.delete(m)


# ── Use ability ──────────────────────────────────────────────
@router.post("/character-abilities/{ca_id}/use")
async def use_ability(ca_id: int, body: dict | None = None, db: AsyncSession = Depends(get_session)):
    """Use a character ability — deduct mana, apply effects, start cooldown.

    Rework Phase 6 optional body fields:
      * hit_roll: {"hit": bool, "critical": bool, "total": int, "breakdown": str}
          — if provided and ability.requires_hit_roll, a `hit=false` skips damage/apply_status.
          — `critical=true` doubles dice on damage/heal.
      * override_dice_count, override_dice_type: int
          — player/GM picked dice in the widget; overrides ability.damage_dice_* for
            damage/heal effects (applies to the first matching effect or to all).
      * target_id: int  — target character for damage/apply_status effects.
    """
    from app.game_mechanics import spend_mana, get_effective_mana_max, restore_mana as _restore_mana

    body = body or {}
    ca = await db.get(CharacterAbility, ca_id)
    if not ca:
        raise HTTPException(404, "Character ability not found")
    if not ca.is_unlocked:
        raise HTTPException(400, "Ability is locked")
    if ca.cooldown_remaining > 0:
        raise HTTPException(400, f"Ability on cooldown ({ca.cooldown_remaining} turns remaining)")

    ability = ca.ability
    char = await db.get(Character, ca.character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    # Rework v2: limited-use check. null = infinite, 0 = depleted.
    if ca.current_uses is not None and ca.current_uses <= 0:
        raise HTTPException(400, {"error": True, "code": "NO_USES_LEFT",
                                  "message": f"{ability.name} has no uses left."})

    # Rework v2: conditional-only features have no mechanics — emit flavor log.
    if ability.is_conditional:
        if ca.current_uses is not None:
            ca.current_uses = max(0, ca.current_uses - 1)
        await db.commit()
        return {
            "ok": True,
            "ability_name": ability.name,
            "results": [ability.conditional_text or f"{ability.name} — GM call."],
            "character_id": char.id,
            "current_hp": char.current_hp,
            "mana_current": char.mana_current,
            "cooldown_remaining": ca.cooldown_remaining,
            "current_uses": ca.current_uses,
        }

    # Rework Phase 6: incoming hit roll (optional, only meaningful if requires_hit_roll)
    hit_info = body.get("hit_roll") or None
    hit_ok = True
    is_crit = False
    if ability.requires_hit_roll and hit_info is not None:
        hit_ok = bool(hit_info.get("hit", True))
        is_crit = bool(hit_info.get("critical", False))

    # Dice overrides from the widget
    def _override_dc(default_dc): 
        v = body.get("override_dice_count")
        return int(v) if (v is not None and int(v) > 0) else int(default_dc)
    def _override_dt(default_dt):
        v = body.get("override_dice_type")
        return int(v) if (v is not None and int(v) > 0) else int(default_dt)

    results = []
    if ability.requires_hit_roll and hit_info is not None:
        bd = hit_info.get("breakdown") or f"Total {hit_info.get('total','?')}"
        if not hit_ok:
            results.append(f"✗ {ability.name} missed ({bd})")
        elif is_crit:
            results.append(f"✨ CRIT — {ability.name} ({bd})")
        else:
            results.append(f"✓ {ability.name} hits ({bd})")

    # Mana cost
    if ability.mana_cost > 0:
        eff_max = get_effective_mana_max(char.mana_max)
        mana_result = spend_mana(char.mana_current, eff_max, ability.mana_cost)
        if not mana_result["success"]:
            raise HTTPException(400, {"error": True, "code": "NOT_ENOUGH_MANA",
                                      "message": mana_result["message"]})
        char.mana_current = mana_result["mana_current"]
        results.append(f"Spent {ability.mana_cost} mana")

    # HP cost
    if ability.hp_cost > 0:
        if char.current_hp <= ability.hp_cost:
            raise HTTPException(400, {"error": True, "code": "NOT_ENOUGH_HP",
                                      "message": f"Need {ability.hp_cost} HP but only have {char.current_hp}"})
        char.current_hp -= ability.hp_cost
        results.append(f"Spent {ability.hp_cost} HP")

    # Parse effects
    try:
        eff_data = json.loads(ability.effect) if isinstance(ability.effect, str) else ability.effect
        effects_list = eff_data.get("effects", []) if isinstance(eff_data, dict) else eff_data if isinstance(eff_data, list) else []
    except Exception:
        effects_list = []

    # Rework v3 Phase 7 bug fix — the Ability row has top-level
    # `damage_dice_count` / `damage_dice_type` fields, and the player UI
    # already shows a damage widget based on those. The previous server
    # code only applied damage when the effects JSON explicitly
    # contained `{"type":"damage"}`, so any ability created with just
    # the top-level dice fields (and no JSON effect entry) silently
    # did zero damage — exactly the bug report. Synthesise an implicit
    # damage effect so the loop below applies it. We only inject when
    # the effects list doesn't already carry an explicit damage entry,
    # so manually-authored abilities stay untouched.
    if (
        ability.damage_dice_count
        and ability.damage_dice_type
        and not any(isinstance(e, dict) and e.get("type") == "damage" for e in effects_list)
    ):
        effects_list = list(effects_list) + [{
            "type": "damage",
            "dice_count": int(ability.damage_dice_count),
            "dice_type":  int(ability.damage_dice_type),
            "flat_bonus": 0,
            # Marker so we know in the damage branch below to also add
            # the caster's damage_stat modifier — matches what the
            # player-side dmg widget was already doing client-side.
            "_implicit_from_top_level": True,
        }]

    # Rework v3 — Player-to-Player targeting. If body.target_id is set, heal /
    # buff / cleanse / damage effects land on the TARGET instead of the caster.
    # Resource costs (mana / HP cost) are always paid by the caster. When
    # target_id is missing or equals the caster, everything stays self-cast.
    target_id = body.get("target_id")
    # Rework v3 Phase 7 — guard-rail. If the ability is offensive (has a
    # damage effect or requires a hit roll) and the caller did NOT supply
    # a target, we used to silently self-target — which looked like
    # "damage didn't apply" to the player because they watched the
    # enemy's HP. Detect that case up front and fail loudly so the UI
    # can show a clear error instead of confusing everyone.
    _has_damage = any(
        isinstance(e, dict) and e.get("type") == "damage" for e in effects_list
    )
    _is_offensive = bool(ability.requires_hit_roll) or _has_damage
    if _is_offensive and (not target_id or int(target_id) == char.id):
        # target_type=='self' is an edge case — a self-damage ability
        # is legal, but any other target_type means the client forgot
        # to send target_id.
        if ability.target_type not in ("self",):
            raise HTTPException(400, {
                "error": True, "code": "TARGET_REQUIRED",
                "message": f"{ability.name} needs a target — pick an enemy.",
            })
    if target_id and int(target_id) != char.id:
        target_char = await db.get(Character, int(target_id))
        if not target_char:
            target_char = char
    else:
        target_char = char

    # Rework v3 Phase 7 — range enforcement for ability casts.
    # `Ability.range_cells` defaults to 1 (touch/adjacent). Self-cast
    # (caster == target) always passes; so do abilities with
    # `range_cells` in (None, 0) which encode "unlimited range".
    if target_char.id != char.id:
        from app.combat_range import check_range
        _rc = await check_range(char, target_char, ability.range_cells, db)
        if not _rc.ok:
            raise HTTPException(403, {
                "error": True, "code": "OUT_OF_RANGE",
                "message": (
                    f"Out of range — {target_char.name} is {_rc.distance_cells:g} cells away, "
                    f"{ability.name} reaches {_rc.max_cells}."
                ),
                "distance_cells": _rc.distance_cells,
                "max_cells": _rc.max_cells,
            })

    # Defense reaction: if ability requires hit roll, hit is normal (not crit/miss),
    # and there are damage effects targeting another character → defer damage.
    deferred_damage_effects = []
    needs_defense = False
    if (
        ability.requires_hit_roll
        and hit_info is not None
        and hit_ok
        and not is_crit
        and target_char.id != char.id
    ):
        for eff in effects_list:
            if isinstance(eff, dict) and eff.get("type") == "damage":
                needs_defense = True
                deferred_damage_effects.append(eff)

    for eff in effects_list:
        etype = eff.get("type", "")

        if etype == "heal_hp":
            # Rework Phase 6: respect dice overrides from widget; double on crit
            dc = _override_dc(eff.get("dice_count", 1))
            dt = _override_dt(eff.get("dice_type", 4))
            fb = eff.get("flat_bonus", 0)
            actual_dc = dc * 2 if is_crit else dc
            rolls = [random.randint(1, dt) for _ in range(max(1, actual_dc))]
            total = sum(rolls) + fb
            old_hp = target_char.current_hp
            target_char.current_hp = min(target_char.max_hp, target_char.current_hp + total)
            crit_tag = " CRIT×2" if is_crit else ""
            tgt_tag = "" if target_char.id == char.id else f" → {target_char.name}"
            results.append(f"Heal{crit_tag}: {actual_dc}d{dt}+{fb}={total} → +{target_char.current_hp - old_hp} HP{tgt_tag}")

        elif etype == "restore_mana":
            amount = eff.get("amount", 0)
            eff_max = get_effective_mana_max(target_char.mana_max)
            old_mana = target_char.mana_current
            target_char.mana_current = _restore_mana(target_char.mana_current, eff_max, amount=amount)
            tgt_tag = "" if target_char.id == char.id else f" → {target_char.name}"
            results.append(f"Mana: +{target_char.mana_current - old_mana}{tgt_tag}")

        elif etype == "restore_hp_by_die":
            # Rework v3: roll the caster's race HP die and heal that amount.
            # Honors hp_die_bonus / hp_die_count_bonus passive modifiers of the CASTER.
            from app.models import Race
            hp_die = 8
            hp_dice_count = 1
            if char.race_id:
                race = await db.get(Race, char.race_id)
                if race:
                    hp_die = int(race.hp_die or 8)
                    hp_dice_count = int(race.hp_dice_count or 1)
            die_bonus = sum(int(m.value or 0) for m in char.stat_modifiers
                            if m.is_active and m.stat_name == "hp_die_bonus")
            count_bonus = sum(int(m.value or 0) for m in char.stat_modifiers
                              if m.is_active and m.stat_name == "hp_die_count_bonus")
            hp_die = max(1, hp_die + die_bonus)
            hp_dice_count = max(1, hp_dice_count + count_bonus)
            rolls = [random.randint(1, hp_die) for _ in range(hp_dice_count)]
            total = sum(rolls) + int(eff.get("flat_bonus", 0) or 0)
            if is_crit:
                total *= 2
            old_hp = target_char.current_hp
            target_char.current_hp = min(target_char.max_hp, target_char.current_hp + total)
            crit_tag = " CRIT×2" if is_crit else ""
            tgt_tag = "" if target_char.id == char.id else f" → {target_char.name}"
            results.append(
                f"Heal{crit_tag}: {hp_dice_count}d{hp_die}={sum(rolls)} → "
                f"+{target_char.current_hp - old_hp} HP{tgt_tag}"
            )

        elif etype == "apply_status":
            template_id = eff.get("template_id")
            duration = eff.get("duration_turns")
            if template_id:
                tmpl = await db.get(StatusEffectTemplate, template_id)
                if tmpl:
                    cse = CharacterStatusEffect(
                        character_id=target_char.id, template_id=tmpl.id,
                        name=tmpl.name, icon=tmpl.icon, color=tmpl.color,
                        effects=tmpl.effects,
                        remaining_turns=duration if duration else tmpl.default_duration,
                    )
                    db.add(cse)
                    tgt_tag = "" if target_char.id == char.id else f" → {target_char.name}"
                    results.append(f"Applied: {tmpl.icon} {tmpl.name}{tgt_tag}")

        elif etype == "stat_boost":
            from datetime import timedelta
            stat = eff.get("stat", "strength")
            value = eff.get("value", 0)
            dur = eff.get("duration_turns", 3)
            mod = StatModifier(
                character_id=target_char.id, stat_name=stat,
                name=f"{ability.name} boost", value=value,
                is_active=True, source="potion",
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=dur * 2),
            )
            db.add(mod)
            tgt_tag = "" if target_char.id == char.id else f" → {target_char.name}"
            results.append(f"+{value} {stat.capitalize()} for {dur} turns{tgt_tag}")

        elif etype == "remove_status":
            status_name = eff.get("status_name", "")
            if status_name:
                res = await db.execute(
                    select(CharacterStatusEffect).where(
                        CharacterStatusEffect.character_id == target_char.id,
                        CharacterStatusEffect.name == status_name,
                    )
                )
                for cse in res.scalars().all():
                    await db.delete(cse)
                tgt_tag = "" if target_char.id == char.id else f" → {target_char.name}"
                results.append(f"Removed: {status_name}{tgt_tag}")

        elif etype == "damage":
            # Skip if this effect is deferred for defense reaction
            if needs_defense and eff in deferred_damage_effects:
                results.append(f"Damage pending — waiting for defense reaction")
                continue
            # Rework Phase 6: if a hit roll was required and it missed → skip damage entirely
            if ability.requires_hit_roll and hit_info is not None and not hit_ok:
                results.append(f"Damage skipped — attack missed")
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
            results.append(f"Damage{crit_tag}: {actual_dc}d{dt}+{fb}={total} → -{old_hp - target_char.current_hp} HP to {target_char.name}")

        elif etype == "custom":
            results.append(f"Effect: {eff.get('description', '')}")

    # Start cooldown
    if ability.cooldown_turns > 0:
        ca.cooldown_remaining = ability.cooldown_turns
        results.append(f"Cooldown: {ability.cooldown_turns} turns")

    # Rework v2: decrement the per-use counter when set.
    if ca.current_uses is not None:
        ca.current_uses = max(0, ca.current_uses - 1)

    # Defense reaction: if damage was deferred, create pending defense and return early.
    if needs_defense:
        from app.defense_reactions import create_pending_defense, broadcast_defense_request
        # Resolve session code safely (avoid lazy-load)
        session_code = ""
        if char.session_id:
            sess = await db.get(Session, char.session_id)
            if sess:
                session_code = sess.code
        # Build context so we can replay damage after defense fails
        ability_context = {
            "ca_id": ca_id,
            "body": body,
            "is_crit": is_crit,
            "target_id": target_char.id,
            "target_name": target_char.name,
            "deferred_effects": deferred_damage_effects,
        }
        pd = create_pending_defense(
            attacker_id=char.id,
            target_id=target_char.id,
            session_id=char.session_id or 0,
            session_code=session_code,
            attack_total=int(hit_info.get("total", 10)) if hit_info else 10,
            attack_roll_d20=int(hit_info.get("d20", 20)) if hit_info else 20,
            attacker_name=char.name,
            target_name=target_char.name,
            target_ac=target_char.armor_class,
            critical=False,
            fumble=False,
            hit=True,
            weapon_name=ability.name,
            ability_context=ability_context,
        )
        await broadcast_defense_request(pd)
        await db.commit()
        return {
            "ok": True,
            "ability_name": ability.name,
            "results": results,
            "character_id": char.id,
            "current_hp": char.current_hp,
            "mana_current": char.mana_current,
            "cooldown_remaining": ca.cooldown_remaining,
            "current_uses": ca.current_uses,
            "pending_defense_id": pd.id,
            "waiting_for_defense": True,
        }

    await db.commit()
    return {
        "ok": True,
        "ability_name": ability.name,
        "results": results,
        "character_id": char.id,
        "current_hp": char.current_hp,
        "mana_current": char.mana_current,
        "cooldown_remaining": ca.cooldown_remaining,
        "current_uses": ca.current_uses,
    }


async def _apply_ability_damage_only(
    ca_id: int,
    body: dict,
    db: AsyncSession,
) -> dict:
    """Replay only the deferred damage effects of an ability use.
    Called by defense_reactions when defense fails so the ability damage lands.
    Assumes costs / cooldown / non-damage effects were already applied.
    """
    from app.game_mechanics import get_effective_mana_max

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
# ABILITY LEVEL / RANK CONFIGS
# ══════════════════════════════════════════════════════════════
@router.get("/abilities/{ability_id}/level-configs")
async def list_ability_level_configs(ability_id: int, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    result = await db.execute(
        select(AbilityLevelConfig).where(AbilityLevelConfig.ability_id == ability_id).order_by(AbilityLevelConfig.level)
    )
    return [{"id": c.id, "ability_id": c.ability_id, "level": c.level, "config_json": json.loads(c.config_json) if c.config_json else {}} for c in result.scalars().all()]


@router.post("/abilities/{ability_id}/level-configs")
async def create_ability_level_config(ability_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    level = int(body.get("level", 0))
    config = body.get("config", {})
    # Upsert
    result = await db.execute(
        select(AbilityLevelConfig).where(
            AbilityLevelConfig.ability_id == ability_id,
            AbilityLevelConfig.level == level,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.config_json = json.dumps(config)
    else:
        existing = AbilityLevelConfig(ability_id=ability_id, level=level, config_json=json.dumps(config))
        db.add(existing)
    await db.commit()
    await db.refresh(existing)
    return {"id": existing.id, "ability_id": existing.ability_id, "level": existing.level, "config_json": json.loads(existing.config_json) if existing.config_json else {}}


@router.delete("/abilities/{ability_id}/level-configs/{config_id}")
async def delete_ability_level_config(ability_id: int, config_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(AbilityLevelConfig, config_id)
    if not c or c.ability_id != ability_id:
        raise HTTPException(404, "Config not found")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


@router.get("/abilities/{ability_id}/rank-configs")
async def list_ability_rank_configs(ability_id: int, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    result = await db.execute(
        select(AbilityRankConfig).where(AbilityRankConfig.ability_id == ability_id).order_by(AbilityRankConfig.rank)
    )
    return [{"id": c.id, "ability_id": c.ability_id, "rank": c.rank, "config_json": json.loads(c.config_json) if c.config_json else {}, "notes": c.notes} for c in result.scalars().all()]


@router.post("/abilities/{ability_id}/rank-configs")
async def create_ability_rank_config(ability_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    rank = str(body.get("rank", "")).lower()
    config = body.get("config", {})
    notes = body.get("notes", "")
    result = await db.execute(
        select(AbilityRankConfig).where(
            AbilityRankConfig.ability_id == ability_id,
            AbilityRankConfig.rank == rank,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.config_json = json.dumps(config)
        existing.notes = notes
    else:
        existing = AbilityRankConfig(ability_id=ability_id, rank=rank, config_json=json.dumps(config), notes=notes)
        db.add(existing)
    await db.commit()
    await db.refresh(existing)
    return {"id": existing.id, "ability_id": existing.ability_id, "rank": existing.rank, "config_json": json.loads(existing.config_json) if existing.config_json else {}, "notes": existing.notes}


@router.delete("/abilities/{ability_id}/rank-configs/{config_id}")
async def delete_ability_rank_config(ability_id: int, config_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(AbilityRankConfig, config_id)
    if not c or c.ability_id != ability_id:
        raise HTTPException(404, "Config not found")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# GM MANUAL ABILITY RANK PROMOTION
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{char_id}/abilities/{char_ability_id}/promote-rank")
async def promote_ability_rank(char_id: int, char_ability_id: int, body: dict | None = None, db: AsyncSession = Depends(get_session)):
    """GM manually promotes an ability's rank (e.g. common → uncommon)."""
    from app.game_mechanics import RANK_ORDER
    ca = await db.get(CharacterAbility, char_ability_id)
    if not ca or ca.character_id != char_id:
        raise HTTPException(404, "Ability not found on this character")

    cur_rank = (ca.ability_rank or "common").lower()
    try:
        idx = RANK_ORDER.index(cur_rank)
    except ValueError:
        raise HTTPException(400, "Invalid current rank")

    if idx + 1 >= len(RANK_ORDER):
        raise HTTPException(400, "Already at maximum rank (divine)")

    ca.ability_rank = RANK_ORDER[idx + 1]
    await db.commit()
    await db.refresh(ca)

    # WS broadcast
    try:
        from app.websocket_manager import manager as _ws
        sess = await db.get(Session, ca.character_id)
        if sess:
            await _ws.broadcast_to_session(sess.code, "ability.rank_promoted", {
                "character_id": char_id,
                "ability_id": ca.ability_id,
                "ability_name": ca.ability.name if ca.ability else "Unknown",
                "new_rank": ca.ability_rank,
            })
    except Exception:
        pass

    return {
        "ok": True,
        "character_id": char_id,
        "ability_id": ca.ability_id,
        "ability_rank": ca.ability_rank,
        "ability_level": ca.ability_level,
    }
