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

    status_effects: Mapped[str] = mapped_column(Text, default="[]")  # JSON array
    notes: Mapped[str] = mapped_column(Text, default="")
    is_alive: Mapped[bool] = mapped_column(Boolean, default=True)
    gold: Mapped[int] = mapped_column(Integer, default=0)
    gold_copper: Mapped[int] = mapped_column(Integer, default=0)  # total wealth in copper
    can_edit_own_items: Mapped[bool] = mapped_column(Boolean, default=False)

    race_id: Mapped[int | None] = mapped_column(ForeignKey("races.id", ondelete="SET NULL"), nullable=True)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)
    level: Mapped[int] = mapped_column(Integer, default=1)
    experience: Mapped[int] = mapped_column(Integer, default=0)

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

    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual, race, class

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
    base_price_copper: Mapped[int] = mapped_column(Integer, default=0)
    weight: Mapped[float] = mapped_column(Float, default=0.0)
    effect_type: Mapped[str | None] = mapped_column(String(30), nullable=True)  # legacy single effect
    effect_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    equippable: Mapped[bool] = mapped_column(Boolean, default=False)
    consumable: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of strings
    created_by_ai: Mapped[bool] = mapped_column(Boolean, default=False)

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
    amount_copper: Mapped[int] = mapped_column(Integer, nullable=False)
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
    price_override_copper: Mapped[int | None] = mapped_column(Integer, nullable=True)  # NULL = use item base_price
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
# AI CONVERSATION
# ══════════════════════════════════════════════════════════════
class AIConversation(Base):
    __tablename__ = "ai_conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user / assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
