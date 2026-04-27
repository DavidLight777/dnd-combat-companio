"""Defense resolution."""
from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Character
from app.routers.combat_events.common import (
    router,
)


class ResolveDefenseBody(BaseModel):
    mode: str  # "ac" | "dodge_dex" | "dodge_con"
    dice_count: int = 1          # for dodge_dex / dodge_con: how many d20 to roll
    advantage: str = "normal"    # "normal" | "advantage" | "disadvantage"

@router.post("/defense/{pending_id}/resolve")
async def resolve_defense(pending_id: str, body: ResolveDefenseBody, db: AsyncSession = Depends(get_session)):
    """Resolve a pending defense: target chooses AC, dodge (DEX), or brace (CON)."""
    from app.defense_reactions import (
        apply_ability_damage_on_failed_defense,
        get_pending_defense,
        resolve_pending_defense,
    )

    pd = get_pending_defense(pending_id)
    if not pd:
        raise HTTPException(404, "Pending defense not found")
    if pd.resolved:
        raise HTTPException(400, "Defense already resolved")

    target = await db.get(Character, pd.target_id)
    if not target:
        raise HTTPException(404, "Target character not found")

    target_stats = {
        "armor_class": target.armor_class,
        "dexterity": target.dexterity,
        "constitution": target.constitution,
    }

    result = await resolve_pending_defense(
        pending_id,
        body.mode,
        target_stats=target_stats,
        dice_count=body.dice_count,
        advantage_mode=body.advantage,
    )
    if not result:
        raise HTTPException(400, "Could not resolve defense")

    # If this originated from an ability and defense failed, apply deferred damage
    if not result.get("success") and pd.ability_context:
        dmg_res = await apply_ability_damage_on_failed_defense(pd, db)
        if dmg_res:
            result["ability_damage"] = dmg_res

    return result

