"""Fix 2 — Chest System API."""
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Chest, ChestItem, Character, Item, Session, InventoryItem
from app.game_mechanics import add_item_to_inventory
from app.websocket_manager import manager as _ws

router = APIRouter(prefix="/api", tags=["chests"])


# ── Schemas ───────────────────────────────────────────────────
class ChestBody(BaseModel):
    name: str = "Chest"
    description: str = ""
    map_x: float = 0.0
    map_y: float = 0.0
    icon: str = "chest"


class ChestItemBody(BaseModel):
    item_id: int
    quantity: int = 1


class GiveToPlayerBody(BaseModel):
    player_id: int


# ── Helpers ───────────────────────────────────────────────────
def _ser_chest(c: Chest) -> dict:
    return {
        "id": c.id,
        "session_id": c.session_id,
        "name": c.name,
        "description": c.description,
        "is_revealed": c.is_revealed,
        "map_x": c.map_x,
        "map_y": c.map_y,
        "icon": c.icon,
        "items": [
            {
                "id": ci.id,
                "item_id": ci.item_id,
                "quantity": ci.quantity,
                "item_name": getattr(ci.item, "name", "Unknown") if ci.item else "Unknown",
            }
            for ci in (c.items or [])
        ],
    }


# ══════════════════════════════════════════════════════════════
# CHEST CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/map/{session_code}/chests")
async def list_chests(session_code: str, db: AsyncSession = Depends(get_session)):
    sess = await db.execute(select(Session).where(Session.code == session_code))
    session = sess.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    result = await db.execute(
        select(Chest).where(Chest.session_id == session.id).order_by(Chest.name)
    )
    return [_ser_chest(c) for c in result.scalars().all()]


@router.post("/map/{session_code}/chests")
async def create_chest(session_code: str, body: ChestBody, db: AsyncSession = Depends(get_session)):
    sess = await db.execute(select(Session).where(Session.code == session_code))
    session = sess.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    c = Chest(
        session_id=session.id,
        name=body.name,
        description=body.description,
        map_x=body.map_x,
        map_y=body.map_y,
        icon=body.icon,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)

    # WS broadcast
    try:
        await _ws.broadcast_to_session(session_code, "chest.placed", {
            "chest_id": c.id,
            "x": c.map_x,
            "y": c.map_y,
            "name": c.name,
        })
    except Exception:
        pass

    return _ser_chest(c)


@router.put("/chests/{chest_id}")
async def update_chest(chest_id: int, body: ChestBody, db: AsyncSession = Depends(get_session)):
    c = await db.get(Chest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    c.name = body.name
    c.description = body.description
    c.map_x = body.map_x
    c.map_y = body.map_y
    c.icon = body.icon
    await db.commit()
    await db.refresh(c)

    # WS broadcast
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await _ws.broadcast_to_session(sess.code, "chest.updated", _ser_chest(c))
    except Exception:
        pass

    return _ser_chest(c)


@router.delete("/chests/{chest_id}")
async def delete_chest(chest_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Chest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    session_code = None
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            session_code = sess.code
    except Exception:
        pass
    await db.delete(c)
    await db.commit()

    if session_code:
        try:
            await _ws.broadcast_to_session(session_code, "chest.updated", {"chest_id": chest_id, "deleted": True})
        except Exception:
            pass

    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# REVEAL / HIDE
# ══════════════════════════════════════════════════════════════
@router.patch("/chests/{chest_id}/reveal")
async def reveal_chest(chest_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Chest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    c.is_revealed = True
    await db.commit()
    await db.refresh(c)

    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await _ws.broadcast_to_session(sess.code, "chest.revealed", _ser_chest(c))
    except Exception:
        pass

    return _ser_chest(c)


@router.patch("/chests/{chest_id}/hide")
async def hide_chest(chest_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Chest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    c.is_revealed = False
    await db.commit()
    await db.refresh(c)

    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await _ws.broadcast_to_session(sess.code, "chest.hidden", {"chest_id": c.id})
    except Exception:
        pass

    return _ser_chest(c)


# ══════════════════════════════════════════════════════════════
# CHEST ITEMS
# ══════════════════════════════════════════════════════════════
@router.get("/chests/{chest_id}/items")
async def get_chest_items(chest_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Chest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    return _ser_chest(c)["items"]


@router.post("/chests/{chest_id}/items")
async def add_item_to_chest(chest_id: int, body: ChestItemBody, db: AsyncSession = Depends(get_session)):
    c = await db.get(Chest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    item = await db.get(Item, body.item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    ci = ChestItem(chest_id=chest_id, item_id=body.item_id, quantity=body.quantity)
    db.add(ci)
    await db.commit()
    await db.refresh(ci)

    # WS broadcast
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await _ws.broadcast_to_session(sess.code, "chest.updated", _ser_chest(c))
    except Exception:
        pass

    return {"id": ci.id, "item_id": ci.item_id, "quantity": ci.quantity, "item_name": item.name}


@router.delete("/chest-items/{chest_item_id}")
async def remove_item_from_chest(chest_item_id: int, db: AsyncSession = Depends(get_session)):
    ci = await db.get(ChestItem, chest_item_id)
    if not ci:
        raise HTTPException(404, "Chest item not found")
    chest = await db.get(Chest, ci.chest_id)
    await db.delete(ci)
    await db.commit()

    if chest:
        try:
            sess = await db.get(Session, chest.session_id)
            if sess:
                await _ws.broadcast_to_session(sess.code, "chest.updated", _ser_chest(chest))
        except Exception:
            pass

    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# GIVE ALL ITEMS TO PLAYER
# ══════════════════════════════════════════════════════════════
@router.post("/chests/{chest_id}/give-to-player")
async def give_chest_items_to_player(
    chest_id: int, body: GiveToPlayerBody, db: AsyncSession = Depends(get_session)
):
    c = await db.get(Chest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    player = await db.get(Character, body.player_id)
    if not player:
        raise HTTPException(404, "Player not found")

    transferred = []
    for ci in list(c.items or []):
        inv = await add_item_to_inventory(db, player.id, ci.item_id, ci.quantity)
        if inv:
            transferred.append({
                "item_id": ci.item_id,
                "quantity": ci.quantity,
                "item_name": getattr(ci.item, "name", "Unknown") if ci.item else "Unknown",
            })
            await db.delete(ci)

    await db.commit()
    await db.refresh(c)

    # WS broadcast
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await _ws.broadcast_to_session(sess.code, "chest.items_transferred", {
                "chest_id": chest_id,
                "player_id": player.id,
                "player_name": player.name,
                "items": transferred,
            })
            await _ws.broadcast_to_session(sess.code, "chest.updated", _ser_chest(c))
    except Exception:
        pass

    return {"transferred": transferred, "player_id": player.id}
