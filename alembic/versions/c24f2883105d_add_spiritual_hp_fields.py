"""add_spiritual_hp_fields

Revision ID: c24f2883105d
Revises: 01c1b743347c
Create Date: 2026-04-24 09:29:39.665096

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c24f2883105d'
down_revision: Union[str, Sequence[str], None] = '01c1b743347c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add spiritual HP fields to races table
    op.add_column('races', sa.Column('spiritual_hp_die', sa.Integer(), server_default='4', nullable=False))
    op.add_column('races', sa.Column('spiritual_hp_dice_count', sa.Integer(), server_default='1', nullable=False))
    
    # Add spiritual HP fields to characters table
    op.add_column('characters', sa.Column('spiritual_hp', sa.Integer(), server_default='0', nullable=False))
    op.add_column('characters', sa.Column('spiritual_max_hp', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    # Remove spiritual HP fields from characters table
    op.drop_column('characters', 'spiritual_max_hp')
    op.drop_column('characters', 'spiritual_hp')
    
    # Remove spiritual HP fields from races table
    op.drop_column('races', 'spiritual_hp_dice_count')
    op.drop_column('races', 'spiritual_hp_die')
