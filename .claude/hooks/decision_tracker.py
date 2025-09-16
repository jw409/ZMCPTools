#!/usr/bin/env python3
"""
Decision tracker hook for ZMCP agent lifecycle management.
Integrates with existing claude-observability hooks to provide heartbeats.
"""

import os
import sys
import sqlite3
import json
from pathlib import Path
from datetime import datetime
import random

def get_db_path():
    """Get path to ZMCP database."""
    return Path.home() / ".mcptools" / "data" / "claude_mcp_tools.db"

def update_agent_activity(agent_id: str, tool_name: str, event_type: str = "tool_use"):
    """Update agent activity in database - this serves as our heartbeat."""
    try:
        db_path = get_db_path()
        if not db_path.exists():
            return  # Database doesn't exist yet

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Update last activity timestamp
        cursor.execute("""
            UPDATE agent_sessions
            SET last_activity_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'active'
        """, (agent_id,))

        # If we modified a row, log the activity
        if cursor.rowcount > 0:
            print(f"[Heartbeat] Agent {agent_id} activity: {tool_name} ({event_type})", file=sys.stderr)

        conn.commit()
        conn.close()

    except Exception as e:
        print(f"[Heartbeat] Error updating activity for {agent_id}: {e}", file=sys.stderr)

def cleanup_zombies():
    """Check for and cleanup zombie agents."""
    try:
        db_path = get_db_path()
        if not db_path.exists():
            return

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Find potentially stale agents
        # Base timeout: 20 minutes, with 0-10 minute fuzz
        base_timeout = 20 * 60  # 20 minutes in seconds
        fuzz = random.randint(0, 10 * 60)  # 0-10 minutes
        timeout_seconds = base_timeout + fuzz

        cursor.execute("""
            SELECT id, process_pid, agentName,
                   strftime('%s', 'now') - strftime('%s', last_activity_at) as seconds_since_activity
            FROM agent_sessions
            WHERE status = 'active'
            AND last_activity_at IS NOT NULL
            AND (strftime('%s', 'now') - strftime('%s', last_activity_at)) > ?
        """, (timeout_seconds,))

        stale_agents = cursor.fetchall()

        for agent_id, pid, name, seconds_idle in stale_agents:
            # Check if process is still alive
            is_alive = False
            if pid:
                try:
                    # Check if process exists
                    is_alive = os.path.exists(f"/proc/{pid}")
                except:
                    pass

            if not is_alive:
                # Process is dead - mark as zombie
                cursor.execute("""
                    UPDATE agent_sessions
                    SET status = 'terminated_zombie'
                    WHERE id = ?
                """, (agent_id,))
                print(f"[Cleanup] Marked dead agent {name} ({agent_id}) as zombie", file=sys.stderr)
            else:
                # Process alive but inactive - mark as stuck
                cursor.execute("""
                    UPDATE agent_sessions
                    SET status = 'terminated_timeout'
                    WHERE id = ?
                """, (agent_id,))
                print(f"[Cleanup] Marked stuck agent {name} ({agent_id}) as timeout", file=sys.stderr)

        if stale_agents:
            conn.commit()
        conn.close()

    except Exception as e:
        print(f"[Cleanup] Error during zombie cleanup: {e}", file=sys.stderr)

def main():
    """Main hook entry point."""
    if len(sys.argv) < 2:
        return

    event_type = sys.argv[1]  # PreToolUse or PostToolUse
    tool_name = sys.argv[2] if len(sys.argv) > 2 else "unknown"

    # Get agent ID from environment (set by ZMCP spawner)
    agent_id = (os.environ.get('AGENT_ID') or
                os.environ.get('CLAUDE_SESSION_ID') or
                os.environ.get('AGENT_NAME'))

    if not agent_id:
        # Try to extract from Claude-specific env vars
        for key in os.environ.keys():
            if 'session' in key.lower() or 'agent' in key.lower():
                agent_id = os.environ.get(key)
                break

    if not agent_id:
        return  # Can't track without agent ID

    # Update activity (heartbeat)
    if event_type in ["PostToolUse", "PreToolUse"]:
        update_agent_activity(agent_id, tool_name, event_type)

    # Occasionally run cleanup (1% chance on tool use)
    if random.random() < 0.01:
        cleanup_zombies()

if __name__ == "__main__":
    main()