"""Agent orchestration tools - simplified for reliable spawning."""

import json
from datetime import datetime, timezone
from typing import Annotated, Any

import structlog
from fastmcp import Context
from pydantic import Field

from ..models import AgentStatus
from ..services.agent_service import AgentService
from .json_utils import parse_json_list, check_parsing_error
from .app import app

logger = structlog.get_logger("tools.agents")

# Import simplified spawn function
try:
    from ..claude_spawner import spawn_claude_sync
except ImportError:
    logger.error("Failed to import simplified claude_spawner functions")
    spawn_claude_sync = None

# Simple parser for configuration data
def parse_ai_json(data):
    """Simple parser for configuration data."""
    if isinstance(data, str):
        try:
            return json.loads(data)
        except Exception:
            return data
    return data




@app.tool(tags={"spawning", "agent-creation", "coordination", "task-execution"})
async def spawn_agent(
    ctx: Context,
    agent_type: Annotated[str, Field(
        description="Type of agent to spawn",
        pattern=r"^(general-agent|research-agent|bug-fixing-agent|implementation-agent|testing-agent|coordination-agent|documentation-agent|analysis-agent|implementer|reviewer|tester|documentation|analyzer|coordinator|backend|frontend|fullstack|devops|architect|master)$",
    )],
    repository_path: Annotated[str, Field(
        description="Path to the repository for agent work",
    )],
    task_description: Annotated[str, Field(
        description="Detailed description of the task for the agent",
        min_length=1,
        max_length=2000,
    )],
    capabilities: Annotated[str | list[str] | None, Field(
        description="List of specific capabilities the agent should have. Can be JSON array: ['backend', 'frontend']",
    )] = None,
    configuration: Annotated[str | dict[str, Any] | None, Field(
        description="Agent-specific configuration (JSON object or string)",
        default=None,
    )] = None,
    depends_on: Annotated[str | list[str] | None, Field(
        description="List of agent IDs this agent depends on. Can be JSON array: ['agent1', 'agent2']",
    )] = None,
    foundation_session_id: Annotated[str | None, Field(
        description="Foundation session ID for shared context (cost optimization)",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Create and spawn a specialized agent with specific capabilities for executing development tasks."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_capabilities = parse_json_list(capabilities, "capabilities")
        if check_parsing_error(parsed_capabilities):
            return parsed_capabilities
        
        parsed_depends_on = parse_json_list(depends_on, "depends_on")
        if check_parsing_error(parsed_depends_on):
            return parsed_depends_on
        
        # Parse configuration
        parsed_configuration = parse_ai_json(configuration)
        
        # Create database record first
        agent_result = await AgentService.create_agent(
            agent_type=agent_type,
            repository_path=repository_path,
            capabilities=parsed_capabilities or [],
            initial_context="",
            configuration=parsed_configuration,
        )
        
        if not agent_result.get("success"):
            return {"error": {"code": "AGENT_DB_CREATION_FAILED", "message": agent_result.get("error", "Unknown error")}}
        
        agent_id = agent_result["agent_id"]
        
        # Simple task prompt for the agent
        claude_prompt = f"""You are a {agent_type.upper()} AGENT.

Agent ID: {agent_id}
Repository: {repository_path}

TASK: {task_description}

Use the available tools to complete this task. When done, report your results clearly."""
        
        # Use simplified spawn function - fire and forget
        if spawn_claude_sync is None:
            logger.error("spawn_claude_sync not available")
            return {"error": {"code": "SPAWN_FUNCTION_UNAVAILABLE", "message": "spawn_claude_sync function not available"}}
        
        logger.info("Spawning agent with simplified approach", agent_id=agent_id, agent_type=agent_type)
        
        # Call simplified spawn function
        spawn_result = spawn_claude_sync(
            workFolder=repository_path,
            prompt=claude_prompt,
            session_id=foundation_session_id,
            model="sonnet"
        )
        
        if not spawn_result.get("success"):
            error_msg = spawn_result.get("error", "Unknown spawn error")
            logger.error("Simplified spawn failed", agent_id=agent_id, error=error_msg)
            return {"error": {"code": "SPAWN_FAILED", "message": error_msg}}
        
        claude_pid = spawn_result.get("pid")
        
        # Update agent with PID if available
        if claude_pid:
            try:
                await AgentService.update_agent_pid(agent_id=agent_id, claude_pid=claude_pid)
                await AgentService.update_agent_status(agent_id=agent_id, status=AgentStatus.ACTIVE)
                logger.info("Agent spawned successfully", agent_id=agent_id, claude_pid=claude_pid)
            except Exception as e:
                logger.warning("Failed to update agent metadata", agent_id=agent_id, error=str(e))
        
        return {
            "success": True,
            "agent_id": agent_id,
            "agent_type": agent_type,
            "repository_path": repository_path,
            "task_description": task_description,
            "claude_pid": claude_pid,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        
    except Exception as e:
        logger.error("Error spawning agent", error=str(e))
        return {"error": {"code": "SPAWN_AGENT_FAILED", "message": str(e)}}

@app.tool(tags={"spawning", "batch-operations", "parallel-processing", "agent-creation", "coordination"})
async def spawn_agents_batch(
    ctx: Context,
    repository_path: Annotated[str, Field(
        description="Path to the repository for agent work",
    )],
    agents: Annotated[str | list[dict[str, Any]], Field(
        description="List of agent configurations to spawn (JSON array or string)",
    )],
    foundation_session_id: Annotated[str | None, Field(
        description="Foundation session ID for shared context across all agents",
        default=None,
    )] = None,
    coordination_mode: Annotated[str, Field(
        description="How agents should coordinate",
        pattern=r"^(parallel|sequential|dependency_based)$",
    )] = "dependency_based",
    max_concurrent: Annotated[int, Field(
        description="Maximum number of agents to spawn concurrently",
        ge=1,
        le=10,
    )] = 5,
    coordination_room: Annotated[str | None, Field(
        description="Name of coordination room for agent communication",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Spawn multiple specialized agents in parallel for improved performance when creating teams of agents for complex projects."""
    try:
        # Parse agents configuration using json_utils
        parsed_agents = parse_json_list(agents, "agents")
        if check_parsing_error(parsed_agents):
            return parsed_agents
            
        agents_config = parsed_agents
        
        if not isinstance(agents_config, list):
            return {"error": {"code": "INVALID_AGENTS_CONFIG", "message": "Agents configuration must be a list"}}

        if not agents_config:
            return {"error": {"code": "EMPTY_AGENTS_LIST", "message": "No agents specified"}}

        # Validate agent configurations
        for i, agent_config in enumerate(agents_config):
            if not isinstance(agent_config, dict):
                return {"error": {"code": "INVALID_AGENT_CONFIG", "message": f"Agent {i} must be a dictionary"}}

            required_fields = ["agent_type", "task_description"]
            for field in required_fields:
                if field not in agent_config:
                    return {"error": {"code": "MISSING_REQUIRED_FIELD", "message": f"Agent {i} missing required field: {field}"}}

        # Simplified batch spawning - just spawn them one by one for now
        results = []
        successful_agents = []
        failed_agents = []
        
        for i, agent_config in enumerate(agents_config):
            try:
                result = await spawn_agent(
                    ctx=ctx,
                    agent_type=agent_config["agent_type"],
                    repository_path=repository_path,
                    task_description=agent_config["task_description"],
                    capabilities=agent_config.get("capabilities"),
                    configuration=agent_config.get("configuration"),
                    depends_on=agent_config.get("depends_on"),
                    foundation_session_id=foundation_session_id,
                )
                
                if result.get("success"):
                    successful_agents.append(result)
                else:
                    failed_agents.append({
                        "index": i,
                        "agent_config": agent_config,
                        "error": result.get("error", "Unknown error"),
                    })
                    
            except Exception as e:
                failed_agents.append({
                    "index": i,
                    "agent_config": agent_config,
                    "error": str(e),
                })

        logger.info("Batch agent spawning completed",
                    total_requested=len(agents_config),
                    successful=len(successful_agents),
                    failed=len(failed_agents))

        return {
            "success": True,
            "batch_stats": {
                "total_requested": len(agents_config),
                "successful": len(successful_agents),
                "failed": len(failed_agents),
            },
            "successful_agents": successful_agents,
            "failed_agents": failed_agents,
            "foundation_session_id": foundation_session_id,
            "coordination_room": coordination_room,
        }

    except Exception as e:
        logger.error("Batch agent spawning failed", error=str(e))
        return {"error": {"code": "BATCH_SPAWN_FAILED", "message": str(e)}}

@app.tool(tags={"agent-management", "monitoring", "filtering", "status-checking"})
async def list_agents(
    repository_path: Annotated[str, Field(
        description="Path to the repository to filter agents by",
    )],
    status_filter: Annotated[str | list[str] | None, Field(
        description="Filter agents by status. Can be JSON array: ['pending', 'running', 'completed', 'failed']",
        default=None,
    )] = None,
    agent_type_filter: Annotated[str | None, Field(
        description="Filter by agent type",
        default=None,
    )] = None,
    include_completed: Annotated[bool, Field(
        description="Include completed agents in results",
    )] = True,
    limit: Annotated[int, Field(
        description="Maximum number of agents to return",
        ge=1,
        le=100,
    )] = 50,
) -> dict[str, Any]:
    """List and filter active agents by repository, status, or type to monitor current agent workforce and availability."""
    try:
        # Parse status_filter using json_utils
        parsed_status_filter = parse_json_list(status_filter, "status_filter")
        if check_parsing_error(parsed_status_filter):
            return parsed_status_filter
        
        # Convert status_filter to AgentStatus enums if provided
        status_enum_filter = None
        if parsed_status_filter:
            try:
                status_enum_filter = [AgentStatus(status) for status in parsed_status_filter]
            except ValueError as e:
                return {"error": {"code": "INVALID_STATUS_FILTER", "message": f"Invalid status: {e}"}}

        # Get all agents for the repository using static method (MCP-SAFE)
        all_agents = await AgentService.list_agents_safe(
            repository_path=repository_path,
            status_filter=status_enum_filter,
            agent_type=agent_type_filter,
        )
        if not all_agents:
            return {"error": {"code": "AGENT_LIST_FAILED", "message": "Failed to retrieve agents"}}
        
        # Apply client-side filtering for include_completed and limit
        agents_list = all_agents.get("agents", [])
        
        # Filter out completed agents if not requested
        if not include_completed:
            agents_list = [agent for agent in agents_list if agent.get("status") != "completed"]
        
        # Apply limit
        if limit:
            agents_list = agents_list[:limit]
        
        # Generate statistics
        status_counts = {}
        type_counts = {}
        for agent in agents_list:
            status = agent.get("status", "unknown")
            agent_type = agent.get("agent_type", "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1
            type_counts[agent_type] = type_counts.get(agent_type, 0) + 1
        
        return {
            "success": True,
            "repository_path": repository_path,
            "agents": agents_list,
            "statistics": {
                "total_agents": all_agents.get("count", 0),
                "filtered_agents": len(agents_list),
                "by_status": status_counts,
                "by_type": type_counts,
            },
            "filters_applied": {
                "status_filter": parsed_status_filter,
                "agent_type_filter": agent_type_filter,
                "include_completed": include_completed,
                "limit": limit,
            },
        }

    except Exception as e:
        logger.error("Failed to list agents", repository=repository_path, error=str(e))
        return {"error": {"code": "LIST_AGENTS_FAILED", "message": str(e)}}

@app.tool(tags={"agent-management", "monitoring", "status-checking", "debugging"})
async def get_agent_status(agent_id: str) -> dict[str, Any]:
    """Get detailed status information for a specific agent including execution details and task progress."""
    try:
        # Use the EXISTING safe method instead of complex one to prevent hanging
        result = await AgentService.get_agent_by_id_safe(agent_id=agent_id)

        if not result:
            return {"error": {"code": "AGENT_NOT_FOUND", "message": "Agent not found"}}

        # REMOVED: Complex psutil checks that can hang in MCP context
        # The database status is sufficient for basic status reporting
        # Advanced process monitoring should be done outside MCP operations
        
        return {"success": True, "agent": result}

    except Exception as e:
        logger.error("Failed to get agent status", agent_id=agent_id, error=str(e))
        return {"error": {"code": "GET_STATUS_FAILED", "message": str(e)}}

@app.tool(tags={"agent-management", "termination", "cleanup", "resource-management"})
async def terminate_agent(agent_id: str, reason: str = "Manual termination") -> dict[str, Any]:
    """Gracefully terminate a specific agent and clean up its resources."""
    try:
        success = await AgentService.terminate_agent(agent_id=agent_id)

        if success:
            return {"success": True, "agent_id": agent_id, "reason": reason, "status": "terminated"}
        else:
            return {"error": {"code": "AGENT_NOT_FOUND", "message": "Agent not found or already terminated"}}

    except Exception as e:
        logger.error("Failed to terminate agent", agent_id=agent_id, error=str(e))
        return {"error": {"code": "TERMINATE_FAILED", "message": str(e)}}


# Removed complex _spawn_single_agent and dependency wave organization
# These are replaced by the simplified spawn_agent function above