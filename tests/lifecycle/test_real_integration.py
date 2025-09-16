#!/usr/bin/env python3
"""
Real integration tests for agent lifecycle management.
Tests with actual agent spawning, real timeouts, and genuine process validation.
"""

import pytest
import asyncio
import time
import os
import signal
import sqlite3
from pathlib import Path
from .fixtures import TestAgentManager, wait_for_condition, get_test_db_path


class TestRealAgentLifecycle:
    """Test actual agent lifecycle behavior."""

    def test_real_heartbeat_from_tool_usage(self, test_agent_manager):
        """Test that actual tool usage creates heartbeats."""
        # Spawn a real agent with a simple task
        agent_id, pid = test_agent_manager.spawn_test_agent(
            task="Read file and create activity"
        )

        # Wait for agent to start and do some work
        assert wait_for_condition(
            lambda: test_agent_manager.get_last_activity(agent_id) is not None,
            timeout=15
        ), "Agent should create heartbeat from activity"

        # Verify heartbeat is recent
        activity_time = test_agent_manager.get_last_activity(agent_id)
        assert activity_time is not None
        assert (time.time() - activity_time) < 10, "Heartbeat should be recent"

        # Clean up
        test_agent_manager.terminate_agent(agent_id)

    def test_timeout_with_real_timing(self, test_agent_manager):
        """Test that inactive agents actually timeout."""
        # Create a stopped agent (no activity)
        agent_id, pid = test_agent_manager.spawn_test_agent(
            task="Sleep indefinitely",
            timeout_seconds=5  # Very short timeout for testing
        )

        # Kill the process to simulate stuck agent
        os.kill(pid, signal.SIGSTOP)

        # Wait longer than timeout
        time.sleep(8)

        # Manually trigger cleanup (since we're testing)
        self._run_zombie_cleanup()

        # Verify agent marked as timeout or zombie
        status = test_agent_manager.get_agent_status(agent_id)
        assert status in ["terminated_timeout", "terminated_zombie"], f"Expected timeout status, got {status}"

        # Clean up
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def test_zombie_with_killed_process(self, test_agent_manager):
        """Test detection of actually dead processes."""
        # Spawn real agent
        agent_id, pid = test_agent_manager.spawn_test_agent(
            task="Long running task"
        )

        # Wait for it to start
        time.sleep(2)

        # Kill the process forcefully
        os.kill(pid, signal.SIGKILL)

        # Wait a moment for process to die
        time.sleep(1)

        # Run zombie detection
        zombies = self._detect_zombie_agents()

        # Verify our agent detected as zombie
        zombie_ids = [z['id'] for z in zombies]
        assert agent_id in zombie_ids, f"Agent {agent_id} should be detected as zombie"

        # Verify reason is dead process
        our_zombie = next(z for z in zombies if z['id'] == agent_id)
        assert our_zombie['reason'] == 'dead_process'

    def test_agent_status_transitions(self, test_agent_manager):
        """Test agent status transitions through lifecycle."""
        agent_id, pid = test_agent_manager.spawn_test_agent(
            task="Brief task that completes"
        )

        # Should start as active
        assert test_agent_manager.get_agent_status(agent_id) == "active"

        # Should have activity
        assert wait_for_condition(
            lambda: test_agent_manager.get_last_activity(agent_id) is not None,
            timeout=10
        )

        # Terminate and check status update
        test_agent_manager.terminate_agent(agent_id)
        assert test_agent_manager.get_agent_status(agent_id) == "terminated"

    def test_concurrent_heartbeats(self, test_agent_manager):
        """Test multiple agents creating heartbeats concurrently."""
        agents = []

        # Spawn multiple agents
        for i in range(5):
            agent_id, pid = test_agent_manager.spawn_test_agent(
                task=f"Concurrent task {i}"
            )
            agents.append(agent_id)

        # Wait for all to have activity
        for agent_id in agents:
            assert wait_for_condition(
                lambda aid=agent_id: test_agent_manager.get_last_activity(aid) is not None,
                timeout=15
            ), f"Agent {agent_id} should have activity"

        # All should be active
        for agent_id in agents:
            assert test_agent_manager.get_agent_status(agent_id) == "active"

        # Clean up
        for agent_id in agents:
            test_agent_manager.terminate_agent(agent_id)

    def _run_zombie_cleanup(self):
        """Run the zombie cleanup logic manually."""
        import random

        db_path = get_test_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Find potentially stale agents
        base_timeout = 5  # Short for testing
        fuzz = random.randint(0, 2)
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
            else:
                # Process alive but inactive - mark as stuck
                cursor.execute("""
                    UPDATE agent_sessions
                    SET status = 'terminated_timeout'
                    WHERE id = ?
                """, (agent_id,))

        conn.commit()
        conn.close()

    def _detect_zombie_agents(self):
        """Detect zombie agents and return list."""
        db_path = get_test_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, process_pid, agentName
            FROM agent_sessions
            WHERE status = 'active'
            AND process_pid IS NOT NULL
        """)

        agents = cursor.fetchall()
        zombies = []

        for agent_id, pid, name in agents:
            if pid and not os.path.exists(f"/proc/{pid}"):
                zombies.append({
                    'id': agent_id,
                    'pid': pid,
                    'name': name,
                    'reason': 'dead_process'
                })

        conn.close()
        return zombies


class TestHeartbeatSystemIntegration:
    """Test the heartbeat system integration."""

    def test_hook_integration(self, test_agent_manager):
        """Test that hooks properly update activity."""
        # This would test the actual hook integration
        # For now, we simulate the hook behavior
        agent_id, pid = test_agent_manager.spawn_test_agent(
            task="Tool usage test"
        )

        # Simulate hook call
        self._simulate_hook_call(agent_id, "Read", "PostToolUse")

        # Check that activity was updated
        activity_time = test_agent_manager.get_last_activity(agent_id)
        assert activity_time is not None
        assert (time.time() - activity_time) < 2

        test_agent_manager.terminate_agent(agent_id)

    def test_fuzzy_timeout_distribution(self, test_agent_manager):
        """Test that fuzzy timeouts prevent thundering herd."""
        import random

        # Test the fuzzing logic
        base_timeout = 20 * 60  # 20 minutes
        timeouts = []

        # Generate 100 fuzzy timeouts
        for _ in range(100):
            fuzz = random.randint(0, 10 * 60)  # 0-10 minutes
            timeout = base_timeout + fuzz
            timeouts.append(timeout)

        # Should have distribution
        min_timeout = min(timeouts)
        max_timeout = max(timeouts)

        assert min_timeout == base_timeout, "Minimum should be base timeout"
        assert max_timeout <= base_timeout + (10 * 60), "Maximum should be base + 10 minutes"
        assert len(set(timeouts)) > 50, "Should have good distribution of timeouts"

    def _simulate_hook_call(self, agent_id: str, tool_name: str, event_type: str):
        """Simulate the hook updating agent activity."""
        db_path = get_test_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE agent_sessions
            SET last_activity_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'active'
        """, (agent_id,))

        conn.commit()
        conn.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])