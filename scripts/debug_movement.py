# scripts/debug_movement.py
import asyncio, sys
sys.path.insert(0, '.')
from app.database import async_session
from app.models import BV2Tile
from sqlalchemy import select, func

async def main():
    async with async_session() as db:
        r = await db.execute(
            select(BV2Tile.tile_type, func.count())
            .where(BV2Tile.blocks_movement == True)
            .group_by(BV2Tile.tile_type)
        )
        for row in r.all():
            print(f"  {row[0]}: {row[1]} blocking tiles")

asyncio.run(main())
