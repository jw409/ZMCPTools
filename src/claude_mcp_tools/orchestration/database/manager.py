"""Database manager for Claude MCP Orchestration Layer."""

import asyncio
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

logger = structlog.get_logger()


class DatabaseManager:
    """Manages SQLite database operations for the orchestration layer."""

    def __init__(self, db_path: Path | None = None):
        """Initialize database manager.
        
        Args:
            db_path: Path to SQLite database file. If None, uses default location.
        """
        if db_path is None:
            # Default to .claude-orchestration directory in user's home
            self.db_path = Path.home() / ".claude-orchestration" / "orchestration.db"
        else:
            self.db_path = Path(db_path)

        # Ensure directory exists
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self._connection: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        """Initialize database and create tables."""
        async with self._lock:
            if self._connection is None:
                self._connection = await aiosqlite.connect(str(self.db_path))
                await self._connection.execute("PRAGMA foreign_keys = ON")
                await self._create_tables()
                logger.info("Database initialized", db_path=str(self.db_path))

    async def close(self) -> None:
        """Close database connection."""
        async with self._lock:
            if self._connection:
                await self._connection.close()
                self._connection = None
                logger.info("Database connection closed")

    async def _create_tables(self) -> None:
        """Create database tables from schema file."""
        schema_path = Path(__file__).parent / "schema.sql"
        with open(schema_path) as f:
            schema = f.read()

        await self._connection.executescript(schema)
        await self._connection.commit()
        logger.info("Database tables created/verified")

    # Agent Session Management
    async def create_agent_session(
        self,
        agent_name: str,
        repository_path: str,
        capabilities: list[str],
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Create a new agent session.
        
        Args:
            agent_name: Name/identifier of the agent
            repository_path: Path to the repository the agent is working on
            capabilities: List of agent capabilities
            metadata: Additional metadata for the agent
            
        Returns:
            Session ID
        """
        session_id = str(uuid.uuid4())

        await self._connection.execute(
            """
            INSERT INTO agent_sessions (id, agent_name, repository_path, capabilities, metadata)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                session_id,
                agent_name,
                repository_path,
                json.dumps(capabilities),
                json.dumps(metadata or {}),
            ),
        )
        await self._connection.commit()

        logger.info("Agent session created",
                   session_id=session_id,
                   agent_name=agent_name,
                   repository_path=repository_path)

        return session_id

    async def update_agent_status(
        self,
        session_id: str,
        status: str,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        """Update agent session status.
        
        Args:
            session_id: Agent session ID
            status: New status ('active', 'idle', 'terminated')
            metadata: Updated metadata
            
        Returns:
            True if update successful, False otherwise
        """
        query = "UPDATE agent_sessions SET status = ?"
        params = [status]

        if metadata is not None:
            query += ", metadata = ?"
            params.append(json.dumps(metadata))

        query += " WHERE id = ?"
        params.append(session_id)

        cursor = await self._connection.execute(query, params)
        await self._connection.commit()

        success = cursor.rowcount > 0
        if success:
            logger.info("Agent status updated",
                       session_id=session_id,
                       status=status)

        return success

    async def get_active_agents(
        self,
        repository_path: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get list of active agents.
        
        Args:
            repository_path: Filter by repository path if provided
            
        Returns:
            List of agent session data
        """
        query = """
            SELECT id, agent_name, repository_path, capabilities, metadata, 
                   created_at, last_heartbeat
            FROM agent_sessions 
            WHERE status = 'active'
        """
        params = []

        if repository_path:
            query += " AND repository_path = ?"
            params.append(repository_path)

        cursor = await self._connection.execute(query, params)
        rows = await cursor.fetchall()

        agents = []
        for row in rows:
            agents.append({
                "id": row[0],
                "agent_name": row[1],
                "repository_path": row[2],
                "capabilities": json.loads(row[3]) if row[3] else [],
                "metadata": json.loads(row[4]) if row[4] else {},
                "created_at": row[5],
                "last_heartbeat": row[6],
            })

        return agents

    # Task Management
    async def create_task(
        self,
        repository_path: str,
        task_type: str,
        description: str,
        requirements: dict[str, Any],
        priority: int = 0,
        parent_task_id: str | None = None,
    ) -> str:
        """Create a new task.
        
        Args:
            repository_path: Repository the task relates to
            task_type: Type/category of task
            description: Human-readable description
            requirements: Task requirements and parameters
            priority: Task priority (higher = more important)
            parent_task_id: Parent task if this is a subtask
            
        Returns:
            Task ID
        """
        task_id = str(uuid.uuid4())

        await self._connection.execute(
            """
            INSERT INTO tasks (id, repository_path, task_type, description, 
                             requirements, priority, parent_task_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                repository_path,
                task_type,
                description,
                json.dumps(requirements),
                priority,
                parent_task_id,
            ),
        )
        await self._connection.commit()

        logger.info("Task created",
                   task_id=task_id,
                   task_type=task_type,
                   repository_path=repository_path)

        return task_id

    async def assign_task(self, task_id: str, agent_id: str) -> bool:
        """Assign task to an agent.
        
        Args:
            task_id: Task to assign
            agent_id: Agent to assign to
            
        Returns:
            True if assignment successful
        """
        cursor = await self._connection.execute(
            "UPDATE tasks SET assigned_agent_id = ?, status = 'in_progress' WHERE id = ?",
            (agent_id, task_id),
        )
        await self._connection.commit()

        success = cursor.rowcount > 0
        if success:
            logger.info("Task assigned", task_id=task_id, agent_id=agent_id)

        return success

    async def update_task_status(
        self,
        task_id: str,
        status: str,
        results: dict[str, Any] | None = None,
    ) -> bool:
        """Update task status and results.
        
        Args:
            task_id: Task to update
            status: New status
            results: Task results if completed
            
        Returns:
            True if update successful
        """
        query = "UPDATE tasks SET status = ?"
        params = [status]

        if results is not None:
            query += ", results = ?"
            params.append(json.dumps(results))

        query += " WHERE id = ?"
        params.append(task_id)

        cursor = await self._connection.execute(query, params)
        await self._connection.commit()

        success = cursor.rowcount > 0
        if success:
            logger.info("Task status updated", task_id=task_id, status=status)

        return success

    async def get_pending_tasks(
        self,
        repository_path: str | None = None,
        agent_capabilities: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Get pending tasks, optionally filtered by repository and capabilities.
        
        Args:
            repository_path: Filter by repository
            agent_capabilities: Filter by required capabilities
            
        Returns:
            List of pending tasks
        """
        query = """
            SELECT id, repository_path, task_type, description, requirements,
                   priority, parent_task_id, created_at
            FROM tasks 
            WHERE status = 'pending'
        """
        params = []

        if repository_path:
            query += " AND repository_path = ?"
            params.append(repository_path)

        query += " ORDER BY priority DESC, created_at ASC"

        cursor = await self._connection.execute(query, params)
        rows = await cursor.fetchall()

        tasks = []
        for row in rows:
            task = {
                "id": row[0],
                "repository_path": row[1],
                "task_type": row[2],
                "description": row[3],
                "requirements": json.loads(row[4]) if row[4] else {},
                "priority": row[5],
                "parent_task_id": row[6],
                "created_at": row[7],
            }

            # Filter by capabilities if provided
            if agent_capabilities:
                task_requirements = task["requirements"]
                required_capabilities = task_requirements.get("capabilities", [])
                if required_capabilities and not any(cap in agent_capabilities for cap in required_capabilities):
                    continue

            tasks.append(task)

        return tasks

    # Communication Management
    async def create_chat_room(
        self,
        room_name: str,
        description: str | None = None,
        repository_path: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        """Create a chat room.
        
        Args:
            room_name: Unique room name
            description: Room description
            repository_path: Associated repository
            metadata: Additional metadata
            
        Returns:
            True if room created successfully
        """
        try:
            await self._connection.execute(
                """
                INSERT INTO chat_rooms (name, description, repository_path, metadata)
                VALUES (?, ?, ?, ?)
                """,
                (room_name, description, repository_path, json.dumps(metadata or {})),
            )
            await self._connection.commit()

            logger.info("Chat room created", room_name=room_name)
            return True
        except sqlite3.IntegrityError:
            logger.warning("Chat room already exists", room_name=room_name)
            return False

    async def send_message(
        self,
        room_name: str,
        agent_name: str,
        message: str,
        mentions: list[str] | None = None,
        message_type: str = "standard",
    ) -> str:
        """Send a message to a chat room.
        
        Args:
            room_name: Target room
            agent_name: Sender name
            message: Message content
            mentions: List of mentioned agents
            message_type: Type of message
            
        Returns:
            Message ID
        """
        message_id = str(uuid.uuid4())

        await self._connection.execute(
            """
            INSERT INTO chat_messages (id, room_name, agent_name, message, mentions, message_type)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                message_id,
                room_name,
                agent_name,
                message,
                json.dumps(mentions or []),
                message_type,
            ),
        )
        await self._connection.commit()

        logger.info("Message sent",
                   message_id=message_id,
                   room_name=room_name,
                   agent_name=agent_name)

        return message_id

    async def get_messages(
        self,
        room_name: str,
        limit: int = 50,
        after_timestamp: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get messages from a chat room.
        
        Args:
            room_name: Room to get messages from
            limit: Maximum number of messages
            after_timestamp: Only get messages after this timestamp
            
        Returns:
            List of messages
        """
        query = """
            SELECT id, agent_name, message, timestamp, mentions, message_type
            FROM chat_messages
            WHERE room_name = ?
        """
        params = [room_name]

        if after_timestamp:
            query += " AND timestamp > ?"
            params.append(after_timestamp)

        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)

        cursor = await self._connection.execute(query, params)
        rows = await cursor.fetchall()

        messages = []
        for row in rows:
            messages.append({
                "id": row[0],
                "agent_name": row[1],
                "message": row[2],
                "timestamp": row[3],
                "mentions": json.loads(row[4]) if row[4] else [],
                "message_type": row[5],
            })

        return list(reversed(messages))  # Return in chronological order
