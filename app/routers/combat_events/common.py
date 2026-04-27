"""Combat events — shared router, schemas, helpers."""
import json
import random
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Character,
    CharacterAbility,
    CharacterStatusEffect,
    CombatEvent,
    CombatParticipant,
    InventoryItem,
    StatModifier,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api/combat", tags=["combat"])

# ── Schemas ───────────────────────────────────────────────────
class CreateCombatBody(BaseModel):
    session_id: int
    name: str = "Combat"


class AddParticipantBody(BaseModel):
    character_id: int


class AddParticipantsBody(BaseModel):
    character_ids: list[int]


class SetInitiativeBody(BaseModel):
    character_id: int
    roll: int


class ManualInitiativeBody(BaseModel):
    participant_id: int
    final_initiative: int


class TimerBody(BaseModel):
    participant_id: int
    duration_seconds: int


class ExecuteAttackBody(BaseModel):
    attacker_id: int
    target_id: int
    attack_type: str = "weapon"     # "weapon" | "ability"
    ability_id: int | None = None
    advantage: str = "normal"       # "advantage" | "normal" | "disadvantage"
    player_roll: int | None = None  # optional player-submitted d20
    # FIX 3: optional dice overrides from universal dice widget (GM superpower;
    # ignored by the player-facing two-step flow).
    dice_count: int | None = None
    dice_type:  int | None = None
    # Rework v3: number of d20s rolled on the HIT check (1..ADV_DICE_CAP).
    # Default behaviour: 1 for normal, 2 for adv/disadv.
    hit_dice_count: int | None = None
    # Rework v3: picks a preset from weapon.damage_modes, if any.
    damage_mode_index: int | None = None


# Two-step attack flow: hit roll only (no damage, no apply)
class HitRollBody(BaseModel):
    attacker_id: int
    target_id: int
    advantage: str = "normal"       # "advantage" | "normal" | "disadvantage"
    hit_dice_count: int | None = None   # Rework v3: number of d20s


# Two-step attack flow: damage roll only (applies damage to target)
class DamageRollBody(BaseModel):
    attacker_id: int
    target_id: int
    critical: bool = False          # must come from preceding hit roll
    # Rework v3: damage dice are fixed by the weapon; player-supplied dice_count
    # / dice_type are ignored for normal attacks. The `damage_mode_index` field
    # picks from ``weapon.damage_modes`` if the weapon has multiple modes.
    damage_mode_index: int | None = None
    advantage: str = "normal"       # advantage on damage roll itself
    dice_count: int | None = None   # accepted for back-compat; ignored for players
    dice_type:  int | None = None   # accepted for back-compat; ignored for players


# ── Helpers ───────────────────────────────────────────────────
_STAT_SHORT = {
    "strength": "STR", "dexterity": "DEX", "constitution": "CON",
    "intelligence": "INT", "wisdom": "WIS", "charisma": "CHA",
}


def _stat_short(name: str | None) -> str:
    if not name:
        return ""
    return _STAT_SHORT.get(name, name[:3].upper())


def _resolve_display_stat(weapon: dict | None, attacker, kind: str) -> tuple[int, str]:
    """Rework: derive stat modifier + short label using weapon.hit_stat / damage_stat
    with legacy finesse fallback. kind is 'hit' or 'damage'."""
    from app.game_mechanics import _resolve_stat_from_weapon
    stats = {
        "strength": attacker.strength, "dexterity": attacker.dexterity,
        "constitution": attacker.constitution, "intelligence": attacker.intelligence,
        "wisdom": attacker.wisdom, "charisma": attacker.charisma,
    }
    val, name = _resolve_stat_from_weapon(stats, weapon, kind)
    return val, _stat_short(name)


async def _serialize_combat(ce: CombatEvent, db: AsyncSession) -> dict:
    result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == ce.id
        ).order_by(CombatParticipant.turn_order)
    )
    parts = result.scalars().all()
    serialized = []
    for p in parts:
        char = await db.get(Character, p.character_id)
        serialized.append(_serialize_participant(p, char))
    return {
        "id": ce.id,
        "session_id": ce.session_id,
        "name": ce.name,
        "status": ce.status,
        "round_number": ce.round_number,
        "current_participant_id": ce.current_participant_id,
        "started_at": ce.started_at.isoformat() if ce.started_at else None,
        "ended_at": ce.ended_at.isoformat() if ce.ended_at else None,
        "participants": serialized,
    }


def _serialize_participant(p: CombatParticipant, ch: Character | None = None) -> dict:
    if ch is None:
        ch = p.character
    return {
        "id": p.id,
        "combat_event_id": p.combat_event_id,
        "character_id": p.character_id,
        "name": ch.name if ch else "?",
        "is_npc": ch.is_npc if ch else False,
        "current_hp": ch.current_hp if ch else 0,
        "max_hp": ch.max_hp if ch else 0,
        "armor_class": ch.armor_class if ch else 10,
        "is_alive": ch.is_alive if ch else False,
        "initiative_roll": p.initiative_roll,
        "initiative_bonus": p.initiative_bonus,
        "final_initiative": p.final_initiative,
        "turn_order": p.turn_order,
        "is_active": p.is_active,
        "show_hp_to_players": p.show_hp_to_players,
        "show_ac_to_players": p.show_ac_to_players,
    }


def _calc_initiative_bonus(char: Character) -> int:
    """Base initiative_bonus + equipped item initiative bonuses."""
    bonus = char.initiative_bonus or 0
    # Add bonuses from equipped items (inventory_items loaded via selectin)
    try:
        for inv in char.inventory_items:
            if inv.is_equipped and inv.item and inv.item.bonuses:
                for b in inv.item.bonuses:
                    if b.stat == "initiative_bonus":
                        bonus += b.value
    except Exception:
        pass  # If inventory not loaded, just use base bonus
    return bonus


async def _get_combat(combat_id: int, db: AsyncSession) -> CombatEvent:
    ce = await db.get(CombatEvent, combat_id)
    if not ce:
        raise HTTPException(404, "Combat event not found")
    return ce


# ══════════════════════════════════════════════════════════════
# COMBAT CRUD
async def _process_participant_turn_end(character_id: int, db: AsyncSession) -> list[dict]:
    char = await db.get(Character, character_id)
    if not char:
        return []

    result = await db.execute(
        select(CharacterStatusEffect).where(CharacterStatusEffect.character_id == character_id)
    )
    effects = result.scalars().all()
    if not effects:
        return []

    events = []
    hp_changes = []
    mana_changes = []

    for eff in effects:
        eff_data = json.loads(eff.effects) if eff.effects else []
        for e in eff_data:
            if e.get("type") == "hp_change_per_turn":
                hp_changes.append({"name": eff.name, "value": e["value"]})
            elif e.get("type") == "mana_change_per_turn":
                mana_changes.append({"name": eff.name, "value": e["value"]})

        if eff.remaining_turns is not None:
            eff.remaining_turns -= 1
            if eff.remaining_turns <= 0:
                events.append({
                    "type": "status_effect.expired",
                    "character_id": character_id,
                    "character_name": char.name,
                    "effect_name": eff.name,
                    "effect_id": eff.id,
                })
                await db.delete(eff)

    total_hp_change = sum(h["value"] for h in hp_changes)
    if total_hp_change != 0 and char.is_alive:
        char.current_hp = max(0, char.current_hp + total_hp_change)
        if char.current_hp <= 0:
            char.is_alive = False
        events.append({
            "type": "hp_change",
            "character_id": character_id,
            "character_name": char.name,
            "hp_change": total_hp_change,
            "new_hp": char.current_hp,
            "sources": hp_changes,
        })

    # Mana regen + status mana changes
    total_mana_change = sum(m["value"] for m in mana_changes)
    regen = char.mana_regen_per_turn or 0
    if (regen != 0 or total_mana_change != 0) and char.mana_max > 0:
        from app.game_mechanics import apply_mana_regen, get_effective_mana_max
        eff_max = get_effective_mana_max(char.mana_max)
        old_mana = char.mana_current
        char.mana_current = apply_mana_regen(char.mana_current, eff_max, regen, total_mana_change)
        if char.mana_current != old_mana:
            sources = []
            if regen: sources.append({"name": "Regen", "value": regen})
            sources.extend(mana_changes)
            events.append({
                "type": "mana.updated",
                "character_id": character_id,
                "character_name": char.name,
                "mana_change": char.mana_current - old_mana,
                "mana_current": char.mana_current,
                "mana_max": eff_max,
                "sources": sources,
            })

    # Expired potion stat boosts cleanup
    now = datetime.now(UTC)
    expired_mods = await db.execute(
        select(StatModifier).where(
            StatModifier.character_id == character_id,
            StatModifier.source == "potion",
            StatModifier.expires_at != None,
            StatModifier.expires_at <= now,
        )
    )
    for mod in expired_mods.scalars().all():
        events.append({
            "type": "modifier.expired",
            "character_id": character_id,
            "character_name": char.name,
            "modifier_name": mod.name,
            "stat_name": mod.stat_name,
            "value": mod.value,
        })
        await db.delete(mod)

    # Ability cooldown decrement
    cd_result = await db.execute(
        select(CharacterAbility).where(
            CharacterAbility.character_id == character_id,
            CharacterAbility.cooldown_remaining > 0,
        )
    )
    for ca in cd_result.scalars().all():
        ca.cooldown_remaining = max(0, ca.cooldown_remaining - 1)
        if ca.cooldown_remaining == 0:
            events.append({
                "type": "ability.cooldown_ready",
                "character_id": character_id,
                "character_name": char.name,
                "ability_name": ca.ability.name if ca.ability else "Unknown",
            })

    return events


async def _has_skip_turn(character_id: int, db: AsyncSession) -> bool:
    result = await db.execute(
        select(CharacterStatusEffect).where(CharacterStatusEffect.character_id == character_id)
    )
    for eff in result.scalars().all():
        eff_data = json.loads(eff.effects) if eff.effects else []
        for e in eff_data:
            if e.get("type") == "skip_turn" and e.get("value"):
                return True
    return False

async def _get_equipped_weapon(character_id: int, db: AsyncSession) -> dict | None:
    """Get the weapon equipped in main_hand slot, returning dict for game_mechanics."""
    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == character_id,
            InventoryItem.is_equipped == True,
            InventoryItem.equipped_slot == "main_hand",
        )
    )
    inv = result.scalars().first()
    if not inv or not inv.item or not inv.item.weapon_stats:
        return None
    ws = inv.item.weapon_stats
    props = ws.weapon_properties
    if isinstance(props, str):
        try:
            props = json.loads(props)
        except Exception:
            props = []
    # Rework v3: preset damage modes. Empty list = single-mode weapon.
    try:
        dmg_modes = json.loads(getattr(ws, "damage_modes", None) or "[]")
        if not isinstance(dmg_modes, list):
            dmg_modes = []
    except Exception:
        dmg_modes = []
    return {
        "name": inv.item.name,
        "dice_count": ws.dice_count,
        "dice_type": ws.dice_type,
        "damage_type": ws.damage_type,
        "damage_bonus": 0,
        "attack_bonus": 0,
        "weapon_range": ws.weapon_range or "melee",
        # Rework v3 Phase 7: cell-range for grid enforcement.
        "range_cells": ws.range_cells if ws.range_cells is not None else 1,
        "weapon_properties": props,
        # Rework Phase 2: stat binding lives on the weapon itself
        "hit_stat": getattr(ws, "hit_stat", None) or "strength",
        "damage_stat": getattr(ws, "damage_stat", "strength"),
        # Rework v3: preset alternate damage modes (1h/2h, element, etc.).
        "damage_modes": dmg_modes,
    }


async def _get_char_bonuses_and_penalties(char: Character, db: AsyncSession):
    """Load equipped item bonuses and status penalties for a character."""
    from app.game_mechanics import aggregate_status_penalties, get_all_active_bonuses

    # Item bonuses
    equipped_result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == char.id,
            InventoryItem.is_equipped == True,
        )
    )
    equipped = equipped_result.scalars().all()
    item_bonuses = get_all_active_bonuses(equipped)

    # Status penalties
    eff_result = await db.execute(
        select(CharacterStatusEffect).where(
            CharacterStatusEffect.character_id == char.id,
        )
    )
    effects = eff_result.scalars().all()
    effects_json = []
    for eff in effects:
        try:
            effects_json.append(json.loads(eff.effects) if eff.effects else [])
        except Exception:
            effects_json.append([])
    status_penalties = aggregate_status_penalties(effects_json)

    return item_bonuses, status_penalties


def _char_stats_dict(c: Character) -> dict:
    return {
        "strength": c.strength,
        "dexterity": c.dexterity,
        "constitution": c.constitution,
        "intelligence": c.intelligence,
        "wisdom": c.wisdom,
        "charisma": c.charisma,
    }
async def _apply_weapon_poison_on_hit(attacker: Character, target: Character, db: AsyncSession):
    """Rework Phase 5: on a successful hit, check if attacker's equipped weapon has a
    poison coat, roll DoT damage, attach a DoT status effect to target, and consume a charge.
    Returns a small dict describing what happened, or None if no coat.
    """
    from app.models import InventoryItemPoison
    # Find the equipped main_hand weapon inventory entry
    eq = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == attacker.id,
            InventoryItem.is_equipped == True,
            InventoryItem.equipped_slot == "main_hand",
        )
    )
    inv = eq.scalars().first()
    if not inv:
        return None
    coat_q = await db.execute(
        select(InventoryItemPoison).where(InventoryItemPoison.inventory_item_id == inv.id)
    )
    coat = coat_q.scalars().first()
    if not coat or coat.charges_remaining <= 0:
        return None
    tpl = coat.poison_template
    if not tpl:
        return None
    # Roll DoT damage once, lock it in per tick for simplicity
    dice_rolls = [random.randint(1, max(2, tpl.damage_dice_type)) for _ in range(max(1, tpl.damage_dice_count))]
    dot_damage = sum(dice_rolls)
    # Attach status effect
    effect_json = json.dumps([{
        "type": "hp_change_per_turn",
        "value": -int(dot_damage),
        "source": "poison",
        "damage_type": tpl.damage_type,
        "dice_expr": f"{tpl.damage_dice_count}d{tpl.damage_dice_type}",
    }])
    se = CharacterStatusEffect(
        character_id=target.id,
        template_id=None,
        name=f"{tpl.icon} {tpl.name}",
        icon=tpl.icon,
        color=tpl.color,
        effects=effect_json,
        remaining_turns=coat.turns_per_hit,
        applied_by_id=attacker.id,
    )
    db.add(se)
    # Consume charge
    coat.charges_remaining -= 1
    if coat.charges_remaining <= 0:
        await db.delete(coat)
    # Notify listeners
    try:
        await manager.broadcast(target.session_id, {
            "event": "status.update",
            "character_id": target.id,
        })
        await manager.broadcast(attacker.session_id, {
            "event": "inventory.update",
            "character_id": attacker.id,
        })
    except Exception:
        pass
    return {
        "template_id": tpl.id,
        "name": tpl.name,
        "icon": tpl.icon,
        "dice_expr": f"{tpl.damage_dice_count}d{tpl.damage_dice_type}",
        "per_tick_damage": dot_damage,
        "turns": coat.turns_per_hit,
        "charges_remaining": max(0, coat.charges_remaining),
    }
