"""Pydantic schemas for unified memory and logging MCP tools."""

from typing import Annotated, Any

from pydantic import Field

from . import BaseToolSchema


class StoreMemorySchema(BaseToolSchema):
    """Schema for unified store_memory tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    agent_id: Annotated[str, Field(
        description="ID of the agent storing the memory",
    )]

    entry_type: Annotated[str, Field(
        description="Type of memory entry",
        pattern=r"^(insight|pattern|solution|error|learning|decision|discovery|result|bug|feature|architecture|performance|optimization)$",
    )]

    title: Annotated[str, Field(
        description="Brief, descriptive title for the memory entry",
        min_length=1,
        max_length=200,
    )]

    content: Annotated[str, Field(
        description="Detailed content of the memory - what you learned, discovered, or want other agents to know",
        min_length=1,
        max_length=5000,
    )]

    category: Annotated[str | None, Field(
        description="Category of the memory",
        pattern=r"^(code|design|testing|deployment|maintenance|documentation|architecture|performance)$",
        default=None,
    )]

    tags: Annotated[list[str] | None, Field(
        description="Tags for easy searching",
        default=None,
    )]

    misc_data: Annotated[dict[str, Any] | None, Field(
        description='Additional structured data',
        default=None,
    )]

    context: Annotated[dict[str, Any] | None, Field(
        description='Context about when/why this memory was created',
        default=None,
    )]

    confidence: Annotated[float, Field(
        description="How confident are you in this memory (0.0-1.0)",
        ge=0.0,
        le=1.0,
    )] = 0.8


class SearchMemorySchema(BaseToolSchema):
    """Schema for unified search_memory tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    query_text: Annotated[str, Field(
        description="What are you looking for? Describe it naturally - will search titles and content",
        min_length=1,
        max_length=500,
    )]

    entry_types: Annotated[list[str] | None, Field(
        description="Filter by memory types",
        default=None,
    )]

    categories: Annotated[list[str] | None, Field(
        description="Filter by categories",
        default=None,
    )]

    tags: Annotated[list[str] | None, Field(
        description="Filter by tags",
        default=None,
    )]

    agent_filter: Annotated[str | None, Field(
        description="Only show memories from this specific agent",
        default=None,
    )]

    limit: Annotated[int, Field(
        description="Maximum number of results to return",
        ge=1,
        le=100,
    )] = 10

    min_confidence: Annotated[float, Field(
        description="Minimum confidence level (0.0-1.0)",
        ge=0.0,
        le=1.0,
    )] = 0.3


# Legacy schemas for backward compatibility
class StoreMemoryEntrySchema(StoreMemorySchema):
    """Legacy schema - redirects to StoreMemorySchema."""
    pass

class QuerySharedMemorySchema(SearchMemorySchema):
    """Legacy schema - redirects to SearchMemorySchema."""  
    pass

class StoreAgentInsightSchema(StoreMemorySchema):
    """Legacy schema - redirects to StoreMemorySchema."""
    pass

class GetAgentInsightsSchema(SearchMemorySchema):
    """Legacy schema - redirects to SearchMemorySchema."""
    pass


class LogToolCallSchema(BaseToolSchema):
    """Schema for log_tool_call tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    agent_id: Annotated[str, Field(
        description="ID of the agent making the tool call",
    )]

    tool_name: Annotated[str, Field(
        description="Name of the tool being called",
        min_length=1,
        max_length=100,
    )]

    parameters: Annotated[dict[str, Any] | str | None, Field(
        description='Parameters passed to the tool. Provide as object: {"file_path": "src/main.py", "backup": true}',
        default=None,
    )]

    result: Annotated[dict[str, Any] | str | None, Field(
        description='Result returned by the tool. Provide as object: {"success": true, "count": 42}',
        default=None,
    )]

    status: Annotated[str, Field(
        description="Status of the tool call",
        pattern=r"^(success|error|timeout|cancelled)$",
    )] = "success"

    execution_time_ms: Annotated[int | None, Field(
        description="Execution time in milliseconds",
        ge=0,
        default=None,
    )]


class GetToolCallHistorySchema(BaseToolSchema):
    """Schema for get_tool_call_history tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    agent_id: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None,
    )]

    tool_names: Annotated[list[str] | None, Field(
        description="Filter by tool names",
        default=None,
    )]

    status_filter: Annotated[list[str] | None, Field(
        description="Filter by call status",
        default=None,
    )]

    limit: Annotated[int, Field(
        description="Maximum number of tool calls to return",
        ge=1,
        le=1000,
    )] = 100

    since_timestamp: Annotated[str | None, Field(
        description="ISO timestamp to get calls since",
        default=None,
    )]


class LogErrorSchema(BaseToolSchema):
    """Schema for log_error tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    error_type: Annotated[str, Field(
        description="Type of error",
        pattern=r"^(runtime|validation|network|file_system|mcp_tool|agent_communication)$",
    )]

    error_category: Annotated[str, Field(
        description="Category of the error",
        pattern=r"^(critical|warning|info|debug)$",
    )]

    error_message: Annotated[str, Field(
        description="Error message",
        min_length=1,
        max_length=1000,
    )]

    agent_id: Annotated[str | None, Field(
        description="ID of the agent that encountered the error",
        default=None,
    )]

    context: Annotated[dict[str, Any] | str | None, Field(
        description='Additional context about the error. Provide as object: {"function": "parse_data", "line": 42}',
        default=None,
    )]

    environment: Annotated[dict[str, Any] | str | None, Field(
        description="Environment information when error occurred (JSON object or string)",
        default=None,
    )]

    stack_trace: Annotated[str | None, Field(
        description="Stack trace if available",
        default=None,
    )]


class GetRecentErrorsSchema(BaseToolSchema):
    """Schema for get_recent_errors tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    hours_back: Annotated[int, Field(
        description="Number of hours back to search for errors",
        ge=1,
        le=168,  # One week
    )] = 24

    error_types: Annotated[list[str] | None, Field(
        description="Filter by error types",
        default=None,
    )]

    severity_filter: Annotated[list[str] | None, Field(
        description="Filter by error severity",
        default=None,
    )]

    agent_filter: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None,
    )]

    limit: Annotated[int, Field(
        description="Maximum number of errors to return",
        ge=1,
        le=500,
    )] = 50



class ResolveErrorSchema(BaseToolSchema):
    """Schema for resolve_error tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    error_id: Annotated[str, Field(
        description="ID of the error to resolve",
    )]

    resolution_description: Annotated[str, Field(
        description="Description of how the error was resolved",
        min_length=1,
        max_length=1000,
    )]

    resolved_by_agent_id: Annotated[str | None, Field(
        description="ID of the agent that resolved the error",
        default=None,
    )]
