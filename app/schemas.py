from pydantic import BaseModel
from typing import Optional


# ── Session ──────────────────────────────────────────────────
class SessionCreate(BaseModel):
    name: str = "New Session"


class SessionJoin(BaseModel):
    session_code: str
    player_name: str


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


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    armor_class: Optional[int] = None
    current_hp: Optional[int] = None
    max_hp: Optional[int] = None
    strength: Optional[int] = None
    dexterity: Optional[int] = None
    constitution: Optional[int] = None
    intelligence: Optional[int] = None
    wisdom: Optional[int] = None
    charisma: Optional[int] = None
    hp_dice_count: Optional[int] = None
    hp_dice_type: Optional[int] = None
    hp_recovery_modifier: Optional[int] = None
    initiative_bonus: Optional[int] = None
    token_color: Optional[str] = None
    notes: Optional[str] = None
    turn_count: Optional[int] = None


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
