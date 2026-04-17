"""fix6_item_potion_fields

Adds `is_potion` (Boolean) and `potion_icon` (String) to `items` so the
GM item editor can flag potions and choose an emoji icon.

Revision ID: a9f1b2c3d4e5
Revises: 0bd0a55496f6
Create Date: 2026-04-17 12:35:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a9f1b2c3d4e5'
down_revision: Union[str, Sequence[str], None] = '0bd0a55496f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('items', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_potion', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('potion_icon', sa.String(length=8), nullable=False, server_default='🧪'))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('items', schema=None) as batch_op:
        batch_op.drop_column('potion_icon')
        batch_op.drop_column('is_potion')
