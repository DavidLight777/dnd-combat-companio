from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    CharacterWizardState,
)
from app.routers.wizard.common import _ensure_state, _ser, router


# ══════════════════════════════════════════════════════════════
@router.get("/{char_id}")
async def get_wizard(char_id: int, db: AsyncSession = Depends(get_session)):
    """Return wizard state; auto-creates if the character exists but has none yet."""
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


# ══════════════════════════════════════════════════════════════
