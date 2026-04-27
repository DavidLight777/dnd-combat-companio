"""Location-level CRUD: a Location is one playable area inside a Map."""

from fastapi import Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Chest,
    BV2ChestItem,
    BV2CoverCell,
    BV2CoverZone,
    BV2Edge,
    BV2Entity,
    BV2Light,
    BV2Location,
    BV2Map,
    BV2NPCSpawn,
    BV2Portal,
    BV2Tile,
    BV2Trap,
    BV2VisitState,
    Character,
    Item,
    Session,
)
from app.routers.builder_v2.common import (
    broadcast,
    router,
    ser_entity,
    ser_light,
    ser_location,
    ser_tile,
)


@router.get("/maps/{map_id}/locations")
async def list_locations(map_id: int, db: AsyncSession = Depends(get_session)):
    m = await db.get(BV2Map, map_id)
    if not m:
        raise HTTPException(404, "Map not found")
    r = await db.execute(
        select(BV2Location)
        .where(BV2Location.map_id == map_id)
        .order_by(BV2Location.sort_order, BV2Location.id)
    )
    return [ser_location(loc) for loc in r.scalars().all()]


@router.post("/maps/{map_id}/locations")
async def create_location(map_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    m = await db.get(BV2Map, map_id)
    if not m:
        raise HTTPException(404, "Map not found")

    # Sort order — append to end by default
    r = await db.execute(select(BV2Location).where(BV2Location.map_id == map_id))
    existing = r.scalars().all()
    sort_order = int(body.get("sort_order", len(existing)))

    loc = BV2Location(
        map_id=map_id,
        name=(body.get("name") or f"Location {len(existing) + 1}")[:120],
        description=(body.get("description") or "")[:500],
        sort_order=sort_order,
        grid_type=("hex" if str(body.get("grid_type") or "").lower() == "hex" else "square"),
        tile_size=max(10, min(200, int(body.get("tile_size", 50)))),
        cols=max(5, min(500, int(body.get("cols", 40)))),
        rows=max(5, min(500, int(body.get("rows", 30)))),
        background_color=str(body.get("background_color") or "#1a1a1a")[:10],
        background_image_url=body.get("background_image_url"),
        ambient_light=max(0.0, min(1.0, float(body.get("ambient_light", 1.0)))),
        is_indoor=bool(body.get("is_indoor", False)),
        is_active=False,
    )
    db.add(loc)
    await db.commit()
    await db.refresh(loc)
    s = await db.get(Session, m.session_id)
    if s:
        await broadcast(s.code, "bv2.location_added", ser_location(loc))
    return ser_location(loc)


@router.get("/locations/{location_id}")
async def get_location_full(location_id: int, db: AsyncSession = Depends(get_session)):
    """Full payload — location settings + all tiles + entities + lights."""
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    tiles_r = await db.execute(select(BV2Tile).where(BV2Tile.location_id == location_id))
    entities_r = await db.execute(select(BV2Entity).where(BV2Entity.location_id == location_id))
    lights_r = await db.execute(select(BV2Light).where(BV2Light.location_id == location_id))

    entities = entities_r.scalars().all()
    ent_ids = [e.id for e in entities]

    # Batch-load detail rows by type
    chests = {}
    if ent_ids:
        cr = await db.execute(select(BV2Chest).where(BV2Chest.entity_id.in_(ent_ids)))
        for c in cr.scalars().all():
            chests[c.entity_id] = c
        # Chest items
        cir = await db.execute(
            select(BV2ChestItem, Item)
            .join(Item, BV2ChestItem.item_id == Item.id)
            .where(BV2ChestItem.chest_entity_id.in_(chests.keys()))
        )
        chest_items = {}
        for ci, it in cir.all():
            chest_items.setdefault(ci.chest_entity_id, []).append({
                "id": ci.id, "item_id": it.id, "name": it.name, "quantity": ci.quantity,
            })

        traps = {t.entity_id: t for t in (await db.execute(select(BV2Trap).where(BV2Trap.entity_id.in_(ent_ids)))).scalars().all()}
        portals = {p.entity_id: p for p in (await db.execute(select(BV2Portal).where(BV2Portal.entity_id.in_(ent_ids)))).scalars().all()}
        spawns = {s.entity_id: s for s in (await db.execute(select(BV2NPCSpawn).where(BV2NPCSpawn.entity_id.in_(ent_ids)))).scalars().all()}
        covers = {z.entity_id: z for z in (await db.execute(select(BV2CoverZone).where(BV2CoverZone.entity_id.in_(ent_ids)))).scalars().all()}
        cc_r = await db.execute(select(BV2CoverCell).where(BV2CoverCell.zone_entity_id.in_(covers.keys())))
        cover_cells = {}
        for c in cc_r.scalars().all():
            cover_cells.setdefault(c.zone_entity_id, []).append({"col": c.col, "row": c.row})
    else:
        chests = traps = portals = spawns = covers = {}
        chest_items = cover_cells = {}

    def _enrich(e: BV2Entity) -> dict:
        base = ser_entity(e)
        if e.entity_type == "chest" and e.id in chests:
            c = chests[e.id]
            base.update({
                "is_locked": c.is_locked, "lock_dc": c.lock_dc,
                "icon": c.icon, "is_opened": c.is_opened,
                "items": chest_items.get(e.id, []),
            })
        elif e.entity_type == "trap" and e.id in traps:
            t = traps[e.id]
            base.update({
                "trap_type": t.trap_type, "damage_dice": t.damage_dice,
                "damage_type": t.damage_type, "dc_detect": t.dc_detect,
                "dc_disarm": t.dc_disarm, "dc_save": t.dc_save,
                "save_ability": t.save_ability, "is_triggered": t.is_triggered,
                "is_disarmed": t.is_disarmed, "trigger_mode": t.trigger_mode,
                "reset_on_trigger": t.reset_on_trigger,
            })
        elif e.entity_type == "portal" and e.id in portals:
            p = portals[e.id]
            base.update({
                "target_location_id": p.target_location_id,
                "target_col": p.target_col, "target_row": p.target_row,
                "is_one_way": p.is_one_way, "requires_key_item_id": p.requires_key_item_id,
                "label": p.label, "is_active": p.is_active,
            })
        elif e.entity_type == "npc_spawn" and e.id in spawns:
            s = spawns[e.id]
            base.update({
                "npc_template_id": s.npc_template_id,
                "auto_spawn_trigger": s.auto_spawn_trigger,
                "spawn_count": s.spawn_count, "has_spawned": s.has_spawned,
                "is_hostile": s.is_hostile,
            })
        elif e.entity_type == "cover_zone" and e.id in covers:
            z = covers[e.id]
            base.update({
                "cover_level": z.cover_level, "material": z.material,
                "blocks_line_of_sight": z.blocks_line_of_sight,
                "is_destructible": z.is_destructible,
                "current_hp": z.current_hp, "max_hp": z.max_hp,
                "cells": cover_cells.get(e.id, []),
            })
        return base

    return {
        "location": ser_location(loc),
        "tiles": [ser_tile(t) for t in tiles_r.scalars().all()],
        "entities": [_enrich(e) for e in entities],
        "lights": [ser_light(li) for li in lights_r.scalars().all()],
    }


@router.patch("/locations/{location_id}")
async def update_location(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    if "name" in body and body["name"]:
        loc.name = str(body["name"])[:120]
    if "description" in body:
        loc.description = str(body["description"] or "")[:500]
    if "sort_order" in body:
        loc.sort_order = int(body["sort_order"])
    if "grid_type" in body:
        gt = str(body["grid_type"] or "").lower()
        loc.grid_type = "hex" if gt == "hex" else "square"
    if "tile_size" in body:
        loc.tile_size = max(10, min(200, int(body["tile_size"])))
    if "cols" in body:
        loc.cols = max(5, min(500, int(body["cols"])))
    if "rows" in body:
        loc.rows = max(5, min(500, int(body["rows"])))
    if "background_color" in body and body["background_color"]:
        loc.background_color = str(body["background_color"])[:10]
    if "background_image_url" in body:
        loc.background_image_url = body["background_image_url"] or None
    if "ambient_light" in body:
        loc.ambient_light = max(0.0, min(1.0, float(body["ambient_light"])))
    if "is_indoor" in body:
        loc.is_indoor = bool(body["is_indoor"])

    await db.commit()
    await db.refresh(loc)

    m = await db.get(BV2Map, loc.map_id)
    s = await db.get(Session, m.session_id) if m else None
    if s:
        await broadcast(s.code, "bv2.location_updated", ser_location(loc))
    return ser_location(loc)


@router.delete("/locations/{location_id}")
async def delete_location(location_id: int, db: AsyncSession = Depends(get_session)):
    """Explicit cascade — see the matching note in maps.delete_map."""
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import update as sa_update

    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    m = await db.get(BV2Map, loc.map_id)
    s = await db.get(Session, m.session_id) if m else None
    sess_code = s.code if s else None

    await db.execute(sa_delete(BV2Tile).where(BV2Tile.location_id == location_id))
    # Explicit detail cleanup before entity delete (SQLite ignores ondelete=CASCADE)
    from sqlalchemy import select as sa_select
    entity_subq = sa_select(BV2Entity.id).where(BV2Entity.location_id == location_id)
    await db.execute(sa_delete(BV2CoverCell).where(BV2CoverCell.zone_entity_id.in_(entity_subq)))
    await db.execute(sa_delete(BV2CoverZone).where(BV2CoverZone.entity_id.in_(entity_subq)))
    await db.execute(sa_delete(BV2ChestItem).where(BV2ChestItem.chest_entity_id.in_(entity_subq)))
    await db.execute(sa_delete(BV2Chest).where(BV2Chest.entity_id.in_(entity_subq)))
    await db.execute(sa_delete(BV2Trap).where(BV2Trap.entity_id.in_(entity_subq)))
    await db.execute(sa_delete(BV2Portal).where(BV2Portal.entity_id.in_(entity_subq)))
    await db.execute(sa_delete(BV2NPCSpawn).where(BV2NPCSpawn.entity_id.in_(entity_subq)))
    await db.execute(sa_delete(BV2Entity).where(BV2Entity.location_id == location_id))
    await db.execute(sa_delete(BV2Light).where(BV2Light.location_id == location_id))
    await db.execute(sa_delete(BV2Edge).where(BV2Edge.location_id == location_id))
    # Nullify edges in OTHER locations that target this one (SQLite ignores ondelete=SET NULL)
    await db.execute(
        sa_update(BV2Edge)
        .where(BV2Edge.target_location_id == location_id)
        .values(target_location_id=None, target_entry_col=0, target_entry_row=0)
    )
    # Nullify characters standing in this location (SQLite ignores ondelete=SET NULL)
    await db.execute(
        sa_update(Character)
        .where(Character.current_location_id == location_id)
        .values(current_location_id=None)
    )
    # Nullify portals targeting this location (S5b)
    await db.execute(
        sa_update(BV2Portal)
        .where(BV2Portal.target_location_id == location_id)
        .values(target_location_id=None)
    )
    await db.execute(sa_delete(BV2VisitState).where(BV2VisitState.location_id == location_id))
    await db.delete(loc)
    await db.commit()
    if sess_code:
        await broadcast(sess_code, "bv2.location_deleted", {"location_id": location_id})
    return {"ok": True}


@router.post("/locations/{location_id}/shift")
async def shift_location_content(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """Shift all tiles, entities, lights and edges by delta_col/delta_row.
    Items that fall outside the location bounds are deleted."""
    from sqlalchemy import delete as sa_delete

    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    delta_col = int(body.get("delta_col", 0))
    delta_row = int(body.get("delta_row", 0))
    if delta_col == 0 and delta_row == 0:
        return {"ok": True, "shifted": False}

    # Tiles
    tiles = (await db.execute(select(BV2Tile).where(BV2Tile.location_id == location_id))).scalars().all()
    for t in tiles:
        t.col += delta_col
        t.row += delta_row
        if t.col < 0 or t.row < 0 or t.col >= loc.cols or t.row >= loc.rows:
            await db.delete(t)

    # Entities (with explicit detail cleanup for SQLite)
    entities = (await db.execute(select(BV2Entity).where(BV2Entity.location_id == location_id))).scalars().all()
    for e in entities:
        e.col += delta_col
        e.row += delta_row
        if e.col < 0 or e.row < 0 or e.col >= loc.cols or e.row >= loc.rows:
            await db.execute(sa_delete(BV2CoverCell).where(BV2CoverCell.zone_entity_id == e.id))
            await db.execute(sa_delete(BV2CoverZone).where(BV2CoverZone.entity_id == e.id))
            await db.execute(sa_delete(BV2ChestItem).where(BV2ChestItem.chest_entity_id == e.id))
            await db.execute(sa_delete(BV2Chest).where(BV2Chest.entity_id == e.id))
            await db.execute(sa_delete(BV2Trap).where(BV2Trap.entity_id == e.id))
            await db.execute(sa_delete(BV2Portal).where(BV2Portal.entity_id == e.id))
            await db.execute(sa_delete(BV2NPCSpawn).where(BV2NPCSpawn.entity_id == e.id))
            await db.delete(e)

    # Lights
    lights = (await db.execute(select(BV2Light).where(BV2Light.location_id == location_id))).scalars().all()
    for li in lights:
        li.col += delta_col
        li.row += delta_row
        if li.col < 0 or li.row < 0 or li.col >= loc.cols or li.row >= loc.rows:
            await db.delete(li)

    # Edges
    edges = (await db.execute(select(BV2Edge).where(BV2Edge.location_id == location_id))).scalars().all()
    for edge in edges:
        if edge.side in ("north", "south"):
            edge.range_start += delta_col
            edge.range_end += delta_col
            max_r = loc.cols - 1
        else:
            edge.range_start += delta_row
            edge.range_end += delta_row
            max_r = loc.rows - 1
        edge.range_start = min(max_r, max(0, edge.range_start))
        edge.range_end = min(max_r, max(edge.range_start, edge.range_end))

    await db.commit()

    m = await db.get(BV2Map, loc.map_id)
    s = await db.get(Session, m.session_id) if m else None
    if s:
        await broadcast(s.code, "bv2.location_shifted", {
            "location_id": location_id,
            "delta_col": delta_col,
            "delta_row": delta_row,
        })
    return {"ok": True, "shifted": True}


@router.post("/locations/{location_id}/activate")
async def activate_location(location_id: int, db: AsyncSession = Depends(get_session)):
    """Make this Location the active one in its Map. The active map's
    active location is what players see in the runtime view.
    """
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    # Deactivate other locations in the same map
    await db.execute(
        update(BV2Location)
        .where(BV2Location.map_id == loc.map_id)
        .where(BV2Location.id != loc.id)
        .values(is_active=False)
    )
    loc.is_active = True

    # Also auto-activate the parent Map (so the runtime resolver picks it)
    m = await db.get(BV2Map, loc.map_id)
    if m:
        await db.execute(
            update(BV2Map)
            .where(BV2Map.session_id == m.session_id)
            .where(BV2Map.id != m.id)
            .values(is_active=False)
        )
        m.is_active = True

    await db.commit()
    await db.refresh(loc)
    s = await db.get(Session, m.session_id) if m else None
    if s:
        await broadcast(s.code, "bv2.location_activated", {
            "map_id": loc.map_id,
            "location_id": loc.id,
            "name": loc.name,
        })
    return ser_location(loc)
