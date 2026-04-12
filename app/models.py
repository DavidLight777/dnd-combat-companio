from datetime import datetime, timezone
from sqlalchemy import Integer, String, Float, Boolean, DateTime, ForeignKey, Text
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
