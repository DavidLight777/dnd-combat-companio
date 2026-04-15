"""phase6_abilities_memory

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2025-01-01 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Character flags for table view
    op.add_column("characters", sa.Column("place_at_table", sa.Boolean(), server_default="0", nullable=False))
    op.add_column("characters", sa.Column("show_hp_to_players", sa.Boolean(), server_default="0", nullable=False))

    # Abilities table
    op.create_table(
        "abilities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), server_default=""),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("mana_cost", sa.Integer(), server_default="0"),
        sa.Column("cooldown_turns", sa.Integer(), server_default="0"),
        sa.Column("requires_hit_roll", sa.Boolean(), server_default="0"),
        sa.Column("effect", sa.Text(), server_default="{}"),
        sa.Column("damage_dice_count", sa.Integer(), nullable=True),
        sa.Column("damage_dice_type", sa.Integer(), nullable=True),
        sa.Column("range", sa.Text(), nullable=True),
    )

    # Character abilities junction
    op.create_table(
        "character_abilities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("character_id", sa.Integer(), sa.ForeignKey("characters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ability_id", sa.Integer(), sa.ForeignKey("abilities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_unlocked", sa.Boolean(), server_default="1"),
        sa.Column("cooldown_remaining", sa.Integer(), server_default="0"),
    )

    # Character memory / journal
    op.create_table(
        "character_memory",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("character_id", sa.Integer(), sa.ForeignKey("characters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("entry_type", sa.String(30), nullable=False, server_default="note"),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("content", sa.Text(), server_default=""),
        sa.Column("related_npc_id", sa.Integer(), sa.ForeignKey("characters.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("character_memory")
    op.drop_table("character_abilities")
    op.drop_table("abilities")
    op.drop_column("characters", "show_hp_to_players")
    op.drop_column("characters", "place_at_table")
