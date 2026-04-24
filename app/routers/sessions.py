import json
import random
import secrets
import string
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Session, Character, CombatLog, InventoryItem, Item, Race, StatModifier, CharacterWizardState, CharacterAbility
from app.websocket_manager import manager
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

    # Rework v2: create character with level-0 baseline.
    # Stats start at 1 (decline in wizard Step 4 will zero them out).
    # HP/AC are 0 and will be computed during wizard finalize (Step 6).
    # Mana defaults to 10 from the model.
    player_token = secrets.token_hex(16)
    character = Character(
        session_id=session.id,
        player_token=player_token,
        name=body.player_name,
        current_hp=0,
        max_hp=0,
        armor_class=0,
        race_id=body.race_id,
        age=body.age,
        gender=body.gender,
        strength=1, dexterity=1, constitution=1,
        intelligence=1, wisdom=1, charisma=1,
        level=0,
        experience=0,
        declined_stats=False,
        # slot cap is finalized in wizard Step 6; use the default until then
        max_inventory_slots=12,
    )
    db.add(character)
    await db.flush()

    # Rework v2: atomically open the 6-step creation wizard.
    wizard = CharacterWizardState(
        character_id=character.id,
        session_id=session.id,
        current_step=1,
        is_completed=False,
        data="{}",
        gm_approved=False,
    )
    db.add(wizard)

    # Apply race bonuses (stat_bonus / hp_bonus / initiative_bonus) as locked
    # stat modifiers. Race bonuses stay even if the player declines stats —
    # that was explicitly confirmed (Q1 in REWORK_PLAN.md).
    hp_bonus = 0
    initiative_bonus = 0
    if body.race_id:
        race = await db.get(Race, body.race_id)
        if race:
            bonuses = json.loads(race.bonuses) if race.bonuses else []
            for b in bonuses:
                btype = b.get("type", "")
                if btype == "stat_bonus":
                    stat = b.get("stat", "")
                    val = int(b.get("value", 0))
                    if stat and val:
                        db.add(StatModifier(
                            character_id=character.id,
                            stat_name=stat,
                            name=f"{race.name} (race)",
                            value=val,
                            source="race",
                        ))
                elif btype == "hp_bonus":
                    hp_bonus += int(b.get("value", 0))
                elif btype == "initiative_bonus":
                    initiative_bonus += int(b.get("value", 0))

    # HP bonus is stored for later — the actual HP roll happens in finalize.
    # We still stash it now so finalize can read it. Simplest: precompute max_hp
    # deltas on the character now; finalize will add the race die roll on top.
    if hp_bonus:
        character.max_hp += hp_bonus
        character.current_hp += hp_bonus
    if initiative_bonus:
        character.initiative_bonus += initiative_bonus

    await db.commit()
    await db.refresh(character)

    return SessionJoined(
        player_token=player_token,
        character_id=character.id,
        session_code=body.session_code,
    )


# ── Session History (must be before /{code} to avoid route conflict) ──
@router.get("/history")
async def session_history(db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).order_by(Session.created_at.desc()))
    sessions = result.scalars().all()
    return [
        {
            "id": s.id, "code": s.code, "name": s.name,
            "status": s.status, "turn_number": s.turn_number,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "player_count": len([c for c in s.characters if not c.is_npc]),
        }
        for s in sessions
    ]


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

    # FIX 1: compute which NPCs are merchants (have at least one shop entry)
    from app.models import NpcShopInventory
    npc_ids = [c.id for c in chars if c.is_npc]
    merchant_ids: set[int] = set()
    if npc_ids:
        shop_res = await db.execute(
            select(NpcShopInventory.npc_id).where(NpcShopInventory.npc_id.in_(npc_ids))
        )
        merchant_ids = {row[0] for row in shop_res.all()}

    return [
        {
            "id": c.id,
            "name": c.name,
            "is_npc": c.is_npc,
            "is_gm_controlled": c.is_gm_controlled,
            "is_merchant": c.id in merchant_ids,
            "current_hp": c.current_hp,
            "max_hp": c.max_hp,
            "armor_class": c.armor_class,
            "is_alive": c.is_alive,
            "token_color": c.token_color,
            "status_effects": c.status_effects,
            "place_at_table": c.place_at_table,
            "is_at_table": c.place_at_table,  # alias
            "show_hp_to_players": c.show_hp_to_players,
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


# ── Update session XP threshold config (GM only) ────────────
@router.patch("/{code}/xp-config")
async def update_xp_threshold_config(code: str, body: dict, db: AsyncSession = Depends(get_session)):
    gm_token = body.get("gm_token")
    config = body.get("config")
    if not gm_token:
        raise HTTPException(400, "gm_token required")
    result = await db.execute(select(Session).where(Session.code == code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    if session.gm_token != gm_token:
        raise HTTPException(403, "Invalid GM token")
    session.xp_threshold_config = json.dumps(config) if isinstance(config, (dict, list)) else str(config) if config else None
    await db.commit()
    return {"ok": True, "xp_threshold_config": session.xp_threshold_config}


# ── Full Rest (GM-only long-rest for all living players) ─────
@router.post("/{code}/full-rest")
async def full_rest(code: str, db: AsyncSession = Depends(get_session)):
    """Rework v3: restore HP, mana, cooldowns, and use-counters for every
    living player character in the session. NPCs are untouched.

    Returns a summary of how many characters were affected.
    """
    result = await db.execute(select(Session).where(Session.code == code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    chars_q = await db.execute(
        select(Character).where(
            Character.session_id == session.id,
            Character.is_npc == False,        # noqa: E712
            Character.is_alive == True,       # noqa: E712
        )
    )
    chars = chars_q.scalars().all()

    healed = 0
    for c in chars:
        c.current_hp = c.max_hp or 0
        c.mana_current = c.mana_max or 0
        # Reset cooldowns and per-day uses on every assigned ability.
        ca_q = await db.execute(
            select(CharacterAbility).where(CharacterAbility.character_id == c.id)
        )
        for ca in ca_q.scalars().all():
            ca.cooldown_remaining = 0
            if ca.current_uses is not None and ca.ability is not None:
                ca.current_uses = ca.ability.max_uses
        healed += 1

    await db.commit()

    # Broadcast so every connected client refreshes their state.
    try:
        await manager.broadcast_to_session(session.code, "session.full_rest", {
            "healed_count": healed,
        })
    except Exception:
        pass

    return {"ok": True, "healed_count": healed}


# ── Export session as JSON ───────────────────────────────────
@router.get("/{code}/export")
async def export_session(code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    chars_result = await db.execute(select(Character).where(Character.session_id == session.id))
    chars = chars_result.scalars().all()

    characters_data = []
    for c in chars:
        inv_result = await db.execute(select(InventoryItem).where(InventoryItem.character_id == c.id))
        inv_entries = inv_result.scalars().all()
        items = []
        for ie in inv_entries:
            item = await db.get(Item, ie.item_id)
            if item:
                items.append({
                    "name": item.name, "category": item.category, "rarity": item.rarity,
                    "quantity": ie.quantity, "is_equipped": ie.is_equipped,
                })

        characters_data.append({
            "name": c.name, "is_npc": c.is_npc,
            "current_hp": c.current_hp, "max_hp": c.max_hp,
            "armor_class": c.armor_class, "gold": c.gold,
            "strength": c.strength, "dexterity": c.dexterity, "constitution": c.constitution,
            "intelligence": c.intelligence, "wisdom": c.wisdom, "charisma": c.charisma,
            "is_alive": c.is_alive, "turn_count": c.turn_count,
            "status_effects": json.loads(c.status_effects) if c.status_effects else [],
            "inventory": items,
        })

    log_result = await db.execute(
        select(CombatLog).where(CombatLog.session_id == session.id).order_by(CombatLog.timestamp)
    )
    logs = log_result.scalars().all()
    log_data = [
        {
            "event_type": l.event_type, "description": l.description,
            "timestamp": l.timestamp.isoformat() if l.timestamp else None,
        }
        for l in logs
    ]

    export = {
        "session_code": session.code, "session_name": session.name,
        "status": session.status, "turn_number": session.turn_number,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "characters": characters_data,
        "combat_log": log_data,
    }

    return JSONResponse(content=export, headers={
        "Content-Disposition": f'attachment; filename="session_{session.code}.json"'
    })
