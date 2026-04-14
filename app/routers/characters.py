"""Character CRUD and stat management — session-aware version."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Session, Character, CharacterEffect, StatModifier,
    AttackModifier, DamageModifier, TurnTimer,
)
from app.schemas import CharacterCreate, CharacterUpdate, HpPatch, ModifierCreate, EffectCreate, TimerCreate

router = APIRouter(prefix="/api", tags=["characters"])


# ── Helper: serialize character ──────────────────────────────
def _serialize_char(c: Character) -> dict:
    return {
        "id": c.id,
        "session_id": c.session_id,
        "name": c.name,
        "is_npc": c.is_npc,
        "armor_class": c.armor_class,
        "current_hp": c.current_hp,
        "max_hp": c.max_hp,
        "strength": c.strength,
        "dexterity": c.dexterity,
        "constitution": c.constitution,
        "intelligence": c.intelligence,
        "wisdom": c.wisdom,
        "charisma": c.charisma,
        "hp_dice_count": c.hp_dice_count,
        "hp_dice_type": c.hp_dice_type,
        "hp_recovery_modifier": c.hp_recovery_modifier,
        "initiative_bonus": c.initiative_bonus,
        "token_color": c.token_color,
        "is_alive": c.is_alive,
        "gold": c.gold,
        "gold_copper": c.gold_copper,
        "can_edit_own_items": c.can_edit_own_items,
        "turn_count": c.turn_count,
        "status_effects": c.status_effects,
        "notes": c.notes,
        "effects": [
            {"id": e.id, "name": e.name, "effect_type": e.effect_type,
             "value": e.value, "is_active": e.is_active}
            for e in c.effects
        ],
        "stat_modifiers": [
            {"id": m.id, "stat_name": m.stat_name, "name": m.name,
             "value": m.value, "is_active": m.is_active}
            for m in c.stat_modifiers
        ],
        "attack_modifiers": [
            {"id": m.id, "name": m.name, "value": m.value, "is_active": m.is_active}
            for m in c.attack_modifiers
        ],
        "damage_modifiers": [
            {"id": m.id, "name": m.name, "value": m.value, "is_active": m.is_active}
            for m in c.damage_modifiers
        ],
        "turn_timers": [
            {"id": t.id, "name": t.name, "initial_value": t.initial_value,
             "current_value": t.current_value, "is_active": t.is_active}
            for t in c.turn_timers
        ],
    }


# ── Get character ────────────────────────────────────────────
@router.get("/characters/{char_id}")
async def get_character(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    return _serialize_char(c)


# ── Update character ─────────────────────────────────────────
@router.put("/characters/{char_id}")
async def update_character(char_id: int, body: CharacterUpdate, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(c, field, val)
    await db.commit()
    await db.refresh(c)
    return _serialize_char(c)


# ── HP patch ─────────────────────────────────────────────────
@router.patch("/characters/{char_id}/hp")
async def patch_hp(char_id: int, body: HpPatch, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    if body.set is not None:
        c.current_hp = max(0, min(body.set, c.max_hp))
    elif body.delta is not None:
        c.current_hp = max(0, min(c.current_hp + body.delta, c.max_hp))
    c.is_alive = c.current_hp > 0
    await db.commit()
    await db.refresh(c)
    return {"current_hp": c.current_hp, "max_hp": c.max_hp, "is_alive": c.is_alive}


# ── Create NPC (GM) ─────────────────────────────────────────
@router.post("/sessions/{code}/npc")
async def create_npc(code: str, body: CharacterCreate, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    npc = Character(
        session_id=session.id,
        name=body.name,
        is_npc=True,
        is_gm_controlled=True,
        armor_class=body.armor_class,
        current_hp=body.max_hp,
        max_hp=body.max_hp,
    )
    db.add(npc)
    await db.commit()
    await db.refresh(npc)
    return _serialize_char(npc)


# ── Delete character ─────────────────────────────────────────
@router.delete("/characters/{char_id}")
async def delete_character(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# MODIFIERS
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{char_id}/modifiers")
async def add_modifier(char_id: int, body: ModifierCreate, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404)
    if body.modifier_type == "stat":
        m = StatModifier(character_id=char_id, stat_name=body.stat_name or "strength", name=body.name, value=body.value)
    elif body.modifier_type == "attack":
        m = AttackModifier(character_id=char_id, name=body.name, value=body.value)
    elif body.modifier_type == "damage":
        m = DamageModifier(character_id=char_id, name=body.name, value=body.value)
    else:
        raise HTTPException(400, "Invalid modifier_type")
    db.add(m)
    await db.commit()
    return {"ok": True}


@router.put("/modifiers/{mod_id}")
async def update_modifier(mod_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    mod_type = body.pop("type", None) or body.pop("modifier_type", "attack")
    table = {"stat": StatModifier, "attack": AttackModifier, "damage": DamageModifier}
    cls = table.get(mod_type)
    if not cls:
        raise HTTPException(400)
    m = await db.get(cls, mod_id)
    if not m:
        raise HTTPException(404)
    for k, v in body.items():
        if hasattr(m, k):
            setattr(m, k, v)
    await db.commit()
    await db.refresh(m)
    return {"ok": True}


@router.delete("/modifiers/{mod_id}")
async def delete_modifier(mod_id: int, type: str = "attack", db: AsyncSession = Depends(get_session)):
    table = {"stat": StatModifier, "attack": AttackModifier, "damage": DamageModifier}
    cls = table.get(type)
    if not cls:
        raise HTTPException(400)
    m = await db.get(cls, mod_id)
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# EFFECTS
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{char_id}/effects")
async def add_effect(char_id: int, body: EffectCreate, db: AsyncSession = Depends(get_session)):
    e = CharacterEffect(character_id=char_id, name=body.name, effect_type=body.effect_type, value=body.value)
    db.add(e)
    await db.commit()
    return {"ok": True}


@router.put("/effects/{eff_id}")
async def update_effect(eff_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await db.get(CharacterEffect, eff_id)
    if not e:
        raise HTTPException(404)
    for k, v in body.items():
        if hasattr(e, k):
            setattr(e, k, v)
    await db.commit()
    return {"ok": True}


@router.delete("/effects/{eff_id}")
async def delete_effect(eff_id: int, db: AsyncSession = Depends(get_session)):
    e = await db.get(CharacterEffect, eff_id)
    if not e:
        raise HTTPException(404)
    await db.delete(e)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# TURN TIMERS
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{char_id}/timers")
async def add_timer(char_id: int, body: TimerCreate, db: AsyncSession = Depends(get_session)):
    t = TurnTimer(character_id=char_id, name=body.name, initial_value=body.initial_value, current_value=body.initial_value)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "name": t.name, "initial_value": t.initial_value, "current_value": t.current_value, "is_active": t.is_active}


@router.put("/timers/{timer_id}")
async def update_timer(timer_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    t = await db.get(TurnTimer, timer_id)
    if not t:
        raise HTTPException(404)
    for k, v in body.items():
        if hasattr(t, k):
            setattr(t, k, v)
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "name": t.name, "initial_value": t.initial_value, "current_value": t.current_value, "is_active": t.is_active}


@router.delete("/timers/{timer_id}")
async def delete_timer(timer_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(TurnTimer, timer_id)
    if not t:
        raise HTTPException(404)
    await db.delete(t)
    await db.commit()
    return {"ok": True}


# ── Advance turn ─────────────────────────────────────────────
@router.post("/characters/{char_id}/advance-turn")
async def advance_turn(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404)
    c.turn_count = (c.turn_count or 0) + 1
    # Decrement active timers
    for t in c.turn_timers:
        if t.is_active and t.current_value > 0:
            t.current_value -= 1
    await db.commit()
    await db.refresh(c)
    return _serialize_char(c)


@router.post("/characters/{char_id}/reset-turns")
async def reset_turns(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404)
    c.turn_count = 0
    await db.commit()
    await db.refresh(c)
    return _serialize_char(c)
