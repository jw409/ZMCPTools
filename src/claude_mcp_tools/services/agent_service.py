"""Agent management service using SQLAlchemy ORM."""

import uuid
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import execute_query
from ..models import AgentCapability, AgentSession, AgentStatus

logger = structlog.get_logger()


class AgentService:
    """Service for agent management operations using SQLAlchemy ORM."""

    @staticmethod
    async def create_agent(
        agent_type: str,
        repository_path: str,
        capabilities: list[str] | None = None,
        initial_context: str = "",
        configuration: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a new agent session.
        
        Args:
            agent_type: Type of agent (researcher, implementer, etc.)
            repository_path: Repository path for the agent
            capabilities: List of agent capabilities
            initial_context: Initial context or instructions
            configuration: Agent-specific configuration
            
        Returns:
            Agent creation result with agent_id
        """
        async def _create_agent(session: AsyncSession):
            # Generate agent ID
            agent_id = str(uuid.uuid4())

            # Create agent instance
            agent = AgentSession(
                id=agent_id,
                agent_name=f"{agent_type}-{agent_id[:8]}",
                repository_path=repository_path,
                status=AgentStatus.ACTIVE,
            )

            # Set capabilities and metadata
            if capabilities:
                agent.set_capabilities(capabilities)

            metadata = {
                "agent_type": agent_type,
                "initial_context": initial_context,
            }
            if configuration:
                metadata.update(configuration)

            agent.set_metadata(metadata)

            # Add to session
            session.add(agent)
            await session.commit()

            # Add capability records
            if capabilities:
                for capability in capabilities:
                    cap_record = AgentCapability(
                        agent_id=agent_id,
                        capability=capability,
                        proficiency_level=3,  # Default proficiency
                    )
                    session.add(cap_record)

                await session.commit()

            logger.info("Agent created",
                       agent_id=agent_id,
                       agent_type=agent_type,
                       repository_path=repository_path,
                       capabilities=capabilities)

            return {
                "agent_id": agent_id,
                "agent_name": agent.agent_name,
                "status": agent.status.value,
                "capabilities": capabilities or [],
                "created_at": agent.created_at.isoformat(),
            }

        try:
            result = await execute_query(_create_agent)
            return {"success": True, **result}
        except Exception as e:
            logger.error("Failed to create agent in database", 
                        agent_id=agent_id, 
                        agent_type=agent_type, 
                        error=str(e))
            return {"success": False, "error": str(e)}

    @staticmethod
    async def get_agent_by_id(agent_id: str) -> dict[str, Any] | None:
        """Get agent by ID.
        
        Args:
            agent_id: Agent ID to retrieve
            
        Returns:
            Agent information or None if not found
        """
        async def _get_agent(session: AsyncSession):
            # Query with eager loading of relationships
            stmt = select(AgentSession).options(
                selectinload(AgentSession.capabilities_rel),
                selectinload(AgentSession.tasks),
            ).where(AgentSession.id == agent_id)

            result = await session.execute(stmt)
            agent = result.scalar_one_or_none()

            if not agent:
                return None

            return {
                "id": agent.id,
                "agent_name": agent.agent_name,
                "repository_path": agent.repository_path,
                "status": agent.status.value,
                "claude_pid": agent.claude_pid,
                "capabilities": agent.get_capabilities(),
                "metadata": agent.get_metadata(),
                "created_at": agent.created_at.isoformat(),
                "last_heartbeat": agent.last_heartbeat.isoformat(),
                "active_tasks": len([t for t in agent.tasks if t.status.value in ["pending", "in_progress"]]),
            }

        return await execute_query(_get_agent)

    @staticmethod
    async def list_agents(
        repository_path: str | None = None,
        status_filter: list[AgentStatus] | None = None,
        agent_type: str | None = None,
    ) -> dict[str, Any]:
        """List agents with optional filtering.
        
        Args:
            repository_path: Filter by repository path
            status_filter: Filter by agent status
            agent_type: Filter by agent type
            
        Returns:
            Dictionary with agents list and metadata
        """
        async def _list_agents(session: AsyncSession):
            # Build query
            stmt = select(AgentSession).options(
                selectinload(AgentSession.capabilities_rel),
                selectinload(AgentSession.tasks),
            )

            # Apply filters
            if repository_path:
                stmt = stmt.where(AgentSession.repository_path == repository_path)

            if status_filter:
                stmt = stmt.where(AgentSession.status.in_(status_filter))

            # Order by last_heartbeat (desc)
            stmt = stmt.order_by(AgentSession.last_heartbeat.desc())

            result = await session.execute(stmt)
            agents = result.scalars().all()

            agent_list = []
            for agent in agents:
                metadata = agent.get_metadata()

                # Filter by agent type if specified
                if agent_type and metadata.get("agent_type") != agent_type:
                    continue

                agent_dict = {
                    "id": agent.id,
                    "agent_name": agent.agent_name,
                    "repository_path": agent.repository_path,
                    "status": agent.status.value,
                    "capabilities": agent.get_capabilities(),
                    "agent_type": metadata.get("agent_type", "unknown"),
                    "created_at": agent.created_at.isoformat(),
                    "last_heartbeat": agent.last_heartbeat.isoformat(),
                    "active_tasks": len([t for t in agent.tasks if t.status.value in ["pending", "in_progress"]]),
                }

                agent_list.append(agent_dict)

            return {
                "agents": agent_list,
                "count": len(agent_list),
                "filters": {
                    "repository_path": repository_path,
                    "status_filter": [s.value for s in status_filter] if status_filter else None,
                    "agent_type": agent_type,
                },
            }

        return await execute_query(_list_agents)

    @staticmethod
    async def update_agent_status(agent_id: str, status: AgentStatus, agent_data: dict[str, Any] | None = None) -> bool:
        """Update agent status and optional agent data.
        
        Args:
            agent_id: Agent ID to update
            status: New agent status
            agent_data: Optional additional agent data (replaces metadata)
            
        Returns:
            True if update successful, False otherwise
        """
        async def _update_status(session: AsyncSession):
            # Get the agent
            stmt = select(AgentSession).where(AgentSession.id == agent_id)
            result = await session.execute(stmt)
            agent = result.scalar_one_or_none()

            if not agent:
                logger.error("Agent not found for status update", agent_id=agent_id)
                return False

            # Update agent
            agent.status = status
            agent.last_heartbeat = datetime.now()

            # Update agent metadata if provided
            if agent_data:
                agent.set_metadata(agent_data)

            await session.commit()

            logger.info("Agent status updated", agent_id=agent_id, status=status.value, has_data=bool(agent_data))
            return True

        return await execute_query(_update_status)

    @staticmethod
    async def heartbeat_agent(agent_id: str) -> bool:
        """Update agent heartbeat timestamp.
        
        Args:
            agent_id: Agent ID to update
            
        Returns:
            True if update successful, False otherwise
        """
        async def _heartbeat(session: AsyncSession):
            # Get the agent
            stmt = select(AgentSession).where(AgentSession.id == agent_id)
            result = await session.execute(stmt)
            agent = result.scalar_one_or_none()

            if not agent:
                return False

            # Update heartbeat
            agent.last_heartbeat = datetime.now()
            await session.commit()

            return True

        return await execute_query(_heartbeat)

    @staticmethod
    async def terminate_agent(agent_id: str) -> bool:
        """Terminate an agent and cleanup resources.
        
        Args:
            agent_id: Agent ID to terminate
            
        Returns:
            True if termination successful, False otherwise
        """
        async def _terminate_agent(session: AsyncSession):
            # Get the agent
            stmt = select(AgentSession).where(AgentSession.id == agent_id)
            result = await session.execute(stmt)
            agent = result.scalar_one_or_none()

            if not agent:
                logger.error("Agent not found for termination", agent_id=agent_id)
                return False

            # Update status to terminated
            agent.status = AgentStatus.TERMINATED
            agent.last_heartbeat = datetime.now()

            await session.commit()

            logger.info("Agent terminated", agent_id=agent_id)
            return True

        return await execute_query(_terminate_agent)

    @staticmethod
    async def complete_agent(agent_id: str) -> bool:
        """Mark an agent as completed when its Claude CLI process finishes.
        
        Args:
            agent_id: Agent ID to mark as completed
            
        Returns:
            True if completion successful, False otherwise
        """
        async def _complete_agent(session: AsyncSession):
            # Get the agent
            stmt = select(AgentSession).where(AgentSession.id == agent_id)
            result = await session.execute(stmt)
            agent = result.scalar_one_or_none()

            if not agent:
                logger.error("Agent not found for completion", agent_id=agent_id)
                return False

            # Update status to completed
            agent.status = AgentStatus.COMPLETED
            agent.last_heartbeat = datetime.now()

            await session.commit()

            logger.info("Agent marked as completed", agent_id=agent_id)
            return True

        return await execute_query(_complete_agent)

    @staticmethod
    async def update_agent_pid(agent_id: str, claude_pid: int) -> bool:
        """Update the Claude CLI process ID for an agent.
        
        Args:
            agent_id: Agent ID to update
            claude_pid: Claude CLI process ID
            
        Returns:
            True if update successful, False otherwise
        """
        async def _update_pid(session: AsyncSession):
            # Get the agent
            stmt = select(AgentSession).where(AgentSession.id == agent_id)
            result = await session.execute(stmt)
            agent = result.scalar_one_or_none()

            if not agent:
                logger.error("Agent not found for PID update", agent_id=agent_id)
                return False

            # Update Claude PID
            agent.claude_pid = claude_pid
            agent.last_heartbeat = datetime.now()

            await session.commit()

            logger.info("Agent PID updated", agent_id=agent_id, claude_pid=claude_pid)
            return True

        return await execute_query(_update_pid)
