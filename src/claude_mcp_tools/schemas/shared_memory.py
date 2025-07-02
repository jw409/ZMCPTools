"""Pydantic schemas for shared memory and logging MCP tools."""

from typing import Annotated, Any

from pydantic import Field

from . import BaseToolSchema


class StoreMemoryEntrySchema(BaseToolSchema):
    """Schema for store_memory_entry tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    agent_id: Annotated[str, Field(
        description="ID of the agent storing the memory entry"
    )]
    
    entry_type: Annotated[str, Field(
        description="Type of memory entry",
        pattern=r"^(insight|pattern|solution|error|learning|decision)$"
    )]
    
    title: Annotated[str, Field(
        description="Title for the memory entry",
        min_length=1,
        max_length=200
    )]
    
    content: Annotated[str, Field(
        description="Content of the memory entry",
        min_length=1,
        max_length=5000
    )]
    
    tags: Annotated[list[str] | None, Field(
        description="Tags for categorizing the memory entry",
        default=None
    )]
    
    metadata: Annotated[dict[str, Any] | None, Field(
        description="Additional metadata for the memory entry (JSON object)",
        default=None
    )]
    
    importance: Annotated[str, Field(
        description="Importance level of the memory entry",
        pattern=r"^(low|medium|high|critical)$"
    )] = "medium"


class QuerySharedMemorySchema(BaseToolSchema):
    """Schema for query_shared_memory tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    query_text: Annotated[str, Field(
        description="Search query for finding relevant memory entries",
        min_length=1,
        max_length=500
    )]
    
    entry_types: Annotated[list[str] | None, Field(
        description="Filter by entry types",
        default=None
    )]
    
    tags: Annotated[list[str] | None, Field(
        description="Filter by tags",
        default=None
    )]
    
    agent_filter: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None
    )]
    
    limit: Annotated[int, Field(
        description="Maximum number of results to return",
        ge=1,
        le=100
    )] = 10
    
    min_score: Annotated[float, Field(
        description="Minimum relevance score for results",
        ge=0.0,
        le=1.0
    )] = 0.1


class StoreAgentInsightSchema(BaseToolSchema):
    """Schema for store_agent_insight tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    agent_id: Annotated[str, Field(
        description="ID of the agent storing the insight"
    )]
    
    insight_type: Annotated[str, Field(
        description="Type of insight",
        pattern=r"^(pattern|optimization|bug|feature|architecture|performance)$"
    )]
    
    category: Annotated[str, Field(
        description="Category of the insight",
        pattern=r"^(code|design|testing|deployment|maintenance|documentation)$"
    )]
    
    title: Annotated[str, Field(
        description="Title for the insight",
        min_length=1,
        max_length=200
    )]
    
    description: Annotated[str, Field(
        description="Detailed description of the insight",
        min_length=1,
        max_length=2000
    )]
    
    context: Annotated[dict[str, Any] | str | None, Field(
        description="Additional context for the insight (JSON object or string)",
        default=None
    )]
    
    confidence: Annotated[float, Field(
        description="Confidence level in the insight",
        ge=0.0,
        le=1.0
    )] = 0.8


class GetAgentInsightsSchema(BaseToolSchema):
    """Schema for get_agent_insights tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    agent_id: Annotated[str | None, Field(
        description="Filter by specific agent ID",
        default=None
    )]
    
    categories: Annotated[list[str] | None, Field(
        description="Filter by insight categories",
        default=None
    )]
    
    insight_types: Annotated[list[str] | None, Field(
        description="Filter by insight types",
        default=None
    )]
    
    limit: Annotated[int, Field(
        description="Maximum number of insights to return",
        ge=1,
        le=100
    )] = 20
    
    min_confidence: Annotated[float, Field(
        description="Minimum confidence level for insights",
        ge=0.0,
        le=1.0
    )] = 0.5


class LogToolCallSchema(BaseToolSchema):
    """Schema for log_tool_call tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    agent_id: Annotated[str, Field(
        description="ID of the agent making the tool call"
    )]
    
    tool_name: Annotated[str, Field(
        description="Name of the tool being called",
        min_length=1,
        max_length=100
    )]
    
    parameters: Annotated[dict[str, Any] | str | None, Field(
        description="Parameters passed to the tool (JSON object or string)",
        default=None
    )]
    
    result: Annotated[dict[str, Any] | str | None, Field(
        description="Result returned by the tool (JSON object or string)",
        default=None
    )]
    
    status: Annotated[str, Field(
        description="Status of the tool call",
        pattern=r"^(success|error|timeout|cancelled)$"
    )] = "success"
    
    execution_time_ms: Annotated[int | None, Field(
        description="Execution time in milliseconds",
        ge=0,
        default=None
    )]


class GetToolCallHistorySchema(BaseToolSchema):
    """Schema for get_tool_call_history tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    agent_id: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None
    )]
    
    tool_names: Annotated[list[str] | None, Field(
        description="Filter by tool names",
        default=None
    )]
    
    status_filter: Annotated[list[str] | None, Field(
        description="Filter by call status",
        default=None
    )]
    
    limit: Annotated[int, Field(
        description="Maximum number of tool calls to return",
        ge=1,
        le=1000
    )] = 100
    
    since_timestamp: Annotated[str | None, Field(
        description="ISO timestamp to get calls since",
        default=None
    )]


class LogErrorSchema(BaseToolSchema):
    """Schema for log_error tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    error_type: Annotated[str, Field(
        description="Type of error",
        pattern=r"^(runtime|validation|network|file_system|mcp_tool|agent_communication)$"
    )]
    
    error_category: Annotated[str, Field(
        description="Category of the error",
        pattern=r"^(critical|warning|info|debug)$"
    )]
    
    error_message: Annotated[str, Field(
        description="Error message",
        min_length=1,
        max_length=1000
    )]
    
    agent_id: Annotated[str | None, Field(
        description="ID of the agent that encountered the error",
        default=None
    )]
    
    context: Annotated[dict[str, Any] | str | None, Field(
        description="Additional context about the error (JSON object or string)",
        default=None
    )]
    
    environment: Annotated[dict[str, Any] | str | None, Field(
        description="Environment information when error occurred (JSON object or string)",
        default=None
    )]
    
    stack_trace: Annotated[str | None, Field(
        description="Stack trace if available",
        default=None
    )]


class GetRecentErrorsSchema(BaseToolSchema):
    """Schema for get_recent_errors tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    hours_back: Annotated[int, Field(
        description="Number of hours back to search for errors",
        ge=1,
        le=168  # One week
    )] = 24
    
    error_types: Annotated[list[str] | None, Field(
        description="Filter by error types",
        default=None
    )]
    
    severity_filter: Annotated[list[str] | None, Field(
        description="Filter by error severity",
        default=None
    )]
    
    agent_filter: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None
    )]
    
    limit: Annotated[int, Field(
        description="Maximum number of errors to return",
        ge=1,
        le=500
    )] = 50


class GetLearningEntriesSchema(BaseToolSchema):
    """Schema for get_learning_entries tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    categories: Annotated[list[str] | None, Field(
        description="Filter by learning categories",
        default=None
    )]
    
    agent_filter: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None
    )]
    
    limit: Annotated[int, Field(
        description="Maximum number of learning entries to return",
        ge=1,
        le=100
    )] = 25
    
    min_confidence: Annotated[float, Field(
        description="Minimum confidence level for entries",
        ge=0.0,
        le=1.0
    )] = 0.3


class ResolveErrorSchema(BaseToolSchema):
    """Schema for resolve_error tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository for context"
    )]
    
    error_id: Annotated[str, Field(
        description="ID of the error to resolve"
    )]
    
    resolution_description: Annotated[str, Field(
        description="Description of how the error was resolved",
        min_length=1,
        max_length=1000
    )]
    
    resolved_by_agent_id: Annotated[str | None, Field(
        description="ID of the agent that resolved the error",
        default=None
    )]