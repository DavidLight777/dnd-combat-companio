"""add_spiritual_hp_to_npc_templates

Revision ID: 76918c96770c
Revises: c24f2883105d
Create Date: 2026-04-24 09:30:39.823897

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '76918c96770c'
down_revision: Union[str, Sequence[str], None] = 'c24f2883105d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('npc_templates', sa.Column('spiritual_max_hp', sa.Integer(), server_default='10', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('npc_templates', 'spiritual_max_hp')
