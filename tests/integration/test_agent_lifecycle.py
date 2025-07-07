"""Integration tests for agent lifecycle and defunct process investigation.

This test module is designed to systematically reproduce and investigate
the defunct agent process issue that has been observed in the ClaudeMcpTools
orchestration system.
"""

import asyncio
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Dict, List

import psutil
import pytest

from claude_mcp_tools.services.agent_service import AgentService
from claude_mcp_tools.models.agent import AgentStatus
from claude_mcp_tools.orchestration_server import spawn_claude_sync


class TestAgentLifecycle:
    """Test agent spawning, monitoring, and cleanup to identify defunct process issues."""

    @pytest.mark.asyncio
    async def test_agent_spawn_and_monitor_real(self, temp_repository, test_db_session):
        """Test real agent spawning to reproduce defunct process issues.
        
        This test does NOT use mocks - it spawns real processes to investigate
        the defunct process issue.
        """
        repository_path = str(temp_repository)
        
        # Step 1: Create agent in database
        agent_result = await AgentService.create_agent(
            agent_type="implementer",
            repository_path=repository_path,
            capabilities=["testing"],
            initial_context="Test context",
            configuration={"test_mode": True},
        )
        
        assert agent_result["success"]
        agent_id = agent_result["agent_id"]
        
        # Step 2: Try to spawn a real Claude process (if available)
        try:
            # First check if claude CLI is available
            claude_cli_result = subprocess.run(
                ["which", "claude"], 
                capture_output=True, 
                text=True, 
                timeout=5
            )
            
            if claude_cli_result.returncode != 0:
                pytest.skip("Claude CLI not available, skipping real process test")
            
            # Spawn a minimal Claude process
            claude_result = spawn_claude_sync(
                workFolder=repository_path,
                prompt="You are a test agent. Please respond with 'Test complete' and exit.",
                session_id=None,
                model="sonnet"
            )
            
            # Step 3: Verify spawn was successful
            assert claude_result.get("success", False), f"Claude spawn failed: {claude_result.get('error')}"
            claude_pid = claude_result.get("pid")
            assert claude_pid is not None, "No PID returned from Claude spawn"
            
            # Step 4: Monitor the process
            initial_processes = self._get_process_tree(os.getpid())
            print(f"Initial process tree: {len(initial_processes)} processes")
            
            # Update agent with PID
            await AgentService.update_agent_pid(agent_id=agent_id, claude_pid=claude_pid)
            
            # Step 5: Check process status immediately
            try:
                claude_process = psutil.Process(claude_pid)
                print(f"Claude process {claude_pid} status: {claude_process.status()}")
                print(f"Claude process cmdline: {claude_process.cmdline()}")
                
                # Monitor for a few seconds
                for i in range(10):
                    if not claude_process.is_running():
                        print(f"Process {claude_pid} stopped after {i} seconds")
                        break
                    print(f"Process {claude_pid} still running after {i} seconds, status: {claude_process.status()}")
                    await asyncio.sleep(1)
                
                # Check final status
                final_status = claude_process.status() if claude_process.is_running() else "terminated"
                print(f"Final process status: {final_status}")
                
                # Step 6: Look for defunct processes
                final_processes = self._get_process_tree(os.getpid())
                defunct_processes = [p for p in final_processes if p.get("status") == "zombie"]
                
                if defunct_processes:
                    print(f"FOUND {len(defunct_processes)} DEFUNCT PROCESSES:")
                    for p in defunct_processes:
                        print(f"  PID {p['pid']}: {p['cmdline']} (PPID: {p['ppid']})")
                
                # This assertion will help us identify the issue
                assert len(defunct_processes) == 0, f"Found {len(defunct_processes)} defunct processes"
                
            except psutil.NoSuchProcess:
                print(f"Process {claude_pid} no longer exists")
            
        except subprocess.TimeoutExpired:
            pytest.skip("Claude CLI check timed out")
        except FileNotFoundError:
            pytest.skip("Claude CLI not found in PATH")
        except Exception as e:
            # Don't fail the test - collect information instead
            print(f"Real process test failed with: {type(e).__name__}: {e}")
            
            # Check for defunct processes even if spawn failed
            final_processes = self._get_process_tree(os.getpid())
            defunct_processes = [p for p in final_processes if p.get("status") == "zombie"]
            
            if defunct_processes:
                print(f"FOUND {len(defunct_processes)} DEFUNCT PROCESSES AFTER FAILURE:")
                for p in defunct_processes:
                    print(f"  PID {p['pid']}: {p['cmdline']} (PPID: {p['ppid']})")
            
            raise  # Re-raise to see the full error

    @pytest.mark.asyncio
    async def test_agent_spawn_mock_lifecycle(self, temp_repository, test_db_session, mock_claude_cli, mock_psutil):
        """Test agent lifecycle with mocked Claude CLI to verify database operations."""
        repository_path = str(temp_repository)
        
        # Step 1: Create agent
        agent_result = await AgentService.create_agent(
            agent_type="implementer", 
            repository_path=repository_path,
            capabilities=["testing"],
            initial_context="Test context",
            configuration={"test_mode": True},
        )
        
        assert agent_result["success"]
        agent_id = agent_result["agent_id"]
        
        # Step 2: Spawn mocked Claude
        claude_result = spawn_claude_sync(
            workFolder=repository_path,
            prompt="Test prompt",
            session_id=None,
            model="sonnet"
        )
        
        assert claude_result["success"]
        claude_pid = claude_result["pid"]
        
        # Step 3: Update agent with PID
        await AgentService.update_agent_pid(agent_id=agent_id, claude_pid=claude_pid)
        
        # Step 4: Check agent status
        agent_status = await AgentService.get_agent_by_id(agent_id)
        assert agent_status is not None
        assert agent_status.get("claude_pid") == claude_pid
        
        # Step 5: Simulate process completion
        mock_psutil.is_running.return_value = False
        
        # Step 6: Update agent status
        await AgentService.complete_agent(agent_id=agent_id)
        
        # Step 7: Verify final state
        final_status = await AgentService.get_agent_by_id(agent_id)
        assert final_status.get("status") == "completed"

    @pytest.mark.asyncio
    async def test_multiple_agent_spawn_stress(self, temp_repository, test_db_session, mock_claude_cli):
        """Test spawning multiple agents to identify resource leaks or defunct processes."""
        repository_path = str(temp_repository)
        agent_ids = []
        
        # Track initial process count
        initial_process_count = len(self._get_process_tree(os.getpid()))
        print(f"Initial process count: {initial_process_count}")
        
        try:
            # Spawn multiple agents quickly
            for i in range(5):
                agent_result = await AgentService.create_agent(
                    agent_type="implementer",
                    repository_path=repository_path,
                    capabilities=["testing"],
                    initial_context=f"Test context {i}",
                    configuration={"test_mode": True, "batch_id": i},
                )
                
                assert agent_result["success"]
                agent_id = agent_result["agent_id"]
                agent_ids.append(agent_id)
                
                # Spawn Claude for each agent
                claude_result = spawn_claude_sync(
                    workFolder=repository_path,
                    prompt=f"Test agent {i} - respond and exit",
                    session_id=f"batch-session-{i}",
                    model="sonnet"
                )
                
                assert claude_result["success"]
                await AgentService.update_agent_pid(agent_id=agent_id, claude_pid=claude_result["pid"])
                
                # Small delay to prevent overwhelming the system
                await asyncio.sleep(0.1)
            
            # Monitor for a short time
            await asyncio.sleep(2)
            
            # Check for defunct processes
            final_processes = self._get_process_tree(os.getpid())
            defunct_processes = [p for p in final_processes if p.get("status") == "zombie"]
            
            print(f"Final process count: {len(final_processes)}")
            print(f"Defunct processes: {len(defunct_processes)}")
            
            if defunct_processes:
                for p in defunct_processes:
                    print(f"Defunct: PID {p['pid']}, CMD: {p['cmdline']}")
            
            # Clean up agents
            for agent_id in agent_ids:
                await AgentService.complete_agent(agent_id=agent_id)
            
            # Verify no defunct processes remain
            assert len(defunct_processes) == 0, f"Found {len(defunct_processes)} defunct processes"
            
        except Exception as e:
            # Clean up on failure
            for agent_id in agent_ids:
                try:
                    await AgentService.terminate_agent(agent_id=agent_id)
                except:
                    pass
            raise

    def _get_process_tree(self, root_pid: int) -> List[Dict]:
        """Get information about all processes in the tree starting from root_pid."""
        processes = []
        
        try:
            root_process = psutil.Process(root_pid)
            
            # Get all children recursively
            all_processes = [root_process] + root_process.children(recursive=True)
            
            for proc in all_processes:
                try:
                    proc_info = {
                        "pid": proc.pid,
                        "ppid": proc.ppid(),
                        "name": proc.name(),
                        "status": proc.status(),
                        "cmdline": " ".join(proc.cmdline()) if proc.cmdline() else proc.name(),
                        "create_time": proc.create_time(),
                    }
                    processes.append(proc_info)
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    # Process may have disappeared or be inaccessible
                    continue
                    
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
            
        return processes

    @pytest.mark.asyncio 
    async def test_cleanup_defunct_processes(self, temp_repository, test_db_session):
        """Test identification and cleanup of defunct processes."""
        # Get initial process state
        initial_processes = self._get_process_tree(os.getpid())
        initial_defunct = [p for p in initial_processes if p.get("status") == "zombie"]
        
        print(f"Initial defunct processes: {len(initial_defunct)}")
        
        # If we have defunct processes, try to clean them up
        if initial_defunct:
            print("Found existing defunct processes:")
            for p in initial_defunct:
                print(f"  PID {p['pid']}: {p['cmdline']} (PPID: {p['ppid']})")
                
                # Try to clean up defunct processes by sending SIGCHLD to parent
                try:
                    parent_process = psutil.Process(p["ppid"])
                    print(f"  Parent PID {p['ppid']}: {parent_process.name()}")
                    
                    # Signal parent to reap child
                    os.kill(p["ppid"], signal.SIGCHLD)
                    
                except (psutil.NoSuchProcess, ProcessLookupError, PermissionError):
                    print(f"  Cannot signal parent PID {p['ppid']}")
            
            # Wait a moment for cleanup
            await asyncio.sleep(1)
            
            # Check if cleanup worked
            final_processes = self._get_process_tree(os.getpid())
            final_defunct = [p for p in final_processes if p.get("status") == "zombie"]
            
            print(f"Defunct processes after cleanup: {len(final_defunct)}")
            
            # Record findings for debugging
            if len(final_defunct) < len(initial_defunct):
                print(f"Successfully cleaned up {len(initial_defunct) - len(final_defunct)} defunct processes")
            elif final_defunct:
                print("Cleanup unsuccessful - defunct processes persist")
                # This might indicate a deeper issue with the spawning mechanism