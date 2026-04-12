"""Inventory system — items CRUD, character inventory, shop, default items seeding."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Session, Character, Item, InventoryItem, ShopItem

router = APIRouter(prefix="/api", tags=["inventory"])

# ── Default items (seeded on first request if DB is empty) ───
DEFAULT_ITEMS = [
    {"name": "Iron Sword", "description": "A sturdy iron blade.", "category": "weapon", "rarity": "common", "base_price": 15, "weight": 3.0, "equippable": True},
    {"name": "Steel Longsword", "description": "Well-forged steel longsword with leather grip.", "category": "weapon", "rarity": "uncommon", "base_price": 50, "weight": 3.5, "equippable": True},
    {"name": "Flamebrand", "description": "A blade wreathed in eternal flame.", "category": "weapon", "rarity": "rare", "base_price": 300, "weight": 3.0, "equippable": True, "effect_type": "flat_reduction", "effect_value": -5},
    {"name": "Doom Cleaver", "description": "An axe forged in the abyss, whispers of the damned echo from its edge.", "category": "weapon", "rarity": "epic", "base_price": 800, "weight": 5.0, "equippable": True},
    {"name": "Godslayer", "description": "A legendary weapon said to have felled a deity.", "category": "weapon", "rarity": "legendary", "base_price": 5000, "weight": 4.0, "equippable": True},
    {"name": "Leather Armor", "description": "Basic leather protection.", "category": "armor", "rarity": "common", "base_price": 10, "weight": 5.0, "equippable": True, "effect_type": "percent_reduction", "effect_value": 5},
    {"name": "Chain Mail", "description": "Interlocking metal rings provide solid defense.", "category": "armor", "rarity": "uncommon", "base_price": 75, "weight": 12.0, "equippable": True, "effect_type": "percent_reduction", "effect_value": 10},
    {"name": "Plate Armor", "description": "Heavy plate offering superior protection.", "category": "armor", "rarity": "rare", "base_price": 400, "weight": 25.0, "equippable": True, "effect_type": "percent_reduction", "effect_value": 15},
    {"name": "Dragonscale Mail", "description": "Armor crafted from the scales of an ancient dragon.", "category": "armor", "rarity": "epic", "base_price": 1200, "weight": 18.0, "equippable": True, "effect_type": "percent_reduction", "effect_value": 20},
    {"name": "Aegis of the Immortal", "description": "A divine shield-armor that defies death itself.", "category": "armor", "rarity": "legendary", "base_price": 6000, "weight": 15.0, "equippable": True, "effect_type": "percent_reduction", "effect_value": 30},
    {"name": "Health Potion (Minor)", "description": "Restores 10 HP.", "category": "potion", "rarity": "common", "base_price": 5, "weight": 0.3, "consumable": True, "effect_type": "hp_bonus", "effect_value": 10},
    {"name": "Health Potion (Greater)", "description": "Restores 25 HP.", "category": "potion", "rarity": "uncommon", "base_price": 25, "weight": 0.3, "consumable": True, "effect_type": "hp_bonus", "effect_value": 25},
    {"name": "Health Potion (Supreme)", "description": "Restores 50 HP.", "category": "potion", "rarity": "rare", "base_price": 100, "weight": 0.3, "consumable": True, "effect_type": "hp_bonus", "effect_value": 50},
    {"name": "Potion of Resistance", "description": "Grants 10% damage reduction for 3 turns.", "category": "potion", "rarity": "uncommon", "base_price": 40, "weight": 0.3, "consumable": True, "effect_type": "percent_reduction", "effect_value": 10},
    {"name": "Elixir of Fortitude", "description": "Grants 20% damage reduction for 3 turns.", "category": "potion", "rarity": "rare", "base_price": 120, "weight": 0.3, "consumable": True, "effect_type": "percent_reduction", "effect_value": 20},
    {"name": "Torch", "description": "Provides light in dark places.", "category": "misc", "rarity": "common", "base_price": 1, "weight": 1.0},
    {"name": "Rope (50 ft)", "description": "Sturdy hempen rope.", "category": "misc", "rarity": "common", "base_price": 2, "weight": 5.0},
    {"name": "Lockpick Set", "description": "Tools for opening locks.", "category": "misc", "rarity": "uncommon", "base_price": 25, "weight": 0.5},
    {"name": "Mysterious Amulet", "description": "A quest item pulsing with unknown energy.", "category": "quest", "rarity": "rare", "base_price": 0, "weight": 0.2},
    {"name": "Crown of the Fallen King", "description": "A tarnished crown whispering forgotten commands.", "category": "quest", "rarity": "legendary", "base_price": 0, "weight": 0.5},
]


async def _ensure_default_items(db: AsyncSession):
    count = await db.scalar(select(func.count()).select_from(Item).where(Item.session_id == None))
    if count == 0:
        for d in DEFAULT_ITEMS:
            db.add(Item(**d))
        await db.commit()


# ══════════════════════════════════════════════════════════════
# ITEMS CRUD
# ══════════════════════════════════════════════════════════════
@router.get("/items")
async def list_items(category: str = None, rarity: str = None, session_id: int = None, db: AsyncSession = Depends(get_session)):
    await _ensure_default_items(db)
    q = select(Item)
    if session_id is not None:
        q = q.where((Item.session_id == session_id) | (Item.session_id == None))
    if category:
        q = q.where(Item.category == category)
    if rarity:
        q = q.where(Item.rarity == rarity)
    q = q.order_by(Item.rarity, Item.name)
    result = await db.execute(q)
    items = result.scalars().all()
    return [_item_dict(i) for i in items]


@router.post("/items")
async def create_item(body: dict, db: AsyncSession = Depends(get_session)):
    item = Item(
        session_id=body.get("session_id"),
        name=body.get("name", "Item"),
        description=body.get("description", ""),
        category=body.get("category", "misc"),
        rarity=body.get("rarity", "common"),
        base_price=body.get("base_price", 0),
        weight=body.get("weight", 0.0),
        effect_type=body.get("effect_type"),
        effect_value=body.get("effect_value"),
        equippable=body.get("equippable", False),
        consumable=body.get("consumable", False),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _item_dict(item)


@router.put("/items/{item_id}")
async def update_item(item_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404)
    for k in ["name", "description", "category", "rarity", "base_price", "weight", "effect_type", "effect_value", "equippable", "consumable"]:
        if k in body:
            setattr(item, k, body[k])
    await db.commit()
    return _item_dict(item)


@router.delete("/items/{item_id}")
async def delete_item(item_id: int, db: AsyncSession = Depends(get_session)):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(404)
    await db.delete(item)
    await db.commit()
    return {"ok": True}


def _item_dict(i: Item) -> dict:
    return {
        "id": i.id, "session_id": i.session_id, "name": i.name, "description": i.description,
        "category": i.category, "rarity": i.rarity, "base_price": i.base_price, "weight": i.weight,
        "effect_type": i.effect_type, "effect_value": i.effect_value,
        "equippable": i.equippable, "consumable": i.consumable,
    }


# ══════════════════════════════════════════════════════════════
# CHARACTER INVENTORY
# ══════════════════════════════════════════════════════════════
@router.get("/inventory/{character_id}")
async def get_inventory(character_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(InventoryItem).where(InventoryItem.character_id == character_id)
    )
    entries = result.scalars().all()
    items = []
    total_weight = 0.0
    for e in entries:
        item = await db.get(Item, e.item_id)
        if item:
            d = _item_dict(item)
            d["inventory_id"] = e.id
            d["quantity"] = e.quantity
            d["is_equipped"] = e.is_equipped
            total_weight += (item.weight or 0) * e.quantity
            items.append(d)
    return {"items": items, "total_weight": round(total_weight, 1)}


@router.post("/inventory/grant")
async def grant_item(body: dict, db: AsyncSession = Depends(get_session)):
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

    # Check if already in inventory
    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == char_id,
            InventoryItem.item_id == item_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.quantity += quantity
    else:
        db.add(InventoryItem(character_id=char_id, item_id=item_id, quantity=quantity))
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
    entry.is_equipped = equip
    await db.commit()
    return {"ok": True, "is_equipped": entry.is_equipped}


@router.post("/inventory/{inventory_id}/use")
async def use_consumable(inventory_id: int, db: AsyncSession = Depends(get_session)):
    entry = await db.get(InventoryItem, inventory_id)
    if not entry:
        raise HTTPException(404)
    item = await db.get(Item, entry.item_id)
    if not item or not item.consumable:
        raise HTTPException(400, "Item is not consumable")

    char = await db.get(Character, entry.character_id)
    result_text = f"Used {item.name}"

    # Apply effect
    if item.effect_type == "hp_bonus" and item.effect_value and char:
        old_hp = char.current_hp
        char.current_hp = min(char.max_hp, char.current_hp + int(item.effect_value))
        result_text = f"Used {item.name}: +{char.current_hp - old_hp} HP ({old_hp}→{char.current_hp})"

    # Reduce quantity
    entry.quantity -= 1
    if entry.quantity <= 0:
        await db.delete(entry)
    await db.commit()
    return {"ok": True, "result": result_text}


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
