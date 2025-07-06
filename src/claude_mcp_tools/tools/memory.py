"""Unified memory and logging tools for cross-agent learning and collaboration."""

from typing import Annotated, Any

import structlog
from fastmcp import Context
from pydantic import Field

from ..services.error_logging_service import ErrorLoggingService
from ..services.shared_memory_service import SharedMemoryService
from .json_utils import parse_json_list, parse_json_dict, check_parsing_error
from .app import app

logger = structlog.get_logger("tools.memory")


@app.tool(tags={"memory", "learning", "collaboration", "knowledge-sharing"})
async def store_memory(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    agent_id: Annotated[str, Field(
        description="ID of the agent storing the memory",
    )],
    entry_type: Annotated[str, Field(
        description="Type of memory entry",
        pattern=r"^(insight|pattern|solution|error|learning|decision|discovery|result|bug|feature|architecture|performance|optimization)$",
    )],
    title: Annotated[str, Field(
        description="Brief, descriptive title for the memory entry",
        min_length=1,
        max_length=200,
    )],
    content: Annotated[str, Field(
        description="Detailed content of the memory - what you learned, discovered, or want other agents to know",
        min_length=1,
        max_length=5000,
    )],
    category: Annotated[str | None, Field(
        description="Category of the memory",
        pattern=r"^(code|design|testing|deployment|maintenance|documentation|architecture|performance)$",
        default=None,
    )] = None,
    tags: Annotated[str | list[str] | None, Field(
        description="Tags for easy searching. Can be JSON array: ['database', 'bug-fix', 'performance', 'react']",
        default=None,
    )] = None,
    misc_data: Annotated[str | dict[str, Any] | None, Field(
        description='Additional structured data. Can be JSON object: {"priority": "high", "framework": "react"}',
        default=None,
    )] = None,
    context: Annotated[str | dict[str, Any] | None, Field(
        description='Context about when/why this memory was created. Can be JSON object: {"task": "user-auth", "files": ["auth.py"]}',
        default=None,
    )] = None,
    confidence: Annotated[float, Field(
        description="How confident are you in this memory (0.0-1.0)",
        ge=0.0,
        le=1.0,
    )] = 0.8,
) -> dict[str, Any]:
    """Store knowledge in shared memory for other agents to learn from.
    
    Use this to save important discoveries, insights, patterns, solutions, or any knowledge
    that would help other agents working on this project. Think of it as the team's shared brain.
    
    Examples:
    - "Found that React components in this codebase use hooks pattern" 
    - "Database connection issues fixed by updating connection pool settings"
    - "Performance improved 50% by caching API responses in Redis"
    - "Bug in user authentication caused by missing session validation"
    """
    try:
        # Parse parameters if provided as JSON strings
        parsed_tags = parse_json_list(tags, "tags")
        if check_parsing_error(parsed_tags):
            return parsed_tags
        final_tags: list[str] | None = parsed_tags

        parsed_misc_data = parse_json_dict(misc_data, "misc_data")
        if check_parsing_error(parsed_misc_data):
            return parsed_misc_data
        final_misc_data: dict[str, Any] | None = parsed_misc_data

        parsed_context = parse_json_dict(context, "context")
        if check_parsing_error(parsed_context):
            return parsed_context
        final_context: dict[str, Any] | None = parsed_context

        result = await SharedMemoryService.store_memory(
            repository_path=repository_path,
            agent_id=agent_id,
            entry_type=entry_type,
            title=title,
            content=content,
            category=category,
            tags=final_tags,
            misc_data=final_misc_data,
            context=final_context,
            confidence=confidence,
        )
        return result

    except Exception as e:
        logger.error("Error storing memory", agent_id=agent_id, error=str(e))
        return {"error": {"code": "STORE_MEMORY_FAILED", "message": str(e)}}


@app.tool(tags={"memory", "search", "learning", "knowledge-retrieval"})
async def search_memory(
    ctx: Context,
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    query_text: Annotated[str, Field(
        description="What are you looking for? Describe it naturally - will search titles and content",
        min_length=1,
        max_length=500,
    )],
    entry_types: Annotated[str | list[str] | None, Field(
        description="Filter by memory types. Can be JSON array: ['insight', 'pattern', 'solution', 'bug', 'performance']",
        default=None,
    )] = None,
    categories: Annotated[str | list[str] | None, Field(
        description="Filter by categories. Can be JSON array: ['architecture', 'performance', 'testing', 'code']",
        default=None,
    )] = None,
    tags: Annotated[str | list[str] | None, Field(
        description="Filter by tags. Can be JSON array: ['database', 'react', 'authentication', 'api']",
        default=None,
    )] = None,
    agent_filter: Annotated[str | None, Field(
        description="Only show memories from this specific agent",
        default=None,
    )] = None,
    limit: Annotated[int, Field(
        description="Maximum number of results to return",
        ge=1,
        le=100,
    )] = 10,
    min_confidence: Annotated[float, Field(
        description="Minimum confidence level (0.0-1.0)",
        ge=0.0,
        le=1.0,
    )] = 0.3,
) -> dict[str, Any]:
    """Search the shared memory for relevant knowledge from other agents.
    
    Use this BEFORE starting work to learn from what other agents have already discovered.
    Search for patterns, solutions, known issues, best practices, or any relevant knowledge.
    
    Examples:
    - "authentication problems" - find auth-related issues and solutions
    - "performance optimization" - learn about speed improvements  
    - "database connection" - see how others handled DB issues
    - "react component patterns" - learn coding patterns used in this project
    """
    try:
        # Parse list parameters if provided as JSON strings
        parsed_entry_types = parse_json_list(entry_types, "entry_types")
        if check_parsing_error(parsed_entry_types):
            return parsed_entry_types
        final_entry_types: list[str] | None = parsed_entry_types

        parsed_categories = parse_json_list(categories, "categories")
        if check_parsing_error(parsed_categories):
            return parsed_categories
        final_categories: list[str] | None = parsed_categories

        parsed_tags = parse_json_list(tags, "tags")
        if check_parsing_error(parsed_tags):
            return parsed_tags
        final_tags: list[str] | None = parsed_tags

        result = await SharedMemoryService.search_memory(
            repository_path=repository_path,
            query_text=query_text,
            entry_types=final_entry_types,
            categories=final_categories,
            tags=final_tags,
            agent_filter=agent_filter,
            limit=limit,
            min_confidence=min_confidence,
            requesting_agent_id=getattr(ctx, 'agent_id', None),
        )
        return result

    except Exception as e:
        logger.error("Error searching memory", query=query_text, error=str(e))
        return {"error": {"code": "SEARCH_MEMORY_FAILED", "message": str(e)}}


@app.tool(tags={"logging", "tool-calls", "debugging", "performance"})
async def log_tool_call(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    agent_id: Annotated[str, Field(
        description="ID of the agent making the tool call",
    )],
    tool_name: Annotated[str, Field(
        description="Name of the tool being called",
        min_length=1,
        max_length=100,
    )],
    parameters: Annotated[dict[str, Any] | str | None, Field(
        description='Parameters passed to the tool. Provide as object: {"file_path": "src/main.py", "backup": true}',
        default=None,
    )] = None,
    result: Annotated[dict[str, Any] | str | None, Field(
        description='Result returned by the tool. Provide as object: {"success": true, "count": 42}',
        default=None,
    )] = None,
    status: Annotated[str, Field(
        description="Status of the tool call",
        pattern=r"^(success|error|timeout|cancelled)$",
    )] = "success",
    execution_time_ms: Annotated[int | None, Field(
        description="Execution time in milliseconds",
        ge=0,
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Log tool calls with parameters and results for caching and optimization."""
    try:
        # Parse parameters and result if they are strings
        import json
        parsed_parameters = parameters
        if isinstance(parameters, str):
            try:
                parsed_parameters = json.loads(parameters)
            except json.JSONDecodeError:
                parsed_parameters = {"raw_params": parameters}
        
        parsed_result = result
        if isinstance(result, str):
            try:
                parsed_result = json.loads(result)
            except json.JSONDecodeError:
                parsed_result = {"raw_result": result}
        
        # Tool call logging would go in a dedicated service - placeholder implementation
        import uuid
        from datetime import datetime, timezone
        result_data = {
            "success": True,
            "log_id": str(uuid.uuid4()),
            "logged_at": datetime.now(timezone.utc).isoformat(),
            "repository_path": repository_path,
            "agent_id": agent_id,
            "tool_name": tool_name,
            "parameters": parsed_parameters,
            "result": parsed_result,
            "status": status,
            "execution_time_ms": execution_time_ms,
            "note": "Tool call logging for caching and optimization (placeholder)"
        }
        return result_data

    except Exception as e:
        logger.error("Error logging tool call", tool=tool_name, error=str(e))
        return {"error": {"code": "LOG_TOOL_CALL_FAILED", "message": str(e)}}


@app.tool(tags={"logging", "tool-calls", "history", "analytics", "caching"})
async def get_tool_call_history(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    agent_id: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None,
    )] = None,
    tool_names: Annotated[str | list[str] | None, Field(
        description="Filter by tool names. Can be JSON array: ['Read', 'Edit', 'Bash']",
        default=None,
    )] = None,
    status_filter: Annotated[str | list[str] | None, Field(
        description="Filter by call status. Can be JSON array: ['success', 'error', 'timeout']",
        default=None,
    )] = None,
    limit: Annotated[int, Field(
        description="Maximum number of tool calls to return",
        ge=1,
        le=1000,
    )] = 100,
) -> dict[str, Any]:
    """Retrieve tool call history for caching and optimization."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_tool_names = parse_json_list(tool_names, "tool_names")
        if check_parsing_error(parsed_tool_names):
            return parsed_tool_names
        final_tool_names: list[str] | None = parsed_tool_names

        parsed_status_filter = parse_json_list(status_filter, "status_filter")
        if check_parsing_error(parsed_status_filter):
            return parsed_status_filter
        final_status_filter: list[str] | None = parsed_status_filter

        # Tool call history would come from dedicated service - placeholder implementation
        result = {
            "success": True,
            "tool_calls": [],
            "count": 0,
            "repository_path": repository_path,
            "filters": {
                "agent_id": agent_id,
                "tool_names": final_tool_names,
                "status_filter": final_status_filter,
                "limit": limit
            },
            "note": "Tool call history for caching optimization (placeholder implementation)"
        }
        return result

    except Exception as e:
        logger.error("Error getting tool call history", error=str(e))
        return {"error": {"code": "GET_TOOL_HISTORY_FAILED", "message": str(e)}}


# Legacy tools have been removed - use store_memory and search_memory instead




@app.tool(tags={"error-logging", "debugging", "troubleshooting", "monitoring"})
async def log_error(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    error_type: Annotated[str, Field(
        description="Type of error",
        pattern=r"^(runtime|validation|network|file_system|mcp_tool|agent_communication)$",
    )],
    error_category: Annotated[str, Field(
        description="Category of the error",
        pattern=r"^(critical|warning|info|debug)$",
    )],
    error_message: Annotated[str, Field(
        description="Error message",
        min_length=1,
        max_length=1000,
    )],
    agent_id: Annotated[str | None, Field(
        description="ID of the agent that encountered the error",
        default=None,
    )] = None,
    error_context: Annotated[dict[str, Any] | str | None, Field(
        description='Additional context about the error. Provide as object: {"function": "parse_data", "line": 42}',
        default=None,
    )] = None,
    environment: Annotated[dict[str, Any] | str | None, Field(
        description="Environment information when error occurred (JSON object or string)",
        default=None,
    )] = None,
    stack_trace: Annotated[str | None, Field(
        description="Stack trace if available",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Log errors with context and environment information."""
    try:
        # Parse environment and context if strings
        import json
        parsed_environment: dict[str, Any] | None = environment if isinstance(environment, dict) else None
        if isinstance(environment, str):
            try:
                parsed_environment = json.loads(environment)
            except json.JSONDecodeError:
                parsed_environment = {"raw_environment": environment}
        
        parsed_error_context: dict[str, Any] | None = error_context if isinstance(error_context, dict) else None
        if isinstance(error_context, str):
            try:
                parsed_error_context = json.loads(error_context)
            except json.JSONDecodeError:
                parsed_error_context = {"raw_context": error_context}
        
        result = await ErrorLoggingService.log_error(
            repository_path=repository_path,
            error_type=error_type,
            error_category=error_category,
            error_message=error_message,
            agent_id=agent_id,
            error_context=parsed_error_context,
            environment=parsed_environment,
            error_details=stack_trace,
        )
        return result

    except Exception as e:
        logger.error("Error logging error", error=str(e))
        return {"error": {"code": "LOG_ERROR_FAILED", "message": str(e)}}


@app.tool(tags={"error-logging", "monitoring", "debugging", "system-health"})
async def get_recent_errors(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    hours_back: Annotated[int, Field(
        description="Number of hours back to search for errors",
        ge=1,
        le=168,  # One week
    )] = 24,
    error_types: Annotated[str | list[str] | None, Field(
        description="Filter by error types. Can be JSON array: ['system', 'validation', 'runtime']",
        default=None,
    )] = None,
    severity_filter: Annotated[str | list[str] | None, Field(
        description="Filter by error severity. Can be JSON array: ['low', 'medium', 'high', 'critical']",
        default=None,
    )] = None,
    agent_filter: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None,
    )] = None,
    limit: Annotated[int, Field(
        description="Maximum number of errors to return",
        ge=1,
        le=500,
    )] = 50,
) -> dict[str, Any]:
    """Retrieve recent errors with filtering."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_error_types = parse_json_list(error_types, "error_types")
        if check_parsing_error(parsed_error_types):
            return parsed_error_types
        final_error_types: list[str] | None = parsed_error_types

        parsed_severity_filter = parse_json_list(severity_filter, "severity_filter")
        if check_parsing_error(parsed_severity_filter):
            return parsed_severity_filter
        final_severity_filter: list[str] | None = parsed_severity_filter

        result = await ErrorLoggingService.get_recent_errors(
            repository_path=repository_path,
            hours_back=hours_back,
            error_types=final_error_types,
            severity_filter=final_severity_filter,
            status_filter="unresolved",
            limit=limit,
        )
        
        # Client-side filtering by agent if agent_filter is provided
        if result.get("errors") and agent_filter:
            filtered_errors = []
            for error in result["errors"]:
                if error.get("agent_id") == agent_filter:
                    filtered_errors.append(error)
            result["errors"] = filtered_errors
            result["count"] = len(filtered_errors)
            result["filters"]["agent_filter"] = agent_filter
        return result

    except Exception as e:
        logger.error("Error getting recent errors", error=str(e))
        return {"error": {"code": "GET_RECENT_ERRORS_FAILED", "message": str(e)}}


@app.tool(tags={"error-logging", "resolution", "knowledge-building", "troubleshooting"})
async def resolve_error(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    error_id: Annotated[str, Field(
        description="ID of the error to resolve",
    )],
    resolution_description: Annotated[str, Field(
        description="Description of how the error was resolved",
        min_length=1,
        max_length=1000,
    )],
    resolved_by_agent_id: Annotated[str | None, Field(
        description="ID of the agent that resolved the error",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Mark an error as resolved with solution description."""
    try:
        result = await ErrorLoggingService.resolve_error(
            error_id=error_id,
            resolution_details=resolution_description,
            create_learning=True,
        )
        
        # Add the repository_path and resolved_by_agent_id to the result for client awareness
        if result.get("error_id"):
            result["repository_path"] = repository_path
            result["resolved_by_agent_id"] = resolved_by_agent_id
        return result

    except Exception as e:
        logger.error("Error resolving error", error_id=error_id, error=str(e))
        return {"error": {"code": "RESOLVE_ERROR_FAILED", "message": str(e)}}




@app.tool(tags={"error-logging", "pattern-analysis", "system-improvement", "analytics"})
async def get_error_patterns(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
) -> dict[str, Any]:
    """Analyze error patterns and trends."""
    try:
        result = await ErrorLoggingService.get_error_patterns(
            repository_path=repository_path,
        )
        return result

    except Exception as e:
        logger.error("Error getting error patterns", error=str(e))
        return {"error": {"code": "GET_ERROR_PATTERNS_FAILED", "message": str(e)}}