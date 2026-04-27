"""Light CRUD: static lights on locations + character-carried lights."""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import BV2Light, BV2Location, Character, Session
from app.routers.builder_v2.common import (
    broadcast,
    is_active_bv2_location,
    router,
    ser_light,
    session_code_for_location,
)

# ─────────────────────────────────────────────────────────────
# Location lights
# ─────────────────────────────────────────────────────────────

@router.get("/locations/{location_id}/lights")
async def list_lights(location_id: int, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    r = await db.execute(
        select(BV2Light).where(BV2Light.location_id == location_id).order_by(BV2Light.id)
    )
    return [ser_light(li) for li in r.scalars().all()]


@router.post("/locations/{location_id}/lights")
async def create_light(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    col = max(0, min(loc.cols - 1, int(body.get("col", 0))))
    row = max(0, min(loc.rows - 1, int(body.get("row", 0))))

    li = BV2Light(
        location_id=location_id,
        character_id=None,
        col=col,
        row=row,
        radius_cells=max(0.5, min(50.0, float(body.get("radius_cells", 6.0)))),
        color_hex=str(body.get("color_hex") or "#ffd9a0")[:9],
        intensity=max(0.0, min(5.0, float(body.get("intensity", 1.0)))),
        source_kind=str(body.get("source_kind") or "torch")[:20],
    )
    db.add(li)
    await db.commit()
    await db.refresh(li)

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.light_added", {
            "location_id": location_id,
            "light": ser_light(li),
        })
        if await is_active_bv2_location(location_id, db):
            await broadcast(sess_code, "map.light_added", {
                "light": ser_light(li),
            })
    return ser_light(li)


@router.patch("/lights/{light_id}")
async def update_light(light_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    li = await db.get(BV2Light, light_id)
    if not li:
        raise HTTPException(404, "Light not found")

    loc = None
    if li.location_id:
        loc = await db.get(BV2Location, li.location_id)

    if "col" in body and loc:
        li.col = max(0, min(loc.cols - 1, int(body["col"])))
    if "row" in body and loc:
        li.row = max(0, min(loc.rows - 1, int(body["row"])))
    if "radius_cells" in body:
        li.radius_cells = max(0.5, min(50.0, float(body["radius_cells"])))
    if "color_hex" in body:
        li.color_hex = str(body["color_hex"])[:9]
    if "intensity" in body:
        li.intensity = max(0.0, min(5.0, float(body["intensity"])))
    if "source_kind" in body:
        li.source_kind = str(body["source_kind"])[:20]

    await db.commit()
    await db.refresh(li)

    sess_code = await session_code_for_location(li.location_id, db) if li.location_id else None
    if sess_code:
        await broadcast(sess_code, "bv2.light_updated", {
            "location_id": li.location_id,
            "light": ser_light(li),
        })
        if li.location_id and await is_active_bv2_location(li.location_id, db):
            await broadcast(sess_code, "map.light_updated", {
                "light": ser_light(li),
            })
    return ser_light(li)


@router.delete("/lights/{light_id}")
async def delete_light(light_id: int, db: AsyncSession = Depends(get_session)):
    li = await db.get(BV2Light, light_id)
    if not li:
        raise HTTPException(404, "Light not found")

    location_id = li.location_id
    await db.delete(li)
    await db.commit()

    sess_code = await session_code_for_location(location_id, db) if location_id else None
    if sess_code:
        await broadcast(sess_code, "bv2.light_deleted", {
            "location_id": location_id,
            "light_id": light_id,
        })
        if location_id and await is_active_bv2_location(location_id, db):
            await broadcast(sess_code, "map.light_deleted", {
                "light_id": light_id,
            })
    return {"ok": True}


# ─────────────────────────────────────────────────────────────
# Character-carried lights
# ─────────────────────────────────────────────────────────────

@router.post("/characters/{character_id}/lights")
async def attach_light_to_character(
    character_id: int, body: dict, db: AsyncSession = Depends(get_session)
):
    character = await db.get(Character, character_id)
    if not character:
        raise HTTPException(404, "Character not found")

    li = BV2Light(
        location_id=None,
        character_id=character_id,
        col=0,
        row=0,
        radius_cells=max(0.5, min(50.0, float(body.get("radius_cells", 6.0)))),
        color_hex=str(body.get("color_hex") or "#ffd9a0")[:9],
        intensity=max(0.0, min(5.0, float(body.get("intensity", 1.0)))),
        source_kind=str(body.get("source_kind") or "torch")[:20],
    )
    db.add(li)
    await db.commit()
    await db.refresh(li)

    s = await db.get(Session, character.session_id)
    if s:
        await broadcast(s.code, "bv2.light_added", {
            "character_id": character_id,
            "light": ser_light(li),
        })
    return ser_light(li)


@router.delete("/characters/{character_id}/lights/{light_id}")
async def detach_light_from_character(
    character_id: int, light_id: int, db: AsyncSession = Depends(get_session)
):
    li = await db.get(BV2Light, light_id)
    if not li or li.character_id != character_id:
        raise HTTPException(404, "Light not found")

    await db.delete(li)
    await db.commit()

    character = await db.get(Character, character_id)
    if character:
        s = await db.get(Session, character.session_id)
        if s:
            await broadcast(s.code, "bv2.light_deleted", {
                "character_id": character_id,
                "light_id": light_id,
            })
    return {"ok": True}
