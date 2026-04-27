from datetime import UTC, datetime

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Character, InventoryItem, Item, Session, ShopItem
from app.routers.inventory.character_inv import _inventory_item_dict
from app.routers.inventory.common import router
from app.routers.inventory.items import _item_dict


@router.get("/inventory/{character_id}")
async def get_inventory_legacy(character_id: int, db: AsyncSession = Depends(get_session)):
    """Legacy endpoint — same data as new format for backward compat."""
    result = await db.execute(
        select(InventoryItem).where(InventoryItem.character_id == character_id)
    )
    entries = result.scalars().all()
    items = []
    for e in entries:
        items.append(_inventory_item_dict(e))
    return {"items": items}


@router.post("/inventory/grant")
async def grant_item_legacy(body: dict, db: AsyncSession = Depends(get_session)):
    """Legacy grant endpoint."""
    char_id = body.get("character_id")
    item_id = body.get("item_id")
    quantity = body.get("quantity", 1)
    if not char_id or not item_id:
        raise HTTPException(400, "character_id and item_id required")

    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == char_id,
            InventoryItem.item_id == item_id,
            InventoryItem.is_equipped == False,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.quantity += quantity
    else:
        db.add(InventoryItem(
            character_id=char_id,
            item_id=item_id,
            quantity=quantity,
            acquired_at=datetime.now(UTC),
        ))
    await db.commit()
    return {"ok": True, "item_name": item.name, "quantity": quantity}


# ══════════════════════════════════════════════════════════════
# SHOP
# ══════════════════════════════════════════════════════════════
@router.get("/shop/{session_code}")
async def get_shop(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    shop_result = await db.execute(
        select(ShopItem).where(ShopItem.session_id == session.id)
    )
    entries = shop_result.scalars().all()
    items = []
    for e in entries:
        item = await db.get(Item, e.item_id)
        if item:
            d = _item_dict(item)
            d["shop_item_id"] = e.id
            d["price"] = e.price_override if e.price_override is not None else item.base_price
            d["stock"] = e.stock
            items.append(d)
    return {"items": items, "shop_open": session.shop_open if hasattr(session, 'shop_open') else False}


@router.post("/shop/{session_code}/add")
async def add_to_shop(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id required")
    entry = ShopItem(
        session_id=session.id, item_id=item_id,
        price_override=body.get("price_override"),
        stock=body.get("stock", -1),
    )
    db.add(entry)
    await db.commit()
    return {"ok": True}


@router.delete("/shop/item/{shop_item_id}")
async def remove_from_shop(shop_item_id: int, db: AsyncSession = Depends(get_session)):
    entry = await db.get(ShopItem, shop_item_id)
    if not entry:
        raise HTTPException(404)
    await db.delete(entry)
    await db.commit()
    return {"ok": True}


@router.post("/shop/{session_code}/buy")
async def buy_item(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    shop_item_id = body.get("shop_item_id")
    character_id = body.get("character_id")
    if not shop_item_id or not character_id:
        raise HTTPException(400, "shop_item_id and character_id required")

    shop_entry = await db.get(ShopItem, shop_item_id)
    if not shop_entry:
        raise HTTPException(404, "Shop item not found")

    item = await db.get(Item, shop_entry.item_id)
    char = await db.get(Character, character_id)
    if not item or not char:
        raise HTTPException(404)

    price = shop_entry.price_override if shop_entry.price_override is not None else item.base_price

    # Check gold
    gold = char.gold or 0
    if gold < price:
        raise HTTPException(400, f"Not enough gold ({gold}/{price})")

    # Check stock
    if shop_entry.stock == 0:
        raise HTTPException(400, "Out of stock")

    # Deduct gold
    char.gold = gold - price

    # Reduce stock
    if shop_entry.stock > 0:
        shop_entry.stock -= 1

    # Add to inventory
    inv_result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == character_id,
            InventoryItem.item_id == item.id,
        )
    )
    existing = inv_result.scalar_one_or_none()
    if existing:
        existing.quantity += 1
    else:
        db.add(InventoryItem(character_id=character_id, item_id=item.id, quantity=1))

    await db.commit()
    return {"ok": True, "item_name": item.name, "gold_remaining": char.gold}
