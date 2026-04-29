from typing import Optional

from pydantic import BaseModel


# ── Session ──────────────────────────────────────────────────
class SessionCreate(BaseModel):
    name: str = "New Session"
    code: str | None = None


class SessionJoin(BaseModel):
    session_code: str
    player_name: str
    # Rework v2: identity (cosmetic) + race. Class/profession is assigned by
    # the GM AFTER creation via the character_professions M:N table, not here.
    race_id: int | None = None
    age: int | None = None
    gender: str | None = None


class SessionOut(BaseModel):
    id: int
    code: str
    name: str
    status: str
    turn_number: int
    player_count: int


class SessionCreated(BaseModel):
    session_code: str
    gm_token: str
    session_id: int


class SessionJoined(BaseModel):
    player_token: str
    character_id: int
    session_code: str


# ── Character ────────────────────────────────────────────────
class CharacterCreate(BaseModel):
    name: str
    is_npc: bool = False
    armor_class: int = 10
    max_hp: int = 20
    spiritual_max_hp: Optional[int] = None
    mana_max: Optional[int] = None
    race_id: Optional[int] = None
    rank: Optional[str] = "common"
    level: Optional[int] = 1
    kill_xp_reward: Optional[int] = 0


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    armor_class: Optional[int] = None
    current_hp: Optional[int] = None
    max_hp: Optional[int] = None
    spiritual_hp: Optional[int] = None
    spiritual_max_hp: Optional[int] = None
    strength: Optional[int] = None
    dexterity: Optional[int] = None
    constitution: Optional[int] = None
    intelligence: Optional[int] = None
    wisdom: Optional[int] = None
    charisma: Optional[int] = None
    initiative_bonus: Optional[int] = None
    token_color: Optional[str] = None
    notes: Optional[str] = None
    turn_count: Optional[int] = None
    gold: Optional[int] = None
    gold_copper: Optional[int] = None  # legacy alias
    wealth_bronze: Optional[int] = None
    mana_current: Optional[int] = None
    mana_max: Optional[int] = None
    mana_regen_per_turn: Optional[int] = None
    can_edit_own_items: Optional[bool] = None
    place_at_table: Optional[bool] = None
    show_hp_to_players: Optional[bool] = None
    level: Optional[int] = None
    experience: Optional[int] = None
    race_id: Optional[int] = None
    is_alive: Optional[bool] = None
    map_x: Optional[float] = None
    map_y: Optional[float] = None
    current_location_id: Optional[int] = None
    col: Optional[int] = None
    row: Optional[int] = None
    gm_notes: Optional[str] = None
    # Phase 12 R4: token portrait image URL
    token_image_url: Optional[str] = None
    # Rework v2: identity (cosmetic) + inventory cap + decline state
    age: Optional[int] = None
    gender: Optional[str] = None
    max_inventory_slots: Optional[int] = None
    kill_xp_reward: Optional[int] = None
    declined_stats: Optional[bool] = None


class HpPatch(BaseModel):
    delta: Optional[int] = None
    set: Optional[int] = None


# ── Damage intake ────────────────────────────────────────────
class DamageIntakeRequest(BaseModel):
    character_id: int
    enemy_roll: int
    damage_rolled: int


# ── HP Recovery ──────────────────────────────────────────────
class HpRecoveryRequest(BaseModel):
    character_id: int
    dice_count: int = 2
    die_type: int = 12
    modifier: int = 0
    advantage_mode: str = "normal"  # normal / advantage / disadvantage


# ── Modifiers / Effects ─────────────────────────────────────
class ModifierCreate(BaseModel):
    modifier_type: str  # "stat", "attack", "damage"
    stat_name: Optional[str] = None
    name: str = "Mod"
    value: int = 0


class EffectCreate(BaseModel):
    name: str = "New Effect"
    effect_type: str = "percent_reduction"
    value: float = 0


# ── Turn Timer ───────────────────────────────────────────────
class TimerCreate(BaseModel):
    name: str = "Timer"
    initial_value: int = 3
