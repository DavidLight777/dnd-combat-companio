from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character,
    CharacterWizardState,
)
from app.routers.wizard.common import _data, _ser, router


# GM helpers
# ══════════════════════════════════════════════════════════════
@router.get("/session/{session_id}/pending")
async def list_pending_approvals(session_id: int, db: AsyncSession = Depends(get_session)):
    """Characters in this session that have a proposed item awaiting GM approval.
    Includes characters whose wizard is already completed (player entered the
    game but the item is still pending).
    """
    q = await db.execute(
        select(CharacterWizardState).where(CharacterWizardState.session_id == session_id)
    )
    items = []
    for ws in q.scalars().all():
        data = _data(ws)
        if "proposed_item" not in data:
            continue
        if data.get("gm_approved"):
            continue
        char = await db.get(Character, ws.character_id)
        items.append({
            "character_id": ws.character_id,
            "character_name": char.name if char else "?",
            "starting_roll": data.get("starting_roll"),
            "proposed_item": data["proposed_item"],
            "wizard_completed": bool(ws.is_completed),
            "state": _ser(ws),
        })
    return items
