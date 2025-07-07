"""Error logging service for enhanced debugging and learning."""

import hashlib
import re
import uuid
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import execute_query
from ..models import ErrorLog, ErrorPattern, LearningEntry

logger = structlog.get_logger()


class ErrorLoggingService:
    """Service for enhanced error logging and pattern recognition."""

    @staticmethod
    async def log_error(
        repository_path: str,
        error_type: str,
        error_category: str,
        error_message: str,
        agent_id: str | None = None,
        task_id: str | None = None,
        error_details: str | None = None,
        error_context: Any | None = None,
        environment: dict[str, Any] | None = None,
        attempted_solution: str | None = None,
        severity: str = "medium",
    ) -> dict[str, Any]:
        """Log an error with comprehensive context.
        
        Args:
            repository_path: Repository path for scoping
            error_type: Type of error (system, validation, runtime, timeout)
            error_category: Category (mcp_tool, file_operation, network, etc.)
            error_message: Main error message
            agent_id: Optional agent ID
            task_id: Optional task ID
            error_details: Full stack trace or detailed info
            error_context: Context when error occurred
            environment: Environment information
            attempted_solution: What was tried to fix it
            severity: Error severity (low, medium, high, critical)
            
        Returns:
            Dictionary with error_id and logging result
        """
        async def _log_error(session: AsyncSession):
            error_id = str(uuid.uuid4())

            error_log = ErrorLog(
                id=error_id,
                repository_path=repository_path,
                agent_id=agent_id,
                task_id=task_id,
                error_type=error_type,
                error_category=error_category,
                error_message=error_message,
                error_details=error_details,
                attempted_solution=attempted_solution,
                severity=severity,
            )

            if error_context:
                error_log.set_context(error_context.__dict__ if hasattr(error_context, '__dict__') else error_context)
            if environment:
                error_log.set_environment(environment)

            session.add(error_log)

            # Check for existing error patterns
            pattern_id = await ErrorLoggingService._match_or_create_pattern(
                session, repository_path, error_message, error_category,
            )

            if pattern_id:
                error_log.pattern_id = pattern_id

            await session.commit()

            logger.error("Error logged",
                        error_id=error_id,
                        repository_path=repository_path,
                        agent_id=agent_id,
                        error_type=error_type,
                        error_category=error_category,
                        severity=severity,
                        pattern_id=pattern_id)

            return {
                "error_id": error_id,
                "logged_at": error_log.created_at.isoformat(),
                "pattern_id": pattern_id,
                "severity": severity,
            }

        return await execute_query(_log_error)

    @staticmethod
    async def _match_or_create_pattern(
        session: AsyncSession,
        repository_path: str,
        error_message: str,
        error_category: str,
    ) -> str | None:
        """Match error to existing pattern or create new one."""
        # Create error signature (simplified version of the error)
        signature = ErrorLoggingService._create_error_signature(error_message)

        # Look for existing pattern
        stmt = select(ErrorPattern).where(
            and_(
                ErrorPattern.repository_path == repository_path,
                ErrorPattern.error_signature == signature,
            ),
        )

        result = await session.execute(stmt)
        pattern = result.scalar_one_or_none()

        if pattern:
            # Update existing pattern
            pattern.increment_frequency()
            return pattern.id
        # Create new pattern
        pattern_id = str(uuid.uuid4())
        pattern_name = f"{error_category}_{signature[:20]}"

        new_pattern = ErrorPattern(
            id=pattern_id,
            repository_path=repository_path,
            pattern_name=pattern_name,
            error_signature=signature,
            description=f"Pattern for {error_category} errors: {error_message[:100]}...",
        )

        session.add(new_pattern)
        return pattern_id

    @staticmethod
    def _create_error_signature(error_message: str) -> str:
        """Create a normalized signature from error message."""
        # Remove specific details (numbers, paths, IDs) to create pattern
        signature = error_message.lower()

        # Replace common variable parts with placeholders
        signature = re.sub(r"\b\d+\b", "<number>", signature)
        signature = re.sub(r"/[^\s]+", "<path>", signature)
        signature = re.sub(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}", "<uuid>", signature)
        signature = re.sub(r"\b[a-z]+\d+\b", "<id>", signature)

        # Remove extra whitespace
        signature = " ".join(signature.split())

        # Create hash for consistent length
        return hashlib.md5(signature.encode()).hexdigest()[:16]

    @staticmethod
    async def get_error_patterns_safe(
        repository_path: str,
        min_frequency: int = 2,
        days_back: int = 30,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Get error patterns with MCP-safe session management.
        
        This method uses MCP-safe database access patterns to prevent 
        communication channel conflicts in FastMCP resource handlers.
        
        Args:
            repository_path: Repository path to query
            min_frequency: Minimum frequency to include
            days_back: Days to look back
            limit: Maximum results to return
            
        Returns:
            Dictionary with error patterns
        """
        from ..database import mcp_safe_execute_query
        
        async def _get_patterns_safe(session):
            since_time = datetime.now() - timedelta(days=days_back)

            stmt = select(ErrorPattern).where(
                and_(
                    ErrorPattern.repository_path == repository_path,
                    ErrorPattern.frequency >= min_frequency,
                    ErrorPattern.last_occurrence >= since_time,
                ),
            ).order_by(desc(ErrorPattern.frequency)).limit(limit)

            result = await session.execute(stmt)
            patterns = result.scalars().all()

            pattern_list = []
            for pattern in patterns:
                pattern_dict = {
                    "pattern_id": pattern.id,
                    "pattern_name": pattern.pattern_name,
                    "error_signature": pattern.error_signature,
                    "description": pattern.description,
                    "typical_causes": pattern.get_typical_causes() if hasattr(pattern, 'get_typical_causes') else [],
                    "suggested_solutions": pattern.get_suggested_solutions() if hasattr(pattern, 'get_suggested_solutions') else [],
                    "frequency": pattern.frequency,
                    "last_occurrence": pattern.last_occurrence.isoformat(),
                    "confidence_score": pattern.confidence_score if hasattr(pattern, 'confidence_score') else 0.5,
                }
                pattern_list.append(pattern_dict)

            return {
                "patterns": pattern_list,
                "count": len(pattern_list),
                "filters": {
                    "min_frequency": min_frequency,
                    "days_back": days_back,
                },
            }
        
        # Use MCP-safe execution with 3 second timeout for fast response
        try:
            result = await mcp_safe_execute_query(_get_patterns_safe, timeout=3.0)
            return result
        except Exception as e:
            logger.error("MCP-safe get_error_patterns failed", error=str(e))
            return {"error": f"Database error: {e}"}

    @staticmethod
    async def get_error_patterns(
        repository_path: str,
        min_frequency: int = 2,
        days_back: int = 30,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Get error patterns for analysis.
        
        Args:
            repository_path: Repository path to query
            min_frequency: Minimum frequency to include
            days_back: Days to look back
            limit: Maximum results to return
            
        Returns:
            Dictionary with error patterns
        """
        async def _get_patterns(session: AsyncSession):
            since_time = datetime.now() - timedelta(days=days_back)

            stmt = select(ErrorPattern).where(
                and_(
                    ErrorPattern.repository_path == repository_path,
                    ErrorPattern.frequency >= min_frequency,
                    ErrorPattern.last_occurrence >= since_time,
                ),
            ).order_by(desc(ErrorPattern.frequency)).limit(limit)

            result = await session.execute(stmt)
            patterns = result.scalars().all()

            pattern_list = []
            for pattern in patterns:
                pattern_dict = {
                    "pattern_id": pattern.id,
                    "pattern_name": pattern.pattern_name,
                    "error_signature": pattern.error_signature,
                    "description": pattern.description,
                    "typical_causes": pattern.get_typical_causes(),
                    "suggested_solutions": pattern.get_suggested_solutions(),
                    "frequency": pattern.frequency,
                    "last_occurrence": pattern.last_occurrence.isoformat(),
                    "confidence_score": pattern.confidence_score,
                }
                pattern_list.append(pattern_dict)

            logger.info("Error patterns retrieved",
                       repository_path=repository_path,
                       patterns_count=len(pattern_list))

            return {
                "patterns": pattern_list,
                "count": len(pattern_list),
                "filters": {
                    "min_frequency": min_frequency,
                    "days_back": days_back,
                },
            }

        return await execute_query(_get_patterns)

    @staticmethod
    async def resolve_error(
        error_id: str,
        resolution_details: str,
        create_learning: bool = True,
    ) -> dict[str, Any]:
        """Mark an error as resolved and optionally create learning entry.
        
        Args:
            error_id: ID of the error to resolve
            resolution_details: How the error was resolved
            create_learning: Whether to create a learning entry
            
        Returns:
            Dictionary with resolution result
        """
        async def _resolve_error(session: AsyncSession):
            # Get the error
            stmt = select(ErrorLog).where(ErrorLog.id == error_id)
            result = await session.execute(stmt)
            error_log = result.scalar_one_or_none()

            if not error_log:
                return {"error": {"code": "ERROR_NOT_FOUND", "message": "Error not found"}}

            # Mark as resolved
            error_log.mark_resolved(resolution_details)

            learning_id = None
            if create_learning:
                # Create learning entry
                learning_id = str(uuid.uuid4())
                learning = LearningEntry(
                    id=learning_id,
                    repository_path=error_log.repository_path,
                    learning_type="error_resolution",
                    category=error_log.error_category,
                    title=f"Resolution for {error_log.error_type} error",
                    lesson=resolution_details,
                    source_error_id=error_id,
                )

                # Add context from error
                context = error_log.get_context()
                if context:
                    learning.set_context(context)

                session.add(learning)

            await session.commit()

            logger.info("Error resolved",
                       error_id=error_id,
                       learning_created=create_learning,
                       learning_id=learning_id)

            return {
                "error_id": error_id,
                "resolved_at": error_log.resolved_at.isoformat() if error_log.resolved_at else None,
                "learning_id": learning_id,
                "resolution_details": resolution_details,
            }

        return await execute_query(_resolve_error)

    @staticmethod
    async def get_recent_errors_safe(
        repository_path: str,
        error_types: list[str] | None = None,
        severity_filter: list[str] | None = None,
        status_filter: str = "unresolved",
        hours_back: int = 24,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Get recent errors with MCP-safe session management.
        
        This method uses MCP-safe database access patterns to prevent 
        communication channel conflicts in FastMCP resource handlers.
        
        Args:
            repository_path: Repository path to query
            error_types: Filter by error types
            severity_filter: Filter by severity levels
            status_filter: Filter by resolution status
            hours_back: Hours to look back
            limit: Maximum results to return
            
        Returns:
            Dictionary with recent errors
        """
        from ..database import mcp_safe_execute_query
        
        async def _get_recent_errors_safe(session):
            since_time = datetime.now() - timedelta(hours=hours_back)

            # Build query
            stmt = select(ErrorLog).where(
                and_(
                    ErrorLog.repository_path == repository_path,
                    ErrorLog.created_at >= since_time,
                ),
            )

            # Add filters
            if error_types:
                stmt = stmt.where(ErrorLog.error_type.in_(error_types))

            if severity_filter:
                stmt = stmt.where(ErrorLog.severity.in_(severity_filter))

            if status_filter:
                stmt = stmt.where(ErrorLog.resolution_status == status_filter)

            # Order by most recent and severity
            stmt = stmt.order_by(
                desc(ErrorLog.created_at),
                desc(ErrorLog.severity),
            ).limit(limit)

            result = await session.execute(stmt)
            errors = result.scalars().all()

            error_list = []
            for error in errors:
                error_dict = {
                    "error_id": error.id,
                    "agent_id": error.agent_id,
                    "task_id": error.task_id,
                    "error_type": error.error_type,
                    "error_category": error.error_category,
                    "error_message": error.error_message,
                    "error_details": error.error_details,
                    "context": error.get_context() if hasattr(error, 'get_context') else {},
                    "environment": error.get_environment() if hasattr(error, 'get_environment') else {},
                    "attempted_solution": error.attempted_solution,
                    "resolution_status": error.resolution_status,
                    "resolution_details": error.resolution_details,
                    "pattern_id": error.pattern_id,
                    "severity": error.severity,
                    "created_at": error.created_at.isoformat(),
                    "resolved_at": error.resolved_at.isoformat() if error.resolved_at else None,
                }
                error_list.append(error_dict)

            return {
                "errors": error_list,
                "count": len(error_list),
                "filters": {
                    "error_types": error_types,
                    "severity_filter": severity_filter,
                    "status_filter": status_filter,
                    "hours_back": hours_back,
                },
            }
        
        # Use MCP-safe execution with 3 second timeout for fast response
        try:
            result = await mcp_safe_execute_query(_get_recent_errors_safe, timeout=3.0)
            return result
        except Exception as e:
            logger.error("MCP-safe get_recent_errors failed", error=str(e))
            return {"error": f"Database error: {e}"}

    @staticmethod
    async def get_recent_errors(
        repository_path: str,
        error_types: list[str] | None = None,
        severity_filter: list[str] | None = None,
        status_filter: str = "unresolved",
        hours_back: int = 24,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Get recent errors for analysis.
        
        Args:
            repository_path: Repository path to query
            error_types: Filter by error types
            severity_filter: Filter by severity levels
            status_filter: Filter by resolution status
            hours_back: Hours to look back
            limit: Maximum results to return
            
        Returns:
            Dictionary with recent errors
        """
        async def _get_recent_errors(session: AsyncSession):
            since_time = datetime.now() - timedelta(hours=hours_back)

            # Build query
            stmt = select(ErrorLog).where(
                and_(
                    ErrorLog.repository_path == repository_path,
                    ErrorLog.created_at >= since_time,
                ),
            )

            # Add filters
            if error_types:
                stmt = stmt.where(ErrorLog.error_type.in_(error_types))

            if severity_filter:
                stmt = stmt.where(ErrorLog.severity.in_(severity_filter))

            if status_filter:
                stmt = stmt.where(ErrorLog.resolution_status == status_filter)

            # Order by most recent and severity
            stmt = stmt.order_by(
                desc(ErrorLog.created_at),
                desc(ErrorLog.severity),
            ).limit(limit)

            result = await session.execute(stmt)
            errors = result.scalars().all()

            error_list = []
            for error in errors:
                error_dict = {
                    "error_id": error.id,
                    "agent_id": error.agent_id,
                    "task_id": error.task_id,
                    "error_type": error.error_type,
                    "error_category": error.error_category,
                    "error_message": error.error_message,
                    "error_details": error.error_details,
                    "context": error.get_context(),
                    "environment": error.get_environment(),
                    "attempted_solution": error.attempted_solution,
                    "resolution_status": error.resolution_status,
                    "resolution_details": error.resolution_details,
                    "pattern_id": error.pattern_id,
                    "severity": error.severity,
                    "created_at": error.created_at.isoformat(),
                    "resolved_at": error.resolved_at.isoformat() if error.resolved_at else None,
                }
                error_list.append(error_dict)

            logger.info("Recent errors retrieved",
                       repository_path=repository_path,
                       errors_count=len(error_list))

            return {
                "errors": error_list,
                "count": len(error_list),
                "filters": {
                    "error_types": error_types,
                    "severity_filter": severity_filter,
                    "status_filter": status_filter,
                    "hours_back": hours_back,
                },
            }

        return await execute_query(_get_recent_errors)

