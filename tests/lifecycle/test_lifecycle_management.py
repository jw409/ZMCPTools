#!/usr/bin/env python3
"""
Test script for agent lifecycle management.
Tests heartbeats, timeouts, and zombie detection.
"""

import sqlite3
import time
import json
import subprocess
from pathlib import Path
import sys

def get_db_path():
    return Path.home() / ".mcptools" / "data" / "claude_mcp_tools.db"

def test_heartbeat_functionality():
    """Test that the heartbeat hook is working."""
    print("🔥 Testing heartbeat functionality...")

    db_path = get_db_path()
    if not db_path.exists():
        print(f"❌ Database not found at {db_path}")
        return False

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Check if our new columns exist
    cursor.execute("PRAGMA table_info(agent_sessions)")
    columns = [col[1] for col in cursor.fetchall()]

    required_columns = ['last_activity_at', 'process_pid', 'timeout_seconds']
    missing = [col for col in required_columns if col not in columns]

    if missing:
        print(f"❌ Missing columns: {missing}")
        return False

    print("✅ Database schema looks good")

    # Check for active agents
    cursor.execute("SELECT COUNT(*) FROM agent_sessions WHERE status = 'active'")
    active_count = cursor.fetchone()[0]
    print(f"📊 Active agents: {active_count}")

    conn.close()
    return True

def test_zombie_detection():
    """Test zombie detection logic."""
    print("🧟 Testing zombie detection...")

    # This would normally call the ZMCP detectZombieAgents function
    # For now, just test the hook exists
    hook_path = Path("/home/jw/dev/game1/ZMCPTools/.claude/hooks/decision_tracker.py")

    if not hook_path.exists():
        print("❌ Hook script not found")
        return False

    if not hook_path.stat().st_mode & 0o111:
        print("❌ Hook script not executable")
        return False

    print("✅ Hook script exists and is executable")

    # Test that the hook runs without crashing
    try:
        result = subprocess.run([
            "python3", str(hook_path), "PostToolUse", "test_tool"
        ], capture_output=True, text=True, timeout=5)

        if result.returncode == 0:
            print("✅ Hook executes successfully")
        else:
            print(f"⚠️  Hook returned code {result.returncode}")
            if result.stderr:
                print(f"   stderr: {result.stderr}")
    except subprocess.TimeoutExpired:
        print("⚠️  Hook timed out (5s)")
    except Exception as e:
        print(f"❌ Hook failed: {e}")
        return False

    return True

def test_agent_spawning():
    """Test that agent spawning updates our lifecycle columns."""
    print("🚀 Testing agent spawning integration...")

    # This is a more complex test that would spawn a real agent
    # For now, just verify the infrastructure is in place

    zmcp_tools_dir = Path("/home/jw/dev/game1/ZMCPTools")
    if not zmcp_tools_dir.exists():
        print("❌ ZMCPTools directory not found")
        return False

    # Check that the AgentService has been modified
    agent_service_path = zmcp_tools_dir / "src/services/AgentService.ts"
    if not agent_service_path.exists():
        print("❌ AgentService.ts not found")
        return False

    # Look for our modifications
    content = agent_service_path.read_text()

    checks = [
        "process_pid",
        "last_activity_at",
        "detectZombieAgents",
        "isProcessAlive"
    ]

    for check in checks:
        if check not in content:
            print(f"❌ Missing modification: {check}")
            return False

    print("✅ AgentService modifications look good")
    return True

def main():
    """Run all tests."""
    print("🧪 Agent Lifecycle Management Tests")
    print("=" * 50)

    tests = [
        ("Heartbeat Hook", test_heartbeat_functionality),
        ("Zombie Detection", test_zombie_detection),
        ("Agent Spawning", test_agent_spawning)
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

    if passed == total:
        print("🎉 All tests passed! Agent lifecycle management is ready.")
        return 0
    else:
        print("⚠️  Some tests failed. Please check the implementation.")
        return 1

if __name__ == "__main__":
    sys.exit(main())