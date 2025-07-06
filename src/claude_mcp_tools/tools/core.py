"""Core orchestration tools for multi-agent coordination."""

from fastmcp import Context
from datetime import datetime, timezone
from typing import Any

import structlog

from ..services.agent_service import AgentService
from ..services.communication_service import CommunicationService
from .app import app

logger = structlog.get_logger("tools.core")


@app.tool(tags={"orchestration", "multi-agent", "coordination", "architect", "objective-planning"})
async def orchestrate_objective(
    ctx: Context,
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
                ctx=ctx,
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


@app.tool(tags={"monitoring", "system", "status", "health-check"})
async def get_system_status(repository_path: str) -> dict[str, Any]:
    """Get comprehensive system status for monitoring orchestration health."""
    try:
        # Get agent statistics (AgentService has all static methods)
        agents_result = await AgentService.list_agents(repository_path=repository_path)
        active_agents = [a for a in agents_result.get("agents", []) if a.get("status") in ["running", "spawning"]]

        # Get communication stats (CommunicationService has all static methods)
        rooms_result = await CommunicationService.list_rooms(repository_path=repository_path)
        active_rooms = rooms_result

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

        # CommunicationService has all static methods
        result = await CommunicationService.create_room(
            name=room_name,
            description=f"Coordination room for: {objective}",
            repository_path=repository_path,
        )

        if result.get("success"):
            return {
                "success": True,
                "room_name": room_name,
                "objective": objective,
            }
        return {"success": False, "error": result.get("error", "Unknown error")}

    except Exception as e:
        logger.error("Failed to create objective room", objective=objective, error=str(e))
        return {"success": False, "error": str(e)}


async def spawn_architect_agent(
    objective: str,
    repository_path: str,
    room_name: str,
    ctx: Context,
    foundation_session_id: str = "",
) -> dict[str, Any]:
    """Spawn an architect agent to analyze and coordinate the objective."""
    try:
        # Import here to avoid circular imports
        from .agents import _spawn_single_agent

        architect_task = f"""
        🏗️ ARCHITECT AGENT - Strategic Orchestration Leader
        
        OBJECTIVE: {objective}
        REPOSITORY: {repository_path}
        COORDINATION ROOM: {room_name}
        
        🎯 MISSION: Execute a structured 3-phase orchestration workflow to achieve the objective through intelligent agent coordination.
        
        =====================================================================
        📍 PHASE 1: RESEARCH & DISCOVERY (MANDATORY - Complete Before Planning)
        =====================================================================
        
        🔍 RESEARCH PROTOCOL:
        1. **Join coordination room** and announce research phase start
        2. **Search shared memory** for relevant past work and patterns
        3. **Analyze repository structure** using project analysis tools
        4. **Assess objective complexity** and determine research needs:
           
           🤖 SPAWN RESEARCH AGENTS WHEN NEEDED:
           - **Documentation Agent**: If objective involves unfamiliar frameworks, APIs, or requires understanding external docs
           - **Analysis Agent**: For large codebases requiring code pattern analysis  
           - **Research Agent**: For technology stack assessment or dependency mapping
           
           Example scenarios requiring documentation agents:
           - "Implement OAuth with Passport.js" → Need Passport.js docs
           - "Add GraphQL API" → Need GraphQL best practices docs
           - "Integrate with Stripe" → Need Stripe API documentation
           - "Migrate to React 18" → Need React 18 migration guides
           
        5. **Wait for research completion** and gather all findings
        6. **Store research insights** in shared memory for team access
        7. **Announce research completion** with key findings summary
        
        ⚠️ CHECKPOINT: Do NOT proceed to planning until research is complete!
        
        =====================================================================
        📍 PHASE 2: STRATEGIC PLANNING (MANDATORY - Complete Before Execution)  
        =====================================================================
        
        🗺️ PLANNING PROTOCOL:
        1. **Synthesize research findings** into actionable intelligence
        2. **Break down objective** into logical phases with clear boundaries
        3. **Identify required agent types** based on research findings:
           - Backend agents for API/server work
           - Frontend agents for UI/UX implementation  
           - Testing agents for QA and validation
           - Documentation agents for user guides/API docs
           - DevOps agents for deployment/infrastructure
           
        4. **Define dependency relationships** between tasks and agents
        5. **Create detailed task descriptions** with specific deliverables
        6. **Validate plan feasibility** against repository constraints
        7. **Store complete plan** in shared memory using:
           ```
           store_memory(
               repository_path=".", 
               agent_id="{agent_id}", 
               entry_type="architecture",
               title="Implementation Plan: {objective[:50]}",
               content="DETAILED PLAN WITH PHASES, AGENTS, DEPENDENCIES, AND DELIVERABLES"
           )
           ```
        8. **Announce plan** to coordination room for team visibility
        
        ⚠️ CHECKPOINT: Do NOT proceed to execution until plan is validated and stored!
        
        =====================================================================
        📍 PHASE 3: COORDINATED EXECUTION (Execute Plan Systematically)
        =====================================================================
        
        🚀 EXECUTION PROTOCOL:
        1. **Spawn agents in dependency order** using spawn_agents_batch for parallel waves
        2. **Monitor agent progress** through coordination room messages
        3. **Handle dependencies** and unblock waiting agents automatically
        4. **Coordinate inter-agent communication** and resolve conflicts
        5. **Track completion status** and identify bottlenecks
        6. **Provide guidance** to agents when they encounter issues
        7. **Ensure quality gates** are met (testing, review, documentation)
        8. **Report final completion** with comprehensive summary
        
        🛠️ AGENT SPAWNING EXAMPLES:
        ```python
        # For documentation research:
        await mcp__claude-mcp-orchestration__spawn_agent(
            agent_type="documentation",
            repository_path=".",
            task_description="Research React 18 migration best practices and document key changes needed"
        )
        
        # For implementation phases:
        await mcp__claude-mcp-orchestration__spawn_agents_batch(
            repository_path=".",
            agents=[
                {{"agent_type": "backend", "task_description": "Implement API endpoints"}},
                {{"agent_type": "frontend", "task_description": "Create UI components", "depends_on": ["backend_agent_id"]}},
                {{"agent_type": "tester", "task_description": "Create comprehensive tests", "depends_on": ["backend_agent_id", "frontend_agent_id"]}}
            ],
            coordination_mode="dependency_based"
        )
        ```
        
        🎯 SUCCESS CRITERIA:
        - All research questions answered before planning
        - Complete plan with dependencies documented in shared memory  
        - All spawned agents complete their tasks successfully
        - Quality gates passed (tests, documentation, review)
        - Objective fully achieved with no missing components
        
        🚨 MANDATORY START SEQUENCE:
        1. Join coordination room: mcp__claude-mcp-orchestration__join_room
        2. Search memory: mcp__claude-mcp-orchestration__search_memory  
        3. Announce: "🏗️ ARCHITECT AGENT starting PHASE 1: RESEARCH for objective: {objective}"
        4. Begin structured research phase immediately
        
        Remember: You are the orchestration leader. Take charge, be systematic, and ensure nothing is missed!
        """

        return await _spawn_single_agent(
            agent_type="architect",
            repository_path=repository_path,
            task_description=architect_task,
            capabilities=["architecture", "coordination", "spawning", "monitoring"],
            foundation_session_id=foundation_session_id,
            coordination_room=room_name,
            ctx=ctx,
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
