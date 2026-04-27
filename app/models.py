from datetime import UTC, datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ══════════════════════════════════════════════════════════════
# SESSION
# ══════════════════════════════════════════════════════════════
class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="New Session")
    gm_token: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="waiting")  # waiting, active, paused, ended
    current_turn_character_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("characters.id", use_alter=True), nullable=True)
    turn_number: Mapped[int] = mapped_column(Integer, default=0)
    shop_open: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    # Stage 10: Session timer
    play_timer_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_play_seconds: Mapped[int] = mapped_column(Integer, default=0)

    # Rank/Level system: GM-configurable XP thresholds
    xp_threshold_config: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: {"type":"formula","base":100,"increment":100} or {"type":"table","thresholds":[...]}

    characters: Mapped[list["Character"]] = relationship(
        back_populates="session", cascade="all, delete-orphan",
        foreign_keys="Character.session_id", lazy="selectin"
    )


# ══════════════════════════════════════════════════════════════
# CHARACTER
# ══════════════════════════════════════════════════════════════
class Character(Base):
    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    player_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_npc: Mapped[bool] = mapped_column(Boolean, default=False)
    is_gm_controlled: Mapped[bool] = mapped_column(Boolean, default=False)

    # Rework v2: everyone starts at level 0 with baseline 0 AC and 0 HP —
    # HP is rolled in the creation wizard (Step 6) from the race's HP die.
    armor_class: Mapped[int] = mapped_column(Integer, default=0)
    current_hp: Mapped[int] = mapped_column(Integer, default=0)
    max_hp: Mapped[int] = mapped_column(Integer, default=0)
    # Spiritual HP: separate pool for spirit-based damage/healing
    spiritual_hp: Mapped[int] = mapped_column(Integer, default=0)
    spiritual_max_hp: Mapped[int] = mapped_column(Integer, default=0)
    # Rework v2: each stat value IS the bonus (STR 1 → +1 to hit/damage).
    # Default 1 for accept; Step 4 of the wizard may zero them out in
    # exchange for advantage on the feature roll.
    strength: Mapped[int] = mapped_column(Integer, default=1)
    dexterity: Mapped[int] = mapped_column(Integer, default=1)
    constitution: Mapped[int] = mapped_column(Integer, default=1)
    intelligence: Mapped[int] = mapped_column(Integer, default=1)
    wisdom: Mapped[int] = mapped_column(Integer, default=1)
    charisma: Mapped[int] = mapped_column(Integer, default=1)

    initiative_bonus: Mapped[int] = mapped_column(Integer, default=0)
    initiative_roll: Mapped[int | None] = mapped_column(Integer, nullable=True)
    initiative_order: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Rework v3: hp_dice_count / hp_dice_type / hp_recovery_modifier retired —
    # healing now comes from race HP die (level-up), potions, abilities, and
    # the GM's Full Rest button.

    attack_dice_count: Mapped[int] = mapped_column(Integer, default=1)
    attack_dice_type: Mapped[int] = mapped_column(Integer, default=8)

    map_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    map_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    token_color: Mapped[str] = mapped_column(Text, default="#c08a2a")
    # Rework v3 Phase 6: optional portrait image used by MapCanvas to
    # draw the token face inside the circle. URL points at
    # /api/map/token-image/{filename}. `None` → fall back to the
    # coloured circle + initials.
    token_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_visible_on_map: Mapped[bool] = mapped_column(Boolean, default=True)
    vision_radius: Mapped[int] = mapped_column(Integer, default=5)
    sight_range_cells: Mapped[int] = mapped_column(Integer, default=8)
    # Map Builder v2: grid position inside a bv2 location.
    current_location_id: Mapped[int | None] = mapped_column(
        ForeignKey("bv2_locations.id", ondelete="SET NULL"), nullable=True
    )
    col: Mapped[int] = mapped_column(Integer, default=0)
    row: Mapped[int] = mapped_column(Integer, default=0)
    # Rework v3 Phase 4: grid-movement budget. `base_speed_cells` is the
    # number of cells this character may traverse on their combat turn;
    # default 6 matches the D&D 5e humanoid baseline (30 ft / 5 ft cell).
    # `movement_used_this_turn` is reset to 0 when their turn begins and
    # incremented by PATCH /api/map/token/{id}. Outside combat the field
    # is ignored — free roaming.
    base_speed_cells: Mapped[int] = mapped_column(Integer, default=6)
    movement_used_this_turn: Mapped[float] = mapped_column(Float, default=0.0)

    status_effects: Mapped[str] = mapped_column(Text, default="[]")  # JSON array
    notes: Mapped[str] = mapped_column(Text, default="")
    is_alive: Mapped[bool] = mapped_column(Boolean, default=True)
    gold: Mapped[int] = mapped_column(Integer, default=0)
    wealth_bronze: Mapped[int] = mapped_column(Integer, default=0)  # total wealth in bronze
    # Rework v2: everyone starts with 10 mana (features may override).
    mana_current: Mapped[int] = mapped_column(Integer, default=10)
    mana_max: Mapped[int] = mapped_column(Integer, default=10)
    mana_regen_per_turn: Mapped[int] = mapped_column(Integer, default=0)
    can_edit_own_items: Mapped[bool] = mapped_column(Boolean, default=False)
    place_at_table: Mapped[bool] = mapped_column(Boolean, default=False)
    show_hp_to_players: Mapped[bool] = mapped_column(Boolean, default=False)
    gm_notes: Mapped[str] = mapped_column(Text, default="")

    race_id: Mapped[int | None] = mapped_column(ForeignKey("races.id", ondelete="SET NULL"), nullable=True)
    # Rework v2: class_id is GONE from the lobby — professions are assigned
    # by the GM post-creation via the character_professions M:N table.
    level: Mapped[int] = mapped_column(Integer, default=0)
    experience: Mapped[int] = mapped_column(Integer, default=0)
    # Rework: rank chain common → uncommon → rare → epic → legendary → mythic → divine
    rank: Mapped[str] = mapped_column(String(20), default="common")

    turn_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    # Rework v2: identity (cosmetic only)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gender: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Rework v2: inventory slot cap. Canonical formula on wizard finalize:
    #   slots = 10 + 2 × constitution
    # So CON 0 → 10, CON 1 → 12, CON 2 → 14, ...  (decline is encoded in
    # CON=0 already, no extra +2 baseline on "accept").
    # GM can override on NPCs. 0 = unlimited (NPC default).
    max_inventory_slots: Mapped[int] = mapped_column(Integer, default=12)
    # Rework v2: did the player decline stats for an advantage roll?
    declined_stats: Mapped[bool] = mapped_column(Boolean, default=False)
    # FIX 1 + systems_overhaul Section 3: attribute points for stat distribution
    attribute_points_available: Mapped[int] = mapped_column(Integer, default=0)
    # Fix 4: XP awarded to player who deals killing blow to this NPC
    kill_xp_reward: Mapped[int] = mapped_column(Integer, default=0)

    session: Mapped["Session"] = relationship(
        back_populates="characters", foreign_keys=[session_id]
    )
    effects: Mapped[list["CharacterEffect"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    attack_modifiers: Mapped[list["AttackModifier"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    damage_modifiers: Mapped[list["DamageModifier"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    stat_modifiers: Mapped[list["StatModifier"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    turn_timers: Mapped[list["TurnTimer"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    inventory_items: Mapped[list["InventoryItem"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    professions: Mapped[list["CharacterProfession"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )


# ══════════════════════════════════════════════════════════════
# EFFECTS & MODIFIERS
# ══════════════════════════════════════════════════════════════
class CharacterEffect(Base):
    __tablename__ = "character_effects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, default="New Effect")
    effect_type: Mapped[str] = mapped_column(String(20), default="percent_reduction")
    value: Mapped[float] = mapped_column(Float, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    character: Mapped["Character"] = relationship(back_populates="effects")


class StatModifier(Base):
    __tablename__ = "stat_modifiers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    stat_name: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(Text, default="Modifier")
    value: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual, race, class, potion
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # for timed boosts (potions)

    character: Mapped["Character"] = relationship(back_populates="stat_modifiers")


class AttackModifier(Base):
    __tablename__ = "attack_modifiers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, default="Modifier")
    value: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    character: Mapped["Character"] = relationship(back_populates="attack_modifiers")


class DamageModifier(Base):
    __tablename__ = "damage_modifiers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, default="Modifier")
    value: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    character: Mapped["Character"] = relationship(back_populates="damage_modifiers")


class TurnTimer(Base):
    __tablename__ = "turn_timers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, default="Timer")
    initial_value: Mapped[int] = mapped_column(Integer, default=3)
    current_value: Mapped[int] = mapped_column(Integer, default=3)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    character: Mapped["Character"] = relationship(back_populates="turn_timers")


# ══════════════════════════════════════════════════════════════
# INITIATIVE ORDER
# ══════════════════════════════════════════════════════════════
class InitiativeOrder(Base):
    __tablename__ = "initiative_order"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    roll_result: Mapped[int] = mapped_column(Integer, default=0)
    final_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


# ══════════════════════════════════════════════════════════════
# COMBAT LOG
# ══════════════════════════════════════════════════════════════
class CombatLog(Base):
    __tablename__ = "combat_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    event_type: Mapped[str] = mapped_column(String(20), default="custom")
    actor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("characters.id"), nullable=True)
    target_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("characters.id"), nullable=True)
    value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)


# ══════════════════════════════════════════════════════════════
# MAP DATA
# ══════════════════════════════════════════════════════════════
class MapData(Base):
    __tablename__ = "map_data"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), unique=True)
    # Rework: MapData is now a thin pointer to the active MapFloor.
    # All visual data (image_url, tiles, grid) is read from the floor directly.
    active_floor_id: Mapped[int | None] = mapped_column(ForeignKey("map_floors.id", ondelete="SET NULL"), nullable=True)
    # Legacy fields kept for backward compat during transition
    image_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    grid_size: Mapped[int] = mapped_column(Integer, default=50)
    grid_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Grid style toggle: "square" (king-move / Chebyshev distance) or
    # "hex" (pointy-top hexagons, axial hex distance). Affects rendering,
    # snap-to-cell, movement budget, weapon/ability range enforcement
    # and the measure tool. Fog of war stays indexed by square cells
    # regardless — fog tiles are a crude visibility mask, not a
    # gameplay surface, and re-hexifying existing saved fog would be
    # destructive.
    grid_type: Mapped[str] = mapped_column(String(10), default="square")
    fog_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    revealed_cells: Mapped[str] = mapped_column(Text, default="[]")  # JSON: [[col,row],...]
    image_width: Mapped[int] = mapped_column(Integer, default=0)
    image_height: Mapped[int] = mapped_column(Integer, default=0)
    remember_explored: Mapped[bool] = mapped_column(Boolean, default=True)


class MapMarker(Base):
    __tablename__ = "map_markers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    map_id: Mapped[int] = mapped_column(ForeignKey("map_data.id", ondelete="CASCADE"))
    marker_type: Mapped[str] = mapped_column(Text, default="pin")  # pin, danger, secret, location, custom
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    label: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(Text, default="📌")
    color: Mapped[str] = mapped_column(Text, default="#ff0000")
    visible_to_players: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)
    # Map Builder: which floor this marker belongs to
    floor_id: Mapped[int | None] = mapped_column(ForeignKey("map_floors.id", ondelete="CASCADE"), nullable=True)


class MapDrawing(Base):
    __tablename__ = "map_drawings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    map_id: Mapped[int] = mapped_column(ForeignKey("map_data.id", ondelete="CASCADE"))
    drawing_type: Mapped[str] = mapped_column(Text, default="freehand")  # freehand, rectangle, circle, triangle, line, arrow
    points: Mapped[str] = mapped_column(Text, default="[]")  # JSON
    color: Mapped[str] = mapped_column(Text, default="#ff0000")
    line_width: Mapped[int] = mapped_column(Integer, default=2)
    fill_opacity: Mapped[float] = mapped_column(Float, default=0.2)
    visible_to_players: Mapped[bool] = mapped_column(Boolean, default=True)
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Map Builder: which floor this drawing belongs to
    floor_id: Mapped[int | None] = mapped_column(ForeignKey("map_floors.id", ondelete="CASCADE"), nullable=True)


# Rework v3 Phase 5: rectangular obstacles placed by the GM. They
# block player movement on the battle grid and are rendered as
# translucent coloured zones for everybody. Coordinates are stored
# normalised (0..1) so the same object stays correct across different
# map images / screen sizes — matches the convention used by tokens,
# drawings and markers elsewhere in the project.
class MapObject(Base):
    __tablename__ = "map_objects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, default="Wall")
    kind: Mapped[str] = mapped_column(String(20), default="wall")  # wall, water, difficult, zone
    # Axis-aligned rectangle (normalised). (x1,y1) is top-left,
    # (x2,y2) is bottom-right, both in [0, 1].
    x1: Mapped[float] = mapped_column(Float, default=0.0)
    y1: Mapped[float] = mapped_column(Float, default=0.0)
    x2: Mapped[float] = mapped_column(Float, default=0.0)
    y2: Mapped[float] = mapped_column(Float, default=0.0)
    color: Mapped[str] = mapped_column(Text, default="#8a4abf")
    blocks_movement: Mapped[bool] = mapped_column(Boolean, default=True)
    blocks_vision: Mapped[bool] = mapped_column(Boolean, default=False)
    visible_to_players: Mapped[bool] = mapped_column(Boolean, default=True)
    # Map Builder: door open/close state
    is_open: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Map Builder: which floor this object belongs to
    floor_id: Mapped[int | None] = mapped_column(ForeignKey("map_floors.id", ondelete="CASCADE"), nullable=True)


# ══════════════════════════════════════════════════════════════
# MAP ARCHITECTURE — Maps (containers) → Floors → Tiles
# ══════════════════════════════════════════════════════════════
class MapTemplate(Base):
    __tablename__ = "map_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    # Is this the currently active map for the session?
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)


class MapFloor(Base):
    __tablename__ = "map_floors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    map_id: Mapped[int | None] = mapped_column(ForeignKey("map_templates.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(Text, default="Floor 1")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Tile grid size (matches MapData.grid_size at creation time)
    tile_size: Mapped[int] = mapped_column(Integer, default=50)
    # Grid type: square or hex
    grid_type: Mapped[str] = mapped_column(String(10), default="square")
    # JSON: {"col,row": "wall", "col,row": "floor", ...}
    tiles_json: Mapped[str] = mapped_column(Text, default="{}")
    # Is this the currently active floor for the session?
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    # Optional background tint when no image is loaded
    background_color: Mapped[str] = mapped_column(Text, default="#2a2a2a")
    # Map boundary in tile cells (GM-defined play area)
    map_cols: Mapped[int] = mapped_column(Integer, default=40)
    map_rows: Mapped[int] = mapped_column(Integer, default=30)
    # Rework: background image for the floor (uploaded via builder)
    image_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)


# ══════════════════════════════════════════════════════════════
# MAP LIBRARY — Saved map templates
# ══════════════════════════════════════════════════════════════
class MapLibrary(Base):
    __tablename__ = "map_library"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    # JSON snapshot of the map: tiles, grid_type, tile_size, map_cols, map_rows, etc.
    map_data_json: Mapped[str] = mapped_column(Text, default="{}")
    # Preview image (screenshot or uploaded background)
    image_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ══════════════════════════════════════════════════════════════
# MAP BUILDER — Traps
# ══════════════════════════════════════════════════════════════
class MapTrap(Base):
    __tablename__ = "map_traps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    floor_id: Mapped[int | None] = mapped_column(ForeignKey("map_floors.id", ondelete="CASCADE"), nullable=True)
    col: Mapped[int] = mapped_column(Integer, default=0)
    row: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(Text, default="Trap")
    description: Mapped[str] = mapped_column(Text, default="")
    trap_type: Mapped[str] = mapped_column(String(20), default="mechanical")
    trigger_type: Mapped[str] = mapped_column(String(20), default="pressure")
    dc_detect: Mapped[int] = mapped_column(Integer, default=10)
    dc_disarm: Mapped[int] = mapped_column(Integer, default=10)
    damage_dice: Mapped[str] = mapped_column(Text, default="")
    damage_type: Mapped[str] = mapped_column(String(20), default="piercing")
    status_effect_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=True)
    is_triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    is_disarmed: Mapped[bool] = mapped_column(Boolean, default=False)
    discovered_by_json: Mapped[str] = mapped_column(Text, default="[]")


# ══════════════════════════════════════════════════════════════
# MAP CHESTS — placed on tiles in builder
# ══════════════════════════════════════════════════════════════
class MapChest(Base):
    __tablename__ = "map_chests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    floor_id: Mapped[int | None] = mapped_column(ForeignKey("map_floors.id", ondelete="CASCADE"), nullable=True)
    col: Mapped[int] = mapped_column(Integer, default=0)
    row: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(Text, default="Chest")
    # JSON: [{"item_id": 1, "quantity": 2}, ...]
    items_json: Mapped[str] = mapped_column(Text, default="[]")
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    visible_to_players: Mapped[bool] = mapped_column(Boolean, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    lock_dc: Mapped[int] = mapped_column(Integer, default=10)


# ══════════════════════════════════════════════════════════════
# MAP PORTALS — transitions between maps/floors
# ══════════════════════════════════════════════════════════════
class MapPortal(Base):
    __tablename__ = "map_portals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    floor_id: Mapped[int | None] = mapped_column(ForeignKey("map_floors.id", ondelete="CASCADE"), nullable=True)
    col: Mapped[int] = mapped_column(Integer, default=0)
    row: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(Text, default="Portal")
    target_map_id: Mapped[int | None] = mapped_column(ForeignKey("map_templates.id", ondelete="SET NULL"), nullable=True)
    target_floor_id: Mapped[int | None] = mapped_column(ForeignKey("map_floors.id", ondelete="SET NULL"), nullable=True)
    target_col: Mapped[int] = mapped_column(Integer, default=0)
    target_row: Mapped[int] = mapped_column(Integer, default=0)


# ══════════════════════════════════════════════════════════════
# ITEM CATEGORIES
# ══════════════════════════════════════════════════════════════
class ItemCategory(Base):
    __tablename__ = "item_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    icon: Mapped[str] = mapped_column(Text, default="📦")
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)

    items: Mapped[list["Item"]] = relationship(back_populates="category_rel", lazy="selectin")


# ══════════════════════════════════════════════════════════════
# ITEMS & INVENTORY
# ══════════════════════════════════════════════════════════════
class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(20), default="misc")  # legacy — kept for compat
    category_id: Mapped[int | None] = mapped_column(ForeignKey("item_categories.id", ondelete="SET NULL"), nullable=True)
    rarity: Mapped[str] = mapped_column(String(20), default="common")  # common/uncommon/rare/epic/legendary/mythic/divine
    base_price: Mapped[int] = mapped_column(Integer, default=0)  # legacy gold price
    base_price_bronze: Mapped[int] = mapped_column(Integer, default=0)
    # Rework v2: item weight is removed — items only occupy inventory slots.
    effect_type: Mapped[str | None] = mapped_column(String(30), nullable=True)  # legacy single effect
    effect_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    equippable: Mapped[bool] = mapped_column(Boolean, default=False)
    consumable: Mapped[bool] = mapped_column(Boolean, default=False)
    mana_cost: Mapped[int] = mapped_column(Integer, default=0)
    use_effect: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: {"effects": [...]}
    tags: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of strings
    created_by_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    # FIX 6: Potion identity (v2 spec)
    is_potion: Mapped[bool] = mapped_column(Boolean, default=False)
    potion_icon: Mapped[str] = mapped_column(String(8), default="🧪")

    category_rel: Mapped["ItemCategory | None"] = relationship(back_populates="items", lazy="selectin")
    bonuses: Mapped[list["ItemBonus"]] = relationship(back_populates="item", cascade="all, delete-orphan", lazy="selectin")
    weapon_stats: Mapped["ItemWeaponStats | None"] = relationship(back_populates="item", uselist=False, cascade="all, delete-orphan", lazy="selectin")


class ItemBonus(Base):
    __tablename__ = "item_bonuses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"))
    bonus_type: Mapped[str] = mapped_column(String(40), nullable=False)  # percent_damage_reduction, flat_damage_reduction, stat_bonus, attack_bonus, damage_bonus, damage_dice_count, damage_dice_type, hp_bonus, initiative_bonus, speed_bonus, custom
    stat_name: Mapped[str | None] = mapped_column(String(20), nullable=True)  # for stat_bonus
    value: Mapped[float] = mapped_column(Float, default=0)
    is_conditional: Mapped[bool] = mapped_column(Boolean, default=False)
    condition_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    item: Mapped["Item"] = relationship(back_populates="bonuses")


class ItemWeaponStats(Base):
    __tablename__ = "item_weapon_stats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), unique=True)
    dice_count: Mapped[int] = mapped_column(Integer, default=1)
    dice_type: Mapped[int] = mapped_column(Integer, default=6)
    damage_type: Mapped[str] = mapped_column(String(20), default="physical")
    range: Mapped[str | None] = mapped_column(Text, nullable=True)
    weapon_range: Mapped[str] = mapped_column(String(10), default="melee")  # melee / ranged
    # Rework v3 Phase 7: range in battle-grid cells (Chebyshev metric).
    # Enforced server-side when both attacker and target have map
    # positions. `None` or 0 = "no limit" (e.g. siege weapons); 1 =
    # melee adjacent (includes the attacker's own cell); ≥2 = ranged.
    range_cells: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)
    weapon_properties: Mapped[str] = mapped_column(Text, default="[]")  # JSON: ["finesse","two-handed","light",...]
    # Rework: which character stat contributes the +bonus to hit / damage (strength, dexterity, ...)
    hit_stat: Mapped[str] = mapped_column(String(20), default="strength")
    damage_stat: Mapped[str | None] = mapped_column(String(20), nullable=True, default="strength")
    # Rework v3: optional pre-baked damage modes (e.g. one-handed 1d8 /
    # two-handed 1d10). If non-empty, the player picks a mode at damage time
    # instead of being allowed free-form dice. Empty list = single-mode (use
    # the flat dice_count/dice_type above).
    # JSON: [{"name": str, "dice_count": int, "dice_type": int,
    #         "damage_type": str, "damage_stat": str | null}, ...]
    damage_modes: Mapped[str] = mapped_column(Text, default="[]")

    item: Mapped["Item"] = relationship(back_populates="weapon_stats")


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    is_equipped: Mapped[bool] = mapped_column(Boolean, default=False)
    equipped_slot: Mapped[str | None] = mapped_column(String(20), nullable=True)  # main_hand, off_hand, armor, head, ring_1, ring_2, amulet, boots, gloves, belt
    custom_notes: Mapped[str] = mapped_column(Text, default="")
    acquired_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    character: Mapped["Character"] = relationship(back_populates="inventory_items")
    item: Mapped["Item"] = relationship(lazy="selectin")


class ShopItem(Base):
    __tablename__ = "shop_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"))
    price_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stock: Mapped[int] = mapped_column(Integer, default=-1)  # -1 = unlimited


# ══════════════════════════════════════════════════════════════
# STAGE 3 — ECONOMY & TRADING
# ══════════════════════════════════════════════════════════════
class CurrencyTransaction(Base):
    __tablename__ = "currency_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    from_character_id: Mapped[int | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)  # NULL = GM grant
    to_character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    amount_bronze: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class NpcReputation(Base):
    __tablename__ = "npc_reputation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    npc_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    reputation_value: Mapped[int] = mapped_column(Integer, default=0)  # -100 to 100

    __table_args__ = (
        UniqueConstraint("npc_id", "character_id", name="uq_npc_character_reputation"),
    )


class NpcShopInventory(Base):
    __tablename__ = "npc_shop_inventory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    npc_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"))
    stock: Mapped[int | None] = mapped_column(Integer, nullable=True)  # NULL = unlimited
    price_override_bronze: Mapped[int | None] = mapped_column(Integer, nullable=True)  # NULL = use item base_price
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)

    item: Mapped["Item"] = relationship(lazy="selectin")


class TradeSession(Base):
    __tablename__ = "trade_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    npc_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    player_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(20), default="open")  # open, closed
    started_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ══════════════════════════════════════════════════════════════
# STAGE 4 — STATUS EFFECTS
# ══════════════════════════════════════════════════════════════
class StatusEffectTemplate(Base):
    __tablename__ = "status_effect_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(10), default="⚡")
    color: Mapped[str] = mapped_column(String(10), default="#ff6b6b")
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    effects: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of effect objects
    default_duration: Mapped[int | None] = mapped_column(Integer, nullable=True)  # turns, NULL=permanent


class CharacterStatusEffect(Base):
    __tablename__ = "character_status_effects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    template_id: Mapped[int | None] = mapped_column(ForeignKey("status_effect_templates.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    icon: Mapped[str] = mapped_column(String(10), default="⚡")
    color: Mapped[str] = mapped_column(String(10), default="#ff6b6b")
    effects: Mapped[str] = mapped_column(Text, default="[]")  # JSON
    remaining_turns: Mapped[int | None] = mapped_column(Integer, nullable=True)  # NULL=permanent
    applied_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    applied_by_id: Mapped[int | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)

    template: Mapped["StatusEffectTemplate | None"] = relationship(lazy="selectin")


class EquipmentTemplate(Base):
    __tablename__ = "equipment_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    item_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of item IDs
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ══════════════════════════════════════════════════════════════
# STAGE 5 — COMBAT EVENTS
# ══════════════════════════════════════════════════════════════
class CombatEvent(Base):
    __tablename__ = "combat_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, default="Combat")
    status: Mapped[str] = mapped_column(String(20), default="preparing")  # preparing, active, ended
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    round_number: Mapped[int] = mapped_column(Integer, default=0)
    current_participant_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # combat_participants.id

    participants: Mapped[list["CombatParticipant"]] = relationship(
        back_populates="combat_event", cascade="all, delete-orphan", lazy="selectin",
        order_by="CombatParticipant.turn_order"
    )


class CombatParticipant(Base):
    __tablename__ = "combat_participants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    combat_event_id: Mapped[int] = mapped_column(ForeignKey("combat_events.id", ondelete="CASCADE"))
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    initiative_roll: Mapped[int | None] = mapped_column(Integer, nullable=True)
    initiative_bonus: Mapped[int] = mapped_column(Integer, default=0)
    final_initiative: Mapped[int | None] = mapped_column(Integer, nullable=True)
    turn_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    show_hp_to_players: Mapped[bool] = mapped_column(Boolean, default=False)
    show_ac_to_players: Mapped[bool] = mapped_column(Boolean, default=False)

    combat_event: Mapped["CombatEvent"] = relationship(back_populates="participants")
    character: Mapped["Character"] = relationship(lazy="selectin")


# ══════════════════════════════════════════════════════════════
# STAGE 11 — COMBAT ACTIONS
# ══════════════════════════════════════════════════════════════
class CombatAction(Base):
    __tablename__ = "combat_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    combat_event_id: Mapped[int] = mapped_column(ForeignKey("combat_events.id", ondelete="CASCADE"))
    round_number: Mapped[int] = mapped_column(Integer, default=0)
    attacker_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    target_id: Mapped[int | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)
    action_type: Mapped[str] = mapped_column(String(20), default="attack")  # attack, defend, spell, item, other
    weapon_id: Mapped[int | None] = mapped_column(ForeignKey("items.id", ondelete="SET NULL"), nullable=True)
    attack_roll: Mapped[str] = mapped_column(Text, default="{}")  # JSON: {d20, modifiers, total, hit, critical, fumble}
    damage_roll: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: {base, modifiers, total, reduction, final}
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    attacker: Mapped["Character"] = relationship(foreign_keys=[attacker_id], lazy="selectin")
    target: Mapped["Character | None"] = relationship(foreign_keys=[target_id], lazy="selectin")


# ══════════════════════════════════════════════════════════════
# STAGE 6 — RACES & CLASSES
# ══════════════════════════════════════════════════════════════
class Race(Base):
    __tablename__ = "races"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    bonuses: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of bonus objects
    special_abilities: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of strings
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    # Rework v2: race defines the HP die rolled at creation + every level-up.
    hp_die: Mapped[int] = mapped_column(Integer, default=8)           # d4/d6/d8/d10/d12
    hp_dice_count: Mapped[int] = mapped_column(Integer, default=1)    # usually 1
    # Spiritual HP: separate pool for spirit-based damage/healing
    spiritual_hp_die: Mapped[int] = mapped_column(Integer, default=4)
    spiritual_hp_dice_count: Mapped[int] = mapped_column(Integer, default=1)

    rank_configs: Mapped[list["RaceRankConfig"]] = relationship(
        back_populates="race", cascade="all, delete-orphan", lazy="selectin"
    )


class RaceRankConfig(Base):
    __tablename__ = "race_rank_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id", ondelete="CASCADE"), nullable=False)
    rank: Mapped[str] = mapped_column(String(20), nullable=False)  # common, uncommon, rare, epic, legendary, mythic, divine
    rank_plus: Mapped[int] = mapped_column(Integer, default=0)  # reserved for future sub-tiers
    physical_hp_die: Mapped[int] = mapped_column(Integer, default=4)  # d4/d6/d8/d10/d12
    physical_hp_dice_count: Mapped[int] = mapped_column(Integer, default=1)
    spiritual_hp_die: Mapped[int] = mapped_column(Integer, default=4)
    spiritual_hp_dice_count: Mapped[int] = mapped_column(Integer, default=1)
    mana_per_level: Mapped[int] = mapped_column(Integer, default=2)
    notes: Mapped[str] = mapped_column(Text, default="")  # Special properties, e.g., "+1d6 regen at B+"

    race: Mapped["Race"] = relationship(back_populates="rank_configs")


class CharacterClass(Base):
    __tablename__ = "classes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    bonuses: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of bonus objects
    special_abilities: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of strings
    # Rework v3: `hit_die` retired — never consumed anywhere (races carry the
    # HP die via `Race.hp_die`). Column dropped by migration r4a0b1c2d3e4.
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)


# ══════════════════════════════════════════════════════════════
# STAGE 7 — NPC LIBRARY & EVENT TEMPLATES
# ══════════════════════════════════════════════════════════════
class NpcFolder(Base):
    __tablename__ = "npc_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str] = mapped_column(Text, default="#888888")
    parent_folder_id: Mapped[int | None] = mapped_column(ForeignKey("npc_folders.id", ondelete="SET NULL"), nullable=True)

    children: Mapped[list["NpcFolder"]] = relationship(
        "NpcFolder", back_populates="parent",
        cascade="all, delete-orphan", lazy="noload",
    )
    parent: Mapped["NpcFolder | None"] = relationship(
        "NpcFolder", back_populates="children", remote_side="NpcFolder.id", lazy="noload",
    )
    templates: Mapped[list["NpcTemplate"]] = relationship(
        back_populates="folder", lazy="noload",
    )


class NpcTemplate(Base):
    __tablename__ = "npc_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    folder_id: Mapped[int | None] = mapped_column(ForeignKey("npc_folders.id", ondelete="SET NULL"), nullable=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    is_merchant: Mapped[bool] = mapped_column(Boolean, default=False)
    max_hp: Mapped[int] = mapped_column(Integer, default=20)
    spiritual_max_hp: Mapped[int] = mapped_column(Integer, default=10)
    mana_max: Mapped[int] = mapped_column(Integer, default=0)
    armor_class: Mapped[int] = mapped_column(Integer, default=10)
    # NPC template defaults stay at 2 — NPCs are not bound by the
    # level-0 player baseline and the GM tunes them freely.
    strength: Mapped[int] = mapped_column(Integer, default=2)
    dexterity: Mapped[int] = mapped_column(Integer, default=2)
    constitution: Mapped[int] = mapped_column(Integer, default=2)
    intelligence: Mapped[int] = mapped_column(Integer, default=2)
    wisdom: Mapped[int] = mapped_column(Integer, default=2)
    charisma: Mapped[int] = mapped_column(Integer, default=2)
    initiative_bonus: Mapped[int] = mapped_column(Integer, default=0)
    token_color: Mapped[str] = mapped_column(Text, default="#e05252")
    default_equipment: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of item IDs
    shop_items: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of {item_id, stock, price_override}
    notes: Mapped[str] = mapped_column(Text, default="")

    folder: Mapped["NpcFolder | None"] = relationship(back_populates="templates")


class EventTemplate(Base):
    __tablename__ = "event_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    npc_template_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON: [{template_id, count}]
    folder_id: Mapped[int | None] = mapped_column(ForeignKey("npc_folders.id", ondelete="SET NULL"), nullable=True)


# ══════════════════════════════════════════════════════════════
# STAGE 8 — QUEST SYSTEM
# ══════════════════════════════════════════════════════════════
class QuestTemplate(Base):
    __tablename__ = "quest_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    source_npc_id: Mapped[int | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)
    reward_gold_bronze: Mapped[int] = mapped_column(Integer, default=0)
    reward_item_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of item IDs
    reward_description: Mapped[str] = mapped_column(Text, default="")
    reward_is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    # Fix 3: structured rewards (XP + currency + items)
    structured_rewards: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: {"xp": 500, "currency": {...}, "items": [...]}
    stages: Mapped[str] = mapped_column(Text, default="[]")  # JSON: [{order, title, description}]
    is_multi_stage: Mapped[bool] = mapped_column(Boolean, default=True)


class CharacterQuest(Base):
    __tablename__ = "character_quests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    quest_template_id: Mapped[int | None] = mapped_column(ForeignKey("quest_templates.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    source_npc_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, default="active")  # active, completed, failed
    current_stage: Mapped[int] = mapped_column(Integer, default=0)
    stages_completed: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of completed stage indices
    reward_gold_bronze: Mapped[int] = mapped_column(Integer, default=0)
    reward_item_ids: Mapped[str] = mapped_column(Text, default="[]")
    reward_description: Mapped[str] = mapped_column(Text, default="")
    reward_is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    reward_revealed: Mapped[bool] = mapped_column(Boolean, default=False)
    # Fix 3: structured rewards snapshot at assignment time
    structured_rewards: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ══════════════════════════════════════════════════════════════
# AI CONVERSATION
# ══════════════════════════════════════════════════════════════
class AIConversation(Base):
    __tablename__ = "ai_conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user / assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ══════════════════════════════════════════════════════════════
# SESSION ANNOUNCEMENTS (Stage 10)
# ══════════════════════════════════════════════════════════════
class SessionAnnouncement(Base):
    __tablename__ = "session_announcements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    author_id: Mapped[int | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    posted_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ══════════════════════════════════════════════════════════════
# CHARACTER NOTES (Stage 10)
# ══════════════════════════════════════════════════════════════
class CharacterNote(Base):
    __tablename__ = "character_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")
    is_gm_note: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ══════════════════════════════════════════════════════════════
# PHASE 6 — ABILITIES
# ══════════════════════════════════════════════════════════════
class Ability(Base):
    __tablename__ = "abilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)

    # Identity
    icon: Mapped[str] = mapped_column(Text, default="⚡")
    color: Mapped[str] = mapped_column(Text, default="#60a5fa")
    flavor_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # GM-only
    tags: Mapped[str] = mapped_column(Text, default="[]")  # JSON array

    # Type & Targeting
    ability_type: Mapped[str] = mapped_column(String(20), default="active")  # active / passive / reaction
    target_type: Mapped[str] = mapped_column(String(20), default="single")  # self / single / aoe / none
    aoe_radius: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Damage typing
    damage_type: Mapped[str] = mapped_column(String(20), default="physical")
    custom_damage_type: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Costs & Cooldown
    mana_cost: Mapped[int] = mapped_column(Integer, default=0)
    hp_cost: Mapped[int] = mapped_column(Integer, default=0)
    cooldown_turns: Mapped[int] = mapped_column(Integer, default=0)

    # Hit roll
    requires_hit_roll: Mapped[bool] = mapped_column(Boolean, default=False)
    hit_stat: Mapped[str] = mapped_column(String(20), default="strength")
    damage_stat: Mapped[str] = mapped_column(String(20), default="strength")

    # Damage dice
    damage_dice_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    damage_dice_type: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Passive
    is_passive: Mapped[bool] = mapped_column(Boolean, default=False)
    passive_effect: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON bonus

    # Effects chain
    effect: Mapped[str] = mapped_column(Text, default="{}")  # JSON — same schema as use_effect
    range: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Rework v3 Phase 7: range in battle-grid cells (Chebyshev metric).
    # Enforced server-side when attacker & target both have map
    # positions. `None` = unlimited (ritual / self-cast). `0` is
    # treated the same as `None`. 1 = melee / touch.
    range_cells: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1)

    # ── Rework v2 — unified "особенность или умение" pool ─────────
    # Rarity bucket used by the creation-wizard feature roll.
    rarity: Mapped[str] = mapped_column(String(20), default="common")
    # If true, this entry is eligible for the Step-5 random draw.
    is_in_starting_pool: Mapped[bool] = mapped_column(Boolean, default=False)
    # null = infinite uses. Otherwise, the total count across the whole game.
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # A flavor-only feature with no mechanics — GM runs it narratively.
    is_conditional: Mapped[bool] = mapped_column(Boolean, default=False)
    conditional_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    level_configs: Mapped[list["AbilityLevelConfig"]] = relationship(
        back_populates="ability", cascade="all, delete-orphan", lazy="selectin"
    )
    rank_configs: Mapped[list["AbilityRankConfig"]] = relationship(
        back_populates="ability", cascade="all, delete-orphan", lazy="selectin"
    )


# ── Typed config fields shared by level & rank configs ──
# Every field is nullable so the resolver can distinguish "not set"
# (inherit from previous tier / base ability) from "explicitly set".
_AB_CONFIG_FIELDS = [
    ("ability_type", String(20)),
    ("target_type", String(20)),
    ("aoe_radius", Integer),
    ("damage_type", String(20)),
    ("custom_damage_type", Text),
    ("mana_cost", Integer),
    ("hp_cost", Integer),
    ("cooldown_turns", Integer),
    ("requires_hit_roll", Boolean),
    ("hit_stat", String(20)),
    ("damage_stat", String(20)),
    ("damage_dice_count", Integer),
    ("damage_dice_type", Integer),
    ("is_passive", Boolean),
    ("passive_effect", Text),   # JSON
    ("effect", Text),           # JSON
    ("range_cells", Integer),
    ("max_uses", Integer),
    ("is_conditional", Boolean),
    ("conditional_text", Text),
]


class AbilityLevelConfig(Base):
    __tablename__ = "ability_level_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ability_id: Mapped[int] = mapped_column(ForeignKey("abilities.id", ondelete="CASCADE"), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    # Typed fields (all nullable → inherit)
    ability_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    aoe_radius: Mapped[int | None] = mapped_column(Integer, nullable=True)
    damage_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    custom_damage_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    mana_cost: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hp_cost: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cooldown_turns: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_hit_roll: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    hit_stat: Mapped[str | None] = mapped_column(String(20), nullable=True)
    damage_stat: Mapped[str | None] = mapped_column(String(20), nullable=True)
    damage_dice_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    damage_dice_type: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_passive: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    passive_effect: Mapped[str | None] = mapped_column(Text, nullable=True)
    effect: Mapped[str | None] = mapped_column(Text, nullable=True)
    range_cells: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_conditional: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    conditional_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")

    ability: Mapped["Ability"] = relationship(back_populates="level_configs")

    __table_args__ = (
        UniqueConstraint("ability_id", "level", name="uq_ability_level"),
    )


class AbilityRankConfig(Base):
    __tablename__ = "ability_rank_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ability_id: Mapped[int] = mapped_column(ForeignKey("abilities.id", ondelete="CASCADE"), nullable=False)
    rank: Mapped[str] = mapped_column(String(20), nullable=False)
    # Same typed fields as level config
    ability_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    aoe_radius: Mapped[int | None] = mapped_column(Integer, nullable=True)
    damage_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    custom_damage_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    mana_cost: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hp_cost: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cooldown_turns: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_hit_roll: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    hit_stat: Mapped[str | None] = mapped_column(String(20), nullable=True)
    damage_stat: Mapped[str | None] = mapped_column(String(20), nullable=True)
    damage_dice_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    damage_dice_type: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_passive: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    passive_effect: Mapped[str | None] = mapped_column(Text, nullable=True)
    effect: Mapped[str | None] = mapped_column(Text, nullable=True)
    range_cells: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_conditional: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    conditional_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")

    ability: Mapped["Ability"] = relationship(back_populates="rank_configs")

    __table_args__ = (
        UniqueConstraint("ability_id", "rank", name="uq_ability_rank"),
    )


class CharacterAbility(Base):
    __tablename__ = "character_abilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    ability_id: Mapped[int] = mapped_column(ForeignKey("abilities.id", ondelete="CASCADE"), nullable=False)
    is_unlocked: Mapped[bool] = mapped_column(Boolean, default=True)
    cooldown_remaining: Mapped[int] = mapped_column(Integer, default=0)
    # Rework v2: mirrors Ability.max_uses at grant time. null = infinite.
    current_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Rework v2: provenance — tells UI whether this came from the wizard.
    granted_from: Mapped[str] = mapped_column(String(20), default="gm")  # gm / wizard / level_up
    # Rank/Level system: ability level tracks upgrades from level-up choices.
    ability_level: Mapped[int] = mapped_column(Integer, default=0)
    ability_rank: Mapped[str] = mapped_column(String(20), default="common")

    ability: Mapped["Ability"] = relationship(lazy="selectin")


# ══════════════════════════════════════════════════════════════
# PHASE 6 — CHARACTER MEMORY / JOURNAL
# ══════════════════════════════════════════════════════════════
class CharacterMemory(Base):
    __tablename__ = "character_memory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    entry_type: Mapped[str] = mapped_column(String(30), default="note")  # npc_encounter, event, note
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    related_npc_id: Mapped[int | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ══════════════════════════════════════════════════════════════
# REWORK — MULTI-PROFESSION (M:N Character ↔ CharacterClass)
# ══════════════════════════════════════════════════════════════
class CharacterProfession(Base):
    __tablename__ = "character_professions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    level: Mapped[int] = mapped_column(Integer, default=1)  # 1..5 per profession
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    acquired_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    character: Mapped["Character"] = relationship(back_populates="professions")
    character_class: Mapped["CharacterClass"] = relationship(lazy="selectin")

    __table_args__ = (
        UniqueConstraint("character_id", "class_id", name="uq_character_profession"),
    )


# ══════════════════════════════════════════════════════════════
# REWORK — POISONS & DoT
# ══════════════════════════════════════════════════════════════
class PoisonTemplate(Base):
    __tablename__ = "poison_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(10), default="☠️")
    color: Mapped[str] = mapped_column(String(10), default="#7fbf54")
    # DoT mechanics
    damage_dice_count: Mapped[int] = mapped_column(Integer, default=1)
    damage_dice_type: Mapped[int] = mapped_column(Integer, default=4)
    damage_type: Mapped[str] = mapped_column(String(20), default="poison")  # poison / fire / bleed / acid / ...
    # Default per-weapon values
    default_charges: Mapped[int] = mapped_column(Integer, default=3)  # how many hits the coat lasts
    default_turns_per_hit: Mapped[int] = mapped_column(Integer, default=3)  # DoT duration applied per hit
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class InventoryItemPoison(Base):
    __tablename__ = "inventory_item_poisons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inventory_item_id: Mapped[int] = mapped_column(ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False)
    poison_template_id: Mapped[int] = mapped_column(ForeignKey("poison_templates.id", ondelete="CASCADE"), nullable=False)
    charges_remaining: Mapped[int] = mapped_column(Integer, default=3)  # decremented on successful hit while equipped
    turns_per_hit: Mapped[int] = mapped_column(Integer, default=3)  # overridden to 1 for arrows
    applied_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    poison_template: Mapped["PoisonTemplate"] = relationship(lazy="selectin")

    __table_args__ = (
        # one active coat per inventory item at a time
        UniqueConstraint("inventory_item_id", name="uq_inventory_item_poison"),
    )


# ══════════════════════════════════════════════════════════════
# REWORK — CHARACTER CREATION WIZARD
# ══════════════════════════════════════════════════════════════
class CharacterWizardState(Base):
    __tablename__ = "character_wizard_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, unique=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    current_step: Mapped[int] = mapped_column(Integer, default=1)  # 1..4
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    data: Mapped[str] = mapped_column(Text, default="{}")  # JSON: step-by-step inputs
    gm_approved: Mapped[bool] = mapped_column(Boolean, default=False)  # final step approval
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ══════════════════════════════════════════════════════════════
# FIX 2 — CARD LIBRARY & CHESTS
# ══════════════════════════════════════════════════════════════
class CardLibrary(Base):
    __tablename__ = "card_library"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    card_type: Mapped[str] = mapped_column(String(20), default="character")  # character / location / item / custom
    card_data: Mapped[str] = mapped_column(Text, default="{}")  # JSON extra fields
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class Chest(Base):
    __tablename__ = "chests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, default="Chest")
    description: Mapped[str] = mapped_column(Text, default="")
    is_revealed: Mapped[bool] = mapped_column(Boolean, default=False)
    map_x: Mapped[float] = mapped_column(Float, default=0.0)
    map_y: Mapped[float] = mapped_column(Float, default=0.0)
    icon: Mapped[str] = mapped_column(Text, default="chest")

    items: Mapped[list["ChestItem"]] = relationship(
        back_populates="chest", cascade="all, delete-orphan", lazy="selectin"
    )


class ChestItem(Base):
    __tablename__ = "chest_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chest_id: Mapped[int] = mapped_column(ForeignKey("chests.id", ondelete="CASCADE"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    chest: Mapped["Chest"] = relationship(back_populates="items")
    item: Mapped["Item"] = relationship(lazy="selectin")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ══════════════════════════════════════════════════════════════
# MAP BUILDER V2 — full rewrite (parallel to legacy MapTemplate/MapFloor/...)
# All tables prefixed `bv2_`. Reversible via alembic, no data migration
# from the old builder. Phase 1 uses Map/Location/Tile only; the rest
# of the tables are declared up-front so a single migration covers
# the whole feature surface.
# ══════════════════════════════════════════════════════════════
class BV2Map(Base):
    """Top-level container — a "story map" grouping related locations."""
    __tablename__ = "bv2_maps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="New Map")
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    cover_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class BV2Location(Base):
    """A single playable location (room / area / floor)."""
    __tablename__ = "bv2_locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("bv2_maps.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="New Location")
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    grid_type: Mapped[str] = mapped_column(String(10), default="square")  # square | hex
    tile_size: Mapped[int] = mapped_column(Integer, default=50)
    cols: Mapped[int] = mapped_column(Integer, default=40)
    rows: Mapped[int] = mapped_column(Integer, default=30)

    background_color: Mapped[str] = mapped_column(Text, default="#1a1a1a")
    background_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 0..1 — global ambient brightness (0=pitch dark, 1=full daylight)
    ambient_light: Mapped[float] = mapped_column(Float, default=1.0)
    is_indoor: Mapped[bool] = mapped_column(Boolean, default=False)

    # Active = the location currently shown to players.
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class BV2Tile(Base):
    """A single painted tile on a location grid.

    Unique on (location_id, col, row) — one tile per cell. Painting over
    a cell overwrites the tile_type (handled in the bulk PUT endpoint).
    """
    __tablename__ = "bv2_tiles"
    __table_args__ = (UniqueConstraint("location_id", "col", "row", name="uq_bv2_tile_cell"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("bv2_locations.id", ondelete="CASCADE"), nullable=False)
    col: Mapped[int] = mapped_column(Integer, nullable=False)
    row: Mapped[int] = mapped_column(Integer, nullable=False)
    # floor | wall | water | lava | pit | door | rough | decor_<variant>
    tile_type: Mapped[str] = mapped_column(String(32), default="floor")
    blocks_movement: Mapped[bool] = mapped_column(Boolean, default=False)
    blocks_vision: Mapped[bool] = mapped_column(Boolean, default=False)
    extra_json: Mapped[str] = mapped_column(Text, default="{}")


class BV2Entity(Base):
    """All interactive objects on a location: chest, trap, portal, light,
    npc_spawn, cover_zone, edge_marker. Type-specific properties go in
    `props_json` so we don't need a table per kind.
    """
    __tablename__ = "bv2_entities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("bv2_locations.id", ondelete="CASCADE"), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    col: Mapped[int] = mapped_column(Integer, default=0)
    row: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(Text, default="")
    props_json: Mapped[str] = mapped_column(Text, default="{}")
    visible_to_players: Mapped[bool] = mapped_column(Boolean, default=True)
    discovered_by_json: Mapped[str] = mapped_column(Text, default="[]")  # list of character_id
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class BV2Light(Base):
    """A light source — placed in the builder (static) or attached to a
    character (carried). Phase 1 declares the table; the lighting logic
    is implemented in Phase 4.
    """
    __tablename__ = "bv2_lights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("bv2_locations.id", ondelete="CASCADE"), nullable=True)
    character_id: Mapped[int | None] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), nullable=True)
    col: Mapped[int] = mapped_column(Integer, default=0)
    row: Mapped[int] = mapped_column(Integer, default=0)
    radius_cells: Mapped[float] = mapped_column(Float, default=6.0)
    color_hex: Mapped[str] = mapped_column(String(9), default="#ffd9a0")
    intensity: Mapped[float] = mapped_column(Float, default=1.0)
    source_kind: Mapped[str] = mapped_column(String(20), default="torch")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class BV2Edge(Base):
    """Edge-transition segment: a slice of one side of a location that
    teleports a character to another location when crossed. Phase 5.
    """
    __tablename__ = "bv2_edges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("bv2_locations.id", ondelete="CASCADE"), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # north | south | east | west
    range_start: Mapped[int] = mapped_column(Integer, default=0)
    range_end: Mapped[int] = mapped_column(Integer, default=9999)
    target_location_id: Mapped[int | None] = mapped_column(ForeignKey("bv2_locations.id", ondelete="SET NULL"), nullable=True)
    target_entry_col: Mapped[int] = mapped_column(Integer, default=0)
    target_entry_row: Mapped[int] = mapped_column(Integer, default=0)


class BV2VisitState(Base):
    """Per-character fog-of-war + discovered entities, per location."""
    __tablename__ = "bv2_visit_state"
    __table_args__ = (UniqueConstraint("character_id", "location_id", name="uq_bv2_visit_char_loc"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("bv2_locations.id", ondelete="CASCADE"), nullable=False)
    explored_tiles_json: Mapped[str] = mapped_column(Text, default="[]")  # list of [col, row]
    discovered_entity_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class BV2Library(Base):
    """Saved snapshot of a Map (all locations + entities) for re-use."""
    __tablename__ = "bv2_library"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    snapshot_json: Mapped[str] = mapped_column(Text, default="{}")
    preview_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
