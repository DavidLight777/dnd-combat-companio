"""WebSocket connection endpoint."""

import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends

logger = logging.getLogger("websocket")
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

                elif msg_type == "inventory.gm_buyback" and role == "gm":
                    await manager.broadcast_to_session(session_code, "inventory.gm_buyback", {
                        "character_id": msg.get("character_id"),
                        "item_name": msg.get("item_name"),
                        "price_display": msg.get("price_display"),
                    })

                elif msg_type == "combat.attack_result":
                    await manager.broadcast_to_session(session_code, "combat.attack_result", msg)

                # Combat FX: ability resolution (hit / miss / crit / fumble
                # with optional damage). Fired by the player client right
                # after POST /api/character-abilities/{id}/use succeeds so
                # every other client plays the matching map animation.
                elif msg_type in ("combat.ability_result", "combat.hit_result"):
                    await manager.broadcast_to_session(session_code, msg_type, msg)

                elif msg_type == "combat.character_downed":
                    await manager.broadcast_to_session(session_code, "combat.character_downed", msg)

                elif msg_type in ("combat.defense_request", "combat.defense_resolved"):
                    await manager.broadcast_to_session(session_code, msg_type, {
                        k: v for k, v in msg.items() if k != "type"
                    })

                elif msg_type == "table.updated":
                    await manager.broadcast_to_session(session_code, "table.updated", msg)

                # FIX 7: Player dismissed a GM-initiated trade modal
                elif msg_type == "trade.dismissed":
                    # Relay to GM only — so GM sees in roll log
                    await manager.send_to_gm(session_code, "trade.dismissed", {
                        "trade_id": msg.get("trade_id"),
                        "player_id": msg.get("player_id"),
                        "player_name": msg.get("player_name"),
                        "npc_id": msg.get("npc_id"),
                        "npc_name": msg.get("npc_name"),
                        "reason": msg.get("reason", "unknown"),
                    })

                elif msg_type == "modifier.expired":
                    await manager.broadcast_to_session(session_code, "modifier.expired", {
                        "character_id": msg.get("character_id"),
                        "modifier_name": msg.get("modifier_name"),
                        "stat_name": msg.get("stat_name"),
                    })

                elif msg_type == "item.used":
                    await manager.broadcast_to_session(session_code, "item.used", msg)

                elif msg_type == "mana.updated":
                    await manager.broadcast_to_session(session_code, "mana.updated", {
                        "character_id": msg.get("character_id"),
                        "mana_current": msg.get("mana_current"),
                        "mana_max": msg.get("mana_max"),
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
                    await manager.broadcast_to_session(session_code, "combat.timer_started", {
                        "character_id": msg.get("player_id"),
                        "duration_seconds": msg.get("duration_seconds"),
                        "combat_id": msg.get("combat_id"),
                    })

                elif msg_type == "gm.timer":
                    await manager.broadcast_to_session(session_code, "gm.timer", {
                        "character_id": msg.get("character_id"),
                        "duration_seconds": msg.get("duration_seconds"),
                    })

                elif msg_type == "gm.timer_stop":
                    await manager.broadcast_to_session(session_code, "gm.timer_stop", {
                        "character_id": msg.get("character_id"),
                    })

                # Stage 11: Combat action events
                elif msg_type in ("combat.attack_result", "combat.defend", "combat.character_killed"):
                    await manager.broadcast_to_session(session_code, msg_type, {
                        k: v for k, v in msg.items() if k != "type"
                    })

                # Stage 10: Announcements & timer events
                elif msg_type in ("announcement.posted", "announcement.pinned", "announcement.deleted",
                                  "session.timer_started", "session.timer_paused"):
                    await manager.broadcast_to_session(session_code, msg_type, {
                        k: v for k, v in msg.items() if k != "type"
                    })

                # Stage 9: Map drawing/marker events
                elif msg_type in ("map.drawing_added", "map.drawing_deleted", "map.marker_added", "map.marker_updated", "map.marker_deleted"):
                    await manager.broadcast_to_session(session_code, msg_type, {
                        k: v for k, v in msg.items() if k != "type"
                    })

                # Stage 8: Quest events
                elif msg_type in ("quest.assigned", "quest.stage_completed", "quest.completed", "quest.failed"):
                    await manager.broadcast_to_session(session_code, msg_type, {
                        k: v for k, v in msg.items() if k != "type"
                    })

                # Stage 7: Characteristic roll broadcast
                elif msg_type == "roll.characteristic":
                    await manager.broadcast_to_session(session_code, "roll.characteristic", {
                        "character_id": msg.get("character_id"),
                        "character_name": msg.get("character_name"),
                        "stat": msg.get("stat"),
                        "d20": msg.get("d20"),
                        "modifier": msg.get("modifier"),
                        "total": msg.get("total"),
                        "roll_type": msg.get("roll_type"),
                        "description": msg.get("description"),
                    })

                # FIX 4: Free dice roll — any dice/count/advantage; optional private
                # If private=True → send only to the author's token (so GM does NOT see it).
                # Otherwise broadcast to all (GM roll log shows it).
                elif msg_type == "roll.free_roll":
                    payload = {
                        "character_id": msg.get("character_id"),
                        "character_name": msg.get("character_name"),
                        "dice_count": msg.get("dice_count"),
                        "dice_type": msg.get("dice_type"),
                        "advantage_mode": msg.get("advantage_mode", "normal"),
                        "rolls": msg.get("rolls", []),
                        "total": msg.get("total"),
                        "breakdown": msg.get("breakdown", ""),
                        "private": bool(msg.get("private", False)),
                    }
                    if payload["private"]:
                        # Private → only echo back to sender
                        await manager.send_to_token(session_code, token, "roll.free_roll", payload)
                    else:
                        await manager.broadcast_to_session(session_code, "roll.free_roll", payload)

            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        conn_info, code = manager.disconnect(websocket)
        if conn_info:
            await manager.broadcast_to_session(session_code, "session.player_disconnected", {
                "role": conn_info["role"],
                "connected_count": manager.count_connected(session_code),
            })
