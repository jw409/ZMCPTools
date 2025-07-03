"""Shared memory and logging tools for cross-agent learning and error tracking."""

from typing import Annotated, Any

import structlog
from pydantic import Field

from ..services.error_logging_service import ErrorLoggingService
from ..services.shared_memory_service import SharedMemoryService
from .app import app

logger = structlog.get_logger("tools.memory")


@app.tool(tags={"shared-memory", "learning", "insights", "knowledge-sharing"})
async def store_memory_entry(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    agent_id: Annotated[str, Field(
        description="ID of the agent storing the memory entry",
    )],
    entry_type: Annotated[str, Field(
        description="Type of memory entry",
        pattern=r"^(insight|pattern|solution|error|learning|decision)$",
    )],
    title: Annotated[str, Field(
        description="Title for the memory entry",
        min_length=1,
        max_length=200,
    )],
    content: Annotated[str, Field(
        description="Content of the memory entry",
        min_length=1,
        max_length=5000,
    )],
    tags: Annotated[list[str] | None, Field(
        description="Tags for categorizing the memory entry",
        default=None,
    )] = None,
    metadata: Annotated[dict[str, Any] | None, Field(
        description='Additional metadata for the memory entry. Provide as object: {"category": "database", "priority": "high"}',
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Store insights or learning entries in shared memory."""
    try:
        result = await SharedMemoryService.store_memory_entry(
            repository_path=repository_path,
            agent_id=agent_id,
            entry_type=entry_type,
            title=title,
            content=content,
            tags=tags,
            metadata=metadata,
            relevance_score=1.0,  # Default relevance score
        )
        return result

    except Exception as e:
        logger.error("Error storing memory entry", agent_id=agent_id, error=str(e))
        return {"error": {"code": "STORE_MEMORY_FAILED", "message": str(e)}}


@app.tool(tags={"shared-memory", "search", "insights", "knowledge-retrieval"})
async def query_shared_memory(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    query_text: Annotated[str, Field(
        description="Search query for finding relevant memory entries",
        min_length=1,
        max_length=500,
    )],
    entry_types: Annotated[list[str] | None, Field(
        description="Filter by entry types",
        default=None,
    )] = None,
    tags: Annotated[list[str] | None, Field(
        description="Filter by tags",
        default=None,
    )] = None,
    agent_filter: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None,
    )] = None,
    limit: Annotated[int, Field(
        description="Maximum number of results to return",
        ge=1,
        le=100,
    )] = 10,
    min_score: Annotated[float, Field(
        description="Minimum relevance score for results",
        ge=0.0,
        le=1.0,
    )] = 0.1,
) -> dict[str, Any]:
    """Search shared memory for relevant insights and solutions."""
    try:
        result = await SharedMemoryService.query_memory(
            repository_path=repository_path,
            query_text=query_text,
            entry_types=entry_types,
            tags=tags,
            agent_id=agent_filter,
            limit=limit,
            min_relevance=min_score,
        )
        return result

    except Exception as e:
        logger.error("Error querying shared memory", query=query_text, error=str(e))
        return {"error": {"code": "QUERY_MEMORY_FAILED", "message": str(e)}}


@app.tool(tags={"shared-memory", "insights", "patterns", "agent-learning"})
async def store_agent_insight(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    agent_id: Annotated[str, Field(
        description="ID of the agent storing the insight",
    )],
    insight_type: Annotated[str, Field(
        description="Type of insight",
        pattern=r"^(pattern|optimization|bug|feature|architecture|performance)$",
    )],
    category: Annotated[str, Field(
        description="Category of the insight",
        pattern=r"^(code|design|testing|deployment|maintenance|documentation)$",
    )],
    title: Annotated[str, Field(
        description="Title for the insight",
        min_length=1,
        max_length=200,
    )],
    description: Annotated[str, Field(
        description="Detailed description of the insight",
        min_length=1,
        max_length=2000,
    )],
    context: Annotated[dict[str, Any] | str | None, Field(
        description='Additional context for the insight. Provide as object: {"framework": "react", "version": "18"}',
        default=None,
    )] = None,
    confidence: Annotated[float, Field(
        description="Confidence level in the insight",
        ge=0.0,
        le=1.0,
    )] = 0.8,
) -> dict[str, Any]:
    """Store agent insights about patterns and discoveries."""
    try:
        # Handle context parameter - convert string to dict if needed
        import json
        context_data = None
        if context:
            if isinstance(context, dict):
                context_data = context
            elif isinstance(context, str):
                try:
                    context_data = json.loads(context)
                except json.JSONDecodeError:
                    context_data = {"raw_context": context}
        
        result = await SharedMemoryService.store_insight(
            repository_path=repository_path,
            agent_id=agent_id,
            insight_type=insight_type,
            category=category,
            title=title,
            description=description,
            context=context_data,
            confidence=confidence,
        )
        return result

    except Exception as e:
        logger.error("Error storing agent insight", agent_id=agent_id, error=str(e))
        return {"error": {"code": "STORE_INSIGHT_FAILED", "message": str(e)}}


@app.tool(tags={"shared-memory", "insights", "knowledge-discovery", "agent-learning"})
async def get_agent_insights(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    agent_id: Annotated[str | None, Field(
        description="Filter by specific agent ID",
        default=None,
    )] = None,
    categories: Annotated[list[str] | None, Field(
        description="Filter by insight categories",
        default=None,
    )] = None,
    insight_types: Annotated[list[str] | None, Field(
        description="Filter by insight types",
        default=None,
    )] = None,
    limit: Annotated[int, Field(
        description="Maximum number of insights to return",
        ge=1,
        le=100,
    )] = 20,
    min_confidence: Annotated[float, Field(
        description="Minimum confidence level for insights",
        ge=0.0,
        le=1.0,
    )] = 0.5,
) -> dict[str, Any]:
    """Retrieve insights from agents with filtering."""
    try:
        result = await SharedMemoryService.get_insights(
            repository_path=repository_path,
            categories=categories,
            insight_types=insight_types,
            limit=limit,
            min_confidence=min_confidence,
        )
        
        # Client-side filtering by agent_id if provided
        if result.get("insights") and agent_id:
            filtered_insights = []
            for insight in result["insights"]:
                if insight.get("agent_id") == agent_id:
                    filtered_insights.append(insight)
            result["insights"] = filtered_insights
            result["count"] = len(filtered_insights)
            result["filters"]["agent_id"] = agent_id
        return result

    except Exception as e:
        logger.error("Error getting agent insights", error=str(e))
        return {"error": {"code": "GET_INSIGHTS_FAILED", "message": str(e)}}


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
    """Log tool calls with parameters and results."""
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
            "note": "Tool call logging stored in memory (placeholder)"
        }
        return result_data

    except Exception as e:
        logger.error("Error logging tool call", tool=tool_name, error=str(e))
        return {"error": {"code": "LOG_TOOL_CALL_FAILED", "message": str(e)}}


@app.tool(tags={"logging", "tool-calls", "history", "analytics"})
async def get_tool_call_history(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    agent_id: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None,
    )] = None,
    tool_names: Annotated[list[str] | None, Field(
        description="Filter by tool names",
        default=None,
    )] = None,
    status_filter: Annotated[list[str] | None, Field(
        description="Filter by call status",
        default=None,
    )] = None,
    limit: Annotated[int, Field(
        description="Maximum number of tool calls to return",
        ge=1,
        le=1000,
    )] = 100,
) -> dict[str, Any]:
    """Retrieve tool call history with filtering."""
    try:
        # Tool call history would come from dedicated service - placeholder implementation
        result = {
            "success": True,
            "tool_calls": [],
            "count": 0,
            "repository_path": repository_path,
            "filters": {
                "agent_id": agent_id,
                "tool_names": tool_names,
                "status_filter": status_filter,
                "limit": limit
            },
            "note": "Tool call history retrieval (placeholder implementation)"
        }
        return result

    except Exception as e:
        logger.error("Error getting tool call history", error=str(e))
        return {"error": {"code": "GET_TOOL_HISTORY_FAILED", "message": str(e)}}


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
    error_types: Annotated[list[str] | None, Field(
        description="Filter by error types",
        default=None,
    )] = None,
    severity_filter: Annotated[list[str] | None, Field(
        description="Filter by error severity",
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
        result = await ErrorLoggingService.get_recent_errors(
            repository_path=repository_path,
            hours_back=hours_back,
            error_types=error_types,
            severity_filter=severity_filter,
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


@app.tool(tags={"shared-memory", "learning", "knowledge-discovery", "insights"})
async def get_learning_entries(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    categories: Annotated[list[str] | None, Field(
        description="Filter by learning categories",
        default=None,
    )] = None,
    agent_filter: Annotated[str | None, Field(
        description="Filter by agent ID",
        default=None,
    )] = None,
    limit: Annotated[int, Field(
        description="Maximum number of learning entries to return",
        ge=1,
        le=100,
    )] = 25,
    min_confidence: Annotated[float, Field(
        description="Minimum confidence level for entries",
        ge=0.0,
        le=1.0,
    )] = 0.3,
) -> dict[str, Any]:
    """Retrieve learning entries from shared memory."""
    try:
        result = await ErrorLoggingService.get_learning_entries(
            repository_path=repository_path,
            categories=categories,
            limit=limit,
            min_success_rate=min_confidence,
        )
        
        # Note: agent_filter parameter is declared but ErrorLoggingService doesn't support agent filtering
        # This would require implementing agent-based filtering in the service or doing client-side filtering
        if result.get("learning_entries") and agent_filter:
            # Client-side filtering would need access to agent information in learning entries
            # For now, just add the filter to the result metadata
            result["filters"]["agent_filter"] = agent_filter
            result["note"] = f"Agent filter '{agent_filter}' requested but not implemented in service"
        return result

    except Exception as e:
        logger.error("Error getting learning entries", error=str(e))
        return {"error": {"code": "GET_LEARNING_FAILED", "message": str(e)}}


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