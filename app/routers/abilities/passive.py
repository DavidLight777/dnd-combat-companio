"""Passive ability bonuses."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ability, AttackModifier, Character, DamageModifier, StatModifier
from app.routers.abilities.common import _parse_json_field


async def _apply_passive_bonuses(char_id: int, ability: Ability, db: AsyncSession):
    """Apply passive ability bonuses as permanent modifiers.

    Supported bonus types:
      * stat_bonus                — +N to a stat (stored in StatModifier)
      * attack_bonus              — +N to attack rolls
      * damage_bonus              — +N to damage rolls
      * damage_reduction_flat/pct — flat / percent damage reduction
      * max_hp_bonus              — +N to max HP (directly mutates character)
      * max_mana_bonus            — +N to mana_max (directly mutates)
      * mana_regen_bonus          — +N to mana_regen_per_turn (directly mutates)
      * hp_die_bonus              — +N to race HP die size for level-up rolls
      * hp_die_count_bonus        — +N to race HP dice count for level-up rolls
    """
    pe = _parse_json_field(ability.passive_effect)
    bonuses = pe.get("bonuses", []) if isinstance(pe, dict) else []
    source_name = f"Ability: {ability.name}"

    # Load character once for direct-mutation bonuses.
    char = await db.get(Character, char_id)

    for b in bonuses:
        btype = b.get("bonus_type", "")
        val = int(b.get("value", 0) or 0)

        if btype == "stat_bonus":
            stat = b.get("stat", "strength")
            db.add(StatModifier(
                character_id=char_id, stat_name=stat,
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "attack_bonus":
            db.add(AttackModifier(
                character_id=char_id, name=source_name, value=val, is_active=True,
            ))
        elif btype == "damage_bonus":
            db.add(DamageModifier(
                character_id=char_id, name=source_name, value=val, is_active=True,
            ))
        elif btype in ("damage_reduction_flat", "damage_reduction_pct"):
            db.add(StatModifier(
                character_id=char_id, stat_name=btype,
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype in ("hp_die_bonus", "hp_die_count_bonus"):
            # Consumed by the level-up HP roll; stored as StatModifier rows so
            # they clean up automatically on unassign.
            db.add(StatModifier(
                character_id=char_id, stat_name=btype,
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "max_hp_bonus" and char:
            char.max_hp = (char.max_hp or 0) + val
            char.current_hp = (char.current_hp or 0) + val
            db.add(StatModifier(
                character_id=char_id, stat_name="max_hp_bonus",
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "max_mana_bonus" and char:
            char.mana_max = (char.mana_max or 0) + val
            char.mana_current = (char.mana_current or 0) + val
            db.add(StatModifier(
                character_id=char_id, stat_name="max_mana_bonus",
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "mana_regen_bonus" and char:
            char.mana_regen_per_turn = (char.mana_regen_per_turn or 0) + val
            db.add(StatModifier(
                character_id=char_id, stat_name="mana_regen_bonus",
                name=source_name, value=val, is_active=True, source="ability",
            ))


async def _remove_passive_bonuses(char_id: int, ability: Ability, db: AsyncSession):
    """Remove all modifiers created by a passive ability.

    For bonuses that directly mutate the character (max_hp / max_mana /
    mana_regen), we reverse the mutation before deleting the StatModifier row.
    """
    source_name = f"Ability: {ability.name}"
    char = await db.get(Character, char_id)

    # First reverse direct-mutation bonuses.
    if char is not None:
        result = await db.execute(
            select(StatModifier).where(
                StatModifier.character_id == char_id,
                StatModifier.name == source_name,
                StatModifier.stat_name.in_(("max_hp_bonus", "max_mana_bonus", "mana_regen_bonus")),
            )
        )
        for m in result.scalars().all():
            if m.stat_name == "max_hp_bonus":
                char.max_hp = max(0, (char.max_hp or 0) - int(m.value or 0))
                char.current_hp = max(0, min(char.max_hp, (char.current_hp or 0) - int(m.value or 0)))
            elif m.stat_name == "max_mana_bonus":
                char.mana_max = max(0, (char.mana_max or 0) - int(m.value or 0))
                char.mana_current = max(0, min(char.mana_max, (char.mana_current or 0) - int(m.value or 0)))
            elif m.stat_name == "mana_regen_bonus":
                char.mana_regen_per_turn = max(0, (char.mana_regen_per_turn or 0) - int(m.value or 0))

    for Model in (StatModifier, AttackModifier, DamageModifier):
        result = await db.execute(
            select(Model).where(Model.character_id == char_id, Model.name == source_name)
        )
        for m in result.scalars().all():
            await db.delete(m)


async def _apply_resolved_passive_bonuses(char_id: int, resolved_ability: dict, db: AsyncSession):
    """Apply passive bonuses from a resolved ability dict (after rank/level configs applied).
    
    Similar to _apply_passive_bonuses but works with a dict instead of ORM object.
    """
    pe = resolved_ability.get("passive_effect", {})
    bonuses = pe.get("bonuses", []) if isinstance(pe, dict) else []
    ability_name = resolved_ability.get("name", "Unknown Ability")
    source_name = f"Ability: {ability_name}"

    # Load character once for direct-mutation bonuses.
    char = await db.get(Character, char_id)

    for b in bonuses:
        btype = b.get("bonus_type", "")
        val = int(b.get("value", 0) or 0)

        if btype == "stat_bonus":
            stat = b.get("stat", "strength")
            db.add(StatModifier(
                character_id=char_id, stat_name=stat,
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "attack_bonus":
            db.add(AttackModifier(
                character_id=char_id, name=source_name, value=val, is_active=True,
            ))
        elif btype == "damage_bonus":
            db.add(DamageModifier(
                character_id=char_id, name=source_name, value=val, is_active=True,
            ))
        elif btype in ("damage_reduction_flat", "damage_reduction_pct"):
            db.add(StatModifier(
                character_id=char_id, stat_name=btype,
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype in ("hp_die_bonus", "hp_die_count_bonus"):
            db.add(StatModifier(
                character_id=char_id, stat_name=btype,
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "max_hp_bonus" and char:
            char.max_hp = (char.max_hp or 0) + val
            char.current_hp = (char.current_hp or 0) + val
            db.add(StatModifier(
                character_id=char_id, stat_name="max_hp_bonus",
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "max_mana_bonus" and char:
            char.mana_max = (char.mana_max or 0) + val
            char.mana_current = (char.mana_current or 0) + val
            db.add(StatModifier(
                character_id=char_id, stat_name="max_mana_bonus",
                name=source_name, value=val, is_active=True, source="ability",
            ))
        elif btype == "mana_regen_bonus" and char:
            char.mana_regen_per_turn = (char.mana_regen_per_turn or 0) + val
            db.add(StatModifier(
                character_id=char_id, stat_name="mana_regen_bonus",
                name=source_name, value=val, is_active=True, source="ability",
            ))


