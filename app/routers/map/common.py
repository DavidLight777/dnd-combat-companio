"""Map management — upload, tokens, fog of war."""

import json
import os

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import DATA_DIR
from app.models import (
    Character,
    CombatEvent,
    CombatParticipant,
    MapDrawing,
    MapMarker,
    MapObject,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api/map", tags=["map"])

MAPS_DIR = os.path.join(DATA_DIR, "maps")
# Rework v3 Phase 6: token portrait storage. Files are stored under
# data/tokens/{character_id}.{ext}. One portrait per character —
# re-uploading overwrites the previous file.
TOKENS_DIR = os.path.join(DATA_DIR, "tokens")
os.makedirs(TOKENS_DIR, exist_ok=True)
MAX_DIMENSION = 4096
# Cap portrait size more aggressively: no reason to store 4K headshots.
TOKEN_MAX_DIMENSION = 512



def _seed_row(chars: list, y_norm: float) -> None:
    """Spread `chars` evenly along a row at y=`y_norm` (normalised 0..1)."""
    n = len(chars)
    if n == 0:
        return
    for i, c in enumerate(chars):
        c.map_x = 0.1 + (0.8 * (i + 0.5) / n)
        c.map_y = y_norm


async def _is_players_turn_or_no_combat(character: Character, db: AsyncSession) -> bool:
    """Return True if `character` may currently move.

    Rework v3 Phase 3 — a player may move their token freely while no
    combat is active; once a CombatEvent for the same session flips to
    `active`, only the character whose id matches the current
    participant's character_id is allowed to move. GM calls bypass this
    entirely (they skip the ownership branch that triggers this check).

    The function is deliberately lenient on errors: any lookup failure
    returns True so that transient DB hiccups don't freeze movement.
    """
    try:
        active_combat = (await db.execute(
            select(CombatEvent)
            .where(CombatEvent.session_id == character.session_id)
            .where(CombatEvent.status == "active")
            .limit(1)
        )).scalar_one_or_none()
        if not active_combat:
            return True  # no combat → freely move
        if not active_combat.current_participant_id:
            # Combat is marked active but no participant is current —
            # should not normally happen; be permissive rather than
            # locking the player out of their own screen.
            return True
        current_p = await db.get(CombatParticipant, active_combat.current_participant_id)
        if not current_p:
            return True
        return current_p.character_id == character.id
    except Exception:
        return True


async def _session_has_active_combat(session_id: int, db: AsyncSession) -> bool:
    """Cheap helper: True iff an active CombatEvent exists for this session."""
    try:
        active_combat = (await db.execute(
            select(CombatEvent.id)
            .where(CombatEvent.session_id == session_id)
            .where(CombatEvent.status == "active")
            .limit(1)
        )).scalar_one_or_none()
        return active_combat is not None
    except Exception:
        return False


def _chebyshev_cells(
    x0: float, y0: float, x1: float, y1: float,
    map_w: int, map_h: int, grid_size: int,
    grid_type: str = "square",
) -> float:
    """Distance between two normalised positions, in whole cells.

    Square grids use the Chebyshev (king-move) metric; hex grids use
    the pointy-top axial hex distance. Returns 0 on degenerate inputs.
    Delegates to :mod:`app.combat_range.grid_cells` so every gameplay
    surface — movement, range checks, measure tool — agrees on the
    exact metric. Name is preserved for call-site compatibility.
    """
    from app.combat_range import grid_cells
    return grid_cells(x0, y0, x1, y1, map_w, map_h, grid_size, grid_type)


async def _effective_speed_cells(character: Character, db: AsyncSession) -> int:
    """Total movement budget per turn for this character, in cells.

    Base from `Character.base_speed_cells`, plus any `speed_bonus` from
    equipped items. Status effects / drawings that tweak speed can be
    layered in later — kept to a single place so the UI (`speed_total`)
    and the enforcement path agree on the same number.
    """
    total = character.base_speed_cells or 6
    try:
        from app.models import InventoryItem, ItemBonus
        rows = (await db.execute(
            select(ItemBonus)
            .join(InventoryItem, InventoryItem.item_id == ItemBonus.item_id)
            .where(InventoryItem.character_id == character.id)
            .where(InventoryItem.is_equipped == True)  # noqa: E712
            .where(ItemBonus.bonus_type == "speed_bonus")
            .where(ItemBonus.is_conditional == False)  # noqa: E712
        )).scalars().all()
        for b in rows:
            total += int(round(b.value or 0))
    except Exception:
        pass
    return max(0, total)


async def _path_is_blocked(
    session_id: int, x0: float, y0: float, x1: float, y1: float,
    db: AsyncSession,
) -> bool:
    """Return True if the straight line (x0,y0)->(x1,y1) crosses any
    `blocks_movement=True` MapObject rectangle.

    Coordinates are normalised (0..1) over the play area. Builder wall
    / pit tiles (for both square and hex grids) are automatically
    synced into MapObject rectangles by
    `map_builder._sync_builder_walls_to_objects`, so this single check
    covers both wall tools.
    """
    try:
        # 1) Classic MapObject rectangles
        rows = (await db.execute(
            select(MapObject)
            .where(MapObject.session_id == session_id)
            .where(MapObject.blocks_movement == True)  # noqa: E712
        )).scalars().all()

        def _blocked(nx: float, ny: float) -> bool:
            for o in rows:
                if nx >= o.x1 and nx <= o.x2 and ny >= o.y1 and ny <= o.y2:
                    return True
            return False

        if not rows:
            return False
        if _blocked(x1, y1):
            return True
        import math
        dx, dy = x1 - x0, y1 - y0
        steps = max(4, min(64, int(math.hypot(dx, dy) * 200)))
        for i in range(1, steps):
            t = i / steps
            if _blocked(x0 + dx * t, y0 + dy * t):
                return True
        return False
    except Exception:
        return False


async def reset_movement_for(character_id: int, db: AsyncSession) -> None:
    """Reset this character's per-turn movement budget to 0.

    Exported so combat_events.next_turn / start_combat / end_combat can
    call it without importing the ORM machinery themselves.
    """
    try:
        c = await db.get(Character, character_id)
        if c and (c.movement_used_this_turn or 0) != 0:
            c.movement_used_this_turn = 0.0
            # Do NOT commit here — the caller owns the transaction.
    except Exception:
        pass



# ══════════════════════════════════════════════════════════════
# MARKERS (Stage 9)
# ══════════════════════════════════════════════════════════════
def _ser_marker(m: MapMarker) -> dict:
    return {
        "id": m.id, "session_id": m.session_id, "map_id": m.map_id,
        "marker_type": m.marker_type, "x": m.x, "y": m.y,
        "label": m.label, "description": m.description,
        "icon": m.icon, "color": m.color,
        "visible_to_players": m.visible_to_players,
        "created_by": m.created_by,
    }


# ══════════════════════════════════════════════════════════════
# DRAWINGS (Stage 9)
# ══════════════════════════════════════════════════════════════
def _ser_drawing(d: MapDrawing) -> dict:
    return {
        "id": d.id, "session_id": d.session_id, "map_id": d.map_id,
        "drawing_type": d.drawing_type,
        "points": json.loads(d.points) if d.points else [],
        "color": d.color, "line_width": d.line_width,
        "fill_opacity": d.fill_opacity,
        "visible_to_players": d.visible_to_players,
        "label": d.label,
    }


# ══════════════════════════════════════════════════════════════
# Rework v3 Phase 5 — MAP OBJECTS CRUD (walls / zones)
# ══════════════════════════════════════════════════════════════
def _ser_object(o: MapObject) -> dict:
    return {
        "id": o.id,
        "name": o.name,
        "kind": o.kind,
        "x1": o.x1, "y1": o.y1, "x2": o.x2, "y2": o.y2,
        "color": o.color,
        "blocks_movement": o.blocks_movement,
        "blocks_vision": o.blocks_vision,
        "visible_to_players": o.visible_to_players,
    }


async def _broadcast_objects_changed(session_code: str, reason: str) -> None:
    try:
        await manager.broadcast_to_session(session_code, "map.objects_updated", {"reason": reason})
    except Exception:
        pass


