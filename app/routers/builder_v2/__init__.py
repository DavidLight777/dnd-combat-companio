"""Map Builder v2 — full rewrite of the map builder.

Tables: bv2_maps / bv2_locations / bv2_tiles / bv2_entities / bv2_lights /
bv2_edges / bv2_visit_state / bv2_library.

Phase 1: Maps + Locations + Tiles + auto-save + activate.
Phases 2-6: entities, FOV, lighting, edge transitions, library, polish.
"""

# Register sub-modules so their @router.<verb> decorators run.
from app.routers.builder_v2 import (  # noqa: F401, E402
    chests,
    cover_zones,
    edges,
    entities,
    fov,
    interiors,
    library,
    lights,
    locations,
    maps,
    npc_spawns,
    portals,
    tiles,
    traps,
)
from app.routers.builder_v2.common import router

__all__ = ["router"]
