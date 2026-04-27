"""
WebSocket Connection Manager.
Manages all active WS connections grouped by session code.
"""

import json
import logging
from datetime import UTC, datetime

from fastapi import WebSocket

logger = logging.getLogger("ws_manager")


class ConnectionManager:
    def __init__(self):
        # session_code -> list of {"ws": WebSocket, "token": str, "role": str}
        self._connections: dict[str, list[dict]] = {}

    async def connect(self, websocket: WebSocket, session_code: str, token: str, role: str):
        await websocket.accept()
        if session_code not in self._connections:
            self._connections[session_code] = []
        self._connections[session_code].append({
            "ws": websocket, "token": token, "role": role,
        })
        logger.info(f"WS connected: {role} token={token[:8]}... session={session_code}")

    def disconnect(self, websocket: WebSocket):
        for code, conns in self._connections.items():
            for conn in conns:
                if conn["ws"] is websocket:
                    conns.remove(conn)
                    logger.info(f"WS disconnected: {conn['role']} token={conn['token'][:8]}... session={code}")
                    return conn, code
        return None, None

    def get_connections(self, session_code: str) -> list[dict]:
        return self._connections.get(session_code, [])

    async def broadcast_to_session(self, session_code: str, event: str, data: dict):
        message = json.dumps({
            "event": event,
            "data": data,
            "timestamp": datetime.now(UTC).isoformat(),
        })
        dead = []
        for conn in self._connections.get(session_code, []):
            try:
                await conn["ws"].send_text(message)
            except Exception as e:
                logger.warning(f"WS send failed for {conn['token'][:8]}...: {e}")
                dead.append(conn)
        for d in dead:
            self._connections[session_code].remove(d)

    async def send_to_token(self, session_code: str, token: str, event: str, data: dict):
        message = json.dumps({
            "event": event,
            "data": data,
            "timestamp": datetime.now(UTC).isoformat(),
        })
        conns = self._connections.get(session_code, [])
        dead = []
        sent = False
        for conn in conns:
            if conn["token"] == token:
                try:
                    await conn["ws"].send_text(message)
                    sent = True
                except Exception as e:
                    logger.warning(f"WS send_to_token failed: {e}")
                    dead.append(conn)
        for d in dead:
            conns.remove(d)
        return sent

    async def send_to_gm(self, session_code: str, event: str, data: dict):
        message = json.dumps({
            "event": event,
            "data": data,
            "timestamp": datetime.now(UTC).isoformat(),
        })
        for conn in self._connections.get(session_code, []):
            if conn["role"] == "gm":
                try:
                    await conn["ws"].send_text(message)
                except Exception as e:
                    logger.warning(f"WS send_to_gm failed: {e}")
                return

    def count_connected(self, session_code: str) -> int:
        return len(self._connections.get(session_code, []))

    # ──────────────────────────────────────────────────────────
    # Legacy shim: older routers call `manager.broadcast(session_id, msg)`
    # with a full dict containing an "event" key. This method resolves
    # session_id → session_code via DB and delegates to broadcast_to_session.
    # Without this, those callers silently fail (no-op) because there is no
    # `broadcast` method on the class — AttributeError was being swallowed
    # by try/except in the callers.
    # ──────────────────────────────────────────────────────────
    async def broadcast(self, session_id, msg: dict):
        """Legacy shim. Accepts session_id (int) or session_code (str).

        `msg` is expected to be a dict with an "event" key; remaining keys
        become the payload `data`.
        """
        if not isinstance(msg, dict):
            logger.warning("broadcast() called with non-dict msg, ignoring")
            return
        event = msg.get("event")
        if not event:
            logger.warning("broadcast() called without 'event' key, ignoring")
            return
        data = {k: v for k, v in msg.items() if k != "event"}

        # Fast path: caller already passed a session_code string.
        if isinstance(session_id, str):
            await self.broadcast_to_session(session_id, event, data)
            return

        # Resolve int session_id → session_code via DB lookup.
        try:
            from app.database import async_session
            from app.models import Session as SessionModel
            async with async_session() as db:
                sess = await db.get(SessionModel, session_id)
                if not sess:
                    logger.warning(f"broadcast(): session_id={session_id} not found")
                    return
                code = sess.code
            await self.broadcast_to_session(code, event, data)
        except Exception as e:
            logger.warning(f"broadcast() shim failed (session_id={session_id}): {e}")


manager = ConnectionManager()
