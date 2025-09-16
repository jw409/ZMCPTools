#!/usr/bin/env python3
"""
Test the zombie detection functionality with real database queries.
"""

import sqlite3
import json
from pathlib import Path
import os
import time

def get_db_path():
    return Path.home() / ".mcptools" / "data" / "claude_mcp_tools.db"

def test_current_agents():
    """Check current agents and their lifecycle status."""
    print("🔍 Testing current agent status...")

    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Get all agents with their lifecycle info
    cursor.execute("""
        SELECT id, agentName, status, process_pid, last_activity_at,
               strftime('%s', 'now') - strftime('%s', last_activity_at) as seconds_idle,
               timeout_seconds
        FROM agent_sessions
        ORDER BY last_activity_at DESC
    """)

    agents = cursor.fetchall()
    print(f"📊 Found {len(agents)} total agents")

    for agent in agents[:10]:  # Show first 10
        agent_id, name, status, pid, last_activity, seconds_idle, timeout = agent

        if last_activity:
            minutes_idle = int(seconds_idle) // 60 if seconds_idle else 0
            print(f"  🤖 {name} ({status})")
            print(f"     PID: {pid}, Idle: {minutes_idle}m, Timeout: {timeout}s")
        else:
            print(f"  🤖 {name} ({status}) - No activity recorded")

    # Count by status
    cursor.execute("SELECT status, COUNT(*) FROM agent_sessions GROUP BY status")
    status_counts = cursor.fetchall()

    print("\n📈 Agent Status Summary:")
    for status, count in status_counts:
        print(f"  {status}: {count}")

    conn.close()

def test_process_detection():
    """Test process detection logic."""
    print("\n🔍 Testing process detection...")

    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Get active agents with PIDs
    cursor.execute("""
        SELECT id, agentName, process_pid
        FROM agent_sessions
        WHERE status = 'active' AND process_pid IS NOT NULL
    """)

    active_agents = cursor.fetchall()
    print(f"📊 Found {len(active_agents)} active agents with PIDs")

    dead_count = 0
    alive_count = 0

    for agent_id, name, pid in active_agents:
        # Check if process exists
        is_alive = os.path.exists(f"/proc/{pid}")

        if is_alive:
            print(f"  ✅ {name} (PID {pid}) - ALIVE")
            alive_count += 1
        else:
            print(f"  💀 {name} (PID {pid}) - DEAD")
            dead_count += 1

    print(f"\n📊 Process Status: {alive_count} alive, {dead_count} dead")

    if dead_count > 0:
        print("⚠️  Found zombie processes that should be cleaned up")
    else:
        print("✅ All active agents have live processes")

    conn.close()

def simulate_zombie_cleanup():
    """Simulate what the zombie cleanup would do."""
    print("\n🧟 Simulating zombie cleanup...")

    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Find agents that would be marked as zombies
    cursor.execute("""
        SELECT id, agentName, process_pid, last_activity_at,
               strftime('%s', 'now') - strftime('%s', last_activity_at) as seconds_idle,
               timeout_seconds
        FROM agent_sessions
        WHERE status = 'active'
        AND process_pid IS NOT NULL
        AND last_activity_at IS NOT NULL
    """)

    agents = cursor.fetchall()
    would_cleanup = 0

    for agent_id, name, pid, last_activity, seconds_idle, timeout in agents:
        # Check if process is dead
        is_alive = os.path.exists(f"/proc/{pid}")

        # Check if timed out (using base timeout + random fuzz simulation)
        base_timeout = timeout or 1500  # 25 minutes default
        fuzz = 300  # Simulate 5 minute fuzz
        fuzzed_timeout = base_timeout + fuzz

        if not is_alive:
            print(f"  💀 Would mark {name} as 'terminated_zombie' (dead process)")
            would_cleanup += 1
        elif seconds_idle and int(seconds_idle) > fuzzed_timeout:
            minutes_idle = int(seconds_idle) // 60
            print(f"  ⏰ Would mark {name} as 'terminated_timeout' (idle {minutes_idle}m)")
            would_cleanup += 1
        else:
            minutes_idle = int(seconds_idle) // 60 if seconds_idle else 0
            print(f"  ✅ {name} is healthy (idle {minutes_idle}m)")

    print(f"\n📊 Cleanup Summary: Would clean up {would_cleanup} agents")
    conn.close()

def main():
    print("🧟 Zombie Detection Test Suite")
    print("=" * 50)

    test_current_agents()
    test_process_detection()
    simulate_zombie_cleanup()

    print("\n" + "=" * 50)
    print("✅ Zombie detection test completed")

if __name__ == "__main__":
    main()