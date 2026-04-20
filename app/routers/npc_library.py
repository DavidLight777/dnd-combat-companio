"""Stage 7 — NPC Library: Folders, Templates, Events, Spawn."""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    NpcFolder, NpcTemplate, EventTemplate, Character,
    InventoryItem, NpcShopInventory, Session,
)

router = APIRouter(prefix="/api/npc-library", tags=["npc-library"])


# ── Pydantic schemas ─────────────────────────────────────────
class FolderBody(BaseModel):
    session_id: int
    name: str
    color: str = "#888888"
    parent_folder_id: int | None = None


class TemplateBody(BaseModel):
    session_id: int
    folder_id: int | None = None
    name: str
    description: str = ""
    is_merchant: bool = False
    max_hp: int = 20
    armor_class: int = 10
    strength: int = 10
    dexterity: int = 10
    constitution: int = 10
    intelligence: int = 10
    wisdom: int = 10
    charisma: int = 10
    initiative_bonus: int = 0
    token_color: str = "#e05252"
    default_equipment: list = []
    shop_items: list = []
    notes: str = ""


class EventBody(BaseModel):
    session_id: int
    name: str
    description: str = ""
    npc_template_ids: list = []  # [{template_id, count}]
    folder_id: int | None = None


class SpawnBody(BaseModel):
    session_id: int
    count: int = 1


# ── Serializers ──────────────────────────────────────────────
def _ser_folder_simple(f: NpcFolder) -> dict:
    return {
        "id": f.id,
        "session_id": f.session_id,
        "name": f.name,
        "color": f.color,
        "parent_folder_id": f.parent_folder_id,
        "children": [],
        "template_count": 0,
    }


def _ser_folder_flat(f: NpcFolder, template_counts: dict, children_map: dict) -> dict:
    child_folders = children_map.get(f.id, [])
    return {
        "id": f.id,
        "session_id": f.session_id,
        "name": f.name,
        "color": f.color,
        "parent_folder_id": f.parent_folder_id,
        "children": [_ser_folder_flat(c, template_counts, children_map) for c in child_folders],
        "template_count": template_counts.get(f.id, 0),
    }


def _ser_template(t: NpcTemplate) -> dict:
    return {
        "id": t.id,
        "folder_id": t.folder_id,
        "session_id": t.session_id,
        "name": t.name,
        "description": t.description,
        "is_merchant": t.is_merchant,
        "max_hp": t.max_hp,
        "armor_class": t.armor_class,
        "strength": t.strength,
        "dexterity": t.dexterity,
        "constitution": t.constitution,
        "intelligence": t.intelligence,
        "wisdom": t.wisdom,
        "charisma": t.charisma,
        "initiative_bonus": t.initiative_bonus,
        "token_color": t.token_color,
        "default_equipment": json.loads(t.default_equipment) if t.default_equipment else [],
        "shop_items": json.loads(t.shop_items) if t.shop_items else [],
        "notes": t.notes,
    }


def _ser_event(e: EventTemplate) -> dict:
    return {
        "id": e.id,
        "session_id": e.session_id,
        "name": e.name,
        "description": e.description,
        "npc_template_ids": json.loads(e.npc_template_ids) if e.npc_template_ids else [],
        "folder_id": e.folder_id,
    }


# ══════════════════════════════════════════════════════════════
# FOLDERS CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/folders")
async def list_folders(session_id: int, db: AsyncSession = Depends(get_session)):
    # Load all folders flat
    result = await db.execute(
        select(NpcFolder).where(NpcFolder.session_id == session_id).order_by(NpcFolder.name)
    )
    all_folders = result.scalars().all()

    # Count templates per folder
    tpl_result = await db.execute(
        select(NpcTemplate.folder_id).where(NpcTemplate.session_id == session_id)
    )
    template_counts: dict[int, int] = {}
    for (fid,) in tpl_result.all():
        if fid:
            template_counts[fid] = template_counts.get(fid, 0) + 1

    # Build children map
    children_map: dict[int, list] = {}
    for f in all_folders:
        pid = f.parent_folder_id
        if pid:
            children_map.setdefault(pid, []).append(f)

    # Return only root folders (tree built recursively via children_map)
    roots = [f for f in all_folders if f.parent_folder_id is None]
    return [_ser_folder_flat(f, template_counts, children_map) for f in roots]


@router.post("/folders")
async def create_folder(body: FolderBody, db: AsyncSession = Depends(get_session)):
    f = NpcFolder(
        session_id=body.session_id,
        name=body.name,
        color=body.color,
        parent_folder_id=body.parent_folder_id,
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _ser_folder_simple(f)


@router.put("/folders/{folder_id}")
async def update_folder(folder_id: int, body: FolderBody, db: AsyncSession = Depends(get_session)):
    f = await db.get(NpcFolder, folder_id)
    if not f:
        raise HTTPException(404, "Folder not found")
    f.name = body.name
    f.color = body.color
    f.parent_folder_id = body.parent_folder_id
    await db.commit()
    await db.refresh(f)
    return _ser_folder_simple(f)


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: int, db: AsyncSession = Depends(get_session)):
    f = await db.get(NpcFolder, folder_id)
    if not f:
        raise HTTPException(404, "Folder not found")
    await db.delete(f)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# NPC TEMPLATES CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/templates")
async def list_templates(session_id: int, folder_id: int | None = None, db: AsyncSession = Depends(get_session)):
    q = select(NpcTemplate).where(NpcTemplate.session_id == session_id)
    if folder_id is not None:
        q = q.where(NpcTemplate.folder_id == folder_id)
    result = await db.execute(q.order_by(NpcTemplate.name))
    return [_ser_template(t) for t in result.scalars().all()]


@router.get("/templates/{template_id}")
async def get_template(template_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(NpcTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    return _ser_template(t)


@router.post("/templates")
async def create_template(body: TemplateBody, db: AsyncSession = Depends(get_session)):
    t = NpcTemplate(
        session_id=body.session_id,
        folder_id=body.folder_id,
        name=body.name,
        description=body.description,
        is_merchant=body.is_merchant,
        max_hp=body.max_hp,
        armor_class=body.armor_class,
        strength=body.strength,
        dexterity=body.dexterity,
        constitution=body.constitution,
        intelligence=body.intelligence,
        wisdom=body.wisdom,
        charisma=body.charisma,
        initiative_bonus=body.initiative_bonus,
        token_color=body.token_color,
        default_equipment=json.dumps(body.default_equipment),
        shop_items=json.dumps(body.shop_items),
        notes=body.notes,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _ser_template(t)


@router.put("/templates/{template_id}")
async def update_template(template_id: int, body: TemplateBody, db: AsyncSession = Depends(get_session)):
    t = await db.get(NpcTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    for field in ['name', 'description', 'is_merchant', 'max_hp', 'armor_class',
                  'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
                  'initiative_bonus', 'token_color', 'notes', 'folder_id']:
        setattr(t, field, getattr(body, field))
    t.default_equipment = json.dumps(body.default_equipment)
    t.shop_items = json.dumps(body.shop_items)
    await db.commit()
    await db.refresh(t)
    return _ser_template(t)


@router.delete("/templates/{template_id}")
async def delete_template(template_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(NpcTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    await db.delete(t)
    await db.commit()
    return {"ok": True}


# ── Spawn NPC from template ──────────────────────────────────
@router.post("/templates/{template_id}/spawn")
async def spawn_from_template(template_id: int, body: SpawnBody, db: AsyncSession = Depends(get_session)):
    t = await db.get(NpcTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")

    spawned = []
    for i in range(body.count):
        suffix = f" #{i+1}" if body.count > 1 else ""
        char = Character(
            session_id=body.session_id,
            name=f"{t.name}{suffix}",
            is_npc=True,
            is_gm_controlled=True,
            max_hp=t.max_hp,
            current_hp=t.max_hp,
            armor_class=t.armor_class,
            strength=t.strength,
            dexterity=t.dexterity,
            constitution=t.constitution,
            intelligence=t.intelligence,
            wisdom=t.wisdom,
            charisma=t.charisma,
            initiative_bonus=t.initiative_bonus,
            token_color=t.token_color,
            notes=t.notes,
        )
        db.add(char)
        await db.flush()

        # Default equipment
        equipment_ids = json.loads(t.default_equipment) if t.default_equipment else []
        for item_id in equipment_ids:
            inv = InventoryItem(
                character_id=char.id,
                item_id=item_id,
                quantity=1,
                is_equipped=True,
            )
            db.add(inv)

        # Merchant shop items
        if t.is_merchant:
            shop_items = json.loads(t.shop_items) if t.shop_items else []
            for si in shop_items:
                db.add(NpcShopInventory(
                    npc_id=char.id,
                    item_id=si.get("item_id"),
                    stock=si.get("stock"),
                    price_override_copper=si.get("price_override"),
                ))

        spawned.append({"id": char.id, "name": char.name})

    await db.commit()

    # Rework v3 Phase 1: nudge everyone's map so the freshly spawned
    # tokens show up immediately (self-heal in `GET /api/map/{code}`
    # handles the initial coordinate assignment).
    if spawned:
        try:
            sess = await db.get(Session, body.session_id)
            if sess:
                from app.websocket_manager import manager
                await manager.broadcast_to_session(sess.code, "map.updated", {
                    "reason": "npc_spawned",
                    "count": len(spawned),
                })
        except Exception:
            pass

    return {"spawned": spawned}


# ══════════════════════════════════════════════════════════════
# EVENT TEMPLATES CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/events")
async def list_events(session_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(EventTemplate).where(EventTemplate.session_id == session_id).order_by(EventTemplate.name)
    )
    return [_ser_event(e) for e in result.scalars().all()]


@router.post("/events")
async def create_event(body: EventBody, db: AsyncSession = Depends(get_session)):
    e = EventTemplate(
        session_id=body.session_id,
        name=body.name,
        description=body.description,
        npc_template_ids=json.dumps(body.npc_template_ids),
        folder_id=body.folder_id,
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return _ser_event(e)


@router.put("/events/{event_id}")
async def update_event(event_id: int, body: EventBody, db: AsyncSession = Depends(get_session)):
    e = await db.get(EventTemplate, event_id)
    if not e:
        raise HTTPException(404, "Event not found")
    e.name = body.name
    e.description = body.description
    e.npc_template_ids = json.dumps(body.npc_template_ids)
    e.folder_id = body.folder_id
    await db.commit()
    await db.refresh(e)
    return _ser_event(e)


@router.delete("/events/{event_id}")
async def delete_event(event_id: int, db: AsyncSession = Depends(get_session)):
    e = await db.get(EventTemplate, event_id)
    if not e:
        raise HTTPException(404, "Event not found")
    await db.delete(e)
    await db.commit()
    return {"ok": True}


# ── Trigger event ────────────────────────────────────────────
@router.post("/events/{event_id}/trigger")
async def trigger_event(event_id: int, db: AsyncSession = Depends(get_session)):
    e = await db.get(EventTemplate, event_id)
    if not e:
        raise HTTPException(404, "Event not found")

    entries = json.loads(e.npc_template_ids) if e.npc_template_ids else []
    all_spawned = []
    for entry in entries:
        tid = entry.get("template_id")
        count = entry.get("count", 1)
        t = await db.get(NpcTemplate, tid)
        if not t:
            continue
        for i in range(count):
            suffix = f" #{i+1}" if count > 1 else ""
            char = Character(
                session_id=e.session_id,
                name=f"{t.name}{suffix}",
                is_npc=True,
                is_gm_controlled=True,
                max_hp=t.max_hp,
                current_hp=t.max_hp,
                armor_class=t.armor_class,
                strength=t.strength,
                dexterity=t.dexterity,
                constitution=t.constitution,
                intelligence=t.intelligence,
                wisdom=t.wisdom,
                charisma=t.charisma,
                initiative_bonus=t.initiative_bonus,
                token_color=t.token_color,
                notes=t.notes,
            )
            db.add(char)
            await db.flush()

            equipment_ids = json.loads(t.default_equipment) if t.default_equipment else []
            for item_id in equipment_ids:
                db.add(InventoryItem(character_id=char.id, item_id=item_id, quantity=1, is_equipped=True))

            if t.is_merchant:
                shop_items = json.loads(t.shop_items) if t.shop_items else []
                for si in shop_items:
                    db.add(NpcShopInventory(
                        npc_id=char.id,
                        item_id=si.get("item_id"),
                        stock=si.get("stock"),
                        price_override_copper=si.get("price_override"),
                    ))

            all_spawned.append({"id": char.id, "name": char.name})

    await db.commit()

    # Rework v3 Phase 1: broadcast so the map picks up event-spawned NPCs.
    if all_spawned:
        try:
            sess = await db.get(Session, e.session_id)
            if sess:
                from app.websocket_manager import manager
                await manager.broadcast_to_session(sess.code, "map.updated", {
                    "reason": "event_triggered",
                    "count": len(all_spawned),
                })
        except Exception:
            pass

    return {"event_name": e.name, "spawned": all_spawned}


# ══════════════════════════════════════════════════════════════
# ENCOUNTER DIFFICULTY CALCULATOR
# ══════════════════════════════════════════════════════════════
class DifficultyRequest(BaseModel):
    players: list  # [{max_hp, armor_class, level?}]
    npcs: list  # [{max_hp, armor_class}]


@router.post("/encounter-difficulty")
async def encounter_difficulty(body: DifficultyRequest):
    party_power = sum(p.get("max_hp", 20) + p.get("armor_class", 10) * 2 for p in body.players)
    enemy_power = sum(n.get("max_hp", 20) + n.get("armor_class", 10) * 2 for n in body.npcs)
    ratio = enemy_power / max(party_power, 1)
    if ratio < 0.3:
        difficulty = "Trivial"
    elif ratio < 0.6:
        difficulty = "Easy"
    elif ratio < 1.0:
        difficulty = "Medium"
    elif ratio < 1.5:
        difficulty = "Hard"
    else:
        difficulty = "Deadly"
    return {"difficulty": difficulty, "ratio": round(ratio, 2), "party_power": party_power, "enemy_power": enemy_power}
