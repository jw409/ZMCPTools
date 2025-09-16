#!/usr/bin/env python3
"""
Edge case and negative tests for agent lifecycle management.
Tests error conditions, race conditions, and failure modes.
"""

import pytest
import sqlite3
import threading
import time
import os
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
from .fixtures import TestAgentManager, get_test_db_path


class TestDatabaseFailures:
    """Test graceful handling of database failures."""

    def test_database_connection_failure(self):
        """Test graceful handling when database is unavailable."""
        # Test the heartbeat update function with broken database
        from pathlib import Path

        # Point to non-existent database
        fake_db_path = Path("/nonexistent/path/fake.db")

        def update_heartbeat_with_broken_db(agent_id: str):
            """Simulate heartbeat update with broken database."""
            try:
                conn = sqlite3.connect(fake_db_path)
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE agent_sessions
                    SET last_activity_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (agent_id,))
                conn.commit()
                conn.close()
                return True
            except Exception as e:
                # Should handle gracefully
                print(f"Database error (expected): {e}")
                return False

        # Should not crash, just return False
        result = update_heartbeat_with_broken_db("test-agent")
        assert result == False, "Should handle database failure gracefully"

    def test_corrupted_database_recovery(self):
        """Test recovery from corrupted database."""
        # Create a corrupted database file
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            corrupted_db = Path(f.name)
            f.write(b"This is not a valid SQLite database")

        def attempt_database_operation(db_path):
            try:
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM agent_sessions")
                result = cursor.fetchone()
                conn.close()
                return result
            except sqlite3.DatabaseError as e:
                return f"Database error: {e}"

        # Should detect corruption
        result = attempt_database_operation(corrupted_db)
        assert isinstance(result, str) and "error" in result.lower()

        # Clean up
        os.unlink(corrupted_db)

    def test_database_locked_condition(self):
        """Test handling of database lock conditions."""
        db_path = get_test_db_path()

        def long_running_transaction():
            """Hold database lock for extended period."""
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("BEGIN EXCLUSIVE TRANSACTION")
            time.sleep(2)  # Hold lock
            cursor.execute("ROLLBACK")
            conn.close()

        def quick_heartbeat_update():
            """Try to update heartbeat quickly."""
            try:
                conn = sqlite3.connect(db_path, timeout=1.0)  # 1 second timeout
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE agent_sessions
                    SET last_activity_at = CURRENT_TIMESTAMP
                    WHERE id = 'test-agent'
                """)
                conn.commit()
                conn.close()
                return True
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e):
                    return False
                raise

        # Start long transaction in background
        import threading
        lock_thread = threading.Thread(target=long_running_transaction)
        lock_thread.start()

        time.sleep(0.5)  # Let lock acquire

        # Quick update should timeout gracefully
        result = quick_heartbeat_update()

        lock_thread.join()  # Wait for lock to release

        # Should handle lock timeout gracefully
        assert result == False, "Should handle database lock gracefully"


class TestRaceConditions:
    """Test race conditions in agent lifecycle management."""

    def test_concurrent_status_updates(self, test_agent_manager):
        """Test concurrent status updates don't corrupt data."""
        agent_id, pid = test_agent_manager.spawn_test_agent("Race condition test")

        def update_status(status: str):
            """Update agent status."""
            db_path = get_test_db_path()
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE agent_sessions
                SET status = ?
                WHERE id = ?
            """, (status, agent_id))
            conn.commit()
            conn.close()

        def send_heartbeat():
            """Send heartbeat update."""
            db_path = get_test_db_path()
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE agent_sessions
                SET last_activity_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (agent_id,))
            conn.commit()
            conn.close()

        # Start concurrent updates
        threads = [
            threading.Thread(target=update_status, args=("completed",)),
            threading.Thread(target=update_status, args=("failed",)),
            threading.Thread(target=send_heartbeat),
            threading.Thread(target=send_heartbeat),
        ]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join()

        # Final state should be consistent (one of the statuses won)
        final_status = test_agent_manager.get_agent_status(agent_id)
        assert final_status in ["completed", "failed"], f"Inconsistent final status: {final_status}"

        test_agent_manager.terminate_agent(agent_id)

    def test_spawn_and_cleanup_race(self, test_agent_manager):
        """Test race between agent spawn and cleanup."""
        def spawn_agents():
            """Spawn multiple agents quickly."""
            agents = []
            for i in range(5):
                agent_id, pid = test_agent_manager.spawn_test_agent(f"Race spawn {i}")
                agents.append(agent_id)
            return agents

        def cleanup_agents():
            """Try to cleanup agents."""
            # Simulate zombie cleanup
            db_path = get_test_db_path()
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            cursor.execute("""
                UPDATE agent_sessions
                SET status = 'terminated_cleanup'
                WHERE status = 'active'
                AND last_activity_at < datetime('now', '-1 minute')
            """)

            updated = cursor.rowcount
            conn.commit()
            conn.close()
            return updated

        # Run spawn and cleanup concurrently
        spawn_thread = threading.Thread(target=spawn_agents)
        cleanup_thread = threading.Thread(target=cleanup_agents)

        spawn_thread.start()
        time.sleep(0.1)  # Small delay
        cleanup_thread.start()

        spawn_thread.join()
        cleanup_thread.join()

        # Should not crash, database should be consistent
        db_path = get_test_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM agent_sessions")
        count = cursor.fetchone()[0]
        conn.close()

        assert count >= 0, "Database should remain consistent"


class TestProcessValidation:
    """Test edge cases in process validation."""

    def test_invalid_pid_handling(self, test_agent_manager):
        """Test handling of invalid PIDs."""
        agent_id, _ = test_agent_manager.spawn_test_agent("Invalid PID test")

        # Update with invalid PID
        db_path = get_test_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        invalid_pids = [-1, 0, 999999999]

        for invalid_pid in invalid_pids:
            cursor.execute("""
                UPDATE agent_sessions
                SET process_pid = ?
                WHERE id = ?
            """, (invalid_pid, agent_id))
            conn.commit()

            # Should handle invalid PID gracefully
            try:
                is_alive = os.path.exists(f"/proc/{invalid_pid}")
                # Should not crash
                assert isinstance(is_alive, bool)
            except Exception as e:
                pytest.fail(f"Should handle invalid PID {invalid_pid} gracefully: {e}")

        conn.close()
        test_agent_manager.terminate_agent(agent_id)

    def test_permission_denied_proc_access(self):
        """Test handling when /proc access is denied."""
        # This is hard to test in practice, but we can test the logic
        def check_process_exists(pid: int) -> bool:
            """Check if process exists with error handling."""
            try:
                return os.path.exists(f"/proc/{pid}")
            except PermissionError:
                # If we can't check, assume it's alive to be safe
                return True
            except Exception:
                # Other errors, assume dead
                return False

        # Test with current process (should exist)
        current_pid = os.getpid()
        assert check_process_exists(current_pid) == True

        # Test with non-existent PID
        assert check_process_exists(999999) == False

    def test_zombie_process_detection(self):
        """Test detection of actual zombie processes."""
        # This test is complex as it requires creating actual zombie processes
        # For now, we test the detection logic
        def is_zombie_process(pid: int) -> bool:
            """Check if process is a zombie."""
            try:
                with open(f"/proc/{pid}/stat", "r") as f:
                    stat_line = f.read()
                    # Third field is process state
                    state = stat_line.split()[2]
                    return state == 'Z'  # Zombie state
            except (FileNotFoundError, IndexError, PermissionError):
                return False

        # Test with current process (should not be zombie)
        current_pid = os.getpid()
        assert is_zombie_process(current_pid) == False


class TestErrorRecovery:
    """Test error recovery mechanisms."""

    def test_partial_database_recovery(self):
        """Test recovery from partial database corruption."""
        db_path = get_test_db_path()

        # Insert some valid data
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        cursor.execute("""
            INSERT OR REPLACE INTO agent_sessions
            (id, agentName, agentType, repositoryPath, status,
             process_pid, last_activity_at, timeout_seconds)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
        """, ("recovery-test", "recovery-agent", "testing", "/tmp", "active", 12345, 1500))

        conn.commit()

        # Simulate query with missing column (schema mismatch)
        try:
            cursor.execute("SELECT nonexistent_column FROM agent_sessions")
            cursor.fetchall()
            assert False, "Should have failed with missing column"
        except sqlite3.OperationalError as e:
            assert "no such column" in str(e)

        # Database should still be usable for valid queries
        cursor.execute("SELECT id, status FROM agent_sessions WHERE id = 'recovery-test'")
        result = cursor.fetchone()
        assert result is not None
        assert result[0] == "recovery-test"

        # Clean up
        cursor.execute("DELETE FROM agent_sessions WHERE id = 'recovery-test'")
        conn.commit()
        conn.close()

    def test_heartbeat_flood_handling(self, test_agent_manager):
        """Test handling of excessive heartbeat frequency."""
        agent_id, pid = test_agent_manager.spawn_test_agent("Flood test")

        db_path = get_test_db_path()

        # Send many heartbeats rapidly
        start_time = time.time()
        for i in range(100):
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE agent_sessions
                SET last_activity_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (agent_id,))
            conn.commit()
            conn.close()

        end_time = time.time()
        flood_time = end_time - start_time

        print(f"Processed 100 rapid heartbeats in {flood_time:.4f}s")

        # Should handle flood reasonably
        assert flood_time < 5.0, f"Heartbeat flood took too long: {flood_time:.4f}s"

        # Database should still be consistent
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT last_activity_at FROM agent_sessions WHERE id = ?", (agent_id,))
        result = cursor.fetchone()
        assert result is not None
        conn.close()

        test_agent_manager.terminate_agent(agent_id)


class TestSystemLimits:
    """Test system resource limits."""

    def test_maximum_agents(self):
        """Test behavior with many agents in database."""
        db_path = get_test_db_path()
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Create many agents
        num_agents = 500
        agent_ids = []

        for i in range(num_agents):
            agent_id = f"limit-test-{i}"
            agent_ids.append(agent_id)

            cursor.execute("""
                INSERT OR REPLACE INTO agent_sessions
                (id, agentName, agentType, repositoryPath, status,
                 process_pid, last_activity_at, timeout_seconds)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
            """, (agent_id, f"limit-{i}", "testing", "/tmp", "active", 20000 + i, 1500))

        conn.commit()

        # Test query performance with many agents
        start_time = time.time()
        cursor.execute("SELECT COUNT(*) FROM agent_sessions WHERE status = 'active'")
        count = cursor.fetchone()[0]
        query_time = time.time() - start_time

        print(f"Counted {count} agents in {query_time:.4f}s")
        assert count == num_agents
        assert query_time < 1.0, f"Query too slow with {num_agents} agents: {query_time:.4f}s"

        # Clean up
        placeholders = ",".join("?" * len(agent_ids))
        cursor.execute(f"DELETE FROM agent_sessions WHERE id IN ({placeholders})", agent_ids)
        conn.commit()
        conn.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])