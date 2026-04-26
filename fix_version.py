import asyncio, aiosqlite, os
from app.database import DATA_DIR

DB_PATH = os.path.join(DATA_DIR, 'combat_companion.db')

async def fix():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE alembic_version SET version_num = 'bfe0a0f05cd3'")
        await db.commit()
        print('Fixed alembic_version to bfe0a0f05cd3')

asyncio.run(fix())
