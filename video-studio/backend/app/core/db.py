from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 30},
)

@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


from collections.abc import AsyncGenerator

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    """Create all tables on startup."""
    async with engine.begin() as conn:
        # Import all models to register them
        from app.models import (  # noqa: F401
            channel, category, video, job, publish_schedule,
            product, gemini_key, tiktok_account, schedule_template, duplicate_log,
            localize_preset
        )
        await conn.run_sync(Base.metadata.create_all)
        # Migration: Ensure provider and is_default columns exist in gemini_api_keys
        try:
            from sqlalchemy import text
            await conn.execute(text("ALTER TABLE gemini_api_keys ADD COLUMN provider VARCHAR(50) DEFAULT 'google'"))
        except Exception:
            pass
        try:
            from sqlalchemy import text
            await conn.execute(text("ALTER TABLE gemini_api_keys ADD COLUMN is_default BOOLEAN DEFAULT 0"))
        except Exception:
            pass
