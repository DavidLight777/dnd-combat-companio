"""add has_rerolled_hp to characters

Revision ID: add_has_rerolled_hp
Revises: 76918c96770c
Create Date: 2026-04-24 10:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_has_rerolled_hp'
down_revision: Union[str, Sequence[str], None] = '76918c96770c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('characters', sa.Column('has_rerolled_hp', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('characters', 'has_rerolled_hp')
