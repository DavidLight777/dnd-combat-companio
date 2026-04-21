"""Rework v2 — Character Creation Wizard (6 steps).

Step 1 — Identity (name / age / gender)           → handled in /sessions/join
Step 2 — Race selection                            → handled in /sessions/join
Step 3 — Starting-item roll + proposal             → THIS router (+ GM approval)
Step 4 — Stat choice (accept / decline for advantage)
Step 5 — Feature roll (d20 → rarity → d4 → ability pool)
Step 6 — Finalize (HP roll, slot cap, completion)

The wizard's JSON `data` column stores everything between steps. Contract:

{
  "starting_roll":   {"d20": 14, "rarity": "uncommon"},
  "proposed_item":   {"name":..., "description":..., "category":"weapon|consumable|misc",
                      "weapon":     {"dice_count":1,"dice_type":6,"hit_stat":"strength","damage_stat":"strength","damage_type":"physical"},
                      "consumable": {"effect_kind":"heal|buff|dot","charges":1,"effect_detail":"..."}},
  "gm_rejected":     false,
  "gm_reject_note":  "...",
  "gm_approved":     true,
  "item_id":         42,
  "inventory_id":    101,
  "final_rarity":    "uncommon",
  "stat_choice":     {"declined": false},
  "feature_roll":    {"d20_rolls":[14,3],"kept_d20":14,"rarity":"uncommon",
                      "bucket_size":4,"d_size":4,"d_rolled":2,"ability_id":77},
  "finalize":        {"hp_rolls":[6],"race_hp_die":8,"race_hp_count":1,
                      "max_hp":7,"slots":14,"declined":false}
}

Rarity table (shared by starting-item + feature rolls):
  1         → common (flagged broken on items)
  2-9       → common
  10-14     → uncommon
  15-18     → rare
  19-20     → epic
"""
from __future__ import annotations

import json
import random
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character, CharacterWizardState, Item, InventoryItem, ItemWeaponStats,
    Race, Ability, CharacterAbility,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api/wizard", tags=["wizard"])


# ══════════════════════════════════════════════════════════════
# Constants & helpers
# ══════════════════════════════════════════════════════════════
RARITIES_ORDER = ["common", "uncommon", "rare", "epic", "legendary"]


def _d20_to_rarity(d20: int) -> str:
    if d20 <= 1:
        return "common"
    if d20 <= 9:
        return "common"
    if d20 <= 14:
        return "uncommon"
    if d20 <= 18:
        return "rare"
    return "epic"          # 19-20


def _d20_desc(d20: int) -> str:
    if d20 <= 1:
        return "Broken — a cursed start."
    if d20 <= 9:
        return "Common quality."
    if d20 <= 14:
        return "Uncommon — a touch better than ordinary."
    if d20 <= 18:
        return "Rare — a prized find."
    return "Epic — legendary stroke of luck!"


def _data(ws: CharacterWizardState) -> dict:
    try:
        return json.loads(ws.data or "{}") or {}
    except Exception:
        return {}


def _save_data(ws: CharacterWizardState, data: dict):
    ws.data = json.dumps(data)


def _ser(ws: CharacterWizardState) -> dict:
    return {
        "id": ws.id,
        "character_id": ws.character_id,
        "session_id": ws.session_id,
        "current_step": ws.current_step,
        "is_completed": ws.is_completed,
        "gm_approved": ws.gm_approved,
        "data": _data(ws),
        "created_at": ws.created_at.isoformat() if ws.created_at else None,
        "updated_at": ws.updated_at.isoformat() if ws.updated_at else None,
    }


async def _broadcast(session_id: int, event: str, payload: dict | None = None):
    try:
        msg = {"event": event}
        if payload:
            msg.update(payload)
        await manager.broadcast(session_id, msg)
    except Exception:
        pass


async def _load_state(char_id: int, db: AsyncSession, auto_create: bool = False):
    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    q = await db.execute(
        select(CharacterWizardState).where(CharacterWizardState.character_id == char_id)
    )
    ws = q.scalars().first()
    if ws is None and auto_create:
        ws = CharacterWizardState(
            character_id=char_id,
            session_id=char.session_id,
            current_step=3,
            is_completed=False,
            data="{}",
            gm_approved=False,
        )
        db.add(ws)
        await db.commit()
        await db.refresh(ws)
    return char, ws


async def _ensure_state(char_id: int, db: AsyncSession):
    return await _load_state(char_id, db, auto_create=True)


# ══════════════════════════════════════════════════════════════
# Schemas
# ══════════════════════════════════════════════════════════════
class WeaponProposal(BaseModel):
    dice_count: int = 1
    dice_type: int = 6          # d4/d6/d8/d10/d12
    hit_stat: str = "strength"
    damage_stat: str = "strength"
    damage_type: str = "physical"


class ConsumableProposal(BaseModel):
    effect_kind: str = "heal"   # heal / buff / dot
    charges: int = 1
    effect_detail: str = ""


class ProposeItemBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    category: str = "misc"      # "weapon" / "consumable" / "misc"
    weapon: WeaponProposal | None = None
    consumable: ConsumableProposal | None = None


class ApproveItemBody(BaseModel):
    # GM may edit any field before approving (Q2 in REWORK_PLAN.md).
    name: str | None = None
    description: str | None = None
    category: str | None = None
    rarity_override: str | None = None
    weapon: WeaponProposal | None = None
    consumable: ConsumableProposal | None = None
    note: str = ""


class RejectBody(BaseModel):
    note: str = ""


class StatChoiceBody(BaseModel):
    declined: bool


# ══════════════════════════════════════════════════════════════
# GET / housekeeping
# ══════════════════════════════════════════════════════════════
@router.get("/{char_id}")
async def get_wizard(char_id: int, db: AsyncSession = Depends(get_session)):
    """Return wizard state; auto-creates if the character exists but has none yet."""
    _, ws = await _ensure_state(char_id, db)
    return _ser(ws)


@router.delete("/{char_id}")
async def discard_wizard(char_id: int, db: AsyncSession = Depends(get_session)):
    q = await db.execute(
        select(CharacterWizardState).where(CharacterWizardState.character_id == char_id)
    )
    ws = q.scalars().first()
    if ws:
        await db.delete(ws)
        await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# STEP 3 — Starting item
# ══════════════════════════════════════════════════════════════
@router.post("/{char_id}/roll-item")
async def roll_starting_item(char_id: int, db: AsyncSession = Depends(get_session)):
    """Server-side d20 roll that locks in the item rarity. Idempotent."""
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "starting_roll" in data:
        return {
            "already_rolled": True,
            "d20": data["starting_roll"]["d20"],
            "rarity": data["starting_roll"]["rarity"],
            "description": _d20_desc(data["starting_roll"]["d20"]),
            "state": _ser(ws),
        }

    d20 = random.randint(1, 20)
    rarity = _d20_to_rarity(d20)
    data["starting_roll"] = {"d20": d20, "rarity": rarity}
    _save_data(ws, data)
    if ws.current_step < 3:
        ws.current_step = 3
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return {
        "d20": d20,
        "rarity": rarity,
        "description": _d20_desc(d20),
        "state": _ser(ws),
    }


@router.post("/{char_id}/propose-item")
async def propose_item(char_id: int, body: ProposeItemBody, db: AsyncSession = Depends(get_session)):
    """Player submits the item they want to create. Needs a prior roll-item."""
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "starting_roll" not in data:
        raise HTTPException(400, "Roll the starting-item dice first")

    # Validate category vs. supplied detail blocks
    cat = (body.category or "misc").lower()
    proposal: dict = {
        "name": body.name,
        "description": body.description,
        "category": cat,
    }
    if cat == "weapon":
        if body.weapon is None:
            raise HTTPException(400, "Weapon proposal requires `weapon` block")
        proposal["weapon"] = body.weapon.model_dump()
    elif cat == "consumable":
        if body.consumable is None:
            raise HTTPException(400, "Consumable proposal requires `consumable` block")
        proposal["consumable"] = body.consumable.model_dump()

    data["proposed_item"] = proposal
    data.pop("gm_rejected", None)
    data.pop("gm_reject_note", None)
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.update",
                     {"character_id": char_id, "needs_gm_approve": True})
    return _ser(ws)


@router.post("/{char_id}/approve-item")
async def approve_item(char_id: int, body: ApproveItemBody, db: AsyncSession = Depends(get_session)):
    """GM approves (and optionally edits) the proposed item.
    Creates the Item + InventoryItem. Does NOT complete the wizard \u2014 the
    player continues with stat-choice / feature-roll / finalize.
    """
    char, ws = await _ensure_state(char_id, db)
    data = _data(ws)
    if "proposed_item" not in data or "starting_roll" not in data:
        raise HTTPException(400, "Nothing to approve yet")
    if data.get("gm_approved"):
        raise HTTPException(400, "Item already approved")

    proposal = data["proposed_item"]
    # GM may overwrite any field at approval time.
    name = body.name if body.name is not None else proposal["name"]
    description = body.description if body.description is not None else proposal.get("description", "")
    category = (body.category or proposal.get("category") or "misc").lower()
    rarity = (body.rarity_override or data["starting_roll"]["rarity"]).lower()

    # Build the Item row
    is_weapon = category == "weapon"
    is_consumable = category == "consumable"
    item = Item(
        session_id=char.session_id,
        name=name,
        description=description,
        category=category,
        rarity=rarity,
        equippable=is_weapon,
        consumable=is_consumable,
    )
    db.add(item)
    await db.flush()

    # Weapon sub-record
    if is_weapon:
        ws_data = body.weapon.model_dump() if body.weapon else proposal.get("weapon", {})
        db.add(ItemWeaponStats(
            item_id=item.id,
            dice_count=int(ws_data.get("dice_count", 1) or 1),
            dice_type=int(ws_data.get("dice_type", 6) or 6),
            damage_type=str(ws_data.get("damage_type", "physical") or "physical"),
            range=None,
            weapon_range="melee",
            weapon_properties="[]",
            hit_stat=str(ws_data.get("hit_stat", "strength") or "strength"),
            damage_stat=str(ws_data.get("damage_stat", "strength") or "strength"),
        ))
    # Consumable use_effect: we stash it into Item.use_effect (JSON)
    elif is_consumable:
        cu_data = body.consumable.model_dump() if body.consumable else proposal.get("consumable", {})
        item.use_effect = json.dumps({
            "effects": [
                {
                    "kind": cu_data.get("effect_kind", "heal"),
                    "charges": int(cu_data.get("charges", 1) or 1),
                    "detail": cu_data.get("effect_detail", ""),
                }
            ]
        })

    inv = InventoryItem(
        character_id=char.id,
        item_id=item.id,
        quantity=1,
        is_equipped=False,
    )
    db.add(inv)
    await db.flush()

    data["item_id"] = item.id
    data["inventory_id"] = inv.id
    data["gm_approved"] = True
    data["gm_note"] = body.note
    data["final_rarity"] = rarity
    _save_data(ws, data)
    ws.gm_approved = True
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.item_approved",
                     {"character_id": char_id, "item_id": item.id})
    await _broadcast(char.session_id, "inventory.update", {"character_id": char_id})
    return {
        "approved": True,
        "item_id": item.id,
        "inventory_id": inv.id,
        "rarity": rarity,
        "state": _ser(ws),
    }


@router.post("/{char_id}/reject-item")
async def reject_item(char_id: int, body: RejectBody, db: AsyncSession = Depends(get_session)):
    """GM rejects the proposal; player must submit a new one."""
    char, ws = await _ensure_state(char_id, db)
    data = _data(ws)
    if "proposed_item" not in data:
        raise HTTPException(400, "No proposal to reject")
    data.pop("proposed_item", None)
    data["gm_rejected"] = True
    data["gm_reject_note"] = body.note
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.item_rejected",
                     {"character_id": char_id, "note": body.note})
    return _ser(ws)


# ══════════════════════════════════════════════════════════════
# STEP 4 — Stat choice
# ══════════════════════════════════════════════════════════════
@router.post("/{char_id}/stat-choice")
async def stat_choice(char_id: int, body: StatChoiceBody, db: AsyncSession = Depends(get_session)):
    """Accept (stats=1) or decline (stats=0, advantage on feature roll)."""
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")

    val = 0 if body.declined else 1
    char.strength = val
    char.dexterity = val
    char.constitution = val
    char.intelligence = val
    char.wisdom = val
    char.charisma = val
    char.declined_stats = bool(body.declined)

    data = _data(ws)
    data["stat_choice"] = {"declined": bool(body.declined)}
    _save_data(ws, data)
    if ws.current_step < 4:
        ws.current_step = 4
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return _ser(ws)


# ══════════════════════════════════════════════════════════════
# STEP 5 — Feature roll
# ══════════════════════════════════════════════════════════════
async def _available_pool(db: AsyncSession, session_id: int, rarity: str):
    """Return GM-authored starting-pool abilities of the given rarity,
    scoped to this session first then falling back to global (session_id is null).
    Deterministic order by id so the d4 always maps to the same 4 entries.
    """
    # Session-scoped first
    q = await db.execute(
        select(Ability)
        .where(Ability.is_in_starting_pool == True)          # noqa: E712
        .where(Ability.rarity == rarity)
        .where((Ability.session_id == session_id) | (Ability.session_id.is_(None)))
        .order_by(Ability.id)
    )
    return list(q.scalars().all())


@router.post("/{char_id}/roll-feature")
async def roll_feature(char_id: int, db: AsyncSession = Depends(get_session)):
    """d20 (or 2d20-max if declined) → rarity → d4 → pick from GM pool.
    Grants a CharacterAbility immediately \u2014 no GM approval for features.
    """
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "feature_roll" in data and data["feature_roll"].get("ability_id"):
        return {
            "already_rolled": True,
            "roll": data["feature_roll"],
            "state": _ser(ws),
        }

    advantage = bool(char.declined_stats)
    rolls = [random.randint(1, 20) for _ in range(2 if advantage else 1)]
    kept = max(rolls) if advantage else rolls[0]
    rarity = _d20_to_rarity(kept)

    # Find pool; downgrade if empty
    pool = await _available_pool(db, char.session_id, rarity)
    original_rarity = rarity
    downgrades = 0
    while not pool and rarity in RARITIES_ORDER:
        idx = RARITIES_ORDER.index(rarity)
        if idx == 0:
            break
        rarity = RARITIES_ORDER[idx - 1]
        pool = await _available_pool(db, char.session_id, rarity)
        downgrades += 1

    if not pool:
        raise HTTPException(
            400,
            "No abilities in the starting pool. Ask the GM to add some (Abilities editor → Starting Pool).",
        )

    # First 4 ordered by id (per spec — "d4 picks one of four").
    bucket = pool[:4]
    d_size = len(bucket)
    d_rolled = random.randint(1, d_size)
    chosen = bucket[d_rolled - 1]

    # Grant the ability
    cab = CharacterAbility(
        character_id=char.id,
        ability_id=chosen.id,
        is_unlocked=True,
        cooldown_remaining=0,
        current_uses=chosen.max_uses,
        granted_from="wizard",
    )
    db.add(cab)

    data["feature_roll"] = {
        "d20_rolls": rolls,
        "kept_d20": kept,
        "advantage": advantage,
        "rarity": rarity,
        "rarity_rolled": original_rarity,
        "rarity_downgrades": downgrades,
        "bucket_size": len(pool),
        "d_size": d_size,
        "d_rolled": d_rolled,
        "ability_id": chosen.id,
    }
    _save_data(ws, data)
    if ws.current_step < 5:
        ws.current_step = 5
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return {
        "roll": data["feature_roll"],
        "ability": {
            "id": chosen.id,
            "name": chosen.name,
            "description": chosen.description,
            "rarity": chosen.rarity,
            "icon": chosen.icon,
            "color": chosen.color,
            "max_uses": chosen.max_uses,
            "is_conditional": chosen.is_conditional,
            "conditional_text": chosen.conditional_text,
        },
        "state": _ser(ws),
    }


# ══════════════════════════════════════════════════════════════
# STEP 6 — Finalize
# ══════════════════════════════════════════════════════════════
@router.post("/{char_id}/finalize")
async def finalize(char_id: int, db: AsyncSession = Depends(get_session)):
    """Roll race HP die, compute slot cap, lock the character into level 0 play state."""
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")

    data = _data(ws)
    if "stat_choice" not in data:
        raise HTTPException(400, "Complete Step 4 (stat choice) first")
    if "feature_roll" not in data:
        raise HTTPException(400, "Complete Step 5 (feature roll) first")

    # Resolve race's HP die (default to d8 × 1 if no race).
    hp_die = 8
    hp_dice_count = 1
    if char.race_id:
        race = await db.get(Race, char.race_id)
        if race:
            hp_die = int(race.hp_die or 8)
            hp_dice_count = int(race.hp_dice_count or 1)

    rolls = [random.randint(1, hp_die) for _ in range(hp_dice_count)]
    hp_from_roll = sum(rolls)

    # char.max_hp already carries any race hp_bonus from /join. Add the roll.
    new_max_hp = max(1, char.max_hp + hp_from_roll)
    char.max_hp = new_max_hp
    char.current_hp = new_max_hp

    # Mana / AC stay at level-0 defaults (10 / 0) \u2014 no feature logic yet.
    # Slot cap \u2014 see formula in REWORK_PLAN.md §1 Step 6.
    # Slot cap — canonical formula:
    #     slots = 10 + 2 × constitution
    # CON 0 (declined) → 10, CON 1 (accepted) → 12, +2 per extra CON.
    # The decline branch is already encoded in the CON value itself
    # (Step 4 zeroes every stat on decline), so we MUST NOT add a
    # second "+2 on accept" baseline — that produced a 14-slot off-by-one
    # bug for fresh L0 accepted characters.
    declined = bool(char.declined_stats)
    char.max_inventory_slots = 10 + 2 * max(0, int(char.constitution))

    # Mark wizard completed. is_completed=True even if the GM hasn't approved
    # the item yet \u2014 player enters /player and sees a "waiting" banner there.
    ws.is_completed = True
    ws.current_step = 6
    data["finalize"] = {
        "hp_rolls": rolls,
        "race_hp_die": hp_die,
        "race_hp_count": hp_dice_count,
        "max_hp": new_max_hp,
        "slots": char.max_inventory_slots,
        "declined": declined,
    }
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.completed", {"character_id": char_id})
    return _ser(ws)


# ══════════════════════════════════════════════════════════════
# GM helpers
# ══════════════════════════════════════════════════════════════
@router.get("/session/{session_id}/pending")
async def list_pending_approvals(session_id: int, db: AsyncSession = Depends(get_session)):
    """Characters in this session that have a proposed item awaiting GM approval.
    Includes characters whose wizard is already completed (player entered the
    game but the item is still pending).
    """
    q = await db.execute(
        select(CharacterWizardState).where(CharacterWizardState.session_id == session_id)
    )
    items = []
    for ws in q.scalars().all():
        data = _data(ws)
        if "proposed_item" not in data:
            continue
        if data.get("gm_approved"):
            continue
        char = await db.get(Character, ws.character_id)
        items.append({
            "character_id": ws.character_id,
            "character_name": char.name if char else "?",
            "starting_roll": data.get("starting_roll"),
            "proposed_item": data["proposed_item"],
            "wizard_completed": bool(ws.is_completed),
            "state": _ser(ws),
        })
    return items
