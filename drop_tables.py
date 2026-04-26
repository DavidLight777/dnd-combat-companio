import asyncio, aiosqlite, os
from app.database import DATA_DIR

DB_PATH = os.path.join(DATA_DIR, 'combat_companion.db')

async def fix():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('DROP TABLE IF EXISTS map_library')
        await db.execute('DROP TABLE IF EXISTS map_templates')
        await db.execute('DROP TABLE IF EXISTS map_chests')
        await db.commit()
        print('Dropped all new tables')

asyncio.run(fix())
