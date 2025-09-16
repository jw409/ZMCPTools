#!/usr/bin/env python3
"""
Performance and load tests for agent lifecycle management.
Tests heartbeat overhead, concurrent scaling, and database performance.
"""

import pytest
import time
import sqlite3
import threading
import concurrent.futures
from pathlib import Path
from .fixtures import TestAgentManager, measure_tool_execution_time, get_test_db_path


class TestHeartbeatPerformance:
    """Test performance characteristics of heartbeat system."""

    def test_heartbeat_overhead(self):
        """Measure overhead of heartbeat system."""
        # Baseline: Tool execution without heartbeat
        without_heartbeat = measure_tool_execution_time(
            heartbeat_enabled=False,
            iterations=50
        )

        # With heartbeat
        with_heartbeat = measure_tool_execution_time(
            heartbeat_enabled=True,
            iterations=50
        )

        overhead = with_heartbeat - without_heartbeat
        print(f"Without heartbeat: {without_heartbeat:.4f}s")
        print(f"With heartbeat: {with_heartbeat:.4f}s")
        print(f"Overhead: {overhead:.4f}s ({overhead/without_heartbeat*100:.1f}%)")

        # Heartbeat should add minimal overhead (less than 10ms)
        assert overhead < 0.01, f"Heartbeat overhead too high: {overhead:.4f}s"

    def test_concurrent_heartbeat_writes(self):
        """Test concurrent heartbeat database writes."""
        db_path = get_test_db_path()

        def update_heartbeat(agent_id: str):
            """Update heartbeat for an agent."""
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE agent_sessions
                SET last_activity_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (agent_id,))

            conn.commit()
            conn.close()

        # Create test agents in database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        agent_ids = []
        for i in range(20):
            agent_id = f"perf-test-agent-{i}"
            agent_ids.append(agent_id)

            cursor.execute("""
                INSERT OR REPLACE INTO agent_sessions
                (id, agentName, agentType, repositoryPath, status,
                 process_pid, last_activity_at, timeout_seconds)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
            """, (
                agent_id,
                f"perf-test-{i}",
                "testing",
                "/tmp",
                "active",
                12345 + i,
                1500
            ))

        conn.commit()
        conn.close()

        # Test concurrent heartbeat updates
        start_time = time.time()

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [
                executor.submit(update_heartbeat, agent_id)
                for agent_id in agent_ids
            ]
            concurrent.futures.wait(futures)

        end_time = time.time()
        total_time = end_time - start_time

        print(f"Updated {len(agent_ids)} heartbeats in {total_time:.4f}s")
        print(f"Average per heartbeat: {total_time/len(agent_ids):.4f}s")

        # Should handle concurrent writes efficiently
        assert total_time < 2.0, f"Concurrent heartbeat updates too slow: {total_time:.4f}s"

        # Clean up
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        placeholders = ",".join("?" * len(agent_ids))
        cursor.execute(f"DELETE FROM agent_sessions WHERE id IN ({placeholders})", agent_ids)
        conn.commit()
        conn.close()

    def test_database_query_performance(self):
        """Test database query performance with many agents."""
        db_path = get_test_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Create many test agents
        num_agents = 100
        agent_ids = []

        for i in range(num_agents):
            agent_id = f"db-perf-test-{i}"
            agent_ids.append(agent_id)

            cursor.execute("""
                INSERT OR REPLACE INTO agent_sessions
                (id, agentName, agentType, repositoryPath, status,
                 process_pid, last_activity_at, timeout_seconds)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' seconds'), ?)
            """, (
                agent_id,
                f"db-perf-{i}",
                "testing",
                "/tmp",
                "active",
                20000 + i,
                i * 10,  # Varying activity times
                1500
            ))

        conn.commit()

        # Test various queries
        queries = [
            ("Count active agents", "SELECT COUNT(*) FROM agent_sessions WHERE status = 'active'"),
            ("Find stale agents", """
                SELECT id, process_pid,
                       strftime('%s', 'now') - strftime('%s', last_activity_at) as seconds_idle
                FROM agent_sessions
                WHERE status = 'active'
                AND last_activity_at IS NOT NULL
                AND (strftime('%s', 'now') - strftime('%s', last_activity_at)) > 300
            """),
            ("Get recent activity", """
                SELECT id, agentName, last_activity_at
                FROM agent_sessions
                WHERE status = 'active'
                ORDER BY last_activity_at DESC
                LIMIT 10
            """),
        ]

        for query_name, query in queries:
            start_time = time.time()
            cursor.execute(query)
            results = cursor.fetchall()
            end_time = time.time()

            query_time = end_time - start_time
            print(f"{query_name}: {query_time:.4f}s ({len(results)} results)")

            # Queries should be fast even with many agents
            assert query_time < 0.1, f"{query_name} too slow: {query_time:.4f}s"

        # Clean up
        placeholders = ",".join("?" * len(agent_ids))
        cursor.execute(f"DELETE FROM agent_sessions WHERE id IN ({placeholders})", agent_ids)
        conn.commit()
        conn.close()


class TestConcurrentAgentScaling:
    """Test system behavior with many concurrent agents."""

    def test_concurrent_agent_lifecycle(self, test_agent_manager):
        """Test system with multiple concurrent agents."""
        num_agents = 10  # Reasonable number for testing
        agents = []

        # Spawn agents concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [
                executor.submit(test_agent_manager.spawn_test_agent, f"Concurrent task {i}")
                for i in range(num_agents)
            ]

            for future in concurrent.futures.as_completed(futures):
                agent_id, pid = future.result()
                agents.append(agent_id)

        print(f"Spawned {len(agents)} agents")

        # Wait for all to become active
        time.sleep(5)

        # Verify all have activity
        active_count = 0
        for agent_id in agents:
            if test_agent_manager.get_last_activity(agent_id) is not None:
                active_count += 1

        print(f"{active_count}/{len(agents)} agents have activity")
        assert active_count >= len(agents) * 0.8, "Most agents should have activity"

        # Test concurrent cleanup
        start_time = time.time()
        for agent_id in agents:
            test_agent_manager.terminate_agent(agent_id)
        cleanup_time = time.time() - start_time

        print(f"Cleaned up {len(agents)} agents in {cleanup_time:.4f}s")
        assert cleanup_time < 5.0, "Cleanup should be fast"

    def test_zombie_detection_performance(self):
        """Test zombie detection performance with many agents."""
        db_path = get_test_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Create many agents with mix of states
        num_agents = 50
        agent_ids = []

        for i in range(num_agents):
            agent_id = f"zombie-perf-test-{i}"
            agent_ids.append(agent_id)

            # Mix of real and fake PIDs
            pid = 1 if i % 5 == 0 else 99999 + i  # Some dead, some alive

            cursor.execute("""
                INSERT OR REPLACE INTO agent_sessions
                (id, agentName, agentType, repositoryPath, status,
                 process_pid, last_activity_at, timeout_seconds)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-30 minutes'), ?)
            """, (
                agent_id,
                f"zombie-perf-{i}",
                "testing",
                "/tmp",
                "active",
                pid,
                600  # 10 minute timeout
            ))

        conn.commit()

        # Test zombie detection performance
        start_time = time.time()

        cursor.execute("""
            SELECT id, process_pid, agentName,
                   strftime('%s', 'now') - strftime('%s', last_activity_at) as seconds_since_activity
            FROM agent_sessions
            WHERE status = 'active'
            AND last_activity_at IS NOT NULL
            AND (strftime('%s', 'now') - strftime('%s', last_activity_at)) > 600
        """)

        stale_agents = cursor.fetchall()

        zombies_found = 0
        for agent_id, pid, name, seconds_idle in stale_agents:
            # Check if process exists (this is the expensive part)
            import os
            if pid and not os.path.exists(f"/proc/{pid}"):
                zombies_found += 1

        end_time = time.time()
        detection_time = end_time - start_time

        print(f"Zombie detection on {num_agents} agents took {detection_time:.4f}s")
        print(f"Found {zombies_found} zombies out of {len(stale_agents)} stale agents")

        # Should be reasonably fast
        assert detection_time < 1.0, f"Zombie detection too slow: {detection_time:.4f}s"

        # Clean up
        placeholders = ",".join("?" * len(agent_ids))
        cursor.execute(f"DELETE FROM agent_sessions WHERE id IN ({placeholders})", agent_ids)
        conn.commit()
        conn.close()

    def test_heartbeat_frequency_impact(self):
        """Test impact of different heartbeat frequencies."""
        db_path = get_test_db_path()

        frequencies = [0.1, 0.5, 1.0, 2.0]  # Updates per second
        results = {}

        for freq in frequencies:
            # Create test agent
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            agent_id = f"freq-test-{freq}"
            cursor.execute("""
                INSERT OR REPLACE INTO agent_sessions
                (id, agentName, agentType, repositoryPath, status,
                 process_pid, last_activity_at, timeout_seconds)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
            """, (agent_id, f"freq-test-{freq}", "testing", "/tmp", "active", 12345, 1500))

            conn.commit()

            # Test heartbeat updates at this frequency
            interval = 1.0 / freq
            duration = 5.0  # 5 seconds test
            updates = int(duration / interval)

            start_time = time.time()

            for _ in range(updates):
                cursor.execute("""
                    UPDATE agent_sessions
                    SET last_activity_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (agent_id,))
                conn.commit()
                time.sleep(interval)

            end_time = time.time()
            actual_time = end_time - start_time

            # Clean up
            cursor.execute("DELETE FROM agent_sessions WHERE id = ?", (agent_id,))
            conn.commit()
            conn.close()

            results[freq] = {
                'planned_updates': updates,
                'actual_time': actual_time,
                'avg_update_time': actual_time / updates
            }

            print(f"Frequency {freq} Hz: {updates} updates in {actual_time:.2f}s, "
                  f"avg {actual_time/updates:.4f}s per update")

        # Higher frequencies should still be reasonable
        for freq, data in results.items():
            assert data['avg_update_time'] < 0.01, f"Update time too high at {freq} Hz"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])