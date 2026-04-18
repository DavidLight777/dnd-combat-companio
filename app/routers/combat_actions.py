"""Stage 11 — Combat Targeting & Attack Actions API."""
import json
from datetime import datetime, timezone
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import (
    CombatEvent, CombatParticipant, CombatAction, Character,
    InventoryItem, CharacterStatusEffect, StatusEffectTemplate, Item,
)
from app.game_mechanics import (
    calculate_combat_attack, calculate_combat_damage, stat_modifier,
    get_all_active_bonuses, aggregate_status_penalties, resolve_advantage_mode,
)

router = APIRouter(prefix="/api/combat", tags=["combat-actions"])


async def _get_active_combat(combat_id: int, db: AsyncSession) -> CombatEvent:
    result = await db.execute(
        select(CombatEvent).where(CombatEvent.id == combat_id)
        .options(selectinload(CombatEvent.participants).selectinload(CombatParticipant.character))
    )
    combat = result.scalar_one_or_none()
    if not combat:
        raise HTTPException(404, "Combat not found")
    return combat


async def _get_character(char_id: int, db: AsyncSession) -> Character:
    ch = await db.get(Character, char_id)
    if not ch:
        raise HTTPException(404, f"Character {char_id} not found")
    return ch


async def _get_equipped_items(char_id: int, db: AsyncSession) -> list:
    result = await db.execute(
        select(InventoryItem)
        .where(InventoryItem.character_id == char_id, InventoryItem.is_equipped == True)
        .options(selectinload(InventoryItem.item))
    )
    return list(result.scalars().all())


async def _get_status_penalties(char_id: int, db: AsyncSession) -> dict:
    result = await db.execute(
        select(CharacterStatusEffect)
        .where(
            CharacterStatusEffect.character_id == char_id,
            (CharacterStatusEffect.remaining_turns == None) | (CharacterStatusEffect.remaining_turns > 0),
        )
    )
    effects = result.scalars().all()
    effects_json = []
    for e in effects:
        try:
            effects_json.append(json.loads(e.effects) if e.effects else [])
        except Exception:
            pass
    return aggregate_status_penalties(effects_json)


async def _get_equipped_weapon(char_id: int, db: AsyncSession) -> dict | None:
    """Get the main-hand weapon stats if any."""
    result = await db.execute(
        select(InventoryItem)
        .where(
            InventoryItem.character_id == char_id,
            InventoryItem.is_equipped == True,
            InventoryItem.equipped_slot == "main_hand",
        )
        .options(selectinload(InventoryItem.item))
    )
    inv = result.scalar_one_or_none()
    if not inv or not inv.item:
        return None
    item = inv.item
    ws = item.weapon_stats
    if not ws:
        return None
    # Get attack_bonus and damage_bonus from item bonuses
    atk_bonus = 0
    dmg_bonus = 0
    for b in (item.bonuses or []):
        if b.bonus_type == "attack_bonus" and not b.is_conditional:
            atk_bonus += int(b.value)
        elif b.bonus_type == "damage_bonus" and not b.is_conditional:
            dmg_bonus += int(b.value)
    props = []
    try:
        props = json.loads(ws.weapon_properties) if ws.weapon_properties else []
    except Exception:
        pass
    return {
        "item_id": item.id,
        "name": item.name,
        "dice_count": ws.dice_count,
        "dice_type": ws.dice_type,
        "damage_type": ws.damage_type,
        "weapon_range": ws.weapon_range or "melee",
        "weapon_properties": props,
        "attack_bonus": atk_bonus,
        "damage_bonus": dmg_bonus,
    }


# ── GET valid targets for a character in combat ──
@router.get("/{combat_id}/targets/{character_id}")
async def get_targets(combat_id: int, character_id: int, db: AsyncSession = Depends(get_session)):
    combat = await _get_active_combat(combat_id, db)
    attacker = await _get_character(character_id, db)

    targets = []
    for p in combat.participants:
        if not p.is_active:
            continue
        ch = p.character
        if ch.id == character_id:
            continue
        if not ch.is_alive:
            continue
        # Players target NPCs, NPCs target players
        if attacker.is_npc and not ch.is_npc:
            targets.append(_serialize_target(ch, p))
        elif not attacker.is_npc and ch.is_npc:
            targets.append(_serialize_target(ch, p))
        # GM can target anyone (handled on frontend)
    # If attacker is GM-controlled NPC, include all non-NPC alive targets
    if not targets:
        for p in combat.participants:
            if not p.is_active or p.character.id == character_id or not p.character.is_alive:
                continue
            targets.append(_serialize_target(p.character, p))
    return targets


def _serialize_target(ch: Character, participant: CombatParticipant) -> dict:
    return {
        "character_id": ch.id,
        "name": ch.name,
        "is_npc": ch.is_npc,
        "current_hp": ch.current_hp,
        "max_hp": ch.max_hp,
        "armor_class": ch.armor_class,
        "token_color": ch.token_color,
        "show_hp_to_players": participant.show_hp_to_players,
        "show_ac_to_players": participant.show_ac_to_players,
    }


# ── POST attack ──
@router.post("/{combat_id}/attack")
async def perform_attack(combat_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    combat = await _get_active_combat(combat_id, db)
    attacker_id = body.get("attacker_id")
    target_id = body.get("target_id")
    weapon_item_id = body.get("weapon_id")  # optional override
    advantage_mode = body.get("advantage_mode", "normal")  # normal/advantage/disadvantage
    hit_dice_count = body.get("hit_dice_count")  # Rework v3: number of d20s on hit

    if not attacker_id or not target_id:
        raise HTTPException(400, "attacker_id and target_id required")

    attacker = await _get_character(attacker_id, db)
    target = await _get_character(target_id, db)

    if not attacker.is_alive:
        raise HTTPException(400, "Attacker is dead")
    if not target.is_alive:
        raise HTTPException(400, "Target is dead")

    # Get weapon
    weapon = await _get_equipped_weapon(attacker_id, db)

    # Get item bonuses and status penalties
    equipped = await _get_equipped_items(attacker_id, db)
    item_bonuses = get_all_active_bonuses(equipped)
    penalties = await _get_status_penalties(attacker_id, db)

    attacker_stats = {
        "strength": attacker.strength, "dexterity": attacker.dexterity,
        "constitution": attacker.constitution, "intelligence": attacker.intelligence,
        "wisdom": attacker.wisdom, "charisma": attacker.charisma,
    }

    # Resolve effective advantage mode (player choice + forced status)
    advantage_mode = resolve_advantage_mode(advantage_mode, penalties)

    # Attack roll
    atk = calculate_combat_attack(
        attacker_stats=attacker_stats,
        target_ac=target.armor_class,
        weapon=weapon,
        item_atk_bonus=int(item_bonuses.get("attack_bonus", 0)),
        status_atk_penalty=penalties.get("attack_penalty", 0),
        advantage_mode=advantage_mode,
        dice_count=hit_dice_count,
    )

    attack_roll_data = asdict(atk)
    damage_roll_data = None
    description_parts = []

    if atk.critical:
        description_parts.append(f"🎯 CRITICAL HIT! {attacker.name} rolled a natural 20!")
    elif atk.fumble:
        description_parts.append(f"💨 FUMBLE! {attacker.name} rolled a natural 1!")
    elif atk.hit:
        description_parts.append(f"⚔️ HIT! {attacker.name} rolled {atk.total} vs AC {target.armor_class}")
    else:
        description_parts.append(f"🛡️ MISS! {attacker.name} rolled {atk.total} vs AC {target.armor_class}")

    if atk.hit:
        # Get target damage reduction
        target_equipped = await _get_equipped_items(target_id, db)
        target_item_bonuses = get_all_active_bonuses(target_equipped)
        target_penalties = await _get_status_penalties(target_id, db)
        target_reduction = int(target_item_bonuses.get("flat_damage_reduction", 0))

        dmg = calculate_combat_damage(
            attacker_stats=attacker_stats,
            target_hp=target.current_hp,
            target_max_hp=target.max_hp,
            weapon=weapon,
            critical=atk.critical,
            item_dmg_bonus=int(item_bonuses.get("damage_bonus", 0)),
            status_dmg_penalty=penalties.get("damage_penalty", 0),
            target_damage_reduction=target_reduction,
            advantage_mode=advantage_mode,
        )

        damage_roll_data = asdict(dmg)

        # Apply damage to target
        target.current_hp = dmg.target_new_hp
        if dmg.target_killed:
            target.is_alive = False

        weapon_name = weapon["name"] if weapon else "unarmed strike"
        description_parts.append(
            f"{attacker.name} deals {dmg.final_damage} damage to {target.name} with {weapon_name} "
            f"({target.current_hp}/{target.max_hp} HP)"
        )
        if dmg.target_killed:
            description_parts.append(f"💀 {target.name} has been slain!")

    # Save combat action
    action = CombatAction(
        combat_event_id=combat_id,
        round_number=combat.round_number,
        attacker_id=attacker_id,
        target_id=target_id,
        action_type="attack",
        weapon_id=weapon["item_id"] if weapon else None,
        attack_roll=json.dumps(attack_roll_data),
        damage_roll=json.dumps(damage_roll_data) if damage_roll_data else None,
        description=" | ".join(description_parts),
    )
    db.add(action)
    await db.commit()
    await db.refresh(target)

    return {
        "action_id": action.id,
        "attacker_id": attacker_id,
        "attacker_name": attacker.name,
        "target_id": target_id,
        "target_name": target.name,
        "attack_roll": attack_roll_data,
        "damage_roll": damage_roll_data,
        "description": " | ".join(description_parts),
        "target_current_hp": target.current_hp,
        "target_max_hp": target.max_hp,
        "target_killed": damage_roll_data["target_killed"] if damage_roll_data else False,
        "weapon_name": weapon["name"] if weapon else "Unarmed",
    }


# ── POST defend ──
@router.post("/{combat_id}/defend")
async def perform_defend(combat_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    combat = await _get_active_combat(combat_id, db)
    character_id = body.get("character_id")
    if not character_id:
        raise HTTPException(400, "character_id required")

    ch = await _get_character(character_id, db)

    # Apply Defending status: +2 AC for 1 turn
    # Find or create a "Defending" template
    result = await db.execute(
        select(StatusEffectTemplate).where(StatusEffectTemplate.name == "Defending")
    )
    template = result.scalar_one_or_none()
    if not template:
        template = StatusEffectTemplate(
            name="Defending",
            description="Bracing for defense, +2 AC until next turn",
            icon="🛡️",
            color="#4a90d9",
            effects=json.dumps([{"type": "ac_bonus", "value": 2}]),
        )
        db.add(template)
        await db.flush()

    # Temporarily boost AC
    ch.armor_class += 2

    # Save action
    action = CombatAction(
        combat_event_id=combat_id,
        round_number=combat.round_number,
        attacker_id=character_id,
        target_id=None,
        action_type="defend",
        attack_roll=json.dumps({"defend": True, "ac_bonus": 2}),
        description=f"🛡️ {ch.name} takes a defensive stance (+2 AC)",
    )
    db.add(action)

    # Add status effect
    cse = CharacterStatusEffect(
        character_id=character_id,
        template_id=template.id,
        name="Defending",
        icon="\U0001f6e1\ufe0f",
        color="#4a90d9",
        effects=json.dumps([{"type": "ac_bonus", "value": 2}]),
        remaining_turns=1,
    )
    db.add(cse)
    await db.commit()

    return {
        "action_id": action.id,
        "character_id": character_id,
        "character_name": ch.name,
        "action_type": "defend",
        "description": action.description,
        "new_ac": ch.armor_class,
    }


# ── GET combat action log ──
@router.get("/{combat_id}/actions")
async def list_actions(combat_id: int, db: AsyncSession = Depends(get_session)):
    await _get_active_combat(combat_id, db)
    result = await db.execute(
        select(CombatAction)
        .where(CombatAction.combat_event_id == combat_id)
        .order_by(CombatAction.created_at.desc())
        .limit(100)
    )
    actions = result.scalars().all()
    return [
        {
            "id": a.id,
            "round_number": a.round_number,
            "attacker_id": a.attacker_id,
            "attacker_name": a.attacker.name if a.attacker else "?",
            "target_id": a.target_id,
            "target_name": a.target.name if a.target else None,
            "action_type": a.action_type,
            "attack_roll": json.loads(a.attack_roll) if a.attack_roll else None,
            "damage_roll": json.loads(a.damage_roll) if a.damage_roll else None,
            "description": a.description,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in actions
    ]
