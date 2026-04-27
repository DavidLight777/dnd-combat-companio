
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character,
    NpcReputation,
)
from app.routers.economy.common import ReputationAdjustBody, ReputationSetBody, router


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
