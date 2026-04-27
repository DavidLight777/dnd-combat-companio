"""Rework Phase 5 — Poison templates + weapon coating.

Endpoints:
  GET    /api/poison-templates                     list (optionally ?session_id)
  POST   /api/poison-templates                     create  (GM)
  PATCH  /api/poison-templates/{id}                update  (GM)
  DELETE /api/poison-templates/{id}                delete  (GM)

  POST   /api/inventory/{inv_id}/apply-poison      coat a weapon with poison
     body: {poison_template_id, charges?, turns_per_hit?}
  DELETE /api/inventory/{inv_id}/apply-poison      remove the coat

Rules:
  * While the inventory item is NOT equipped, charges are frozen (checked elsewhere).
  * For items tagged "arrow" / "arrows" turns_per_hit is forced to 1.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    InventoryItem,
    InventoryItemPoison,
    Item,
    PoisonTemplate,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api", tags=["poisons"])


# ── Schemas ──────────────────────────────────────────────────
class PoisonBody(BaseModel):
    name: str
    description: str = ""
    icon: str = "☠️"
    color: str = "#7fbf54"
    damage_dice_count: int = Field(default=1, ge=1, le=20)
    damage_dice_type: int = Field(default=4, ge=2, le=100)
    damage_type: str = "poison"
    default_charges: int = Field(default=3, ge=1, le=50)
    default_turns_per_hit: int = Field(default=3, ge=1, le=20)
    session_id: int | None = None


class PoisonPatchBody(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    damage_dice_count: int | None = Field(default=None, ge=1, le=20)
    damage_dice_type: int | None = Field(default=None, ge=2, le=100)
    damage_type: str | None = None
    default_charges: int | None = Field(default=None, ge=1, le=50)
    default_turns_per_hit: int | None = Field(default=None, ge=1, le=20)


class ApplyPoisonBody(BaseModel):
    poison_template_id: int
    charges: int | None = Field(default=None, ge=1, le=50)
    turns_per_hit: int | None = Field(default=None, ge=1, le=20)


# ── Helpers ──────────────────────────────────────────────────
def _ser_template(t: PoisonTemplate) -> dict:
    return {
        "id": t.id,
        "session_id": t.session_id,
        "name": t.name,
        "description": t.description,
        "icon": t.icon,
        "color": t.color,
        "damage_dice_count": t.damage_dice_count,
        "damage_dice_type": t.damage_dice_type,
        "damage_type": t.damage_type,
        "default_charges": t.default_charges,
        "default_turns_per_hit": t.default_turns_per_hit,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def _ser_applied(p: InventoryItemPoison) -> dict:
    t = p.poison_template
    return {
        "id": p.id,
        "inventory_item_id": p.inventory_item_id,
        "poison_template_id": p.poison_template_id,
        "charges_remaining": p.charges_remaining,
        "turns_per_hit": p.turns_per_hit,
        "applied_at": p.applied_at.isoformat() if p.applied_at else None,
        "template": _ser_template(t) if t else None,
    }


def _is_arrow_item(item: Item) -> bool:
    """Arrows always apply 1-turn poison per hit."""
    try:
        tags = json.loads(item.tags or "[]")
    except Exception:
        tags = []
    tags_lower = {str(t).lower() for t in tags}
    if tags_lower & {"arrow", "arrows", "ammo"}:
        return True
    name = (item.name or "").lower()
    return "arrow" in name or "bolt" in name


# ══════════════════════════════════════════════════════════════
# POISON TEMPLATES CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/poison-templates")
async def list_poisons(session_id: int | None = None, db: AsyncSession = Depends(get_session)):
    q = select(PoisonTemplate)
    if session_id is not None:
        q = q.where((PoisonTemplate.session_id == session_id) | (PoisonTemplate.session_id == None))
    result = await db.execute(q.order_by(PoisonTemplate.name))
    return [_ser_template(t) for t in result.scalars().all()]


@router.post("/poison-templates")
async def create_poison(body: PoisonBody, db: AsyncSession = Depends(get_session)):
    t = PoisonTemplate(**body.model_dump())
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _ser_template(t)


@router.patch("/poison-templates/{tid}")
async def update_poison(tid: int, body: PoisonPatchBody, db: AsyncSession = Depends(get_session)):
    t = await db.get(PoisonTemplate, tid)
    if not t:
        raise HTTPException(404, "Poison template not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    await db.commit()
    await db.refresh(t)
    return _ser_template(t)


@router.delete("/poison-templates/{tid}")
async def delete_poison(tid: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(PoisonTemplate, tid)
    if not t:
        raise HTTPException(404, "Poison template not found")
    await db.delete(t)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# APPLY POISON TO INVENTORY ITEM
# ══════════════════════════════════════════════════════════════
@router.post("/inventory/{inv_id}/apply-poison")
async def apply_poison(inv_id: int, body: ApplyPoisonBody, db: AsyncSession = Depends(get_session)):
    inv = await db.get(InventoryItem, inv_id)
    if not inv:
        raise HTTPException(404, "Inventory item not found")
    item = inv.item
    if not item or not item.weapon_stats:
        raise HTTPException(400, "Only weapons can be poisoned")

    template = await db.get(PoisonTemplate, body.poison_template_id)
    if not template:
        raise HTTPException(404, "Poison template not found")

    # Arrows: turns_per_hit forced to 1
    arrow = _is_arrow_item(item)
    turns = 1 if arrow else (body.turns_per_hit or template.default_turns_per_hit)
    charges = body.charges or template.default_charges

    # Replace any existing coat
    existing_q = await db.execute(
        select(InventoryItemPoison).where(InventoryItemPoison.inventory_item_id == inv_id)
    )
    existing = existing_q.scalars().first()
    if existing:
        existing.poison_template_id = template.id
        existing.charges_remaining = charges
        existing.turns_per_hit = turns
        applied = existing
    else:
        applied = InventoryItemPoison(
            inventory_item_id=inv_id,
            poison_template_id=template.id,
            charges_remaining=charges,
            turns_per_hit=turns,
        )
        db.add(applied)

    await db.commit()
    await db.refresh(applied)

    # Notify via WS
    try:
        await manager.broadcast(inv.character.session_id if inv.character else 0, {
            "event": "inventory.update",
            "character_id": inv.character_id,
        })
    except Exception:
        pass
    return _ser_applied(applied)


@router.delete("/inventory/{inv_id}/apply-poison")
async def remove_poison(inv_id: int, db: AsyncSession = Depends(get_session)):
    q = await db.execute(
        select(InventoryItemPoison).where(InventoryItemPoison.inventory_item_id == inv_id)
    )
    applied = q.scalars().first()
    if not applied:
        raise HTTPException(404, "No poison on this item")
    await db.delete(applied)
    await db.commit()
    return {"ok": True}


@router.get("/inventory/{inv_id}/applied-poison")
async def get_applied_poison(inv_id: int, db: AsyncSession = Depends(get_session)):
    q = await db.execute(
        select(InventoryItemPoison).where(InventoryItemPoison.inventory_item_id == inv_id)
    )
    applied = q.scalars().first()
    if not applied:
        return None
    return _ser_applied(applied)
