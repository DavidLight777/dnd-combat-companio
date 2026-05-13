import json
import random

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    InventoryItem,
    Item,
    ItemWeaponStats,
)
from app.routers.wizard.common import (
    ApproveItemBody,
    ProposeItemBody,
    RejectBody,
    _broadcast,
    _d20_desc,
    _d20_to_rarity,
    _data,
    _ensure_state,
    _save_data,
    _ser,
    router,
)


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
    is_knave = data.get("rules_system") == "knave_like"
    if "starting_roll" not in data and not is_knave:
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
    is_knave = data.get("rules_system") == "knave_like"
    if "proposed_item" not in data or ("starting_roll" not in data and not is_knave):
        raise HTTPException(400, "Nothing to approve yet")
    if data.get("gm_approved"):
        raise HTTPException(400, "Item already approved")

    proposal = data["proposed_item"]
    # GM may overwrite any field at approval time.
    name = body.name if body.name is not None else proposal["name"]
    description = body.description if body.description is not None else proposal.get("description", "")
    category = (body.category or proposal.get("category") or "misc").lower()
    rarity = (body.rarity_override or data.get("starting_roll", {}).get("rarity") or "common").lower()

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
