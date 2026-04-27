"""Rework v2 — Character Creation Wizard (6 steps).

Step 1 — Identity (name / age / gender)           → handled in /sessions/join
Step 2 — Race selection                            → handled in /sessions/join
Step 3 — Starting-item roll + proposal             → THIS router (+ GM approval)
Step 4 — Stat choice (accept / decline for advantage)
Step 5 — Feature roll (d20 → rarity → d4 → ability pool)
Step 6 — Finalize (HP roll, slot cap, completion)

The wizard's JSON `data` column stores everything between steps. Contract:

{
  "starting_roll":   {"d20": 14, "rarity": "uncommon"},
  "proposed_item":   {"name":..., "description":..., "category":"weapon|consumable|misc",
                      "weapon":     {"dice_count":1,"dice_type":6,"hit_stat":"strength","damage_stat":"strength","damage_type":"physical"},
                      "consumable": {"effect_kind":"heal|buff|dot","charges":1,"effect_detail":"..."}},
  "gm_rejected":     false,
  "gm_reject_note":  "...",
  "gm_approved":     true,
  "item_id":         42,
  "inventory_id":    101,
  "final_rarity":    "uncommon",
  "stat_choice":     {"declined": false},
  "feature_roll":    {"d20_rolls":[14,3],"kept_d20":14,"rarity":"uncommon",
                      "bucket_size":4,"d_size":4,"d_rolled":2,"ability_id":77},
  "finalize":        {"hp_rolls":[6],"race_hp_die":8,"race_hp_count":1,
                      "max_hp":7,"slots":14,"declined":false}
}

Rarity table (shared by starting-item + feature rolls):
  1         → common (flagged broken on items)
  2-9       → common
  10-14     → uncommon
  15-18     → rare
  19-20     → epic
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Character,
    CharacterWizardState,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api/wizard", tags=["wizard"])


# ══════════════════════════════════════════════════════════════
# Constants & helpers
# ══════════════════════════════════════════════════════════════
RARITIES_ORDER = ["common", "uncommon", "rare", "epic", "legendary"]


def _d20_to_rarity(d20: int) -> str:
    if d20 <= 1:
        return "common"
    if d20 <= 9:
        return "common"
    if d20 <= 14:
        return "uncommon"
    if d20 <= 18:
        return "rare"
    return "epic"          # 19-20


def _d20_desc(d20: int) -> str:
    if d20 <= 1:
        return "Broken — a cursed start."
    if d20 <= 9:
        return "Common quality."
    if d20 <= 14:
        return "Uncommon — a touch better than ordinary."
    if d20 <= 18:
        return "Rare — a prized find."
    return "Epic — legendary stroke of luck!"


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
            current_step=3,
            is_completed=False,
            data="{}",
            gm_approved=False,
        )
        db.add(ws)
        await db.commit()
        await db.refresh(ws)
    return char, ws


async def _ensure_state(char_id: int, db: AsyncSession):
    return await _load_state(char_id, db, auto_create=True)


# ══════════════════════════════════════════════════════════════

# Schemas
# ══════════════════════════════════════════════════════════════
class WeaponProposal(BaseModel):
    dice_count: int = 1
    dice_type: int = 6          # d4/d6/d8/d10/d12
    hit_stat: str = "strength"
    damage_stat: str = "strength"
    damage_type: str = "physical"


class ConsumableProposal(BaseModel):
    effect_kind: str = "heal"   # heal / buff / dot
    charges: int = 1
    effect_detail: str = ""


class ProposeItemBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    category: str = "misc"      # "weapon" / "consumable" / "misc"
    weapon: WeaponProposal | None = None
    consumable: ConsumableProposal | None = None


class ApproveItemBody(BaseModel):
    # GM may edit any field before approving (Q2 in REWORK_PLAN.md).
    name: str | None = None
    description: str | None = None
    category: str | None = None
    rarity_override: str | None = None
    weapon: WeaponProposal | None = None
    consumable: ConsumableProposal | None = None
    note: str = ""


class RejectBody(BaseModel):
    note: str = ""


class StatChoiceBody(BaseModel):
    declined: bool


# ══════════════════════════════════════════════════════════════
# GET / housekeeping
