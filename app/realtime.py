"""Realtime entity-change dispatcher.

Hooks SQLAlchemy session events so that **every** database commit fans
out a generic ``entity.invalidated`` WebSocket message to the relevant
session. Clients listen to this single event and trigger the matching
loader function (e.g. ``loadInventory`` when an ``InventoryItem`` row
changes). This guarantees live UI updates for any endpoint — including
future ones — without each handler having to remember to call the
broadcast helper.

Design notes
------------

* We register on the sync :class:`sqlalchemy.orm.Session` because SQLAlchemy
  delegates to a sync Session under every :class:`AsyncSession`. Global
  ``event.listens_for(Session, ...)`` therefore covers every DB mutation
  in the app.

* The ``after_flush`` hook collects a compact description of every
  inserted / updated / deleted instance belonging to one of the tracked
  model classes into ``session.info``. ``after_commit`` drains that
  buffer and schedules the async broadcast on the running event loop.

* Broadcasts are deduplicated: a single commit touching many rows for
  the same character only yields one ``entity.invalidated`` per
  ``(entity_type, character_id)`` pair.

* Existing named WS events (``combat.attack_result``, ``quest.assigned``
  etc.) continue to fire alongside this generic one. Clients debounce,
  so the slight overlap is harmless.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Iterable

from sqlalchemy import event, select
from sqlalchemy.orm import Session as SyncSession

from app.websocket_manager import manager

logger = logging.getLogger("realtime")


# ── Model mapping ────────────────────────────────────────────
# Each entry maps a tracked model class to:
#   (entity_label, character_id_attr_or_None, session_id_attr_or_None)
# Exactly one of the two attrs should be non-None.
def _entity_info(obj: Any) -> tuple[str, int | None, int | None] | None:
    """Return (label, character_id, session_id) for tracked rows, else None."""
    # Import lazily so the models module can import us without a cycle.
    from app import models as m

    cls = type(obj)
    if cls is m.Character:
        return ("Character", getattr(obj, "id", None), getattr(obj, "session_id", None))
    if cls is m.InventoryItem:
        return ("InventoryItem", getattr(obj, "character_id", None), None)
    if cls is m.CharacterAbility:
        return ("CharacterAbility", getattr(obj, "character_id", None), None)
    if cls is m.StatModifier:
        return ("StatModifier", getattr(obj, "character_id", None), None)
    if cls is m.AttackModifier:
        return ("AttackModifier", getattr(obj, "character_id", None), None)
    if cls is m.DamageModifier:
        return ("DamageModifier", getattr(obj, "character_id", None), None)
    if cls is m.CharacterEffect:
        return ("CharacterEffect", getattr(obj, "character_id", None), None)
    if cls is m.CharacterQuest:
        return ("CharacterQuest", getattr(obj, "character_id", None), None)
    if cls is m.CharacterProfession:
        return ("CharacterProfession", getattr(obj, "character_id", None), None)
    if cls is m.TurnTimer:
        return ("TurnTimer", getattr(obj, "character_id", None), None)
    return None


def _scan(objs: Iterable[Any], action: str, buf: list[dict]) -> None:
    for obj in objs:
        info = _entity_info(obj)
        if not info:
            continue
        label, char_id, sess_id = info
        buf.append({
            "label": label,
            "character_id": char_id,
            "session_id": sess_id,
            "action": action,
        })


# ── SQLAlchemy event hooks ───────────────────────────────────
@event.listens_for(SyncSession, "after_flush")
def _capture_flush(session: SyncSession, flush_context) -> None:
    """Capture dirty/new/deleted rows during every flush."""
    buf = session.info.setdefault("_rt_mutations", [])
    # `deleted` must be read BEFORE they leave the session — attributes
    # are still accessible here inside after_flush.
    _scan(session.new, "inserted", buf)
    _scan(session.dirty, "updated", buf)
    _scan(session.deleted, "deleted", buf)


@event.listens_for(SyncSession, "after_commit")
def _dispatch_commit(session: SyncSession) -> None:
    """After commit, schedule an async broadcast of collected events."""
    buf = session.info.pop("_rt_mutations", None)
    if not buf:
        return

    # We must hop to async land. We're already running inside the event
    # loop (AsyncSession.commit -> sync Session.commit -> this hook), so
    # `get_running_loop()` is safe.
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # Sync context (tests, migrations, startup seeds) — nothing to
        # broadcast to anyway.
        return
    loop.create_task(_broadcast_all(buf))


@event.listens_for(SyncSession, "after_rollback")
def _discard_rollback(session: SyncSession) -> None:
    """Drop the pending buffer on rollback so no stale events ship."""
    session.info.pop("_rt_mutations", None)


# ── Async broadcast worker ───────────────────────────────────
async def _broadcast_all(buf: list[dict]) -> None:
    """Resolve session_code for every mutation and fan out.

    Uses a **separate** AsyncSession so we don't fight the committing
    transaction. All lookups are simple id→id selects.
    """
    if not buf:
        return

    from app.database import async_session
    from app.models import Character, Session as SessionModel

    char_ids = {
        b["character_id"]
        for b in buf
        if b.get("character_id") and not b.get("session_id")
    }
    session_ids = {b["session_id"] for b in buf if b.get("session_id")}

    char_to_session: dict[int, int] = {}
    session_to_code: dict[int, str] = {}

    try:
        async with async_session() as db:
            if char_ids:
                q = await db.execute(
                    select(Character.id, Character.session_id).where(
                        Character.id.in_(char_ids)
                    )
                )
                for cid, sid in q.all():
                    if sid is None:
                        continue
                    char_to_session[cid] = sid
                    session_ids.add(sid)

            if session_ids:
                q = await db.execute(
                    select(SessionModel.id, SessionModel.code).where(
                        SessionModel.id.in_(session_ids)
                    )
                )
                for sid, code in q.all():
                    session_to_code[sid] = code
    except Exception as e:
        logger.warning("realtime broadcast resolve failed: %s", e)
        return

    # Dedup by (session_code, entity_label, character_id). We drop the
    # action — clients just refetch and don't care whether it was an
    # insert or update.
    seen: set[tuple[str, str, int]] = set()
    payloads: dict[str, list[dict]] = {}
    for b in buf:
        sid = b.get("session_id") or char_to_session.get(b.get("character_id"))
        if not sid:
            continue
        code = session_to_code.get(sid)
        if not code:
            continue
        key = (code, b["label"], int(b.get("character_id") or 0))
        if key in seen:
            continue
        seen.add(key)
        payloads.setdefault(code, []).append({
            "entity": b["label"],
            "character_id": b.get("character_id"),
            "action": b["action"],
        })

    for code, items in payloads.items():
        try:
            await manager.broadcast_to_session(
                code, "entity.invalidated", {"changes": items}
            )
        except Exception as e:
            logger.warning("realtime broadcast send failed for %s: %s", code, e)


# ── Registration side-effect ─────────────────────────────────
# Importing this module registers the listeners. Caller (main.py) only
# needs `import app.realtime` to wire everything up.
logger.info("realtime dispatcher loaded — tracking %d model types", 10)
