"""Add allow_patterns column to documentation_sources

Revision ID: 102663b5720a
Revises: 71cfde59995f
Create Date: 2025-07-05 16:14:25.688643

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '102663b5720a'
down_revision: Union[str, Sequence[str], None] = '71cfde59995f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add allow_patterns column to documentation_sources table
    op.add_column('documentation_sources', sa.Column('allow_patterns', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    # Remove allow_patterns column from documentation_sources table
    op.drop_column('documentation_sources', 'allow_patterns')
