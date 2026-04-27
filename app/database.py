import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(os.path.join(DATA_DIR, "maps"), exist_ok=True)

DATABASE_URL = f"sqlite+aiosqlite:///{os.path.join(DATA_DIR, 'combat_companion.db')}"

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    from sqlalchemy import text

    from app.models import Base as _  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # FIX 6: lightweight column migrations for existing SQLite DBs
    # (create_all does not ALTER existing tables)
    _migrations = [
        # (table, column, column_def_sql) — idempotent, try/except absorbs "duplicate column"
        ("items",             "is_potion",          "is_potion BOOLEAN DEFAULT 0"),
        ("items",             "potion_icon",        "potion_icon VARCHAR(8) DEFAULT '🧪'"),
        # Fix 1: ensure existing DBs have the table-visibility columns
        ("characters",        "show_hp_to_players", "show_hp_to_players BOOLEAN DEFAULT 0"),
        ("characters",        "place_at_table",     "place_at_table BOOLEAN DEFAULT 0"),
        # Rework Phase 1: Character ranks
        ("characters",        "rank",               "rank VARCHAR(20) DEFAULT 'common'"),
        # Rework Phase 1: weapon hit/damage stat
        ("item_weapon_stats", "hit_stat",           "hit_stat VARCHAR(20) DEFAULT 'strength'"),
        ("item_weapon_stats", "damage_stat",        "damage_stat VARCHAR(20) DEFAULT 'strength'"),
        # Rework v3 Phase 4: battle-grid movement budget.
        ("characters",        "base_speed_cells",       "base_speed_cells INTEGER DEFAULT 6"),
        ("characters",        "movement_used_this_turn","movement_used_this_turn FLOAT DEFAULT 0"),
        # Rework v3 Phase 6: portrait image url for token rendering.
        ("characters",        "token_image_url",        "token_image_url TEXT"),
        # Rework v3 Phase 7: range in cells for weapons & abilities.
        ("item_weapon_stats", "range_cells",            "range_cells INTEGER DEFAULT 1"),
        ("abilities",         "range_cells",            "range_cells INTEGER DEFAULT 1"),
    ]
    async with engine.begin() as conn:
        for table, col, coldef in _migrations:
            try:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {coldef}"))
            except Exception:
                pass  # column already exists or table missing — harmless


async def get_session() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session
