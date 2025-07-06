"""Unified memory models for cross-agent collaboration."""

import json
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from . import Base


class Memory(Base):
    """Unified memory system for cross-agent collaboration and learning."""

    __tablename__ = "memories"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    repository_path: Mapped[str] = mapped_column(String, nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agent_sessions.id"), nullable=False)
    
    # Entry classification
    entry_type: Mapped[str] = mapped_column(String, nullable=False, index=True)  # insight, pattern, solution, error, learning, decision, discovery, result
    category: Mapped[str | None] = mapped_column(String, index=True)  # architecture, performance, testing, deployment, maintenance, documentation, code, design
    
    # Content
    title: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    
    # Metadata and context
    tags: Mapped[str | None] = mapped_column(Text)  # JSON array of tags
    misc_data: Mapped[str | None] = mapped_column(Text)  # JSON miscellaneous data
    context: Mapped[str | None] = mapped_column(Text)  # JSON context
    
    # Scoring and relevance
    confidence: Mapped[float] = mapped_column(Float, default=0.8)
    relevance_score: Mapped[float] = mapped_column(Float, default=1.0)
    usefulness_score: Mapped[float] = mapped_column(Float, default=0.0)
    
    # Usage tracking
    accessed_count: Mapped[int] = mapped_column(Integer, default=0)
    referenced_count: Mapped[int] = mapped_column(Integer, default=0)
    last_accessed: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

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

    def get_misc_data(self) -> dict:
        """Get miscellaneous data as a dictionary."""
        if not self.misc_data:
            return {}
        try:
            return json.loads(self.misc_data)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_misc_data(self, data: dict) -> None:
        """Set miscellaneous data from a dictionary."""
        self.misc_data = json.dumps(data) if data else None

    # Legacy methods for backward compatibility
    def get_metadata(self) -> dict:
        """Legacy method - use get_misc_data() instead."""
        return self.get_misc_data()

    def set_metadata(self, data: dict) -> None:
        """Legacy method - use set_misc_data() instead."""
        self.set_misc_data(data)

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

    def increment_access(self) -> None:
        """Increment access count and update last accessed time."""
        self.accessed_count += 1
        self.last_accessed = datetime.now()

    def increment_reference(self) -> None:
        """Increment reference count when this memory is referenced by other agents."""
        self.referenced_count += 1


# Legacy aliases for backward compatibility during transition
SharedMemoryEntry = Memory
AgentInsight = Memory


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
