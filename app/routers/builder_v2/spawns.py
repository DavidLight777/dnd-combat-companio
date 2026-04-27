"""Shared NPC spawn helper -- used by legacy /api/npc-library/templates/{id}/spawn
and by the bv2 activate_location auto-spawn hook. Keep these two callsites in
sync by funnelling them through this single function.
"""

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Character, InventoryItem, NpcShopInventory, NpcTemplate


async def spawn_npc_from_template(
    db: AsyncSession,
    template: NpcTemplate,
    *,
    session_id: int,
    count: int = 1,
    location_id: int | None = None,
    col: int | None = None,
    row: int | None = None,
) -> list[Character]:
    """Spawn `count` Character rows from `template`. Returns the created
    characters (already flushed but NOT committed -- caller commits).

    `location_id`/`col`/`row` set bv2 grid placement when provided; legacy
    callers that put NPCs on the legacy MapFloor leave them None.
    """
    spawned: list[Character] = []
    for i in range(count):
        suffix = f" #{i + 1}" if count > 1 else ""
        char = Character(
            session_id=session_id,
            name=f"{template.name}{suffix}",
            is_npc=True,
            is_gm_controlled=True,
            max_hp=template.max_hp,
            current_hp=template.max_hp,
            spiritual_max_hp=template.spiritual_max_hp,
            spiritual_hp=template.spiritual_max_hp,
            mana_max=template.mana_max,
            mana_current=template.mana_max,
            armor_class=template.armor_class,
            strength=template.strength,
            dexterity=template.dexterity,
            constitution=template.constitution,
            intelligence=template.intelligence,
            wisdom=template.wisdom,
            charisma=template.charisma,
            initiative_bonus=template.initiative_bonus,
            token_color=template.token_color,
            notes=template.notes,
            current_location_id=location_id,
            col=(col if col is not None else 0),
            row=(row if row is not None else 0),
        )
        db.add(char)
        await db.flush()

        equipment_ids = json.loads(template.default_equipment) if template.default_equipment else []
        for item_id in equipment_ids:
            db.add(
                InventoryItem(
                    character_id=char.id,
                    item_id=item_id,
                    quantity=1,
                    is_equipped=True,
                )
            )

        if template.is_merchant:
            shop_items = json.loads(template.shop_items) if template.shop_items else []
            for si in shop_items:
                db.add(
                    NpcShopInventory(
                        npc_id=char.id,
                        item_id=si.get("item_id"),
                        stock=si.get("stock"),
                        price_override_copper=si.get("price_override"),
                    )
                )

        spawned.append(char)
    return spawned
