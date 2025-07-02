"""Shared memory models for cross-agent collaboration."""

import json
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from . import Base


class SharedMemoryEntry(Base):
    """Shared memory entries for cross-agent collaboration."""

    __tablename__ = "shared_memory_entries"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    repository_path: Mapped[str] = mapped_column(String, nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agent_sessions.id"), nullable=False)
    entry_type: Mapped[str] = mapped_column(String, nullable=False)  # tool_call, insight, discovery, result
    title: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[str | None] = mapped_column(Text)  # JSON array of tags
    entry_metadata: Mapped[str | None] = mapped_column(Text)  # JSON metadata
    relevance_score: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    accessed_count: Mapped[int] = mapped_column(Integer, default=0)
    last_accessed: Mapped[datetime | None] = mapped_column(DateTime)

    # Relationships
    agent: Mapped["AgentSession | None"] = relationship("AgentSession")

    def get_tags(self) -> list[str]:
        """Get tags as a list."""
        if not self.tags:
            return []
        try:
            return json.loads(self.tags)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_tags(self, tags: list[str]) -> None:
        """Set tags from a list."""
        self.tags = json.dumps(tags) if tags else None

    def get_metadata(self) -> dict:
        """Get metadata as a dictionary."""
        if not self.entry_metadata:
            return {}
        try:
            return json.loads(self.entry_metadata)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_metadata(self, data: dict) -> None:
        """Set metadata from a dictionary."""
        self.entry_metadata = json.dumps(data) if data else None

    def increment_access(self) -> None:
        """Increment access count and update last accessed time."""
        self.accessed_count += 1
        self.last_accessed = datetime.now()


class AgentInsight(Base):
    """Agent insights and discoveries for cross-agent learning."""

    __tablename__ = "agent_insights"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    repository_path: Mapped[str] = mapped_column(String, nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agent_sessions.id"), nullable=False)
    insight_type: Mapped[str] = mapped_column(String, nullable=False)  # pattern, approach, solution, pitfall
    category: Mapped[str] = mapped_column(String, nullable=False)  # architecture, performance, testing, etc.
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[str | None] = mapped_column(Text)  # JSON context
    confidence: Mapped[float] = mapped_column(Float, default=0.8)
    usefulness_score: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    referenced_count: Mapped[int] = mapped_column(Integer, default=0)

    # Relationships
    agent: Mapped["AgentSession | None"] = relationship("AgentSession")

    def get_context(self) -> dict:
        """Get context as a dictionary."""
        if not self.context:
            return {}
        try:
            return json.loads(self.context)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_context(self, data: dict) -> None:
        """Set context from a dictionary."""
        self.context = json.dumps(data) if data else None

    def increment_reference(self) -> None:
        """Increment reference count."""
        self.referenced_count += 1


class ToolCallLog(Base):
    """Log of all tool calls for cross-agent reference."""

    __tablename__ = "tool_call_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    repository_path: Mapped[str] = mapped_column(String, nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agent_sessions.id"), nullable=False)
    task_id: Mapped[str | None] = mapped_column(String, ForeignKey("tasks.id"))
    tool_name: Mapped[str] = mapped_column(String, nullable=False)
    parameters: Mapped[str | None] = mapped_column(Text)  # JSON parameters
    result: Mapped[str | None] = mapped_column(Text)  # JSON result
    status: Mapped[str] = mapped_column(String, nullable=False)  # success, error, timeout
    execution_time: Mapped[float | None] = mapped_column(Float)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    # Relationships
    agent: Mapped["AgentSession | None"] = relationship("AgentSession")
    task: Mapped["Task | None"] = relationship("Task")

    def get_parameters(self) -> dict:
        """Get parameters as a dictionary."""
        if not self.parameters:
            return {}
        try:
            return json.loads(self.parameters)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_parameters(self, data: dict) -> None:
        """Set parameters from a dictionary."""
        self.parameters = json.dumps(data) if data else None

    def get_result(self) -> dict:
        """Get result as a dictionary."""
        if not self.result:
            return {}
        try:
            return json.loads(self.result)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_result(self, data: dict) -> None:
        """Set result from a dictionary."""
        self.result = json.dumps(data) if data else None
