"""rework1_data_model

Rework Phase 1: data-model additions.
- `characters.rank` (String) default 'common'
- `characters.level` new rows default 0 (server_default only; existing rows untouched)
- Adds `hit_stat` / `damage_stat` to `item_weapon_stats`
- New table `character_professions` (M:N Character <-> CharacterClass with per-profession level)
- New tables `poison_templates`, `inventory_item_poisons`
- New table `character_wizard_state`

Revision ID: r1a2b3c4d5e6
Revises: a9f1b2c3d4e5
Create Date: 2026-04-17 22:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "r1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "a9f1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Character: rank + new level default
    with op.batch_alter_table("characters", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("rank", sa.String(length=20), nullable=False, server_default="common")
        )

    # ── ItemWeaponStats: hit_stat / damage_stat
    with op.batch_alter_table("item_weapon_stats", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("hit_stat", sa.String(length=20), nullable=False, server_default="strength")
        )
        batch_op.add_column(
            sa.Column("damage_stat", sa.String(length=20), nullable=True, server_default="strength")
        )

    # ── character_professions
    op.create_table(
        "character_professions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("character_id", sa.Integer(), sa.ForeignKey("characters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("acquired_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("character_id", "class_id", name="uq_character_profession"),
    )

    # ── poison_templates
    op.create_table(
        "poison_templates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), server_default=""),
        sa.Column("icon", sa.String(length=10), server_default="☠️"),
        sa.Column("color", sa.String(length=10), server_default="#7fbf54"),
        sa.Column("damage_dice_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("damage_dice_type", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("damage_type", sa.String(length=20), nullable=False, server_default="poison"),
        sa.Column("default_charges", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("default_turns_per_hit", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    # ── inventory_item_poisons
    op.create_table(
        "inventory_item_poisons",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("inventory_item_id", sa.Integer(), sa.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("poison_template_id", sa.Integer(), sa.ForeignKey("poison_templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("charges_remaining", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("turns_per_hit", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("applied_at", sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint("inventory_item_id", name="uq_inventory_item_poison"),
    )

    # ── character_wizard_state
    op.create_table(
        "character_wizard_state",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("character_id", sa.Integer(), sa.ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("data", sa.Text(), server_default="{}"),
        sa.Column("gm_approved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("character_wizard_state")
    op.drop_table("inventory_item_poisons")
    op.drop_table("poison_templates")
    op.drop_table("character_professions")

    with op.batch_alter_table("item_weapon_stats", schema=None) as batch_op:
        batch_op.drop_column("damage_stat")
        batch_op.drop_column("hit_stat")

    with op.batch_alter_table("characters", schema=None) as batch_op:
        batch_op.drop_column("rank")
