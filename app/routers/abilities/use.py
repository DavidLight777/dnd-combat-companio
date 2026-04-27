"""Use ability endpoint."""
import json
import random
from datetime import UTC, datetime

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    AbilityLevelConfig,
    AbilityRankConfig,
    Character,
    CharacterAbility,
    CharacterStatusEffect,
    Session,
    StatModifier,
    StatusEffectTemplate,
)
from app.routers.abilities.common import router
from app.routers.abilities.resolve import _resolve_ability


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
    from app.game_mechanics import get_effective_mana_max, spend_mana
    from app.game_mechanics import restore_mana as _restore_mana

    body = body or {}
    ca = await db.get(CharacterAbility, ca_id)
    if not ca:
        raise HTTPException(404, "Character ability not found")
    if not ca.is_unlocked:
        raise HTTPException(400, "Ability is locked")
    if ca.cooldown_remaining > 0:
        raise HTTPException(400, f"Ability on cooldown ({ca.cooldown_remaining} turns remaining)")

    # Load rank/level configs explicitly to avoid async lazy-load issues
    lc_result = await db.execute(
        select(AbilityLevelConfig).where(AbilityLevelConfig.ability_id == ca.ability_id)
    )
    rc_result = await db.execute(
        select(AbilityRankConfig).where(AbilityRankConfig.ability_id == ca.ability_id)
    )
    level_configs = lc_result.scalars().all()
    rank_configs = rc_result.scalars().all()

    # Rework: resolve ability with level + rank configs applied
    ability = _resolve_ability(
        ca.ability,
        ca.ability_level or 0,
        ca.ability_rank or "common",
        level_configs=level_configs,
        rank_configs=rank_configs,
    )
    char = await db.get(Character, ca.character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    # Rework v2: limited-use check. null = infinite, 0 = depleted.
    if ca.current_uses is not None and ca.current_uses <= 0:
        raise HTTPException(400, {"error": True, "code": "NO_USES_LEFT",
                                  "message": f"{ability['name']} has no uses left."})

    # Rework v2: conditional-only features have no mechanics — emit flavor log.
    if ability["is_conditional"]:
        if ca.current_uses is not None:
            ca.current_uses = max(0, ca.current_uses - 1)
        await db.commit()
        return {
            "ok": True,
            "ability_name": ability["name"],
            "results": [ability["conditional_text"] or f"{ability['name']} — GM call."],
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
    if ability["requires_hit_roll"] and hit_info is not None:
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
    if ability["requires_hit_roll"] and hit_info is not None:
        bd = hit_info.get("breakdown") or f"Total {hit_info.get('total','?')}"
        if not hit_ok:
            results.append(f"✗ {ability['name']} missed ({bd})")
        elif is_crit:
            results.append(f"✨ CRIT — {ability['name']} ({bd})")
        else:
            results.append(f"✓ {ability['name']} hits ({bd})")

    # Mana cost
    if ability["mana_cost"] > 0:
        eff_max = get_effective_mana_max(char.mana_max)
        mana_result = spend_mana(char.mana_current, eff_max, ability["mana_cost"])
        if not mana_result["success"]:
            raise HTTPException(400, {"error": True, "code": "NOT_ENOUGH_MANA",
                                      "message": mana_result["message"]})
        char.mana_current = mana_result["mana_current"]
        results.append(f"Spent {ability['mana_cost']} mana")

    # HP cost
    if ability["hp_cost"] > 0:
        if char.current_hp <= ability["hp_cost"]:
            raise HTTPException(400, {"error": True, "code": "NOT_ENOUGH_HP",
                                      "message": f"Need {ability['hp_cost']} HP but only have {char.current_hp}"})
        char.current_hp -= ability["hp_cost"]
        results.append(f"Spent {ability['hp_cost']} HP")

    # Parse effects
    try:
        eff_data = json.loads(ability["effect"]) if isinstance(ability["effect"], str) else ability["effect"]
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
        ability["damage_dice_count"]
        and ability["damage_dice_type"]
        and not any(isinstance(e, dict) and e.get("type") == "damage" for e in effects_list)
    ):
        effects_list = list(effects_list) + [{
            "type": "damage",
            "dice_count": int(ability["damage_dice_count"]),
            "dice_type":  int(ability["damage_dice_type"]),
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
    _is_offensive = bool(ability["requires_hit_roll"]) or _has_damage
    if _is_offensive and (not target_id or int(target_id) == char.id):
        # target_type=='self' is an edge case — a self-damage ability
        # is legal, but any other target_type means the client forgot
        # to send target_id.
        if ability["target_type"] not in ("self",):
            raise HTTPException(400, {
                "error": True, "code": "TARGET_REQUIRED",
                "message": f"{ability['name']} needs a target — pick an enemy.",
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
        _rc = await check_range(char, target_char, ability["range_cells"], db)
        if not _rc.ok:
            raise HTTPException(403, {
                "error": True, "code": "OUT_OF_RANGE",
                "message": (
                    f"Out of range — {target_char.name} is {_rc.distance_cells:g} cells away, "
                    f"{ability['name']} reaches {_rc.max_cells}."
                ),
                "distance_cells": _rc.distance_cells,
                "max_cells": _rc.max_cells,
            })

    # Defense reaction: if ability requires hit roll, hit is normal (not crit/miss),
    # and there are damage effects targeting another character → defer damage.
    deferred_damage_effects = []
    needs_defense = False
    if (
        ability["requires_hit_roll"]
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
                name=f"{ability['name']} boost", value=value,
                is_active=True, source="potion",
                expires_at=datetime.now(UTC) + timedelta(minutes=dur * 2),
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
                results.append("Damage pending — waiting for defense reaction")
                continue
            # Rework Phase 6: if a hit roll was required and it missed → skip damage entirely
            if ability["requires_hit_roll"] and hit_info is not None and not hit_ok:
                results.append("Damage skipped — attack missed")
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
    if ability["cooldown_turns"] > 0:
        ca.cooldown_remaining = ability["cooldown_turns"]
        results.append(f"Cooldown: {ability['cooldown_turns']} turns")

    # Rework v2: decrement the per-use counter when set.
    if ca.current_uses is not None:
        ca.current_uses = max(0, ca.current_uses - 1)

    # Defense reaction: if damage was deferred, create pending defense and return early.
    if needs_defense:
        from app.defense_reactions import broadcast_defense_request, create_pending_defense
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
            weapon_name=ability["name"],
            ability_context=ability_context,
        )
        await broadcast_defense_request(pd)
        await db.commit()
        return {
            "ok": True,
            "ability_name": ability["name"],
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
        "ability_name": ability["name"],
        "results": results,
        "character_id": char.id,
        "current_hp": char.current_hp,
        "mana_current": char.mana_current,
        "cooldown_remaining": ca.cooldown_remaining,
        "current_uses": ca.current_uses,
    }


