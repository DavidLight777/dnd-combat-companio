"""Abilities — shared router, serializers, helpers."""
import json

from fastapi import APIRouter

from app.models import (
    Ability,
)

router = APIRouter(prefix="/api", tags=["abilities"])


_ABILITY_FIELDS = [
    "name", "description", "session_id", "icon", "color",
    "flavor_text", "notes", "tags", "ability_type", "target_type",
    "aoe_radius", "damage_type", "custom_damage_type", "mana_cost",
    "hp_cost", "cooldown_turns", "requires_hit_roll", "hit_stat",
    "damage_stat", "damage_dice_count", "damage_dice_type",
    "is_passive", "passive_effect", "effect", "usage_policy",
    "automation_level", "knave_kind", "range", "range_cells",
    "rarity", "is_in_starting_pool", "max_uses",
    "is_conditional", "conditional_text",
]

_ABILITY_JSON_FIELDS = ["tags", "passive_effect", "effect", "usage_policy"]


def _set_ability_fields(a: Ability, body: dict):
    for f in _ABILITY_FIELDS:
        if f in body:
            v = body[f]
            if f == "rarity" and isinstance(v, str):
                v = v.lower()
            setattr(a, f, v)
    for f in _ABILITY_JSON_FIELDS:
        if f in body:
            v = body[f]
            setattr(a, f, json.dumps(v) if isinstance(v, (dict, list)) else v)


def _parse_json_field(val, fallback=None):
    if fallback is None:
        fallback = {}
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return fallback
    return val if val is not None else fallback


def _ability_dict(a: Ability) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "description": a.description,
        "session_id": a.session_id,
        "icon": a.icon,
        "color": a.color,
        "flavor_text": a.flavor_text,
        "notes": a.notes,
        "tags": _parse_json_field(a.tags, []),
        "ability_type": a.ability_type,
        "target_type": a.target_type,
        "aoe_radius": a.aoe_radius,
        "damage_type": a.damage_type,
        "custom_damage_type": a.custom_damage_type,
        "mana_cost": a.mana_cost,
        "hp_cost": a.hp_cost,
        "cooldown_turns": a.cooldown_turns,
        "requires_hit_roll": a.requires_hit_roll,
        "hit_stat": a.hit_stat,
        "damage_stat": a.damage_stat,
        "damage_dice_count": a.damage_dice_count,
        "damage_dice_type": a.damage_dice_type,
        "range_cells": a.range_cells if a.range_cells is not None else 1,
        "is_passive": a.is_passive,
        "passive_effect": _parse_json_field(a.passive_effect),
        "effect": _parse_json_field(a.effect),
        "usage_policy": _parse_json_field(a.usage_policy),
        "automation_level": a.automation_level or "full",
        "knave_kind": a.knave_kind,
        "range": a.range,
        "rarity": a.rarity or "common",
        "is_in_starting_pool": bool(a.is_in_starting_pool),
        "max_uses": a.max_uses,
        "is_conditional": bool(a.is_conditional),
        "conditional_text": a.conditional_text,
    }


_CONFIG_SCALAR_FIELDS = [
    "mana_cost", "hp_cost", "cooldown_turns", "damage_dice_count",
    "damage_dice_type", "range_cells", "aoe_radius", "max_uses",
]

_CONFIG_JSON_FIELDS = ["effect", "passive_effect"]


def _config_to_dict(cfg) -> dict:
    d = {"id": cfg.id, "ability_id": cfg.ability_id}
    if hasattr(cfg, "level"):
        d["level"] = cfg.level
    if hasattr(cfg, "rank"):
        d["rank"] = cfg.rank
    for f in _CONFIG_SCALAR_FIELDS:
        v = getattr(cfg, f, None)
        if v is not None:
            d[f] = v
    for f in _CONFIG_JSON_FIELDS:
        v = getattr(cfg, f, None)
        if v:
            try:
                d[f] = json.loads(v)
            except Exception:
                d[f] = v
    return d


def _apply_config_body(cfg, body: dict):
    for f in _CONFIG_SCALAR_FIELDS:
        if f in body:
            v = body[f]
            if v is None or (isinstance(v, str) and v.strip() == ""):
                setattr(cfg, f, None)
            else:
                setattr(cfg, f, v)
    for f in _CONFIG_JSON_FIELDS:
        if f in body:
            v = body[f]
            if v is None or v == "" or v == {} or v == []:
                setattr(cfg, f, None)
            else:
                setattr(cfg, f, json.dumps(v) if isinstance(v, (dict, list)) else str(v))
