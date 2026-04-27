"""Ability level and rank configs CRUD."""
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Ability, AbilityLevelConfig, AbilityRankConfig
from app.routers.abilities.common import _apply_config_body, _config_to_dict, router


@router.get("/abilities/{ability_id}/level-configs")
async def list_ability_level_configs(ability_id: int, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    result = await db.execute(
        select(AbilityLevelConfig).where(AbilityLevelConfig.ability_id == ability_id).order_by(AbilityLevelConfig.level)
    )
    return [_config_to_dict(c) for c in result.scalars().all()]


@router.post("/abilities/{ability_id}/level-configs")
async def create_ability_level_config(ability_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    level = int(body.get("level", 0))
    result = await db.execute(
        select(AbilityLevelConfig).where(
            AbilityLevelConfig.ability_id == ability_id,
            AbilityLevelConfig.level == level,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        _apply_config_body(existing, body)
    else:
        existing = AbilityLevelConfig(ability_id=ability_id, level=level)
        _apply_config_body(existing, body)
        db.add(existing)
    await db.commit()
    await db.refresh(existing)
    return _config_to_dict(existing)


@router.delete("/abilities/{ability_id}/level-configs/{config_id}")
async def delete_ability_level_config(ability_id: int, config_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(AbilityLevelConfig, config_id)
    if not c or c.ability_id != ability_id:
        raise HTTPException(404, "Config not found")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


@router.get("/abilities/{ability_id}/rank-configs")
async def list_ability_rank_configs(ability_id: int, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    result = await db.execute(
        select(AbilityRankConfig).where(AbilityRankConfig.ability_id == ability_id).order_by(AbilityRankConfig.rank)
    )
    return [_config_to_dict(c) for c in result.scalars().all()]


@router.post("/abilities/{ability_id}/rank-configs")
async def create_ability_rank_config(ability_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    rank = str(body.get("rank", "")).lower()
    result = await db.execute(
        select(AbilityRankConfig).where(
            AbilityRankConfig.ability_id == ability_id,
            AbilityRankConfig.rank == rank,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        _apply_config_body(existing, body)
    else:
        existing = AbilityRankConfig(ability_id=ability_id, rank=rank)
        _apply_config_body(existing, body)
        db.add(existing)
    await db.commit()
    await db.refresh(existing)
    return _config_to_dict(existing)


@router.delete("/abilities/{ability_id}/rank-configs/{config_id}")
async def delete_ability_rank_config(ability_id: int, config_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(AbilityRankConfig, config_id)
    if not c or c.ability_id != ability_id:
        raise HTTPException(404, "Config not found")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# RESOLVE ABILITY (effective stats after level + rank configs)
