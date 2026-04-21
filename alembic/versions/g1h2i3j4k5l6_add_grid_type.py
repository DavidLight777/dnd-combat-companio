"""add grid_type column to map_data

Revision ID: g1h2i3j4k5l6
Revises: r4a0b1c2d3e4
Create Date: 2026-04-21 17:35:00.000000

Adds the `grid_type` column on `map_data` so the GM can toggle between
a square (Chebyshev) grid and a pointy-top hexagonal grid on the battle
map. Legacy rows default to "square" to preserve existing behaviour.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "g1h2i3j4k5l6"
down_revision: Union[str, Sequence[str], None] = "r4a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("map_data", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "grid_type",
                sa.String(length=10),
                nullable=False,
                server_default="square",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("map_data", schema=None) as batch_op:
        batch_op.drop_column("grid_type")
