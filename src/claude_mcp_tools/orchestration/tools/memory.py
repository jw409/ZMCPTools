"""Shared memory and logging tools for cross-agent learning and error tracking."""

from typing import Any

import structlog
from fastmcp import FastMCP

from ...schemas.shared_memory import (
    GetAgentInsightsSchema,
    GetLearningEntriesSchema,
    GetRecentErrorsSchema,
    GetToolCallHistorySchema,
    LogErrorSchema,
    LogToolCallSchema,
    QuerySharedMemorySchema,
    ResolveErrorSchema,
    StoreAgentInsightSchema,
    StoreMemoryEntrySchema,
)
from ...services.error_logging_service import ErrorLoggingService
from ...services.shared_memory_service import SharedMemoryService

logger = structlog.get_logger("orchestration.tools.memory")


def register_memory_tools(app: FastMCP):
    """Register shared memory and logging tools with the FastMCP app."""
    
    @app.tool(
        name="store_memory_entry",
        description="Store insights, patterns, or learning entries in shared memory for cross-agent knowledge sharing",
        tags={"shared-memory", "learning", "insights", "knowledge-sharing"}
    )
    async def store_memory_entry(params: StoreMemoryEntrySchema) -> dict[str, Any]:
        """Store insights or learning entries in shared memory."""
        try:
            memory_service = SharedMemoryService(params.repository_path)
            result = await memory_service.store_memory_entry(
                agent_id=params.agent_id,
                entry_type=params.entry_type,
                title=params.title,
                content=params.content,
                tags=params.tags,  # Already parsed by Pydantic schema
                metadata=params.metadata,  # Already parsed by Pydantic schema
                importance=params.importance,
            )
            return result

        except Exception as e:
            logger.error("Error storing memory entry", agent_id=params.agent_id, error=str(e))
            return {"error": {"code": "STORE_MEMORY_FAILED", "message": str(e)}}

    @app.tool(
        name="query_shared_memory",
        description="Search shared memory for relevant insights, patterns, and solutions from previous agent work",
        tags={"shared-memory", "search", "insights", "knowledge-retrieval"}
    )
    async def query_shared_memory(params: QuerySharedMemorySchema) -> dict[str, Any]:
        """Search shared memory for relevant insights and solutions."""
        try:
            memory_service = SharedMemoryService(params.repository_path)
            result = await memory_service.query_shared_memory(
                query_text=params.query_text,
                entry_types=params.entry_types,  # Already parsed by Pydantic schema
                tags=params.tags,  # Already parsed by Pydantic schema
                agent_filter=params.agent_filter,
                limit=params.limit,
                min_score=params.min_score,
            )
            return result

        except Exception as e:
            logger.error("Error querying shared memory", query=params.query_text, error=str(e))
            return {"error": {"code": "QUERY_MEMORY_FAILED", "message": str(e)}}

    @app.tool(
        name="store_agent_insight",
        description="Store agent insights about patterns, optimizations, and discoveries for future reference",
        tags={"shared-memory", "insights", "patterns", "agent-learning"}
    )
    async def store_agent_insight(params: StoreAgentInsightSchema) -> dict[str, Any]:
        """Store agent insights about patterns and discoveries."""
        try:
            memory_service = SharedMemoryService(params.repository_path)
            result = await memory_service.store_agent_insight(
                agent_id=params.agent_id,
                insight_type=params.insight_type,
                category=params.category,
                title=params.title,
                description=params.description,
                context=params.context,  # Already parsed by Pydantic schema
                confidence=params.confidence,
            )
            return result

        except Exception as e:
            logger.error("Error storing agent insight", agent_id=params.agent_id, error=str(e))
            return {"error": {"code": "STORE_INSIGHT_FAILED", "message": str(e)}}

    @app.tool(
        name="get_agent_insights",
        description="Retrieve insights from agents filtered by category, type, and confidence for knowledge discovery",
        tags={"shared-memory", "insights", "knowledge-discovery", "agent-learning"}
    )
    async def get_agent_insights(params: GetAgentInsightsSchema) -> dict[str, Any]:
        """Retrieve insights from agents with filtering."""
        try:
            memory_service = SharedMemoryService(params.repository_path)
            result = await memory_service.get_agent_insights(
                agent_id=params.agent_id,
                categories=params.categories,  # Already parsed by Pydantic schema
                insight_types=params.insight_types,  # Already parsed by Pydantic schema
                limit=params.limit,
                min_confidence=params.min_confidence,
            )
            return result

        except Exception as e:
            logger.error("Error getting agent insights", error=str(e))
            return {"error": {"code": "GET_INSIGHTS_FAILED", "message": str(e)}}

    @app.tool(
        name="log_tool_call",
        description="Log tool calls with parameters and results for debugging and performance analysis",
        tags={"logging", "tool-calls", "debugging", "performance"}
    )
    async def log_tool_call(params: LogToolCallSchema) -> dict[str, Any]:
        """Log tool calls with parameters and results."""
        try:
            memory_service = SharedMemoryService(params.repository_path)
            result = await memory_service.log_tool_call(
                agent_id=params.agent_id,
                tool_name=params.tool_name,
                parameters=params.parameters,  # Already parsed by Pydantic schema
                result=params.result,  # Already parsed by Pydantic schema
                status=params.status,
                execution_time_ms=params.execution_time_ms,
            )
            return result

        except Exception as e:
            logger.error("Error logging tool call", tool=params.tool_name, error=str(e))
            return {"error": {"code": "LOG_TOOL_CALL_FAILED", "message": str(e)}}

    @app.tool(
        name="get_tool_call_history",
        description="Retrieve tool call history for debugging, performance analysis, and usage patterns",
        tags={"logging", "tool-calls", "history", "analytics"}
    )
    async def get_tool_call_history(params: GetToolCallHistorySchema) -> dict[str, Any]:
        """Retrieve tool call history with filtering."""
        try:
            memory_service = SharedMemoryService(params.repository_path)
            result = await memory_service.get_tool_call_history(
                agent_id=params.agent_id,
                tool_names=params.tool_names,  # Already parsed by Pydantic schema
                status_filter=params.status_filter,  # Already parsed by Pydantic schema
                limit=params.limit,
                since_timestamp=params.since_timestamp,
            )
            return result

        except Exception as e:
            logger.error("Error getting tool call history", error=str(e))
            return {"error": {"code": "GET_TOOL_HISTORY_FAILED", "message": str(e)}}

    @app.tool(
        name="log_error",
        description="Log errors with context and environment information for debugging and pattern analysis",
        tags={"error-logging", "debugging", "troubleshooting", "monitoring"}
    )
    async def log_error(params: LogErrorSchema) -> dict[str, Any]:
        """Log errors with context and environment information."""
        try:
            error_service = ErrorLoggingService(params.repository_path)
            result = await error_service.log_error(
                error_type=params.error_type,
                error_category=params.error_category,
                error_message=params.error_message,
                agent_id=params.agent_id,
                context=params.context,  # Already parsed by Pydantic schema
                environment=params.environment,  # Already parsed by Pydantic schema
                stack_trace=params.stack_trace,
            )
            return result

        except Exception as e:
            logger.error("Error logging error", error=str(e))
            return {"error": {"code": "LOG_ERROR_FAILED", "message": str(e)}}

    @app.tool(
        name="get_recent_errors",
        description="Retrieve recent errors with filtering for debugging and monitoring system health",
        tags={"error-logging", "monitoring", "debugging", "system-health"}
    )
    async def get_recent_errors(params: GetRecentErrorsSchema) -> dict[str, Any]:
        """Retrieve recent errors with filtering."""
        try:
            error_service = ErrorLoggingService(params.repository_path)
            result = await error_service.get_recent_errors(
                hours_back=params.hours_back,
                error_types=params.error_types,  # Already parsed by Pydantic schema
                severity_filter=params.severity_filter,  # Already parsed by Pydantic schema
                agent_filter=params.agent_filter,
                limit=params.limit,
            )
            return result

        except Exception as e:
            logger.error("Error getting recent errors", error=str(e))
            return {"error": {"code": "GET_RECENT_ERRORS_FAILED", "message": str(e)}}

    @app.tool(
        name="resolve_error",
        description="Mark an error as resolved with description of the solution for future reference",
        tags={"error-logging", "resolution", "knowledge-building", "troubleshooting"}
    )
    async def resolve_error(params: ResolveErrorSchema) -> dict[str, Any]:
        """Mark an error as resolved with solution description."""
        try:
            error_service = ErrorLoggingService(params.repository_path)
            result = await error_service.resolve_error(
                error_id=params.error_id,
                resolution_description=params.resolution_description,
                resolved_by_agent_id=params.resolved_by_agent_id,
            )
            return result

        except Exception as e:
            logger.error("Error resolving error", error_id=params.error_id, error=str(e))
            return {"error": {"code": "RESOLVE_ERROR_FAILED", "message": str(e)}}

    @app.tool(
        name="get_learning_entries",
        description="Retrieve learning entries and insights from shared memory for knowledge discovery",
        tags={"shared-memory", "learning", "knowledge-discovery", "insights"}
    )
    async def get_learning_entries(params: GetLearningEntriesSchema) -> dict[str, Any]:
        """Retrieve learning entries from shared memory."""
        try:
            memory_service = SharedMemoryService(params.repository_path)
            result = await memory_service.get_learning_entries(
                categories=params.categories,  # Already parsed by Pydantic schema
                agent_filter=params.agent_filter,
                limit=params.limit,
                min_confidence=params.min_confidence,
            )
            return result

        except Exception as e:
            logger.error("Error getting learning entries", error=str(e))
            return {"error": {"code": "GET_LEARNING_FAILED", "message": str(e)}}

    @app.tool(
        name="get_error_patterns",
        description="Analyze error patterns and trends for proactive issue prevention and system improvement",
        tags={"error-logging", "pattern-analysis", "system-improvement", "analytics"}
    )
    async def get_error_patterns(repository_path: str) -> dict[str, Any]:
        """Analyze error patterns and trends."""
        try:
            error_service = ErrorLoggingService(repository_path)
            result = await error_service.get_error_patterns()
            return result

        except Exception as e:
            logger.error("Error getting error patterns", error=str(e))
            return {"error": {"code": "GET_ERROR_PATTERNS_FAILED", "message": str(e)}}