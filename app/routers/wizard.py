"""Rework Phase 7 — Character Creation Wizard.

The lobby already handles the first 3 steps (name+code, race, class) via /api/sessions/join.
This router adds:
  * Server-side resumable state (CharacterWizardState).
  * Step 4: starting-item dice roll (d20 → rarity tier).
  * Step 5: player proposes the item → GM approves → item is created and placed in bag.

Endpoints:
  GET    /api/wizard/{char_id}                 — current state (auto-creates if missing).
  POST   /api/wizard/{char_id}/starting-roll   — rolls d20, stores result, returns rarity.
  POST   /api/wizard/{char_id}/propose-item    — player submits {name, description} within rarity.
  POST   /api/wizard/{char_id}/gm-approve      — GM approves → creates Item + InventoryItem.
  POST   /api/wizard/{char_id}/gm-reject       — GM rejects (step resets to propose).
  DELETE /api/wizard/{char_id}                 — discard state (e.g. bail out).

Wizard `data` JSON schema (free-form, but we use these keys):
{
  "starting_roll": {"d20": 14, "rarity": "uncommon"},
  "proposed_item": {"name": "Bronze Dagger", "description": "..."},
  "item_id": 42,
  "inventory_id": 101,
  "gm_approved": true
}

Rarity table (d20 → tier):
  1           → broken (common, poor quality)
  2..9        → common
  10..14      → uncommon
  15..19      → rare
  20          → epic
"""
from __future__ import annotations

import json
import random
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character, CharacterWizardState, Item, InventoryItem,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api/wizard", tags=["wizard"])


# ── Schemas ──────────────────────────────────────────────────
class ProposeItemBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    weight: float = 0.0
    category: str = "misc"


class GmApproveBody(BaseModel):
    rarity_override: str | None = None  # GM can tune the rarity upward/downward
    note: str = ""


# ── Helpers ──────────────────────────────────────────────────
def _d20_to_rarity(d20: int) -> str:
    """Rework Phase 7 rarity table for starting-item rolls."""
    if d20 <= 1:
        return "common"      # broken/poor quality
    if d20 <= 9:
        return "common"
    if d20 <= 14:
        return "uncommon"
    if d20 <= 19:
        return "rare"
    return "epic"             # nat 20


def _d20_desc(d20: int) -> str:
    if d20 <= 1:
        return "Cursed start — broken or tainted item."
    if d20 <= 9:
        return "Common quality."
    if d20 <= 14:
        return "Uncommon — a touch better than ordinary."
    if d20 <= 19:
        return "Rare — a prized find."
    return "Legendary stroke of luck — Epic item!"


def _data(ws: CharacterWizardState) -> dict:
    try:
        return json.loads(ws.data or "{}") or {}
    except Exception:
        return {}


def _save_data(ws: CharacterWizardState, data: dict):
    ws.data = json.dumps(data)


def _ser(ws: CharacterWizardState) -> dict:
    return {
        "id": ws.id,
        "character_id": ws.character_id,
        "session_id": ws.session_id,
        "current_step": ws.current_step,
        "is_completed": ws.is_completed,
        "gm_approved": ws.gm_approved,
        "data": _data(ws),
        "created_at": ws.created_at.isoformat() if ws.created_at else None,
        "updated_at": ws.updated_at.isoformat() if ws.updated_at else None,
    }




async def _broadcast(session_id: int, event: str, payload: dict | None = None):
    try:
        msg = {"event": event}
        if payload:
            msg.update(payload)
        await manager.broadcast(session_id, msg)
    except Exception:
        pass


async def _load_state(char_id: int, db: AsyncSession, auto_create: bool = False):
    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    q = await db.execute(
        select(CharacterWizardState).where(CharacterWizardState.character_id == char_id)
    )
    ws = q.scalars().first()
    if ws is None and auto_create:
        ws = CharacterWizardState(
            character_id=char_id,
            session_id=char.session_id,
            current_step=4,
            is_completed=False,
            data="{}",
            gm_approved=False,
        )
        db.add(ws)
        await db.commit()
        await db.refresh(ws)
    return char, ws


async def _ensure_state(char_id: int, db: AsyncSession):
    """Always return a state row (create if missing). Used by step POSTs."""
    return await _load_state(char_id, db, auto_create=True)


# ── Endpoints ────────────────────────────────────────────────
@router.get("/{char_id}")
async def get_wizard(char_id: int, db: AsyncSession = Depends(get_session)):
    """Return wizard state WITHOUT auto-creating (404 if nothing to do)."""
    _, ws = await _load_state(char_id, db, auto_create=False)
    if ws is None:
        raise HTTPException(404, "No wizard state for this character")
    return _ser(ws)


@router.post("/{char_id}/start")
async def start_wizard(char_id: int, db: AsyncSession = Depends(get_session)):
    """Called by the lobby right after /sessions/join to open the starting-item flow."""
    _, ws = await _ensure_state(char_id, db)
    return _ser(ws)


@router.delete("/{char_id}")
async def discard_wizard(char_id: int, db: AsyncSession = Depends(get_session)):
    q = await db.execute(
        select(CharacterWizardState).where(CharacterWizardState.character_id == char_id)
    )
    ws = q.scalars().first()
    if ws:
        await db.delete(ws)
        await db.commit()
    return {"ok": True}


@router.post("/{char_id}/starting-roll")
async def starting_roll(char_id: int, db: AsyncSession = Depends(get_session)):
    """Step 4 — Roll d20 to determine starting-item rarity. Idempotent-ish:
    once the player has rolled, re-rolling is blocked unless the state is reset.
    """
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")

    data = _data(ws)
    if "starting_roll" in data:
        return {
            "already_rolled": True,
            "d20": data["starting_roll"]["d20"],
            "rarity": data["starting_roll"]["rarity"],
            "description": _d20_desc(data["starting_roll"]["d20"]),
            "state": _ser(ws),
        }

    d20 = random.randint(1, 20)
    rarity = _d20_to_rarity(d20)
    data["starting_roll"] = {"d20": d20, "rarity": rarity}
    _save_data(ws, data)
    ws.current_step = 5  # move to propose-item
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id})
    return {
        "d20": d20,
        "rarity": rarity,
        "description": _d20_desc(d20),
        "state": _ser(ws),
    }


@router.post("/{char_id}/propose-item")
async def propose_item(char_id: int, body: ProposeItemBody, db: AsyncSession = Depends(get_session)):
    """Step 5 — Player describes the item they want. Requires prior starting-roll."""
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "starting_roll" not in data:
        raise HTTPException(400, "Roll the starting-item dice first")

    data["proposed_item"] = {
        "name": body.name,
        "description": body.description,
        "weight": body.weight,
        "category": body.category,
    }
    # Reset any previous rejection flag
    data.pop("gm_rejected", None)
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.update", {"character_id": char_id, "needs_gm_approve": True})
    return _ser(ws)


@router.post("/{char_id}/gm-approve")
async def gm_approve(char_id: int, body: GmApproveBody, db: AsyncSession = Depends(get_session)):
    """GM approves the proposed item → create Item + InventoryItem, mark wizard complete."""
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "proposed_item" not in data or "starting_roll" not in data:
        raise HTTPException(400, "Nothing to approve yet")

    proposal = data["proposed_item"]
    rarity = (body.rarity_override or data["starting_roll"]["rarity"]).lower()

    item = Item(
        session_id=char.session_id,
        name=proposal["name"],
        description=proposal.get("description", ""),
        category=proposal.get("category", "misc"),
        rarity=rarity,
        weight=proposal.get("weight", 0.0),
    )
    db.add(item)
    await db.flush()

    inv = InventoryItem(
        character_id=char.id,
        item_id=item.id,
        quantity=1,
        is_equipped=False,
    )
    db.add(inv)
    await db.flush()

    data["item_id"] = item.id
    data["inventory_id"] = inv.id
    data["gm_approved"] = True
    data["gm_note"] = body.note
    data["final_rarity"] = rarity
    _save_data(ws, data)
    ws.is_completed = True
    ws.gm_approved = True
    ws.current_step = 5
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.completed", {
        "character_id": char_id,
        "item_id": item.id,
        "rarity": rarity,
    })
    await _broadcast(char.session_id, "inventory.update", {"character_id": char_id})
    return {
        "approved": True,
        "item_id": item.id,
        "inventory_id": inv.id,
        "rarity": rarity,
        "state": _ser(ws),
    }


@router.post("/{char_id}/gm-reject")
async def gm_reject(char_id: int, body: dict | None = None, db: AsyncSession = Depends(get_session)):
    """GM rejects the proposed item; player must submit again."""
    body = body or {}
    char, ws = await _ensure_state(char_id, db)
    if ws.is_completed:
        raise HTTPException(400, "Wizard already completed")
    data = _data(ws)
    if "proposed_item" not in data:
        raise HTTPException(400, "No proposal to reject")
    data.pop("proposed_item", None)
    data["gm_rejected"] = True
    data["gm_reject_note"] = str(body.get("note", ""))
    _save_data(ws, data)
    await db.commit()
    await db.refresh(ws)

    await _broadcast(char.session_id, "wizard.update", {
        "character_id": char_id,
        "rejected": True,
        "note": data.get("gm_reject_note", ""),
    })
    return _ser(ws)


@router.get("/session/{session_id}/pending")
async def list_pending_approvals(session_id: int, db: AsyncSession = Depends(get_session)):
    """GM helper: list characters waiting for starting-item approval in this session."""
    q = await db.execute(
        select(CharacterWizardState).where(
            CharacterWizardState.session_id == session_id,
            CharacterWizardState.is_completed == False,
        )
    )
    items = []
    for ws in q.scalars().all():
        data = _data(ws)
        if "proposed_item" not in data:
            continue
        char = await db.get(Character, ws.character_id)
        items.append({
            "character_id": ws.character_id,
            "character_name": char.name if char else "?",
            "starting_roll": data.get("starting_roll"),
            "proposed_item": data["proposed_item"],
            "state": _ser(ws),
        })
    return items
