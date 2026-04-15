"""phase3_mana_system

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2025-01-01 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Characters: mana fields
    op.add_column("characters", sa.Column("mana_current", sa.Integer(), server_default="0", nullable=False))
    op.add_column("characters", sa.Column("mana_max", sa.Integer(), server_default="0", nullable=False))
    op.add_column("characters", sa.Column("mana_regen_per_turn", sa.Integer(), server_default="0", nullable=False))

    # Items: mana_cost and use_effect
    op.add_column("items", sa.Column("mana_cost", sa.Integer(), server_default="0", nullable=False))
    op.add_column("items", sa.Column("use_effect", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("items", "use_effect")
    op.drop_column("items", "mana_cost")
    op.drop_column("characters", "mana_regen_per_turn")
    op.drop_column("characters", "mana_max")
    op.drop_column("characters", "mana_current")
