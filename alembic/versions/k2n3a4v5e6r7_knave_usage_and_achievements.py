"""knave usage policy and achievements

Revision ID: k2n3a4v5e6r7
Revises: k1n2a3v4e5r6
Create Date: 2026-05-12 23:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "k2n3a4v5e6r7"
down_revision: Union[str, Sequence[str], None] = "k1n2a3v4e5r6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("abilities", schema=None) as batch_op:
        batch_op.add_column(sa.Column("usage_policy", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("automation_level", sa.String(length=20), server_default="full", nullable=False))
        batch_op.add_column(sa.Column("knave_kind", sa.String(length=30), nullable=True))

    op.create_table(
        "achievement_templates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("icon", sa.Text(), nullable=False, server_default="🏆"),
        sa.Column("effects", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("is_available", sa.Boolean(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "character_achievements",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("character_id", sa.Integer(), nullable=False),
        sa.Column("template_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("icon", sa.Text(), nullable=False, server_default="🏆"),
        sa.Column("effects", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("granted_by", sa.Text(), nullable=True),
        sa.Column("granted_at", sa.DateTime(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["character_id"], ["characters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["template_id"], ["achievement_templates.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("character_achievements")
    op.drop_table("achievement_templates")
    with op.batch_alter_table("abilities", schema=None) as batch_op:
        batch_op.drop_column("knave_kind")
        batch_op.drop_column("automation_level")
        batch_op.drop_column("usage_policy")
