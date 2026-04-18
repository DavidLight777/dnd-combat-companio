"""rework_v2_character_creation

Rework v2: full character-creation overhaul.

* Drops `characters.class_id` (classes remain for GM-side professions only).
* Adds `characters.age`, `gender`, `max_inventory_slots`, `declined_stats`.
* Adds `races.hp_die`, `races.hp_dice_count`.
* Adds 5 pool-related fields on `abilities`:
    rarity, is_in_starting_pool, max_uses, is_conditional, conditional_text
* Adds `character_abilities.current_uses`, `granted_from`.
* **Destructive**: wipes all sessions (cascades characters, wizard state,
  inventory, etc.). All static catalogs (items, races, abilities, classes,
  npc_templates, poisons, shops, etc.) are preserved.

Revision ID: r2a0b1c2d3e4
Revises: r1a2b3c4d5e6
Create Date: 2026-04-18 12:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "r2a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "r1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Destructive wipe — kill every session so FK cascades clean up
    #      characters, wizards, inventory, character_abilities, etc.
    op.execute("DELETE FROM sessions")
    # Safety: rows that might not have a session FK for any reason.
    op.execute("DELETE FROM character_wizard_state")
    op.execute("DELETE FROM character_abilities")
    op.execute("DELETE FROM character_professions")
    op.execute("DELETE FROM inventory_items")
    op.execute("DELETE FROM characters")

    # ── 2. characters: drop class_id + add v2 fields
    with op.batch_alter_table("characters", schema=None) as batch_op:
        # drop legacy FK column
        try:
            batch_op.drop_constraint("fk_characters_class_id", type_="foreignkey")
        except Exception:
            # constraint name may vary across SQLite versions — batch recreate
            # handles it via table rebuild anyway
            pass
        batch_op.drop_column("class_id")

        # new identity + creation-wizard fields
        batch_op.add_column(sa.Column("age", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("gender", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "max_inventory_slots",
                sa.Integer(),
                nullable=False,
                server_default="12",
            )
        )
        batch_op.add_column(
            sa.Column(
                "declined_stats",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    # ── 3. races: HP die per race (rolled in wizard finalize + on every level-up)
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("hp_die", sa.Integer(), nullable=False, server_default="8")
        )
        batch_op.add_column(
            sa.Column(
                "hp_dice_count", sa.Integer(), nullable=False, server_default="1"
            )
        )

    # ── 4. abilities: unified "feature or ability" pool fields
    with op.batch_alter_table("abilities", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "rarity",
                sa.String(length=20),
                nullable=False,
                server_default="common",
            )
        )
        batch_op.add_column(
            sa.Column(
                "is_in_starting_pool",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(sa.Column("max_uses", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "is_conditional",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column("conditional_text", sa.Text(), nullable=True)
        )

    # ── 5. character_abilities: uses counter + provenance
    with op.batch_alter_table("character_abilities", schema=None) as batch_op:
        batch_op.add_column(sa.Column("current_uses", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "granted_from",
                sa.String(length=20),
                nullable=False,
                server_default="gm",
            )
        )


def downgrade() -> None:
    # Drop v2 fields in reverse order. Downgrade does NOT restore wiped data.
    with op.batch_alter_table("character_abilities", schema=None) as batch_op:
        batch_op.drop_column("granted_from")
        batch_op.drop_column("current_uses")

    with op.batch_alter_table("abilities", schema=None) as batch_op:
        batch_op.drop_column("conditional_text")
        batch_op.drop_column("is_conditional")
        batch_op.drop_column("max_uses")
        batch_op.drop_column("is_in_starting_pool")
        batch_op.drop_column("rarity")

    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("hp_dice_count")
        batch_op.drop_column("hp_die")

    with op.batch_alter_table("characters", schema=None) as batch_op:
        batch_op.drop_column("declined_stats")
        batch_op.drop_column("max_inventory_slots")
        batch_op.drop_column("gender")
        batch_op.drop_column("age")
        # restore class_id + FK
        batch_op.add_column(sa.Column("class_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_characters_class_id",
            "classes",
            ["class_id"],
            ["id"],
            ondelete="SET NULL",
        )
