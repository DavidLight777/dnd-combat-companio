"""phase_9_interior_zones_and_door_open

Revision ID: a6197a61b7f3
Revises: d928752f9387
Create Date: 2026-04-27 11:05:34.823536

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a6197a61b7f3'
down_revision: Union[str, Sequence[str], None] = 'd928752f9387'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'bv2_interior_zones',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('location_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('ambient_light_override', sa.Float(), nullable=True),
        sa.Column('reveal_mode', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['location_id'], ['bv2_locations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table(
        'bv2_interior_cells',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('zone_id', sa.Integer(), nullable=False),
        sa.Column('col', sa.Integer(), nullable=False),
        sa.Column('row', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['zone_id'], ['bv2_interior_zones.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('zone_id', 'col', 'row', name='uq_bv2_interior_cell')
    )
    with op.batch_alter_table('bv2_tiles', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_open', sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('bv2_tiles', schema=None) as batch_op:
        batch_op.drop_column('is_open')
    op.drop_table('bv2_interior_cells')
    op.drop_table('bv2_interior_zones')
