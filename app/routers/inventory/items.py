import json

from fastapi import Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Item, ItemBonus, ItemWeaponStats
from app.routers.inventory.common import (
    _ensure_default_categories,
    _ensure_default_items,
    _sanitize_damage_modes,
    _sanitize_range_cells,
    router,
)


@router.get("/items")
async def list_items(
    category: str = None, category_id: int = None, rarity: str = None,
    session_id: int = None, search: str = None, tag: str = None,
    db: AsyncSession = Depends(get_session),
):
    await _ensure_default_items(db)
    q = select(Item)
    if session_id is not None:
        q = q.where(or_(Item.session_id == session_id, Item.session_id == None))
    if category:
        q = q.where(Item.category == category)
    if category_id is not None:
        q = q.where(Item.category_id == category_id)
    if rarity:
        q = q.where(Item.rarity == rarity)
    if search:
        q = q.where(Item.name.ilike(f"%{search}%"))
    if tag:
        q = q.where(Item.tags.contains(f'"{tag}"'))
    q = q.order_by(Item.name)
    result = await db.execute(q)
    items = result.scalars().all()
    return [_item_dict(i) for i in items]


@router.get("/items/{item_id}")
async def get_item(item_id: int, db: AsyncSession = Depends(get_session)):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404, detail={"error": True, "code": "NOT_FOUND", "message": "Item not found"})
    return _item_dict(item)


@router.post("/items")
async def create_item(body: dict, db: AsyncSession = Depends(get_session)):
    await _ensure_default_categories(db)
    # FIX 6: auto-flag consumable if is_potion=true (potions are always consumable)
    _is_potion = bool(body.get("is_potion", False))
    _consumable = body.get("consumable", False) or _is_potion
    # Potions cannot be equippable — force-off
    _equippable = body.get("equippable", False) and not _is_potion
    item = Item(
        session_id=body.get("session_id"),
        name=body.get("name", "Item"),
        description=body.get("description", ""),
        category=body.get("category", "misc"),
        category_id=body.get("category_id"),
        rarity=body.get("rarity", "common"),
        base_price=body.get("base_price", body.get("base_price_bronze", body.get("base_price_copper", 0)) // 100),
        base_price_bronze=body.get("base_price_bronze", body.get("base_price_copper", body.get("base_price", 0) * 100)),
        effect_type=body.get("effect_type"),
        effect_value=body.get("effect_value"),
        equippable=_equippable,
        consumable=_consumable,
        mana_cost=body.get("mana_cost", 0),
        use_effect=json.dumps(body["use_effect"]) if isinstance(body.get("use_effect"), (dict, list)) else body.get("use_effect"),
        tags=body.get("tags", "[]") if isinstance(body.get("tags", "[]"), str) else json.dumps(body.get("tags", [])),
        created_by_ai=body.get("created_by_ai", False),
        # FIX 6: potion identity
        is_potion=_is_potion,
        potion_icon=body.get("potion_icon", "🧪"),
    )
    db.add(item)
    await db.flush()
    # Add bonuses
    for b in body.get("bonuses", []):
        db.add(ItemBonus(
            item_id=item.id,
            bonus_type=b["bonus_type"],
            stat_name=b.get("stat_name"),
            value=b.get("value", 0),
            is_conditional=b.get("is_conditional", False),
            condition_description=b.get("condition_description"),
        ))
    # Add weapon stats
    ws = body.get("weapon_stats")
    if ws:
        wp = ws.get("weapon_properties", [])
        dm = _sanitize_damage_modes(ws.get("damage_modes"))
        db.add(ItemWeaponStats(
            item_id=item.id,
            dice_count=ws.get("dice_count", 1),
            dice_type=ws.get("dice_type", 6),
            damage_type=ws.get("damage_type", "physical"),
            range=ws.get("range"),
            weapon_range=ws.get("weapon_range", "melee"),
            # Rework v3 Phase 7: range in battle-grid cells (default 1 = melee).
            range_cells=_sanitize_range_cells(ws.get("range_cells"), 1),
            weapon_properties=json.dumps(wp) if isinstance(wp, list) else (wp or "[]"),
            # Rework Phase 2: stat that adds its value as bonus to hit / damage rolls
            hit_stat=ws.get("hit_stat", "strength"),
            damage_stat=ws.get("damage_stat") if ws.get("damage_stat") is not None else "strength",
            # Rework v3: optional preset damage modes.
            damage_modes=json.dumps(dm),
        ))
    await db.commit()
    await db.refresh(item)
    return _item_dict(item)


@router.put("/items/{item_id}")
async def update_item(item_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404, detail={"error": True, "code": "NOT_FOUND", "message": "Item not found"})
    for k in ["name", "description", "category", "category_id", "rarity", "base_price",
              "base_price_bronze", "effect_type", "effect_value", "equippable",
              "consumable", "mana_cost", "created_by_ai",
              # FIX 6: potion identity
              "is_potion", "potion_icon"]:
        if k in body:
            setattr(item, k, body[k])
    # FIX 6: potions are always consumable — auto-enable when is_potion=true
    if body.get("is_potion") and not item.consumable:
        item.consumable = True
    # Potions cannot be equippable
    if item.is_potion and item.equippable:
        item.equippable = False
    # Accept legacy base_price_copper key
    if "base_price_copper" in body and "base_price_bronze" not in body:
        item.base_price_bronze = body["base_price_copper"]
    if "tags" in body:
        item.tags = body["tags"] if isinstance(body["tags"], str) else json.dumps(body["tags"])
    if "use_effect" in body:
        ue = body["use_effect"]
        item.use_effect = json.dumps(ue) if isinstance(ue, (dict, list)) else ue
    # Sync legacy base_price ↔ base_price_bronze
    if "base_price_bronze" in body and "base_price" not in body:
        item.base_price = body["base_price_bronze"] // 100
    elif "base_price" in body and "base_price_bronze" not in body:
        item.base_price_bronze = body["base_price"] * 100
    # Update weapon_stats if provided
    ws = body.get("weapon_stats")
    if ws is not None:
        if item.weapon_stats:
            # Rework Phase 2: also accept hit_stat / damage_stat
            for k in ["dice_count", "dice_type", "damage_type", "range", "weapon_range", "hit_stat", "damage_stat"]:
                if k in ws:
                    setattr(item.weapon_stats, k, ws[k])
            # Rework v3 Phase 7: range in cells. Use the sanitizer so
            # garbage ("", "melee", negative ints) normalises to a safe
            # int rather than corrupting the row.
            if "range_cells" in ws:
                item.weapon_stats.range_cells = _sanitize_range_cells(ws.get("range_cells"), item.weapon_stats.range_cells or 1)
            if "weapon_properties" in ws:
                wp = ws["weapon_properties"]
                item.weapon_stats.weapon_properties = json.dumps(wp) if isinstance(wp, list) else (wp or "[]")
            if "damage_modes" in ws:
                item.weapon_stats.damage_modes = json.dumps(_sanitize_damage_modes(ws["damage_modes"]))
        else:
            wp = ws.get("weapon_properties", [])
            dm = _sanitize_damage_modes(ws.get("damage_modes"))
            db.add(ItemWeaponStats(
                item_id=item.id,
                **{k: ws[k] for k in ["dice_count", "dice_type", "damage_type", "range"] if k in ws},
                weapon_range=ws.get("weapon_range", "melee"),
                range_cells=_sanitize_range_cells(ws.get("range_cells"), 1),
                weapon_properties=json.dumps(wp) if isinstance(wp, list) else (wp or "[]"),
                hit_stat=ws.get("hit_stat", "strength"),
                damage_stat=ws.get("damage_stat") if ws.get("damage_stat") is not None else "strength",
                damage_modes=json.dumps(dm),
            ))
    await db.commit()
    await db.refresh(item)
    return _item_dict(item)


@router.delete("/items/{item_id}")
async def delete_item(item_id: int, db: AsyncSession = Depends(get_session)):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404, detail={"error": True, "code": "NOT_FOUND", "message": "Item not found"})
    await db.delete(item)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# ITEM BONUSES CRUD
# ══════════════════════════════════════════════════════════════
@router.post("/items/{item_id}/bonuses")
async def add_item_bonus(item_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404, detail={"error": True, "code": "NOT_FOUND", "message": "Item not found"})
    bonus = ItemBonus(
        item_id=item_id,
        bonus_type=body.get("bonus_type", "custom"),
        stat_name=body.get("stat_name"),
        value=body.get("value", 0),
        is_conditional=body.get("is_conditional", False),
        condition_description=body.get("condition_description"),
    )
    db.add(bonus)
    await db.commit()
    await db.refresh(bonus)
    return _bonus_dict(bonus)


@router.put("/item-bonuses/{bonus_id}")
async def update_item_bonus(bonus_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    bonus = await db.get(ItemBonus, bonus_id)
    if not bonus:
        raise HTTPException(404, detail={"error": True, "code": "NOT_FOUND", "message": "Bonus not found"})
    for k in ["bonus_type", "stat_name", "value", "is_conditional", "condition_description"]:
        if k in body:
            setattr(bonus, k, body[k])
    await db.commit()
    return _bonus_dict(bonus)


@router.delete("/item-bonuses/{bonus_id}")
async def delete_item_bonus(bonus_id: int, db: AsyncSession = Depends(get_session)):
    bonus = await db.get(ItemBonus, bonus_id)
    if not bonus:
        raise HTTPException(404, detail={"error": True, "code": "NOT_FOUND", "message": "Bonus not found"})
    await db.delete(bonus)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# SERIALIZERS
# ══════════════════════════════════════════════════════════════
def _bonus_dict(b: ItemBonus) -> dict:
    return {
        "id": b.id, "item_id": b.item_id, "bonus_type": b.bonus_type,
        "stat_name": b.stat_name, "value": b.value,
        "is_conditional": b.is_conditional, "condition_description": b.condition_description,
    }


def _item_dict(i: Item) -> dict:
    tags = i.tags or "[]"
    try:
        tags_parsed = json.loads(tags) if isinstance(tags, str) else tags
    except (json.JSONDecodeError, TypeError):
        tags_parsed = []
    d = {
        "id": i.id, "session_id": i.session_id, "name": i.name, "description": i.description,
        "category": i.category, "category_id": i.category_id, "rarity": i.rarity,
        "base_price": i.base_price, "base_price_copper": i.base_price_bronze, "base_price_bronze": i.base_price_bronze,
        "effect_type": i.effect_type, "effect_value": i.effect_value,
        "equippable": i.equippable, "consumable": i.consumable,
        "mana_cost": i.mana_cost or 0,
        "use_effect": json.loads(i.use_effect) if i.use_effect else None,
        "tags": tags_parsed, "created_by_ai": i.created_by_ai,
        "bonuses": [_bonus_dict(b) for b in (i.bonuses or [])],
        "weapon_stats": None,
        "category_name": i.category_rel.name if i.category_rel else (i.category or "misc").capitalize(),
        "category_icon": i.category_rel.icon if i.category_rel else "📦",
        # FIX 6: Potion identity
        "is_potion":   bool(getattr(i, "is_potion", False)),
        "potion_icon": getattr(i, "potion_icon", None) or "🧪",
    }
    if i.weapon_stats:
        ws = i.weapon_stats
        try:
            dmg_modes = json.loads(getattr(ws, "damage_modes", None) or "[]")
            if not isinstance(dmg_modes, list):
                dmg_modes = []
        except Exception:
            dmg_modes = []
        d["weapon_stats"] = {
            "id": ws.id, "dice_count": ws.dice_count, "dice_type": ws.dice_type,
            "damage_type": ws.damage_type, "range": ws.range,
            "weapon_range": ws.weapon_range or "melee",
            # Rework v3 Phase 7: cell-range for client UI (shows `📏 N` in
            # the weapon card and disables the attack button when the
            # selected target is further away).
            "range_cells": ws.range_cells if ws.range_cells is not None else 1,
            "weapon_properties": json.loads(ws.weapon_properties) if ws.weapon_properties else [],
            # Rework Phase 2: expose hit_stat / damage_stat so GM editor can show them
            "hit_stat": getattr(ws, "hit_stat", None) or "strength",
            "damage_stat": getattr(ws, "damage_stat", None),
            # Rework v3: optional preset damage modes. Empty list = weapon has
            # a single mode (use the flat dice_count/dice_type above).
            "damage_modes": dmg_modes,
        }
    return d


# ══════════════════════════════════════════════════════════════
