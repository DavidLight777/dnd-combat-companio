# Import sub-modules to register their routes on the router
from app.routers.map import drawings, files, fog, markers, objects, overlays, token_images, tokens

# Re-export helpers that other modules import from map
from app.routers.map.common import (
    MAPS_DIR,
    MAX_DIMENSION,
    TOKEN_MAX_DIMENSION,
    TOKENS_DIR,
    _broadcast_objects_changed,
    _chebyshev_cells,
    _effective_speed_cells,
    _is_players_turn_or_no_combat,
    _path_is_blocked,
    _seed_row,
    _ser_drawing,
    _ser_marker,
    _ser_object,
    _session_has_active_combat,
    reset_movement_for,
    router,
)

__all__ = [
    "router",
    "_seed_row",
    "_is_players_turn_or_no_combat",
    "_session_has_active_combat",
    "_chebyshev_cells",
    "_effective_speed_cells",
    "_path_is_blocked",
    "reset_movement_for",
    "_ser_marker",
    "_ser_drawing",
    "_ser_object",
    "_broadcast_objects_changed",
    "MAPS_DIR",
    "TOKENS_DIR",
    "MAX_DIMENSION",
    "TOKEN_MAX_DIMENSION",
]
