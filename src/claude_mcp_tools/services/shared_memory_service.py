"""Unified memory service for cross-agent collaboration."""

import uuid
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import execute_query
from ..models import Memory, ToolCallLog

logger = structlog.get_logger()


class SharedMemoryService:
    """Service for unified memory operations across agents."""

    @staticmethod
    async def store_memory(
        repository_path: str,
        agent_id: str,
        entry_type: str,
        title: str,
        content: str,
        category: str | None = None,
        tags: list[str] | None = None,
        misc_data: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
        confidence: float = 0.8,
        relevance_score: float = 1.0,
    ) -> dict[str, Any]:
        """Store a memory entry for cross-agent access and learning.
        
        Args:
            repository_path: Repository path for scoping
            agent_id: ID of the agent storing the memory
            entry_type: Type of memory (insight, pattern, solution, error, learning, decision, discovery, result)
            title: Brief title for the memory
            content: Main content of the memory
            category: Optional category (architecture, performance, testing, deployment, maintenance, documentation, code, design)
            tags: Optional tags for categorization
            misc_data: Optional miscellaneous data
            context: Optional context information
            confidence: Confidence in the memory (0.0-1.0)
            relevance_score: Relevance score (0.0-1.0)
            
        Returns:
            Dictionary with memory_id and storage result
        """
        async def _store_memory(session: AsyncSession):
            memory_id = str(uuid.uuid4())

            memory = Memory(
                id=memory_id,
                repository_path=repository_path,
                agent_id=agent_id,
                entry_type=entry_type,
                category=category,
                title=title,
                content=content,
                confidence=confidence,
                relevance_score=relevance_score,
            )

            if tags:
                memory.set_tags(tags)
            if misc_data:
                memory.set_misc_data(misc_data)
            if context:
                memory.set_context(context)

            session.add(memory)
            await session.commit()

            logger.info("Memory stored",
                       memory_id=memory_id,
                       repository_path=repository_path,
                       agent_id=agent_id,
                       entry_type=entry_type,
                       category=category,
                       title=title)

            return {
                "memory_id": memory_id,
                "stored_at": memory.created_at.isoformat(),
                "confidence": confidence,
                "relevance_score": relevance_score,
            }

        return await execute_query(_store_memory)

    @staticmethod
    async def search_memory(
        repository_path: str,
        query_text: str | None = None,
        entry_types: list[str] | None = None,
        categories: list[str] | None = None,
        tags: list[str] | None = None,
        agent_filter: str | None = None,
        limit: int = 20,
        min_confidence: float = 0.3,
        min_relevance: float = 0.3,
        requesting_agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Search memory entries with comprehensive filtering.
        
        Args:
            repository_path: Repository path to query
            query_text: Text to search in title and content
            entry_types: Filter by entry types
            categories: Filter by categories
            tags: Filter by tags
            agent_filter: Filter by specific agent ID
            limit: Maximum results to return
            min_confidence: Minimum confidence score
            min_relevance: Minimum relevance score
            requesting_agent_id: ID of agent making the request (for access tracking)
            
        Returns:
            Dictionary with matching memories
        """
        async def _search_memory(session: AsyncSession):
            # Build query
            stmt = select(Memory).where(
                and_(
                    Memory.repository_path == repository_path,
                    Memory.confidence >= min_confidence,
                    Memory.relevance_score >= min_relevance,
                ),
            )

            # Add filters
            if entry_types:
                stmt = stmt.where(Memory.entry_type.in_(entry_types))

            if categories:
                stmt = stmt.where(Memory.category.in_(categories))

            if agent_filter:
                stmt = stmt.where(Memory.agent_id == agent_filter)

            if query_text:
                search_pattern = f"%{query_text}%"
                stmt = stmt.where(
                    or_(
                        Memory.title.ilike(search_pattern),
                        Memory.content.ilike(search_pattern),
                    ),
                )

            if tags:
                # Search for any of the provided tags
                for tag in tags:
                    tag_pattern = f'%"{tag}"%'
                    stmt = stmt.where(Memory.tags.ilike(tag_pattern))

            # Order by relevance, usefulness, confidence, and recency
            stmt = stmt.order_by(
                desc(Memory.usefulness_score),
                desc(Memory.relevance_score),
                desc(Memory.confidence),
                desc(Memory.created_at),
            ).limit(limit)

            result = await session.execute(stmt)
            memories = result.scalars().all()

            # Update access counts
            if requesting_agent_id:
                for memory in memories:
                    memory.increment_access()
                await session.commit()

            memory_list = []
            for memory in memories:
                memory_dict = {
                    "memory_id": memory.id,
                    "agent_id": memory.agent_id,
                    "entry_type": memory.entry_type,
                    "category": memory.category,
                    "title": memory.title,
                    "content": memory.content,
                    "tags": memory.get_tags(),
                    "misc_data": memory.get_misc_data(),
                    "context": memory.get_context(),
                    "confidence": memory.confidence,
                    "relevance_score": memory.relevance_score,
                    "usefulness_score": memory.usefulness_score,
                    "created_at": memory.created_at.isoformat(),
                    "accessed_count": memory.accessed_count,
                    "referenced_count": memory.referenced_count,
                    "last_accessed": memory.last_accessed.isoformat() if memory.last_accessed else None,
                }
                memory_list.append(memory_dict)

            logger.info("Memory search executed",
                       repository_path=repository_path,
                       query_text=query_text,
                       results_count=len(memory_list),
                       requesting_agent_id=requesting_agent_id)

            return {
                "memories": memory_list,
                "count": len(memory_list),
                "query": {
                    "text": query_text,
                    "entry_types": entry_types,
                    "categories": categories,
                    "tags": tags,
                    "agent_filter": agent_filter,
                    "min_confidence": min_confidence,
                    "min_relevance": min_relevance,
                },
            }

        return await execute_query(_search_memory)

    # Legacy methods for backward compatibility - redirect to new unified methods
    @staticmethod
    async def store_memory_entry(
        repository_path: str,
        agent_id: str,
        entry_type: str,
        title: str,
        content: str,
        tags: list[str] | None = None,
        misc_data: dict[str, Any] | None = None,
        relevance_score: float = 1.0,
    ) -> dict[str, Any]:
        """Legacy method - redirects to store_memory."""
        return await SharedMemoryService.store_memory(
            repository_path=repository_path,
            agent_id=agent_id,
            entry_type=entry_type,
            title=title,
            content=content,
            tags=tags,
            misc_data=misc_data,
            relevance_score=relevance_score,
        )

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
        """Legacy method - redirects to search_memory."""
        result = await SharedMemoryService.search_memory(
            repository_path=repository_path,
            query_text=query_text,
            entry_types=entry_types,
            tags=tags,
            limit=limit,
            min_relevance=min_relevance,
            requesting_agent_id=agent_id,
        )
        # Transform response to match legacy format
        result["entries"] = result.pop("memories", [])
        return result

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
        """Legacy method - redirects to store_memory."""
        result = await SharedMemoryService.store_memory(
            repository_path=repository_path,
            agent_id=agent_id,
            entry_type=insight_type,
            title=title,
            content=description,
            category=category,
            context=context,
            confidence=confidence,
        )
        # Transform response to match legacy format
        result["insight_id"] = result.pop("memory_id", result.get("memory_id"))
        return result

    @staticmethod
    async def get_insights(
        repository_path: str,
        categories: list[str] | None = None,
        insight_types: list[str] | None = None,
        min_confidence: float = 0.5,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Legacy method - redirects to search_memory."""
        result = await SharedMemoryService.search_memory(
            repository_path=repository_path,
            entry_types=insight_types,
            categories=categories,
            limit=limit,
            min_confidence=min_confidence,
        )
        # Transform response to match legacy format
        result["insights"] = result.pop("memories", [])
        return result

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

    # =============================================================================
    # MCP-SAFE DATABASE ACCESS METHODS
    # =============================================================================

    @staticmethod
    async def get_insights_safe(
        repository_path: str,
        categories: list[str] | None = None,
        insight_types: list[str] | None = None,
        min_confidence: float = 0.5,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Get insights with MCP-safe database access.
        
        This method uses MCP-safe database access patterns to prevent 
        communication channel conflicts in FastMCP resource handlers.
        
        Args:
            repository_path: Repository path to query
            categories: Filter by categories
            insight_types: Filter by insight types (entry types)
            min_confidence: Minimum confidence score
            limit: Maximum results to return
            
        Returns:
            Dictionary with insights matching the criteria
        """
        from ..database import mcp_safe_execute_query
        
        async def _get_insights_safe(session):
            # Streamlined query to minimize session time
            stmt = select(Memory).where(
                and_(
                    Memory.repository_path == repository_path,
                    Memory.confidence >= min_confidence,
                ),
            )
            
            # Add filters
            if insight_types:
                stmt = stmt.where(Memory.entry_type.in_(insight_types))
            
            if categories:
                stmt = stmt.where(Memory.category.in_(categories))
            
            # Order by usefulness and recency
            stmt = stmt.order_by(
                desc(Memory.usefulness_score),
                desc(Memory.relevance_score),
                desc(Memory.confidence),
                desc(Memory.created_at),
            ).limit(limit)
            
            result = await session.execute(stmt)
            memories = result.scalars().all()
            
            # Build response quickly
            insights = []
            for memory in memories:
                insights.append({
                    "memory_id": memory.id,
                    "agent_id": memory.agent_id,
                    "entry_type": memory.entry_type,
                    "category": memory.category,
                    "title": memory.title,
                    "content": memory.content,
                    "tags": memory.get_tags() if hasattr(memory, 'get_tags') else [],
                    "confidence": memory.confidence,
                    "relevance_score": memory.relevance_score,
                    "usefulness_score": memory.usefulness_score,
                    "created_at": memory.created_at.isoformat(),
                    "accessed_count": memory.accessed_count,
                    # Skip last_accessed to reduce processing time
                })
            
            return {
                "insights": insights,
                "count": len(insights),
                "filters": {
                    "categories": categories,
                    "insight_types": insight_types,
                    "min_confidence": min_confidence,
                },
            }
        
        try:
            result = await mcp_safe_execute_query(_get_insights_safe, timeout=3.0)
            return result if result is not None else {
                "insights": [],
                "count": 0,
                "filters": {
                    "categories": categories,
                    "insight_types": insight_types,
                    "min_confidence": min_confidence,
                },
            }
        except Exception as e:
            logger.error("MCP-safe get_insights failed", 
                        repository_path=repository_path, error=str(e))
            return {
                "error": f"Database error: {e}",
                "insights": [],
                "count": 0,
                "filters": {
                    "categories": categories,
                    "insight_types": insight_types,
                    "min_confidence": min_confidence,
                },
            }

    @staticmethod
    async def search_memory_safe(
        repository_path: str,
        query_text: str | None = None,
        entry_types: list[str] | None = None,
        categories: list[str] | None = None,
        limit: int = 20,
        min_confidence: float = 0.3,
        min_relevance: float = 0.3,
    ) -> dict[str, Any]:
        """Search memory entries with MCP-safe database access.
        
        This method uses MCP-safe database access patterns to prevent 
        communication channel conflicts in FastMCP resource handlers.
        
        Args:
            repository_path: Repository path to query
            query_text: Text to search in title and content
            entry_types: Filter by entry types
            categories: Filter by categories
            limit: Maximum results to return
            min_confidence: Minimum confidence score
            min_relevance: Minimum relevance score
            
        Returns:
            Dictionary with matching memories
        """
        from ..database import mcp_safe_execute_query
        
        async def _search_memory_safe(session):
            # Streamlined query to minimize session time
            stmt = select(Memory).where(
                and_(
                    Memory.repository_path == repository_path,
                    Memory.confidence >= min_confidence,
                    Memory.relevance_score >= min_relevance,
                ),
            )
            
            # Add filters
            if entry_types:
                stmt = stmt.where(Memory.entry_type.in_(entry_types))
            
            if categories:
                stmt = stmt.where(Memory.category.in_(categories))
            
            if query_text:
                search_pattern = f"%{query_text}%"
                stmt = stmt.where(
                    or_(
                        Memory.title.ilike(search_pattern),
                        Memory.content.ilike(search_pattern),
                    ),
                )
            
            # Order by relevance and recency
            stmt = stmt.order_by(
                desc(Memory.usefulness_score),
                desc(Memory.relevance_score),
                desc(Memory.confidence),
                desc(Memory.created_at),
            ).limit(limit)
            
            result = await session.execute(stmt)
            memories = result.scalars().all()
            
            # Build response quickly
            memory_list = []
            for memory in memories:
                memory_list.append({
                    "memory_id": memory.id,
                    "agent_id": memory.agent_id,
                    "entry_type": memory.entry_type,
                    "category": memory.category,
                    "title": memory.title,
                    "content": memory.content,
                    "tags": memory.get_tags() if hasattr(memory, 'get_tags') else [],
                    "confidence": memory.confidence,
                    "relevance_score": memory.relevance_score,
                    "usefulness_score": memory.usefulness_score,
                    "created_at": memory.created_at.isoformat(),
                    "accessed_count": memory.accessed_count,
                    # Skip complex attributes to reduce processing time
                })
            
            return {
                "memories": memory_list,
                "count": len(memory_list),
                "query": {
                    "text": query_text,
                    "entry_types": entry_types,
                    "categories": categories,
                    "min_confidence": min_confidence,
                    "min_relevance": min_relevance,
                },
            }
        
        try:
            result = await mcp_safe_execute_query(_search_memory_safe, timeout=3.0)
            return result if result is not None else {
                "memories": [],
                "count": 0,
                "query": {
                    "text": query_text,
                    "entry_types": entry_types,
                    "categories": categories,
                    "min_confidence": min_confidence,
                    "min_relevance": min_relevance,
                },
            }
        except Exception as e:
            logger.error("MCP-safe search_memory failed", 
                        repository_path=repository_path, error=str(e))
            return {
                "error": f"Database error: {e}",
                "memories": [],
                "count": 0,
                "query": {
                    "text": query_text,
                    "entry_types": entry_types,
                    "categories": categories,
                    "min_confidence": min_confidence,
                    "min_relevance": min_relevance,
                },
            }
