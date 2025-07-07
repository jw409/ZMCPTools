"""Simple test to verify agent spawning works and investigate defunct processes.

This is the minimal test that should reproduce the defunct process issue
if it exists in the agent spawning mechanism.
"""

import asyncio
import os
import time
from pathlib import Path

import pytest
import psutil

from tests.utils.process_monitor import ProcessMonitor
from claude_mcp_tools.services.agent_service import AgentService


class TestSimpleSpawn:
    """Simple test case to verify agent spawning and detect defunct processes."""

    @pytest.mark.asyncio
    async def test_single_agent_spawn(self, temp_repository, test_db_session, mock_claude_cli):
        """Test spawning a single agent and monitoring for defunct processes."""
        
        # Set up process monitoring
        monitor = ProcessMonitor()
        monitor.start_monitoring()
        
        repository_path = str(temp_repository)
        
        try:
            # Create agent in database
            print(f"Creating agent for repository: {repository_path}")
            agent_result = await AgentService.create_agent(
                agent_type="implementer",
                repository_path=repository_path,
                capabilities=["testing"],
                initial_context="Simple test",
                configuration={"test_mode": True},
            )
            
            assert agent_result["success"], f"Agent creation failed: {agent_result}"
            agent_id = agent_result["agent_id"]
            print(f"Created agent: {agent_id}")
            
            # Import spawn function (this tests the import path)
            from claude_mcp_tools.orchestration_server import spawn_claude_sync
            
            # Spawn Claude CLI (mocked)
            print("Spawning Claude CLI...")
            claude_result = spawn_claude_sync(
                workFolder=repository_path,
                prompt="Simple test - respond with 'Test complete' and exit",
                session_id=None,
                model="sonnet"
            )
            
            assert claude_result.get("success"), f"Claude spawn failed: {claude_result}"
            claude_pid = claude_result.get("pid")
            assert claude_pid, "No PID returned from spawn"
            
            print(f"Spawned Claude with PID: {claude_pid}")
            monitor.track_process(claude_pid, "test-claude-cli")
            
            # Update agent with PID
            await AgentService.update_agent_pid(agent_id=agent_id, claude_pid=claude_pid)
            
            # Monitor for a few seconds
            print("Monitoring process for 3 seconds...")
            for i in range(3):
                await asyncio.sleep(1)
                monitor.print_report()
                
                # Check for defunct processes after each second
                defunct = monitor.check_for_defunct()
                if defunct:
                    print(f"WARNING: Found {len(defunct)} defunct processes at {i+1} seconds")
            
            # Final check
            print("Final process status check...")
            final_report = monitor.generate_report()
            
            # Verify no defunct processes
            assert final_report["defunct_process_count"] == 0, \
                f"Found {final_report['defunct_process_count']} defunct processes: {final_report['defunct_processes']}"
            
            # Clean up agent
            await AgentService.complete_agent(agent_id=agent_id)
            print(f"Completed agent: {agent_id}")
            
        except Exception as e:
            print(f"Test failed with error: {e}")
            monitor.print_report()
            raise
        
        finally:
            # Final cleanup check
            cleanup_report = monitor.generate_report()
            if cleanup_report["defunct_process_count"] > 0:
                print(f"CLEANUP NEEDED: {cleanup_report['defunct_process_count']} defunct processes remain")
                monitor.cleanup_defunct_processes()

    @pytest.mark.asyncio
    async def test_spawn_without_mocks(self, temp_repository, test_db_session):
        """Test real spawning if Claude CLI is available (no mocks)."""
        
        # Check if Claude CLI is available
        try:
            import subprocess
            result = subprocess.run(["which", "claude"], capture_output=True, timeout=5)
            if result.returncode != 0:
                pytest.skip("Claude CLI not available - skipping real spawn test")
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pytest.skip("Cannot check for Claude CLI - skipping real spawn test")
        
        monitor = ProcessMonitor()
        monitor.start_monitoring()
        
        repository_path = str(temp_repository)
        
        print("=== REAL SPAWN TEST (NO MOCKS) ===")
        
        try:
            # Create agent
            agent_result = await AgentService.create_agent(
                agent_type="implementer",
                repository_path=repository_path,
                capabilities=["testing"],
                initial_context="Real spawn test",
                configuration={"test_mode": True, "real_spawn": True},
            )
            
            assert agent_result["success"]
            agent_id = agent_result["agent_id"]
            
            # Import and use real spawn function
            from claude_mcp_tools.orchestration_server import spawn_claude_sync
            
            # This will try to spawn a real Claude process
            claude_result = spawn_claude_sync(
                workFolder=repository_path,
                prompt="You are a test agent. Print 'Hello from test agent' and exit immediately.",
                session_id=f"test-session-{int(time.time())}",
                model="sonnet"
            )
            
            if not claude_result.get("success"):
                pytest.skip(f"Real Claude spawn failed: {claude_result.get('error')}")
            
            claude_pid = claude_result.get("pid")
            print(f"Real Claude process spawned with PID: {claude_pid}")
            
            # Track the real process
            monitor.track_process(claude_pid, "real-claude-cli")
            
            # Monitor the real process
            for i in range(10):  # Monitor for up to 10 seconds
                await asyncio.sleep(1)
                
                # Check if process still exists
                try:
                    real_process = psutil.Process(claude_pid)
                    status = real_process.status()
                    print(f"Real process {claude_pid} status: {status}")
                    
                    if status == "zombie":
                        print(f"ERROR: Real process {claude_pid} became zombie!")
                        break
                        
                    if not real_process.is_running():
                        print(f"Real process {claude_pid} finished normally")
                        break
                        
                except psutil.NoSuchProcess:
                    print(f"Real process {claude_pid} no longer exists")
                    break
            
            # Check for any defunct processes
            final_report = monitor.generate_report()
            print(f"Final report: {final_report['defunct_process_count']} defunct processes")
            
            if final_report["defunct_process_count"] > 0:
                print("DEFUNCT PROCESSES DETECTED:")
                for proc in final_report["defunct_processes"]:
                    print(f"  PID {proc['pid']}: {proc['cmdline']}")
                
                # Try to clean them up
                cleaned = monitor.cleanup_defunct_processes()
                print(f"Cleaned up {cleaned} defunct processes")
            
            # Update database
            await AgentService.update_agent_pid(agent_id=agent_id, claude_pid=claude_pid)
            await AgentService.complete_agent(agent_id=agent_id)
            
        except Exception as e:
            print(f"Real spawn test failed: {e}")
            monitor.print_report()
            raise

    def test_process_monitor_basic(self):
        """Test that the process monitor itself works correctly."""
        monitor = ProcessMonitor()
        monitor.start_monitoring()
        
        # Get initial report
        initial_report = monitor.generate_report()
        assert initial_report["root_pid"] == os.getpid()
        assert initial_report["initial_process_count"] > 0
        
        # Track the current process
        monitor.track_process(os.getpid(), "test-process")
        
        # Generate another report
        second_report = monitor.generate_report()
        assert second_report["tracked_process_count"] == 1
        
        print("Process monitor basic test passed")

    @pytest.mark.asyncio
    async def test_database_agent_operations(self, test_db_session):
        """Test basic database operations without spawning."""
        
        # Create agent
        agent_result = await AgentService.create_agent(
            agent_type="implementer",
            repository_path="/tmp/test",
            capabilities=["testing"],
            initial_context="Database test",
            configuration={"db_test": True},
        )
        
        assert agent_result["success"]
        agent_id = agent_result["agent_id"]
        
        # Update with PID
        await AgentService.update_agent_pid(agent_id=agent_id, claude_pid=99999)
        
        # Get agent
        agent = await AgentService.get_agent_by_id(agent_id=agent_id)
        assert agent is not None
        assert agent.get("claude_pid") == 99999
        
        # Complete agent
        await AgentService.complete_agent(agent_id=agent_id)
        
        # Verify status
        final_agent = await AgentService.get_agent_by_id(agent_id=agent_id)
        assert final_agent.get("status") == "completed"
        
        print("Database operations test passed")