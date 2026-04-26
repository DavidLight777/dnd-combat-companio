import asyncio, aiosqlite, os
from app.database import DATA_DIR

DB_PATH = os.path.join(DATA_DIR, 'combat_companion.db')

async def fix():
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT name FROM sqlite_master WHERE type='table'") as cur:
            tables = [r[0] for r in await cur.fetchall()]
            print('Tables:', tables)
        
        if 'map_templates' in tables:
            await db.execute('DROP TABLE map_templates')
            print('Dropped map_templates')
        if 'map_chests' in tables:
            await db.execute('DROP TABLE map_chests')
            print('Dropped map_chests')
        
        async with db.execute('PRAGMA table_info(map_floors)') as cur:
            cols = [r[1] for r in await cur.fetchall()]
            if 'map_id' in cols:
                await db.execute('ALTER TABLE map_floors DROP COLUMN map_id')
                print('Dropped map_id column')
            else:
                print('map_id column not found')
        
        await db.commit()
        print('Done')

asyncio.run(fix())
