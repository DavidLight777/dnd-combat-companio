from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_session
from models import Character, StatModifier, AttackModifier, DamageModifier

router = APIRouter(prefix="/api", tags=["modifiers"])

_MODEL_MAP = {
    "stat": StatModifier,
    "attack": AttackModifier,
    "damage": DamageModifier,
}


class ModifierCreate(BaseModel):
    modifier_type: str  # "stat" | "attack" | "damage"
    stat_name: Optional[str] = None  # required only for stat modifiers
    name: str = "Modifier"
    value: int = 0
    is_active: bool = True


class ModifierUpdate(BaseModel):
    name: Optional[str] = None
    value: Optional[int] = None
    is_active: Optional[bool] = None
    stat_name: Optional[str] = None


def _mod_dict(m, mtype: str) -> dict:
    d = {"id": m.id, "character_id": m.character_id, "name": m.name,
         "value": m.value, "is_active": m.is_active, "modifier_type": mtype}
    if mtype == "stat":
        d["stat_name"] = m.stat_name
    return d


@router.get("/characters/{char_id}/modifiers")
async def list_modifiers(
    char_id: int,
    type: str = Query(..., pattern="^(stat|attack|damage)$"),
    db: AsyncSession = Depends(get_session),
):
    Model = _MODEL_MAP[type]
    result = await db.execute(select(Model).where(Model.character_id == char_id))
    return [_mod_dict(m, type) for m in result.scalars().all()]


@router.post("/characters/{char_id}/modifiers", status_code=201)
async def create_modifier(char_id: int, body: ModifierCreate, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")

    mtype = body.modifier_type
    if mtype not in _MODEL_MAP:
        raise HTTPException(400, "modifier_type must be stat, attack, or damage")

    Model = _MODEL_MAP[mtype]
    kwargs = {"character_id": char_id, "name": body.name, "value": body.value, "is_active": body.is_active}
    if mtype == "stat":
        if not body.stat_name:
            raise HTTPException(400, "stat_name required for stat modifiers")
        kwargs["stat_name"] = body.stat_name

    m = Model(**kwargs)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _mod_dict(m, mtype)


@router.put("/modifiers/{modifier_id}")
async def update_modifier(
    modifier_id: int,
    body: ModifierUpdate,
    type: str = Query(..., pattern="^(stat|attack|damage)$"),
    db: AsyncSession = Depends(get_session),
):
    Model = _MODEL_MAP[type]
    m = await db.get(Model, modifier_id)
    if not m:
        raise HTTPException(404, "Modifier not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        if field == "stat_name" and type != "stat":
            continue
        setattr(m, field, val)
    await db.commit()
    await db.refresh(m)
    return _mod_dict(m, type)


@router.delete("/modifiers/{modifier_id}")
async def delete_modifier(
    modifier_id: int,
    type: str = Query(..., pattern="^(stat|attack|damage)$"),
    db: AsyncSession = Depends(get_session),
):
    Model = _MODEL_MAP[type]
    m = await db.get(Model, modifier_id)
    if not m:
        raise HTTPException(404, "Modifier not found")
    await db.delete(m)
    await db.commit()
    return {"ok": True}
