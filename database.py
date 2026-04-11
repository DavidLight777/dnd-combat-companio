import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

DATABASE_URL = f"sqlite+aiosqlite:///{os.path.join(DATA_DIR, 'dnd_companion.db')}"

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    from models import Base as _  # noqa: F401 — ensure all models are imported
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Migrate existing DB: add columns that may not exist yet
    async with engine.begin() as conn:
        for col, default in [("turn_count", "0")]:
            try:
                await conn.execute(
                    __import__("sqlalchemy").text(
                        f"ALTER TABLE characters ADD COLUMN {col} INTEGER DEFAULT {default}"
                    )
                )
            except Exception:
                pass  # column already exists


async def get_session() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session
