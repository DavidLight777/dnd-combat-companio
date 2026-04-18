from datetime import datetime, timezone
from sqlalchemy import Integer, String, Float, Boolean, DateTime, ForeignKey, Text, UniqueConstraint
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Stage 10: Session timer
    play_timer_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_play_seconds: Mapped[int] = mapped_column(Integer, default=0)

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

    armor_class: Mapped[int] = mapped_column(Integer, default=10)
    current_hp: Mapped[int] = mapped_column(Integer, default=20)
    max_hp: Mapped[int] = mapped_column(Integer, default=20)
    strength: Mapped[int] = mapped_column(Integer, default=10)
    dexterity: Mapped[int] = mapped_column(Integer, default=10)
    constitution: Mapped[int] = mapped_column(Integer, default=10)
    intelligence: Mapped[int] = mapped_column(Integer, default=10)
    wisdom: Mapped[int] = mapped_column(Integer, default=10)
    charisma: Mapped[int] = mapped_column(Integer, default=10)

    initiative_bonus: Mapped[int] = mapped_column(Integer, default=0)
    initiative_roll: Mapped[int | None] = mapped_column(Integer, nullable=True)
    initiative_order: Mapped[int | None] = mapped_column(Integer, nullable=True)

    hp_dice_count: Mapped[int] = mapped_column(Integer, default=2)
    hp_dice_type: Mapped[int] = mapped_column(Integer, default=12)
    hp_recovery_modifier: Mapped[int] = mapped_column(Integer, default=0)

    attack_dice_count: Mapped[int] = mapped_column(Integer, default=1)
    attack_dice_type: Mapped[int] = mapped_column(Integer, default=8)

    map_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    map_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    token_color: Mapped[str] = mapped_column(Text, default="#c08a2a")
    is_visible_on_map: Mapped[bool] = mapped_column(Boolean, default=True)
    vision_radius: Mapped[int] = mapped_column(Integer, default=5)

    status_effects: Mapped[str] = mapped_column(Text, default="[]")  # JSON array
    notes: Mapped[str] = mapped_column(Text, default="")
    is_alive: Mapped[bool] = mapped_column(Boolean, default=True)
    gold: Mapped[int] = mapped_column(Integer, default=0)
    wealth_bronze: Mapped[int] = mapped_column(Integer, default=0)  # total wealth in bronze
    mana_current: Mapped[int] = mapped_column(Integer, default=0)
    mana_max: Mapped[int] = mapped_column(Integer, default=0)
    mana_regen_per_turn: Mapped[int] = mapped_column(Integer, default=0)
    can_edit_own_items: Mapped[bool] = mapped_column(Boolean, default=False)
    place_at_table: Mapped[bool] = mapped_column(Boolean, default=False)
    show_hp_to_players: Mapped[bool] = mapped_column(Boolean, default=False)
    gm_notes: Mapped[str] = mapped_column(Text, default="")

    race_id: Mapped[int | None] = mapped_column(ForeignKey("races.id", ondelete="SET NULL"), nullable=True)
    # class_id — DEPRECATED: kept for back-compat. Use character_professions table instead.
    class_id: Mapped[int | None] = mapped_column(ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    level: Mapped[int] = mapped_column(Integer, default=0)
    experience: Mapped[int] = mapped_column(Integer, default=0)
    # Rework: rank chain common → uncommon → rare → epic → legendary → mythic → divine
    rank: Mapped[str] = mapped_column(String(20), default="common")

    turn_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

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
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
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
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    grid_size: Mapped[int] = mapped_column(Integer, default=50)
    grid_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
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
    weight: Mapped[float] = mapped_column(Float, default=0.0)
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
    weapon_properties: Mapped[str] = mapped_column(Text, default="[]")  # JSON: ["finesse","two-handed","light",...]
    # Rework: which character stat contributes the +bonus to hit / damage (strength, dexterity, ...)
    hit_stat: Mapped[str] = mapped_column(String(20), default="strength")
    damage_stat: Mapped[str | None] = mapped_column(String(20), nullable=True, default="strength")

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
    acquired_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

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
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    started_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    applied_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    applied_by_id: Mapped[int | None] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)

    template: Mapped["StatusEffectTemplate | None"] = relationship(lazy="selectin")


class EquipmentTemplate(Base):
    __tablename__ = "equipment_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    item_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of item IDs
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

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


class CharacterClass(Base):
    __tablename__ = "classes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    session_id: Mapped[int | None] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True)
    bonuses: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of bonus objects
    special_abilities: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of strings
    hit_die: Mapped[int] = mapped_column(Integer, default=8)
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
    armor_class: Mapped[int] = mapped_column(Integer, default=10)
    strength: Mapped[int] = mapped_column(Integer, default=10)
    dexterity: Mapped[int] = mapped_column(Integer, default=10)
    constitution: Mapped[int] = mapped_column(Integer, default=10)
    intelligence: Mapped[int] = mapped_column(Integer, default=10)
    wisdom: Mapped[int] = mapped_column(Integer, default=10)
    charisma: Mapped[int] = mapped_column(Integer, default=10)
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
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    posted_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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


class CharacterAbility(Base):
    __tablename__ = "character_abilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    ability_id: Mapped[int] = mapped_column(ForeignKey("abilities.id", ondelete="CASCADE"), nullable=False)
    is_unlocked: Mapped[bool] = mapped_column(Boolean, default=True)
    cooldown_remaining: Mapped[int] = mapped_column(Integer, default=0)

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


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
    acquired_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class InventoryItemPoison(Base):
    __tablename__ = "inventory_item_poisons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inventory_item_id: Mapped[int] = mapped_column(ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False)
    poison_template_id: Mapped[int] = mapped_column(ForeignKey("poison_templates.id", ondelete="CASCADE"), nullable=False)
    charges_remaining: Mapped[int] = mapped_column(Integer, default=3)  # decremented on successful hit while equipped
    turns_per_hit: Mapped[int] = mapped_column(Integer, default=3)  # overridden to 1 for arrows
    applied_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
