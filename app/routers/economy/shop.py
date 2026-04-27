
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.game_mechanics import bronze_to_display, calculate_item_price
from app.models import (
    Character,
    Item,
    NpcReputation,
    NpcShopInventory,
)
from app.routers.economy.common import ShopItemAddBody, ShopItemPatchBody, _rates, router


# ══════════════════════════════════════════════════════════════
@router.get("/npc/{npc_id}/shop")
async def get_npc_shop(npc_id: int, player_id: int = 0, db: AsyncSession = Depends(get_session)):
    """List NPC shop inventory with computed prices for the requesting player."""
    npc = await db.get(Character, npc_id)
    if not npc or not npc.is_npc:
        raise HTTPException(404, "NPC not found")

    # Get player reputation with this NPC
    reputation = 0
    if player_id:
        rep_result = await db.execute(
            select(NpcReputation).where(
                NpcReputation.npc_id == npc_id,
                NpcReputation.character_id == player_id,
            )
        )
        rep = rep_result.scalar_one_or_none()
        if rep:
            reputation = rep.reputation_value

    result = await db.execute(
        select(NpcShopInventory).where(
            NpcShopInventory.npc_id == npc_id,
            NpcShopInventory.is_available == True,
        )
    )
    shop_items = result.scalars().all()

    items = []
    for si in shop_items:
        item = si.item
        if not item:
            continue
        base_price = si.price_override_bronze if si.price_override_bronze is not None else item.base_price_bronze
        final_price = calculate_item_price(base_price, reputation, si.price_override_bronze)
        items.append({
            "shop_item_id": si.id,
            "item_id": item.id,
            "name": item.name,
            "description": item.description,
            "category": item.category,
            "rarity": item.rarity,
            "base_price_bronze": base_price,
            "final_price_bronze": final_price,
            "final_price": bronze_to_display(final_price, _rates),
            "stock": si.stock,
            "is_available": si.is_available,
            "equippable": item.equippable,
            "consumable": item.consumable,
        })
    return {
        "npc_id": npc_id,
        "npc_name": npc.name,
        "reputation": reputation,
        "price_multiplier": round(1.0 - (reputation / 200.0), 2),
        "items": items,
    }


@router.post("/npc/{npc_id}/shop")
async def add_to_npc_shop(npc_id: int, body: ShopItemAddBody,
                          db: AsyncSession = Depends(get_session)):
    npc = await db.get(Character, npc_id)
    if not npc or not npc.is_npc:
        raise HTTPException(404, "NPC not found")
    item = await db.get(Item, body.item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    si = NpcShopInventory(
        npc_id=npc_id,
        item_id=body.item_id,
        stock=body.stock,
        price_override_bronze=body.price_override_bronze,
    )
    db.add(si)
    await db.commit()
    await db.refresh(si)
    return {"ok": True, "shop_item_id": si.id, "item_name": item.name}


@router.patch("/npc/{npc_id}/shop/{shop_item_id}")
async def patch_shop_item(npc_id: int, shop_item_id: int, body: ShopItemPatchBody,
                          db: AsyncSession = Depends(get_session)):
    si = await db.get(NpcShopInventory, shop_item_id)
    if not si or si.npc_id != npc_id:
        raise HTTPException(404, "Shop item not found")
    if body.stock is not None:
        si.stock = body.stock
    if body.price_override_bronze is not None:
        si.price_override_bronze = body.price_override_bronze
    if body.is_available is not None:
        si.is_available = body.is_available
    await db.commit()
    await db.refresh(si)
    return {"ok": True, "shop_item_id": si.id}


@router.delete("/npc/{npc_id}/shop/{shop_item_id}")
async def remove_from_npc_shop(npc_id: int, shop_item_id: int,
                               db: AsyncSession = Depends(get_session)):
    si = await db.get(NpcShopInventory, shop_item_id)
    if not si or si.npc_id != npc_id:
        raise HTTPException(404, "Shop item not found")
    await db.delete(si)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
