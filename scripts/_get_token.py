import asyncio
from app.database import async_session
from app.models import Session
from sqlalchemy import select

async def f():
    async with async_session() as db:
        r = await db.execute(select(Session).where(Session.code == 'DEMO01'))
        s = r.scalar_one_or_none()
        if s:
            print(f"gm_token: {s.gm_token}")
            print(f"session_id: {s.id}")
        else:
            print("Session DEMO01 not found")

asyncio.run(f())
