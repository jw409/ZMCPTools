"""Shared memory service for cross-agent collaboration."""

import uuid
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import execute_query
from ..models import AgentInsight, SharedMemoryEntry, ToolCallLog

logger = structlog.get_logger()


class SharedMemoryService:
    """Service for shared memory operations across agents."""

    @staticmethod
    async def store_memory_entry(
        repository_path: str,
        agent_id: str,
        entry_type: str,
        title: str,
        content: str,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        relevance_score: float = 1.0,
    ) -> dict[str, Any]:
        """Store a memory entry for cross-agent access.
        
        Args:
            repository_path: Repository path for scoping
            agent_id: ID of the agent storing the entry
            entry_type: Type of entry (tool_call, insight, discovery, result)
            title: Brief title for the entry
            content: Main content of the entry
            tags: Optional tags for categorization
            metadata: Optional metadata
            relevance_score: Relevance score (0.0-1.0)
            
        Returns:
            Dictionary with entry_id and storage result
        """
        async def _store_entry(session: AsyncSession):
            entry_id = str(uuid.uuid4())

            entry = SharedMemoryEntry(
                id=entry_id,
                repository_path=repository_path,
                agent_id=agent_id,
                entry_type=entry_type,
                title=title,
                content=content,
                relevance_score=relevance_score,
            )

            if tags:
                entry.set_tags(tags)
            if metadata:
                entry.set_metadata(metadata)

            session.add(entry)
            await session.commit()

            logger.info("Memory entry stored",
                       entry_id=entry_id,
                       repository_path=repository_path,
                       agent_id=agent_id,
                       entry_type=entry_type,
                       title=title)

            return {
                "entry_id": entry_id,
                "stored_at": entry.created_at.isoformat(),
                "relevance_score": relevance_score,
            }

        return await execute_query(_store_entry)

    @staticmethod
    async def query_memory(
        repository_path: str,
        query_text: str | None = None,
        entry_types: list[str] | None = None,
        tags: list[str] | None = None,
        limit: int = 20,
        min_relevance: float = 0.3,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Query shared memory entries.
        
        Args:
            repository_path: Repository path to query
            query_text: Text to search in title and content
            entry_types: Filter by entry types
            tags: Filter by tags
            limit: Maximum results to return
            min_relevance: Minimum relevance score
            agent_id: Optional agent ID for tracking access
            
        Returns:
            Dictionary with matching entries
        """
        async def _query_memory(session: AsyncSession):
            # Build query
            stmt = select(SharedMemoryEntry).where(
                and_(
                    SharedMemoryEntry.repository_path == repository_path,
                    SharedMemoryEntry.relevance_score >= min_relevance,
                ),
            )

            # Add filters
            if entry_types:
                stmt = stmt.where(SharedMemoryEntry.entry_type.in_(entry_types))

            if query_text:
                search_pattern = f"%{query_text}%"
                stmt = stmt.where(
                    or_(
                        SharedMemoryEntry.title.ilike(search_pattern),
                        SharedMemoryEntry.content.ilike(search_pattern),
                    ),
                )

            if tags:
                # Search for any of the provided tags
                for tag in tags:
                    tag_pattern = f'%"{tag}"%'
                    stmt = stmt.where(SharedMemoryEntry.tags.ilike(tag_pattern))

            # Order by relevance and recency
            stmt = stmt.order_by(
                desc(SharedMemoryEntry.relevance_score),
                desc(SharedMemoryEntry.created_at),
            ).limit(limit)

            result = await session.execute(stmt)
            entries = result.scalars().all()

            # Update access counts
            if agent_id:
                for entry in entries:
                    entry.increment_access()
                await session.commit()

            entry_list = []
            for entry in entries:
                entry_dict = {
                    "entry_id": entry.id,
                    "agent_id": entry.agent_id,
                    "entry_type": entry.entry_type,
                    "title": entry.title,
                    "content": entry.content,
                    "tags": entry.get_tags(),
                    "metadata": entry.get_metadata(),
                    "relevance_score": entry.relevance_score,
                    "created_at": entry.created_at.isoformat(),
                    "accessed_count": entry.accessed_count,
                    "last_accessed": entry.last_accessed.isoformat() if entry.last_accessed else None,
                }
                entry_list.append(entry_dict)

            logger.info("Memory query executed",
                       repository_path=repository_path,
                       query_text=query_text,
                       results_count=len(entry_list),
                       agent_id=agent_id)

            return {
                "entries": entry_list,
                "count": len(entry_list),
                "query": {
                    "text": query_text,
                    "entry_types": entry_types,
                    "tags": tags,
                    "min_relevance": min_relevance,
                },
            }

        return await execute_query(_query_memory)

    @staticmethod
    async def store_insight(
        repository_path: str,
        agent_id: str,
        insight_type: str,
        category: str,
        title: str,
        description: str,
        context: dict[str, Any] | None = None,
        confidence: float = 0.8,
    ) -> dict[str, Any]:
        """Store an agent insight for cross-agent learning.
        
        Args:
            repository_path: Repository path for scoping
            agent_id: ID of the agent storing the insight
            insight_type: Type of insight (pattern, approach, solution, pitfall)
            category: Category (architecture, performance, testing, etc.)
            title: Brief title for the insight
            description: Detailed description
            context: Optional context information
            confidence: Confidence in the insight (0.0-1.0)
            
        Returns:
            Dictionary with insight_id and storage result
        """
        async def _store_insight(session: AsyncSession):
            insight_id = str(uuid.uuid4())

            insight = AgentInsight(
                id=insight_id,
                repository_path=repository_path,
                agent_id=agent_id,
                insight_type=insight_type,
                category=category,
                title=title,
                description=description,
                confidence=confidence,
            )

            if context:
                insight.set_context(context)

            session.add(insight)
            await session.commit()

            logger.info("Agent insight stored",
                       insight_id=insight_id,
                       repository_path=repository_path,
                       agent_id=agent_id,
                       insight_type=insight_type,
                       category=category,
                       title=title)

            return {
                "insight_id": insight_id,
                "stored_at": insight.created_at.isoformat(),
                "confidence": confidence,
            }

        return await execute_query(_store_insight)

    @staticmethod
    async def get_insights(
        repository_path: str,
        categories: list[str] | None = None,
        insight_types: list[str] | None = None,
        min_confidence: float = 0.5,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Get agent insights for learning.
        
        Args:
            repository_path: Repository path to query
            categories: Filter by categories
            insight_types: Filter by insight types
            min_confidence: Minimum confidence threshold
            limit: Maximum results to return
            
        Returns:
            Dictionary with matching insights
        """
        async def _get_insights(session: AsyncSession):
            # Build query
            stmt = select(AgentInsight).where(
                and_(
                    AgentInsight.repository_path == repository_path,
                    AgentInsight.confidence >= min_confidence,
                ),
            )

            # Add filters
            if categories:
                stmt = stmt.where(AgentInsight.category.in_(categories))

            if insight_types:
                stmt = stmt.where(AgentInsight.insight_type.in_(insight_types))

            # Order by usefulness and confidence
            stmt = stmt.order_by(
                desc(AgentInsight.usefulness_score),
                desc(AgentInsight.confidence),
                desc(AgentInsight.created_at),
            ).limit(limit)

            result = await session.execute(stmt)
            insights = result.scalars().all()

            insight_list = []
            for insight in insights:
                insight_dict = {
                    "insight_id": insight.id,
                    "agent_id": insight.agent_id,
                    "insight_type": insight.insight_type,
                    "category": insight.category,
                    "title": insight.title,
                    "description": insight.description,
                    "context": insight.get_context(),
                    "confidence": insight.confidence,
                    "usefulness_score": insight.usefulness_score,
                    "created_at": insight.created_at.isoformat(),
                    "referenced_count": insight.referenced_count,
                }
                insight_list.append(insight_dict)

            logger.info("Insights retrieved",
                       repository_path=repository_path,
                       categories=categories,
                       insight_types=insight_types,
                       results_count=len(insight_list))

            return {
                "insights": insight_list,
                "count": len(insight_list),
                "filters": {
                    "categories": categories,
                    "insight_types": insight_types,
                    "min_confidence": min_confidence,
                },
            }

        return await execute_query(_get_insights)

    @staticmethod
    async def log_tool_call(
        repository_path: str,
        agent_id: str,
        tool_name: str,
        parameters: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
        status: str = "success",
        execution_time: float | None = None,
        error_message: str | None = None,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        """Log a tool call for cross-agent reference.
        
        Args:
            repository_path: Repository path for scoping
            agent_id: ID of the agent making the call
            tool_name: Name of the tool called
            parameters: Tool parameters
            result: Tool result
            status: Call status (success, error, timeout)
            execution_time: Execution time in seconds
            error_message: Error message if failed
            task_id: Optional associated task ID
            
        Returns:
            Dictionary with log_id and logging result
        """
        async def _log_tool_call(session: AsyncSession):
            log_id = str(uuid.uuid4())

            tool_log = ToolCallLog(
                id=log_id,
                repository_path=repository_path,
                agent_id=agent_id,
                task_id=task_id,
                tool_name=tool_name,
                status=status,
                execution_time=execution_time,
                error_message=error_message,
            )

            if parameters:
                tool_log.set_parameters(parameters)
            if result:
                tool_log.set_result(result)

            session.add(tool_log)
            await session.commit()

            logger.info("Tool call logged",
                       log_id=log_id,
                       repository_path=repository_path,
                       agent_id=agent_id,
                       tool_name=tool_name,
                       status=status)

            return {
                "log_id": log_id,
                "logged_at": tool_log.created_at.isoformat(),
                "status": status,
            }

        return await execute_query(_log_tool_call)

    @staticmethod
    async def get_tool_call_history(
        repository_path: str,
        tool_names: list[str] | None = None,
        status_filter: list[str] | None = None,
        agent_id: str | None = None,
        hours_back: int = 24,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Get tool call history for analysis.
        
        Args:
            repository_path: Repository path to query
            tool_names: Filter by tool names
            status_filter: Filter by status
            agent_id: Filter by agent ID
            hours_back: Hours to look back
            limit: Maximum results to return
            
        Returns:
            Dictionary with tool call history
        """
        async def _get_tool_history(session: AsyncSession):
            since_time = datetime.now() - timedelta(hours=hours_back)

            # Build query
            stmt = select(ToolCallLog).where(
                and_(
                    ToolCallLog.repository_path == repository_path,
                    ToolCallLog.created_at >= since_time,
                ),
            )

            # Add filters
            if tool_names:
                stmt = stmt.where(ToolCallLog.tool_name.in_(tool_names))

            if status_filter:
                stmt = stmt.where(ToolCallLog.status.in_(status_filter))

            if agent_id:
                stmt = stmt.where(ToolCallLog.agent_id == agent_id)

            # Order by most recent
            stmt = stmt.order_by(desc(ToolCallLog.created_at)).limit(limit)

            result = await session.execute(stmt)
            logs = result.scalars().all()

            log_list = []
            for log in logs:
                log_dict = {
                    "log_id": log.id,
                    "agent_id": log.agent_id,
                    "task_id": log.task_id,
                    "tool_name": log.tool_name,
                    "parameters": log.get_parameters(),
                    "result": log.get_result(),
                    "status": log.status,
                    "execution_time": log.execution_time,
                    "error_message": log.error_message,
                    "created_at": log.created_at.isoformat(),
                }
                log_list.append(log_dict)

            logger.info("Tool call history retrieved",
                       repository_path=repository_path,
                       tool_names=tool_names,
                       results_count=len(log_list))

            return {
                "tool_calls": log_list,
                "count": len(log_list),
                "filters": {
                    "tool_names": tool_names,
                    "status_filter": status_filter,
                    "agent_id": agent_id,
                    "hours_back": hours_back,
                },
            }

        return await execute_query(_get_tool_history)
