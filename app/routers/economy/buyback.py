
from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.game_mechanics import bronze_to_display, display_to_bronze, format_currency
from app.models import (
    Character,
    CurrencyTransaction,
    InventoryItem,
    Item,
)
from app.routers.economy.common import _rates, router


# GM BUYBACK (buy items FROM players)
# ══════════════════════════════════════════════════════════════
class GmBuybackBody(BaseModel):
    inventory_item_id: int
    platinum: int = 0
    gold: int = 0
    silver: int = 0
    bronze: int = 0


@router.post("/inventory/gm-buyback")
async def gm_buyback(body: GmBuybackBody, db: AsyncSession = Depends(get_session)):
    """GM purchases an item from a player at a custom price."""
    inv = await db.get(InventoryItem, body.inventory_item_id)
    if not inv:
        raise HTTPException(404, "Inventory item not found")

    char = await db.get(Character, inv.character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    item = await db.get(Item, inv.item_id)
    item_name = item.name if item else "Unknown"

    price_bronze = display_to_bronze(body.platinum, body.gold, body.silver, body.bronze, _rates)

    # Give money to player
    char.wealth_bronze = (char.wealth_bronze or 0) + price_bronze

    # Remove item (or decrement quantity)
    if inv.quantity > 1:
        inv.quantity -= 1
    else:
        await db.delete(inv)

    # Log transaction
    tx = CurrencyTransaction(
        session_id=char.session_id,
        from_character_id=None,  # GM buyback
        to_character_id=char.id,
        amount_bronze=price_bronze,
        note=f"GM bought {item_name}",
    )
    db.add(tx)
    await db.commit()
    await db.refresh(char)

    return {
        "ok": True,
        "item_name": item_name,
        "price_bronze": price_bronze,
        "price_display": format_currency(price_bronze, _rates),
        "character_id": char.id,
        "character_name": char.name,
        "remaining_bronze": char.wealth_bronze,
        "remaining_currency": bronze_to_display(char.wealth_bronze, _rates),
    }
