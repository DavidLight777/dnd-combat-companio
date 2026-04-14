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
            try:
                msg = json.loads(data)
                msg_type = msg.get("type", "")

                # Stage 3: GM broadcasts trade events to target player
                if msg_type == "trade.initiated" and role == "gm":
                    player_id = msg.get("player_id")
                    # Find player token and forward
                    async with async_session() as db:
                        char_result = await db.execute(
                            select(Character).where(Character.id == player_id)
                        )
                        target_char = char_result.scalar_one_or_none()
                        if target_char and target_char.player_token:
                            await manager.send_to_token(session_code, target_char.player_token, "trade.initiated", {
                                "trade_id": msg.get("trade_id"),
                                "npc_id": msg.get("npc_id"),
                                "npc_name": msg.get("npc_name"),
                                "player_id": player_id,
                            })

                elif msg_type == "trade.closed" and role == "gm":
                    await manager.broadcast_to_session(session_code, "trade.closed", {
                        "trade_id": msg.get("trade_id"),
                    })

                elif msg_type == "currency.updated":
                    await manager.broadcast_to_session(session_code, "currency.updated", {
                        "character_id": msg.get("character_id"),
                    })

                # Stage 4: Status effect events
                elif msg_type in ("status_effect.applied", "status_effect.removed", "status_effect.expired"):
                    await manager.broadcast_to_session(session_code, msg_type, {
                        "character_id": msg.get("character_id"),
                        "effect_name": msg.get("effect_name", ""),
                    })

                # Stage 5: Combat events
                elif msg_type == "combat.roll_initiative_request":
                    # Send initiative roll request to specific player tokens
                    player_ids = msg.get("player_ids", [])
                    combat_id = msg.get("combat_id")
                    async with async_session() as db:
                        for pid in player_ids:
                            char_result = await db.execute(
                                select(Character).where(Character.id == pid)
                            )
                            target_char = char_result.scalar_one_or_none()
                            if target_char and target_char.player_token:
                                await manager.send_to_token(session_code, target_char.player_token, "combat.roll_initiative_request", {
                                    "combat_id": combat_id,
                                    "character_id": pid,
                                    "initiative_bonus": msg.get("bonuses", {}).get(str(pid), 0),
                                })

                elif msg_type == "combat.initiative_submitted":
                    # Forward to GM
                    await manager.send_to_gm(session_code, "combat.initiative_submitted", {
                        "combat_id": msg.get("combat_id"),
                        "character_id": msg.get("character_id"),
                        "roll": msg.get("roll"),
                        "final": msg.get("final"),
                    })

                elif msg_type in ("combat.created", "combat.started", "combat.turn_changed", "combat.ended"):
                    await manager.broadcast_to_session(session_code, msg_type, msg.get("data", {}))

                elif msg_type == "combat.timer_started":
                    target_pid = msg.get("player_id")
                    async with async_session() as db:
                        char_result = await db.execute(
                            select(Character).where(Character.id == target_pid)
                        )
                        target_char = char_result.scalar_one_or_none()
                        if target_char and target_char.player_token:
                            await manager.send_to_token(session_code, target_char.player_token, "combat.timer_started", {
                                "duration_seconds": msg.get("duration_seconds"),
                                "combat_id": msg.get("combat_id"),
                            })
                    # Also send to GM
                    await manager.send_to_gm(session_code, "combat.timer_started", {
                        "player_id": target_pid,
                        "duration_seconds": msg.get("duration_seconds"),
                    })

            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        conn_info, code = manager.disconnect(websocket)
        if conn_info:
            await manager.broadcast_to_session(session_code, "session.player_disconnected", {
                "role": conn_info["role"],
                "connected_count": manager.count_connected(session_code),
            })
