"""Agent lifecycle management for Claude MCP Orchestration Layer."""

import asyncio
import subprocess
import uuid
from pathlib import Path
from typing import Any

import structlog
from pydantic import BaseModel

from ..database import DatabaseManager

logger = structlog.get_logger()


class AgentCapability(BaseModel):
    """Represents an agent capability."""
    name: str
    proficiency_level: int = 1  # 1-5 scale
    description: str | None = None


class AgentConfiguration(BaseModel):
    """Agent configuration parameters."""
    model: str = "sonnet"
    session_id: str | None = None
    max_task_duration: int = 3600  # seconds
    resource_limits: dict[str, Any] = {}


class AgentProcess(BaseModel):
    """Represents a running agent process."""
    agent_id: str
    process_id: int
    agent_name: str
    agent_type: str
    repository_path: str
    capabilities: list[str]
    status: str = "spawning"
    configuration: AgentConfiguration
    created_at: str
    last_heartbeat: str
    current_task_id: str | None = None


class AgentManager:
    """Manages agent lifecycle and coordination."""

    def __init__(self, db_manager: DatabaseManager):
        """Initialize agent manager.
        
        Args:
            db_manager: Database manager instance
        """
        self.db_manager = db_manager
        self._active_processes: dict[str, subprocess.Popen] = {}
        self._agent_configs: dict[str, AgentConfiguration] = {}
        self._heartbeat_tasks: dict[str, asyncio.Task] = {}

    async def spawn_agent(
        self,
        agent_type: str,
        repository_path: str,
        capabilities: list[str],
        initial_context: str = "",
        configuration: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Spawn a new agent instance.
        
        Args:
            agent_type: Type of agent to spawn
            repository_path: Repository path for the agent
            capabilities: Required capabilities
            initial_context: Initial context/instructions
            configuration: Agent configuration parameters
            
        Returns:
            Agent information including ID and status
        """
        # Generate unique agent ID and name
        agent_id = str(uuid.uuid4())
        agent_name = f"{agent_type}-{agent_id[:8]}"

        # Parse configuration
        config = AgentConfiguration(**(configuration or {}))

        # Create agent session in database
        session_id = await self.db_manager.create_agent_session(
            agent_name=agent_name,
            repository_path=repository_path,
            capabilities=capabilities,
            metadata={
                "agent_type": agent_type,
                "agent_id": agent_id,
                "configuration": config.model_dump(),
                "initial_context": initial_context,
            },
        )

        # Store configuration
        self._agent_configs[agent_id] = config

        try:
            # Spawn Claude Code process
            process_id = await self._spawn_claude_process(
                agent_id=agent_id,
                agent_type=agent_type,
                repository_path=repository_path,
                initial_context=initial_context,
                config=config,
            )

            # Start heartbeat monitoring
            heartbeat_task = asyncio.create_task(
                self._monitor_agent_heartbeat(agent_id),
            )
            self._heartbeat_tasks[agent_id] = heartbeat_task

            # Update status to active
            await self.db_manager.update_agent_status(
                session_id=session_id,
                status="active",
                metadata={
                    "process_id": process_id,
                    "spawned_at": "current_timestamp",
                },
            )

            logger.info("Agent spawned successfully",
                       agent_id=agent_id,
                       agent_type=agent_type,
                       process_id=process_id)

            return {
                "agent_id": agent_id,
                "agent_name": agent_name,
                "status": "active",
                "capabilities": capabilities,
                "process_id": process_id,
                "created_at": "current_timestamp",
            }

        except Exception as e:
            # Clean up on failure
            await self.db_manager.update_agent_status(
                session_id=session_id,
                status="terminated",
                metadata={"error": str(e)},
            )
            logger.error("Failed to spawn agent",
                        agent_id=agent_id,
                        error=str(e))
            raise

    async def _spawn_claude_process(
        self,
        agent_id: str,
        agent_type: str,
        repository_path: str,
        initial_context: str,
        config: AgentConfiguration,
    ) -> int:
        """Spawn a Claude Code process for the agent.
        
        Args:
            agent_id: Unique agent identifier
            agent_type: Type of agent
            repository_path: Repository path
            initial_context: Initial instructions
            config: Agent configuration
            
        Returns:
            Process ID
        """
        # Build Claude Code command
        cmd = [
            "claude",
            "--dangerously-skip-permissions",
            "--model", config.model,
        ]

        if config.session_id:
            cmd.extend(["-r", config.session_id])

        # Create agent prompt based on type and context
        prompt = self._build_agent_prompt(
            agent_type=agent_type,
            agent_id=agent_id,
            repository_path=repository_path,
            initial_context=initial_context,
        )

        # Create temporary prompt file
        prompt_file = Path(f"/tmp/agent_{agent_id}_prompt.txt")
        with open(prompt_file, "w") as f:
            f.write(prompt)

        cmd.extend(["-f", str(prompt_file)])

        # Spawn process
        process = subprocess.Popen(
            cmd,
            cwd=repository_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        # Store process reference
        self._active_processes[agent_id] = process

        logger.info("Claude process spawned",
                   agent_id=agent_id,
                   process_id=process.pid,
                   command=" ".join(cmd))

        return process.pid

    def _build_agent_prompt(
        self,
        agent_type: str,
        agent_id: str,
        repository_path: str,
        initial_context: str,
    ) -> str:
        """Build the initial prompt for an agent based on its type.
        
        Args:
            agent_type: Type of agent
            agent_id: Unique agent identifier
            repository_path: Repository path
            initial_context: Initial context
            
        Returns:
            Formatted prompt
        """
        base_prompt = f"""
You are a specialized {agent_type} agent in a multi-agent orchestration system.

Agent Details:
- Agent ID: {agent_id}
- Type: {agent_type}
- Repository: {repository_path}

System Integration:
- You are part of a coordinated development workflow
- Communicate progress through the orchestration system
- Follow task-specific guidelines for your specialization
- Report completion status and results clearly

Initial Context:
{initial_context}

Task-Specific Guidelines:
"""

        # Add type-specific guidance
        if agent_type == "researcher":
            base_prompt += """
- Conduct thorough code analysis and research
- Document findings with clear explanations
- Identify patterns, issues, and opportunities
- Provide recommendations for next steps
"""
        elif agent_type == "architect":
            base_prompt += """
- Design system architecture and patterns
- Create detailed technical specifications
- Consider scalability and maintainability
- Provide implementation roadmaps
"""
        elif agent_type == "implementer":
            base_prompt += """
- Write clean, efficient, and tested code
- Follow existing code patterns and conventions
- Implement features according to specifications
- Ensure proper error handling and validation
"""
        elif agent_type == "tester":
            base_prompt += """
- Create comprehensive test suites
- Verify functionality and edge cases
- Perform integration testing
- Document test results and coverage
"""
        elif agent_type == "debugger":
            base_prompt += """
- Identify root causes of issues
- Implement targeted fixes
- Verify solutions thoroughly
- Document debugging process and learnings
"""
        elif agent_type == "reviewer":
            base_prompt += """
- Conduct thorough code reviews
- Check for quality, security, and performance
- Provide constructive feedback
- Ensure compliance with standards
"""
        elif agent_type == "documenter":
            base_prompt += """
- Create clear, comprehensive documentation
- Update existing documentation as needed
- Include examples and usage patterns
- Ensure accuracy and completeness
"""

        base_prompt += """

Remember to:
1. Work efficiently within your specialization
2. Communicate clearly with other agents when needed
3. Report progress and results systematically
4. Ask for clarification if requirements are unclear
5. Follow the repository's development conventions

Begin your work now.
"""

        return base_prompt.strip()

    async def _monitor_agent_heartbeat(self, agent_id: str) -> None:
        """Monitor agent heartbeat and handle failures.
        
        Args:
            agent_id: Agent to monitor
        """
        try:
            while agent_id in self._active_processes:
                # Check if process is still running
                process = self._active_processes.get(agent_id)
                if process and process.poll() is not None:
                    # Process has terminated
                    logger.warning("Agent process terminated",
                                 agent_id=agent_id,
                                 exit_code=process.returncode)

                    await self.db_manager.update_agent_status(
                        session_id=agent_id,
                        status="terminated",
                        metadata={"exit_code": process.returncode},
                    )

                    # Clean up
                    del self._active_processes[agent_id]
                    break

                # Update heartbeat
                await self.db_manager.update_agent_status(
                    session_id=agent_id,
                    status="active",
                )

                # Wait before next check
                await asyncio.sleep(30)  # Check every 30 seconds

        except asyncio.CancelledError:
            logger.info("Heartbeat monitoring cancelled", agent_id=agent_id)
        except Exception as e:
            logger.error("Heartbeat monitoring failed",
                        agent_id=agent_id,
                        error=str(e))

    async def list_agents(
        self,
        repository_path: str | None = None,
        status_filter: list[str] | None = None,
        agent_type: str | None = None,
    ) -> dict[str, Any]:
        """List agents with optional filtering.
        
        Args:
            repository_path: Filter by repository
            status_filter: Filter by status
            agent_type: Filter by agent type
            
        Returns:
            List of agents with their information
        """
        # Get agents from database
        agents = await self.db_manager.get_active_agents(repository_path)

        # Apply filters
        filtered_agents = []
        for agent in agents:
            metadata = agent.get("metadata", {})

            # Filter by status
            if status_filter and agent.get("status") not in status_filter:
                continue

            # Filter by agent type
            if agent_type and metadata.get("agent_type") != agent_type:
                continue

            # Build response
            agent_info = {
                "agent_id": metadata.get("agent_id", agent["id"]),
                "agent_name": agent["agent_name"],
                "agent_type": metadata.get("agent_type", "unknown"),
                "repository_path": agent["repository_path"],
                "status": agent.get("status", "unknown"),
                "capabilities": agent.get("capabilities", []),
                "last_heartbeat": agent.get("last_heartbeat"),
                "current_task_id": None,  # TODO: Get from task manager
            }

            filtered_agents.append(agent_info)

        return {
            "agents": filtered_agents,
            "total_count": len(filtered_agents),
        }

    async def get_agent_status(self, agent_id: str) -> dict[str, Any] | None:
        """Get detailed status for a specific agent.
        
        Args:
            agent_id: Agent ID to query
            
        Returns:
            Agent status information or None if not found
        """
        # Get agents and find the one with matching ID
        agents = await self.db_manager.get_active_agents()

        for agent in agents:
            metadata = agent.get("metadata", {})
            if metadata.get("agent_id") == agent_id:
                return {
                    "agent_id": agent_id,
                    "agent_name": agent["agent_name"],
                    "agent_type": metadata.get("agent_type", "unknown"),
                    "status": agent.get("status", "unknown"),
                    "repository_path": agent["repository_path"],
                    "capabilities": agent.get("capabilities", []),
                    "current_task": {
                        "task_id": None,  # TODO: Get from task manager
                        "title": None,
                        "status": None,
                    },
                    "performance_metrics": {
                        "tasks_completed": 0,  # TODO: Calculate from database
                        "average_task_duration": 0,
                        "success_rate": 0.0,
                    },
                    "created_at": agent.get("created_at"),
                    "last_heartbeat": agent.get("last_heartbeat"),
                }

        return None

    async def terminate_agent(
        self,
        agent_id: str,
        reason: str = "manual_termination",
        force: bool = False,
    ) -> dict[str, Any]:
        """Terminate an agent instance.
        
        Args:
            agent_id: Agent ID to terminate
            reason: Reason for termination
            force: Force termination without waiting
            
        Returns:
            Termination result
        """
        # Find and terminate the process
        process = self._active_processes.get(agent_id)
        if process:
            try:
                if force:
                    process.kill()
                else:
                    process.terminate()

                # Wait for termination
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()

                # Clean up
                del self._active_processes[agent_id]

            except Exception as e:
                logger.error("Failed to terminate process",
                           agent_id=agent_id,
                           error=str(e))

        # Cancel heartbeat monitoring
        heartbeat_task = self._heartbeat_tasks.get(agent_id)
        if heartbeat_task:
            heartbeat_task.cancel()
            del self._heartbeat_tasks[agent_id]

        # Update database status
        success = await self.db_manager.update_agent_status(
            session_id=agent_id,
            status="terminated",
            metadata={"termination_reason": reason},
        )

        logger.info("Agent terminated",
                   agent_id=agent_id,
                   reason=reason,
                   force=force)

        return {
            "success": success,
            "agent_id": agent_id,
            "terminated_at": "current_timestamp",
            "final_status": "terminated",
            "pending_tasks_reassigned": 0,  # TODO: Implement task reassignment
        }

    async def cleanup(self) -> None:
        """Clean up all agent processes and resources."""
        # Terminate all active processes
        for agent_id in list(self._active_processes.keys()):
            await self.terminate_agent(agent_id, reason="system_shutdown", force=True)

        # Cancel all heartbeat tasks
        for task in self._heartbeat_tasks.values():
            task.cancel()

        self._heartbeat_tasks.clear()
        self._agent_configs.clear()

        logger.info("Agent manager cleanup complete")
