"""phase2_rename_copper_to_bronze

Revision ID: a1b2c3d4e5f6
Revises: eb0ca4abdc8b
Create Date: 2026-04-15 13:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'eb0ca4abdc8b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename characters.gold_copper -> wealth_bronze
    with op.batch_alter_table('characters', schema=None) as batch_op:
        batch_op.alter_column('gold_copper', new_column_name='wealth_bronze')

    # Rename items.base_price_copper -> base_price_bronze
    with op.batch_alter_table('items', schema=None) as batch_op:
        batch_op.alter_column('base_price_copper', new_column_name='base_price_bronze')

    # Rename npc_shop_inventory.price_override_copper -> price_override_bronze
    with op.batch_alter_table('npc_shop_inventory', schema=None) as batch_op:
        batch_op.alter_column('price_override_copper', new_column_name='price_override_bronze')

    # Rename currency_transactions.amount_copper -> amount_bronze
    with op.batch_alter_table('currency_transactions', schema=None) as batch_op:
        batch_op.alter_column('amount_copper', new_column_name='amount_bronze')

    # Rename quest reward fields
    with op.batch_alter_table('quest_templates', schema=None) as batch_op:
        batch_op.alter_column('reward_gold_copper', new_column_name='reward_gold_bronze')

    with op.batch_alter_table('character_quests', schema=None) as batch_op:
        batch_op.alter_column('reward_gold_copper', new_column_name='reward_gold_bronze')


def downgrade() -> None:
    with op.batch_alter_table('characters', schema=None) as batch_op:
        batch_op.alter_column('wealth_bronze', new_column_name='gold_copper')

    with op.batch_alter_table('items', schema=None) as batch_op:
        batch_op.alter_column('base_price_bronze', new_column_name='base_price_copper')

    with op.batch_alter_table('npc_shop_inventory', schema=None) as batch_op:
        batch_op.alter_column('price_override_bronze', new_column_name='price_override_copper')

    with op.batch_alter_table('currency_transactions', schema=None) as batch_op:
        batch_op.alter_column('amount_bronze', new_column_name='amount_copper')

    with op.batch_alter_table('quest_templates', schema=None) as batch_op:
        batch_op.alter_column('reward_gold_bronze', new_column_name='reward_gold_copper')

    with op.batch_alter_table('character_quests', schema=None) as batch_op:
        batch_op.alter_column('reward_gold_bronze', new_column_name='reward_gold_copper')
