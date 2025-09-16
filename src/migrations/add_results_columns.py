#!/usr/bin/env python3
"""
Database migration to add result collection columns to agent_sessions table.

HSM_PURPOSE: Add results, artifacts, completion_message, error_details columns
HSM_STATUS: production
HSM_OWNER: claude
HSM_TRUST: HIGH
HSM_VERIFIED: 2025-09-15
HSM_JOURNAL_AWARE: yes
"""

import sqlite3
from pathlib import Path
import json
import sys


def get_db_path():
    """Get the path to the ZMCP tools database."""
    return Path.home() / ".mcptools" / "data" / "claude_mcp_tools.db"


def check_columns_exist(cursor):
    """Check which result columns already exist in agent_sessions table."""
    cursor.execute("PRAGMA table_info(agent_sessions)")
    columns = cursor.fetchall()
    existing_columns = {col[1] for col in columns}  # col[1] is column name

    required_columns = {'results', 'artifacts', 'completion_message', 'error_details'}
    missing_columns = required_columns - existing_columns

    return missing_columns, existing_columns


def migrate_database():
    """Add result collection columns to agent_sessions table."""
    db_path = get_db_path()

    if not db_path.exists():
        print(f"❌ Database not found at {db_path}")
        print("   Create database first by running a ZMCP command")
        return False

    try:
        print(f"🔧 Connecting to database: {db_path}")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check existing columns
        missing_columns, existing_columns = check_columns_exist(cursor)

        print(f"📊 Current columns: {len(existing_columns)}")
        print(f"🔍 Missing result columns: {missing_columns}")

        if not missing_columns:
            print("✅ All result columns already exist!")
            conn.close()
            return True

        # Add missing columns
        column_definitions = {
            'results': 'JSON',
            'artifacts': 'JSON',
            'completion_message': 'TEXT',
            'error_details': 'JSON'
        }

        migrations_applied = []

        for column in missing_columns:
            column_def = column_definitions[column]
            migration_sql = f"ALTER TABLE agent_sessions ADD COLUMN {column} {column_def}"

            try:
                print(f"⚡ Adding column: {column} ({column_def})")
                cursor.execute(migration_sql)
                migrations_applied.append(column)
                print(f"✅ Added: {column}")

            except sqlite3.OperationalError as e:
                if "duplicate column" in str(e).lower():
                    print(f"ℹ️  Column {column} already exists, skipping")
                else:
                    print(f"❌ Failed to add {column}: {e}")
                    raise

        # Commit all changes
        conn.commit()
        print(f"💾 Database migration committed successfully")

        # Verify the migration
        print("🔍 Verifying migration...")
        missing_after, existing_after = check_columns_exist(cursor)

        if not missing_after:
            print("✅ Migration verification passed - all columns present")
        else:
            print(f"⚠️  Still missing columns: {missing_after}")

        # Show final schema
        cursor.execute("PRAGMA table_info(agent_sessions)")
        columns = cursor.fetchall()

        print("\n📋 Final agent_sessions schema:")
        for col in columns:
            print(f"   {col[1]}: {col[2]}")

        conn.close()

        return len(migrations_applied) > 0

    except Exception as e:
        print(f"💥 Migration failed: {e}")
        return False


def test_migration():
    """Test that the migration worked by inserting and retrieving test data."""
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    test_data = {
        'results': {'api_endpoints': 3, 'tests_passed': 12},
        'artifacts': {'created': ['api/auth.py'], 'modified': ['README.md']},
        'completion_message': 'Task completed successfully',
        'error_details': None
    }

    try:
        # Insert test agent with result data
        test_agent_id = 'test-result-migration'

        cursor.execute("""
            INSERT OR REPLACE INTO agent_sessions
            (id, agentName, agentType, repositoryPath, status, results, artifacts, completion_message, error_details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            test_agent_id,
            'test-migration-agent',
            'testing',
            '/test/path',
            'completed',
            json.dumps(test_data['results']),
            json.dumps(test_data['artifacts']),
            test_data['completion_message'],
            test_data['error_details']
        ))

        conn.commit()

        # Retrieve and verify
        cursor.execute("""
            SELECT results, artifacts, completion_message, error_details
            FROM agent_sessions WHERE id = ?
        """, (test_agent_id,))

        row = cursor.fetchone()
        if row:
            results, artifacts, message, errors = row

            print("🧪 Testing result data storage:")
            print(f"   Results: {results}")
            print(f"   Artifacts: {artifacts}")
            print(f"   Message: {message}")
            print(f"   Errors: {errors}")

            # Parse JSON to verify
            parsed_results = json.loads(results) if results else None
            parsed_artifacts = json.loads(artifacts) if artifacts else None

            if parsed_results == test_data['results'] and parsed_artifacts == test_data['artifacts']:
                print("✅ Result data storage test passed")
            else:
                print("❌ Result data storage test failed")
                return False

        # Clean up test data
        cursor.execute("DELETE FROM agent_sessions WHERE id = ?", (test_agent_id,))
        conn.commit()
        conn.close()

        print("✅ Migration test completed successfully")
        return True

    except Exception as e:
        print(f"❌ Migration test failed: {e}")
        conn.close()
        return False


def main():
    """Run the database migration."""
    print("🚀 ZMCP Agent Results Database Migration")
    print("=" * 50)

    print("📋 Adding result collection columns to agent_sessions:")
    print("   - results (JSON): Structured return values")
    print("   - artifacts (JSON): Files created/modified")
    print("   - completion_message (TEXT): Human-readable summary")
    print("   - error_details (JSON): Error information if failed")
    print()

    # Run migration
    success = migrate_database()

    if success:
        print("\n🧪 Running migration test...")
        test_success = test_migration()

        if test_success:
            print("\n🎉 Migration completed successfully!")
            print("✅ Agent result collection is now available")
            return 0
        else:
            print("\n❌ Migration test failed")
            return 1
    else:
        print("\n❌ Migration failed")
        return 1


if __name__ == "__main__":
    exit(main())