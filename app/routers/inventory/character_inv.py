import json
from datetime import UTC, datetime

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.game_mechanics import get_all_active_bonuses
from app.models import Character, InventoryItem, Item, Session
from app.routers.inventory.common import router
from app.routers.inventory.items import _item_dict

EQUIPMENT_SLOTS = [
    "main_hand", "off_hand", "armor", "head",
    "ring_1", "ring_2", "amulet", "boots", "gloves", "belt",
]

def _inventory_item_dict(inv: InventoryItem) -> dict:
    """Serialize an InventoryItem with its full Item details."""
    item = inv.item
    d = _item_dict(item) if item else {}
    d["inventory_id"] = inv.id
    d["quantity"] = inv.quantity
    d["is_equipped"] = inv.is_equipped
    d["equipped_slot"] = inv.equipped_slot
    d["custom_notes"] = inv.custom_notes or ""
    d["acquired_at"] = inv.acquired_at.isoformat() if inv.acquired_at else None
    d["quantity"] = inv.quantity
    d["consumable"] = item.consumable
    d["is_potion"] = item.is_potion
    d["potion_icon"] = item.potion_icon or ""
    return d


# ══════════════════════════════════════════════════════════════
# CHARACTER INVENTORY — Full CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/characters/{character_id}/inventory")
async def get_character_inventory(
    character_id: int,
    tab: str = "all",  # "all" | "bag" | "equipped"
    db: AsyncSession = Depends(get_session),
):
    char = await db.get(Character, character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    result = await db.execute(
        select(InventoryItem).where(InventoryItem.character_id == character_id)
    )
    entries = result.scalars().all()
    items = []
    bag_count = 0
    equipped_count = 0
    for e in entries:
        d = _inventory_item_dict(e)
        if d.get("is_equipped"):
            equipped_count += 1
        else:
            bag_count += 1
        items.append(d)

    # Rework Phase 3: optional server-side filter for tab
    tab_norm = (tab or "all").lower()
    if tab_norm == "bag":
        items_out = [it for it in items if not it.get("is_equipped")]
    elif tab_norm == "equipped":
        items_out = [it for it in items if it.get("is_equipped")]
    else:
        items_out = items

    # Currency display
    wb = char.wealth_bronze or 0
    currency = _bronze_to_display(wb)

    # Rework v2: slot meter. One distinct InventoryItem row = 1 slot
    # (stackables collapse), equipped items still count as slots.
    slots_used = bag_count + equipped_count
    slots_max = int(char.max_inventory_slots or 0)

    return {
        "items": items_out,
        "tab": tab_norm,
        "bag_count": bag_count,
        "equipped_count": equipped_count,
        # Rework v2: slot meter (0 max = unlimited)
        "slots_used": slots_used,
        "slots_max": slots_max,
        "gold_copper": wb,
        "wealth_bronze": wb,
        "currency": currency,
        "can_edit_own_items": char.can_edit_own_items,
        "equipment_slots": EQUIPMENT_SLOTS,
    }


@router.post("/characters/{character_id}/inventory")
async def add_to_inventory(character_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    char = await db.get(Character, character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    item_id = body.get("item_id")
    quantity = body.get("quantity", 1)
    if not item_id:
        raise HTTPException(400, "item_id required")

    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    # Check if stackable item already in inventory (non-equipped)
    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == character_id,
            InventoryItem.item_id == item_id,
            InventoryItem.is_equipped == False,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.quantity += quantity
    else:
        # Rework v2: enforce the inventory slot cap. Stacks on an existing
        # row count as one slot, so we only validate when a *new* row is added.
        # `max_inventory_slots = 0` means unlimited (GM/NPC default).
        cap = int(char.max_inventory_slots or 0)
        if cap > 0:
            slot_q = await db.execute(
                select(InventoryItem).where(InventoryItem.character_id == character_id)
            )
            used = len(slot_q.scalars().all())
            if used >= cap:
                raise HTTPException(
                    400,
                    {"error": True, "code": "INVENTORY_FULL",
                     "message": f"Inventory full ({used}/{cap} slots). Drop or stack something first."},
                )
        db.add(InventoryItem(
            character_id=character_id,
            item_id=item_id,
            quantity=quantity,
            acquired_at=datetime.now(UTC),
        ))
    await db.commit()
    return {"ok": True, "item_name": item.name, "quantity": quantity}


@router.delete("/inventory/{inventory_id}")
async def remove_inventory_item(inventory_id: int, db: AsyncSession = Depends(get_session)):
    entry = await db.get(InventoryItem, inventory_id)
    if not entry:
        raise HTTPException(404)
    await db.delete(entry)
    await db.commit()
    return {"ok": True}


@router.patch("/inventory/{inventory_id}/equip")
async def toggle_equip(inventory_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    entry = await db.get(InventoryItem, inventory_id)
    if not entry:
        raise HTTPException(404)

    equip = body.get("equip", not entry.is_equipped)
    slot = body.get("slot")

    # Guard: potions/consumables cannot be equipped (they are used, not worn)
    if equip:
        item = await db.get(Item, entry.item_id)
        if item:
            if getattr(item, "is_potion", False):
                raise HTTPException(400, "Potions cannot be equipped. Use them instead.")
            if item.consumable and not item.equippable:
                raise HTTPException(400, "Consumables cannot be equipped. Use them instead.")
            if not item.equippable:
                raise HTTPException(400, f"'{item.name}' is not equippable.")

    if equip and slot and slot not in EQUIPMENT_SLOTS:
        raise HTTPException(400, f"Invalid slot. Must be one of: {EQUIPMENT_SLOTS}")

    entry.is_equipped = equip
    if equip:
        entry.equipped_slot = slot
    else:
        entry.equipped_slot = None

    await db.commit()
    return {"ok": True, "is_equipped": entry.is_equipped, "equipped_slot": entry.equipped_slot}


@router.patch("/inventory/{inventory_id}/quantity")
async def change_quantity(inventory_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    entry = await db.get(InventoryItem, inventory_id)
    if not entry:
        raise HTTPException(404)

    new_qty = body.get("quantity")
    delta = body.get("delta")

    if new_qty is not None:
        entry.quantity = max(0, int(new_qty))
    elif delta is not None:
        entry.quantity = max(0, entry.quantity + int(delta))
    else:
        raise HTTPException(400, "Provide 'quantity' or 'delta'")

    if entry.quantity <= 0:
        await db.delete(entry)

    await db.commit()
    return {"ok": True, "quantity": entry.quantity if entry.quantity > 0 else 0}


@router.post("/inventory/{inventory_id}/transfer")
async def transfer_inventory(inventory_id: int, body: dict,
                             db: AsyncSession = Depends(get_session)):
    """Rework v3 — hand an inventory item over to another character in the
    same session. Respects the receiver's slot cap.

    Body: ``{"target_character_id": N, "quantity": int}``.
    ``quantity`` defaults to the full stack. Equipped items are unequipped
    automatically on transfer.
    """
    from app.websocket_manager import manager as _ws

    entry = await db.get(InventoryItem, inventory_id)
    if not entry:
        raise HTTPException(404, "Inventory entry not found")

    sender = await db.get(Character, entry.character_id)
    if not sender:
        raise HTTPException(404, "Sender not found")

    target_id = int(body.get("target_character_id") or 0)
    if not target_id:
        raise HTTPException(400, "target_character_id required")
    if target_id == sender.id:
        raise HTTPException(400, "Cannot transfer to yourself")

    target = await db.get(Character, target_id)
    if not target:
        raise HTTPException(404, "Target character not found")
    if target.session_id != sender.session_id:
        raise HTTPException(400, "Both players must be in the same session")

    item = await db.get(Item, entry.item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    qty = int(body.get("quantity") or entry.quantity)
    qty = max(1, min(qty, entry.quantity))

    # Look up an existing non-equipped stack on the receiver.
    dst_q = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == target.id,
            InventoryItem.item_id == item.id,
            InventoryItem.is_equipped == False,   # noqa: E712
        )
    )
    dst = dst_q.scalars().first()

    # Slot-cap check only when a new row would be created.
    if dst is None:
        cap = int(target.max_inventory_slots or 0)
        if cap > 0:
            used_q = await db.execute(
                select(InventoryItem).where(InventoryItem.character_id == target.id)
            )
            used = len(used_q.scalars().all())
            if used >= cap:
                raise HTTPException(
                    400,
                    {"error": True, "code": "TARGET_INVENTORY_FULL",
                     "message": f"{target.name} has no free inventory slots ({used}/{cap})"},
                )
        dst = InventoryItem(
            character_id=target.id,
            item_id=item.id,
            quantity=0,
            acquired_at=datetime.now(UTC),
        )
        db.add(dst)
        await db.flush()

    dst.quantity += qty
    entry.quantity -= qty
    # If we moved the last copy of an equipped item, make sure the slot is freed.
    if entry.quantity <= 0:
        await db.delete(entry)
    await db.commit()

    # Broadcast so both players refresh their inventory UI.
    try:
        await _ws.broadcast_to_session(
            (await db.get(Session, sender.session_id)).code,
            "inventory.transferred",
            {
                "from_character_id": sender.id,
                "from_character_name": sender.name,
                "to_character_id": target.id,
                "to_character_name": target.name,
                "item_name": item.name,
                "quantity": qty,
            },
        )
    except Exception:
        pass

    return {
        "ok": True,
        "from_character_id": sender.id,
        "to_character_id": target.id,
        "item_name": item.name,
        "quantity": qty,
    }


@router.post("/inventory/{inventory_id}/use")
async def use_consumable(inventory_id: int, body: dict | None = None,
                         db: AsyncSession = Depends(get_session)):
    """Consume an inventory item.

    Rework v3 — body may optionally carry ``{"target_id": N}`` to apply the
    item's effect(s) on another character instead of the owner. Resource costs
    (mana) are always paid by the owner. Quantity is always decremented from
    the owner's inventory row.
    """
    import random

    from app.game_mechanics import get_effective_mana_max, spend_mana
    from app.game_mechanics import restore_mana as _restore_mana
    from app.models import CharacterStatusEffect, StatModifier, StatusEffectTemplate

    body = body or {}
    entry = await db.get(InventoryItem, inventory_id)
    if not entry:
        raise HTTPException(404)
    item = await db.get(Item, entry.item_id)
    if not item or not item.consumable:
        raise HTTPException(400, "Item is not consumable")

    char = await db.get(Character, entry.character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    # Rework v3: resolve optional target.
    target_id = body.get("target_id")
    if target_id and int(target_id) != char.id:
        target = await db.get(Character, int(target_id))
        if not target:
            target = char
    else:
        target = char

    # FIX 6: snapshot before for response delta (owner-side)
    _hp_before = char.current_hp
    _mana_before = char.mana_current

    results = []

    # 1. Mana cost check — always paid by the CASTER (owner), never the target.
    mana_cost = item.mana_cost or 0
    if mana_cost > 0:
        eff_max = get_effective_mana_max(char.mana_max)
        mana_result = spend_mana(char.mana_current, eff_max, mana_cost)
        if not mana_result["success"]:
            raise HTTPException(400, {"error": True, "code": "NOT_ENOUGH_MANA",
                                      "message": mana_result["message"]})
        char.mana_current = mana_result["mana_current"]
        results.append(f"Spent {mana_cost} mana")

    # 2. Process use_effect JSON
    use_effect_raw = item.use_effect
    effects_list = []
    if use_effect_raw:
        try:
            ue = json.loads(use_effect_raw) if isinstance(use_effect_raw, str) else use_effect_raw
            effects_list = ue.get("effects", []) if isinstance(ue, dict) else ue
        except (json.JSONDecodeError, AttributeError):
            pass

    def _tgt_tag():
        return "" if target.id == char.id else f" → {target.name}"

    for eff in effects_list:
        etype = eff.get("type", "")

        if etype == "heal_hp":
            dice_count = eff.get("dice_count", 1)
            dice_type = eff.get("dice_type", 4)
            flat_bonus = eff.get("flat_bonus", 0)
            rolls = [random.randint(1, dice_type) for _ in range(dice_count)]
            total_heal = sum(rolls) + flat_bonus
            old_hp = target.current_hp
            target.current_hp = min(target.max_hp, target.current_hp + total_heal)
            actual = target.current_hp - old_hp
            roll_str = "+".join(str(r) for r in rolls)
            results.append(f"Heal: {dice_count}d{dice_type}+{flat_bonus} ({roll_str}+{flat_bonus}={total_heal}) → +{actual} HP{_tgt_tag()}")

        elif etype == "heal_spirit":
            dice_count = eff.get("dice_count", 1)
            dice_type = eff.get("dice_type", 4)
            flat_bonus = eff.get("flat_bonus", 0)
            rolls = [random.randint(1, dice_type) for _ in range(dice_count)]
            total_heal = sum(rolls) + flat_bonus
            old_spirit = target.spiritual_hp or 0
            target.spiritual_hp = min(target.spiritual_max_hp or 0, (target.spiritual_hp or 0) + total_heal)
            actual = (target.spiritual_hp or 0) - old_spirit
            roll_str = "+".join(str(r) for r in rolls)
            results.append(f"Spirit Heal: {dice_count}d{dice_type}+{flat_bonus} ({roll_str}+{flat_bonus}={total_heal}) → +{actual} Spirit HP{_tgt_tag()}")

        elif etype == "restore_mana":
            amount = eff.get("amount", 0)
            eff_max = get_effective_mana_max(target.mana_max)
            old_mana = target.mana_current
            target.mana_current = _restore_mana(target.mana_current, eff_max, amount=amount)
            actual = target.mana_current - old_mana
            results.append(f"Mana: +{actual}{_tgt_tag()}")

        elif etype == "apply_status":
            template_id = eff.get("template_id")
            duration = eff.get("duration_turns")
            if template_id:
                tmpl = await db.get(StatusEffectTemplate, template_id)
                if tmpl:
                    cse = CharacterStatusEffect(
                        character_id=target.id,
                        template_id=tmpl.id,
                        name=tmpl.name,
                        icon=tmpl.icon,
                        color=tmpl.color,
                        effects=tmpl.effects,
                        remaining_turns=duration if duration else tmpl.default_duration,
                    )
                    db.add(cse)
                    results.append(f"Applied status: {tmpl.icon} {tmpl.name}{_tgt_tag()}"
                                   + (f" ({duration} turns)" if duration else ""))

        elif etype == "stat_boost":
            stat = eff.get("stat", "strength")
            value = eff.get("value", 0)
            duration_turns = eff.get("duration_turns", 3)
            from datetime import timedelta
            expires = datetime.now(UTC) + timedelta(minutes=duration_turns * 2)
            mod = StatModifier(
                character_id=target.id,
                stat_name=stat,
                name=f"{item.name} boost",
                value=value,
                is_active=True,
                source="potion",
                expires_at=expires,
            )
            db.add(mod)
            results.append(f"Stat boost: +{value} {stat.capitalize()} for {duration_turns} turns{_tgt_tag()}")

        elif etype == "remove_status":
            status_name = eff.get("status_name", "")
            if status_name:
                res = await db.execute(
                    select(CharacterStatusEffect).where(
                        CharacterStatusEffect.character_id == target.id,
                        CharacterStatusEffect.name == status_name,
                    )
                )
                for cse in res.scalars().all():
                    await db.delete(cse)
                results.append(f"Removed status: {status_name}{_tgt_tag()}")

        elif etype == "damage":
            dice_count = eff.get("dice_count", 1)
            dice_type = eff.get("dice_type", 6)
            flat_bonus = eff.get("flat_bonus", 0)
            rolls = [random.randint(1, dice_type) for _ in range(dice_count)]
            total_dmg = sum(rolls) + flat_bonus
            old_hp = target.current_hp
            target.current_hp = max(0, target.current_hp - total_dmg)
            if target.current_hp <= 0:
                target.is_alive = False
            actual = old_hp - target.current_hp
            results.append(f"Damage: {dice_count}d{dice_type}+{flat_bonus}={total_dmg} → -{actual} HP to {target.name}")

        elif etype == "custom":
            desc = eff.get("description", "")
            results.append(f"Effect: {desc}")

    # 3. Legacy single-effect fallback (if no use_effect) — respect target too.
    if not effects_list:
        if item.effect_type == "hp_bonus" and item.effect_value:
            old_hp = target.current_hp
            target.current_hp = min(target.max_hp, target.current_hp + int(item.effect_value))
            results.append(f"+{target.current_hp - old_hp} HP{_tgt_tag()}")
        for bonus in (item.bonuses or []):
            if bonus.bonus_type == "hp_bonus":
                old_hp = target.current_hp
                target.current_hp = min(target.max_hp, target.current_hp + int(bonus.value))
                results.append(f"+{target.current_hp - old_hp} HP{_tgt_tag()}")

    # 4. Reduce quantity on the caster's inventory (always).
    entry.quantity -= 1
    qty_left = max(0, entry.quantity)
    if entry.quantity <= 0:
        await db.delete(entry)
    await db.commit()

    return {
        "ok": True,
        "item_name": item.name,
        "is_potion": bool(getattr(item, "is_potion", False)),
        "potion_icon": getattr(item, "potion_icon", None) or "🧪",
        "results": results,
        "breakdown": "; ".join(results) if results else "",
        "result": f"Used {item.name}: " + "; ".join(results) if results else f"Used {item.name}",
        "character_id": char.id,
        # Rework v3: the character who actually received the effect.
        "target_id":   target.id,
        "target_name": target.name,
        # FIX 6: before/after for UI deltas (owner-side)
        "hp_before":   _hp_before,
        "hp_after":    char.current_hp,
        "mana_before": _mana_before,
        "mana_after":  char.mana_current,
        "current_hp":  char.current_hp,
        "max_hp":      char.max_hp,
        "mana_current":char.mana_current,
        "mana_max":    char.mana_max,
        "quantity_remaining": qty_left,
    }


# ── Equipped bonuses aggregation ─────────────────────────────
@router.get("/characters/{character_id}/equipped-bonuses")
async def get_equipped_bonuses(character_id: int, db: AsyncSession = Depends(get_session)):
    char = await db.get(Character, character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == character_id,
            InventoryItem.is_equipped == True,
        )
    )
    equipped = result.scalars().all()
    bonuses = get_all_active_bonuses(equipped)
    return bonuses


# ── Currency helpers ─────────────────────────────────────────
def _bronze_to_display(bronze: int) -> dict:
    """Convert bronze total to multi-currency display."""
    platinum = bronze // 1000
    bronze %= 1000
    gold = bronze // 100
    bronze %= 100
    silver = bronze // 10
    bronze %= 10
    return {"platinum": platinum, "gold": gold, "silver": silver, "bronze": bronze}


_copper_to_display = _bronze_to_display  # backward compat


# Currency endpoint moved to economy.py (Stage 3)
