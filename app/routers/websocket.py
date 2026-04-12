"""WebSocket connection endpoint."""

import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session as get_db_session, async_session
from app.models import Session, Character
from app.websocket_manager import manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/{session_code}")
async def websocket_endpoint(websocket: WebSocket, session_code: str, token: str = ""):
    if not token:
        await websocket.close(code=4001, reason="Token required")
        return

    # Determine role (gm or player) from token
    async with async_session() as db:
        result = await db.execute(select(Session).where(Session.code == session_code))
        session = result.scalar_one_or_none()
        if not session:
            await websocket.close(code=4004, reason="Session not found")
            return

        if token == session.gm_token:
            role = "gm"
        else:
            # Check if token belongs to a player in this session
            char_result = await db.execute(
                select(Character).where(
                    Character.session_id == session.id,
                    Character.player_token == token,
                )
            )
            char = char_result.scalar_one_or_none()
            if not char:
                await websocket.close(code=4003, reason="Invalid token")
                return
            role = "player"

    await manager.connect(websocket, session_code, token, role)

    # Send initial state
    async with async_session() as db:
        result = await db.execute(select(Session).where(Session.code == session_code))
        session = result.scalar_one_or_none()
        chars_result = await db.execute(
            select(Character).where(Character.session_id == session.id)
        )
        chars = chars_result.scalars().all()

        state = {
            "session": {
                "id": session.id,
                "code": session.code,
                "name": session.name,
                "status": session.status,
                "turn_number": session.turn_number,
            },
            "characters": [
                {
                    "id": c.id,
                    "name": c.name,
                    "is_npc": c.is_npc,
                    "current_hp": c.current_hp,
                    "max_hp": c.max_hp,
                    "armor_class": c.armor_class,
                    "is_alive": c.is_alive,
                    "token_color": c.token_color,
                }
                for c in chars
            ],
            "your_role": role,
            "connected_count": manager.count_connected(session_code),
        }

    await manager.send_to_token(session_code, token, "session.state", state)

    # Broadcast join
    await manager.broadcast_to_session(session_code, "session.player_joined", {
        "role": role,
        "connected_count": manager.count_connected(session_code),
    })

    # Listen for messages
    try:
        while True:
            data = await websocket.receive_text()
            # For now, just echo or log. Future stages add message handling.
            try:
                msg = json.loads(data)
                event = msg.get("event", "")
                # Route messages based on event type (Stage 2+)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        conn_info, code = manager.disconnect(websocket)
        if conn_info:
            await manager.broadcast_to_session(session_code, "session.player_disconnected", {
                "role": conn_info["role"],
                "connected_count": manager.count_connected(session_code),
            })
