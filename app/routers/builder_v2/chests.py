"""Chest entity CRUD — typed detail table, no JSON."""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Chest,
    BV2ChestItem,
    BV2Entity,
    BV2Location,
    Character,
    InventoryItem,
    Item,
)
import random
from app.routers.builder_v2.common import (
    broadcast,
    router,
    ser_entity,
    session_code_for_location,
)

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

async def _get_chest_entity(entity_id: int, db: AsyncSession):
    e = await db.get(BV2Entity, entity_id)
    if not e or e.entity_type != "chest":
        raise HTTPException(404, "Chest not found")
    return e


async def _chest_detail(entity_id: int, db: AsyncSession) -> dict:
    """Full chest dict including items joined."""
    e = await _get_chest_entity(entity_id, db)
    chest = await db.get(BV2Chest, entity_id)
    if not chest:
        raise HTTPException(404, "Chest detail missing")
    # Join items
    items_r = await db.execute(
        select(BV2ChestItem, Item)
        .join(Item, BV2ChestItem.item_id == Item.id)
        .where(BV2ChestItem.chest_entity_id == entity_id)
    )
    items = []
    for ci, it in items_r.all():
        items.append({
            "id": ci.id,
            "item_id": it.id,
            "name": it.name,
            "quantity": ci.quantity,
        })
    base = ser_entity(e)
    base.update({
        "is_locked": chest.is_locked,
        "lock_dc": chest.lock_dc,
        "icon": chest.icon,
        "is_opened": chest.is_opened,
        "items": items,
    })
    return base


# ─────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────

@router.post("/locations/{location_id}/chests")
async def create_chest(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    col = max(0, min(loc.cols - 1, int(body.get("col", 0))))
    row = max(0, min(loc.rows - 1, int(body.get("row", 0))))

    e = BV2Entity(
        location_id=location_id,
        entity_type="chest",
        col=col,
        row=row,
        name=str(body.get("name") or "")[:120],
        visible_to_players=bool(body.get("visible_to_players", True)),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)

    chest = BV2Chest(
        entity_id=e.id,
        is_locked=bool(body.get("is_locked", False)),
        lock_dc=int(body.get("lock_dc", 10)),
        icon=str(body.get("icon", "chest"))[:20],
        is_opened=bool(body.get("is_opened", False)),
    )
    db.add(chest)
    await db.commit()

    # Phase 17 R5: create chest items if provided in body
    items = body.get("items", [])
    if items:
        for it in items:
            if not it.get("item_id"):
                continue
            ci = BV2ChestItem(
                chest_entity_id=e.id,
                item_id=int(it["item_id"]),
                quantity=int(it.get("quantity", 1)),
            )
            db.add(ci)
        await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_added", {
            "location_id": location_id,
            "entity": await _chest_detail(e.id, db),
        })
    return await _chest_detail(e.id, db)


@router.get("/chests/{entity_id}")
async def get_chest(entity_id: int, db: AsyncSession = Depends(get_session)):
    return await _chest_detail(entity_id, db)


@router.patch("/chests/{entity_id}")
async def update_chest(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await _get_chest_entity(entity_id, db)
    chest = await db.get(BV2Chest, entity_id)
    if not chest:
        raise HTTPException(404, "Chest detail missing")

    if "name" in body:
        e.name = str(body["name"])[:120]
    if "visible_to_players" in body:
        e.visible_to_players = bool(body["visible_to_players"])
    if "is_locked" in body:
        chest.is_locked = bool(body["is_locked"])
    if "lock_dc" in body:
        chest.lock_dc = int(body["lock_dc"])
    await db.commit()
    await db.refresh(e)
    await db.refresh(chest)

    # Phase 17 R5: replace chest items if provided
    if "items" in body:
        # Delete existing items
        await db.execute(
            select(BV2ChestItem)
            .where(BV2ChestItem.chest_entity_id == entity_id)
        )
        old_items = await db.execute(
            select(BV2ChestItem).where(BV2ChestItem.chest_entity_id == entity_id)
        )
        for ci in old_items.scalars().all():
            await db.delete(ci)
        await db.commit()
        # Create new items
        for it in body["items"]:
            if not it.get("item_id"):
                continue
            ci = BV2ChestItem(
                chest_entity_id=entity_id,
                item_id=int(it["item_id"]),
                quantity=int(it.get("quantity", 1)),
            )
            db.add(ci)
        await db.commit()

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _chest_detail(entity_id, db),
        })
    return await _chest_detail(entity_id, db)


@router.post("/chests/{entity_id}/pick-lock")
async def pick_lock(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await _get_chest_entity(entity_id, db)
    chest = await db.get(BV2Chest, entity_id)
    if not chest:
        raise HTTPException(404, "Chest detail missing")
    if not chest.is_locked:
        return {"success": True, "is_locked": False}
    char_id = int(body.get("character_id", 0))
    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    roll = random.randint(1, 20) + (char.dexterity or 0)
    success = roll >= chest.lock_dc
    if success:
        chest.is_locked = False
        chest.is_opened = True
        await db.commit()
    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _chest_detail(entity_id, db),
        })
    return {"success": success, "is_locked": chest.is_locked, "roll": roll}


@router.delete("/chests/{entity_id}")
async def delete_chest(entity_id: int, db: AsyncSession = Depends(get_session)):
    e = await _get_chest_entity(entity_id, db)
    loc_id = e.location_id
    await db.delete(e)  # cascades to BV2Chest + BV2ChestItem
    await db.commit()

    sess_code = await session_code_for_location(loc_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_deleted", {
            "location_id": loc_id,
            "entity_id": entity_id,
        })
    return {"ok": True}


# ── Chest items sub-resource ────────────────────────────────

@router.post("/chests/{entity_id}/items")
async def add_chest_item(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await _get_chest_entity(entity_id, db)
    item_id = int(body.get("item_id", 0))
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    ci = BV2ChestItem(
        chest_entity_id=entity_id,
        item_id=item_id,
        quantity=int(body.get("quantity", 1)),
    )
    db.add(ci)
    await db.commit()
    await db.refresh(ci)

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _chest_detail(entity_id, db),
        })
    return {"ok": True, "id": ci.id}


@router.patch("/chests/{entity_id}/items/{item_row_id}")
async def update_chest_item(entity_id: int, item_row_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    ci = await db.get(BV2ChestItem, item_row_id)
    if not ci or ci.chest_entity_id != entity_id:
        raise HTTPException(404, "Chest item not found")
    if "quantity" in body:
        ci.quantity = int(body["quantity"])
    await db.commit()
    return {"ok": True}


@router.delete("/chests/{entity_id}/items/{item_row_id}")
async def remove_chest_item(entity_id: int, item_row_id: int, db: AsyncSession = Depends(get_session)):
    ci = await db.get(BV2ChestItem, item_row_id)
    if not ci or ci.chest_entity_id != entity_id:
        raise HTTPException(404, "Chest item not found")
    await db.delete(ci)
    await db.commit()
    return {"ok": True}


@router.post("/chests/{entity_id}/take")
async def take_chest_items(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """Player takes items from chest into their inventory."""
    e = await _get_chest_entity(entity_id, db)
    chest = await db.get(BV2Chest, entity_id)
    if not chest:
        raise HTTPException(404, "Chest detail missing")
    if chest.is_locked:
        raise HTTPException(400, "Chest is locked")

    char_id = int(body.get("character_id", 0))
    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")

    item_indices = body.get("item_indices")  # null = take all
    chest_items_r = await db.execute(
        select(BV2ChestItem, Item)
        .join(Item, BV2ChestItem.item_id == Item.id)
        .where(BV2ChestItem.chest_entity_id == entity_id)
    )
    chest_items = chest_items_r.all()

    taken = []
    indices_to_take = set(item_indices) if item_indices is not None else set(range(len(chest_items)))

    for idx, (ci, it) in enumerate(chest_items):
        if idx not in indices_to_take:
            continue
        # Add to character inventory
        inv_item = InventoryItem(
            character_id=char_id,
            item_id=it.id,
            quantity=ci.quantity,
        )
        db.add(inv_item)
        taken.append({"name": it.name, "quantity": ci.quantity})
        # Remove from chest
        await db.delete(ci)

    await db.commit()

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _chest_detail(entity_id, db),
        })

    return {"ok": True, "taken": taken}
