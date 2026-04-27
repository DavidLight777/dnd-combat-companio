"""Shared helpers, serializers, default data, imports"""

"""Inventory system — items CRUD, character inventory, shop, default items seeding."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Item,
    ItemBonus,
    ItemCategory,
    ItemWeaponStats,
)

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
    {"name": "Iron Sword", "description": "A sturdy iron blade.", "cat": "Weapon", "rarity": "common", "price_copper": 1500, "equippable": True,
     "weapon": {"dice_count": 1, "dice_type": 6, "damage_type": "physical", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 1}]},
    {"name": "Steel Longsword", "description": "Well-forged steel longsword with leather grip.", "cat": "Weapon", "rarity": "uncommon", "price_copper": 5000, "equippable": True,
     "weapon": {"dice_count": 1, "dice_type": 8, "damage_type": "physical", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 2}, {"bonus_type": "attack_bonus", "value": 1}]},
    {"name": "Flamebrand", "description": "A blade wreathed in eternal flame.", "cat": "Weapon", "rarity": "rare", "price_copper": 30000, "equippable": True, "tags": '["magic","fire"]',
     "weapon": {"dice_count": 1, "dice_type": 8, "damage_type": "fire", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 4}, {"bonus_type": "attack_bonus", "value": 2}]},
    {"name": "Doom Cleaver", "description": "An axe forged in the abyss, whispers of the damned echo from its edge.", "cat": "Weapon", "rarity": "epic", "price_copper": 80000, "equippable": True, "tags": '["two-handed","cursed"]',
     "weapon": {"dice_count": 2, "dice_type": 8, "damage_type": "physical", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 6}, {"bonus_type": "attack_bonus", "value": 3}, {"bonus_type": "stat_bonus", "stat_name": "strength", "value": 2}]},
    {"name": "Godslayer", "description": "A legendary weapon said to have felled a deity.", "cat": "Weapon", "rarity": "legendary", "price_copper": 500000, "equippable": True, "tags": '["magic","divine"]',
     "weapon": {"dice_count": 2, "dice_type": 10, "damage_type": "magic", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 10}, {"bonus_type": "attack_bonus", "value": 5}, {"bonus_type": "stat_bonus", "stat_name": "strength", "value": 4}]},
    {"name": "Elven Shortbow", "description": "A graceful bow crafted by elven artisans.", "cat": "Weapon", "rarity": "uncommon", "price_copper": 8000, "equippable": True, "tags": '["magic"]',
     "weapon": {"dice_count": 1, "dice_type": 6, "damage_type": "physical", "range": "60ft"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 2}, {"bonus_type": "initiative_bonus", "value": 1}]},
    {"name": "Shadow Dagger", "description": "A dagger that drinks the light around it.", "cat": "Weapon", "rarity": "rare", "price_copper": 25000, "equippable": True, "tags": '["magic","stealth"]',
     "weapon": {"dice_count": 1, "dice_type": 4, "damage_type": "magic", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 3}, {"bonus_type": "stat_bonus", "stat_name": "dexterity", "value": 2}]},
    {"name": "Voidhammer", "description": "A mythic warhammer pulsing with void energy.", "cat": "Weapon", "rarity": "mythic", "price_copper": 1200000, "equippable": True, "tags": '["two-handed","magic","void"]',
     "weapon": {"dice_count": 3, "dice_type": 8, "damage_type": "magic", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 12}, {"bonus_type": "attack_bonus", "value": 6}, {"bonus_type": "stat_bonus", "stat_name": "strength", "value": 6}]},
    {"name": "Eternity's Edge", "description": "A divine blade forged from the fabric of time itself. Those struck age decades in an instant.", "cat": "Weapon", "rarity": "divine", "price_copper": 5000000, "equippable": True, "tags": '["magic","divine","time"]',
     "weapon": {"dice_count": 4, "dice_type": 10, "damage_type": "magic", "range": "melee"},
     "bonuses": [{"bonus_type": "damage_bonus", "value": 20}, {"bonus_type": "attack_bonus", "value": 10}, {"bonus_type": "stat_bonus", "stat_name": "strength", "value": 8}, {"bonus_type": "stat_bonus", "stat_name": "dexterity", "value": 4}]},
    # ── ARMOR ──────────────────────────────────────────────────
    {"name": "Leather Armor", "description": "Basic leather protection.", "cat": "Armor", "rarity": "common", "price_copper": 1000, "equippable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 5}]},
    {"name": "Chain Mail", "description": "Interlocking metal rings provide solid defense.", "cat": "Armor", "rarity": "uncommon", "price_copper": 7500, "equippable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 10}]},
    {"name": "Plate Armor", "description": "Heavy plate offering superior protection.", "cat": "Armor", "rarity": "rare", "price_copper": 40000, "equippable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 15}, {"bonus_type": "flat_damage_reduction", "value": 2}]},
    {"name": "Dragonscale Mail", "description": "Armor crafted from the scales of an ancient dragon.", "cat": "Armor", "rarity": "epic", "price_copper": 120000, "equippable": True, "tags": '["magic"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 20}, {"bonus_type": "flat_damage_reduction", "value": 4}, {"bonus_type": "hp_bonus", "value": 10}]},
    {"name": "Aegis of the Immortal", "description": "A legendary shield-armor that defies death itself.", "cat": "Armor", "rarity": "legendary", "price_copper": 600000, "equippable": True, "tags": '["magic","divine"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 30}, {"bonus_type": "flat_damage_reduction", "value": 8}, {"bonus_type": "hp_bonus", "value": 25}]},
    {"name": "Cloak of Shadows", "description": "A dark cloak that bends light around the wearer.", "cat": "Armor", "rarity": "rare", "price_copper": 35000, "equippable": True, "tags": '["magic","stealth"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 8}, {"bonus_type": "stat_bonus", "stat_name": "dexterity", "value": 3}]},
    {"name": "Titanweave Vestments", "description": "Mythic robes woven from threads of pure mana.", "cat": "Armor", "rarity": "mythic", "price_copper": 1500000, "equippable": True, "tags": '["magic"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 25}, {"bonus_type": "flat_damage_reduction", "value": 6}, {"bonus_type": "hp_bonus", "value": 30}, {"bonus_type": "stat_bonus", "stat_name": "constitution", "value": 4}]},
    {"name": "Mantle of the Eternal", "description": "A divine armor born from the essence of creation. The wearer becomes nearly untouchable.", "cat": "Armor", "rarity": "divine", "price_copper": 8000000, "equippable": True, "tags": '["magic","divine"]',
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 40}, {"bonus_type": "flat_damage_reduction", "value": 15}, {"bonus_type": "hp_bonus", "value": 50}, {"bonus_type": "stat_bonus", "stat_name": "constitution", "value": 8}]},
    # ── POTIONS ────────────────────────────────────────
    {"name": "Health Potion (Minor)", "description": "Restores 10 HP.", "cat": "Potion", "rarity": "common", "price_copper": 500, "consumable": True,
     "bonuses": [{"bonus_type": "hp_bonus", "value": 10}]},
    {"name": "Health Potion (Greater)", "description": "Restores 25 HP.", "cat": "Potion", "rarity": "uncommon", "price_copper": 2500, "consumable": True,
     "bonuses": [{"bonus_type": "hp_bonus", "value": 25}]},
    {"name": "Health Potion (Supreme)", "description": "Restores 50 HP.", "cat": "Potion", "rarity": "rare", "price_copper": 10000, "consumable": True,
     "bonuses": [{"bonus_type": "hp_bonus", "value": 50}]},
    {"name": "Potion of Resistance", "description": "Grants 10% damage reduction for 3 turns.", "cat": "Potion", "rarity": "uncommon", "price_copper": 4000, "consumable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 10, "is_conditional": True, "condition_description": "3 turns after use"}]},
    {"name": "Elixir of Fortitude", "description": "Grants 20% damage reduction for 3 turns.", "cat": "Potion", "rarity": "rare", "price_copper": 12000, "consumable": True,
     "bonuses": [{"bonus_type": "percent_damage_reduction", "value": 20, "is_conditional": True, "condition_description": "3 turns after use"}]},
    {"name": "Potion of Giant Strength", "description": "Temporarily grants immense strength.", "cat": "Potion", "rarity": "epic", "price_copper": 50000, "consumable": True,
     "bonuses": [{"bonus_type": "stat_bonus", "stat_name": "strength", "value": 6, "is_conditional": True, "condition_description": "5 turns after use"}]},
    {"name": "Elixir of Ascension", "description": "A mythic draught that briefly elevates the drinker beyond mortal limits.", "cat": "Potion", "rarity": "mythic", "price_copper": 500000, "consumable": True,
     "bonuses": [{"bonus_type": "hp_bonus", "value": 100}, {"bonus_type": "stat_bonus", "stat_name": "constitution", "value": 6, "is_conditional": True, "condition_description": "10 turns after use"}]},
    # ── MISC ───────────────────────────────────────────────────
    {"name": "Torch", "description": "Provides light in dark places.", "cat": "Misc", "rarity": "common", "price_copper": 100},
    {"name": "Rope (50 ft)", "description": "Sturdy hempen rope.", "cat": "Misc", "rarity": "common", "price_copper": 200},
    {"name": "Lockpick Set", "description": "Tools for opening locks.", "cat": "Misc", "rarity": "uncommon", "price_copper": 2500},
    {"name": "Bag of Holding", "description": "A magical bag with infinite interior space.", "cat": "Misc", "rarity": "rare", "price_copper": 50000, "tags": '["magic"]'},
    # ── QUEST ──────────────────────────────────────────────────
    {"name": "Mysterious Amulet", "description": "A quest item pulsing with unknown energy.", "cat": "Quest", "rarity": "rare", "price_copper": 0},
    {"name": "Crown of the Fallen King", "description": "A tarnished crown whispering forgotten commands.", "cat": "Quest", "rarity": "legendary", "price_copper": 0},
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
# HELPERS
# ══════════════════════════════════════════════════════════════
_DAMAGE_MODE_CAP = 8  # hard cap on number of preset damage modes per weapon


def _sanitize_damage_modes(raw) -> list:
    """Validate + clamp a GM-submitted damage_modes list.

    Returns a clean list of dicts ready to json.dumps into the DB. Empty
    input → empty list (weapon uses its flat dice_count/dice_type fallback).
    """
    if not isinstance(raw, list):
        return []
    out = []
    for m in raw[:_DAMAGE_MODE_CAP]:
        if not isinstance(m, dict):
            continue
        try:
            dc = max(1, min(20, int(m.get("dice_count", 1))))
            dt = max(2, min(100, int(m.get("dice_type", 6))))
        except (TypeError, ValueError):
            continue
        name = str(m.get("name") or f"{dc}d{dt}")[:60]
        dmg_type = str(m.get("damage_type") or "physical")[:20]
        dmg_stat = m.get("damage_stat")
        if dmg_stat is not None:
            dmg_stat = str(dmg_stat)[:20]
        out.append({
            "name": name,
            "dice_count": dc,
            "dice_type": dt,
            "damage_type": dmg_type,
            "damage_stat": dmg_stat,
        })
    return out


def _sanitize_range_cells(raw, fallback: int = 1) -> int:
    """Coerce any GM payload into a valid `range_cells` int.

    Accepts int/str inputs, clamps to [1, 40] (40 cells = across the
    whole typical map — sanity upper bound), and falls back on the
    caller's default for garbage inputs. We never store `None` via
    this helper because JSON from the GM form often loses the field
    type; callers that explicitly want unlimited-range should pass
    `None` straight through without calling this.
    """
    if raw is None or raw == "":
        return fallback
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return fallback
    if v < 1:
        return 1
    return min(40, v)


# ══════════════════════════════════════════════════════════════
