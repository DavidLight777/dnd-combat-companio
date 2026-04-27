"""Realtime entity-change dispatcher.

Hooks SQLAlchemy session events so that **every** database commit fans
out a generic ``entity.invalidated`` WebSocket message to the relevant
session(s). Clients listen to this single event and trigger the matching
loader function. This guarantees live UI updates for any endpoint —
including future ones — without each handler having to remember to
call the broadcast helper.

Routing is **automatic**: at import time we inspect every mapped ORM
class and classify it by which FK column it carries:

* ``session_id``        → route directly to that session.
* ``character_id``      → resolve session via ``Character.session_id``.
* ``combat_event_id``   → resolve session via ``CombatEvent.session_id``.
* ``inventory_item_id`` → resolve session via
  ``InventoryItem → Character.session_id``.

Rows with a nullable ``session_id`` that is **NULL** at commit time are
treated as global templates (e.g. builtin Races, Classes, Abilities,
PoisonTemplates, StatusEffectTemplates) and broadcast to every
currently-connected session.

A short blacklist skips tables that would be extremely noisy and carry
no user-visible UI state (AI chat log, combat_log rows).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from typing import Any

from sqlalchemy import event, select
from sqlalchemy.orm import Session as SyncSession

from app.websocket_manager import manager

logger = logging.getLogger("realtime")


# ── Blacklist ────────────────────────────────────────────────
# Tables we intentionally do NOT broadcast on:
# * ai_conversations  — long chat logs, huge volume, never rendered live.
# * combat_log        — legacy append-only narrative log (if still used).
# * currency_transactions — append-only audit log; UI reads aggregate.
# * character_wizard_state — already has its own `wizard.update` events.
_BLACKLIST_TABLES: set[str] = {
    "ai_conversations",
    "combat_log",
    "currency_transactions",
    "character_wizard_state",
}


# ── Routing table ────────────────────────────────────────────
# Populated lazily by _build_routing_map() on first flush.
_ROUTING: dict[type, dict[str, Any]] | None = None


def _build_routing_map() -> dict[type, dict[str, Any]]:
    """Inspect every mapped ORM class and categorise routing.

    Returns a dict mapping ``ModelClass -> routing_info`` where
    routing_info has the keys:

    * ``label``              : class name used as the ``entity`` field.
    * ``session_attr``       : FK column name (``session_id``) or None.
    * ``character_attr``     : FK column name (``character_id``) or None.
    * ``combat_event_attr``  : FK column name (``combat_event_id``) or None.
    * ``inventory_item_attr``: FK column name (``inventory_item_id``) or None.
    """
    from app.database import Base  # lazy import to dodge cycles

    out: dict[type, dict[str, Any]] = {}
    for mapper in Base.registry.mappers:
        cls = mapper.class_
        tablename = getattr(cls, "__tablename__", None)
        if not tablename or tablename in _BLACKLIST_TABLES:
            continue
        col_keys = {c.key for c in mapper.columns}

        route: dict[str, Any] = {"label": cls.__name__}
        has_route = False
        if "session_id" in col_keys:
            route["session_attr"] = "session_id"
            has_route = True
        if "character_id" in col_keys:
            route["character_attr"] = "character_id"
            has_route = True
        if "combat_event_id" in col_keys:
            route["combat_event_attr"] = "combat_event_id"
            has_route = True
        if "inventory_item_id" in col_keys:
            route["inventory_item_attr"] = "inventory_item_id"
            has_route = True

        if not has_route:
            # Global catalogs (Item, ItemBonus, ItemWeaponStats, ItemCategory,
            # etc.) aren't per-session. Clients either don't show them live or
            # refresh on their own modal open.
            continue
        out[cls] = route
    logger.info("realtime: routing %d model classes", len(out))
    return out


def _routing() -> dict[type, dict[str, Any]]:
    global _ROUTING
    if _ROUTING is None:
        try:
            _ROUTING = _build_routing_map()
        except Exception as e:
            logger.warning("realtime: routing map build failed: %s", e)
            _ROUTING = {}
    return _ROUTING


def _entity_info(obj: Any) -> dict | None:
    """Snapshot the routing-relevant attributes of a single ORM row."""
    route = _routing().get(type(obj))
    if route is None:
        return None
    snap = {"label": route["label"]}
    for key, attr_key in (
        ("session_id",       "session_attr"),
        ("character_id",     "character_attr"),
        ("combat_event_id",  "combat_event_attr"),
        ("inventory_item_id", "inventory_item_attr"),
    ):
        attr = route.get(attr_key)
        if attr is None:
            continue
        try:
            snap[key] = getattr(obj, attr, None)
        except Exception:
            snap[key] = None
    return snap


def _scan(objs: Iterable[Any], action: str, buf: list[dict]) -> None:
    for obj in objs:
        info = _entity_info(obj)
        if info is None:
            continue
        info["action"] = action
        buf.append(info)


# ── SQLAlchemy event hooks ───────────────────────────────────
@event.listens_for(SyncSession, "after_flush")
def _capture_flush(session: SyncSession, flush_context) -> None:
    """Capture dirty/new/deleted rows during every flush."""
    buf = session.info.setdefault("_rt_mutations", [])
    _scan(session.new, "inserted", buf)
    _scan(session.dirty, "updated", buf)
    _scan(session.deleted, "deleted", buf)


@event.listens_for(SyncSession, "after_commit")
def _dispatch_commit(session: SyncSession) -> None:
    """After commit, schedule an async broadcast of collected events."""
    buf = session.info.pop("_rt_mutations", None)
    if not buf:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # Sync context (startup seeds, migrations) — nothing to broadcast.
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
    transaction. All lookups are simple id→id selects and batched per
    FK type.
    """
    if not buf:
        return

    from app.database import async_session
    from app.models import Character, CombatEvent, InventoryItem
    from app.models import Session as SessionModel

    # Collect id sets for each resolve pass.
    direct_session_ids: set[int] = set()
    need_char_ids: set[int] = set()
    need_combat_ids: set[int] = set()
    need_invitem_ids: set[int] = set()
    global_entries: list[dict] = []  # session_id=None templates

    for b in buf:
        sid = b.get("session_id")
        if sid:
            direct_session_ids.add(int(sid))
            continue
        # Explicit-None session_id on templates → global.
        if "session_id" in b and sid is None and not (
            b.get("character_id") or b.get("combat_event_id") or b.get("inventory_item_id")
        ):
            global_entries.append(b)
            continue
        cid = b.get("character_id")
        if cid:
            need_char_ids.add(int(cid))
            continue
        ceid = b.get("combat_event_id")
        if ceid:
            need_combat_ids.add(int(ceid))
            continue
        iid = b.get("inventory_item_id")
        if iid:
            need_invitem_ids.add(int(iid))
            continue

    # Resolve all id→session_id in one go.
    char_to_session: dict[int, int] = {}
    combat_to_session: dict[int, int] = {}
    invitem_to_char: dict[int, int] = {}
    session_to_code: dict[int, str] = {}

    try:
        async with async_session() as db:
            if need_char_ids:
                q = await db.execute(
                    select(Character.id, Character.session_id).where(
                        Character.id.in_(need_char_ids)
                    )
                )
                for cid, sid in q.all():
                    if sid is None:
                        continue
                    char_to_session[cid] = sid
                    direct_session_ids.add(sid)

            if need_combat_ids:
                q = await db.execute(
                    select(CombatEvent.id, CombatEvent.session_id).where(
                        CombatEvent.id.in_(need_combat_ids)
                    )
                )
                for ceid, sid in q.all():
                    if sid is None:
                        continue
                    combat_to_session[ceid] = sid
                    direct_session_ids.add(sid)

            if need_invitem_ids:
                q = await db.execute(
                    select(InventoryItem.id, InventoryItem.character_id).where(
                        InventoryItem.id.in_(need_invitem_ids)
                    )
                )
                rows = q.all()
                for iid, cid in rows:
                    if cid is None:
                        continue
                    invitem_to_char[iid] = cid
                    need_char_ids.add(cid)
                # Second-pass: resolve the newly-added chars
                if rows:
                    q2 = await db.execute(
                        select(Character.id, Character.session_id).where(
                            Character.id.in_({cid for _, cid in rows if cid})
                        )
                    )
                    for cid2, sid2 in q2.all():
                        if sid2:
                            char_to_session[cid2] = sid2
                            direct_session_ids.add(sid2)

            if direct_session_ids:
                q = await db.execute(
                    select(SessionModel.id, SessionModel.code).where(
                        SessionModel.id.in_(direct_session_ids)
                    )
                )
                for sid, code in q.all():
                    session_to_code[sid] = code
    except Exception as e:
        logger.warning("realtime broadcast resolve failed: %s", e)
        return

    # Build per-session payloads. Dedup by (label, character_id, combat_event_id).
    per_session: dict[str, list[dict]] = {}
    seen_per_session: dict[str, set[tuple]] = {}

    def _emit(code: str, b: dict) -> None:
        key = (
            b["label"],
            int(b.get("character_id") or 0),
            int(b.get("combat_event_id") or 0),
        )
        sseen = seen_per_session.setdefault(code, set())
        if key in sseen:
            return
        sseen.add(key)
        per_session.setdefault(code, []).append({
            "entity": b["label"],
            "character_id": b.get("character_id"),
            "combat_event_id": b.get("combat_event_id"),
            "inventory_item_id": b.get("inventory_item_id"),
            "action": b["action"],
        })

    for b in buf:
        sid = b.get("session_id")
        if sid is None:
            # Try via character / combat / inventory item.
            cid = b.get("character_id")
            if cid and cid in char_to_session:
                sid = char_to_session[cid]
            if sid is None:
                ceid = b.get("combat_event_id")
                if ceid and ceid in combat_to_session:
                    sid = combat_to_session[ceid]
            if sid is None:
                iid = b.get("inventory_item_id")
                if iid and iid in invitem_to_char:
                    cid2 = invitem_to_char[iid]
                    sid = char_to_session.get(cid2)
                    # Backfill character_id into the payload so the
                    # client can decide whether it cares.
                    if b.get("character_id") is None:
                        b["character_id"] = cid2

        if sid:
            code = session_to_code.get(int(sid))
            if code:
                _emit(code, b)

    # Global templates (session_id explicitly None) go to every
    # currently-connected session so any GM looking at that catalog
    # sees the change live.
    if global_entries:
        active_codes = list(manager._connections.keys())
        for code in active_codes:
            for b in global_entries:
                _emit(code, b)

    # Fan out.
    for code, items in per_session.items():
        try:
            await manager.broadcast_to_session(
                code, "entity.invalidated", {"changes": items}
            )
        except Exception as e:
            logger.warning("realtime broadcast send failed for %s: %s", code, e)


logger.info("realtime dispatcher loaded")
