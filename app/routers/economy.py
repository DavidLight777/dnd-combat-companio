"""Stage 3 — Multi-Currency Economy & Trading System."""

import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character, Session, Item, InventoryItem,
    CurrencyTransaction, NpcReputation, NpcShopInventory, TradeSession,
)
from app.game_mechanics import bronze_to_display, display_to_bronze, format_currency, calculate_item_price

router = APIRouter(prefix="/api", tags=["economy"])

# ── Load currency rates from config ──────────────────────────
_config_path = os.path.join(os.path.dirname(__file__), "..", "..", "config.json")
_rates = {"platinum": 1000, "gold": 100, "silver": 10, "bronze": 1}
try:
    with open(_config_path, "r") as f:
        _cfg = json.load(f)
        _rates = _cfg.get("currency_rates", _rates)
except Exception:
    pass


# ══════════════════════════════════════════════════════════════
# SCHEMAS
# ══════════════════════════════════════════════════════════════
class GiveGoldBody(BaseModel):
    platinum: int = 0
    gold: int = 0
    silver: int = 0
    bronze: int = 0
    note: str = "GM grant"


class TransferBody(BaseModel):
    from_id: int
    to_id: int
    bronze_amount: int
    note: str = ""


class ReputationSetBody(BaseModel):
    reputation_value: int


class ReputationAdjustBody(BaseModel):
    delta: int


class ShopItemAddBody(BaseModel):
    item_id: int
    stock: int | None = None
    price_override_bronze: int | None = None


class ShopItemPatchBody(BaseModel):
    stock: int | None = None
    price_override_bronze: int | None = None
    is_available: bool | None = None


class TradeInitiateBody(BaseModel):
    npc_id: int
    player_id: int


class TradeBuyBody(BaseModel):
    shop_item_id: int
    quantity: int = 1


# ══════════════════════════════════════════════════════════════
# CURRENCY ENDPOINTS
# ══════════════════════════════════════════════════════════════
@router.get("/characters/{char_id}/currency")
async def get_currency(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    return {
        "character_id": c.id,
        "total_bronze": c.wealth_bronze,
        "currency": bronze_to_display(c.wealth_bronze, _rates),
        "rates": _rates,
    }


@router.post("/characters/{char_id}/give-gold")
async def give_gold(char_id: int, body: GiveGoldBody, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    amount = display_to_bronze(body.platinum, body.gold, body.silver, body.bronze, _rates)
    if amount == 0:
        raise HTTPException(400, "Amount must be non-zero")
    c.wealth_bronze = max(0, c.wealth_bronze + amount)
    # Log transaction
    tx = CurrencyTransaction(
        session_id=c.session_id,
        from_character_id=None,  # GM grant
        to_character_id=c.id,
        amount_bronze=amount,
        note=body.note,
    )
    db.add(tx)
    await db.commit()
    await db.refresh(c)
    return {
        "ok": True,
        "total_bronze": c.wealth_bronze,
        "currency": bronze_to_display(c.wealth_bronze, _rates),
        "amount_given": amount,
    }


@router.post("/currency/transfer")
async def transfer_currency(body: TransferBody, db: AsyncSession = Depends(get_session)):
    if body.from_id == body.to_id:
        raise HTTPException(400, "Cannot transfer to yourself")
    if body.bronze_amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    sender = await db.get(Character, body.from_id)
    receiver = await db.get(Character, body.to_id)
    if not sender:
        raise HTTPException(404, "Sender not found")
    if not receiver:
        raise HTTPException(404, "Receiver not found")
    if sender.wealth_bronze < body.bronze_amount:
        raise HTTPException(400, detail={
            "error": True,
            "code": "INSUFFICIENT_FUNDS",
            "message": f"Not enough currency. Has {format_currency(sender.wealth_bronze, _rates)}, needs {format_currency(body.bronze_amount, _rates)}",
        })

    sender.wealth_bronze -= body.bronze_amount
    receiver.wealth_bronze += body.bronze_amount

    tx = CurrencyTransaction(
        session_id=sender.session_id,
        from_character_id=sender.id,
        to_character_id=receiver.id,
        amount_bronze=body.bronze_amount,
        note=body.note or f"Transfer from {sender.name} to {receiver.name}",
    )
    db.add(tx)
    await db.commit()
    await db.refresh(sender)
    await db.refresh(receiver)
    return {
        "ok": True,
        "from": {"id": sender.id, "name": sender.name, "total_bronze": sender.wealth_bronze,
                 "currency": bronze_to_display(sender.wealth_bronze, _rates)},
        "to": {"id": receiver.id, "name": receiver.name, "total_bronze": receiver.wealth_bronze,
               "currency": bronze_to_display(receiver.wealth_bronze, _rates)},
        "amount_bronze": body.bronze_amount,
    }


@router.get("/characters/{char_id}/transactions")
async def get_transactions(char_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CurrencyTransaction)
        .where(
            (CurrencyTransaction.from_character_id == char_id) |
            (CurrencyTransaction.to_character_id == char_id)
        )
        .order_by(CurrencyTransaction.timestamp.desc())
        .limit(50)
    )
    txs = result.scalars().all()
    return [
        {
            "id": t.id,
            "from_character_id": t.from_character_id,
            "to_character_id": t.to_character_id,
            "amount_bronze": t.amount_bronze,
            "currency": bronze_to_display(abs(t.amount_bronze), _rates),
            "note": t.note,
            "timestamp": t.timestamp.isoformat(),
        }
        for t in txs
    ]


# ══════════════════════════════════════════════════════════════
# REPUTATION ENDPOINTS
# ══════════════════════════════════════════════════════════════
@router.get("/npc/{npc_id}/reputation")
async def get_reputation(npc_id: int, db: AsyncSession = Depends(get_session)):
    npc = await db.get(Character, npc_id)
    if not npc or not npc.is_npc:
        raise HTTPException(404, "NPC not found")
    result = await db.execute(
        select(NpcReputation).where(NpcReputation.npc_id == npc_id)
    )
    reps = result.scalars().all()
    # Also load character names
    items = []
    for r in reps:
        ch = await db.get(Character, r.character_id)
        items.append({
            "id": r.id,
            "npc_id": r.npc_id,
            "character_id": r.character_id,
            "character_name": ch.name if ch else "Unknown",
            "reputation_value": r.reputation_value,
            "price_multiplier": round(1.0 - (r.reputation_value / 200.0), 2),
        })
    return {"npc_id": npc_id, "npc_name": npc.name, "reputations": items}


@router.patch("/npc/{npc_id}/reputation/{char_id}")
async def set_reputation(npc_id: int, char_id: int, body: ReputationSetBody,
                         db: AsyncSession = Depends(get_session)):
    val = max(-100, min(100, body.reputation_value))
    result = await db.execute(
        select(NpcReputation).where(
            NpcReputation.npc_id == npc_id,
            NpcReputation.character_id == char_id,
        )
    )
    rep = result.scalar_one_or_none()
    if rep:
        rep.reputation_value = val
    else:
        rep = NpcReputation(npc_id=npc_id, character_id=char_id, reputation_value=val)
        db.add(rep)
    await db.commit()
    await db.refresh(rep)
    return {
        "id": rep.id, "npc_id": npc_id, "character_id": char_id,
        "reputation_value": rep.reputation_value,
        "price_multiplier": round(1.0 - (rep.reputation_value / 200.0), 2),
    }


@router.post("/npc/{npc_id}/reputation/{char_id}/adjust")
async def adjust_reputation(npc_id: int, char_id: int, body: ReputationAdjustBody,
                            db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(NpcReputation).where(
            NpcReputation.npc_id == npc_id,
            NpcReputation.character_id == char_id,
        )
    )
    rep = result.scalar_one_or_none()
    if not rep:
        rep = NpcReputation(npc_id=npc_id, character_id=char_id, reputation_value=0)
        db.add(rep)
        await db.flush()
    rep.reputation_value = max(-100, min(100, rep.reputation_value + body.delta))
    await db.commit()
    await db.refresh(rep)
    return {
        "id": rep.id, "npc_id": npc_id, "character_id": char_id,
        "reputation_value": rep.reputation_value,
        "price_multiplier": round(1.0 - (rep.reputation_value / 200.0), 2),
    }


# ══════════════════════════════════════════════════════════════
# NPC SHOP ENDPOINTS
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
# TRADING ENDPOINTS
# ══════════════════════════════════════════════════════════════
@router.post("/trade/initiate")
async def initiate_trade(body: TradeInitiateBody, db: AsyncSession = Depends(get_session)):
    npc = await db.get(Character, body.npc_id)
    player = await db.get(Character, body.player_id)
    if not npc or not npc.is_npc:
        raise HTTPException(404, "NPC not found")
    if not player:
        raise HTTPException(404, "Player not found")

    # Close any open trade for this player+npc
    existing = await db.execute(
        select(TradeSession).where(
            TradeSession.npc_id == body.npc_id,
            TradeSession.player_id == body.player_id,
            TradeSession.status == "open",
        )
    )
    for old in existing.scalars().all():
        old.status = "closed"

    ts = TradeSession(
        session_id=npc.session_id,
        npc_id=body.npc_id,
        player_id=body.player_id,
    )
    db.add(ts)
    await db.commit()
    await db.refresh(ts)
    return {
        "ok": True,
        "trade_id": ts.id,
        "npc_id": npc.id,
        "npc_name": npc.name,
        "player_id": player.id,
        "player_name": player.name,
        "status": ts.status,
    }


@router.post("/trade/{trade_id}/buy")
async def trade_buy(trade_id: int, body: TradeBuyBody, db: AsyncSession = Depends(get_session)):
    ts = await db.get(TradeSession, trade_id)
    if not ts or ts.status != "open":
        raise HTTPException(404, "Trade session not found or closed")

    si = await db.get(NpcShopInventory, body.shop_item_id)
    if not si or si.npc_id != ts.npc_id or not si.is_available:
        raise HTTPException(404, "Shop item not available")

    item = si.item
    if not item:
        raise HTTPException(404, "Item not found")

    # Check stock
    if si.stock is not None and si.stock < body.quantity:
        raise HTTPException(400, detail={
            "error": True, "code": "OUT_OF_STOCK",
            "message": f"Only {si.stock} in stock",
        })

    # Calculate price
    player = await db.get(Character, ts.player_id)
    if not player:
        raise HTTPException(404, "Player not found")

    rep_result = await db.execute(
        select(NpcReputation).where(
            NpcReputation.npc_id == ts.npc_id,
            NpcReputation.character_id == ts.player_id,
        )
    )
    rep = rep_result.scalar_one_or_none()
    reputation = rep.reputation_value if rep else 0

    unit_price = calculate_item_price(
        item.base_price_bronze, reputation, si.price_override_bronze
    )
    total_cost = unit_price * body.quantity

    if player.wealth_bronze < total_cost:
        raise HTTPException(400, detail={
            "error": True, "code": "INSUFFICIENT_FUNDS",
            "message": f"Need {format_currency(total_cost, _rates)}, have {format_currency(player.wealth_bronze, _rates)}",
        })

    # Deduct currency
    player.wealth_bronze -= total_cost

    # Reduce stock
    if si.stock is not None:
        si.stock -= body.quantity
        if si.stock <= 0:
            si.is_available = False

    # Add to inventory — check if player already has this item (stack)
    existing_inv = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == ts.player_id,
            InventoryItem.item_id == item.id,
            InventoryItem.is_equipped == False,
        ).limit(1)
    )
    existing = existing_inv.scalar_one_or_none()
    if existing and not item.equippable:
        existing.quantity += body.quantity
    else:
        new_inv = InventoryItem(
            character_id=ts.player_id,
            item_id=item.id,
            quantity=body.quantity,
        )
        db.add(new_inv)

    # Log transaction
    tx = CurrencyTransaction(
        session_id=ts.session_id,
        from_character_id=ts.player_id,
        to_character_id=ts.npc_id,
        amount_bronze=total_cost,
        note=f"Bought {body.quantity}x {item.name}",
    )
    db.add(tx)

    await db.commit()
    await db.refresh(player)

    return {
        "ok": True,
        "item_name": item.name,
        "quantity": body.quantity,
        "unit_price_bronze": unit_price,
        "total_cost_bronze": total_cost,
        "total_cost": bronze_to_display(total_cost, _rates),
        "remaining_bronze": player.wealth_bronze,
        "remaining_currency": bronze_to_display(player.wealth_bronze, _rates),
    }


@router.post("/trade/{trade_id}/close")
async def close_trade(trade_id: int, db: AsyncSession = Depends(get_session)):
    ts = await db.get(TradeSession, trade_id)
    if not ts:
        raise HTTPException(404, "Trade session not found")
    ts.status = "closed"
    await db.commit()
    return {"ok": True, "trade_id": ts.id, "status": "closed"}


@router.get("/trade/{trade_id}")
async def get_trade(trade_id: int, db: AsyncSession = Depends(get_session)):
    ts = await db.get(TradeSession, trade_id)
    if not ts:
        raise HTTPException(404, "Trade session not found")
    npc = await db.get(Character, ts.npc_id)
    player = await db.get(Character, ts.player_id)
    return {
        "trade_id": ts.id,
        "npc_id": ts.npc_id,
        "npc_name": npc.name if npc else "Unknown",
        "player_id": ts.player_id,
        "player_name": player.name if player else "Unknown",
        "status": ts.status,
        "started_at": ts.started_at.isoformat(),
    }


@router.get("/sessions/{code}/transactions")
async def get_session_transactions(code: str, db: AsyncSession = Depends(get_session)):
    """Get all currency transactions for a session (GM view)."""
    result = await db.execute(select(Session).where(Session.code == code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    tx_result = await db.execute(
        select(CurrencyTransaction)
        .where(CurrencyTransaction.session_id == session.id)
        .order_by(CurrencyTransaction.timestamp.desc())
        .limit(100)
    )
    txs = tx_result.scalars().all()

    items = []
    for t in txs:
        from_name = "GM"
        to_name = "Unknown"
        if t.from_character_id:
            fc = await db.get(Character, t.from_character_id)
            from_name = fc.name if fc else "Unknown"
        tc = await db.get(Character, t.to_character_id)
        to_name = tc.name if tc else "Unknown"
        items.append({
            "id": t.id,
            "from_name": from_name,
            "to_name": to_name,
            "amount_bronze": t.amount_bronze,
            "currency": bronze_to_display(abs(t.amount_bronze), _rates),
            "note": t.note,
            "timestamp": t.timestamp.isoformat(),
        })
    return {"transactions": items}


# ══════════════════════════════════════════════════════════════
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
