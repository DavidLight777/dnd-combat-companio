import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import AchievementTemplate, Character, CharacterAchievement, Session
from app.websocket_manager import manager

router = APIRouter(prefix="/api/achievements", tags=["achievements"])


class AchievementTemplateBody(BaseModel):
    session_id: int | None = None
    name: str
    description: str = ""
    icon: str = "🏆"
    effects: list = []
    is_available: bool = True


class GrantAchievementBody(BaseModel):
    character_id: int
    template_id: int | None = None
    name: str | None = None
    description: str = ""
    icon: str = "🏆"
    effects: list = []
    granted_by: str | None = None


def _ser_template(t: AchievementTemplate) -> dict:
    return {
        "id": t.id,
        "session_id": t.session_id,
        "name": t.name,
        "description": t.description,
        "icon": t.icon,
        "effects": json.loads(t.effects or "[]"),
        "is_available": t.is_available,
    }


def _ser_grant(a: CharacterAchievement) -> dict:
    return {
        "id": a.id,
        "character_id": a.character_id,
        "template_id": a.template_id,
        "name": a.name,
        "description": a.description,
        "icon": a.icon,
        "effects": json.loads(a.effects or "[]"),
        "granted_by": a.granted_by,
        "granted_at": a.granted_at.isoformat() if a.granted_at else None,
        "is_active": a.is_active,
    }


@router.get("/templates")
async def list_templates(session_id: int | None = None, db: AsyncSession = Depends(get_session)):
    q = select(AchievementTemplate)
    if session_id is not None:
        q = q.where((AchievementTemplate.session_id == session_id) | (AchievementTemplate.session_id.is_(None)))
    q = q.order_by(AchievementTemplate.name)
    res = await db.execute(q)
    return [_ser_template(t) for t in res.scalars().all()]


@router.post("/templates")
async def create_template(body: AchievementTemplateBody, db: AsyncSession = Depends(get_session)):
    t = AchievementTemplate(
        session_id=body.session_id,
        name=body.name,
        description=body.description,
        icon=body.icon,
        effects=json.dumps(body.effects or []),
        is_available=body.is_available,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _ser_template(t)


@router.get("/characters/{character_id}")
async def list_character_achievements(character_id: int, db: AsyncSession = Depends(get_session)):
    res = await db.execute(
        select(CharacterAchievement)
        .where(CharacterAchievement.character_id == character_id)
        .order_by(CharacterAchievement.granted_at.desc())
    )
    return [_ser_grant(a) for a in res.scalars().all()]


@router.post("/grant")
async def grant_achievement(body: GrantAchievementBody, db: AsyncSession = Depends(get_session)):
    char = await db.get(Character, body.character_id)
    if not char:
        raise HTTPException(404, "Character not found")
    template = await db.get(AchievementTemplate, body.template_id) if body.template_id else None
    name = body.name or (template.name if template else None)
    if not name:
        raise HTTPException(400, "name or template_id required")
    a = CharacterAchievement(
        character_id=char.id,
        template_id=template.id if template else None,
        name=name,
        description=body.description or (template.description if template else ""),
        icon=body.icon or (template.icon if template else "🏆"),
        effects=json.dumps(body.effects or (json.loads(template.effects or "[]") if template else [])),
        granted_by=body.granted_by,
        granted_at=datetime.now(UTC),
        is_active=True,
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    try:
        sess = await db.get(Session, char.session_id)
        if sess:
            await manager.broadcast_to_session(sess.code, "achievement.granted", _ser_grant(a))
    except Exception:
        pass
    return _ser_grant(a)


@router.delete("/characters/{character_id}/{achievement_id}")
async def remove_character_achievement(character_id: int, achievement_id: int, db: AsyncSession = Depends(get_session)):
    a = await db.get(CharacterAchievement, achievement_id)
    if not a or a.character_id != character_id:
        raise HTTPException(404, "Achievement not found")
    await db.delete(a)
    await db.commit()
    return {"ok": True}
