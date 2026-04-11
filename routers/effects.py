from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_session
from models import Character, CharacterEffect

router = APIRouter(prefix="/api", tags=["effects"])


class EffectCreate(BaseModel):
    name: str = "New Effect"
    effect_type: str = "percent_reduction"
    value: float = 0
    is_active: bool = True


class EffectUpdate(BaseModel):
    name: Optional[str] = None
    effect_type: Optional[str] = None
    value: Optional[float] = None
    is_active: Optional[bool] = None


def _eff_dict(e: CharacterEffect) -> dict:
    return {"id": e.id, "character_id": e.character_id, "name": e.name,
            "effect_type": e.effect_type, "value": e.value, "is_active": e.is_active}


@router.get("/characters/{char_id}/effects")
async def list_effects(char_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CharacterEffect).where(CharacterEffect.character_id == char_id)
    )
    return [_eff_dict(e) for e in result.scalars().all()]


@router.post("/characters/{char_id}/effects", status_code=201)
async def create_effect(char_id: int, body: EffectCreate, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    e = CharacterEffect(
        character_id=char_id, name=body.name,
        effect_type=body.effect_type, value=body.value, is_active=body.is_active,
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return _eff_dict(e)


@router.put("/effects/{effect_id}")
async def update_effect(effect_id: int, body: EffectUpdate, db: AsyncSession = Depends(get_session)):
    e = await db.get(CharacterEffect, effect_id)
    if not e:
        raise HTTPException(404, "Effect not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(e, field, val)
    await db.commit()
    await db.refresh(e)
    return _eff_dict(e)


@router.delete("/effects/{effect_id}")
async def delete_effect(effect_id: int, db: AsyncSession = Depends(get_session)):
    e = await db.get(CharacterEffect, effect_id)
    if not e:
        raise HTTPException(404, "Effect not found")
    await db.delete(e)
    await db.commit()
    return {"ok": True}
