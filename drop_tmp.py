import asyncio, aiosqlite, os
from app.database import DATA_DIR

DB_PATH = os.path.join(DATA_DIR, 'combat_companion.db')

async def fix():
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_alembic_tmp_%'") as cur:
            tables = [r[0] for r in await cur.fetchall()]
            for t in tables:
                await db.execute(f'DROP TABLE "{t}"')
                print(f'Dropped {t}')
        await db.commit()
        print('Done')

asyncio.run(fix())
