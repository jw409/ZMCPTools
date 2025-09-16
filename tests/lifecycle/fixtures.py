#!/usr/bin/env python3
"""
Test fixtures and utilities for lifecycle management tests.
"""

import sqlite3
import tempfile
import time
import os
import signal
import subprocess
import asyncio
from pathlib import Path
from typing import Optional, Callable, Dict, Any
import pytest


def get_test_db_path():
    """Get path to test database."""
    return Path.home() / ".mcptools" / "data" / "claude_mcp_tools.db"


class TestAgentManager:
    """Manager for spawning and tracking test agents."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.spawned_agents = []

    def spawn_test_agent(self, task: str, timeout_seconds: int = 60) -> tuple[str, int]:
        """
        Spawn a real test agent with a simple task.
        Returns (agent_id, process_pid).
        """
        import uuid
        import json

        agent_id = f"test-agent-{uuid.uuid4().hex[:8]}"

        # Create a simple Python script that does the task
        script_content = f'''
import time
import sys
import os

# Simulate tool usage by touching a file
for i in range(5):
    with open("/tmp/test_activity_{agent_id}", "w") as f:
        f.write(f"Activity {{i}}")
    time.sleep(2)

print("Task completed: {task}")
'''

        script_path = f"/tmp/test_agent_{agent_id}.py"
        with open(script_path, "w") as f:
            f.write(script_content)

        # Start the process
        env = os.environ.copy()
        env['CLAUDE_SESSION_ID'] = agent_id

        process = subprocess.Popen([
            "uv", "run", "python", script_path
        ], env=env)

        # Record in database
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO agent_sessions
            (id, agentName, agentType, repositoryPath, status,
             process_pid, last_activity_at, timeout_seconds)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
        """, (
            agent_id,
            f"test-{task[:20]}",
            "testing",
            "/tmp",
            "active",
            process.pid,
            timeout_seconds
        ))

        conn.commit()
        conn.close()

        self.spawned_agents.append((agent_id, process.pid))
        return agent_id, process.pid

    def get_agent_status(self, agent_id: str) -> Optional[str]:
        """Get current status of agent."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute("SELECT status FROM agent_sessions WHERE id = ?", (agent_id,))
        result = cursor.fetchone()
        conn.close()

        return result[0] if result else None

    def get_last_activity(self, agent_id: str) -> Optional[float]:
        """Get last activity timestamp as Unix timestamp."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT strftime('%s', last_activity_at)
            FROM agent_sessions
            WHERE id = ?
        """, (agent_id,))
        result = cursor.fetchone()
        conn.close()

        return float(result[0]) if result and result[0] else None

    def terminate_agent(self, agent_id: str):
        """Terminate an agent."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Get PID
        cursor.execute("SELECT process_pid FROM agent_sessions WHERE id = ?", (agent_id,))
        result = cursor.fetchone()

        if result and result[0]:
            pid = result[0]
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass  # Already dead

        # Update status
        cursor.execute("""
            UPDATE agent_sessions
            SET status = 'terminated'
            WHERE id = ?
        """, (agent_id,))

        conn.commit()
        conn.close()

    def cleanup_all(self):
        """Clean up all spawned test agents."""
        for agent_id, pid in self.spawned_agents:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

            # Clean up temp files
            for temp_file in [f"/tmp/test_agent_{agent_id}.py", f"/tmp/test_activity_{agent_id}"]:
                try:
                    os.unlink(temp_file)
                except FileNotFoundError:
                    pass

        # Clean up database entries
        if self.spawned_agents:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            agent_ids = [agent_id for agent_id, _ in self.spawned_agents]
            placeholders = ",".join("?" * len(agent_ids))
            cursor.execute(f"DELETE FROM agent_sessions WHERE id IN ({placeholders})", agent_ids)

            conn.commit()
            conn.close()

        self.spawned_agents.clear()


def wait_for_condition(condition_fn: Callable[[], bool], timeout: float = 10, interval: float = 0.1) -> bool:
    """
    Wait for a condition to become true.

    Args:
        condition_fn: Function that returns True when condition is met
        timeout: Maximum time to wait in seconds
        interval: Check interval in seconds

    Returns:
        True if condition met, False if timeout
    """
    start = time.time()
    while time.time() - start < timeout:
        if condition_fn():
            return True
        time.sleep(interval)
    return False


def measure_tool_execution_time(heartbeat_enabled: bool = True, iterations: int = 10) -> float:
    """
    Measure average time for tool execution with/without heartbeat.

    Args:
        heartbeat_enabled: Whether to simulate heartbeat overhead
        iterations: Number of iterations to average

    Returns:
        Average execution time in seconds
    """
    total_time = 0

    for _ in range(iterations):
        start = time.time()

        # Simulate tool execution
        with open("/tmp/test_file", "w") as f:
            f.write("test content")

        if heartbeat_enabled:
            # Simulate heartbeat database update
            db_path = get_test_db_path()
            if db_path.exists():
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM agent_sessions")
                cursor.fetchone()
                conn.close()

        end = time.time()
        total_time += (end - start)

    # Clean up
    try:
        os.unlink("/tmp/test_file")
    except FileNotFoundError:
        pass

    return total_time / iterations


@pytest.fixture
def test_agent_manager():
    """Fixture providing a test agent manager with cleanup."""
    db_path = get_test_db_path()
    manager = TestAgentManager(db_path)
    yield manager
    manager.cleanup_all()


@pytest.fixture
def isolated_db():
    """Fixture providing an isolated test database."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)

    # Initialize test database with required schema
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE agent_sessions (
            id TEXT PRIMARY KEY,
            agentName TEXT,
            agentType TEXT,
            repositoryPath TEXT,
            status TEXT,
            process_pid INTEGER,
            last_activity_at TIMESTAMP,
            timeout_seconds INTEGER DEFAULT 1500
        )
    """)

    conn.commit()
    conn.close()

    yield db_path

    # Cleanup
    try:
        os.unlink(db_path)
    except FileNotFoundError:
        pass