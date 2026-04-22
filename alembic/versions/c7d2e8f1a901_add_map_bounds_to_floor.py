"""add_map_bounds_to_floor

Revision ID: c7d2e8f1a901
Revises: abe27be90628
Create Date: 2026-04-22 13:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d2e8f1a901'
down_revision: Union[str, Sequence[str], None] = 'abe27be90628'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('map_floors', schema=None) as batch_op:
        batch_op.add_column(sa.Column('map_cols', sa.Integer(), nullable=False, server_default='40'))
        batch_op.add_column(sa.Column('map_rows', sa.Integer(), nullable=False, server_default='30'))


def downgrade() -> None:
    with op.batch_alter_table('map_floors', schema=None) as batch_op:
        batch_op.drop_column('map_rows')
        batch_op.drop_column('map_cols')
