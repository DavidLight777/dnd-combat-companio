"""Hit roll and damage roll endpoints."""
import random

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character,
    Session,
)
from app.routers.combat_events.common import (
    DamageRollBody,
    HitRollBody,
    _apply_weapon_poison_on_hit,
    _char_stats_dict,
    _get_char_bonuses_and_penalties,
    _get_equipped_weapon,
    _resolve_display_stat,
    router,
)


@router.post("/hit-roll")
async def hit_roll(body: HitRollBody, db: AsyncSession = Depends(get_session)):
    """Step 1: Roll d20 + mods against target AC. No damage applied."""
    from app.game_mechanics import (
        calculate_combat_attack,
        resolve_advantage_mode,
    )

    attacker = await db.get(Character, body.attacker_id)
    target = await db.get(Character, body.target_id)
    if not attacker:
        raise HTTPException(404, "Attacker not found")
    if not target:
        raise HTTPException(404, "Target not found")

    atk_item_bonuses, atk_status_penalties = await _get_char_bonuses_and_penalties(attacker, db)
    weapon = await _get_equipped_weapon(body.attacker_id, db)

    # Rework v3 Phase 7 — mirror the range enforcement that
    # /execute-attack does, so the two-step flow can't bypass it.
    from app.combat_range import check_range
    _weapon_range = (weapon or {}).get("range_cells") if weapon else None
    _rc = await check_range(attacker, target, _weapon_range, db)
    if not _rc.ok:
        raise HTTPException(403, {
            "error": True, "code": "OUT_OF_RANGE",
            "message": (
                f"Out of range — {target.name} is {_rc.distance_cells:g} cells away, "
                f"weapon reaches {_rc.max_cells}."
            ),
            "distance_cells": _rc.distance_cells,
            "max_cells": _rc.max_cells,
        })

    adv_mode = resolve_advantage_mode(body.advantage, atk_status_penalties)
    attacker_stats = _char_stats_dict(attacker)
    item_atk_bonus = int(atk_item_bonuses.get("attack_bonus", 0))
    status_atk_penalty = atk_status_penalties.get("attack_penalty", 0)

    atk_result = calculate_combat_attack(
        attacker_stats, target.armor_class, weapon,
        item_atk_bonus, status_atk_penalty, adv_mode,
        dice_count=body.hit_dice_count,
    )
    d20 = atk_result.d20
    sm = atk_result.stat_mod
    wb = atk_result.weapon_bonus
    total = atk_result.total
    fumble = atk_result.fumble
    critical = atk_result.critical
    hit = atk_result.hit

    # Build breakdown string (same logic as execute_attack)
    parts = [f"D20({d20})"]
    if sm != 0:
        _, stat_name = _resolve_display_stat(weapon, attacker, "hit")
        stat_name = stat_name or "STR"
        parts.append(f"{stat_name}({'+' if sm >= 0 else ''}{sm})")
    if wb != 0:
        parts.append(f"{weapon['name'] if weapon else 'Weapon'}({'+' if wb >= 0 else ''}{wb})")
    if item_atk_bonus != 0:
        for bd in atk_item_bonuses.get("breakdown", []):
            if bd["bonus_type"] == "attack_bonus":
                parts.append(f"{bd['source']}(+{int(bd['value'])})")
    if status_atk_penalty != 0:
        parts.append(f"Status({-status_atk_penalty})")

    hit_str = " + ".join(parts) + f" = {total} vs AC {target.armor_class}"
    if fumble:
        hit_str += " → FUMBLE (nat 1)"
    elif critical:
        hit_str += " → CRITICAL HIT (nat 20)"
    elif hit:
        hit_str += " → HIT"
    else:
        hit_str += " → MISS"

    if atk_result.advantage_breakdown:
        hit_str = f"{atk_result.advantage_breakdown} | " + hit_str

    # Suggest default damage dice from weapon
    if weapon:
        default_dc = weapon.get("dice_count", 1)
        default_dt = weapon.get("dice_type", 6)
        weapon_name = weapon.get("name", "Weapon")
        damage_modes = weapon.get("damage_modes") or []
    else:
        default_dc = attacker.attack_dice_count or 1
        default_dt = attacker.attack_dice_type or 6
        weapon_name = "Unarmed"
        damage_modes = []

    # Defense reaction: on a normal hit (not crit, not fumble, not miss)
    # create a pending defense so the target can choose dodge or static AC.
    pending_defense_id = None
    if hit and not critical and not fumble:
        from app.defense_reactions import broadcast_defense_request, create_pending_defense
        sess = await db.get(Session, attacker.session_id)
        session_code = sess.code if sess else ""
        pd = create_pending_defense(
            attacker_id=attacker.id,
            target_id=target.id,
            session_id=attacker.session_id or 0,
            session_code=session_code,
            attack_total=total,
            attack_roll_d20=d20,
            attacker_name=attacker.name,
            target_name=target.name,
            target_ac=target.armor_class,
            critical=critical,
            fumble=fumble,
            hit=hit,
            weapon_name=weapon_name,
        )
        pending_defense_id = pd.id
        await broadcast_defense_request(pd)

    return {
        "hit": hit,
        "critical": critical,
        "fumble": fumble,
        "d20": d20,
        "all_d20s": list(atk_result.all_d20s),
        "dice_count_rolled": len(atk_result.all_d20s),
        "total": total,
        "hit_breakdown": hit_str,
        "advantage_mode": adv_mode,
        "attacker_name": attacker.name,
        "target_name": target.name,
        "target_ac": target.armor_class,
        # Suggest defaults for damage step (read-only for player UI)
        "weapon_name": weapon_name,
        "default_dice_count": default_dc,
        "default_dice_type": default_dt,
        # Rework v3: preset damage modes available on the weapon (can be empty)
        "damage_modes": damage_modes,
        "pending_defense_id": pending_defense_id,
    }

@router.post("/damage-roll")
async def damage_roll(body: DamageRollBody, db: AsyncSession = Depends(get_session)):
    """Step 2: Roll damage dice, apply reduction, deduct HP from target."""
    from app.game_mechanics import (
        _calc_damage_stat_mod,
        apply_advantage,
        stat_modifier,
    )

    attacker = await db.get(Character, body.attacker_id)
    target = await db.get(Character, body.target_id)
    if not attacker:
        raise HTTPException(404, "Attacker not found")
    if not target:
        raise HTTPException(404, "Target not found")

    atk_item_bonuses, atk_status_penalties = await _get_char_bonuses_and_penalties(attacker, db)
    tgt_item_bonuses, tgt_status_penalties = await _get_char_bonuses_and_penalties(target, db)
    weapon = await _get_equipped_weapon(body.attacker_id, db)

    # Rework v3: damage dice are fixed by the weapon. If the weapon exposes
    # alternate `damage_modes`, the player picks a preset via
    # ``body.damage_mode_index``. GM-side panel may override `dice_count` /
    # `dice_type` (e.g. to roll extra dice on a power attack); when set on
    # the body they take precedence over weapon defaults.
    damage_modes = (weapon or {}).get("damage_modes") or []
    chosen_mode = None
    if weapon:
        if damage_modes:
            idx = 0 if body.damage_mode_index is None else int(body.damage_mode_index)
            if not (0 <= idx < len(damage_modes)):
                raise HTTPException(400, f"invalid damage_mode_index {idx} (weapon has {len(damage_modes)} modes)")
            chosen_mode = damage_modes[idx]
            dc = int(chosen_mode.get("dice_count", weapon["dice_count"]))
            dt = int(chosen_mode.get("dice_type", weapon["dice_type"]))
        else:
            dc = weapon["dice_count"]
            dt = weapon["dice_type"]
    else:
        dc = attacker.attack_dice_count or 1
        dt = attacker.attack_dice_type or 6

    # GM/Power-attack override: if caller passes explicit dice_count/dice_type,
    # honor them (clamped to a sane range).
    if body.dice_count is not None and int(body.dice_count) > 0:
        dc = max(1, min(20, int(body.dice_count)))
    if body.dice_type is not None and int(body.dice_type) > 0:
        dt = max(2, min(100, int(body.dice_type)))

    # Crit doubles dice count
    actual_dc = dc * 2 if body.critical else dc

    # Roll with advantage on the *damage* total
    attacker_stats = _char_stats_dict(attacker)
    if weapon:
        # Honor the chosen mode's damage_stat if set, else weapon default.
        if chosen_mode and chosen_mode.get("damage_stat") is not None:
            from app.game_mechanics import stat_modifier as _sm
            stat_key = str(chosen_mode.get("damage_stat"))
            raw_val = attacker_stats.get(stat_key)
            dmg_sm = _sm(int(raw_val)) if isinstance(raw_val, int) else 0
        else:
            dmg_sm = _calc_damage_stat_mod(attacker_stats, weapon)
    else:
        dmg_sm = stat_modifier(attacker.strength)

    item_dmg_bonus = int(atk_item_bonuses.get("damage_bonus", 0))
    status_dmg_penalty = atk_status_penalties.get("damage_penalty", 0)

    def _roll_once():
        rolls = [random.randint(1, dt) for _ in range(actual_dc)]
        base = sum(rolls)
        raw = max(0, base + dmg_sm + item_dmg_bonus - status_dmg_penalty)
        return raw, rolls

    adv_mode = body.advantage if body.advantage in ("normal", "advantage", "disadvantage") else "normal"
    adv = apply_advantage(_roll_once, adv_mode)
    dice_rolls = adv.all_details[adv.chosen_index]
    base_damage = sum(dice_rolls)
    raw_damage = adv.chosen_total

    # Build damage breakdown
    dice_str = "+".join(str(r) for r in dice_rolls)
    dmg_parts = [f"{actual_dc}d{dt}({dice_str}={base_damage})"]
    if dmg_sm != 0:
        _, stat_label = _resolve_display_stat(weapon, attacker, "damage")
        stat_label = stat_label or "STR"
        dmg_parts.append(f"{stat_label} mod({'+' if dmg_sm >= 0 else ''}{dmg_sm})")
    if item_dmg_bonus != 0:
        for bd in atk_item_bonuses.get("breakdown", []):
            if bd["bonus_type"] == "damage_bonus":
                dmg_parts.append(f"{bd['source']}(+{int(bd['value'])})")
    if status_dmg_penalty != 0:
        dmg_parts.append(f"Status({-status_dmg_penalty})")

    damage_str = " + ".join(dmg_parts) + f" = {raw_damage} raw"
    if body.critical:
        damage_str = "CRIT ×2 dice! " + damage_str
    if adv_mode != "normal":
        adv_label = "ADV" if adv_mode == "advantage" else "DISADV"
        totals = adv.all_totals
        damage_str = f"{adv_label}: Dmg[{', '.join(str(x) for x in totals)}] took {raw_damage} | " + damage_str

    # Apply target reductions
    tgt_flat_dr = int(tgt_item_bonuses.get("flat_damage_reduction", 0))
    tgt_pct_dr = float(tgt_item_bonuses.get("percent_damage_reduction", 0))
    tgt_dr_penalty = tgt_status_penalties.get("damage_reduction_penalty", 0.0)
    total_pct_reduction = min(100.0, max(0.0, tgt_pct_dr + tgt_dr_penalty))

    after_pct = raw_damage * (1.0 - total_pct_reduction / 100.0)
    final_damage = max(0, int(after_pct) - tgt_flat_dr)

    intake_parts = [f"{raw_damage}"]
    if total_pct_reduction > 0:
        sources = [bd for bd in tgt_item_bonuses.get("breakdown", []) if bd["bonus_type"] == "percent_damage_reduction"]
        src_str = ", ".join(f"{s['source']}({s['value']}%)" for s in sources)
        if tgt_dr_penalty:
            src_str += f", Status({tgt_dr_penalty}%)"
        intake_parts.append(f"× {(100 - total_pct_reduction):.0f}% ({src_str})")
        intake_parts.append(f"= {int(after_pct)}")
    if tgt_flat_dr > 0:
        sources = [bd for bd in tgt_item_bonuses.get("breakdown", []) if bd["bonus_type"] == "flat_damage_reduction"]
        src_str = ", ".join(f"{s['source']}({int(s['value'])})" for s in sources)
        intake_parts.append(f"- {tgt_flat_dr} flat ({src_str})")
    intake_str = " ".join(intake_parts) + f" = {final_damage} final"

    # Apply HP change (check for spiritual damage type)
    # Damage type comes from chosen damage mode (if any), then weapon, else physical.
    if chosen_mode and chosen_mode.get("damage_type"):
        damage_type = chosen_mode["damage_type"]
    elif weapon and weapon.get("damage_type"):
        damage_type = weapon["damage_type"]
    else:
        damage_type = "physical"
    is_spiritual = damage_type == "spiritual"

    if is_spiritual:
        hp_before = target.spiritual_hp or 0
        target.spiritual_hp = max(0, (target.spiritual_hp or 0) - final_damage)
        hp_after = target.spiritual_hp
        target_downed = False
    else:
        hp_before = target.current_hp
        target.current_hp = max(0, target.current_hp - final_damage)
        hp_after = target.current_hp
        target_downed = hp_after <= 0
    if target_downed:
        target.is_alive = False

    # Rework Phase 5: apply weapon-poison DoT to target (only if damage actually landed)
    poison_applied = None
    if final_damage > 0 and not target_downed:
        poison_applied = await _apply_weapon_poison_on_hit(attacker, target, db)

    await db.commit()
    await db.refresh(target)

    return {
        "critical": body.critical,
        "damage_breakdown": damage_str,
        "intake_breakdown": intake_str,
        "dice_rolls": dice_rolls,
        "raw_damage": raw_damage,
        "final_damage": final_damage,
        "target_hp_before": hp_before,
        "target_hp_after": hp_after,
        "target_downed": target_downed,
        "attacker_name": attacker.name,
        "target_name": target.name,
        "poison": poison_applied,
    }

