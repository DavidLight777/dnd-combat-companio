"""add race_rank_configs table

Revision ID: 01c1b743347c
Revises: c7d2e8f1a901
Create Date: 2026-04-24 08:46:30.937311

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '01c1b743347c'
down_revision: Union[str, Sequence[str], None] = 'c7d2e8f1a901'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'race_rank_configs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('race_id', sa.Integer(), sa.ForeignKey('races.id', ondelete='CASCADE'), nullable=False),
        sa.Column('rank', sa.String(length=10), nullable=False),
        sa.Column('rank_plus', sa.Integer(), server_default='0', nullable=False),
        sa.Column('physical_hp_die', sa.Integer(), server_default='4', nullable=False),
        sa.Column('physical_hp_dice_count', sa.Integer(), server_default='1', nullable=False),
        sa.Column('spiritual_hp_die', sa.Integer(), server_default='4', nullable=False),
        sa.Column('spiritual_hp_dice_count', sa.Integer(), server_default='1', nullable=False),
        sa.Column('mana_per_level', sa.Integer(), server_default='2', nullable=False),
        sa.Column('notes', sa.Text(), server_default='', nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_race_rank_configs_race_id', 'race_rank_configs', ['race_id'])
    op.create_index('ix_race_rank_configs_rank', 'race_rank_configs', ['rank'])
    op.create_index('ix_race_rank_configs_unique_rank', 'race_rank_configs', ['race_id', 'rank', 'rank_plus'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_race_rank_configs_unique_rank', table_name='race_rank_configs')
    op.drop_index('ix_race_rank_configs_rank', table_name='race_rank_configs')
    op.drop_index('ix_race_rank_configs_race_id', table_name='race_rank_configs')
    op.drop_table('race_rank_configs')
