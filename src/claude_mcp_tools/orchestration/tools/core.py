"""Core orchestration tools for multi-agent coordination."""

import asyncio
from datetime import datetime, timezone
from typing import Any

import structlog
from fastmcp import FastMCP
from pydantic import BaseModel

from ...models import AgentStatus
from ...services.agent_service import AgentService
from ...services.communication_service import CommunicationService

logger = structlog.get_logger("orchestration.tools.core")


def register_core_tools(app: FastMCP):
    """Register core orchestration tools with the FastMCP app."""
    
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

    @app.tool(
        name="get_system_status",
        description="Get comprehensive system status including active agents, tasks, memory usage, and orchestration health",
        tags={"monitoring", "system", "status", "health-check"}
    )
    async def get_system_status(repository_path: str) -> dict[str, Any]:
        """Get comprehensive system status for monitoring orchestration health."""
        try:
            agent_service = AgentService(repository_path)
            comm_service = CommunicationService(repository_path)
            
            # Get agent statistics
            agents_result = await agent_service.list_agents()
            active_agents = [a for a in agents_result.get("agents", []) if a.get("status") in ["running", "spawning"]]
            
            # Get communication stats
            rooms_result = await comm_service.list_active_rooms()
            active_rooms = rooms_result.get("rooms", [])
            
            return {
                "success": True,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "system_health": "healthy",
                "agents": {
                    "total": len(agents_result.get("agents", [])),
                    "active": len(active_agents),
                    "by_status": _group_by_status(agents_result.get("agents", [])),
                },
                "communication": {
                    "active_rooms": len(active_rooms),
                    "rooms": [{"name": r.get("name"), "participants": len(r.get("participants", []))} for r in active_rooms],
                },
                "repository_path": repository_path,
            }
            
        except Exception as e:
            logger.error("Failed to get system status", repository=repository_path, error=str(e))
            return {"error": {"code": "STATUS_CHECK_FAILED", "message": str(e)}}


async def create_objective_room(objective: str, repository_path: str) -> dict[str, Any]:
    """Create a coordination room for an orchestration objective."""
    try:
        # Generate room name from objective
        room_name = f"orchestration-{hash(objective) % 10000:04d}"
        
        comm_service = CommunicationService(repository_path)
        result = await comm_service.create_room(room_name, f"Coordination room for: {objective}")
        
        if result.get("success"):
            return {
                "success": True,
                "room_name": room_name,
                "objective": objective,
            }
        else:
            return {"success": False, "error": result.get("error", "Unknown error")}
            
    except Exception as e:
        logger.error("Failed to create objective room", objective=objective, error=str(e))
        return {"success": False, "error": str(e)}


async def spawn_architect_agent(
    objective: str,
    repository_path: str,
    room_name: str,
    foundation_session_id: str = "",
) -> dict[str, Any]:
    """Spawn an architect agent to analyze and coordinate the objective."""
    try:
        # Import here to avoid circular imports
        from .agents import _spawn_single_agent
        
        architect_task = f"""
        ROLE: Architect Agent - Objective Coordinator
        
        OBJECTIVE: {objective}
        REPOSITORY: {repository_path}
        COORDINATION ROOM: {room_name}
        
        RESPONSIBILITIES:
        1. Analyze the objective and break it into concrete, actionable tasks
        2. Determine what types of specialized agents are needed (backend, frontend, testing, documentation, etc.)
        3. Spawn appropriate agents with clear task descriptions and dependencies
        4. Monitor progress and coordinate agent communication in the room
        5. Ensure all parts of the objective are completed successfully
        
        APPROACH:
        - Start by analyzing the repository structure and existing code
        - Break down the objective into logical phases with clear dependencies
        - Spawn agents in the right order with proper dependency management
        - Use the coordination room for real-time communication and status updates
        - Ensure thorough testing and documentation of all changes
        
        Begin by joining the coordination room and announcing your analysis plan.
        """
        
        return await _spawn_single_agent(
            agent_type="architect",
            repository_path=repository_path,
            task_description=architect_task,
            capabilities=["analysis", "coordination", "spawning", "monitoring"],
            foundation_session_id=foundation_session_id,
            coordination_room=room_name,
        )
        
    except Exception as e:
        logger.error("Failed to spawn architect agent", objective=objective, error=str(e))
        return {"success": False, "error": str(e)}


def _group_by_status(agents: list) -> dict[str, int]:
    """Group agents by their status for statistics."""
    status_counts = {}
    for agent in agents:
        status = agent.get("status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
    return status_counts