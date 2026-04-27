"""Abilities router package."""
from app.routers.abilities import character_ab, configs, templates, use
from app.routers.abilities.common import router

# Re-export for backwards compatibility with lazy imports from other modules:
from app.routers.abilities.passive import (
    _apply_passive_bonuses,
    _apply_resolved_passive_bonuses,
    _remove_passive_bonuses,
)
from app.routers.abilities.resolve import (
    _apply_ability_damage_only,
    _resolve_ability,
)
