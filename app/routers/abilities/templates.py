"""Ability template CRUD."""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Ability
from app.routers.abilities.common import _ability_dict, _set_ability_fields, router


@router.get("/abilities")
async def list_abilities(
    session_id: int | None = None,
    in_starting_pool: bool | None = None,
    rarity: str | None = None,
    db: AsyncSession = Depends(get_session),
):
    """Rework v2: optional `in_starting_pool` / `rarity` filters for the GM
    starting-pool manager UI."""
    q = select(Ability)
    if session_id is not None:
        q = q.where((Ability.session_id == session_id) | (Ability.session_id == None))
    if in_starting_pool is True:
        q = q.where(Ability.is_in_starting_pool == True)      # noqa: E712
    elif in_starting_pool is False:
        q = q.where(Ability.is_in_starting_pool == False)     # noqa: E712
    if rarity:
        q = q.where(Ability.rarity == rarity)
    result = await db.execute(q.order_by(Ability.rarity, Ability.name))
    return [_ability_dict(a) for a in result.scalars().all()]


@router.post("/abilities")
async def create_ability(body: dict, db: AsyncSession = Depends(get_session)):
    a = Ability(name=body.get("name", "Ability"))
    _set_ability_fields(a, body)
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return _ability_dict(a)


@router.put("/abilities/{ability_id}")
async def update_ability(ability_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404, "Ability not found")
    _set_ability_fields(a, body)
    await db.commit()
    await db.refresh(a)
    return _ability_dict(a)


@router.post("/abilities/{ability_id}/duplicate")
async def duplicate_ability(ability_id: int, db: AsyncSession = Depends(get_session)):
    src = await db.get(Ability, ability_id)
    if not src:
        raise HTTPException(404, "Ability not found")
    dup = Ability(
        name=f"Copy of {src.name}",
        description=src.description,
        session_id=src.session_id,
        icon=src.icon, color=src.color,
        flavor_text=src.flavor_text, notes=src.notes, tags=src.tags,
        ability_type=src.ability_type, target_type=src.target_type, aoe_radius=src.aoe_radius,
        damage_type=src.damage_type, custom_damage_type=src.custom_damage_type,
        mana_cost=src.mana_cost, hp_cost=src.hp_cost, cooldown_turns=src.cooldown_turns,
        requires_hit_roll=src.requires_hit_roll, hit_stat=src.hit_stat, damage_stat=src.damage_stat,
        damage_dice_count=src.damage_dice_count, damage_dice_type=src.damage_dice_type,
        is_passive=src.is_passive, passive_effect=src.passive_effect,
        effect=src.effect, range=src.range,
        # Rework v2: carry the pool flags on duplicate
        rarity=src.rarity,
        is_in_starting_pool=src.is_in_starting_pool,
        max_uses=src.max_uses,
        is_conditional=src.is_conditional,
        conditional_text=src.conditional_text,
    )
    db.add(dup)
    await db.commit()
    await db.refresh(dup)
    return _ability_dict(dup)


@router.delete("/abilities/{ability_id}")
async def delete_ability(ability_id: int, db: AsyncSession = Depends(get_session)):
    a = await db.get(Ability, ability_id)
    if not a:
        raise HTTPException(404)
    await db.delete(a)
    await db.commit()
    return {"ok": True}

