"""Inventory system — items CRUD, character inventory, shop, default items seeding."""

import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Session, Character, Item, InventoryItem, ShopItem,
    ItemCategory, ItemBonus, ItemWeaponStats,
)
from app.game_mechanics import get_all_active_bonuses

router = APIRouter(prefix="/api", tags=["inventory"])

# ── Default categories ───────────────────────────────────────
DEFAULT_CATEGORIES = [
    {"name": "Weapon", "icon": "⚔️"},
    {"name": "Armor", "icon": "🛡️"},
    {"name": "Potion", "icon": "🧪"},
    {"name": "Quest", "icon": "📜"},
    {"name": "Misc", "icon": "📦"},
]

# category_name → list of items with bonuses & weapon_stats
DEFAULT_ITEMS_SPEC = [
    # ── WEAPONS ─────────────────────────────────────────────────
    {"name": "Iron Sword", "description": "A sturdy iron blade.", "cat": "Weapon", "rarity": "common", "price_copper": 1500, "weight": 3.0, "equippable": True,
     "weapon": {"dice_count": 1, "dice_type": 6, "damage_type": "physical", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 1}]},
    {"name": "Steel Longsword", "description": "Well-forged steel longsword with leather grip.", "cat": "Weapon", "rarity": "uncommon", "price_copper": 5000, "weight": 3.5, "equippable": True,
     "weapon": {"dice_count": 1, "dice_type": 8, "damage_type": "physical", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 2}, {"bonus_type": "attack_bonus", "value": 1}]},
    {"name": "Flamebrand", "description": "A blade wreathed in eternal flame.", "cat": "Weapon", "rarity": "rare", "price_copper": 30000, "weight": 3.0, "equippable": True, "tags": '["magic","fire"]',
     "weapon": {"dice_count": 1, "dice_type": 8, "damage_type": "fire", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 4}, {"bonus_type": "attack_bonus", "value": 2}]},
    {"name": "Doom Cleaver", "description": "An axe forged in the abyss, whispers of the damned echo from its edge.", "cat": "Weapon", "rarity": "epic", "price_copper": 80000, "weight": 5.0, "equippable": True, "tags": '["two-handed","cursed"]',
     "weapon": {"dice_count": 2, "dice_type": 8, "damage_type": "physical", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 6}, {"bonus_type": "attack_bonus", "value": 3}, {"bonus_type": "stat_bonus", "stat_name": "strength", "value": 2}]},
    {"name": "Godslayer", "description": "A legendary weapon said to have felled a deity.", "cat": "Weapon", "rarity": "legendary", "price_copper": 500000, "weight": 4.0, "equippable": True, "tags": '["magic","divine"]',
     "weapon": {"dice_count": 2, "dice_type": 10, "damage_type": "magic", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 10}, {"bonus_type": "attack_bonus", "value": 5}, {"bonus_type": "stat_bonus", "stat_name": "strength", "value": 4}]},
    {"name": "Elven Shortbow", "description": "A graceful bow crafted by elven artisans.", "cat": "Weapon", "rarity": "uncommon", "price_copper": 8000, "weight": 1.5, "equippable": True, "tags": '["magic"]',
     "weapon": {"dice_count": 1, "dice_type": 6, "damage_type": "physical", "range": "60ft"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 2}, {"bonus_type": "initiative_bonus", "value": 1}]},
    {"name": "Shadow Dagger", "description": "A dagger that drinks the light around it.", "cat": "Weapon", "rarity": "rare", "price_copper": 25000, "weight": 1.0, "equippable": True, "tags": '["magic","stealth"]',
     "weapon": {"dice_count": 1, "dice_type": 4, "damage_type": "magic", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 3}, {"bonus_type": "stat_bonus", "stat_name": "dexterity", "value": 2}]},
    {"name": "Voidhammer", "description": "A mythic warhammer pulsing with void energy.", "cat": "Weapon", "rarity": "mythic", "price_copper": 1200000, "weight": 6.0, "equippable": True, "tags": '["two-handed","magic","void"]',
     "weapon": {"dice_count": 3, "dice_type": 8, "damage_type": "magic", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 12}, {"bonus_type": "attack_bonus", "value": 6}, {"bonus_type": "stat_bonus", "stat_name": "strength", "value": 6}]},
    {"name": "Eternity's Edge", "description": "A divine blade forged from the fabric of time itself. Those struck age decades in an instant.", "cat": "Weapon", "rarity": "divine", "price_copper": 5000000, "weight": 3.0, "equippable": True, "tags": '["magic","divine","time"]',
     "weapon": {"dice_count": 4, "dice_type": 10, "damage_type": "magic", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 20}, {"bonus_type": "attack_bonus", "value": 10}, {"bonus_type": "stat_bonus", "stat_name": "strength", "value": 8}, {"bonus_type": "stat_bonus", "stat_name": "dexterity", "value": 4}]},
    # ── ARMOR ──────────────────────────────────────────────────
    {"name": "Leather Armor", "description": "Basic leather protection.", "cat": "Armor", "rarity": "common", "price_copper": 1000, "weight": 5.0, "equippable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 5}]},
    {"name": "Chain Mail", "description": "Interlocking metal rings provide solid defense.", "cat": "Armor", "rarity": "uncommon", "price_copper": 7500, "weight": 12.0, "equippable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 10}]},
    {"name": "Plate Armor", "description": "Heavy plate offering superior protection.", "cat": "Armor", "rarity": "rare", "price_copper": 40000, "weight": 25.0, "equippable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 15}, {"bonus_type": "flat_damage_reduction", "value": 2}]},
    {"name": "Dragonscale Mail", "description": "Armor crafted from the scales of an ancient dragon.", "cat": "Armor", "rarity": "epic", "price_copper": 120000, "weight": 18.0, "equippable": True, "tags": '["magic"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 20}, {"bonus_type": "flat_damage_reduction", "value": 4}, {"bonus_type": "hp_bonus", "value": 10}]},
    {"name": "Aegis of the Immortal", "description": "A legendary shield-armor that defies death itself.", "cat": "Armor", "rarity": "legendary", "price_copper": 600000, "weight": 15.0, "equippable": True, "tags": '["magic","divine"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 30}, {"bonus_type": "flat_damage_reduction", "value": 8}, {"bonus_type": "hp_bonus", "value": 25}]},
    {"name": "Cloak of Shadows", "description": "A dark cloak that bends light around the wearer.", "cat": "Armor", "rarity": "rare", "price_copper": 35000, "weight": 2.0, "equippable": True, "tags": '["magic","stealth"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 8}, {"bonus_type": "stat_bonus", "stat_name": "dexterity", "value": 3}]},
    {"name": "Titanweave Vestments", "description": "Mythic robes woven from threads of pure mana.", "cat": "Armor", "rarity": "mythic", "price_copper": 1500000, "weight": 4.0, "equippable": True, "tags": '["magic"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 25}, {"bonus_type": "flat_damage_reduction", "value": 6}, {"bonus_type": "hp_bonus", "value": 30}, {"bonus_type": "stat_bonus", "stat_name": "constitution", "value": 4}]},
    {"name": "Mantle of the Eternal", "description": "A divine armor born from the essence of creation. The wearer becomes nearly untouchable.", "cat": "Armor", "rarity": "divine", "price_copper": 8000000, "weight": 8.0, "equippable": True, "tags": '["magic","divine"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 40}, {"bonus_type": "flat_damage_reduction", "value": 15}, {"bonus_type": "hp_bonus", "value": 50}, {"bonus_type": "stat_bonus", "stat_name": "constitution", "value": 8}]},
    # ── POTIONS ────────────────────────────────────────────────
    {"name": "Health Potion (Minor)", "description": "Restores 10 HP.", "cat": "Potion", "rarity": "common", "price_copper": 500, "weight": 0.3, "consumable": True,
     "bonuses": [{"bonus_type": "hp_bonus", "value": 10}]},
    {"name": "Health Potion (Greater)", "description": "Restores 25 HP.", "cat": "Potion", "rarity": "uncommon", "price_copper": 2500, "weight": 0.3, "consumable": True,
     "bonuses": [{"bonus_type": "hp_bonus", "value": 25}]},
    {"name": "Health Potion (Supreme)", "description": "Restores 50 HP.", "cat": "Potion", "rarity": "rare", "price_copper": 10000, "weight": 0.3, "consumable": True,
     "bonuses": [{"bonus_type": "hp_bonus", "value": 50}]},
    {"name": "Potion of Resistance", "description": "Grants 10% damage reduction for 3 turns.", "cat": "Potion", "rarity": "uncommon", "price_copper": 4000, "weight": 0.3, "consumable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 10, "is_conditional": True, "condition_description": "3 turns after use"}]},
    {"name": "Elixir of Fortitude", "description": "Grants 20% damage reduction for 3 turns.", "cat": "Potion", "rarity": "rare", "price_copper": 12000, "weight": 0.3, "consumable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 20, "is_conditional": True, "condition_description": "3 turns after use"}]},
    {"name": "Potion of Giant Strength", "description": "Temporarily grants immense strength.", "cat": "Potion", "rarity": "epic", "price_copper": 50000, "weight": 0.3, "consumable": True,
     "bonuses": [{"bonus_type": "stat_bonus", "stat_name": "strength", "value": 6, "is_conditional": True, "condition_description": "5 turns after use"}]},
    {"name": "Elixir of Ascension", "description": "A mythic draught that briefly elevates the drinker beyond mortal limits.", "cat": "Potion", "rarity": "mythic", "price_copper": 500000, "weight": 0.5, "consumable": True,
     "bonuses": [{"bonus_type": "hp_bonus", "value": 100}, {"bonus_type": "stat_bonus", "stat_name": "constitution", "value": 6, "is_conditional": True, "condition_description": "10 turns after use"}]},
    # ── MISC ───────────────────────────────────────────────────
    {"name": "Torch", "description": "Provides light in dark places.", "cat": "Misc", "rarity": "common", "price_copper": 100, "weight": 1.0},
    {"name": "Rope (50 ft)", "description": "Sturdy hempen rope.", "cat": "Misc", "rarity": "common", "price_copper": 200, "weight": 5.0},
    {"name": "Lockpick Set", "description": "Tools for opening locks.", "cat": "Misc", "rarity": "uncommon", "price_copper": 2500, "weight": 0.5},
    {"name": "Bag of Holding", "description": "A magical bag with infinite interior space.", "cat": "Misc", "rarity": "rare", "price_copper": 50000, "weight": 0.5, "tags": '["magic"]'},
    # ── QUEST ──────────────────────────────────────────────────
    {"name": "Mysterious Amulet", "description": "A quest item pulsing with unknown energy.", "cat": "Quest", "rarity": "rare", "price_copper": 0, "weight": 0.2},
    {"name": "Crown of the Fallen King", "description": "A tarnished crown whispering forgotten commands.", "cat": "Quest", "rarity": "legendary", "price_copper": 0, "weight": 0.5},
]


async def _ensure_default_categories(db: AsyncSession) -> dict[str, int]:
    """Ensure default categories exist, return name→id mapping."""
    count = await db.scalar(select(func.count()).select_from(ItemCategory).where(ItemCategory.session_id == None))
    if count == 0:
        for c in DEFAULT_CATEGORIES:
            db.add(ItemCategory(**c))
        await db.commit()
    result = await db.execute(select(ItemCategory).where(ItemCategory.session_id == None))
    return {c.name: c.id for c in result.scalars().all()}


async def _ensure_default_items(db: AsyncSession):
    count = await db.scalar(select(func.count()).select_from(Item).where(Item.session_id == None))
    if count > 0:
        return
    cat_map = await _ensure_default_categories(db)
    for spec in DEFAULT_ITEMS_SPEC:
        cat_name = spec.get("cat", "Misc")
        item = Item(
            name=spec["name"],
            description=spec.get("description", ""),
            category=cat_name.lower(),
            category_id=cat_map.get(cat_name),
            rarity=spec.get("rarity", "common"),
            base_price=spec.get("price_copper", 0) // 100,  # legacy gold
            base_price_bronze=spec.get("price_copper", 0),
            weight=spec.get("weight", 0.0),
            equippable=spec.get("equippable", False),
            consumable=spec.get("consumable", False),
            tags=spec.get("tags", "[]"),
        )
        db.add(item)
        await db.flush()  # get item.id
        # Add bonuses
        for b in spec.get("bonuses", []):
            db.add(ItemBonus(
                item_id=item.id,
                bonus_type=b["bonus_type"],
                stat_name=b.get("stat_name"),
                value=b["value"],
                is_conditional=b.get("is_conditional", False),
                condition_description=b.get("condition_description"),
            ))
        # Add weapon stats
        ws = spec.get("weapon")
        if ws:
            db.add(ItemWeaponStats(
                item_id=item.id,
                dice_count=ws.get("dice_count", 1),
                dice_type=ws.get("dice_type", 6),
                damage_type=ws.get("damage_type", "physical"),
                range=ws.get("range"),
            ))
    await db.commit()


# ══════════════════════════════════════════════════════════════
# ITEM CATEGORIES
# ══════════════════════════════════════════════════════════════
@router.get("/item-categories")
async def list_categories(session_id: int = None, db: AsyncSession = Depends(get_session)):
    await _ensure_default_categories(db)
    q = select(ItemCategory)
    if session_id is not None:
        q = q.where(or_(ItemCategory.session_id == session_id, ItemCategory.session_id == None))
    else:
        q = q.where(ItemCategory.session_id == None)
    result = await db.execute(q)
    return [{"id": c.id, "name": c.name, "icon": c.icon, "session_id": c.session_id} for c in result.scalars().all()]


@router.post("/item-categories")
async def create_category(body: dict, db: AsyncSession = Depends(get_session)):
    cat = ItemCategory(
        name=body.get("name", "Custom"),
        icon=body.get("icon", "📦"),
        session_id=body.get("session_id"),
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return {"id": cat.id, "name": cat.name, "icon": cat.icon, "session_id": cat.session_id}


# ══════════════════════════════════════════════════════════════
# ITEMS CRUD
# ══════════════════════════════════════════════════════════════
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
        weight=body.get("weight", 0.0),
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
        db.add(ItemWeaponStats(
            item_id=item.id,
            dice_count=ws.get("dice_count", 1),
            dice_type=ws.get("dice_type", 6),
            damage_type=ws.get("damage_type", "physical"),
            range=ws.get("range"),
            weapon_range=ws.get("weapon_range", "melee"),
            weapon_properties=json.dumps(wp) if isinstance(wp, list) else (wp or "[]"),
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
              "base_price_bronze", "weight", "effect_type", "effect_value", "equippable",
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
            for k in ["dice_count", "dice_type", "damage_type", "range", "weapon_range"]:
                if k in ws:
                    setattr(item.weapon_stats, k, ws[k])
            if "weapon_properties" in ws:
                wp = ws["weapon_properties"]
                item.weapon_stats.weapon_properties = json.dumps(wp) if isinstance(wp, list) else (wp or "[]")
        else:
            wp = ws.get("weapon_properties", [])
            db.add(ItemWeaponStats(
                item_id=item.id,
                **{k: ws[k] for k in ["dice_count", "dice_type", "damage_type", "range"] if k in ws},
                weapon_range=ws.get("weapon_range", "melee"),
                weapon_properties=json.dumps(wp) if isinstance(wp, list) else (wp or "[]"),
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
        "weight": i.weight,
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
        d["weapon_stats"] = {
            "id": ws.id, "dice_count": ws.dice_count, "dice_type": ws.dice_type,
            "damage_type": ws.damage_type, "range": ws.range,
            "weapon_range": ws.weapon_range or "melee",
            "weapon_properties": json.loads(ws.weapon_properties) if ws.weapon_properties else [],
        }
    return d


# ══════════════════════════════════════════════════════════════
# INVENTORY ITEM SERIALIZATION
# ══════════════════════════════════════════════════════════════
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
    total_weight = 0.0       # legacy: all items
    total_weight_bag = 0.0   # Rework: only non-equipped (what the bag carries)
    bag_count = 0
    equipped_count = 0
    for e in entries:
        d = _inventory_item_dict(e)
        w = (d.get("weight", 0) or 0) * e.quantity
        total_weight += w
        if d.get("is_equipped"):
            equipped_count += 1
        else:
            bag_count += 1
            total_weight_bag += w
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

    return {
        "items": items_out,
        "tab": tab_norm,
        "total_weight": round(total_weight, 1),
        # Rework Phase 3: bag-only weight (equipped doesn't count)
        "total_weight_bag": round(total_weight_bag, 1),
        "bag_count": bag_count,
        "equipped_count": equipped_count,
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
        db.add(InventoryItem(
            character_id=character_id,
            item_id=item_id,
            quantity=quantity,
            acquired_at=datetime.now(timezone.utc),
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


@router.post("/inventory/{inventory_id}/use")
async def use_consumable(inventory_id: int, db: AsyncSession = Depends(get_session)):
    import random
    from app.game_mechanics import spend_mana, get_effective_mana_max, restore_mana as _restore_mana
    from app.models import StatModifier, CharacterStatusEffect, StatusEffectTemplate

    entry = await db.get(InventoryItem, inventory_id)
    if not entry:
        raise HTTPException(404)
    item = await db.get(Item, entry.item_id)
    if not item or not item.consumable:
        raise HTTPException(400, "Item is not consumable")

    char = await db.get(Character, entry.character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    # FIX 6: snapshot before for response delta
    _hp_before = char.current_hp
    _mana_before = char.mana_current

    results = []

    # 1. Mana cost check
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

    for eff in effects_list:
        etype = eff.get("type", "")

        if etype == "heal_hp":
            dice_count = eff.get("dice_count", 1)
            dice_type = eff.get("dice_type", 4)
            flat_bonus = eff.get("flat_bonus", 0)
            rolls = [random.randint(1, dice_type) for _ in range(dice_count)]
            total_heal = sum(rolls) + flat_bonus
            old_hp = char.current_hp
            char.current_hp = min(char.max_hp, char.current_hp + total_heal)
            actual = char.current_hp - old_hp
            roll_str = "+".join(str(r) for r in rolls)
            results.append(f"Heal: {dice_count}d{dice_type}+{flat_bonus} ({roll_str}+{flat_bonus}={total_heal}) → +{actual} HP ({old_hp}→{char.current_hp})")

        elif etype == "restore_mana":
            amount = eff.get("amount", 0)
            eff_max = get_effective_mana_max(char.mana_max)
            old_mana = char.mana_current
            char.mana_current = _restore_mana(char.mana_current, eff_max, amount=amount)
            actual = char.mana_current - old_mana
            results.append(f"Mana: +{actual} ({old_mana}→{char.mana_current})")

        elif etype == "apply_status":
            template_id = eff.get("template_id")
            duration = eff.get("duration_turns")
            if template_id:
                tmpl = await db.get(StatusEffectTemplate, template_id)
                if tmpl:
                    cse = CharacterStatusEffect(
                        character_id=char.id,
                        template_id=tmpl.id,
                        name=tmpl.name,
                        icon=tmpl.icon,
                        color=tmpl.color,
                        effects=tmpl.effects,
                        remaining_turns=duration if duration else tmpl.default_duration,
                    )
                    db.add(cse)
                    results.append(f"Applied status: {tmpl.icon} {tmpl.name}" + (f" ({duration} turns)" if duration else ""))

        elif etype == "stat_boost":
            stat = eff.get("stat", "strength")
            value = eff.get("value", 0)
            duration_turns = eff.get("duration_turns", 3)
            from datetime import timedelta
            expires = datetime.now(timezone.utc) + timedelta(minutes=duration_turns * 2)
            mod = StatModifier(
                character_id=char.id,
                stat_name=stat,
                name=f"{item.name} boost",
                value=value,
                is_active=True,
                source="potion",
                expires_at=expires,
            )
            db.add(mod)
            results.append(f"Stat boost: +{value} {stat.capitalize()} for {duration_turns} turns")

        elif etype == "remove_status":
            status_name = eff.get("status_name", "")
            if status_name:
                res = await db.execute(
                    select(CharacterStatusEffect).where(
                        CharacterStatusEffect.character_id == char.id,
                        CharacterStatusEffect.name == status_name,
                    )
                )
                for cse in res.scalars().all():
                    await db.delete(cse)
                results.append(f"Removed status: {status_name}")

        elif etype == "damage":
            dice_count = eff.get("dice_count", 1)
            dice_type = eff.get("dice_type", 6)
            flat_bonus = eff.get("flat_bonus", 0)
            rolls = [random.randint(1, dice_type) for _ in range(dice_count)]
            total_dmg = sum(rolls) + flat_bonus
            old_hp = char.current_hp
            char.current_hp = max(0, char.current_hp - total_dmg)
            if char.current_hp <= 0:
                char.is_alive = False
            actual = old_hp - char.current_hp
            results.append(f"Damage: {dice_count}d{dice_type}+{flat_bonus}={total_dmg} → -{actual} HP ({old_hp}→{char.current_hp})")

        elif etype == "custom":
            desc = eff.get("description", "")
            results.append(f"Effect: {desc}")

    # 3. Legacy single-effect fallback (if no use_effect)
    if not effects_list:
        if item.effect_type == "hp_bonus" and item.effect_value and char:
            old_hp = char.current_hp
            char.current_hp = min(char.max_hp, char.current_hp + int(item.effect_value))
            results.append(f"+{char.current_hp - old_hp} HP ({old_hp}→{char.current_hp})")
        for bonus in (item.bonuses or []):
            if bonus.bonus_type == "hp_bonus":
                old_hp = char.current_hp
                char.current_hp = min(char.max_hp, char.current_hp + int(bonus.value))
                results.append(f"+{char.current_hp - old_hp} HP ({old_hp}→{char.current_hp})")

    # 4. Reduce quantity
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
        # FIX 6: before/after for UI deltas
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

# ── Legacy backward-compatible endpoints ──────────────────────
@router.get("/inventory/{character_id}")
async def get_inventory_legacy(character_id: int, db: AsyncSession = Depends(get_session)):
    """Legacy endpoint — same data as new format for backward compat."""
    result = await db.execute(
        select(InventoryItem).where(InventoryItem.character_id == character_id)
    )
    entries = result.scalars().all()
    items = []
    total_weight = 0.0
    for e in entries:
        d = _inventory_item_dict(e)
        total_weight += (d.get("weight", 0) or 0) * e.quantity
        items.append(d)
    return {"items": items, "total_weight": round(total_weight, 1)}


@router.post("/inventory/grant")
async def grant_item_legacy(body: dict, db: AsyncSession = Depends(get_session)):
    """Legacy grant endpoint."""
    char_id = body.get("character_id")
    item_id = body.get("item_id")
    quantity = body.get("quantity", 1)
    if not char_id or not item_id:
        raise HTTPException(400, "character_id and item_id required")

    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == char_id,
            InventoryItem.item_id == item_id,
            InventoryItem.is_equipped == False,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.quantity += quantity
    else:
        db.add(InventoryItem(
            character_id=char_id,
            item_id=item_id,
            quantity=quantity,
            acquired_at=datetime.now(timezone.utc),
        ))
    await db.commit()
    return {"ok": True, "item_name": item.name, "quantity": quantity}


# ══════════════════════════════════════════════════════════════
# SHOP
# ══════════════════════════════════════════════════════════════
@router.get("/shop/{session_code}")
async def get_shop(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    shop_result = await db.execute(
        select(ShopItem).where(ShopItem.session_id == session.id)
    )
    entries = shop_result.scalars().all()
    items = []
    for e in entries:
        item = await db.get(Item, e.item_id)
        if item:
            d = _item_dict(item)
            d["shop_item_id"] = e.id
            d["price"] = e.price_override if e.price_override is not None else item.base_price
            d["stock"] = e.stock
            items.append(d)
    return {"items": items, "shop_open": session.shop_open if hasattr(session, 'shop_open') else False}


@router.post("/shop/{session_code}/add")
async def add_to_shop(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id required")
    entry = ShopItem(
        session_id=session.id, item_id=item_id,
        price_override=body.get("price_override"),
        stock=body.get("stock", -1),
    )
    db.add(entry)
    await db.commit()
    return {"ok": True}


@router.delete("/shop/item/{shop_item_id}")
async def remove_from_shop(shop_item_id: int, db: AsyncSession = Depends(get_session)):
    entry = await db.get(ShopItem, shop_item_id)
    if not entry:
        raise HTTPException(404)
    await db.delete(entry)
    await db.commit()
    return {"ok": True}


@router.post("/shop/{session_code}/buy")
async def buy_item(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    shop_item_id = body.get("shop_item_id")
    character_id = body.get("character_id")
    if not shop_item_id or not character_id:
        raise HTTPException(400, "shop_item_id and character_id required")

    shop_entry = await db.get(ShopItem, shop_item_id)
    if not shop_entry:
        raise HTTPException(404, "Shop item not found")

    item = await db.get(Item, shop_entry.item_id)
    char = await db.get(Character, character_id)
    if not item or not char:
        raise HTTPException(404)

    price = shop_entry.price_override if shop_entry.price_override is not None else item.base_price

    # Check gold
    gold = char.gold or 0
    if gold < price:
        raise HTTPException(400, f"Not enough gold ({gold}/{price})")

    # Check stock
    if shop_entry.stock == 0:
        raise HTTPException(400, "Out of stock")

    # Deduct gold
    char.gold = gold - price

    # Reduce stock
    if shop_entry.stock > 0:
        shop_entry.stock -= 1

    # Add to inventory
    inv_result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == character_id,
            InventoryItem.item_id == item.id,
        )
    )
    existing = inv_result.scalar_one_or_none()
    if existing:
        existing.quantity += 1
    else:
        db.add(InventoryItem(character_id=character_id, item_id=item.id, quantity=1))

    await db.commit()
    return {"ok": True, "item_name": item.name, "gold_remaining": char.gold}
