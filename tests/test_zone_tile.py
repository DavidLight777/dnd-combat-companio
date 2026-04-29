"""Zone tile must not block movement or vision."""


def test_zone_tile_does_not_block():
    from app.routers.builder_v2.common import tile_blocks
    result = tile_blocks("zone")
    assert result["blocks_movement"] is False
    assert result["blocks_vision"] is False
