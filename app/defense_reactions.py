"""Defense reaction registry — asyncio.Event-based pending defense store.

When a hit-roll (or ability use) succeeds with a normal hit (not crit/fumble),
a PendingDefense record is created.  The defender (player or GM for NPC) resolves
it via POST /api/combat/defense/{id}/resolve choosing:
  * "ac"         — accept on static Armor Class
  * "dodge_dex"  — roll d20 + DEX modifier vs attack total
  * "dodge_con"  — roll d20 + CON modifier vs attack total

If defense_total >= attack_total the incoming damage is completely negated.
Critical hits bypass defense unless special ability/item flags are added later.
"""

import asyncio
import random
import uuid
from dataclasses import dataclass, field
from typing import Optional

from app.game_mechanics import stat_modifier
from app.websocket_manager import manager


@dataclass
class PendingDefense:
    id: str
    attacker_id: int
    target_id: int
    session_id: int
    session_code: str
    attack_total: int
    attack_roll_d20: int
    attacker_name: str
    target_name: str
    target_ac: int
    critical: bool
    fumble: bool
    hit: bool
    weapon_name: Optional[str] = None

    # asyncio.Event used if any coroutine wants to await this record
    event: asyncio.Event = field(default_factory=asyncio.Event)

    # Resolution state
    resolved: bool = False
    mode: Optional[str] = None          # "ac" | "dodge_dex" | "dodge_con"
    defense_total: Optional[int] = None
    defense_roll_d20: Optional[int] = None
    defense_breakdown: Optional[str] = None
    success: Optional[bool] = None        # True = damage negated

    # Optional: if this pending defense originated from an ability use,
    # store enough context to apply damage after resolution.
    ability_context: Optional[dict] = None


# In-memory registry.  Cleared on server restart (acceptable for ephemeral combat state).
_pending_defenses: dict[str, PendingDefense] = {}


def _new_id() -> str:
    return str(uuid.uuid4())


def create_pending_defense(
    *,
    attacker_id: int,
    target_id: int,
    session_id: int,
    session_code: str,
    attack_total: int,
    attack_roll_d20: int,
    attacker_name: str,
    target_name: str,
    target_ac: int,
    critical: bool,
    fumble: bool,
    hit: bool,
    weapon_name: Optional[str] = None,
    ability_context: Optional[dict] = None,
) -> PendingDefense:
    """Create and register a new PendingDefense."""
    pd = PendingDefense(
        id=_new_id(),
        attacker_id=attacker_id,
        target_id=target_id,
        session_id=session_id,
        session_code=session_code,
        attack_total=attack_total,
        attack_roll_d20=attack_roll_d20,
        attacker_name=attacker_name,
        target_name=target_name,
        target_ac=target_ac,
        critical=critical,
        fumble=fumble,
        hit=hit,
        weapon_name=weapon_name,
        ability_context=ability_context,
    )
    _pending_defenses[pd.id] = pd
    return pd


def get_pending_defense(pid: str) -> Optional[PendingDefense]:
    return _pending_defenses.get(pid)


def cancel_pending_defense(pid: str) -> bool:
    """Cancel a pending defense (e.g. combat ended). Returns True if found."""
    pd = _pending_defenses.pop(pid, None)
    if pd and not pd.resolved:
        pd.resolved = True
        pd.success = False
        pd.event.set()
        return True
    return False


def snapshot_pending_defenses() -> list[dict]:
    """Return a snapshot of all unresolved pending defenses."""
    return [
        {
            "id": p.id,
            "attacker_id": p.attacker_id,
            "target_id": p.target_id,
            "attacker_name": p.attacker_name,
            "target_name": p.target_name,
            "attack_total": p.attack_total,
            "resolved": p.resolved,
        }
        for p in _pending_defenses.values()
        if not p.resolved
    ]


async def broadcast_defense_request(pd: PendingDefense) -> None:
    """WS broadcast so every client knows a defense is pending."""
    await manager.broadcast_to_session(
        pd.session_code,
        "combat.defense_request",
        {
            "pending_defense_id": pd.id,
            "attacker_id": pd.attacker_id,
            "attacker_name": pd.attacker_name,
            "target_id": pd.target_id,
            "target_name": pd.target_name,
            "target_ac": pd.target_ac,
            "attack_total": pd.attack_total,
            "attack_roll_d20": pd.attack_roll_d20,
            "weapon_name": pd.weapon_name,
            "critical": pd.critical,
            "fumble": pd.fumble,
        },
    )


async def resolve_pending_defense(
    pid: str,
    mode: str,
    *,
    target_stats: dict,
    dice_count: int = 1,
    advantage_mode: str = "normal",
) -> Optional[dict]:
    """Resolve a pending defense.

    mode:
      "ac"        -> static AC compare
      "dodge_dex" -> d20 + DEX modifier vs attack_total
      "dodge_con" -> d20 + CON modifier vs attack_total

    Returns the resolution payload, or None if the pending id was invalid/already resolved.
    """
    pd = _pending_defenses.get(pid)
    if not pd or pd.resolved:
        return None

    if mode not in ("ac", "dodge_dex", "dodge_con"):
        return None

    # Clamp dice params for dodge rolls
    if advantage_mode == "normal":
        dice_count = max(1, dice_count)
    else:
        dice_count = max(2, dice_count)

    pd.mode = mode
    pd.resolved = True

    if mode == "ac":
        defense_total = int(target_stats.get("armor_class", 10))
        pd.defense_total = defense_total
        pd.defense_breakdown = f"AC({defense_total})"
        pd.success = defense_total >= pd.attack_total
    else:
        stat_key = "dexterity" if mode == "dodge_dex" else "constitution"
        stat_val = int(target_stats.get(stat_key, 10))
        mod = stat_modifier(stat_val)
        all_rolls = [random.randint(1, 20) for _ in range(dice_count)]
        if advantage_mode == "advantage":
            chosen = max(all_rolls)
        elif advantage_mode == "disadvantage":
            chosen = min(all_rolls)
        else:
            chosen = all_rolls[0]
        total = chosen + mod
        pd.defense_roll_d20 = chosen
        pd.defense_total = total
        stat_label = "DEX" if mode == "dodge_dex" else "CON"
        pool_tag = (
            f"{advantage_mode.upper()}:{dice_count}d20[{','.join(str(r) for r in all_rolls)}] took {chosen} · "
            if dice_count > 1 else ""
        )
        pd.defense_breakdown = f"{pool_tag}D20({chosen}) + {stat_label}({mod:+d}) = {total}"
        pd.success = total >= pd.attack_total

    result = {
        "id": pd.id,
        "mode": mode,
        "defense_total": pd.defense_total,
        "defense_breakdown": pd.defense_breakdown,
        "attack_total": pd.attack_total,
        "success": pd.success,
        "target_name": pd.target_name,
        "attacker_name": pd.attacker_name,
        "target_id": pd.target_id,
        "attacker_id": pd.attacker_id,
        "critical": pd.critical,
        "fumble": pd.fumble,
        "weapon_name": pd.weapon_name,
    }

    pd.event.set()

    # Broadcast resolution to all clients
    await manager.broadcast_to_session(
        pd.session_code, "combat.defense_resolved", result
    )

    # Clean up resolved record after a short grace period so the client can still poll
    # if it missed the WS event.  We leave it in memory; a periodic cleaner could prune.

    return result


async def apply_ability_damage_on_failed_defense(
    pd: PendingDefense,
    db,
) -> Optional[dict]:
    """If this pending defense carries an ability_context and defense failed,
    replay only the damage portion of the ability use.

    Returns the same shape as the normal ability-use response, or None.
    """
    if not pd.ability_context:
        return None
    if pd.success:
        return {"damage_applied": False, "reason": "defense_success"}

    from fastapi import HTTPException

    ctx = pd.ability_context
    ca_id = ctx.get("ca_id")
    body = ctx.get("body") or {}

    # Import dynamically to avoid circular imports at module load time.
    try:
        from app.routers.abilities import _apply_ability_damage_only
    except ImportError:
        return None

    try:
        result = await _apply_ability_damage_only(ca_id, body, db)
        return result
    except HTTPException:
        return None
