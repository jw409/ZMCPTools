"""Enhanced MCP server with orchestration layer for Claude Code."""

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
from fastmcp import FastMCP
from pydantic import BaseModel

# Note: File operation tools are wrapped with MCP tools below for JSON parsing
# Import analysis components
from .analysis.core.treesummary import TreeSummaryManager
from .analysis.hooks.filesystem import TreeSummaryHook
from .analysis.parsers.file_analyzer import FileAnalyzer
from .database import init_database
from .models import AgentStatus, TaskStatus
from .schemas.agents import (
    ListAgentsSchema,
    SpawnAgentSchema,
    SpawnAgentsBatchSchema,
)
from .schemas.analysis import (
    AnalyzeFileSymbolsSchema,
    AnalyzeProjectStructureSchema,
    CleanupOrphanedProjectsSchema,
    DetectDeadCodeSchema,
    EasyReplaceAllSchema,
    GenerateProjectSummarySchema,
)
from .schemas.communication import (
    BroadcastMessageSchema,
    GetMessagesSchema,
    JoinRoomSchema,
    LeaveRoomSchema,
    SendMessageSchema,
    WaitForMessagesSchema,
)
from .schemas.documentation import (
    AnalyzeDocumentationChangesSchema,
    LinkDocsToCodeSchema,
    SearchDocumentationSchema,
    ScrapeDocumentationSchema,
    UpdateDocumentationSchema,
)
from .schemas.shared_memory import (
    GetAgentInsightsSchema,
    GetLearningEntriesSchema,
    GetRecentErrorsSchema,
    GetToolCallHistorySchema,
    LogErrorSchema,
    LogToolCallSchema,
    QuerySharedMemorySchema,
    ResolveErrorSchema,
    StoreAgentInsightSchema,
    StoreMemoryEntrySchema,
)
from .schemas.tasks import (
    AssignTasksBulkSchema,
    AutoAssignTasksSchema,
    CreateTaskBatchSchema,
    CreateTaskSchema,
    CreateWorkflowSchema,
    ListTasksSchema,
    SplitTaskSchema,
)
from .services.agent_service import AgentService
from .services.communication_service import CommunicationService
from .services.documentation_service import DocumentationService
from .services.error_logging_service import ErrorLoggingService
from .services.shared_memory_service import SharedMemoryService

# Import ORM services
from .services.task_service import TaskService

# Import MCP Claude Code tool for actual agent spawning
try:
    from .mcp_tools import mcp__ccm__claude_code as _spawn_claude_sync  # type: ignore
except ImportError:
    # Fallback if mcp_tools module doesn't exist yet
    def _spawn_claude_sync(*args, **kwargs):
        return {"pid": None, "error": "Claude Code tool not available"}


# Async wrapper for Claude spawning to prevent blocking
async def spawn_claude_async(
    workFolder: str,
    prompt: str,
    session_id: str | None = None,
    model: str = "sonnet",
) -> dict[str, Any]:
    """Async wrapper for Claude spawning to prevent blocking the event loop.
    
    Args:
        workFolder: Working directory for Claude execution
        prompt: Prompt for Claude to execute
        session_id: Optional session ID for context sharing
        model: Claude model to use
        
    Returns:
        Result from Claude spawning with PID and execution info
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    # Run the potentially blocking spawn_claude in a thread pool
    loop = asyncio.get_event_loop()

    def _spawn_in_thread():
        try:
            return _spawn_claude_sync(
                workFolder=workFolder,
                prompt=prompt,
                session_id=session_id,
                model=model,
            )
        except Exception as e:
            logger.error("Claude spawn failed in thread", error=str(e))
            return {"pid": None, "error": f"Spawn failed: {e!s}"}

    # Execute in thread pool to avoid blocking
    with ThreadPoolExecutor(max_workers=1) as executor:
        result = await loop.run_in_executor(executor, _spawn_in_thread)

    logger.debug("Claude spawned asynchronously",
                 pid=result.get("pid"),
                 has_error=bool(result.get("error")))

    return result


# Keep the old synchronous function name for backward compatibility
spawn_claude = _spawn_claude_sync


# Process pool manager for concurrent Claude spawning
class ProcessPoolManager:
    """Manages a process pool for concurrent Claude spawning operations."""

    def __init__(self, max_workers: int = 5):
        self.max_workers = max_workers
        self._executor = None
        self._active_spawns = 0

    async def __aenter__(self):
        """Enter the context manager and initialize the process pool."""
        from concurrent.futures import ThreadPoolExecutor
        self._executor = ThreadPoolExecutor(max_workers=self.max_workers)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit the context manager and cleanup the process pool."""
        if self._executor:
            self._executor.shutdown(wait=True)

    async def spawn_claude_concurrent(
        self,
        workFolder: str,
        prompt: str,
        session_id: str | None = None,
        model: str = "sonnet",
    ) -> dict[str, Any]:
        """Spawn Claude using the managed process pool.
        
        Args:
            workFolder: Working directory for Claude execution
            prompt: Prompt for Claude to execute
            session_id: Optional session ID for context sharing
            model: Claude model to use
            
        Returns:
            Result from Claude spawning with PID and execution info
        """
        if not self._executor:
            raise RuntimeError("ProcessPoolManager not initialized - use as context manager")

        self._active_spawns += 1

        try:
            def _spawn_in_pool():
                try:
                    return _spawn_claude_sync(
                        workFolder=workFolder,
                        prompt=prompt,
                        session_id=session_id,
                        model=model,
                    )
                except Exception as e:
                    logger.error("Claude spawn failed in process pool",
                               workFolder=workFolder,
                               error=str(e))
                    return {"pid": None, "error": f"Spawn failed: {e!s}"}

            # Execute in the managed process pool
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(self._executor, _spawn_in_pool)

            logger.debug("Claude spawned via process pool",
                        pid=result.get("pid"),
                        active_spawns=self._active_spawns,
                        has_error=bool(result.get("error")))

            return result

        finally:
            self._active_spawns -= 1

# Configure structlog
structlog.configure(
    processors=[
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),
    logger_factory=structlog.WriteLoggerFactory(),
    cache_logger_on_first_use=True,
)

# Get logger instance
logger = structlog.get_logger()


def parse_ai_json(value: str | dict[str, Any] | None) -> dict[str, Any] | None:
    """Parse JSON from AI assistants that might format it in various ways.
    
    Handles common AI patterns:
    - JSON strings: '{"key": "value"}'
    - Markdown code blocks: ```json{"key": "value"}```
    - Extra whitespace/newlines
    - Already-parsed dictionaries (pass-through)
    
    Args:
        value: The value to parse (string, dict, or None)
        
    Returns:
        Parsed dictionary or None if parsing fails
        
    Raises:
        ValueError: If parsing fails with details about the error
    """
    if value is None:
        return None

    # Already a dictionary - pass through
    if isinstance(value, dict):
        return value

    # Must be a string to parse
    if not isinstance(value, str):
        raise ValueError(f"Expected string or dict, got {type(value).__name__}")

    # Clean the string of common AI formatting patterns
    cleaned = value.strip()

    # Remove markdown code blocks (```json...``` or ```...```)
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned, flags=re.MULTILINE)

    # Remove surrounding quotes if they wrap the entire JSON
    if cleaned.startswith('"') and cleaned.endswith('"') and cleaned.count('"') >= 2:
        # Check if quotes are just wrapping the JSON
        try:
            inner = cleaned[1:-1]
            # Try parsing the inner content
            json.loads(inner)
            cleaned = inner
        except (json.JSONDecodeError, ValueError):
            # Not wrapped JSON, keep original
            pass

    # Handle escaped quotes that AI might generate
    if '""' in cleaned:
        cleaned = cleaned.replace('""', '"')

    # Remove leading/trailing whitespace again
    cleaned = cleaned.strip()

    # Try to parse as JSON
    try:
        result = json.loads(cleaned)
        if not isinstance(result, dict):
            raise ValueError(f"JSON parsed to {type(result).__name__}, expected dict")
        return result
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON format: {e}. Input was: {cleaned[:100]}...")


app = FastMCP("Claude MCP Orchestration Tools")

# Global analysis managers
analysis_hooks: dict[str, TreeSummaryHook] = {}

# Global documentation service instance
documentation_service: DocumentationService | None = None


class OrchestrationError(BaseModel):
    """Orchestration error response."""
    error: dict[str, Any]


async def initialize_orchestration():
    """Initialize the orchestration system."""
    global documentation_service

    try:
        # Initialize SQLAlchemy ORM database
        await init_database()
        logger.info("SQLAlchemy ORM database initialized")

        # Initialize documentation service
        documentation_service = DocumentationService()
        await documentation_service.initialize()

        logger.info("Orchestration system initialized successfully")

    except Exception as e:
        logger.error("Failed to initialize orchestration system", error=str(e))
        raise


async def cleanup_orchestration():
    """Clean up orchestration resources."""
    global documentation_service

    try:
        # Cleanup communication service
        await CommunicationService.cleanup()

        # Cleanup documentation service
        if documentation_service:
            await documentation_service.cleanup()

        logger.info("Orchestration system cleanup complete")

    except Exception as e:
        logger.error("Error during orchestration cleanup", error=str(e))


# =============================================================================
# ARCHITECT-LED ORCHESTRATION SYSTEM
# =============================================================================

async def create_objective_room(objective: str, repository_path: str) -> dict[str, Any]:
    """Create a unique chat room for a specific objective with architect coordination.
    
    Args:
        objective: Description of the overall objective/goal
        repository_path: Repository path for the objective
        
    Returns:
        Room creation result with room name and coordination info
    """
    try:
        # Create unique room name based on objective hash
        import hashlib
        objective_hash = hashlib.md5(objective.encode()).hexdigest()[:8]
        room_name = f"objective-{objective_hash}"

        # Create the coordination room
        room_result = await CommunicationService.create_room(
            name=room_name,
            description=f"Coordination room for objective: {objective}",
            repository_path=repository_path,
        )

        if not room_result.get("success"):
            return {"error": {"code": "ROOM_CREATION_FAILED", "message": room_result.get("error", "Unknown error")}}

        # Store objective metadata
        room_metadata = {
            "objective": objective,
            "repository_path": repository_path,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "room_type": "objective_coordination",
        }

        # Note: Room metadata update would go here if CommunicationService supported it
        # For now, we store metadata in the room description

        logger.info("Created objective coordination room",
                   room_name=room_name,
                   objective=objective,
                   repository=repository_path)

        return {
            "success": True,
            "room_name": room_name,
            "objective": objective,
            "repository_path": repository_path,
            "room_metadata": room_metadata,
        }

    except Exception as e:
        logger.error("Failed to create objective room", objective=objective, error=str(e))
        return {"error": {"code": "OBJECTIVE_ROOM_FAILED", "message": str(e)}}


async def spawn_architect_agent(objective: str, repository_path: str, room_name: str, foundation_session_id: str = "") -> dict[str, Any]:
    """Spawn an architect agent to analyze an objective and coordinate specialized agents.
    
    Args:
        objective: The overall objective to accomplish
        repository_path: Repository path
        room_name: Coordination room name
        foundation_session_id: Shared context session for cost reduction
        
    Returns:
        Architect agent creation result with coordination plan
    """
    try:
        # Create architect agent database record
        architect_result = await AgentService.create_agent(
            agent_type="architect",
            repository_path=repository_path,
            capabilities=["planning", "coordination", "agent_spawning", "task_distribution"],
            initial_context=f"Objective: {objective}",
            configuration={
                "objective": objective,
                "coordination_room": room_name,
                "foundation_session_id": foundation_session_id,
                "role": "architect_coordinator",
            },
        )

        if not architect_result.get("success"):
            return {"error": {"code": "ARCHITECT_CREATION_FAILED", "message": architect_result.get("error", "Unknown error")}}

        architect_id = architect_result["agent_id"]

        # Construct architect prompt
        architect_prompt = f"""You are the ARCHITECT AGENT for ClaudeMcpTools multi-agent orchestration.

🎯 OBJECTIVE: {objective}

📍 COORDINATION:
- Room: {room_name}
- Repository: {repository_path}
- Your Agent ID: {architect_id}

🧠 YOUR MISSION:
1. **ANALYZE** the objective and break it down into specific tasks
2. **DESIGN** an execution plan with specialized agents (backend, frontend, testing, documentation, etc.)
3. **SPAWN** specialized agents using spawn_agent() with specific tasks
4. **COORDINATE** through the chat room - assign tasks via messages
5. **MONITOR** progress and help agents collaborate

🛠️ AVAILABLE AGENT TYPES:
- general-agent: General development tasks, code writing, feature implementation
- bugfix-agent: Bug hunting, debugging, issue resolution, error fixing
- refactor-agent: Code refactoring, optimization, cleanup, restructuring  
- research-agent: Investigation, analysis, exploration of unknowns
- testing-agent: Test writing, validation, QA, coverage improvement
- docs-agent: Documentation, README files, code comments, guides
- review-agent: Code review, quality checks, best practices validation
- architect-agent: System design, planning, high-level architecture (you are this!)
- specialist-agent: Domain-specific expertise when needed

💬 COORDINATION PATTERN:
1. Join room: {room_name}
2. Announce your analysis plan
3. Spawn agents with: spawn_agent(agent_type="X", repository_path="{repository_path}", task_description="specific task", coordination_room="{room_name}", foundation_session_id="{foundation_session_id}")
4. Assign tasks through chat messages
5. Monitor and coordinate agent work

📞 CLEAN CHAT COMMANDS:
- join_room(room_name="{room_name}", agent_name="architect", agent_id="{architect_id}")
- send_message(room_name="{room_name}", agent_name="architect", message="your coordination message")
- get_messages(room_name="{room_name}", agent_id="{architect_id}")
- spawn_agent(agent_type="general", task_description="implement X feature", coordination_room="{room_name}")

🚀 START BY:
1. Joining the coordination room
2. Analyzing the objective
3. Creating your execution plan
4. Spawning the first batch of agents

Begin orchestration now!"""

        # Spawn actual Claude instance for architect
        try:
            claude_result = spawn_claude(
                workFolder=repository_path,
                prompt=architect_prompt,
                session_id=foundation_session_id if foundation_session_id else None,
                model="sonnet",
            )

            claude_pid = claude_result.get("pid")

            # Update architect status (metadata would need separate method)
            await AgentService.update_agent_status(
                agent_id=architect_id,
                status=AgentStatus.ACTIVE,
            )

            logger.info("Spawned architect agent",
                       architect_id=architect_id,
                       claude_pid=claude_pid,
                       objective=objective,
                       room=room_name)

            return {
                "success": True,
                "architect_id": architect_id,
                "claude_pid": claude_pid,
                "coordination_room": room_name,
                "objective": objective,
                "foundation_session_id": foundation_session_id,
                "started_at": datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            logger.error("Failed to spawn architect Claude instance",
                        architect_id=architect_id,
                        error=str(e))
            return {"error": {"code": "ARCHITECT_SPAWN_FAILED", "message": f"Claude spawn failed: {e!s}"}}

    except Exception as e:
        logger.error("Failed to create architect agent", objective=objective, error=str(e))
        return {"error": {"code": "ARCHITECT_FAILED", "message": str(e)}}


async def setup_dependency_monitoring(agent_id: str, depends_on: list[str]) -> dict[str, Any]:
    """Set up dependency monitoring for an agent through chat room coordination.
    
    Args:
        agent_id: The agent that has dependencies
        depends_on: List of agent IDs this agent depends on
        
    Returns:
        Dependency setup result with coordination info
    """
    try:
        if not depends_on:
            return {"success": True, "dependencies": [], "status": "no_dependencies"}

        # Check if all dependency agents exist
        missing_agents = []
        for dep_agent_id in depends_on:
            dep_agent = await AgentService.get_agent_by_id(dep_agent_id)
            if not dep_agent:
                missing_agents.append(dep_agent_id)

        if missing_agents:
            return {
                "success": False,
                "error": f"Dependency agents not found: {', '.join(missing_agents)}",
                "missing_agents": missing_agents,
            }

        # Store dependency info in agent metadata
        agent_metadata = {
            "dependencies": depends_on,
            "dependency_status": "waiting_for_dependencies",
            "waiting_since": datetime.now(timezone.utc).isoformat(),
        }

        await AgentService.update_agent_status(
            agent_id=agent_id,
            status=AgentStatus.IDLE,
            agent_data=agent_metadata,
        )

        logger.info("Dependency monitoring set up",
                   agent_id=agent_id,
                   depends_on=depends_on)

        return {
            "success": True,
            "agent_id": agent_id,
            "depends_on": depends_on,
            "status": "monitoring_active",
            "coordination_note": "Agent will monitor chat room for completion announcements",
        }

    except Exception as e:
        logger.error("Failed to set up dependency monitoring",
                    agent_id=agent_id,
                    depends_on=depends_on,
                    error=str(e))
        return {
            "success": False,
            "error": f"Dependency setup failed: {e!s}",
            "agent_id": agent_id,
        }


# =============================================================================
# AGENT LIFECYCLE MANAGEMENT TOOLS
# =============================================================================

@app.tool(
    name="orchestrate_objective",
    description="Start architect-led multi-agent orchestration for complex objectives that benefit from breaking down into specialized tasks and coordinating multiple agents",
    tags={"orchestration", "multi-agent", "coordination", "architect", "objective-planning"}
)
async def orchestrate_objective(
    objective: str,
    repository_path: str,
    foundation_session_id: str = "",
    auto_spawn_architect: bool = True,
) -> dict[str, Any]:
    """Start architect-led multi-agent orchestration for a specific objective.
    
    This is the main entry point for complex tasks that benefit from multi-agent coordination.
    It creates a coordination room and spawns an architect agent to analyze and break down the objective.
    
    Args:
        objective: The overall goal or task to accomplish (e.g., "Add OAuth login with tests and docs")
        repository_path: Absolute path to the repository
        foundation_session_id: Optional shared context session for cost reduction
        auto_spawn_architect: Whether to automatically spawn the architect agent
        
    Returns:
        Orchestration setup result with room and architect info
    """
    try:
        # 1. Create unique coordination room for this objective
        room_result = await create_objective_room(objective, repository_path)
        if not room_result.get("success"):
            return {"error": {"code": "ROOM_CREATION_FAILED", "message": room_result.get("error", "Unknown error")}}

        room_name = room_result["room_name"]

        # 2. Spawn architect agent if requested
        architect_info = {}
        if auto_spawn_architect:
            architect_result = await spawn_architect_agent(
                objective=objective,
                repository_path=repository_path,
                room_name=room_name,
                foundation_session_id=foundation_session_id,
            )

            if not architect_result.get("success"):
                return {"error": {"code": "ARCHITECT_SPAWN_FAILED", "message": architect_result.get("error", "Unknown error")}}

            architect_info = architect_result

        logger.info("Orchestration initiated",
                   objective=objective,
                   room=room_name,
                   repository=repository_path,
                   architect_spawned=auto_spawn_architect)

        return {
            "success": True,
            "objective": objective,
            "repository_path": repository_path,
            "coordination_room": room_name,
            "architect_info": architect_info,
            "foundation_session_id": foundation_session_id,
            "orchestration_started_at": datetime.now(timezone.utc).isoformat(),
            "next_steps": [
                f"Monitor coordination in room: {room_name}",
                "Architect will analyze objective and spawn specialized agents",
                "Agents will coordinate through chat to complete the objective",
            ],
        }

    except Exception as e:
        logger.error("Failed to orchestrate objective", objective=objective, error=str(e))
        return {"error": {"code": "ORCHESTRATION_FAILED", "message": str(e)}}


async def _spawn_single_agent(
    agent_type: str,
    repository_path: str,
    task_description: str = "",
    capabilities: list[str] = [],
    initial_context: str = "",
    configuration: str | dict[str, Any] | None = None,
    depends_on: list[str] = [],
    foundation_session_id: str = "",
    auto_execute: bool = True,
    coordination_room: str = "",
    _pool_manager: ProcessPoolManager | None = None,
) -> dict[str, Any]:
    """Internal function to spawn a single agent - extracted for parallel execution."""
    """Create a new specialized agent instance with architect-led coordination and actual Claude execution.
    
    Args:
        agent_type: Specialization type for the agent (backend, frontend, testing, documentation, etc.)
        repository_path: Absolute path to the repository
        task_description: Specific task for the agent to execute
        capabilities: List of required capabilities
        initial_context: Initial context or instructions for the agent
        configuration: Agent-specific configuration parameters (can be dict or JSON string)
        depends_on: List of agent IDs this agent should wait for before executing
        foundation_session_id: Shared context session ID for cost reduction
        auto_execute: Whether to spawn actual Claude instance (True) or just database record (False)
        coordination_room: Room name for agent communication and task coordination
        
    Returns:
        Agent information including ID, status, and Claude PID if executed
    """
    try:
        # Parse configuration using AI-tolerant parser
        try:
            parsed_configuration = parse_ai_json(configuration)
        except ValueError as e:
            return {"error": {"code": "INVALID_CONFIGURATION", "message": str(e)}}

        # 1. Create database record first
        agent_result = await AgentService.create_agent(
            agent_type=agent_type,
            repository_path=repository_path,
            capabilities=capabilities,
            initial_context=initial_context,
            configuration=parsed_configuration,
        )

        if not agent_result.get("success"):
            return {"error": {"code": "AGENT_DB_CREATION_FAILED", "message": agent_result.get("error", "Unknown error")}}

        agent_id = agent_result["agent_id"]
        agent_name = f"{agent_type}-agent"

        # 2. Set up dependency monitoring if needed
        dependency_info = {}
        if depends_on:
            dependency_info = await setup_dependency_monitoring(agent_id, depends_on)
            if not dependency_info.get("success"):
                logger.warning("Dependency setup failed", agent_id=agent_id, depends_on=depends_on)

        # 3. Spawn actual Claude instance if auto_execute is True
        claude_pid = None
        execution_info = {}

        if auto_execute:
            # Use provided coordination room or create agent-specific one
            room_name = coordination_room or f"{agent_type}-{agent_id[:8]}"

            # Ensure coordination room exists
            if coordination_room:
                # Join existing room (assumed to exist)
                try:
                    await CommunicationService.join_room(
                        room_name=room_name,
                        agent_name=agent_name,
                        agent_id=agent_id,
                    )
                except Exception:
                    # Room might already exist or join might fail - that's okay
                    pass
            else:
                # Create new room for this agent
                await CommunicationService.create_room(
                    name=room_name,
                    description=f"Coordination room for {agent_type} agent {agent_id}",
                    repository_path=repository_path,
                )

            # Construct Claude prompt for the agent
            claude_prompt = f"""You are a {agent_type.upper()} AGENT in the ClaudeMcpTools multi-agent orchestration system.

🤖 AGENT INFO:
- Agent ID: {agent_id}
- Agent Type: {agent_type}
- Repository: {repository_path}
- Coordination Room: {room_name}

🎯 YOUR TASK:
{task_description}

📋 CONTEXT:
{initial_context}

🔗 DEPENDENCIES:
{f"⏳ Waiting for agents: {', '.join(depends_on)}" if depends_on else "✅ No dependencies - ready to start"}

🏗️ COORDINATION WORKFLOW:
1. **JOIN ROOM**: Use join_room() to join "{room_name}"
2. **ANNOUNCE**: Send message announcing your presence and task
3. **COORDINATE**: Monitor chat for task assignments and updates from architect
4. **EXECUTE**: Work on your specific task using all available MCP tools
5. **REPORT**: Send progress updates and announce completion
6. **COLLABORATE**: Help other agents and respond to coordination requests

💬 CHAT COMMANDS FOR COORDINATION:
- join_room(room_name="{room_name}", agent_name="{agent_name}", agent_id="your_id")
- send_message(room_name="{room_name}", agent_name="{agent_name}", message="your message")
- get_messages(room_name="{room_name}", agent_id="your_id")
- wait_for_messages(room_name="{room_name}", agent_id="your_id")

🚀 START BY:
1. Joining the coordination room
2. Announcing: "🤖 {agent_type.upper()} AGENT online! Task: {task_description[:100]}..."
3. {f"Waiting for dependencies to complete: {', '.join(depends_on)}" if depends_on else "Beginning task execution immediately"}

Begin coordination and task execution now!"""

            try:
                # Spawn actual Claude instance using optimal method based on context
                if _pool_manager:
                    # Use process pool for concurrent spawning
                    claude_result = await _pool_manager.spawn_claude_concurrent(
                        workFolder=repository_path,
                        prompt=claude_prompt,
                        session_id=foundation_session_id if foundation_session_id else None,
                        model="sonnet",
                    )
                else:
                    # Use regular async spawning for single agents
                    claude_result = await spawn_claude_async(
                        workFolder=repository_path,
                        prompt=claude_prompt,
                        session_id=foundation_session_id if foundation_session_id else None,
                        model="sonnet",
                    )

                claude_pid = claude_result.get("pid")
                execution_info = {
                    "claude_pid": claude_pid,
                    "foundation_session_id": foundation_session_id,
                    "coordination_room": room_name,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }

                # Update agent metadata with execution info
                updated_config = parsed_configuration or {}
                updated_config.update({
                    "claude_pid": claude_pid,
                    "coordination_room": room_name,
                    "foundation_session_id": foundation_session_id,
                    "dependencies": depends_on,
                    "task_description": task_description,
                })

                await AgentService.update_agent_status(
                    agent_id=agent_id,
                    status=AgentStatus.ACTIVE if not depends_on else AgentStatus.IDLE,
                    agent_data=updated_config,
                )

                logger.info("Spawned specialized agent",
                           agent_id=agent_id,
                           agent_type=agent_type,
                           claude_pid=claude_pid,
                           room=room_name,
                           task=task_description[:100])

            except Exception as e:
                logger.error("Failed to spawn Claude instance",
                           agent_id=agent_id,
                           error=str(e))
                execution_info = {"error": f"Claude spawn failed: {e!s}"}

        return {
            "success": True,
            "agent_id": agent_id,
            "agent_type": agent_type,
            "agent_name": agent_name,
            "repository_path": repository_path,
            "task_description": task_description,
            "auto_execute": auto_execute,
            "claude_pid": claude_pid,
            "execution_info": execution_info,
            "dependency_info": dependency_info,
            "coordination_room": coordination_room or f"{agent_type}-{agent_id[:8]}",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        logger.error("Error spawning agent", error=str(e))
        return {"error": {"code": "AGENT_SPAWN_FAILED", "message": str(e)}}


@app.tool(
    name="spawn_agent",
    description="Create and spawn a specialized agent with specific capabilities for executing development tasks with coordination room integration",
    tags={"spawning", "agent-creation", "coordination", "task-execution"}
)
async def spawn_agent(params: SpawnAgentSchema) -> dict[str, Any]:
    """Create a new specialized agent instance with architect-led coordination and actual Claude execution.
        
    Returns:
        Agent information including ID, status, and Claude PID if executed
    """
    return await _spawn_single_agent(
        agent_type=params.agent_type,
        repository_path=params.repository_path,
        task_description=params.task_description,
        capabilities=params.capabilities,
        initial_context="",  # Not in schema, using default
        configuration=params.configuration,
        depends_on=params.depends_on,
        foundation_session_id=params.foundation_session_id or "",
        auto_execute=True,  # Not in schema, using default
        coordination_room="",  # Not in schema, using default
    )


@app.tool(
    name="spawn_agents_batch",
    description="Spawn multiple specialized agents in parallel for improved performance when creating teams of agents for complex projects",
    tags={"spawning", "batch-operations", "parallel-processing", "agent-creation", "coordination"}
)
async def spawn_agents_batch(
    agents: str | list[dict[str, Any]],
    repository_path: str,
    foundation_session_id: str = "",
    coordination_room: str = "",
    max_concurrent: int = 5,
) -> dict[str, Any]:
    """Spawn multiple agents in parallel for improved performance.
    
    Args:
        agents: List of agent definitions. Each agent should have: agent_type, task_description, 
                and optionally: capabilities, initial_context, configuration, depends_on, auto_execute
        repository_path: Repository path for all agents
        foundation_session_id: Shared session ID for cost reduction
        coordination_room: Shared coordination room for all agents
        max_concurrent: Maximum number of agents to spawn simultaneously
        
    Returns:
        Batch spawning result with all agent information
    """
    try:
        # Parse agents from JSON if needed
        if isinstance(agents, str):
            try:
                parsed_agents = parse_ai_json(agents)
                if isinstance(parsed_agents, list):
                    agents = parsed_agents
                else:
                    return {"error": {"code": "INVALID_AGENTS_FORMAT",
                                   "message": "agents must be a JSON array of agent definitions"}}
            except (ValueError, TypeError) as e:
                return {"error": {"code": "INVALID_AGENTS_JSON", "message": str(e)}}

        # Validate agent definitions
        for i, agent_def in enumerate(agents):
            if not all(key in agent_def for key in ["agent_type", "task_description"]):
                return {"error": {"code": "INVALID_AGENT_DEFINITION",
                               "message": f"Agent {i} missing required fields: agent_type, task_description"}}

        # Create semaphore to limit concurrent spawning
        spawn_semaphore = asyncio.Semaphore(max_concurrent)

        # Use process pool for concurrent Claude spawning
        async with ProcessPoolManager(max_workers=max_concurrent) as pool_manager:
            async def spawn_with_semaphore(agent_def: dict[str, Any], index: int) -> dict[str, Any]:
                """Spawn a single agent with concurrency control and process pooling."""
                async with spawn_semaphore:
                    try:
                        # Pass the pool manager to the spawn function
                        result = await _spawn_single_agent(
                            agent_type=agent_def["agent_type"],
                            repository_path=repository_path,
                            task_description=agent_def["task_description"],
                            capabilities=agent_def.get("capabilities", []),
                            initial_context=agent_def.get("initial_context", ""),
                            configuration=agent_def.get("configuration"),
                            depends_on=agent_def.get("depends_on", []),
                            foundation_session_id=foundation_session_id,
                            auto_execute=agent_def.get("auto_execute", True),
                            coordination_room=coordination_room or f"batch-{index}",
                            _pool_manager=pool_manager,  # Pass pool manager for concurrent spawning
                        )
                        return {"index": index, "result": result, "success": True}
                    except Exception as e:
                        return {"index": index, "error": str(e), "success": False}

            # Spawn all agents in parallel using asyncio.gather
            logger.info("Starting parallel agent spawning",
                       agent_count=len(agents),
                       max_concurrent=max_concurrent,
                       repository_path=repository_path)

            spawn_tasks = [spawn_with_semaphore(agent_def, i) for i, agent_def in enumerate(agents)]
            spawn_results = await asyncio.gather(*spawn_tasks, return_exceptions=True)

        # Process results
        successful_agents = []
        failed_agents = []

        for result in spawn_results:
            if isinstance(result, Exception):
                failed_agents.append({"error": str(result), "success": False})
            elif isinstance(result, dict) and result.get("success"):
                successful_agents.append(result["result"])
            else:
                failed_agents.append(result if isinstance(result, dict) else {"error": str(result), "success": False})

        logger.info("Parallel agent spawning completed",
                   successful=len(successful_agents),
                   failed=len(failed_agents),
                   total=len(agents))

        return {
            "success": True,
            "total_agents": len(agents),
            "successful_agents": len(successful_agents),
            "failed_agents": len(failed_agents),
            "agents": successful_agents,
            "failures": failed_agents,
            "repository_path": repository_path,
            "foundation_session_id": foundation_session_id,
            "coordination_room": coordination_room,
            "max_concurrent": max_concurrent,
            "spawned_at": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        logger.error("Error in batch agent spawning", error=str(e))
        return {"error": {"code": "BATCH_SPAWN_FAILED", "message": str(e)}}


@app.tool(
    name="list_agents",
    description="List and filter active agents by repository, status, or type to monitor current agent workforce and availability",
    tags={"agent-management", "monitoring", "filtering", "status-checking"}
)
async def list_agents(
    repository_path: str | None = None,
    status_filter: list[str] | None = None,
    agent_type: str | None = None,
) -> dict[str, Any]:
    """List all active agents, optionally filtered by repository or status.
    
    Args:
        repository_path: Filter by repository path (optional)
        status_filter: Filter by agent status (optional)
        agent_type: Filter by agent type (optional)
        
    Returns:
        List of agents with their information
    """
    try:
        # Convert string status values to AgentStatus enums if provided
        status_enum_filter = None
        if status_filter:
            status_enum_filter = [AgentStatus(status) for status in status_filter]
        else:
            status_enum_filter = [AgentStatus.ACTIVE, AgentStatus.IDLE]

        result = await AgentService.list_agents(
            repository_path=repository_path,
            status_filter=status_enum_filter,
            agent_type=agent_type,
        )
        return result

    except Exception as e:
        logger.error("Error listing agents", error=str(e))
        return {"error": {"code": "AGENT_LIST_FAILED", "message": str(e)}}


@app.tool(
    name="get_agent_status",
    description="Get detailed status information for a specific agent including current state, assigned tasks, and performance metrics",
    tags={"orchestration", "agent-management", "monitoring"}
)
async def get_agent_status(agent_id: str) -> dict[str, Any]:
    """Get detailed status information for a specific agent.
    
    Args:
        agent_id: UUID of the agent
        
    Returns:
        Agent status information
    """
    try:
        result = await AgentService.get_agent_by_id(agent_id)
        if result is None:
            return {"error": {"code": "AGENT_NOT_FOUND", "message": f"Agent {agent_id} not found"}}

        return result

    except Exception as e:
        logger.error("Error getting agent status", error=str(e))
        return {"error": {"code": "AGENT_STATUS_FAILED", "message": str(e)}}


@app.tool(
    name="terminate_agent",
    description="Gracefully terminate an agent instance, with options for forced termination and cleanup",
    tags={"orchestration", "agent-management", "lifecycle"}
)
async def terminate_agent(
    agent_id: str,
    reason: str = "manual_termination",
    force: bool = False,
) -> dict[str, Any]:
    """Gracefully terminate an agent instance.
    
    Args:
        agent_id: UUID of the agent to terminate
        reason: Reason for termination (optional)
        force: Force termination without waiting for current task
        
    Returns:
        Termination result
    """
    try:
        success = await AgentService.terminate_agent(agent_id)
        if not success:
            return {"error": {"code": "AGENT_NOT_FOUND", "message": f"Agent {agent_id} not found"}}

        return {
            "success": True,
            "agent_id": agent_id,
            "reason": reason,
            "force": force,
        }

    except Exception as e:
        logger.error("Error terminating agent", error=str(e))
        return {"error": {"code": "AGENT_TERMINATION_FAILED", "message": str(e)}}


# =============================================================================
# TASK ORCHESTRATION TOOLS
# =============================================================================

@app.tool(
    name="create_task",
    description="Create a new orchestrated development task with requirements, dependencies, and priority settings",
    tags={"orchestration", "task-management", "creation"}
)
async def create_task(
    repository_path: str,
    task_type: str,
    title: str,
    description: str,
    requirements: str | dict[str, Any] | None = None,
    priority: int = 0,
    parent_task_id: str | None = None,
    dependencies: list[str] | None = None,
) -> dict[str, Any]:
    """Create a new orchestrated development task.
    
    Args:
        repository_path: Absolute path to the repository
        task_type: Type of development task
        title: Brief title for the task
        description: Detailed task description
        requirements: Structured requirements and constraints (can be dict or JSON string)
        priority: Task priority (higher = more urgent)
        parent_task_id: Parent task UUID for subtasks
        dependencies: Array of task IDs this depends on
        
    Returns:
        Task creation result
    """
    # TaskService is always available (static methods)

    try:
        # Parse requirements using AI-tolerant parser
        try:
            parsed_requirements = parse_ai_json(requirements)
        except ValueError as e:
            return {"error": {"code": "INVALID_REQUIREMENTS", "message": str(e)}}

        result = await TaskService.create_task(
            repository_path=repository_path,
            task_type=task_type,
            title=title,
            description=description,
            requirements=parsed_requirements,
            priority=priority,
            parent_task_id=parent_task_id,
            dependencies=dependencies,
        )
        return result

    except Exception as e:
        logger.error("Error creating task", error=str(e))
        return {"error": {"code": "TASK_CREATION_FAILED", "message": str(e)}}


@app.tool(
    name="assign_task",
    description="Assign a specific task to an available agent for execution",
    tags={"orchestration", "task-management", "assignment"}
)
async def assign_task(task_id: str, agent_id: str) -> dict[str, Any]:
    """Assign a task to a specific agent.
    
    Args:
        task_id: UUID of the task to assign
        agent_id: UUID of the agent to assign to
        
    Returns:
        Assignment result
    """
    # TaskService is always available (static methods)

    try:
        success = await TaskService.assign_task(task_id, agent_id)
        if success:
            return {
                "success": True,
                "task_id": task_id,
                "agent_id": agent_id,
                "message": "Task assigned successfully",
            }
        return {"error": {"code": "TASK_ASSIGNMENT_FAILED", "message": "Failed to assign task"}}

    except Exception as e:
        logger.error("Error assigning task", error=str(e))
        return {"error": {"code": "TASK_ASSIGNMENT_FAILED", "message": str(e)}}


@app.tool(
    name="get_task_status",
    description="Get detailed status information for a specific task including progress, assigned agent, and execution details",
    tags={"orchestration", "task-management", "monitoring"}
)
async def get_task_status(task_id: str) -> dict[str, Any]:
    """Get detailed status information for a task.
    
    Args:
        task_id: UUID of the task
        
    Returns:
        Task status information
    """
    # TaskService is always available (static methods)

    try:
        result = await TaskService.get_task_by_id(task_id)
        if result is None:
            return {"error": {"code": "TASK_NOT_FOUND", "message": f"Task {task_id} not found"}}

        return result

    except Exception as e:
        logger.error("Error getting task status", error=str(e))
        return {"error": {"code": "TASK_STATUS_FAILED", "message": str(e)}}


@app.tool(
    name="list_tasks",
    description="List tasks with filtering by repository, status, and pagination for task management overview",
    tags={"orchestration", "task-management", "listing"}
)
async def list_tasks(
    repository_path: str | None = None,
    status_filter: list[str] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """List tasks with filtering and pagination.
    
    Args:
        repository_path: Filter by repository
        status_filter: Filter by task status
        limit: Maximum number of results
        
    Returns:
        List of tasks with pagination info
    """
    # TaskService is always available (static methods)

    try:
        # Convert string status values to TaskStatus enums if provided
        status_enum_filter = None
        if status_filter:
            status_enum_filter = [TaskStatus(status) for status in status_filter]

        result = await TaskService.list_tasks(
            repository_path=repository_path,
            status_filter=status_enum_filter,
            limit=limit,
        )
        return result

    except Exception as e:
        logger.error("Error listing tasks", error=str(e))
        return {"error": {"code": "TASK_LIST_FAILED", "message": str(e)}}


# =============================================================================
# BATCH TASK OPERATIONS TOOLS
# =============================================================================

@app.tool(
    name="create_task_batch",
    description="Create multiple tasks in a single operation for efficient batch processing and workflow setup",
    tags={"orchestration", "task-management", "batch-operations"}
)
async def create_task_batch(
    tasks: str | list[dict[str, Any]],
    repository_path: str,
) -> dict[str, Any]:
    """Create multiple tasks in a single operation.
    
    Args:
        tasks: List of task definitions. Each task should have: task_type, title, 
               description, and optionally: requirements, priority, parent_task_id, dependencies
        repository_path: Repository path for all tasks
        
    Returns:
        Batch creation result with all created task IDs
    """
    try:
        # Parse tasks from JSON if needed
        if isinstance(tasks, str):
            try:
                parsed_tasks = parse_ai_json(tasks)
                if isinstance(parsed_tasks, list):
                    tasks = parsed_tasks
                else:
                    return {"error": {"code": "INVALID_TASKS_FORMAT",
                                   "message": "tasks must be a JSON array of task definitions"}}
            except (ValueError, TypeError) as e:
                return {"error": {"code": "INVALID_TASKS_JSON", "message": str(e)}}

        # Validate task definitions
        for i, task_def in enumerate(tasks):
            if not all(key in task_def for key in ["task_type", "title", "description"]):
                return {"error": {"code": "INVALID_TASK_DEFINITION",
                               "message": f"Task {i} missing required fields: task_type, title, description"}}

        result = await TaskService.create_task_batch(tasks, repository_path)
        return result

    except Exception as e:
        logger.error("Error creating task batch", error=str(e))
        return {"error": {"code": "BATCH_CREATION_FAILED", "message": str(e)}}


@app.tool(
    name="create_workflow",
    description="Create a complete workflow with multiple interconnected tasks supporting sequential, parallel, or custom dependency patterns",
    tags={"orchestration", "workflow-management", "coordination"}
)
async def create_workflow(
    workflow_name: str,
    repository_path: str,
    workflow_steps: str | list[dict[str, Any]],
    workflow_type: str = "sequential",
) -> dict[str, Any]:
    """Create a complete workflow with multiple interconnected tasks.
    
    Args:
        workflow_name: Name/title of the workflow
        repository_path: Repository path
        workflow_steps: List of workflow steps with task definitions
        workflow_type: "sequential" (tasks run in order), "parallel" (tasks run simultaneously), 
                      or "custom" (custom dependencies defined in steps)
        
    Returns:
        Workflow creation result with workflow ID and all task IDs
    """
    try:
        if workflow_type not in ["sequential", "parallel", "custom"]:
            return {"error": {"code": "INVALID_WORKFLOW_TYPE",
                           "message": "workflow_type must be 'sequential', 'parallel', or 'custom'"}}

        # Parse workflow_steps from JSON if needed
        if isinstance(workflow_steps, str):
            try:
                parsed_steps = parse_ai_json(workflow_steps)
                if isinstance(parsed_steps, list):
                    workflow_steps = parsed_steps
                else:
                    return {"error": {"code": "INVALID_WORKFLOW_STEPS_FORMAT",
                                   "message": "workflow_steps must be a JSON array of step definitions"}}
            except (ValueError, TypeError) as e:
                return {"error": {"code": "INVALID_WORKFLOW_STEPS_JSON", "message": str(e)}}

        # Validate workflow steps
        for i, step in enumerate(workflow_steps):
            if not all(key in step for key in ["title", "description"]):
                return {"error": {"code": "INVALID_STEP_DEFINITION",
                               "message": f"Step {i} missing required fields: title, description"}}

        result = await TaskService.create_workflow(
            workflow_name=workflow_name,
            repository_path=repository_path,
            workflow_steps=workflow_steps,
            workflow_type=workflow_type,
        )
        return result

    except Exception as e:
        logger.error("Error creating workflow", error=str(e))
        return {"error": {"code": "WORKFLOW_CREATION_FAILED", "message": str(e)}}


@app.tool(
    name="split_task",
    description="Split a large task into multiple smaller subtasks for better parallelization and management",
    tags={"orchestration", "task-management", "decomposition"}
)
async def split_task(
    parent_task_id: str,
    subtask_definitions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Split a large task into multiple smaller subtasks.
    
    Args:
        parent_task_id: ID of the task to split
        subtask_definitions: List of subtask definitions with title, description, and optionally
                           task_type, requirements, priority, dependencies
        
    Returns:
        Task splitting result with all created subtask IDs
    """
    try:
        # Validate subtask definitions
        for i, subtask_def in enumerate(subtask_definitions):
            if not all(key in subtask_def for key in ["title", "description"]):
                return {"error": {"code": "INVALID_SUBTASK_DEFINITION",
                               "message": f"Subtask {i} missing required fields: title, description"}}

        result = await TaskService.split_task(parent_task_id, subtask_definitions)
        return result

    except Exception as e:
        logger.error("Error splitting task", error=str(e))
        return {"error": {"code": "TASK_SPLIT_FAILED", "message": str(e)}}


@app.tool(
    name="assign_tasks_bulk",
    description="Assign multiple tasks to agents in a single operation for efficient batch assignment",
    tags={"orchestration", "task-management", "batch-operations"}
)
async def assign_tasks_bulk(
    task_assignments: str | list[dict[str, str]],
) -> dict[str, Any]:
    """Assign multiple tasks to agents in a single operation.
    
    Args:
        task_assignments: List of assignments, each with 'task_id' and 'agent_id' keys
        
    Returns:
        Bulk assignment result with success/failure details for each assignment
    """
    try:
        # Parse task_assignments from JSON if needed
        if isinstance(task_assignments, str):
            try:
                parsed_assignments = parse_ai_json(task_assignments)
                if isinstance(parsed_assignments, list):
                    task_assignments = parsed_assignments
                else:
                    return {"error": {"code": "INVALID_ASSIGNMENTS_FORMAT",
                                   "message": "task_assignments must be a JSON array of assignment objects"}}
            except (ValueError, TypeError) as e:
                return {"error": {"code": "INVALID_ASSIGNMENTS_JSON", "message": str(e)}}

        # Validate assignments
        for i, assignment in enumerate(task_assignments):
            if not all(key in assignment for key in ["task_id", "agent_id"]):
                return {"error": {"code": "INVALID_ASSIGNMENT",
                               "message": f"Assignment {i} missing required fields: task_id, agent_id"}}

        result = await TaskService.assign_tasks_bulk(task_assignments)
        return result

    except Exception as e:
        logger.error("Error in bulk task assignment", error=str(e))
        return {"error": {"code": "BULK_ASSIGNMENT_FAILED", "message": str(e)}}


@app.tool(
    name="auto_assign_tasks",
    description="Automatically assign pending tasks to available agents based on capabilities and workload balancing",
    tags={"orchestration", "task-management", "automation", "load-balancing"}
)
async def auto_assign_tasks(
    repository_path: str,
    agent_capabilities: dict[str, list[str]] | None = None,
    max_tasks_per_agent: int = 3,
) -> dict[str, Any]:
    """Automatically assign pending tasks to available agents based on capabilities and workload.
    
    Args:
        repository_path: Repository to assign tasks for
        agent_capabilities: Optional mapping of agent_id to list of capabilities
        max_tasks_per_agent: Maximum tasks to assign per agent
        
    Returns:
        Auto-assignment result with details of all assignments made
    """
    try:
        # Parse agent capabilities using AI-tolerant parser if provided
        parsed_capabilities = None
        if agent_capabilities:
            try:
                parsed_capabilities = parse_ai_json(agent_capabilities)
            except ValueError as e:
                return {"error": {"code": "INVALID_CAPABILITIES", "message": str(e)}}

        result = await TaskService.auto_assign_tasks(
            repository_path=repository_path,
            agent_capabilities=parsed_capabilities,
            max_tasks_per_agent=max_tasks_per_agent,
        )
        return result

    except Exception as e:
        logger.error("Error in auto task assignment", error=str(e))
        return {"error": {"code": "AUTO_ASSIGNMENT_FAILED", "message": str(e)}}


@app.tool(
    name="auto_assign_tasks_parallel",
    description="Automatically assign pending tasks using parallel processing for improved performance with large task volumes",
    tags={"orchestration", "task-management", "automation", "performance"}
)
async def auto_assign_tasks_parallel(
    repository_path: str,
    agent_capabilities: dict[str, list[str]] | None = None,
    max_tasks_per_agent: int = 3,
    batch_size: int = 10,
) -> dict[str, Any]:
    """Automatically assign pending tasks to available agents using parallel processing for improved performance.
    
    This is an optimized version of auto_assign_tasks that processes tasks in parallel batches,
    significantly improving performance when assigning large numbers of tasks.
    
    Args:
        repository_path: Repository to assign tasks for
        agent_capabilities: Optional mapping of agent_id to list of capabilities
        max_tasks_per_agent: Maximum tasks to assign per agent
        batch_size: Number of tasks to process in each parallel batch (default: 10)
        
    Returns:
        Auto-assignment result with details of all assignments made and performance metrics
    """
    try:
        # Parse agent capabilities using AI-tolerant parser if provided
        parsed_capabilities = None
        if agent_capabilities:
            try:
                parsed_capabilities = parse_ai_json(agent_capabilities)
            except ValueError as e:
                return {"error": {"code": "INVALID_CAPABILITIES", "message": str(e)}}

        result = await TaskService.auto_assign_tasks_parallel(
            repository_path=repository_path,
            agent_capabilities=parsed_capabilities,
            max_tasks_per_agent=max_tasks_per_agent,
            batch_size=batch_size,
        )
        return result

    except Exception as e:
        logger.error("Error in parallel auto task assignment", error=str(e))
        return {"error": {"code": "PARALLEL_AUTO_ASSIGNMENT_FAILED", "message": str(e)}}


@app.tool(
    name="balance_workload",
    description="Rebalance task assignments to distribute workload evenly across agents for optimal resource utilization",
    tags={"orchestration", "load-balancing", "optimization"}
)
async def balance_workload(
    repository_path: str,
    target_tasks_per_agent: int = 2,
) -> dict[str, Any]:
    """Rebalance task assignments to distribute workload evenly across agents.
    
    Args:
        repository_path: Repository to balance workload for
        target_tasks_per_agent: Target number of tasks per agent
        
    Returns:
        Workload balancing result with details of task reassignments
    """
    try:
        result = await TaskService.balance_workload(
            repository_path=repository_path,
            target_tasks_per_agent=target_tasks_per_agent,
        )
        return result

    except Exception as e:
        logger.error("Error balancing workload", error=str(e))
        return {"error": {"code": "WORKLOAD_BALANCE_FAILED", "message": str(e)}}


@app.tool(
    name="get_agent_workload",
    description="Get current workload information for agents including task counts and capacity analysis",
    tags={"orchestration", "monitoring", "load-balancing"}
)
async def get_agent_workload(
    repository_path: str,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """Get current workload information for agents.
    
    Args:
        repository_path: Repository to check workloads for
        agent_id: Optional specific agent ID, if None returns all agents
        
    Returns:
        Workload information including task counts and assignments
    """
    try:
        from sqlalchemy import and_, func, select

        from .models import Task, TaskStatus

        async def _get_workload(session):
            # Get agent information
            if agent_id:
                from .services.agent_service import AgentService
                agent_info = await AgentService.get_agent_by_id(agent_id)
                if not agent_info:
                    return {"error": {"code": "AGENT_NOT_FOUND", "message": "Agent not found"}}
                agents = [agent_info]
            else:
                from .services.agent_service import AgentService
                agents_result = await AgentService.list_agents(repository_path=repository_path)
                agents = agents_result.get("agents", [])

            workload_info = []

            for agent in agents:
                # Count tasks by status
                active_count_stmt = select(func.count(Task.id)).where(
                    and_(
                        Task.assigned_agent_id == agent["id"],
                        Task.status == TaskStatus.IN_PROGRESS,
                    ),
                )
                active_result = await session.execute(active_count_stmt)
                active_count = active_result.scalar() or 0

                pending_count_stmt = select(func.count(Task.id)).where(
                    and_(
                        Task.assigned_agent_id == agent["id"],
                        Task.status == TaskStatus.PENDING,
                    ),
                )
                pending_result = await session.execute(pending_count_stmt)
                pending_count = pending_result.scalar() or 0

                completed_count_stmt = select(func.count(Task.id)).where(
                    and_(
                        Task.assigned_agent_id == agent["id"],
                        Task.status == TaskStatus.COMPLETED,
                    ),
                )
                completed_result = await session.execute(completed_count_stmt)
                completed_count = completed_result.scalar() or 0

                workload_info.append({
                    "agent_id": agent["id"],
                    "agent_name": agent.get("name", "Unknown"),
                    "agent_status": agent.get("status", "unknown"),
                    "task_counts": {
                        "active": active_count,
                        "pending": pending_count,
                        "completed": completed_count,
                        "total": active_count + pending_count + completed_count,
                    },
                    "workload_level": "high" if active_count >= 3 else "medium" if active_count >= 2 else "low",
                })

            return {
                "success": True,
                "repository_path": repository_path,
                "agent_workloads": workload_info,
                "total_agents": len(workload_info),
            }

        from .database import execute_query
        result = await execute_query(_get_workload)
        return result

    except Exception as e:
        logger.error("Error getting agent workload", error=str(e))
        return {"error": {"code": "WORKLOAD_CHECK_FAILED", "message": str(e)}}


# =============================================================================
# COMMUNICATION SYSTEM TOOLS
# =============================================================================

@app.tool(
    name="join_room",
    description="Join an agent communication room for multi-agent coordination and message exchange",
    tags={"communication", "multi-agent", "coordination"}
)
async def join_room(
    room_name: str,
    agent_name: str,
    agent_id: str,
) -> dict[str, Any]:
    """Join an agent communication room.
    
    Args:
        room_name: Name of the room to join
        agent_name: Display name for the agent
        agent_id: UUID of the agent
        
    Returns:
        Join result with room info and recent messages
    """
    # CommunicationService is always available (static methods)

    try:
        result = await CommunicationService.join_room(
            room_name=room_name,
            agent_name=agent_name,
            agent_id=agent_id,
        )
        return result

    except Exception as e:
        logger.error("Error joining room", error=str(e))
        return {"error": {"code": "ROOM_JOIN_FAILED", "message": str(e)}}


@app.tool(
    name="leave_room",
    description="Leave an agent communication room and stop receiving messages from that room",
    tags={"communication", "multi-agent", "coordination"}
)
async def leave_room(
    room_name: str,
    agent_id: str,
    agent_name: str | None = None,
) -> dict[str, Any]:
    """Leave an agent communication room.
    
    Args:
        room_name: Name of the room to leave
        agent_id: UUID of the agent
        agent_name: Agent display name
        
    Returns:
        Leave result
    """
    # CommunicationService is always available (static methods)

    try:
        result = await CommunicationService.leave_room(
            room_name=room_name,
            agent_name=agent_name or "unknown",
            agent_id=agent_id,
        )
        return result

    except Exception as e:
        logger.error("Error leaving room", error=str(e))
        return {"error": {"code": "ROOM_LEAVE_FAILED", "message": str(e)}}


@app.tool(
    name="send_message",
    description="Send a message to a room or specific agents with support for mentions, replies, and task references",
    tags={"communication", "multi-agent", "messaging"}
)
async def send_message(
    room_name: str,
    agent_id: str,
    agent_name: str,
    message: str,
    mentions: list[str] | None = None,
    message_type: str = "standard",
    reply_to_message_id: str | None = None,
    task_id: str | None = None,
) -> dict[str, Any]:
    """Send a message to a room or specific agents.
    
    Args:
        room_name: Name of the target room
        agent_id: UUID of the sending agent
        agent_name: Name of the sending agent
        message: Message content
        mentions: Array of agent names to mention
        message_type: Type of message
        reply_to_message_id: Message ID being replied to
        task_id: Associated task ID
        
    Returns:
        Send result with message ID and delivery info
    """
    # CommunicationService is always available (static methods)

    try:
        result = await CommunicationService.send_message(
            room_name=room_name,
            agent_name=agent_name,
            message=message,
            mentions=mentions,
            message_type=message_type,
            reply_to_message_id=reply_to_message_id,
            task_id=task_id,
        )
        return result

    except Exception as e:
        logger.error("Error sending message", error=str(e))
        return {"error": {"code": "MESSAGE_SEND_FAILED", "message": str(e)}}


@app.tool(
    name="broadcast_message",
    description="Broadcast a message to multiple rooms concurrently for efficient multi-agent coordination announcements",
    tags={"communication", "multi-agent", "broadcasting"}
)
async def broadcast_message(
    rooms: list[str],
    agent_name: str,
    agent_id: str,
    message: str,
    message_type: str = "broadcast",
) -> dict[str, Any]:
    """Broadcast a message to multiple rooms concurrently for efficient multi-agent coordination.
    
    Args:
        rooms: List of room names to broadcast to
        agent_name: Name of the broadcasting agent
        agent_id: ID of the broadcasting agent
        message: Message content to broadcast
        message_type: Type of message being broadcast (default: "broadcast")
        
    Returns:
        Results of all broadcast operations with success/failure details
    """
    try:
        result = await CommunicationService.broadcast_to_multiple_rooms(
            rooms=rooms,
            agent_name=agent_name,
            agent_id=agent_id,
            message=message,
            message_type=message_type,
        )
        return result

    except Exception as e:
        logger.error("Error broadcasting message", error=str(e))
        return {"error": {"code": "BROADCAST_FAILED", "message": str(e)}}


@app.tool(
    name="get_messages",
    description="Retrieve messages from a room with filtering by time, type, and pagination for message history access",
    tags={"communication", "multi-agent", "message-retrieval"}
)
async def get_messages(
    room_name: str,
    agent_id: str,
    limit: int = 50,
    before_message_id: str | None = None,
    since_timestamp: str | None = None,
    message_type_filter: list[str] | None = None,
) -> dict[str, Any]:
    """Retrieve messages from a room with filtering.
    
    Args:
        room_name: Name of the room
        agent_id: UUID of the requesting agent
        limit: Maximum number of messages
        before_message_id: Get messages before this ID
        since_timestamp: Get messages since this timestamp
        message_type_filter: Filter by message types
        
    Returns:
        Messages with pagination info
    """
    # CommunicationService is always available (static methods)

    try:
        result = await CommunicationService.get_messages(
            room_name=room_name,
            limit=limit,
            before_message_id=before_message_id,
            since_timestamp=since_timestamp,
            message_type_filter=message_type_filter,
        )
        return result

    except Exception as e:
        logger.error("Error getting messages", error=str(e))
        return {"error": {"code": "MESSAGE_GET_FAILED", "message": str(e)}}


@app.tool(
    name="wait_for_messages",
    description="Long-polling wait for new messages in a room with timeout for real-time message processing",
    tags={"communication", "multi-agent", "real-time"}
)
async def wait_for_messages(
    room_name: str,
    agent_id: str,
    timeout: int = 30,
    since_message_id: str | None = None,
) -> dict[str, Any]:
    """Long-polling wait for new messages in a room.
    
    Args:
        room_name: Name of the room to monitor
        agent_id: UUID of the waiting agent
        timeout: Maximum wait time in seconds
        since_message_id: Get messages after this ID
        
    Returns:
        New messages or timeout indication
    """
    # CommunicationService is always available (static methods)

    try:
        result = await CommunicationService.wait_for_messages(
            room_name=room_name,
            timeout=timeout,
            since_message_id=since_message_id,
        )
        return result

    except Exception as e:
        logger.error("Error waiting for messages", error=str(e))
        return {"error": {"code": "MESSAGE_WAIT_FAILED", "message": str(e)}}


# =============================================================================
# SYSTEM MONITORING TOOLS
# =============================================================================

@app.tool(
    name="get_system_status",
    description="Get overall system health and performance metrics including agent status, task queues, and resource usage",
    tags={"monitoring", "system-health", "performance"}
)
async def get_system_status(
    repository_path: str | None = None,
) -> dict[str, Any]:
    """Get overall system health and performance metrics.
    
    Args:
        repository_path: Filter by repository (optional)
        
    Returns:
        System status and metrics
    """
    try:
        # Get basic status from services
        agents = await AgentService.list_agents(repository_path)
        tasks = await TaskService.list_tasks(repository_path, limit=1000)

        active_agents = len([a for a in agents.get("agents", []) if a.get("status") == "active"])
        pending_tasks = len([t for t in tasks.get("tasks", []) if t.get("status") == "pending"])

        # Calculate database and storage metrics
        try:
            from .services.cleanup_service import CleanupService
            storage_info = await CleanupService.analyze_storage_usage()
            database_size_mb = storage_info.get("breakdown", {}).get("database_mb", 0.0)
            total_disk_usage_mb = storage_info.get("total_size_mb", 0.0)
        except Exception:
            database_size_mb = 0.0
            total_disk_usage_mb = 0.0

        # Calculate uptime from server start time (stored globally)
        uptime_seconds = 0
        try:
            # Use a global variable instead of function attribute
            global _server_start_time
            if "_server_start_time" in globals():
                uptime_seconds = int((datetime.now(timezone.utc) - _server_start_time).total_seconds())
        except Exception:
            pass

        # Calculate task metrics from database
        task_success_rate = 0.0
        avg_completion_time = 0
        try:
            from sqlalchemy import func, select

            from .database import get_session
            from .models import Task

            async for session in get_session():
                # Calculate task success rate
                completed_count = await session.scalar(
                    select(func.count(Task.id)).where(Task.status == "completed"),
                )
                failed_count = await session.scalar(
                    select(func.count(Task.id)).where(Task.status == "failed"),
                )
                total_finished = (completed_count or 0) + (failed_count or 0)
                if total_finished > 0:
                    task_success_rate = round((completed_count or 0) / total_finished * 100, 1)

                # Calculate average completion time for completed tasks
                # This would require tracking completion timestamps in the Task model
                # For now, we'll leave this as a placeholder
                avg_completion_time = 0
                break  # Only need one iteration for the session
        except Exception:
            pass

        # Basic resource monitoring (lightweight)
        cpu_percent = 0.0
        memory_mb = 0.0
        try:
            import psutil
            process = psutil.Process()
            cpu_percent = round(process.cpu_percent(), 1)
            memory_mb = round(process.memory_info().rss / (1024 * 1024), 1)
        except ImportError:
            # psutil not available, use placeholder values
            pass
        except Exception:
            # Error getting process info, use placeholder values
            pass

        # Basic health assessment
        health_status = "healthy"
        if active_agents > 10:
            health_status = "degraded"
        elif database_size_mb > 1000:  # Over 1GB
            health_status = "warning"

        return {
            "system_health": {
                "status": health_status,
                "active_agents": active_agents,
                "pending_tasks": pending_tasks,
                "database_size_mb": database_size_mb,
                "uptime_seconds": uptime_seconds,
            },
            "performance_metrics": {
                "avg_task_completion_time": avg_completion_time,
                "task_success_rate": task_success_rate,
                "messages_per_minute": 0.0,  # Would require real-time tracking
                "agent_spawn_rate": 0.0,      # Would require real-time tracking
            },
            "resource_usage": {
                "cpu_percent": cpu_percent,
                "memory_mb": memory_mb,
                "disk_usage_mb": total_disk_usage_mb,
            },
        }

    except Exception as e:
        logger.error("Error getting system status", error=str(e))
        return {"error": {"code": "SYSTEM_STATUS_FAILED", "message": str(e)}}

# Initialize server start time for uptime tracking (global variable)
_server_start_time = datetime.now(timezone.utc)


# =============================================================================
# AGENTTREEGRAPH ANALYSIS TOOLS
# =============================================================================

@app.tool(
    name="analyze_project_structure",
    description="Analyze entire project structure and generate .treesummary with optional real-time file watching for code analysis",
    tags={"analysis", "project-structure", "code-intelligence"}
)
async def analyze_project_structure(
    project_path: str,
    enable_watching: bool = True,
) -> dict[str, Any]:
    """Analyze entire project structure and generate .treesummary with optional real-time updates.
    
    Args:
        project_path: Absolute path to project root
        enable_watching: Enable real-time file watching for updates
        
    Returns:
        Analysis summary with file counts, languages detected, and .treesummary location
    """
    # AgentService and TaskService are always available as static methods

    try:
        # Initialize analysis components
        analyzer = FileAnalyzer()
        summary_manager = TreeSummaryManager(project_path)

        # Scan project files
        project_files = []
        project_root = Path(project_path)

        # Simple file discovery (basic implementation)
        for file_path in project_root.rglob("*"):
            if file_path.is_file() and analyzer.detect_language(str(file_path)):
                project_files.append(file_path)

        logger.info("Found files to analyze", count=len(project_files), project_path=project_path)

        # Analyze files in batches
        analyzed_count = 0
        for file_path in project_files[:100]:  # Limit for initial implementation
            analysis = await analyzer.analyze_file(str(file_path))
            if analysis:
                success = await summary_manager.update_file_analysis(str(file_path), analysis)
                if success:
                    analyzed_count += 1

        # Generate project summary
        await summary_manager.update_project_metadata()
        project_overview = await summary_manager.get_project_overview()

        # Setup file watching if requested
        if enable_watching:
            hook = TreeSummaryHook(project_path)
            success = hook.start_watching()
            if success:
                analysis_hooks[project_path] = hook
                logger.info("Enabled real-time watching", project_path=project_path)

        return {
            "success": True,
            "project_path": project_path,
            "treesummary_path": str(Path(project_path) / ".treesummary"),
            "files_analyzed": analyzed_count,
            "total_files": len(project_files),
            "languages": project_overview.get("languages", {}),
            "watching_enabled": enable_watching and project_path in analysis_hooks,
            "analysis_timestamp": project_overview.get("last_updated"),
        }

    except Exception as e:
        logger.error("Project analysis failed", project_path=project_path, error=str(e))
        return {
            "success": False,
            "error": str(e),
            "project_path": project_path,
        }


@app.tool(
    name="analyze_file_symbols",
    description="Analyze single file for functions, classes, docstrings, and type information with project context integration",
    tags={"analysis", "code-intelligence", "symbols"}
)
async def analyze_file_symbols(
    file_path: str,
    language: str | None = None,
) -> dict[str, Any]:
    """Analyze single file for functions, classes, docstrings, and type information.
    
    Args:
        file_path: Absolute path to file
        language: Optional language hint (auto-detected if not provided)
        
    Returns:
        Detailed symbol analysis including functions, classes, imports, and documentation
    """
    try:
        analyzer = FileAnalyzer()

        # Determine project path for .treesummary update
        project_path = analyzer.find_project_root(file_path)
        if not project_path:
            # Analyze standalone file
            analysis = await analyzer.analyze_file(file_path, language)
            return {
                "success": True,
                "file_path": file_path,
                "analysis": analysis,
                "standalone": True,
            }

        # Analyze file within project context
        analysis = await analyzer.analyze_file(file_path, language)

        if not analysis:
            return {
                "success": False,
                "error": "File analysis failed",
                "file_path": file_path,
            }

        # Update .treesummary if project analysis exists
        summary_manager = TreeSummaryManager(project_path)
        await summary_manager.update_file_analysis(file_path, analysis)

        # Trigger hooks if watching is enabled
        if project_path in analysis_hooks:
            await analysis_hooks[project_path].on_file_modified(file_path)

        return {
            "success": True,
            "file_path": file_path,
            "project_path": project_path,
            "analysis": analysis,
            "treesummary_updated": True,
        }

    except Exception as e:
        logger.error("File analysis failed", file_path=file_path, error=str(e))
        return {
            "success": False,
            "error": str(e),
            "file_path": file_path,
        }


@app.tool(
    name="generate_project_summary",
    description="Generate comprehensive AI-enhanced project summary using analysis results. Use when you need a complete overview of project architecture, patterns, and AI insights.",
    tags={"analysis", "project", "summary", "ai-insights", "architecture"}
)
async def generate_project_summary(
    project_path: str,
    include_ai_insights: bool = True,
) -> dict[str, Any]:
    """Generate comprehensive AI-enhanced project summary using analysis results.
    
    Args:
        project_path: Absolute path to project root
        include_ai_insights: Generate AI insights and recommendations
        
    Returns:
        Comprehensive project summary with architecture analysis and AI insights
    """
    try:
        summary_manager = TreeSummaryManager(project_path)

        # Gather all analysis data
        project_overview = await summary_manager.get_project_overview()

        if "error" in project_overview:
            return {
                "success": False,
                "error": "No project analysis found. Run analyze_project_structure first.",
                "project_path": project_path,
            }

        # Get analyzed files
        analyzed_files = summary_manager.list_analyzed_files()

        # Create comprehensive summary
        summary = {
            "project_path": project_path,
            "overview": project_overview,
            "analyzed_files": analyzed_files[:20],  # Top 20 files
            "file_count": len(analyzed_files),
            "treesummary_location": str(Path(project_path) / ".treesummary"),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        if include_ai_insights:
            # Basic AI insights (can be enhanced with actual LLM integration)
            languages = project_overview.get("languages", {})
            stats = project_overview.get("statistics", {})

            insights = {
                "primary_language": max(languages.items(), key=lambda x: x[1])[0] if languages else "unknown",
                "complexity_assessment": "high" if stats.get("average_complexity", 0) > 7 else "moderate" if stats.get("average_complexity", 0) > 4 else "low",
                "recommendations": [],
                "architecture_notes": f"Project contains {stats.get('total_functions', 0)} functions and {stats.get('total_classes', 0)} classes",
            }

            # Add basic recommendations
            if stats.get("high_complexity_files", 0) > 0:
                insights["recommendations"].append("Consider refactoring high-complexity files")
            if len(analyzed_files) > 100:
                insights["recommendations"].append("Large codebase - consider modularization")

            summary["ai_insights"] = insights

        # Save summary to .treesummary
        summary_file = Path(project_path) / ".treesummary" / "project_summary.json"
        with summary_file.open("w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

        return {
            "success": True,
            "project_path": project_path,
            "summary": summary,
            "summary_file": str(summary_file),
        }

    except Exception as e:
        logger.error("Project summary generation failed", project_path=project_path, error=str(e))
        return {
            "success": False,
            "error": str(e),
            "project_path": project_path,
        }


@app.tool(
    name="detect_dead_code",
    description="Identify unused files, functions, and imports across the project. Use when optimizing codebase or cleaning up redundant code.",
    tags={"analysis", "dead-code", "optimization", "cleanup", "project"}
)
async def detect_dead_code(
    project_path: str,
    confidence_threshold: float = 0.8,
) -> dict[str, Any]:
    """Identify unused files, functions, and imports across the project.
    
    Args:
        project_path: Absolute path to project root
        confidence_threshold: Minimum confidence level for dead code detection (0.0-1.0)
        
    Returns:
        Dead code analysis with unused files, functions, and recommendations
    """
    try:
        summary_manager = TreeSummaryManager(project_path)
        project_overview = await summary_manager.get_project_overview()

        if "error" in project_overview:
            return {
                "success": False,
                "error": "No project analysis found. Run analyze_project_structure first.",
                "project_path": project_path,
            }

        # Basic dead code detection (simplified implementation)
        analyzed_files = summary_manager.list_analyzed_files()
        dead_code_analysis = {
            "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
            "dead_code": [],
            "statistics": {
                "total_unused_files": 0,
                "total_unused_functions": 0,
                "total_unused_classes": 0,
                "total_unused_imports": 0,
                "percentage_dead_code": 0.0,
            },
            "recommendations": [],
        }

        # Simple heuristics for dead code detection
        for file_info in analyzed_files:
            file_path = file_info.get("absolute_path")
            if not file_path:
                continue

            analysis = summary_manager.get_file_analysis(file_path)
            if not analysis:
                continue

            symbols = analysis.get("symbols", {})

            # Check for files with no functions or classes (potential dead code)
            if not symbols.get("functions") and not symbols.get("classes"):
                dead_code_analysis["dead_code"].append({
                    "file": file_path,
                    "type": "unused_file",
                    "name": None,
                    "line": None,
                    "confidence": 0.6,
                    "reason": "File contains no functions or classes",
                    "impact": "low",
                })
                dead_code_analysis["statistics"]["total_unused_files"] += 1

        # Calculate percentage
        total_files = len(analyzed_files)
        if total_files > 0:
            dead_code_analysis["statistics"]["percentage_dead_code"] = (
                dead_code_analysis["statistics"]["total_unused_files"] / total_files * 100
            )

        # Add recommendations
        if dead_code_analysis["statistics"]["total_unused_files"] > 0:
            dead_code_analysis["recommendations"].append({
                "action": "investigate",
                "target": "Files with no functions or classes",
                "reason": "May be configuration files or truly unused",
                "priority": "low",
            })

        # Save dead code analysis
        dead_code_file = Path(project_path) / ".treesummary" / "dead_code.json"
        with dead_code_file.open("w", encoding="utf-8") as f:
            json.dump(dead_code_analysis, f, indent=2, ensure_ascii=False)

        return {
            "success": True,
            "project_path": project_path,
            "dead_code": dead_code_analysis,
            "analysis_file": str(dead_code_file),
            "confidence_threshold": confidence_threshold,
        }

    except Exception as e:
        logger.error("Dead code detection failed", project_path=project_path, error=str(e))
        return {
            "success": False,
            "error": str(e),
            "project_path": project_path,
        }


@app.tool(
    name="update_treesummary_incremental",
    description="Incrementally update .treesummary for single file change. Use when tracking specific file modifications in real-time.",
    tags={"analysis", "incremental", "file-tracking", "treesummary", "updates"}
)
async def update_treesummary_incremental(
    file_path: str,
    change_type: str = "modified",
    project_path: str | None = None,
) -> dict[str, Any]:
    """Incrementally update .treesummary for single file change.
    
    Args:
        file_path: Absolute path to changed file
        change_type: Type of change (modified, created, deleted)
        project_path: Optional project path (auto-detected if not provided)
        
    Returns:
        Update status and affected components
    """
    try:
        # Auto-detect project path if not provided
        if not project_path:
            analyzer = FileAnalyzer()
            project_path = analyzer.find_project_root(file_path)
            if not project_path:
                return {
                    "success": False,
                    "error": "Could not determine project root",
                    "file_path": file_path,
                }

        # Get or create hook for this project
        if project_path not in analysis_hooks:
            analysis_hooks[project_path] = TreeSummaryHook(project_path)

        hook = analysis_hooks[project_path]

        # Handle different change types
        if change_type == "modified":
            await hook.on_file_modified(file_path)
        elif change_type == "created":
            await hook.on_file_created(file_path)
        elif change_type == "deleted":
            await hook.on_file_deleted(file_path)
        else:
            return {
                "success": False,
                "error": f"Unknown change type: {change_type}",
                "file_path": file_path,
            }

        return {
            "success": True,
            "file_path": file_path,
            "project_path": project_path,
            "change_type": change_type,
            "treesummary_updated": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        logger.error("Incremental update failed", file_path=file_path, change_type=change_type, error=str(e))
        return {
            "success": False,
            "error": str(e),
            "file_path": file_path,
            "change_type": change_type,
        }


@app.tool(
    name="watch_project_changes",
    description="Enable or disable real-time .treesummary updates via file watching. Use when you need continuous project monitoring.",
    tags={"analysis", "file-watching", "monitoring", "real-time", "project"}
)
async def watch_project_changes(
    project_path: str,
    enable: bool = True,
) -> dict[str, Any]:
    """Enable or disable real-time .treesummary updates via file watching.
    
    Args:
        project_path: Absolute path to project root
        enable: Enable or disable file watching
        
    Returns:
        Watching status and configuration
    """
    try:
        if enable:
            if project_path not in analysis_hooks:
                hook = TreeSummaryHook(project_path)
                success = hook.start_watching()
                if success:
                    analysis_hooks[project_path] = hook
                    status = "started"
                else:
                    status = "failed_to_start"
            else:
                status = "already_active"
        else:
            if project_path in analysis_hooks:
                analysis_hooks[project_path].stop_watching()
                del analysis_hooks[project_path]
                status = "stopped"
            else:
                status = "not_active"

        return {
            "success": True,
            "project_path": project_path,
            "watching_enabled": enable and project_path in analysis_hooks,
            "status": status,
            "active_watchers": list(analysis_hooks.keys()),
        }

    except Exception as e:
        logger.error("Watch management failed", project_path=project_path, enable=enable, error=str(e))
        return {
            "success": False,
            "error": str(e),
            "project_path": project_path,
            "enable": enable,
        }


# =============================================================================
# DOCUMENTATION MANAGEMENT TOOLS
# =============================================================================

@app.tool(
    name="scrape_documentation",
    description="Scrape documentation from a web source using intelligent crawling. Use when you need to gather external documentation for reference.",
    tags={"documentation", "scraping", "web-crawling", "external-sources", "knowledge"}
)
async def scrape_documentation(params: ScrapeDocumentationSchema) -> dict[str, Any]:
    """Scrape documentation from a web source using intelligent crawling.
    
    Args:
        params: Validated parameters for documentation scraping
        
    Returns:
        Scraping result with statistics and entry IDs
    """
    if not documentation_service:
        return {"error": {"code": "DOCUMENTATION_NOT_INITIALIZED", "message": "Documentation system not initialized"}}

    try:
        # Pydantic schema handles all validation including AI JSON parsing for selectors
        # Add the documentation source if it doesn't exist
        source_result = await DocumentationService.add_documentation_source(
            name=params.source_name,
            url=params.url,
            source_type=params.source_type,
            crawl_depth=params.crawl_depth,
            update_frequency=params.update_frequency,
            selectors=params.selectors,
            ignore_patterns=params.ignore_patterns,
        )

        if not source_result.get("success"):
            return {"error": {"code": "SOURCE_CREATION_FAILED", "message": source_result.get("error", "Unknown error")}}

        source_id = source_result["source_id"]

        # Start scraping
        scrape_result = await documentation_service.scrape_documentation(
            source_id=source_id,
            force_refresh=params.force_refresh,
        )

        return {
            "success": True,
            "source_id": source_id,
            "source_name": params.source_name,
            "scrape_result": scrape_result,
            "url": params.url,
        }

    except Exception as e:
        logger.error("Error scraping documentation", source_name=params.source_name, url=params.url, error=str(e))
        return {"error": {"code": "SCRAPING_FAILED", "message": str(e)}}


@app.tool(
    name="update_documentation",
    description="Update documentation from existing sources with cache maintenance. Use when refreshing cached documentation content.",
    tags={"documentation", "updates", "cache", "maintenance", "refresh"}
)
async def update_documentation(
    source_id: str | None = None,
    source_name: str | None = None,
    force_refresh: bool = False,
    cleanup_cache: bool = True,
) -> dict[str, Any]:
    """Update documentation from existing sources with cache maintenance.
    
    Args:
        source_id: Specific source ID to update (updates all if None)
        source_name: Specific source name to update (alternative to source_id)
        force_refresh: Force refresh even if recently updated
        cleanup_cache: Perform cache cleanup after update
        
    Returns:
        Update result with statistics and changed entries
    """
    if not documentation_service:
        return {"error": {"code": "DOCUMENTATION_NOT_INITIALIZED", "message": "Documentation system not initialized"}}

    try:
        # Update documentation using static method
        cache_result = await DocumentationService.update_documentation(
            source_id=source_id,
            force_refresh=force_refresh,
            cleanup_cache=cleanup_cache,
        )

        if not cache_result.get("success"):
            return {"error": {"code": "CACHE_UPDATE_FAILED", "message": cache_result.get("error", "Unknown error")}}

        # If specific source requested, also run scraping
        scrape_results = []
        if source_id or source_name:
            if source_name and not source_id:
                # TODO: Resolve source_id from source_name
                pass

            if source_id:
                scrape_result = await documentation_service.scrape_documentation(
                    source_id=source_id,
                    force_refresh=force_refresh,
                )
                scrape_results.append(scrape_result)

        return {
            "success": True,
            "cache_update": cache_result,
            "scrape_results": scrape_results,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        logger.error("Error updating documentation",
                    source_id=source_id, source_name=source_name, error=str(e))
        return {"error": {"code": "UPDATE_FAILED", "message": str(e)}}


@app.tool(
    name="search_documentation",
    description="Search documentation content using text and semantic similarity. Use when looking for specific information in documentation.",
    tags={"documentation", "search", "semantic", "text-search", "knowledge"}
)
async def search_documentation(
    query: str,
    source_names: list[str] | None = None,
    content_types: list[str] | None = None,
    search_type: str = "hybrid",
    limit: int = 20,
    min_relevance: float = 0.3,
) -> dict[str, Any]:
    """Search documentation content using text and semantic similarity.
    
    Args:
        query: Search query text
        source_names: Filter by specific documentation sources
        content_types: Filter by content types (content, code, example, api)
        search_type: Search method (text, vector, hybrid)
        limit: Maximum number of results to return
        min_relevance: Minimum relevance score threshold
        
    Returns:
        Search results with relevance scores and snippets
    """
    if not documentation_service:
        return {"error": {"code": "DOCUMENTATION_NOT_INITIALIZED", "message": "Documentation system not initialized"}}

    try:
        search_result = await documentation_service.search_documentation(
            query=query,
            source_names=source_names,
            content_types=content_types,
            search_type=search_type,
            limit=limit,
            min_relevance=min_relevance,
        )

        if not search_result.get("success"):
            return {"error": {"code": "SEARCH_FAILED", "message": search_result.get("error", "Unknown error")}}

        # The search_result already contains filtered and formatted results
        return search_result

    except Exception as e:
        logger.error("Error searching documentation", query=query, error=str(e))
        return {"error": {"code": "SEARCH_FAILED", "message": str(e)}}


@app.tool(
    name="analyze_documentation_changes",
    description="Analyze recent documentation changes and their potential impact. Use when tracking documentation evolution and impact assessment.",
    tags={"documentation", "analysis", "changes", "impact", "tracking"}
)
async def analyze_documentation_changes(
    source_id: str | None = None,
    days_back: int = 7,
    change_types: list[str] | None = None,
    impact_threshold: str = "minor",
) -> dict[str, Any]:
    """Analyze recent documentation changes and their potential impact.
    
    Args:
        source_id: Analyze specific source (all sources if None)
        days_back: Number of days to look back for changes
        change_types: Filter by change types (created, updated, deleted, moved)
        impact_threshold: Minimum impact level (minor, major, breaking)
        
    Returns:
        Change analysis with impact assessment and recommendations
    """
    # DocumentationService is always available (static methods)

    try:
        analysis_result = await DocumentationService.analyze_documentation_changes(
            source_id=source_id,
            days_back=days_back,
            change_types=change_types,
            impact_threshold=impact_threshold,
        )

        if not analysis_result.get("success"):
            return {"error": {"code": "ANALYSIS_FAILED", "message": analysis_result.get("error", "Unknown error")}}

        # The analysis_result already contains the processed data
        return analysis_result

    except Exception as e:
        logger.error("Error analyzing documentation changes",
                    source_id=source_id, error=str(e))
        return {"error": {"code": "ANALYSIS_FAILED", "message": str(e)}}


@app.tool(
    name="link_docs_to_code",
    description="Create AI-powered links between documentation and code symbols. Use when establishing connections between docs and implementation.",
    tags={"documentation", "code-linking", "ai-powered", "symbols", "reference"}
)
async def link_docs_to_code(
    project_path: str,
    documentation_sources: list[str] | None = None,
    file_patterns: list[str] | None = None,
    confidence_threshold: float = 0.7,
    max_links_per_symbol: int = 3,
    force_reanalysis: bool = False,
) -> dict[str, Any]:
    """Create AI-powered links between documentation and code symbols.
    
    Args:
        project_path: Absolute path to code project
        documentation_sources: Specific doc sources to link (all if None)
        file_patterns: File patterns to analyze (e.g., ["*.py", "*.js"])
        confidence_threshold: Minimum confidence for creating links
        max_links_per_symbol: Maximum documentation links per code symbol
        force_reanalysis: Force re-analysis of existing symbols
        
    Returns:
        Linking results with created references and confidence scores
    """
    # DocumentationService is always available (static methods)

    try:
        link_result = await DocumentationService.link_docs_to_code(
            project_path=project_path,
            documentation_sources=documentation_sources,
            file_patterns=file_patterns,
            confidence_threshold=confidence_threshold,
            max_links_per_symbol=max_links_per_symbol,
            force_reanalysis=force_reanalysis,
        )

        if not link_result.get("success"):
            return {"error": {"code": "LINKING_FAILED", "message": link_result.get("error", "Unknown error")}}

        # The link_result already contains the processed results
        return link_result

    except Exception as e:
        logger.error("Error linking documentation to code",
                    project_path=project_path, error=str(e))
        return {"error": {"code": "LINKING_FAILED", "message": str(e)}}


# =============================================================================
# SHARED MEMORY AND ERROR LOGGING TOOLS
# =============================================================================

@app.tool(
    name="store_memory_entry",
    description="Store a memory entry for cross-agent collaboration. Use when sharing findings, insights, or context between agents.",
    tags={"multi-agent", "memory", "collaboration", "sharing", "context"}
)
async def store_memory_entry(
    repository_path: str,
    agent_id: str,
    entry_type: str,
    title: str,
    content: str,
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    relevance_score: float = 1.0,
) -> dict[str, Any]:
    """Store a memory entry for cross-agent collaboration.
    
    Args:
        repository_path: Repository path for scoping
        agent_id: ID of the agent storing the entry
        entry_type: Type of entry (tool_call, insight, discovery, result)
        title: Brief title for the entry
        content: Main content of the entry
        tags: Optional tags for categorization
        metadata: Optional metadata (can be JSON string or dict)
        relevance_score: Relevance score (0.0-1.0)
        
    Returns:
        Memory storage result with entry_id
    """
    try:
        # Parse metadata using AI-tolerant parser
        try:
            parsed_metadata = parse_ai_json(metadata) if metadata else None
        except ValueError as e:
            return {"error": {"code": "INVALID_METADATA", "message": str(e)}}

        result = await SharedMemoryService.store_memory_entry(
            repository_path=repository_path,
            agent_id=agent_id,
            entry_type=entry_type,
            title=title,
            content=content,
            tags=tags,
            metadata=parsed_metadata,
            relevance_score=relevance_score,
        )
        return result

    except Exception as e:
        logger.error("Error storing memory entry", error=str(e))
        return {"error": {"code": "MEMORY_STORE_FAILED", "message": str(e)}}


@app.tool(
    name="query_shared_memory",
    description="Query shared memory entries for cross-agent context. Use when retrieving previously stored agent insights or findings.",
    tags={"multi-agent", "memory", "query", "context", "retrieval"}
)
async def query_shared_memory(
    repository_path: str,
    query_text: str | None = None,
    entry_types: list[str] | None = None,
    tags: list[str] | None = None,
    limit: int = 20,
    min_relevance: float = 0.3,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """Query shared memory entries for cross-agent context.
    
    Args:
        repository_path: Repository path to query
        query_text: Text to search in title and content
        entry_types: Filter by entry types (tool_call, insight, discovery, result)
        tags: Filter by tags
        limit: Maximum results to return
        min_relevance: Minimum relevance score
        agent_id: Optional agent ID for tracking access
        
    Returns:
        Matching memory entries with context
    """
    try:
        result = await SharedMemoryService.query_memory(
            repository_path=repository_path,
            query_text=query_text,
            entry_types=entry_types,
            tags=tags,
            limit=limit,
            min_relevance=min_relevance,
            agent_id=agent_id,
        )
        return result

    except Exception as e:
        logger.error("Error querying shared memory", error=str(e))
        return {"error": {"code": "MEMORY_QUERY_FAILED", "message": str(e)}}


@app.tool(
    name="store_agent_insight",
    description="Store an agent insight for cross-agent learning. Use when documenting patterns, solutions, or approaches for other agents.",
    tags={"multi-agent", "insights", "learning", "patterns", "knowledge-sharing"}
)
async def store_agent_insight(
    repository_path: str,
    agent_id: str,
    insight_type: str,
    category: str,
    title: str,
    description: str,
    context: dict[str, Any] | str | None = None,
    confidence: float = 0.8,
) -> dict[str, Any]:
    """Store an agent insight for cross-agent learning.
    
    Args:
        repository_path: Repository path for scoping
        agent_id: ID of the agent storing the insight
        insight_type: Type of insight (pattern, approach, solution, pitfall)
        category: Category (architecture, performance, testing, etc.)
        title: Brief title for the insight
        description: Detailed description
        context: Optional context information (can be JSON string or dict)
        confidence: Confidence in the insight (0.0-1.0)
        
    Returns:
        Insight storage result with insight_id
    """
    try:
        # Parse context using AI-tolerant parser
        try:
            parsed_context = parse_ai_json(context) if context else None
        except ValueError as e:
            return {"error": {"code": "INVALID_CONTEXT", "message": str(e)}}

        result = await SharedMemoryService.store_insight(
            repository_path=repository_path,
            agent_id=agent_id,
            insight_type=insight_type,
            category=category,
            title=title,
            description=description,
            context=parsed_context,
            confidence=confidence,
        )
        return result

    except Exception as e:
        logger.error("Error storing agent insight", error=str(e))
        return {"error": {"code": "INSIGHT_STORE_FAILED", "message": str(e)}}


@app.tool(
    name="get_agent_insights",
    description="Get agent insights for learning and reference. Use when accessing stored patterns and solutions from other agents.",
    tags={"multi-agent", "insights", "learning", "reference", "knowledge"}
)
async def get_agent_insights(
    repository_path: str,
    categories: list[str] | None = None,
    insight_types: list[str] | None = None,
    min_confidence: float = 0.5,
    limit: int = 20,
) -> dict[str, Any]:
    """Get agent insights for learning and reference.
    
    Args:
        repository_path: Repository path to query
        categories: Filter by categories
        insight_types: Filter by insight types
        min_confidence: Minimum confidence threshold
        limit: Maximum results to return
        
    Returns:
        Matching insights for cross-agent learning
    """
    try:
        result = await SharedMemoryService.get_insights(
            repository_path=repository_path,
            categories=categories,
            insight_types=insight_types,
            min_confidence=min_confidence,
            limit=limit,
        )
        return result

    except Exception as e:
        logger.error("Error getting agent insights", error=str(e))
        return {"error": {"code": "INSIGHTS_GET_FAILED", "message": str(e)}}


@app.tool(
    name="log_tool_call",
    description="Log a tool call for cross-agent reference and analysis. Use when tracking tool usage patterns and results across agents.",
    tags={"multi-agent", "logging", "tool-tracking", "analysis", "coordination"}
)
async def log_tool_call(
    repository_path: str,
    agent_id: str,
    tool_name: str,
    parameters: dict[str, Any] | str | None = None,
    result: dict[str, Any] | str | None = None,
    status: str = "success",
    execution_time: float | None = None,
    error_message: str | None = None,
    task_id: str | None = None,
) -> dict[str, Any]:
    """Log a tool call for cross-agent reference and analysis.
    
    Args:
        repository_path: Repository path for scoping
        agent_id: ID of the agent making the call
        tool_name: Name of the tool called
        parameters: Tool parameters (can be JSON string or dict)
        result: Tool result (can be JSON string or dict)
        status: Call status (success, error, timeout)
        execution_time: Execution time in seconds
        error_message: Error message if failed
        task_id: Optional associated task ID
        
    Returns:
        Tool call logging result with log_id
    """
    try:
        # Parse parameters and result using AI-tolerant parser
        try:
            parsed_parameters = parse_ai_json(parameters) if parameters else None
            parsed_result = parse_ai_json(result) if result else None
        except ValueError as e:
            return {"error": {"code": "INVALID_TOOL_DATA", "message": str(e)}}

        result = await SharedMemoryService.log_tool_call(
            repository_path=repository_path,
            agent_id=agent_id,
            tool_name=tool_name,
            parameters=parsed_parameters,
            result=parsed_result,
            status=status,
            execution_time=execution_time,
            error_message=error_message,
            task_id=task_id,
        )
        return result

    except Exception as e:
        logger.error("Error logging tool call", error=str(e))
        return {"error": {"code": "TOOL_LOG_FAILED", "message": str(e)}}


@app.tool(
    name="get_tool_call_history",
    description="Get tool call history for analysis and reference. Use when reviewing past tool usage patterns and outcomes.",
    tags={"multi-agent", "history", "tool-tracking", "analysis", "reference"}
)
async def get_tool_call_history(
    repository_path: str,
    tool_names: list[str] | None = None,
    status_filter: list[str] | None = None,
    agent_id: str | None = None,
    hours_back: int = 24,
    limit: int = 50,
) -> dict[str, Any]:
    """Get tool call history for analysis and reference.
    
    Args:
        repository_path: Repository path to query
        tool_names: Filter by tool names
        status_filter: Filter by status (success, error, timeout)
        agent_id: Filter by agent ID
        hours_back: Hours to look back
        limit: Maximum results to return
        
    Returns:
        Tool call history for cross-agent analysis
    """
    try:
        result = await SharedMemoryService.get_tool_call_history(
            repository_path=repository_path,
            tool_names=tool_names,
            status_filter=status_filter,
            agent_id=agent_id,
            hours_back=hours_back,
            limit=limit,
        )
        return result

    except Exception as e:
        logger.error("Error getting tool call history", error=str(e))
        return {"error": {"code": "TOOL_HISTORY_FAILED", "message": str(e)}}


@app.tool(
    name="log_error",
    description="Log an error with comprehensive context for debugging and learning. Use when capturing errors for analysis and pattern detection.",
    tags={"error-handling", "logging", "debugging", "context", "analysis"}
)
async def log_error(
    repository_path: str,
    error_type: str,
    error_category: str,
    error_message: str,
    agent_id: str | None = None,
    task_id: str | None = None,
    error_details: str | None = None,
    context: dict[str, Any] | str | None = None,
    environment: dict[str, Any] | str | None = None,
    attempted_solution: str | None = None,
    severity: str = "medium",
) -> dict[str, Any]:
    """Log an error with comprehensive context for debugging and learning.
    
    Args:
        repository_path: Repository path for scoping
        error_type: Type of error (system, validation, runtime, timeout)
        error_category: Category (mcp_tool, file_operation, network, etc.)
        error_message: Main error message
        agent_id: Optional agent ID
        task_id: Optional task ID
        error_details: Full stack trace or detailed info
        context: Context when error occurred (can be JSON string or dict)
        environment: Environment information (can be JSON string or dict)
        attempted_solution: What was tried to fix it
        severity: Error severity (low, medium, high, critical)
        
    Returns:
        Error logging result with error_id and pattern matching
    """
    try:
        # Parse context and environment using AI-tolerant parser
        try:
            parsed_context = parse_ai_json(context) if context else None
            parsed_environment = parse_ai_json(environment) if environment else None
        except ValueError as e:
            return {"error": {"code": "INVALID_ERROR_DATA", "message": str(e)}}

        result = await ErrorLoggingService.log_error(
            repository_path=repository_path,
            error_type=error_type,
            error_category=error_category,
            error_message=error_message,
            agent_id=agent_id,
            task_id=task_id,
            error_details=error_details,
            context=parsed_context,
            environment=parsed_environment,
            attempted_solution=attempted_solution,
            severity=severity,
        )
        return result

    except Exception as e:
        logger.error("Error logging error", error=str(e))
        return {"error": {"code": "ERROR_LOG_FAILED", "message": str(e)}}


@app.tool(name="get_error_patterns")
async def get_error_patterns(
    repository_path: str,
    min_frequency: int = 2,
    days_back: int = 30,
    limit: int = 20,
) -> dict[str, Any]:
    """Get error patterns for analysis and prevention.
    
    Args:
        repository_path: Repository path to query
        min_frequency: Minimum frequency to include
        days_back: Days to look back
        limit: Maximum results to return
        
    Returns:
        Error patterns with suggested solutions
    """
    try:
        result = await ErrorLoggingService.get_error_patterns(
            repository_path=repository_path,
            min_frequency=min_frequency,
            days_back=days_back,
            limit=limit,
        )
        return result

    except Exception as e:
        logger.error("Error getting error patterns", error=str(e))
        return {"error": {"code": "ERROR_PATTERNS_FAILED", "message": str(e)}}


@app.tool(
    name="get_recent_errors",
    description="Get recent errors from the error logging system for debugging and analysis purposes. Use when investigating issues or analyzing error patterns in a repository.",
    tags={"error-management", "debugging", "analysis", "logging"}
)
async def get_recent_errors(
    repository_path: str,
    error_types: list[str] | None = None,
    severity_filter: list[str] | None = None,
    status_filter: str = "unresolved",
    hours_back: int = 24,
    limit: int = 20,
) -> dict[str, Any]:
    """Get recent errors for debugging and analysis.
    
    Args:
        repository_path: Repository path to query
        error_types: Filter by error types
        severity_filter: Filter by severity levels
        status_filter: Filter by resolution status
        hours_back: Hours to look back
        limit: Maximum results to return
        
    Returns:
        Recent errors with context and resolution status
    """
    try:
        result = await ErrorLoggingService.get_recent_errors(
            repository_path=repository_path,
            error_types=error_types,
            severity_filter=severity_filter,
            status_filter=status_filter,
            hours_back=hours_back,
            limit=limit,
        )
        return result

    except Exception as e:
        logger.error("Error getting recent errors", error=str(e))
        return {"error": {"code": "RECENT_ERRORS_FAILED", "message": str(e)}}


@app.tool(
    name="resolve_error",
    description="Mark an error as resolved in the error logging system and optionally create a learning entry for future reference. Use after successfully fixing an error.",
    tags={"error-management", "resolution", "learning", "knowledge-capture"}
)
async def resolve_error(
    error_id: str,
    resolution_details: str,
    create_learning: bool = True,
) -> dict[str, Any]:
    """Mark an error as resolved and optionally create learning entry.
    
    Args:
        error_id: ID of the error to resolve
        resolution_details: How the error was resolved
        create_learning: Whether to create a learning entry
        
    Returns:
        Error resolution result with optional learning entry
    """
    try:
        result = await ErrorLoggingService.resolve_error(
            error_id=error_id,
            resolution_details=resolution_details,
            create_learning=create_learning,
        )
        return result

    except Exception as e:
        logger.error("Error resolving error", error=str(e))
        return {"error": {"code": "ERROR_RESOLVE_FAILED", "message": str(e)}}


@app.tool(
    name="get_learning_entries",
    description="Retrieve learning entries from the knowledge base to understand past solutions and best practices. Use when looking for similar problems or proven solutions.",
    tags={"learning", "knowledge-base", "best-practices", "historical-solutions"}
)
async def get_learning_entries(
    repository_path: str,
    categories: list[str] | None = None,
    min_success_rate: float = 0.5,
    limit: int = 20,
) -> dict[str, Any]:
    """Get learning entries for knowledge sharing and improvement.
    
    Args:
        repository_path: Repository path to query
        categories: Filter by categories
        min_success_rate: Minimum success rate
        limit: Maximum results to return
        
    Returns:
        Learning entries with success rates and applicability
    """
    try:
        result = await ErrorLoggingService.get_learning_entries(
            repository_path=repository_path,
            categories=categories,
            min_success_rate=min_success_rate,
            limit=limit,
        )
        return result

    except Exception as e:
        logger.error("Error getting learning entries", error=str(e))
        return {"error": {"code": "LEARNING_ENTRIES_FAILED", "message": str(e)}}


# =============================================================================
# FILE OPERATIONS TOOLS (MCP WRAPPERS WITH JSON PARSING)
# =============================================================================

@app.tool(
    name="list_files",
    description="List files and directories with smart filtering and ignore pattern support. Use to explore project structure and find relevant files for analysis or modification.",
    tags={"file-operations", "exploration", "project-structure", "discovery"}
)
async def list_files(
    directory: str = ".",
    show_hidden: bool = False,
    max_depth: int | None = None,
    file_pattern: str | None = None,
) -> str:
    """Enhanced file listing with ignore pattern support and smart filtering."""
    try:
        # Import the pure implementation function
        from .server import _list_files_impl
        return _list_files_impl(
            directory=directory,
            show_hidden=show_hidden,
            max_depth=max_depth or 3,  # Default to 3 if None
        )
    except Exception as e:
        logger.error("File listing failed", error=str(e))
        return f"Error listing files: {e!s}"


@app.tool(
    name="create_claudeignore",
    description="Create a .claudeignore file with sensible defaults to exclude irrelevant files from AI analysis. Use when setting up a project for better AI interaction.",
    tags={"file-operations", "configuration", "project-setup", "ignore-patterns"}
)
async def create_claudeignore(directory: str = ".") -> str:
    """Create a .claudeignore file with sensible defaults."""
    try:
        from .server import _create_claudeignore_impl
        return _create_claudeignore_impl(directory=directory)
    except Exception as e:
        logger.error("Create claudeignore failed", error=str(e))
        return f"Error creating .claudeignore: {e!s}"


@app.tool(
    name="find_files",
    description="Search for files by name or pattern with ignore pattern respect. Use when looking for specific files across the project structure.",
    tags={"file-operations", "search", "pattern-matching", "discovery"}
)
async def find_files(
    pattern: str,
    directory: str = ".",
    include_hidden: bool = False,
    max_results: int = 100,
) -> str:
    """Search for files by name/pattern with ignore pattern respect."""
    try:
        from .server import _find_files_impl
        return _find_files_impl(
            pattern=pattern,
            directory=directory,
            include_hidden=include_hidden,
        )
    except Exception as e:
        logger.error("File search failed", error=str(e))
        return f"Error finding files: {e!s}"


@app.tool(
    name="easy_replace",
    description="Replace text in a single file with fuzzy matching support for robust text substitution. Use when making targeted changes to specific content in a file.",
    tags={"file-operations", "text-replacement", "fuzzy-matching", "editing"}
)
async def easy_replace(
    file_path: str,
    old_text: str,
    new_text: str,
    fuzzy_threshold: float = 0.8,
) -> str:
    """Replace text in a file with fuzzy matching support."""
    try:
        from .server import _easy_replace_impl
        return _easy_replace_impl(
            file_path=file_path,
            search_text=old_text,
            replace_text=new_text,
            similarity_threshold=fuzzy_threshold,
        )
    except Exception as e:
        logger.error("Text replacement failed", error=str(e))
        return f"Error replacing text: {e!s}"


@app.tool(
    name="easy_replace_all",
    description="Perform multiple text replacements across multiple files with rollback capability and JSON parsing support. Use for bulk refactoring or systematic changes across the codebase.",
    tags={"file-operations", "bulk-editing", "refactoring", "text-replacement", "rollback"}
)
async def easy_replace_all(
    replacements: str | list[dict[str, str]],
    file_patterns: str | list[str] | None = None,
    dry_run: bool = False,
) -> str:
    """Perform multiple replacements across files with rollback capability and JSON parsing support."""
    try:
        # Parse replacements from JSON if needed
        if isinstance(replacements, str):
            try:
                parsed_replacements = parse_ai_json(replacements)
                if isinstance(parsed_replacements, list):
                    replacements = parsed_replacements
                else:
                    # If it's a dict, assume it's a single replacement
                    replacements = [parsed_replacements] if parsed_replacements else []
            except (ValueError, TypeError):
                return "Error: replacements must be a valid JSON array of replacement objects"

        # Parse file_patterns from JSON if needed
        if isinstance(file_patterns, str):
            try:
                parsed_patterns = parse_ai_json(file_patterns)
                if isinstance(parsed_patterns, list):
                    file_patterns = parsed_patterns
                elif isinstance(parsed_patterns, str):
                    file_patterns = [parsed_patterns]
                else:
                    file_patterns = None
            except (ValueError, TypeError):
                # Treat as a single pattern
                file_patterns = [file_patterns]

        from .server import _easy_replace_all_impl
        return _easy_replace_all_impl(
            replacements=replacements,
            file_patterns=file_patterns,
            dry_run=dry_run,
        )
    except Exception as e:
        logger.error("Bulk replacement failed", error=str(e))
        return f"Error performing bulk replacements: {e!s}"


@app.tool(
    name="take_screenshot",
    description="Take a screenshot using the best available method for visual documentation or debugging. Use when needing to capture the current state of the screen or application.",
    tags={"screenshot", "visual-documentation", "debugging", "capture"}
)
async def take_screenshot(
    filename: str | None = None,
    directory: str = ".",
    open_after: bool = False,
) -> str:
    """Take a screenshot using the best available method."""
    try:
        from .server import _take_screenshot_impl
        # The orchestration server take_screenshot has different parameters than the base implementation
        # Convert the parameters to match the base implementation
        if filename:
            output_path = f"{directory}/{filename}" if directory != "." else filename
        else:
            output_path = f"{directory}/screenshot.png" if directory != "." else "screenshot.png"

        return _take_screenshot_impl(output_path=output_path)
    except Exception as e:
        logger.error("Screenshot failed", error=str(e))
        return f"Error taking screenshot: {e!s}"


# =============================================================================
# SERVER LIFECYCLE
# =============================================================================

async def startup():
    """Server startup handler."""
    await initialize_orchestration()


async def shutdown():
    """Server shutdown handler."""
    await cleanup_orchestration()


# =============================================================================
# CLEANUP TOOLS (SYSTEM MAINTENANCE)
# =============================================================================

@app.tool(
    name="analyze_storage_usage",
    description="Analyze storage usage across database and files to identify space consumption patterns. Use when investigating disk usage or preparing for cleanup operations.",
    tags={"maintenance", "storage", "analysis", "cleanup", "system-health"}
)
async def analyze_storage_usage(repository_path: str | None = None) -> str:
    """Analyze storage usage across the database and files.
    
    Args:
        repository_path: Optional repository filter (not used for storage analysis)
        
    Returns:
        JSON string with storage analysis results
    """
    try:
        from .services.cleanup_service import CleanupService
        result = await CleanupService.analyze_storage_usage()
        return json.dumps(result, indent=2)
    except Exception as e:
        logger.error("Storage analysis failed", error=str(e))
        return json.dumps({"error": str(e)})


@app.tool(
    name="find_orphaned_projects",
    description="Find database entries for projects that no longer exist on disk. Use to identify data inconsistencies and prepare for cleanup of stale project references.",
    tags={"maintenance", "cleanup", "orphaned-data", "data-integrity", "analysis"}
)
async def find_orphaned_projects() -> str:
    """Find database entries for projects that no longer exist on disk.
    
    Returns:
        JSON string with orphaned project information
    """
    try:
        from .services.cleanup_service import CleanupService
        result = await CleanupService.find_orphaned_projects()
        return json.dumps(result, indent=2)
    except Exception as e:
        logger.error("Orphaned project analysis failed", error=str(e))
        return json.dumps({"error": str(e)})


@app.tool(
    name="find_stale_data",
    description="Find old data entries that may be candidates for cleanup based on age criteria. Use to identify data that can be safely removed to free up space.",
    tags={"maintenance", "cleanup", "stale-data", "data-retention", "analysis"}
)
async def find_stale_data(older_than_days: int = 30) -> str:
    """Find stale data older than specified days.
    
    Args:
        older_than_days: Consider data older than this many days as stale
        
    Returns:
        JSON string with stale data analysis
    """
    try:
        from .services.cleanup_service import CleanupService
        result = await CleanupService.find_stale_data(older_than_days)
        return json.dumps(result, indent=2)
    except Exception as e:
        logger.error("Stale data analysis failed", error=str(e))
        return json.dumps({"error": str(e)})


@app.tool(
    name="cleanup_orphaned_projects",
    description="Clean up database entries for orphaned projects with dry-run capability for safety. Use to remove data for projects that no longer exist on disk.",
    tags={"maintenance", "cleanup", "orphaned-data", "data-integrity", "dry-run"}
)
async def cleanup_orphaned_projects(repository_paths: list[str], dry_run: bool = True) -> str:
    """Clean up data for orphaned projects.
    
    Args:
        repository_paths: List of repository paths to clean up
        dry_run: If True, only analyze what would be deleted
        
    Returns:
        JSON string with cleanup results
    """
    try:
        from .services.cleanup_service import CleanupService
        result = await CleanupService.cleanup_orphaned_projects(repository_paths, dry_run)
        return json.dumps(result, indent=2)
    except Exception as e:
        logger.error("Orphaned project cleanup failed", error=str(e))
        return json.dumps({"error": str(e)})


@app.tool(
    name="cleanup_stale_data",
    description="Clean up old data entries based on age criteria with dry-run capability for safety. Use to free up space by removing outdated information.",
    tags={"maintenance", "cleanup", "stale-data", "data-retention", "dry-run"}
)
async def cleanup_stale_data(older_than_days: int = 30, dry_run: bool = True) -> str:
    """Clean up stale data older than specified days.
    
    Args:
        older_than_days: Delete data older than this many days
        dry_run: If True, only analyze what would be deleted
        
    Returns:
        JSON string with cleanup results
    """
    try:
        from .services.cleanup_service import CleanupService
        result = await CleanupService.cleanup_stale_data(older_than_days, dry_run)
        return json.dumps(result, indent=2)
    except Exception as e:
        logger.error("Stale data cleanup failed", error=str(e))
        return json.dumps({"error": str(e)})


@app.tool(
    name="vacuum_database",
    description="Run SQLite VACUUM operation to reclaim space and optimize database performance. Use after cleanup operations to compact the database file.",
    tags={"maintenance", "database", "optimization", "vacuum", "performance"}
)
async def vacuum_database() -> str:
    """Run SQLite VACUUM to reclaim space and optimize database.
    
    Returns:
        JSON string with vacuum operation results
    """
    try:
        from .services.cleanup_service import CleanupService
        result = await CleanupService.vacuum_database()
        return json.dumps(result, indent=2)
    except Exception as e:
        logger.error("Database vacuum failed", error=str(e))
        return json.dumps({"error": str(e)})


def main():
    """Main entry point for the orchestration MCP server."""
    import signal
    import sys

    def signal_handler(signum, frame):
        print("\nShutting down orchestration server...")
        asyncio.create_task(cleanup_orchestration())
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Initialize orchestration on startup
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        loop.run_until_complete(startup())
        print("Claude MCP Orchestration Server started")
        app.run()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        loop.run_until_complete(shutdown())
        loop.close()


if __name__ == "__main__":
    main()
