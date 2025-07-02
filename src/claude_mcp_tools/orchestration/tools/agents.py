"""Agent orchestration tools for spawning and managing specialized agents."""

import asyncio
from datetime import datetime, timezone
from typing import Any

import structlog
from fastmcp import FastMCP

from ...models import AgentStatus
from ...schemas.agents import (
    ListAgentsSchema,
    SpawnAgentSchema,
    SpawnAgentsBatchSchema,
)
from ...services.agent_service import AgentService
from ...services.communication_service import CommunicationService

logger = structlog.get_logger("orchestration.tools.agents")

# Import these from orchestration_server.py to avoid duplication
try:
    from ...orchestration_server import (
        ProcessPoolManager,
        parse_ai_json,
        spawn_claude_async,
        setup_dependency_monitoring,
    )
except ImportError:
    # Fallback implementations if imports fail
    parse_ai_json = lambda x: x
    ProcessPoolManager = None
    spawn_claude_async = None
    setup_dependency_monitoring = lambda x, y: {"success": True}


def register_agent_tools(app: FastMCP):
    """Register agent orchestration tools with the FastMCP app."""
    
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
    async def spawn_agents_batch(params: SpawnAgentsBatchSchema) -> dict[str, Any]:
        """Spawn multiple agents in parallel for improved performance."""
        try:
            # Parse agents configuration
            if isinstance(params.agents, str):
                try:
                    agents_config = parse_ai_json(params.agents)
                    if not isinstance(agents_config, list):
                        raise ValueError("Agents configuration must be a list")
                except ValueError as e:
                    return {"error": {"code": "INVALID_AGENTS_CONFIG", "message": str(e)}}
            else:
                agents_config = params.agents

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

            # Spawn agents in parallel using ProcessPoolManager
            results = []
            async with ProcessPoolManager(max_workers=min(len(agents_config), params.max_concurrent or 5)) as pool:
                tasks = []
                
                for agent_config in agents_config:
                    task = _spawn_single_agent(
                        agent_type=agent_config["agent_type"],
                        repository_path=params.repository_path,
                        task_description=agent_config["task_description"],
                        capabilities=agent_config.get("capabilities", []),
                        initial_context=agent_config.get("initial_context", ""),
                        configuration=agent_config.get("configuration"),
                        depends_on=agent_config.get("depends_on", []),
                        foundation_session_id=params.foundation_session_id,
                        coordination_room=params.coordination_room or "",
                        _pool_manager=pool,
                    )
                    tasks.append(task)
                
                results = await asyncio.gather(*tasks, return_exceptions=True)

            # Process results
            successful_agents = []
            failed_agents = []
            
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    failed_agents.append({
                        "index": i,
                        "agent_config": agents_config[i],
                        "error": str(result)
                    })
                elif result.get("success"):
                    successful_agents.append(result)
                else:
                    failed_agents.append({
                        "index": i,
                        "agent_config": agents_config[i],
                        "error": result.get("error", "Unknown error")
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
                "foundation_session_id": params.foundation_session_id,
                "coordination_room": params.coordination_room,
            }

        except Exception as e:
            logger.error("Batch agent spawning failed", error=str(e))
            return {"error": {"code": "BATCH_SPAWN_FAILED", "message": str(e)}}

    @app.tool(
        name="list_agents",
        description="List and filter active agents by repository, status, or type to monitor current agent workforce and availability",
        tags={"agent-management", "monitoring", "filtering", "status-checking"}
    )
    async def list_agents(params: ListAgentsSchema) -> dict[str, Any]:
        """List and filter active agents with comprehensive status information."""
        try:
            agent_service = AgentService(params.repository_path)
            
            # Get all agents for the repository
            all_agents = await agent_service.list_agents()
            if not all_agents.get("success"):
                return {"error": {"code": "AGENT_LIST_FAILED", "message": all_agents.get("error", "Unknown error")}}
            
            agents = all_agents.get("agents", [])
            
            # Apply filters
            filtered_agents = agents
            
            # Filter by status
            if params.status_filter:
                filtered_agents = [
                    agent for agent in filtered_agents 
                    if agent.get("status") in params.status_filter
                ]
            
            # Filter by agent type
            if params.agent_type_filter:
                filtered_agents = [
                    agent for agent in filtered_agents 
                    if agent.get("agent_type") == params.agent_type_filter
                ]
            
            # Filter completed agents if not included
            if not params.include_completed:
                filtered_agents = [
                    agent for agent in filtered_agents 
                    if agent.get("status") != "completed"
                ]
            
            # Apply limit
            if params.limit and len(filtered_agents) > params.limit:
                filtered_agents = filtered_agents[:params.limit]

            # Calculate statistics
            stats = {
                "total_agents": len(agents),
                "filtered_agents": len(filtered_agents),
                "by_status": {},
                "by_type": {},
            }
            
            for agent in agents:
                status = agent.get("status", "unknown")
                agent_type = agent.get("agent_type", "unknown")
                
                stats["by_status"][status] = stats["by_status"].get(status, 0) + 1
                stats["by_type"][agent_type] = stats["by_type"].get(agent_type, 0) + 1

            return {
                "success": True,
                "repository_path": params.repository_path,
                "agents": filtered_agents,
                "statistics": stats,
                "filters_applied": {
                    "status_filter": params.status_filter,
                    "agent_type_filter": params.agent_type_filter,
                    "include_completed": params.include_completed,
                    "limit": params.limit,
                },
            }

        except Exception as e:
            logger.error("Failed to list agents", repository=params.repository_path, error=str(e))
            return {"error": {"code": "LIST_AGENTS_FAILED", "message": str(e)}}

    @app.tool(
        name="get_agent_status",
        description="Get detailed status information for a specific agent including execution details and task progress",
        tags={"agent-management", "monitoring", "status-checking", "debugging"}
    )
    async def get_agent_status(repository_path: str, agent_id: str) -> dict[str, Any]:
        """Get comprehensive status information for a specific agent."""
        try:
            agent_service = AgentService(repository_path)
            result = await agent_service.get_agent_status(agent_id)
            
            if not result.get("success"):
                return {"error": {"code": "AGENT_STATUS_FAILED", "message": result.get("error", "Agent not found")}}
            
            return result

        except Exception as e:
            logger.error("Failed to get agent status", agent_id=agent_id, error=str(e))
            return {"error": {"code": "GET_STATUS_FAILED", "message": str(e)}}

    @app.tool(
        name="terminate_agent",
        description="Gracefully terminate a specific agent and clean up its resources",
        tags={"agent-management", "termination", "cleanup", "resource-management"}
    )
    async def terminate_agent(repository_path: str, agent_id: str, reason: str = "Manual termination") -> dict[str, Any]:
        """Terminate a specific agent and clean up its resources."""
        try:
            agent_service = AgentService(repository_path)
            result = await agent_service.terminate_agent(agent_id, reason)
            
            return result

        except Exception as e:
            logger.error("Failed to terminate agent", agent_id=agent_id, error=str(e))
            return {"error": {"code": "TERMINATE_FAILED", "message": str(e)}}


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
    _pool_manager = None,
) -> dict[str, Any]:
    """Internal function to spawn a single agent - extracted for parallel execution."""
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

        if auto_execute and spawn_claude_async:
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
        return {"error": {"code": "SPAWN_AGENT_FAILED", "message": str(e)}}