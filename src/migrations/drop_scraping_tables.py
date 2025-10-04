#!/usr/bin/env python3
"""
Drop scraping-related database tables.

This migration removes:
- documentation_sources
- scrape_jobs
- websites
- website_pages

These tables are no longer needed after removing browser automation
and documentation scraping tools in favor of microsoft/playwright-mcp.
"""

import sqlite3
import sys
from pathlib import Path

def run_migration(db_path: str):
    """Drop scraping tables from the database."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    tables_to_drop = [
        'documentation_sources',
        'scrape_jobs',
        'websites',
        'website_pages'
    ]

    try:
        for table in tables_to_drop:
            # Check if table exists first
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,)
            )
            if cursor.fetchone():
                print(f"Dropping table: {table}")
                cursor.execute(f"DROP TABLE {table}")
            else:
                print(f"Table {table} does not exist, skipping")

        conn.commit()
        print("✅ Successfully dropped all scraping tables")

    except Exception as e:
        conn.rollback()
        print(f"❌ Error during migration: {e}", file=sys.stderr)
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python drop_scraping_tables.py <db_path>", file=sys.stderr)
        sys.exit(1)

    db_path = sys.argv[1]
    if not Path(db_path).exists():
        print(f"Database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    run_migration(db_path)
