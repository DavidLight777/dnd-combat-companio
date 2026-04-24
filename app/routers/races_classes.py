"""Stage 6 — Races & Classes CRUD + seed data."""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Race, CharacterClass, RaceRankConfig

router = APIRouter(prefix="/api/races-classes", tags=["races-classes"])


# ── Pydantic schemas ─────────────────────────────────────────
class RaceBody(BaseModel):
    name: str
    description: str = ""
    session_id: int | None = None
    bonuses: list = []
    special_abilities: list = []
    is_available: bool = True
    # Rework v2: race defines the HP die rolled at creation + every level-up
    hp_die: int = 8
    hp_dice_count: int = 1


class ClassBody(BaseModel):
    name: str
    description: str = ""
    session_id: int | None = None
    bonuses: list = []
    special_abilities: list = []
    # Rework v3: `hit_die` dropped — professions never contributed to HP
    # rolls. Races own the HP die.
    is_available: bool = True


# ── Serializers ──────────────────────────────────────────────
def _ser_race(r: Race) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "description": r.description,
        "session_id": r.session_id,
        "bonuses": json.loads(r.bonuses) if r.bonuses else [],
        "special_abilities": json.loads(r.special_abilities) if r.special_abilities else [],
        "is_available": r.is_available,
        "hp_die": r.hp_die or 8,
        "hp_dice_count": r.hp_dice_count or 1,
    }


def _ser_class(c: CharacterClass) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "session_id": c.session_id,
        "bonuses": json.loads(c.bonuses) if c.bonuses else [],
        "special_abilities": json.loads(c.special_abilities) if c.special_abilities else [],
        "is_available": c.is_available,
    }


# ══════════════════════════════════════════════════════════════
# RACES CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/races")
async def list_races(session_id: int | None = None, db: AsyncSession = Depends(get_session)):
    q = select(Race)
    if session_id is not None:
        q = q.where((Race.session_id == session_id) | (Race.session_id == None))
    result = await db.execute(q.order_by(Race.name))
    return [_ser_race(r) for r in result.scalars().all()]


@router.get("/races/{race_id}")
async def get_race(race_id: int, db: AsyncSession = Depends(get_session)):
    r = await db.get(Race, race_id)
    if not r:
        raise HTTPException(404, "Race not found")
    return _ser_race(r)


@router.post("/races")
async def create_race(body: RaceBody, db: AsyncSession = Depends(get_session)):
    r = Race(
        name=body.name,
        description=body.description,
        session_id=body.session_id,
        bonuses=json.dumps(body.bonuses),
        special_abilities=json.dumps(body.special_abilities),
        is_available=body.is_available,
        hp_die=max(1, int(body.hp_die or 8)),
        hp_dice_count=max(1, int(body.hp_dice_count or 1)),
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _ser_race(r)


@router.put("/races/{race_id}")
async def update_race(race_id: int, body: RaceBody, db: AsyncSession = Depends(get_session)):
    r = await db.get(Race, race_id)
    if not r:
        raise HTTPException(404, "Race not found")
    r.name = body.name
    r.description = body.description
    r.session_id = body.session_id
    r.bonuses = json.dumps(body.bonuses)
    r.special_abilities = json.dumps(body.special_abilities)
    r.is_available = body.is_available
    r.hp_die = max(1, int(body.hp_die or 8))
    r.hp_dice_count = max(1, int(body.hp_dice_count or 1))
    await db.commit()
    await db.refresh(r)
    return _ser_race(r)


@router.delete("/races/{race_id}")
async def delete_race(race_id: int, db: AsyncSession = Depends(get_session)):
    r = await db.get(Race, race_id)
    if not r:
        raise HTTPException(404, "Race not found")
    await db.delete(r)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# CLASSES CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/classes")
async def list_classes(session_id: int | None = None, db: AsyncSession = Depends(get_session)):
    q = select(CharacterClass)
    if session_id is not None:
        q = q.where((CharacterClass.session_id == session_id) | (CharacterClass.session_id == None))
    result = await db.execute(q.order_by(CharacterClass.name))
    return [_ser_class(c) for c in result.scalars().all()]


@router.get("/classes/{class_id}")
async def get_class(class_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(CharacterClass, class_id)
    if not c:
        raise HTTPException(404, "Class not found")
    return _ser_class(c)


@router.post("/classes")
async def create_class(body: ClassBody, db: AsyncSession = Depends(get_session)):
    c = CharacterClass(
        name=body.name,
        description=body.description,
        session_id=body.session_id,
        bonuses=json.dumps(body.bonuses),
        special_abilities=json.dumps(body.special_abilities),
        is_available=body.is_available,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _ser_class(c)


@router.put("/classes/{class_id}")
async def update_class(class_id: int, body: ClassBody, db: AsyncSession = Depends(get_session)):
    c = await db.get(CharacterClass, class_id)
    if not c:
        raise HTTPException(404, "Class not found")
    c.name = body.name
    c.description = body.description
    c.session_id = body.session_id
    c.bonuses = json.dumps(body.bonuses)
    c.special_abilities = json.dumps(body.special_abilities)
    c.is_available = body.is_available
    await db.commit()
    await db.refresh(c)
    return _ser_class(c)


@router.delete("/classes/{class_id}")
async def delete_class(class_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(CharacterClass, class_id)
    if not c:
        raise HTTPException(404, "Class not found")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# SEED DATA
# ══════════════════════════════════════════════════════════════
# Rework v2: every seed race carries an HP die size. Chosen roughly in line
# with the flavor: small/nimble → d6, balanced → d8, tough/heavy → d10.
SEED_RACES = [
    {
        "name": "Human",
        "description": "Versatile and adaptable, humans excel in all areas.",
        "bonuses": [{"type": "stat_bonus", "stat": "strength", "value": 1}, {"type": "stat_bonus", "stat": "charisma", "value": 1}],
        "special_abilities": ["Versatility: +1 to two stats", "Extra skill proficiency"],
        "hp_die": 8, "hp_dice_count": 1,
    },
    {
        "name": "Elf",
        "description": "Graceful and long-lived, with keen senses and natural magic affinity.",
        "bonuses": [{"type": "stat_bonus", "stat": "dexterity", "value": 2}],
        "special_abilities": ["Darkvision (60 ft)", "Fey Ancestry: advantage vs charm", "Trance: 4 hours rest"],
        "hp_die": 6, "hp_dice_count": 1,
    },
    {
        "name": "Dwarf",
        "description": "Stout and hardy, skilled in craftsmanship and combat.",
        "bonuses": [{"type": "stat_bonus", "stat": "constitution", "value": 2}],
        "special_abilities": ["Darkvision (60 ft)", "Dwarven Resilience: poison resistance", "Stonecunning"],
        "hp_die": 10, "hp_dice_count": 1,
    },
    {
        "name": "Orc",
        "description": "Powerful and fierce, orcs are born warriors.",
        "bonuses": [{"type": "stat_bonus", "stat": "strength", "value": 2}, {"type": "stat_bonus", "stat": "constitution", "value": 1}],
        "special_abilities": ["Aggressive: bonus action dash toward enemy", "Relentless Endurance: drop to 1 HP instead of 0 (1/day)"],
        "hp_die": 10, "hp_dice_count": 1,
    },
    {
        "name": "Halfling",
        "description": "Small and nimble, with surprising bravery and luck.",
        "bonuses": [{"type": "stat_bonus", "stat": "dexterity", "value": 2}],
        "special_abilities": ["Lucky: reroll natural 1s", "Brave: advantage vs frightened", "Halfling Nimbleness"],
        "hp_die": 6, "hp_dice_count": 1,
    },
    {
        "name": "Tiefling",
        "description": "Bearing the blood of fiends, tieflings wield infernal powers.",
        "bonuses": [{"type": "stat_bonus", "stat": "charisma", "value": 2}, {"type": "stat_bonus", "stat": "intelligence", "value": 1}],
        "special_abilities": ["Darkvision (60 ft)", "Hellish Resistance: fire resistance", "Infernal Legacy: thaumaturgy cantrip"],
        "hp_die": 8, "hp_dice_count": 1,
    },
]

SEED_CLASSES = [
    {
        "name": "Warrior",
        "description": "Masters of martial combat, skilled with all weapons and armor.",
        "bonuses": [{"type": "stat_bonus", "stat": "strength", "value": 1}, {"type": "hp_bonus", "value": 5}],
        "special_abilities": ["Second Wind: heal 1d10+level (1/rest)", "Fighting Style choice", "Action Surge (1/rest)"],
    },
    {
        "name": "Mage",
        "description": "Arcane spellcasters who bend reality through study and intellect.",
        "bonuses": [{"type": "stat_bonus", "stat": "intelligence", "value": 2}],
        "special_abilities": ["Spellcasting (INT)", "Arcane Recovery", "School of Magic specialization"],
    },
    {
        "name": "Rogue",
        "description": "Cunning tricksters and deadly strikers from the shadows.",
        "bonuses": [{"type": "stat_bonus", "stat": "dexterity", "value": 1}, {"type": "initiative_bonus", "value": 2}],
        "special_abilities": ["Sneak Attack", "Cunning Action: dash/disengage/hide as bonus", "Expertise"],
    },
    {
        "name": "Cleric",
        "description": "Divine servants who channel the power of their deity to heal and protect.",
        "bonuses": [{"type": "stat_bonus", "stat": "wisdom", "value": 2}],
        "special_abilities": ["Spellcasting (WIS)", "Channel Divinity", "Divine Domain"],
    },
    {
        "name": "Ranger",
        "description": "Wilderness warriors who combine martial skill with nature magic.",
        "bonuses": [{"type": "stat_bonus", "stat": "dexterity", "value": 1}, {"type": "stat_bonus", "stat": "wisdom", "value": 1}],
        "special_abilities": ["Favored Enemy", "Natural Explorer", "Spellcasting (WIS)"],
    },
    {
        "name": "Paladin",
        "description": "Holy warriors who smite evil with divine power and righteous fury.",
        "bonuses": [{"type": "stat_bonus", "stat": "strength", "value": 1}, {"type": "stat_bonus", "stat": "charisma", "value": 1}],
        "special_abilities": ["Divine Smite", "Lay on Hands", "Aura of Protection"],
    },
]


@router.post("/seed")
async def seed_races_classes(db: AsyncSession = Depends(get_session)):
    """Seed default races and classes if none exist."""
    existing_races = (await db.execute(select(Race).where(Race.session_id == None))).scalars().all()
    existing_classes = (await db.execute(select(CharacterClass).where(CharacterClass.session_id == None))).scalars().all()

    races_added = 0
    classes_added = 0

    existing_race_names = {r.name for r in existing_races}
    for rd in SEED_RACES:
        if rd["name"] not in existing_race_names:
            db.add(Race(
                name=rd["name"],
                description=rd["description"],
                bonuses=json.dumps(rd["bonuses"]),
                special_abilities=json.dumps(rd["special_abilities"]),
                hp_die=int(rd.get("hp_die", 8)),
                hp_dice_count=int(rd.get("hp_dice_count", 1)),
            ))
            races_added += 1

    existing_class_names = {c.name for c in existing_classes}
    for cd in SEED_CLASSES:
        if cd["name"] not in existing_class_names:
            db.add(CharacterClass(
                name=cd["name"],
                description=cd["description"],
                bonuses=json.dumps(cd["bonuses"]),
                special_abilities=json.dumps(cd["special_abilities"]),
            ))
            classes_added += 1

    await db.commit()
    return {"races_added": races_added, "classes_added": classes_added}


# ══════════════════════════════════════════════════════════════
# RACE RANK CONFIGURATION SYSTEM
# ══════════════════════════════════════════════════════════════
class RaceRankConfigBody(BaseModel):
    rank: str
    rank_plus: int = 0
    physical_hp_die: int = 4
    physical_hp_dice_count: int = 1
    spiritual_hp_die: int = 4
    spiritual_hp_dice_count: int = 1
    mana_per_level: int = 2
    notes: str = ""


class CalculateHPBody(BaseModel):
    race_id: int
    rank: str
    rank_plus: int = 0
    level: int = 1


def _ser_rank_config(rc: RaceRankConfig) -> dict:
    return {
        "id": rc.id,
        "race_id": rc.race_id,
        "rank": rc.rank,
        "rank_plus": rc.rank_plus,
        "physical_hp_die": rc.physical_hp_die,
        "physical_hp_dice_count": rc.physical_hp_dice_count,
        "spiritual_hp_die": rc.spiritual_hp_die,
        "spiritual_hp_dice_count": rc.spiritual_hp_dice_count,
        "mana_per_level": rc.mana_per_level,
        "notes": rc.notes,
    }


@router.get("/races/{race_id}/rank-configs")
async def list_rank_configs(race_id: int, db: AsyncSession = Depends(get_session)):
    """Get all rank configurations for a race."""
    race = await db.get(Race, race_id)
    if not race:
        raise HTTPException(404, "Race not found")
    result = await db.execute(
        select(RaceRankConfig).where(RaceRankConfig.race_id == race_id).order_by(
            RaceRankConfig.rank, RaceRankConfig.rank_plus
        )
    )
    return [_ser_rank_config(rc) for rc in result.scalars().all()]


@router.post("/races/{race_id}/rank-configs")
async def create_rank_config(race_id: int, body: RaceRankConfigBody, db: AsyncSession = Depends(get_session)):
    """Create a new rank configuration for a race."""
    race = await db.get(Race, race_id)
    if not race:
        raise HTTPException(404, "Race not found")

    # Check for duplicate rank+plus combination
    existing = await db.execute(
        select(RaceRankConfig).where(
            (RaceRankConfig.race_id == race_id) &
            (RaceRankConfig.rank == body.rank) &
            (RaceRankConfig.rank_plus == body.rank_plus)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Rank config for {body.rank}+{body.rank_plus} already exists")

    rc = RaceRankConfig(
        race_id=race_id,
        rank=body.rank,
        rank_plus=max(0, min(5, body.rank_plus)),
        physical_hp_die=max(1, int(body.physical_hp_die or 4)),
        physical_hp_dice_count=max(1, int(body.physical_hp_dice_count or 1)),
        spiritual_hp_die=max(1, int(body.spiritual_hp_die or 4)),
        spiritual_hp_dice_count=max(1, int(body.spiritual_hp_dice_count or 1)),
        mana_per_level=max(0, int(body.mana_per_level or 2)),
        notes=body.notes,
    )
    db.add(rc)
    await db.commit()
    await db.refresh(rc)
    return _ser_rank_config(rc)


@router.put("/races/{race_id}/rank-configs/{config_id}")
async def update_rank_config(race_id: int, config_id: int, body: RaceRankConfigBody, db: AsyncSession = Depends(get_session)):
    """Update an existing rank configuration."""
    rc = await db.get(RaceRankConfig, config_id)
    if not rc or rc.race_id != race_id:
        raise HTTPException(404, "Rank config not found")

    # Check for duplicate if rank or rank_plus changed
    if rc.rank != body.rank or rc.rank_plus != body.rank_plus:
        existing = await db.execute(
            select(RaceRankConfig).where(
                (RaceRankConfig.race_id == race_id) &
                (RaceRankConfig.rank == body.rank) &
                (RaceRankConfig.rank_plus == body.rank_plus) &
                (RaceRankConfig.id != config_id)
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(409, f"Rank config for {body.rank}+{body.rank_plus} already exists")

    rc.rank = body.rank
    rc.rank_plus = max(0, min(5, body.rank_plus))
    rc.physical_hp_die = max(1, int(body.physical_hp_die or 4))
    rc.physical_hp_dice_count = max(1, int(body.physical_hp_dice_count or 1))
    rc.spiritual_hp_die = max(1, int(body.spiritual_hp_die or 4))
    rc.spiritual_hp_dice_count = max(1, int(body.spiritual_hp_dice_count or 1))
    rc.mana_per_level = max(0, int(body.mana_per_level or 2))
    rc.notes = body.notes
    await db.commit()
    await db.refresh(rc)
    return _ser_rank_config(rc)


@router.delete("/races/{race_id}/rank-configs/{config_id}")
async def delete_rank_config(race_id: int, config_id: int, db: AsyncSession = Depends(get_session)):
    """Delete a rank configuration."""
    rc = await db.get(RaceRankConfig, config_id)
    if not rc or rc.race_id != race_id:
        raise HTTPException(404, "Rank config not found")
    await db.delete(rc)
    await db.commit()
    return {"ok": True}


@router.post("/calculate-hp")
async def calculate_hp(body: CalculateHPBody, db: AsyncSession = Depends(get_session)):
    """Calculate HP and mana based on race rank config for a given level."""
    race = await db.get(Race, body.race_id)
    if not race:
        raise HTTPException(404, "Race not found")

    # Find matching rank config
    result = await db.execute(
        select(RaceRankConfig).where(
            (RaceRankConfig.race_id == body.race_id) &
            (RaceRankConfig.rank == body.rank) &
            (RaceRankConfig.rank_plus == body.rank_plus)
        )
    )
    rc = result.scalar_one_or_none()

    if not rc:
        # Fall back to base race hp_die values
        from app.game_mechanics import roll_dice
        max_hp = roll_dice(race.hp_dice_count, race.hp_die) * body.level
        mana_max = 10 + (body.level - 1) * 2
        return {
            "max_hp": max_hp,
            "mana_max": mana_max,
            "physical_hp_per_level": f"{race.hp_dice_count}d{race.hp_die}",
            "spiritual_hp_per_level": None,
            "mana_per_level": 2,
            "used_fallback": True,
        }

    # Calculate HP based on rank config
    from app.game_mechanics import roll_dice
    physical_hp_per_level = roll_dice(rc.physical_hp_dice_count, rc.physical_hp_die)
    spiritual_hp_per_level = roll_dice(rc.spiritual_hp_dice_count, rc.spiritual_hp_die)
    total_hp = (physical_hp_per_level + spiritual_hp_per_level) * body.level
    total_mana = 10 + rc.mana_per_level * (body.level - 1)

    return {
        "max_hp": total_hp,
        "mana_max": total_mana,
        "physical_hp_per_level": f"{rc.physical_hp_dice_count}d{rc.physical_hp_die}",
        "spiritual_hp_per_level": f"{rc.spiritual_hp_dice_count}d{rc.spiritual_hp_die}",
        "mana_per_level": rc.mana_per_level,
        "used_fallback": False,
    }
