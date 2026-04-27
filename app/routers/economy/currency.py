
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.game_mechanics import bronze_to_display, display_to_bronze, format_currency
from app.models import (
    Character,
    CurrencyTransaction,
)
from app.routers.economy.common import GiveGoldBody, TransferBody, _rates, router


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
