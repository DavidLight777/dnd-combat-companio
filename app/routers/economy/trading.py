
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.game_mechanics import bronze_to_display, calculate_item_price, format_currency
from app.models import (
    Character,
    CurrencyTransaction,
    InventoryItem,
    NpcReputation,
    NpcShopInventory,
    Session,
    TradeSession,
)
from app.routers.economy.common import TradeBuyBody, TradeInitiateBody, _rates, router


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
