import random
import secrets
import string
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Session, Character
from app.schemas import SessionCreate, SessionJoin, SessionCreated, SessionJoined, SessionOut

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

WORD_POOL = [
    "WOLF", "HAWK", "BEAR", "LION", "RAVEN", "STORM", "BLADE", "FIRE",
    "IRON", "BONE", "DARK", "MIST", "CLAW", "FANG", "DUSK", "DAWN",
    "VALE", "PEAK", "DEEP", "WILD", "GRIM", "SAGE", "FELL", "WRATH",
]


def _generate_code() -> str:
    word = random.choice(WORD_POOL)
    nums = "".join(random.choices(string.digits, k=4))
    return f"{word}-{nums}"


# ── Create session ───────────────────────────────────────────
@router.post("/create", response_model=SessionCreated)
async def create_session(body: SessionCreate, db: AsyncSession = Depends(get_session)):
    # Generate unique code
    for _ in range(20):
        code = _generate_code()
        existing = await db.execute(select(Session).where(Session.code == code))
        if not existing.scalar_one_or_none():
            break
    else:
        raise HTTPException(500, "Could not generate unique session code")

    gm_token = secrets.token_hex(16)
    session = Session(code=code, name=body.name, gm_token=gm_token)
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return SessionCreated(session_code=code, gm_token=gm_token, session_id=session.id)


# ── Join session ─────────────────────────────────────────────
@router.post("/join", response_model=SessionJoined)
async def join_session(body: SessionJoin, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == body.session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if session.status == "ended":
        raise HTTPException(400, "Session has ended")

    # Check player limit
    chars = await db.execute(
        select(Character).where(Character.session_id == session.id, Character.is_npc == False)
    )
    player_count = len(chars.scalars().all())
    if player_count >= 10:
        raise HTTPException(400, "Session is full (max 10 players)")

    # Create character for player
    player_token = secrets.token_hex(16)
    character = Character(
        session_id=session.id,
        player_token=player_token,
        name=body.player_name,
        current_hp=20,
        max_hp=20,
    )
    db.add(character)
    await db.commit()
    await db.refresh(character)

    return SessionJoined(
        player_token=player_token,
        character_id=character.id,
        session_code=body.session_code,
    )


# ── Get session info ─────────────────────────────────────────
@router.get("/{code}", response_model=SessionOut)
async def get_session_info(code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    chars = await db.execute(
        select(Character).where(Character.session_id == session.id, Character.is_npc == False)
    )
    player_count = len(chars.scalars().all())

    return SessionOut(
        id=session.id, code=session.code, name=session.name,
        status=session.status, turn_number=session.turn_number,
        player_count=player_count,
    )


# ── List characters in session ───────────────────────────────
@router.get("/{code}/characters")
async def list_session_characters(code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    chars_result = await db.execute(
        select(Character).where(Character.session_id == session.id)
    )
    chars = chars_result.scalars().all()

    return [
        {
            "id": c.id,
            "name": c.name,
            "is_npc": c.is_npc,
            "current_hp": c.current_hp,
            "max_hp": c.max_hp,
            "armor_class": c.armor_class,
            "is_alive": c.is_alive,
            "token_color": c.token_color,
            "status_effects": c.status_effects,
        }
        for c in chars
    ]


# ── Update session status (GM only) ─────────────────────────
@router.patch("/{code}/status")
async def update_session_status(code: str, body: dict, db: AsyncSession = Depends(get_session)):
    gm_token = body.get("gm_token")
    new_status = body.get("status")
    if not gm_token or not new_status:
        raise HTTPException(400, "gm_token and status required")

    result = await db.execute(select(Session).where(Session.code == code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if session.gm_token != gm_token:
        raise HTTPException(403, "Invalid GM token")

    session.status = new_status
    await db.commit()
    return {"status": session.status}
