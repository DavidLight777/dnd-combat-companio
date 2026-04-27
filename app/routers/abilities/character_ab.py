"""Character abilities management."""
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Ability, AbilityLevelConfig, AbilityRankConfig, Character, CharacterAbility, Session
from app.routers.abilities.common import _ability_dict, router
from app.routers.abilities.passive import (
    _apply_passive_bonuses,
    _apply_resolved_passive_bonuses,
    _remove_passive_bonuses,
)
from app.routers.abilities.resolve import _resolve_ability


@router.get("/characters/{char_id}/abilities")
async def get_character_abilities(char_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CharacterAbility).where(CharacterAbility.character_id == char_id)
    )
    cas = result.scalars().all()
    if not cas:
        return []

    # Batch-load rank/level configs to avoid async lazy-load issues
    ability_ids = [ca.ability_id for ca in cas]
    lc_result = await db.execute(
        select(AbilityLevelConfig).where(AbilityLevelConfig.ability_id.in_(ability_ids))
    )
    rc_result = await db.execute(
        select(AbilityRankConfig).where(AbilityRankConfig.ability_id.in_(ability_ids))
    )
    lc_map = {}
    for lc in lc_result.scalars().all():
        lc_map.setdefault(lc.ability_id, []).append(lc)
    rc_map = {}
    for rc in rc_result.scalars().all():
        rc_map.setdefault(rc.ability_id, []).append(rc)

    out = []
    for ca in cas:
        # Rework: resolve ability with level + rank configs applied
        d = _resolve_ability(
            ca.ability,
            ca.ability_level or 0,
            ca.ability_rank or "common",
            level_configs=lc_map.get(ca.ability_id, []),
            rank_configs=rc_map.get(ca.ability_id, []),
        )
        d["character_ability_id"] = ca.id
        d["is_unlocked"] = ca.is_unlocked
        d["cooldown_remaining"] = ca.cooldown_remaining
        # Rework v2: uses counter + provenance
        d["current_uses"] = ca.current_uses
        d["granted_from"] = ca.granted_from
        d["ability_level"] = ca.ability_level or 0
        d["ability_rank"] = ca.ability_rank or "common"
        out.append(d)
    return out


@router.post("/characters/{char_id}/abilities")
async def assign_ability(char_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    ability_id = body.get("ability_id")
    if not ability_id:
        raise HTTPException(400, "ability_id required")
    ability = await db.get(Ability, ability_id)
    if not ability:
        raise HTTPException(404, "Ability not found")
    # Check if already assigned
    existing = await db.execute(
        select(CharacterAbility).where(
            CharacterAbility.character_id == char_id,
            CharacterAbility.ability_id == ability_id,
        )
    )
    if existing.scalars().first():
        raise HTTPException(400, "Ability already assigned")
    ca = CharacterAbility(
        character_id=char_id,
        ability_id=ability_id,
        is_unlocked=body.get("is_unlocked", True),
        # Rework v2: mirror the template's max_uses on grant
        current_uses=ability.max_uses,
        granted_from=body.get("granted_from", "gm"),
    )
    db.add(ca)
    # Auto-apply passive bonuses
    if ability.is_passive and ca.is_unlocked:
        await _apply_passive_bonuses(char_id, ability, db)
    await db.commit()
    await db.refresh(ca)
    d = _ability_dict(ca.ability)
    d["character_ability_id"] = ca.id
    d["is_unlocked"] = ca.is_unlocked
    d["cooldown_remaining"] = ca.cooldown_remaining
    d["current_uses"] = ca.current_uses
    d["granted_from"] = ca.granted_from
    return d


@router.delete("/character-abilities/{ca_id}")
async def unassign_ability(ca_id: int, db: AsyncSession = Depends(get_session)):
    ca = await db.get(CharacterAbility, ca_id)
    if not ca:
        raise HTTPException(404)
    ability = ca.ability
    # Remove passive bonuses
    if ability and ability.is_passive:
        await _remove_passive_bonuses(ca.character_id, ability, db)
    await db.delete(ca)
    await db.commit()
    return {"ok": True}

@router.post("/characters/{char_id}/abilities/{char_ability_id}/promote-rank")
async def promote_ability_rank(char_id: int, char_ability_id: int, body: dict | None = None, db: AsyncSession = Depends(get_session)):
    """GM manually promotes an ability's rank (e.g. common → uncommon)."""
    from app.game_mechanics import RANK_ORDER
    ca = await db.get(CharacterAbility, char_ability_id)
    if not ca or ca.character_id != char_id:
        raise HTTPException(404, "Ability not found on this character")

    # Load rank/level configs explicitly to avoid async lazy-load issues
    lc_result = await db.execute(
        select(AbilityLevelConfig).where(AbilityLevelConfig.ability_id == ca.ability_id)
    )
    rc_result = await db.execute(
        select(AbilityRankConfig).where(AbilityRankConfig.ability_id == ca.ability_id)
    )
    level_configs = lc_result.scalars().all()
    rank_configs = rc_result.scalars().all()

    cur_rank = (ca.ability_rank or "common").lower()
    try:
        idx = RANK_ORDER.index(cur_rank)
    except ValueError:
        raise HTTPException(400, "Invalid current rank")

    if idx + 1 >= len(RANK_ORDER):
        raise HTTPException(400, "Already at maximum rank (divine)")

    ca.ability_rank = RANK_ORDER[idx + 1]
    # Rework: reapply passive bonuses from resolved rank config
    try:
        await _remove_passive_bonuses(char_id, ca.ability, db)
        resolved = _resolve_ability(
            ca.ability,
            ca.ability_level or 0,
            ca.ability_rank,
            level_configs=level_configs,
            rank_configs=rank_configs,
        )
        await _apply_resolved_passive_bonuses(char_id, resolved, db)
    except Exception:
        pass  # Non-fatal — bonuses are best-effort
    await db.commit()
    await db.refresh(ca)

    # WS broadcast
    try:
        from app.websocket_manager import manager as _ws
        sess = await db.get(Session, ca.character_id)
        if sess:
            await _ws.broadcast_to_session(sess.code, "ability.rank_promoted", {
                "character_id": char_id,
                "ability_id": ca.ability_id,
                "ability_name": ca.ability.name if ca.ability else "Unknown",
                "new_rank": ca.ability_rank,
            })
    except Exception:
        pass

    return {
        "ok": True,
        "character_id": char_id,
        "ability_id": ca.ability_id,
        "ability_rank": ca.ability_rank,
        "ability_level": ca.ability_level,
    }
