"""Pydantic schemas for agent orchestration MCP tools."""

from typing import Annotated, Any

from pydantic import Field

from . import BaseToolSchema


class SpawnAgentSchema(BaseToolSchema):
    """Schema for spawn_agent tool parameters."""
    
    agent_type: Annotated[str, Field(
        description="Type of agent to spawn",
        pattern=r"^(implementer|reviewer|tester|documentation|analyzer|coordinator|backend|frontend|fullstack|devops|architect)$"
    )]
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for agent work"
    )]
    
    task_description: Annotated[str, Field(
        description="Detailed description of the task for the agent",
        min_length=1,
        max_length=2000
    )]
    
    capabilities: Annotated[list[str], Field(
        description="List of specific capabilities the agent should have",
        default_factory=list
    )]
    
    configuration: Annotated[str | dict[str, Any] | None, Field(
        description="Agent-specific configuration (JSON object or string)",
        default=None
    )]
    
    depends_on: Annotated[list[str], Field(
        description="List of agent IDs this agent depends on",
        default_factory=list
    )]
    
    priority: Annotated[str, Field(
        description="Priority level for the agent",
        pattern=r"^(low|medium|high|critical)$"
    )] = "medium"
    
    foundation_session_id: Annotated[str | None, Field(
        description="Foundation session ID for shared context (cost optimization)",
        default=None
    )]


class SpawnAgentsBatchSchema(BaseToolSchema):
    """Schema for spawn_agents_batch tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for agent work"
    )]
    
    agents: Annotated[str | list[dict[str, Any]], Field(
        description="List of agent configurations to spawn (JSON array or string)"
    )]
    
    foundation_session_id: Annotated[str | None, Field(
        description="Foundation session ID for shared context across all agents",
        default=None
    )]
    
    coordination_mode: Annotated[str, Field(
        description="How agents should coordinate",
        pattern=r"^(parallel|sequential|dependency_based)$"
    )] = "dependency_based"


class ListAgentsSchema(BaseToolSchema):
    """Schema for list_agents tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository to filter agents by"
    )]
    
    status_filter: Annotated[list[str] | None, Field(
        description="Filter agents by status (pending, running, completed, failed)",
        default=None
    )]
    
    agent_type_filter: Annotated[str | None, Field(
        description="Filter by agent type",
        default=None
    )]
    
    include_completed: Annotated[bool, Field(
        description="Include completed agents in results"
    )] = True
    
    limit: Annotated[int, Field(
        description="Maximum number of agents to return",
        ge=1,
        le=100
    )] = 50