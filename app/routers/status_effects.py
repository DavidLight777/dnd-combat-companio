"""Stage 4 — Status Effects & Equipment Templates API."""

import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    StatusEffectTemplate, CharacterStatusEffect, EquipmentTemplate,
    Character, Item, InventoryItem,
)

router = APIRouter(prefix="/api", tags=["status-effects"])


# ── Schemas ──────────────────────────────────────────────────
class TemplateCreate(BaseModel):
    name: str
    description: str = ""
    icon: str = "⚡"
    color: str = "#ff6b6b"
    effects: list = []
    default_duration: int | None = None
    session_id: int | None = None


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    effects: list | None = None
    default_duration: int | None = None


class ApplyStatus(BaseModel):
    template_id: int | None = None
    custom_name: str | None = None
    custom_icon: str = "⚡"
    custom_color: str = "#ff6b6b"
    custom_effects: list | None = None
    remaining_turns: int | None = None
    applied_by_id: int | None = None


class EquipTemplateCreate(BaseModel):
    name: str
    item_ids: list[int] = []
    session_id: int | None = None


class EquipTemplateApply(BaseModel):
    character_id: int


# ── Helper ───────────────────────────────────────────────────
def _serialize_effect(e: CharacterStatusEffect) -> dict:
    return {
        "id": e.id,
        "character_id": e.character_id,
        "template_id": e.template_id,
        "name": e.name,
        "icon": e.icon,
        "color": e.color,
        "effects": json.loads(e.effects) if e.effects else [],
        "remaining_turns": e.remaining_turns,
        "applied_at": e.applied_at.isoformat() if e.applied_at else None,
        "applied_by_id": e.applied_by_id,
    }


def _serialize_template(t: StatusEffectTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "icon": t.icon,
        "color": t.color,
        "effects": json.loads(t.effects) if t.effects else [],
        "default_duration": t.default_duration,
        "session_id": t.session_id,
    }


# ══════════════════════════════════════════════════════════════
# STATUS EFFECT TEMPLATES CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/status-templates")
async def list_templates(session_id: int | None = None, db: AsyncSession = Depends(get_session)):
    q = select(StatusEffectTemplate)
    if session_id is not None:
        q = q.where(
            (StatusEffectTemplate.session_id == session_id) | (StatusEffectTemplate.session_id.is_(None))
        )
    result = await db.execute(q.order_by(StatusEffectTemplate.name))
    return [_serialize_template(t) for t in result.scalars().all()]


@router.post("/status-templates")
async def create_template(body: TemplateCreate, db: AsyncSession = Depends(get_session)):
    t = StatusEffectTemplate(
        name=body.name,
        description=body.description,
        icon=body.icon,
        color=body.color,
        effects=json.dumps(body.effects),
        default_duration=body.default_duration,
        session_id=body.session_id,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _serialize_template(t)


@router.put("/status-templates/{template_id}")
async def update_template(template_id: int, body: TemplateUpdate, db: AsyncSession = Depends(get_session)):
    t = await db.get(StatusEffectTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    if body.name is not None:
        t.name = body.name
    if body.description is not None:
        t.description = body.description
    if body.icon is not None:
        t.icon = body.icon
    if body.color is not None:
        t.color = body.color
    if body.effects is not None:
        t.effects = json.dumps(body.effects)
    if body.default_duration is not None:
        t.default_duration = body.default_duration
    await db.commit()
    await db.refresh(t)
    return _serialize_template(t)


@router.delete("/status-templates/{template_id}")
async def delete_template(template_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(StatusEffectTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    await db.delete(t)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# CHARACTER STATUS EFFECTS
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{character_id}/status-effects")
async def apply_status(character_id: int, body: ApplyStatus, db: AsyncSession = Depends(get_session)):
    char = await db.get(Character, character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    if body.template_id:
        tmpl = await db.get(StatusEffectTemplate, body.template_id)
        if not tmpl:
            raise HTTPException(404, "Template not found")
        eff = CharacterStatusEffect(
            character_id=character_id,
            template_id=tmpl.id,
            name=tmpl.name,
            icon=tmpl.icon,
            color=tmpl.color,
            effects=tmpl.effects,
            remaining_turns=body.remaining_turns if body.remaining_turns is not None else tmpl.default_duration,
            applied_by_id=body.applied_by_id,
        )
    elif body.custom_name:
        eff = CharacterStatusEffect(
            character_id=character_id,
            template_id=None,
            name=body.custom_name,
            icon=body.custom_icon,
            color=body.custom_color,
            effects=json.dumps(body.custom_effects or []),
            remaining_turns=body.remaining_turns,
            applied_by_id=body.applied_by_id,
        )
    else:
        raise HTTPException(400, "Provide template_id or custom_name")

    db.add(eff)
    await db.commit()
    await db.refresh(eff)
    return _serialize_effect(eff)


@router.get("/characters/{character_id}/status-effects")
async def list_status_effects(character_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CharacterStatusEffect).where(CharacterStatusEffect.character_id == character_id)
    )
    return [_serialize_effect(e) for e in result.scalars().all()]


@router.delete("/status-effects/{effect_id}")
async def remove_status_effect(effect_id: int, db: AsyncSession = Depends(get_session)):
    eff = await db.get(CharacterStatusEffect, effect_id)
    if not eff:
        raise HTTPException(404, "Effect not found")
    name = eff.name
    char_id = eff.character_id
    await db.delete(eff)
    await db.commit()
    return {"ok": True, "removed": name, "character_id": char_id}


# ══════════════════════════════════════════════════════════════
# GM QUICK ADVANTAGE / DISADVANTAGE TOGGLE
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{character_id}/set-advantage")
async def set_advantage(character_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """
    GM convenience endpoint to grant/remove forced advantage or disadvantage.
    body: { "mode": "advantage" | "disadvantage" | "normal" }
    "normal" removes any existing forced adv/disadv effects.
    """
    char = await db.get(Character, character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    mode = body.get("mode", "normal")
    if mode not in ("normal", "advantage", "disadvantage"):
        raise HTTPException(400, "mode must be normal/advantage/disadvantage")

    # Remove any existing forced advantage/disadvantage effects
    result = await db.execute(
        select(CharacterStatusEffect).where(CharacterStatusEffect.character_id == character_id)
    )
    for eff in result.scalars().all():
        try:
            effects_json = json.loads(eff.effects) if eff.effects else []
        except Exception:
            effects_json = []
        for e in effects_json:
            if e.get("type") in ("forced_advantage", "forced_disadvantage"):
                await db.delete(eff)
                break

    if mode != "normal":
        effect_type = f"forced_{mode}"
        eff = CharacterStatusEffect(
            character_id=character_id,
            template_id=None,
            name=f"{'Advantage' if mode == 'advantage' else 'Disadvantage'} (GM)",
            icon="🎲" if mode == "advantage" else "🎯",
            color="#50c878" if mode == "advantage" else "#dc5050",
            effects=json.dumps([{"type": effect_type, "value": 1}]),
            remaining_turns=None,
            applied_by_id=None,
        )
        db.add(eff)

    await db.commit()
    return {"ok": True, "character_id": character_id, "advantage_mode": mode}


# ══════════════════════════════════════════════════════════════
# STATUS PENALTIES AGGREGATION ENDPOINT
# ══════════════════════════════════════════════════════════════
@router.get("/characters/{character_id}/status-penalties")
async def get_status_penalties(character_id: int, db: AsyncSession = Depends(get_session)):
    """Returns aggregated mechanical penalties from all active status effects."""
    from app.game_mechanics import aggregate_status_penalties
    result = await db.execute(
        select(CharacterStatusEffect).where(CharacterStatusEffect.character_id == character_id)
    )
    effects = result.scalars().all()
    effects_lists = [json.loads(e.effects) if e.effects else [] for e in effects]
    penalties = aggregate_status_penalties(effects_lists)
    return penalties


# ══════════════════════════════════════════════════════════════
# TURN ADVANCEMENT HOOK
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{character_id}/process-turn-effects")
async def process_turn_effects(character_id: int, db: AsyncSession = Depends(get_session)):
    """
    Called when a character's turn ends:
    1. Decrement remaining_turns on all active effects
    2. Remove expired effects (remaining_turns = 0)
    3. Apply hp_change_per_turn effects
    Returns list of events that occurred.
    """
    from app.game_mechanics import aggregate_status_penalties

    char = await db.get(Character, character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    result = await db.execute(
        select(CharacterStatusEffect).where(CharacterStatusEffect.character_id == character_id)
    )
    effects = result.scalars().all()

    events = []
    expired = []
    hp_changes = []

    for eff in effects:
        eff_data = json.loads(eff.effects) if eff.effects else []

        # Apply hp_change_per_turn
        for e in eff_data:
            if e.get("type") == "hp_change_per_turn":
                hp_changes.append({"name": eff.name, "value": e["value"]})

        # Decrement remaining turns
        if eff.remaining_turns is not None:
            eff.remaining_turns -= 1
            if eff.remaining_turns <= 0:
                expired.append({"id": eff.id, "name": eff.name})
                await db.delete(eff)

    # Apply HP changes
    total_hp_change = sum(h["value"] for h in hp_changes)
    if total_hp_change != 0 and char.is_alive:
        char.current_hp = max(0, char.current_hp + total_hp_change)
        if char.current_hp <= 0:
            char.is_alive = False
        events.append({
            "type": "hp_change",
            "character_id": character_id,
            "character_name": char.name,
            "hp_change": total_hp_change,
            "new_hp": char.current_hp,
            "sources": hp_changes,
        })

    for exp in expired:
        events.append({
            "type": "status_effect.expired",
            "character_id": character_id,
            "character_name": char.name,
            "effect_name": exp["name"],
            "effect_id": exp["id"],
        })

    await db.commit()

    return {
        "character_id": character_id,
        "events": events,
        "expired_effects": expired,
        "hp_changes": hp_changes,
        "total_hp_change": total_hp_change,
        "current_hp": char.current_hp,
    }


# ══════════════════════════════════════════════════════════════
# EQUIPMENT TEMPLATES
# ══════════════════════════════════════════════════════════════
@router.get("/equipment-templates")
async def list_equipment_templates(session_id: int | None = None, db: AsyncSession = Depends(get_session)):
    q = select(EquipmentTemplate)
    if session_id is not None:
        q = q.where(
            (EquipmentTemplate.session_id == session_id) | (EquipmentTemplate.session_id.is_(None))
        )
    result = await db.execute(q.order_by(EquipmentTemplate.name))
    templates = result.scalars().all()
    out = []
    for t in templates:
        item_ids = json.loads(t.item_ids) if t.item_ids else []
        out.append({
            "id": t.id,
            "name": t.name,
            "session_id": t.session_id,
            "item_ids": item_ids,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    return out


@router.post("/equipment-templates")
async def create_equipment_template(body: EquipTemplateCreate, db: AsyncSession = Depends(get_session)):
    t = EquipmentTemplate(
        name=body.name,
        session_id=body.session_id,
        item_ids=json.dumps(body.item_ids),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return {
        "id": t.id,
        "name": t.name,
        "item_ids": body.item_ids,
    }


@router.delete("/equipment-templates/{template_id}")
async def delete_equipment_template(template_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(EquipmentTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    await db.delete(t)
    await db.commit()
    return {"ok": True}


@router.post("/equipment-templates/{template_id}/apply")
async def apply_equipment_template(template_id: int, body: EquipTemplateApply, db: AsyncSession = Depends(get_session)):
    """Apply an equipment template to a character: adds items to inventory and equips them."""
    tmpl = await db.get(EquipmentTemplate, template_id)
    if not tmpl:
        raise HTTPException(404, "Template not found")
    char = await db.get(Character, body.character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    item_ids = json.loads(tmpl.item_ids) if tmpl.item_ids else []
    added = []
    for item_id in item_ids:
        item = await db.get(Item, item_id)
        if not item:
            continue
        # Check if character already has this item
        existing = await db.execute(
            select(InventoryItem).where(
                InventoryItem.character_id == body.character_id,
                InventoryItem.item_id == item_id,
            )
        )
        inv_item = existing.scalar_one_or_none()
        if not inv_item:
            inv_item = InventoryItem(
                character_id=body.character_id,
                item_id=item_id,
                quantity=1,
                is_equipped=item.equippable,
            )
            db.add(inv_item)
            added.append(item.name)
        else:
            if item.equippable and not inv_item.is_equipped:
                inv_item.is_equipped = True

    await db.commit()
    return {
        "ok": True,
        "character_id": body.character_id,
        "template_name": tmpl.name,
        "items_added": added,
        "total_items": len(item_ids),
    }
