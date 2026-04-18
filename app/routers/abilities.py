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
)

router = APIRouter(prefix="/api", tags=["abilities"])


# ── Ability templates CRUD ───────────────────────────────────
@router.get("/abilities")
async def list_abilities(session_id: int | None = None, db: AsyncSession = Depends(get_session)):
    q = select(Ability)
    if session_id is not None:
        q = q.where((Ability.session_id == session_id) | (Ability.session_id == None))
    result = await db.execute(q.order_by(Ability.name))
    return [_ability_dict(a) for a in result.scalars().all()]


_ABILITY_FIELDS = (
    "name", "description", "session_id",
    "icon", "color", "flavor_text", "notes",
    "ability_type", "target_type", "aoe_radius",
    "damage_type", "custom_damage_type",
    "mana_cost", "hp_cost", "cooldown_turns",
    "requires_hit_roll", "hit_stat", "damage_stat",
    "damage_dice_count", "damage_dice_type",
    "is_passive", "range",
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
        # Passive
        "is_passive": a.is_passive,
        "passive_effect": _parse_json_field(a.passive_effect),
        # Effects
        "effect": _parse_json_field(a.effect),
        "range": a.range,
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
    """Apply passive ability bonuses as permanent modifiers."""
    pe = _parse_json_field(ability.passive_effect)
    bonuses = pe.get("bonuses", []) if isinstance(pe, dict) else []
    source_name = f"Ability: {ability.name}"
    for b in bonuses:
        btype = b.get("bonus_type", "")
        val = b.get("value", 0)
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
            # Store as stat modifier with special stat name
            db.add(StatModifier(
                character_id=char_id, stat_name=btype,
                name=source_name, value=val, is_active=True, source="ability",
            ))


async def _remove_passive_bonuses(char_id: int, ability: Ability, db: AsyncSession):
    """Remove all modifiers created by a passive ability."""
    source_name = f"Ability: {ability.name}"
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
            old_hp = char.current_hp
            char.current_hp = min(char.max_hp, char.current_hp + total)
            crit_tag = " CRIT×2" if is_crit else ""
            results.append(f"Heal{crit_tag}: {actual_dc}d{dt}+{fb}={total} → +{char.current_hp - old_hp} HP")

        elif etype == "restore_mana":
            amount = eff.get("amount", 0)
            eff_max = get_effective_mana_max(char.mana_max)
            old_mana = char.mana_current
            char.mana_current = _restore_mana(char.mana_current, eff_max, amount=amount)
            results.append(f"Mana: +{char.mana_current - old_mana}")

        elif etype == "apply_status":
            template_id = eff.get("template_id")
            duration = eff.get("duration_turns")
            if template_id:
                tmpl = await db.get(StatusEffectTemplate, template_id)
                if tmpl:
                    cse = CharacterStatusEffect(
                        character_id=char.id, template_id=tmpl.id,
                        name=tmpl.name, icon=tmpl.icon, color=tmpl.color,
                        effects=tmpl.effects,
                        remaining_turns=duration if duration else tmpl.default_duration,
                    )
                    db.add(cse)
                    results.append(f"Applied: {tmpl.icon} {tmpl.name}")

        elif etype == "stat_boost":
            from datetime import timedelta
            stat = eff.get("stat", "strength")
            value = eff.get("value", 0)
            dur = eff.get("duration_turns", 3)
            mod = StatModifier(
                character_id=char.id, stat_name=stat,
                name=f"{ability.name} boost", value=value,
                is_active=True, source="potion",
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=dur * 2),
            )
            db.add(mod)
            results.append(f"+{value} {stat.capitalize()} for {dur} turns")

        elif etype == "remove_status":
            status_name = eff.get("status_name", "")
            if status_name:
                res = await db.execute(
                    select(CharacterStatusEffect).where(
                        CharacterStatusEffect.character_id == char.id,
                        CharacterStatusEffect.name == status_name,
                    )
                )
                for cse in res.scalars().all():
                    await db.delete(cse)
                results.append(f"Removed: {status_name}")

        elif etype == "damage":
            # Rework Phase 6: if a hit roll was required and it missed → skip damage entirely
            if ability.requires_hit_roll and hit_info is not None and not hit_ok:
                results.append(f"Damage skipped — attack missed")
                continue
            dc = _override_dc(eff.get("dice_count", 1))
            dt = _override_dt(eff.get("dice_type", 6))
            fb = eff.get("flat_bonus", 0)
            actual_dc = dc * 2 if is_crit else dc
            target_id = body.get("target_id")
            target = await db.get(Character, target_id) if target_id else char
            if not target:
                target = char
            rolls = [random.randint(1, dt) for _ in range(max(1, actual_dc))]
            total = sum(rolls) + fb
            old_hp = target.current_hp
            target.current_hp = max(0, target.current_hp - total)
            if target.current_hp <= 0:
                target.is_alive = False
            crit_tag = " CRIT×2" if is_crit else ""
            results.append(f"Damage{crit_tag}: {actual_dc}d{dt}+{fb}={total} → -{old_hp - target.current_hp} HP to {target.name}")

        elif etype == "custom":
            results.append(f"Effect: {eff.get('description', '')}")

    # Start cooldown
    if ability.cooldown_turns > 0:
        ca.cooldown_remaining = ability.cooldown_turns
        results.append(f"Cooldown: {ability.cooldown_turns} turns")

    await db.commit()
    return {
        "ok": True,
        "ability_name": ability.name,
        "results": results,
        "character_id": char.id,
        "current_hp": char.current_hp,
        "mana_current": char.mana_current,
        "cooldown_remaining": ca.cooldown_remaining,
    }
