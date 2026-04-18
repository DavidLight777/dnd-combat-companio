"""rework_v3_cleanup

Rework v3: drop unused columns left over from the old schema.

* ``items.weight`` removed — Rework v2 moves to pure slot-based inventory.
* ``characters.hp_dice_count``, ``hp_dice_type``, ``hp_recovery_modifier``
  removed — the manual "Roll & Heal" widget is retired in favour of potions,
  abilities, and the new GM Full Rest button (HP = max, mana = max,
  cooldowns reset).

Non-destructive to game data; only drops columns.

Revision ID: r3a0b1c2d3e4
Revises: r2a0b1c2d3e4
Create Date: 2026-04-18 16:45:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "r3a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "r2a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop weight column from items (SQLite needs batch mode)
    with op.batch_alter_table("items", schema=None) as batch_op:
        try:
            batch_op.drop_column("weight")
        except Exception:
            pass  # already gone on fresh DBs

    # Drop manual-heal columns from characters
    with op.batch_alter_table("characters", schema=None) as batch_op:
        for col in ("hp_dice_count", "hp_dice_type", "hp_recovery_modifier"):
            try:
                batch_op.drop_column(col)
            except Exception:
                pass


def downgrade() -> None:
    import sqlalchemy as sa

    with op.batch_alter_table("items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("weight", sa.Float(), nullable=False,
                                      server_default="0.0"))

    with op.batch_alter_table("characters", schema=None) as batch_op:
        batch_op.add_column(sa.Column("hp_dice_count", sa.Integer(),
                                      nullable=False, server_default="2"))
        batch_op.add_column(sa.Column("hp_dice_type", sa.Integer(),
                                      nullable=False, server_default="12"))
        batch_op.add_column(sa.Column("hp_recovery_modifier", sa.Integer(),
                                      nullable=False, server_default="0"))
