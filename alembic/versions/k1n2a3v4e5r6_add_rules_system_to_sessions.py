"""add rules system to sessions

Revision ID: k1n2a3v4e5r6
Revises: 4ba69fbd39d9
Create Date: 2026-05-12 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "k1n2a3v4e5r6"
down_revision: Union[str, Sequence[str], None] = "4ba69fbd39d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("sessions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("rules_system", sa.String(length=20), server_default="legacy", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("sessions", schema=None) as batch_op:
        batch_op.drop_column("rules_system")
