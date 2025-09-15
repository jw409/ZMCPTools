#!/usr/bin/env python3
"""
Database migration to add agent lifecycle management columns.
Adds PID tracking and activity-based heartbeats.
"""

import sqlite3
from pathlib import Path
import sys
from datetime import datetime

def get_db_path():
    """Get the path to the ZMCP database."""
    return Path.home() / ".mcptools" / "data" / "claude_mcp_tools.db"

def migrate():
    """Add lifecycle management columns to agent_sessions table."""
    db_path = get_db_path()

    if not db_path.exists():
        print(f"Error: Database not found at {db_path}")
        return False

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        print("Adding agent lifecycle columns...")

        # Add columns for agent lifecycle management
        cursor.execute("""
            ALTER TABLE agent_sessions
            ADD COLUMN last_activity_at TIMESTAMP
        """)

        cursor.execute("""
            ALTER TABLE agent_sessions
            ADD COLUMN process_pid INTEGER
        """)

        cursor.execute("""
            ALTER TABLE agent_sessions
            ADD COLUMN timeout_seconds INTEGER DEFAULT 1500
        """)

        # Create index for efficient queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_agent_activity
            ON agent_sessions(last_activity_at, status)
        """)

        # Update existing active agents with current timestamp
        cursor.execute("""
            UPDATE agent_sessions
            SET last_activity_at = CURRENT_TIMESTAMP
            WHERE status = 'active' AND last_activity_at IS NULL
        """)

        conn.commit()

        print("✅ Successfully added agent lifecycle columns")
        print("   - last_activity_at: Tracks when agent last used a tool")
        print("   - process_pid: Stores the agent's process ID")
        print("   - timeout_seconds: Configurable timeout (default: 25 minutes)")
        print("   - Added index for efficient activity queries")

        # Show current schema
        cursor.execute("PRAGMA table_info(agent_sessions)")
        columns = cursor.fetchall()
        print("\n📋 Updated agent_sessions schema:")
        for col in columns:
            print(f"   {col[1]} ({col[2]})")

        conn.close()
        return True

    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("⚠️  Columns already exist - migration skipped")
            return True
        else:
            print(f"❌ Migration failed: {e}")
            return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def rollback():
    """Rollback the migration (not supported by SQLite for column drops)."""
    print("⚠️  SQLite doesn't support dropping columns.")
    print("To rollback, you would need to recreate the table without these columns.")

def main():
    """Main migration script."""
    if len(sys.argv) > 1 and sys.argv[1] == "rollback":
        rollback()
    else:
        migrate()

if __name__ == "__main__":
    main()