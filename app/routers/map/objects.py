from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    MapObject,
    Session,
)
from app.routers.map.common import _broadcast_objects_changed, _ser_object, router


@router.get("/{session_code}/objects")
async def list_map_objects(session_code: str, db: AsyncSession = Depends(get_session)):
    session = (await db.execute(select(Session).where(Session.code == session_code))).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    rows = (await db.execute(select(MapObject).where(MapObject.session_id == session.id))).scalars().all()
    return [_ser_object(o) for o in rows]


@router.post("/{session_code}/objects")
async def create_map_object(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    session = (await db.execute(select(Session).where(Session.code == session_code))).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    # Normalise & clamp so degenerate rects and out-of-range coords
    # never reach the DB.
    x1 = max(0.0, min(1.0, float(body.get("x1", 0.0))))
    y1 = max(0.0, min(1.0, float(body.get("y1", 0.0))))
    x2 = max(0.0, min(1.0, float(body.get("x2", 0.0))))
    y2 = max(0.0, min(1.0, float(body.get("y2", 0.0))))
    if x2 < x1: x1, x2 = x2, x1
    if y2 < y1: y1, y2 = y2, y1
    o = MapObject(
        session_id=session.id,
        name=(body.get("name") or "Wall")[:60],
        kind=(body.get("kind") or "wall")[:20],
        x1=x1, y1=y1, x2=x2, y2=y2,
        color=(body.get("color") or "#8a4abf")[:10],
        blocks_movement=bool(body.get("blocks_movement", True)),
        blocks_vision=bool(body.get("blocks_vision", False)),
        visible_to_players=bool(body.get("visible_to_players", True)),
    )
    db.add(o)
    await db.commit()
    await db.refresh(o)
    await _broadcast_objects_changed(session_code, "created")
    return _ser_object(o)


@router.patch("/object/{object_id}")
async def update_map_object(object_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    o = await db.get(MapObject, object_id)
    if not o:
        raise HTTPException(404, "Object not found")
    for f in ("name", "kind", "color"):
        if f in body and body[f] is not None:
            setattr(o, f, str(body[f]))
    for f in ("x1", "y1", "x2", "y2"):
        if f in body and body[f] is not None:
            setattr(o, f, max(0.0, min(1.0, float(body[f]))))
    if o.x2 < o.x1: o.x1, o.x2 = o.x2, o.x1
    if o.y2 < o.y1: o.y1, o.y2 = o.y2, o.y1
    for f in ("blocks_movement", "blocks_vision", "visible_to_players"):
        if f in body and body[f] is not None:
            setattr(o, f, bool(body[f]))
    await db.commit()
    # Resolve session code for the broadcast.
    sess = await db.get(Session, o.session_id)
    if sess:
        await _broadcast_objects_changed(sess.code, "updated")
    return _ser_object(o)


@router.delete("/object/{object_id}")
async def delete_map_object(object_id: int, db: AsyncSession = Depends(get_session)):
    o = await db.get(MapObject, object_id)
    if not o:
        raise HTTPException(404, "Object not found")
    sess_code = None
    try:
        sess = await db.get(Session, o.session_id)
        if sess:
            sess_code = sess.code
    except Exception:
        pass
    await db.delete(o)
    await db.commit()
    if sess_code:
        await _broadcast_objects_changed(sess_code, "deleted")
    return {"ok": True}


# ══════════════════════════════════════════════════════════════

@router.delete("/{session_code}/objects/all")
async def clear_all_objects(session_code: str, db: AsyncSession = Depends(get_session)):
    session = (await db.execute(select(Session).where(Session.code == session_code))).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    rows = (await db.execute(select(MapObject).where(MapObject.session_id == session.id))).scalars().all()
    for o in rows:
        await db.delete(o)
    await db.commit()
    await _broadcast_objects_changed(session_code, "cleared")
    return {"ok": True, "deleted": len(rows)}
