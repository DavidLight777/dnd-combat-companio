"""Full combat attack flow."""
import random

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character,
    Session,
)
from app.routers.combat_events.common import (
    ExecuteAttackBody,
    _char_stats_dict,
    _get_char_bonuses_and_penalties,
    _get_equipped_weapon,
    _resolve_display_stat,
    router,
)
from app.websocket_manager import manager


@router.post("/execute-attack")
async def execute_attack(body: ExecuteAttackBody, db: AsyncSession = Depends(get_session)):
    """
    Full combat attack flow: hit roll → damage roll → apply damage → broadcast.
    Returns complete breakdown strings for all steps.
    """
    from app.game_mechanics import (
        calculate_combat_attack,
        resolve_advantage_mode,
        stat_modifier,
    )

    # 1. Load attacker & target
    attacker = await db.get(Character, body.attacker_id)
    target = await db.get(Character, body.target_id)
    if not attacker:
        raise HTTPException(404, "Attacker not found")
    if not target:
        raise HTTPException(404, "Target not found")

    # 2. Load bonuses & penalties
    atk_item_bonuses, atk_status_penalties = await _get_char_bonuses_and_penalties(attacker, db)
    tgt_item_bonuses, tgt_status_penalties = await _get_char_bonuses_and_penalties(target, db)

    # 3. Get weapon
    weapon = await _get_equipped_weapon(body.attacker_id, db)

    # 3a. Rework v3 Phase 7 — range enforcement. Weapons carry a
    # `range_cells` value (default 1 = melee adjacent). If attacker
    # and target are both placed on the current battle map, reject
    # the call when the Chebyshev distance exceeds that budget. Non-
    # grid flows (no map / missing positions) fall through via
    # `RangeCheck.skipped=True` so this is strictly additive.
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

    # 4. Resolve advantage mode (player choice + forced status)
    adv_mode = resolve_advantage_mode(body.advantage, atk_status_penalties)

    # 5. Stat modifier for attack
    attacker_stats = _char_stats_dict(attacker)
    item_atk_bonus = int(atk_item_bonuses.get("attack_bonus", 0))
    status_atk_penalty = atk_status_penalties.get("attack_penalty", 0)

    # 6. HIT ROLL
    if body.player_roll is not None:
        # Player submitted d20 — use as-is (single roll, no advantage re-roll)
        d20 = body.player_roll
        atk_result = calculate_combat_attack(
            attacker_stats, target.armor_class, weapon,
            item_atk_bonus, status_atk_penalty, "normal",
        )
        # Override d20 with player roll
        sm = atk_result.stat_mod
        wb = atk_result.weapon_bonus
        total = d20 + sm + wb + item_atk_bonus - status_atk_penalty
        fumble = (d20 == 1)
        critical = (d20 == 20)
        hit = False if fumble else (critical or total >= target.armor_class)
    else:
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

    # 7. Build hit breakdown string
    parts = [f"D20({d20})"]
    if sm != 0:
        _, stat_name = _resolve_display_stat(weapon, attacker, "hit")
        stat_name = stat_name or "STR"
        parts.append(f"{stat_name}({'+' if sm >= 0 else ''}{sm})")
    if wb != 0:
        parts.append(f"{weapon['name'] if weapon else 'Weapon'}({'+' if wb >= 0 else ''}{wb})")
    if item_atk_bonus != 0:
        # Find item sources for attack bonus
        for bd in atk_item_bonuses.get("breakdown", []):
            if bd["bonus_type"] == "attack_bonus":
                parts.append(f"{bd['source']}(+{int(bd['value'])})")
    if status_atk_penalty != 0:
        parts.append(f"Status({status_atk_penalty})")

    hit_str = " + ".join(parts) + f" = {total} vs AC {target.armor_class}"
    if fumble:
        hit_str += " → FUMBLE (nat 1)"
    elif critical:
        hit_str += " → CRITICAL HIT (nat 20)"
    elif hit:
        hit_str += " → HIT"
    else:
        hit_str += " → MISS"

    # Advantage / N-dice prefix (adv_breakdown already formatted by engine)
    if body.player_roll is None and atk_result.advantage_breakdown:
        hit_str = f"{atk_result.advantage_breakdown} | " + hit_str

    # 8. If miss, return early
    if not hit:
        return {
            "hit": False,
            "critical": False,
            "fumble": fumble,
            "hit_breakdown": hit_str,
            "damage_breakdown": None,
            "intake_breakdown": None,
            "final_damage": 0,
            "target_hp_before": target.current_hp,
            "target_hp_after": target.current_hp,
            "attacker_name": attacker.name,
            "target_name": target.name,
        }

    # 9. DAMAGE ROLL
    # Rework v3: honor preset damage_modes first, then GM dice overrides.
    _xa_damage_modes = (weapon or {}).get("damage_modes") or []
    if weapon:
        if _xa_damage_modes:
            idx = 0 if body.damage_mode_index is None else int(body.damage_mode_index)
            idx = max(0, min(len(_xa_damage_modes) - 1, idx))
            _mode = _xa_damage_modes[idx]
            dc = int(_mode.get("dice_count", weapon["dice_count"]))
            dt = int(_mode.get("dice_type", weapon["dice_type"]))
        else:
            dc = weapon["dice_count"]
            dt = weapon["dice_type"]
    else:
        dc = attacker.attack_dice_count or 1
        dt = attacker.attack_dice_type or 6

    # FIX 3: allow universal dice widget (GM superpower) to override dice count/type
    if body.dice_count is not None and body.dice_count > 0:
        dc = min(20, max(1, int(body.dice_count)))
    if body.dice_type is not None and body.dice_type > 0:
        dt = int(body.dice_type)

    # Roll damage dice (crit = double dice count)
    actual_dc = dc * 2 if critical else dc
    dice_rolls = [random.randint(1, dt) for _ in range(actual_dc)]
    base_damage = sum(dice_rolls)

    # Stat mod for damage
    if weapon:
        from app.game_mechanics import _calc_damage_stat_mod
        dmg_sm = _calc_damage_stat_mod(attacker_stats, weapon)
    else:
        dmg_sm = stat_modifier(attacker.strength)

    item_dmg_bonus = int(atk_item_bonuses.get("damage_bonus", 0))
    status_dmg_penalty = atk_status_penalties.get("damage_penalty", 0)

    raw_damage = max(0, base_damage + dmg_sm + item_dmg_bonus - status_dmg_penalty)

    # Build damage breakdown string
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
    if critical:
        damage_str = "CRIT ×2 dice! " + damage_str

    # 10. APPLY DAMAGE TO TARGET (armor/reduction)
    # Get target's flat & percent damage reduction from items
    tgt_flat_dr = int(tgt_item_bonuses.get("flat_damage_reduction", 0))
    tgt_pct_dr = float(tgt_item_bonuses.get("percent_damage_reduction", 0))
    # Status penalty on reduction (negative = less protection)
    tgt_dr_penalty = tgt_status_penalties.get("damage_reduction_penalty", 0.0)
    total_pct_reduction = min(100.0, max(0.0, tgt_pct_dr + tgt_dr_penalty))

    after_pct = raw_damage * (1.0 - total_pct_reduction / 100.0)
    final_damage = max(0, int(after_pct) - tgt_flat_dr)

    # Build intake breakdown string
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

    # 11. Apply to target HP (check for spiritual damage type)
    damage_type = weapon.get("damage_type", "physical") if weapon else "physical"
    is_spiritual = damage_type == "spiritual"

    if is_spiritual:
        hp_before = target.spiritual_hp or 0
        target.spiritual_hp = max(0, (target.spiritual_hp or 0) - final_damage)
        hp_after = target.spiritual_hp
        # Spiritual HP 0 doesn't kill character, just depletes spirit
        target_downed = False
    else:
        hp_before = target.current_hp
        target.current_hp = max(0, target.current_hp - final_damage)
        hp_after = target.current_hp
        target_downed = hp_after <= 0

    if target_downed:
        target.is_alive = False

        # Fix 4: Award XP for killing blow
        if target.is_npc and getattr(target, "kill_xp_reward", 0) and target.kill_xp_reward > 0:
            if not attacker.is_npc:
                attacker.experience = (attacker.experience or 0) + target.kill_xp_reward
                await db.commit()
                await db.refresh(attacker)

                # WS broadcast
                try:
                    from app.game_mechanics import check_and_trigger_level_up
                    sess = await db.get(Session, target.session_id)
                    if sess:
                        await manager.broadcast_to_session(sess.code, "xp.awarded", {
                            "character_id": attacker.id,
                            "character_name": attacker.name,
                            "amount": target.kill_xp_reward,
                            "source": f"Killed {target.name}",
                        })
                        # Check level-up availability
                        level_up_info = await check_and_trigger_level_up(db, attacker)
                        if level_up_info.get("leveled_up"):
                            await manager.broadcast_to_session(sess.code, "level_up.available", {
                                "character_id": attacker.id,
                                "current_xp": attacker.experience,
                                "xp_needed": level_up_info["xp_needed"],
                            })
                except Exception:
                    pass

    await db.commit()
    await db.refresh(target)

    return {
        "hit": True,
        "critical": critical,
        "fumble": False,
        "hit_breakdown": hit_str,
        "damage_breakdown": damage_str,
        "intake_breakdown": intake_str,
        "final_damage": final_damage,
        "target_hp_before": hp_before,
        "target_hp_after": hp_after,
        "target_downed": target_downed,
        "attacker_name": attacker.name,
        "target_name": target.name,
        "dice_rolls": dice_rolls,
        "raw_damage": raw_damage,
    }


# ══════════════════════════════════════════════════════════════
# TWO-STEP ATTACK FLOW: /hit-roll → /damage-roll
# Players (and GM for NPCs) can roll d20 first, see HIT/CRIT/MISS,
# then roll damage with their own dice count/type + adv/disadv.
