"""AI Agent — context builder, OpenRouter integration, envelope dispatcher.

Rework v3 redesign
==================
Before this pass the agent was a thin wrapper over OpenRouter that dumped a
bulky English game-state summary into the system prompt and returned free-form
markdown. The GM frontend then regex-matched anything that looked like
``{"name": ...}`` and force-POSTed it to ``/api/items`` — which is why asking
for a new NPC would silently create a useless item row.

Now the agent speaks a strict JSON envelope:

    { "say": "<short>", "actions": [ {"kind": "...", "payload": {...}} ] }

``kind`` ∈ ``create_item`` | ``create_npc`` | ``create_ability``. The dispatcher
validates each payload and calls the real create endpoints in-process so the
AI can build properly-shaped rows (with stats, bonuses, damage dice, passive
effects, …) instead of one-liner blobs. See ``ai_system_prompt.txt`` for the
full contract sent to the model.
"""

from __future__ import annotations

import os
import json
import httpx
from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Session,
    Character,
    InventoryItem,
    Item,
    CombatLog,
    AIConversation,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPT_PATH = os.path.join(BASE_DIR, "ai_system_prompt.txt")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Hard caps so a bad LLM reply can't blow up the DB / front-end.
MAX_ACTIONS_PER_REPLY = 8
MAX_SAY_LEN = 1200


# ═════════════════════════════════════════════════════════════════
# Config / prompt loaders
# ═════════════════════════════════════════════════════════════════
def _load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _load_system_prompt() -> str:
    if os.path.exists(PROMPT_PATH):
        with open(PROMPT_PATH, encoding="utf-8") as f:
            return f.read().strip()
    return "You are ARIA, a helpful tabletop RPG assistant."


# ═════════════════════════════════════════════════════════════════
# Context builder — TOKEN-ECONOMY edition
# ═════════════════════════════════════════════════════════════════
# The old builder dumped every stat of every character + inventory + the last
# 10 combat log lines on every request. That's ~200-400 tokens *per turn* of
# conversation that the user never asked for. The new version keeps just
# enough for the AI to address characters by name / HP silhouette; equipped
# items and combat-log bloat are gone.
async def build_game_context(session_id: int, db: AsyncSession) -> str:
    session = await db.get(Session, session_id)
    if not session:
        return "No active session."

    chars_result = await db.execute(
        select(Character).where(Character.session_id == session_id)
    )
    chars = list(chars_result.scalars().all())

    lines: list[str] = [
        f"Session: {session.name} (code {session.code}) · turn {session.turn_number}",
    ]
    players = [c for c in chars if not c.is_npc]
    npcs = [c for c in chars if c.is_npc]

    if players:
        lines.append("Players: " + ", ".join(
            f"{c.name} L{c.level} HP{c.current_hp}/{c.max_hp}"
            + ("" if c.is_alive else " †")
            for c in players
        ))
    if npcs:
        lines.append("NPCs: " + ", ".join(
            f"{c.name} HP{c.current_hp}/{c.max_hp}"
            + ("" if c.is_alive else " †")
            for c in npcs
        ))

    # Last 3 combat log lines — enough to keep narrative continuity, cheap.
    log_result = await db.execute(
        select(CombatLog)
        .where(CombatLog.session_id == session_id)
        .order_by(CombatLog.timestamp.desc())
        .limit(3)
    )
    logs = list(log_result.scalars().all())
    if logs:
        lines.append("Recent: " + " | ".join(
            f"[{e.event_type}] {e.description}" for e in reversed(logs)
        ))

    return "\n".join(lines)


async def get_conversation_history(session_id: int, db: AsyncSession, limit: int = 14) -> list[dict]:
    """Last N conversation messages in chronological order.

    Default trimmed from 20 → 14 to curb token growth over long sessions.
    """
    result = await db.execute(
        select(AIConversation)
        .where(AIConversation.session_id == session_id)
        .order_by(AIConversation.created_at.desc())
        .limit(limit)
    )
    entries = list(result.scalars().all())
    return [{"role": e.role, "content": e.content} for e in reversed(entries)]


# ═════════════════════════════════════════════════════════════════
# Envelope parser — strip fences, tolerate chatty models
# ═════════════════════════════════════════════════════════════════
def parse_envelope(raw: str) -> tuple[str, list[dict], str | None]:
    """Return ``(say, actions, error)``.

    If ``error`` is non-null the raw text should be treated as plain chat.
    Clamps ``actions`` to ``MAX_ACTIONS_PER_REPLY`` and filters action shape
    (``{"kind": str, "payload": dict}``) so bad output can never reach the DB.
    """
    if not raw or not raw.strip():
        return "", [], "empty reply"

    txt = raw.strip()
    # Strip ``` fences a helpful model might add anyway.
    if txt.startswith("```"):
        # remove first line (``` or ```json)
        parts = txt.split("\n", 1)
        txt = parts[1] if len(parts) > 1 else ""
        if txt.endswith("```"):
            txt = txt[: -3]
        txt = txt.strip()

    # Some models wrap the envelope in extra prose. Find the first balanced { }.
    if not txt.startswith("{"):
        start = txt.find("{")
        if start == -1:
            return txt[:MAX_SAY_LEN], [], "no-json-fallback"
        depth = 0
        end = -1
        for i in range(start, len(txt)):
            ch = txt[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end == -1:
            return txt[:MAX_SAY_LEN], [], "unbalanced-json-fallback"
        txt = txt[start:end]

    try:
        env = json.loads(txt)
    except json.JSONDecodeError as e:
        return raw[:MAX_SAY_LEN], [], f"bad-json: {e.msg}"

    if not isinstance(env, dict):
        return raw[:MAX_SAY_LEN], [], "envelope-not-object"

    say = str(env.get("say") or "")[:MAX_SAY_LEN]
    raw_actions = env.get("actions") or []
    if not isinstance(raw_actions, list):
        raw_actions = []

    clean: list[dict] = []
    for a in raw_actions[:MAX_ACTIONS_PER_REPLY]:
        if not isinstance(a, dict):
            continue
        kind = a.get("kind")
        payload = a.get("payload")
        if kind in ("create_item", "create_npc", "create_ability") and isinstance(payload, dict):
            clean.append({"kind": kind, "payload": payload})
    return say, clean, None


# ═════════════════════════════════════════════════════════════════
# Dispatcher — turns validated actions into real DB rows.
# Imports live inside the functions so this module stays import-cheap
# during test collection (no FastAPI app spun up).
# ═════════════════════════════════════════════════════════════════
async def _dispatch_create_item(session_id: int, payload: dict, db: AsyncSession) -> dict:
    from app.routers.inventory import _sanitize_damage_modes
    from app.models import ItemBonus, ItemWeaponStats

    # Force session scope + AI attribution; everything else is GM-set or default.
    is_potion = bool(payload.get("is_potion", False))
    consumable = bool(payload.get("consumable", False)) or is_potion
    equippable = bool(payload.get("equippable", False)) and not is_potion

    price_b = payload.get("base_price_bronze")
    if price_b is None:
        price_b = int(payload.get("base_price", 0) or 0) * 100

    use_effect = payload.get("use_effect")
    if isinstance(use_effect, (dict, list)):
        use_effect_raw = json.dumps(use_effect)
    else:
        use_effect_raw = use_effect

    tags = payload.get("tags", [])
    tags_raw = tags if isinstance(tags, str) else json.dumps(tags)

    item = Item(
        session_id=session_id,
        name=str(payload.get("name", "Item"))[:120],
        description=str(payload.get("description", ""))[:2000],
        category=str(payload.get("category", "misc"))[:30],
        rarity=str(payload.get("rarity", "common"))[:20],
        base_price=int(price_b) // 100,
        base_price_bronze=int(price_b),
        equippable=equippable,
        consumable=consumable,
        mana_cost=int(payload.get("mana_cost", 0) or 0),
        use_effect=use_effect_raw,
        tags=tags_raw,
        created_by_ai=True,
        is_potion=is_potion,
        potion_icon=str(payload.get("potion_icon", "🧪"))[:8],
    )
    db.add(item)
    await db.flush()

    for b in (payload.get("bonuses") or []):
        if not isinstance(b, dict) or "bonus_type" not in b:
            continue
        db.add(ItemBonus(
            item_id=item.id,
            bonus_type=str(b["bonus_type"])[:40],
            stat_name=(str(b["stat_name"])[:20] if b.get("stat_name") else None),
            value=int(b.get("value", 0) or 0),
            is_conditional=bool(b.get("is_conditional", False)),
            condition_description=(str(b["condition_description"])[:200]
                                   if b.get("condition_description") else None),
        ))

    ws = payload.get("weapon_stats")
    if isinstance(ws, dict) and item.category == "weapon":
        wp = ws.get("weapon_properties", [])
        wp_raw = wp if isinstance(wp, str) else json.dumps(wp or [])
        db.add(ItemWeaponStats(
            item_id=item.id,
            dice_count=max(1, int(ws.get("dice_count", 1) or 1)),
            dice_type=max(2, int(ws.get("dice_type", 6) or 6)),
            damage_type=str(ws.get("damage_type", "physical"))[:20],
            range=(str(ws.get("range"))[:40] if ws.get("range") else None),
            weapon_range=str(ws.get("weapon_range", "melee"))[:10],
            weapon_properties=wp_raw,
            hit_stat=str(ws.get("hit_stat", "strength"))[:20],
            damage_stat=(str(ws.get("damage_stat"))[:20]
                         if ws.get("damage_stat") is not None else "strength"),
            damage_modes=json.dumps(_sanitize_damage_modes(ws.get("damage_modes"))),
        ))

    await db.commit()
    await db.refresh(item)
    return {"kind": "create_item", "ok": True, "id": item.id, "name": item.name,
            "category": item.category, "rarity": item.rarity}


async def _dispatch_create_npc(session_id: int, payload: dict, db: AsyncSession) -> dict:
    max_hp = max(1, int(payload.get("max_hp", 20) or 20))
    current_hp = int(payload.get("current_hp", max_hp) or max_hp)
    current_hp = max(0, min(max_hp, current_hp))

    def _stat(k: str, d: int = 0) -> int:
        v = payload.get(k)
        try:
            iv = int(v) if v is not None else d
        except (TypeError, ValueError):
            iv = d
        return max(0, min(20, iv))

    npc = Character(
        session_id=session_id,
        name=str(payload.get("name", "NPC"))[:80],
        is_npc=True,
        is_gm_controlled=bool(payload.get("is_gm_controlled", True)),
        is_alive=True,
        armor_class=max(0, int(payload.get("armor_class", 10) or 10)),
        max_hp=max_hp,
        current_hp=current_hp,
        strength=_stat("strength"),
        dexterity=_stat("dexterity"),
        constitution=_stat("constitution"),
        intelligence=_stat("intelligence"),
        wisdom=_stat("wisdom"),
        charisma=_stat("charisma"),
        initiative_bonus=int(payload.get("initiative_bonus", 0) or 0),
        mana_current=int(payload.get("mana_current", payload.get("mana_max", 0) or 0) or 0),
        mana_max=int(payload.get("mana_max", 0) or 0),
        mana_regen_per_turn=int(payload.get("mana_regen_per_turn", 0) or 0),
        level=max(0, int(payload.get("level", 0) or 0)),
        gold=max(0, int(payload.get("gold", 0) or 0)),
        token_color=str(payload.get("token_color", "#c08a2a"))[:16],
        notes=str(payload.get("notes", ""))[:2000],
        gm_notes=str(payload.get("gm_notes", ""))[:2000],
        place_at_table=bool(payload.get("place_at_table", False)),
        show_hp_to_players=bool(payload.get("show_hp_to_players", False)),
    )
    db.add(npc)
    await db.commit()
    await db.refresh(npc)
    return {"kind": "create_npc", "ok": True, "id": npc.id, "name": npc.name,
            "max_hp": npc.max_hp, "armor_class": npc.armor_class}


async def _dispatch_create_ability(session_id: int, payload: dict, db: AsyncSession) -> dict:
    from app.models import Ability

    def _dumps(v):
        if v is None:
            return None
        if isinstance(v, str):
            return v
        return json.dumps(v)

    tags = payload.get("tags", [])
    tags_raw = tags if isinstance(tags, str) else json.dumps(tags or [])
    ability_type = str(payload.get("ability_type", "active"))[:20]
    is_passive = bool(payload.get("is_passive", ability_type == "passive"))

    ab = Ability(
        session_id=session_id,
        name=str(payload.get("name", "Ability"))[:80],
        description=str(payload.get("description", ""))[:2000],
        icon=str(payload.get("icon", "⚡"))[:8],
        color=str(payload.get("color", ""))[:16],
        flavor_text=str(payload.get("flavor_text", ""))[:600],
        notes=str(payload.get("notes", ""))[:2000],
        tags=tags_raw,
        ability_type=ability_type,
        target_type=str(payload.get("target_type", "self"))[:20],
        aoe_radius=int(payload.get("aoe_radius", 0) or 0),
        damage_type=str(payload.get("damage_type", "physical"))[:20],
        custom_damage_type=str(payload.get("custom_damage_type", ""))[:40] or None,
        mana_cost=int(payload.get("mana_cost", 0) or 0),
        hp_cost=int(payload.get("hp_cost", 0) or 0),
        cooldown_turns=int(payload.get("cooldown_turns", 0) or 0),
        requires_hit_roll=bool(payload.get("requires_hit_roll", False)),
        hit_stat=str(payload.get("hit_stat", "strength"))[:20] or None,
        damage_stat=(str(payload.get("damage_stat"))[:20]
                     if payload.get("damage_stat") is not None else None),
        damage_dice_count=(int(payload["damage_dice_count"])
                           if payload.get("damage_dice_count") is not None else None),
        damage_dice_type=(int(payload["damage_dice_type"])
                          if payload.get("damage_dice_type") is not None else None),
        is_passive=is_passive,
        passive_effect=_dumps(payload.get("passive_effect")),
        effect=_dumps(payload.get("effect")),
        range=str(payload.get("range", ""))[:40] or None,
        rarity=str(payload.get("rarity", "common"))[:20],
        is_in_starting_pool=bool(payload.get("is_in_starting_pool", False)),
        max_uses=(int(payload["max_uses"])
                  if payload.get("max_uses") is not None else None),
        is_conditional=bool(payload.get("is_conditional", False)),
        conditional_text=str(payload.get("conditional_text", ""))[:600] or None,
    )
    db.add(ab)
    await db.commit()
    await db.refresh(ab)
    return {"kind": "create_ability", "ok": True, "id": ab.id, "name": ab.name,
            "ability_type": ab.ability_type, "target_type": ab.target_type,
            "rarity": ab.rarity}


_DISPATCH = {
    "create_item": _dispatch_create_item,
    "create_npc": _dispatch_create_npc,
    "create_ability": _dispatch_create_ability,
}


async def run_actions(session_id: int, actions: list[dict], db: AsyncSession) -> list[dict]:
    """Execute each validated action and collect per-row results / errors."""
    results: list[dict] = []
    for a in actions:
        fn = _DISPATCH.get(a["kind"])
        if not fn:
            results.append({"kind": a["kind"], "ok": False, "error": "unknown-kind"})
            continue
        try:
            res = await fn(session_id, a["payload"], db)
            results.append(res)
        except Exception as e:  # noqa: BLE001 — we want to keep the chat alive
            await db.rollback()
            results.append({
                "kind": a["kind"],
                "ok": False,
                "error": f"{type(e).__name__}: {str(e)[:240]}",
            })
    return results


# ═════════════════════════════════════════════════════════════════
# OpenRouter call
# ═════════════════════════════════════════════════════════════════
async def _call_openrouter(messages: list[dict], config: dict) -> tuple[str | None, str | None]:
    """Returns ``(reply, error)``. Kept separate so tests can monkeypatch it."""
    api_key = config.get("openrouter_api_key", "")
    if not api_key:
        return None, "Set your OpenRouter API key in config.json (field: openrouter_api_key)"
    model = config.get("ai_model", "google/gemma-3-27b-it:free")
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                OPENROUTER_URL,
                headers={"Authorization": f"Bearer {api_key}",
                         "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": messages,
                    # Lower temp → tighter JSON from weak models.
                    "temperature": float(config.get("ai_temperature", 0.6)),
                    # Hint for capable models; ignored otherwise.
                    "response_format": {"type": "json_object"},
                },
            )
        if resp.status_code != 200:
            return None, f"AI API error ({resp.status_code}): {resp.text[:200]}"
        data = resp.json()
        reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not reply:
            return None, "AI returned empty response"
        return reply, None
    except httpx.TimeoutException:
        return None, "AI request timed out (60s). Try again."
    except Exception as e:  # noqa: BLE001
        return None, f"AI request failed: {str(e)[:200]}"


async def chat_with_ai(session_id: int, user_message: str, db: AsyncSession) -> dict:
    """Main entry point for ``POST /api/ai/chat``.

    Returns a structured envelope:

        {
          "reply":   "<original assistant text, preserved for chat pane>",
          "say":     "<parsed short narration>",
          "actions": [ {kind, ok, id?, name?, error?}, ... ],
          "error":   "<only if the whole call failed>"
        }
    """
    config = _load_config()
    system_prompt = _load_system_prompt()
    context = await build_game_context(session_id, db)
    history = await get_conversation_history(session_id, db)

    messages: list[dict] = [
        {"role": "system", "content": f"{system_prompt}\n\n---\nCURRENT STATE\n{context}"},
    ]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    # Save user turn up-front so even a failed LLM call keeps the transcript.
    db.add(AIConversation(session_id=session_id, role="user", content=user_message))
    await db.commit()

    reply, err = await _call_openrouter(messages, config)
    if err:
        return {"error": err}

    say, actions, parse_err = parse_envelope(reply)

    # If the model produced a plain-text reply, fall back to "say" = reply so
    # the GM still sees *something* while the transcript is preserved verbatim.
    if parse_err and not say:
        say = reply[:MAX_SAY_LEN]

    results = await run_actions(session_id, actions, db)

    # Persist only the model's raw text — the client can always re-derive.
    db.add(AIConversation(session_id=session_id, role="assistant", content=reply))
    await db.commit()

    return {
        "reply": reply,
        "say": say,
        "actions": results,
        "parse_error": parse_err,
    }
