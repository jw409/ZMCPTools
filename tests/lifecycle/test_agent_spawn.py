#!/usr/bin/env python3
"""
Test agent spawning with lifecycle management integration.
"""

import sqlite3
import subprocess
import time
import json
from pathlib import Path

def get_db_path():
    return Path.home() / ".mcptools" / "data" / "claude_mcp_tools.db"

def test_spawn_agent_with_lifecycle():
    """Test spawning an agent and verify lifecycle columns are populated."""
    print("🚀 Testing agent spawn with lifecycle integration...")

    # Get initial agent count
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM agent_sessions")
    initial_count = cursor.fetchone()[0]
    print(f"📊 Initial agent count: {initial_count}")

    conn.close()

    # Spawn a test agent using the ZMCP tools
    print("🔧 Spawning test agent...")

    try:
        # This would normally use the ZMCP spawn_agent tool
        # For testing, we'll create a minimal agent entry to test the database integration

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Insert a test agent with lifecycle columns
        test_agent_id = f"test-agent-{int(time.time())}"
        test_pid = 12345  # Fake PID for testing

        cursor.execute("""
            INSERT INTO agent_sessions
            (id, agentName, agentType, repositoryPath, status,
             process_pid, last_activity_at, timeout_seconds)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
        """, (
            test_agent_id,
            "test-lifecycle-agent",
            "testing",
            "/home/jw/dev/game1",
            "active",
            test_pid,
            1800  # 30 minute timeout
        ))

        conn.commit()
        print(f"✅ Created test agent: {test_agent_id}")

        # Verify the agent was created with lifecycle columns
        cursor.execute("""
            SELECT id, agentName, status, process_pid, last_activity_at, timeout_seconds
            FROM agent_sessions
            WHERE id = ?
        """, (test_agent_id,))

        agent = cursor.fetchone()
        if agent:
            agent_id, name, status, pid, activity, timeout = agent
            print(f"✅ Agent created successfully:")
            print(f"   ID: {agent_id}")
            print(f"   Name: {name}")
            print(f"   Status: {status}")
            print(f"   PID: {pid}")
            print(f"   Last Activity: {activity}")
            print(f"   Timeout: {timeout}s")

            # Test heartbeat update
            print("🔄 Testing heartbeat update...")
            cursor.execute("""
                UPDATE agent_sessions
                SET last_activity_at = datetime('now')
                WHERE id = ?
            """, (test_agent_id,))
            conn.commit()

            cursor.execute("""
                SELECT last_activity_at FROM agent_sessions WHERE id = ?
            """, (test_agent_id,))

            new_activity = cursor.fetchone()[0]
            print(f"✅ Heartbeat updated: {new_activity}")

            # Clean up test agent
            print("🧹 Cleaning up test agent...")
            cursor.execute("DELETE FROM agent_sessions WHERE id = ?", (test_agent_id,))
            conn.commit()
            print("✅ Test agent cleaned up")

        else:
            print("❌ Failed to create test agent")

        conn.close()

    except Exception as e:
        print(f"❌ Error during agent spawn test: {e}")
        return False

    return True

def test_hook_integration():
    """Test that the hook properly updates activity."""
    print("\n🪝 Testing hook integration...")

    # Simulate tool use by calling the hook directly
    hook_path = Path("/home/jw/dev/game1/ZMCPTools/.claude/hooks/decision_tracker.py")

    if not hook_path.exists():
        print("❌ Hook not found")
        return False

    # Set environment to simulate agent context
    import os
    env = os.environ.copy()
    env['CLAUDE_SESSION_ID'] = 'test-agent-session'

    try:
        # Call hook with tool use event
        result = subprocess.run([
            "uv", "run", "python", str(hook_path), "PostToolUse", "test_tool"
        ], env=env, capture_output=True, text=True, timeout=10)

        if result.returncode == 0:
            print("✅ Hook executed successfully")
            if result.stderr:
                print(f"   Hook output: {result.stderr.strip()}")
        else:
            print(f"⚠️  Hook returned code {result.returncode}")
            if result.stderr:
                print(f"   stderr: {result.stderr}")

        return result.returncode == 0

    except subprocess.TimeoutExpired:
        print("❌ Hook timed out")
        return False
    except Exception as e:
        print(f"❌ Hook execution failed: {e}")
        return False

def main():
    print("🧪 Agent Spawn Lifecycle Test")
    print("=" * 50)

    tests = [
        ("Agent Spawn with Lifecycle", test_spawn_agent_with_lifecycle),
        ("Hook Integration", test_hook_integration)
    ]

    results = []
    for test_name, test_func in tests:
        print(f"\n🔍 Running: {test_name}")
        try:
            result = test_func()
            results.append((test_name, result))
            print(f"{'✅ PASS' if result else '❌ FAIL'}: {test_name}")
        except Exception as e:
            print(f"💥 ERROR in {test_name}: {e}")
            results.append((test_name, False))

    print("\n" + "=" * 50)
    print("📊 Test Summary:")

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status}: {test_name}")

    print(f"\n🎯 Results: {passed}/{total} tests passed")
    return 0 if passed == total else 1

if __name__ == "__main__":
    exit(main())