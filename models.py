from datetime import datetime, timezone
from sqlalchemy import Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    armor_class: Mapped[int] = mapped_column(Integer, default=10)
    current_hp: Mapped[int] = mapped_column(Integer, default=20)
    max_hp: Mapped[int] = mapped_column(Integer, default=20)
    strength: Mapped[int] = mapped_column(Integer, default=10)
    dexterity: Mapped[int] = mapped_column(Integer, default=10)
    constitution: Mapped[int] = mapped_column(Integer, default=10)
    intelligence: Mapped[int] = mapped_column(Integer, default=10)
    wisdom: Mapped[int] = mapped_column(Integer, default=10)
    charisma: Mapped[int] = mapped_column(Integer, default=10)
    hp_dice_count: Mapped[int] = mapped_column(Integer, default=2)
    hp_dice_type: Mapped[int] = mapped_column(Integer, default=12)
    hp_recovery_modifier: Mapped[int] = mapped_column(Integer, default=0)
    turn_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    effects: Mapped[list["CharacterEffect"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    stat_modifiers: Mapped[list["StatModifier"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    attack_modifiers: Mapped[list["AttackModifier"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    damage_modifiers: Mapped[list["DamageModifier"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )
    turn_timers: Mapped[list["TurnTimer"]] = relationship(
        back_populates="character", cascade="all, delete-orphan", lazy="selectin"
    )


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
