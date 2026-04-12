"""
WebSocket Connection Manager.
Manages all active WS connections grouped by session code.
"""

import json
import logging
from datetime import datetime, timezone
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
            "timestamp": datetime.now(timezone.utc).isoformat(),
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
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        for conn in self._connections.get(session_code, []):
            if conn["token"] == token:
                try:
                    await conn["ws"].send_text(message)
                except Exception as e:
                    logger.warning(f"WS send_to_token failed: {e}")
                return

    async def send_to_gm(self, session_code: str, event: str, data: dict):
        message = json.dumps({
            "event": event,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
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


manager = ConnectionManager()
