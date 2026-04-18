"""rework_v3_drop_hit_die + add damage_modes

Rework v3 follow-up:

* Drop ``classes.hit_die`` — professions never consumed it. HP dice live
  exclusively on the race now.
* Add ``item_weapon_stats.damage_modes`` (JSON TEXT, default '[]') — lets a
  GM describe preset damage alternatives on a weapon (e.g. one-handed /
  two-handed, physical / fire). Players pick from these instead of being
  allowed to type arbitrary dice, which is now forbidden at the endpoint.

Non-destructive to game data.

Revision ID: r4a0b1c2d3e4
Revises: r3a0b1c2d3e4
Create Date: 2026-04-18 18:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "r4a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "r3a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("classes", schema=None) as batch_op:
        try:
            batch_op.drop_column("hit_die")
        except Exception:
            pass  # already gone on fresh DBs

    with op.batch_alter_table("item_weapon_stats", schema=None) as batch_op:
        try:
            batch_op.add_column(sa.Column("damage_modes", sa.Text(),
                                           nullable=False, server_default="[]"))
        except Exception:
            pass  # already added on fresh DBs


def downgrade() -> None:
    with op.batch_alter_table("item_weapon_stats", schema=None) as batch_op:
        try:
            batch_op.drop_column("damage_modes")
        except Exception:
            pass

    with op.batch_alter_table("classes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("hit_die", sa.Integer(),
                                       nullable=False, server_default="8"))
