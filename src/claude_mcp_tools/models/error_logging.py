"""Error logging models for enhanced debugging and learning."""

import json
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from . import Base


class ErrorLog(Base):
    """Comprehensive error logging for debugging and learning."""

    __tablename__ = "error_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    repository_path: Mapped[str] = mapped_column(String, nullable=False, index=True)
    agent_id: Mapped[str | None] = mapped_column(String, ForeignKey("agent_sessions.id"))
    task_id: Mapped[str | None] = mapped_column(String, ForeignKey("tasks.id"))
    error_type: Mapped[str] = mapped_column(String, nullable=False)  # system, validation, runtime, timeout
    error_category: Mapped[str] = mapped_column(String, nullable=False)  # mcp_tool, file_operation, network, etc.
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    error_details: Mapped[str | None] = mapped_column(Text)  # Full stack trace or detailed info
    context: Mapped[str | None] = mapped_column(Text)  # JSON context when error occurred
    environment: Mapped[str | None] = mapped_column(Text)  # JSON environment info
    attempted_solution: Mapped[str | None] = mapped_column(Text)
    resolution_status: Mapped[str] = mapped_column(String, default="unresolved")  # resolved, unresolved, workaround
    resolution_details: Mapped[str | None] = mapped_column(Text)
    pattern_id: Mapped[str | None] = mapped_column(String, ForeignKey("error_patterns.id"))
    severity: Mapped[str] = mapped_column(String, default="medium")  # low, medium, high, critical
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Relationships
    agent: Mapped["AgentSession | None"] = relationship("AgentSession")
    task: Mapped["Task | None"] = relationship("Task")
    pattern: Mapped["ErrorPattern | None"] = relationship("ErrorPattern", back_populates="occurrences")

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

    def get_environment(self) -> dict:
        """Get environment as a dictionary."""
        if not self.environment:
            return {}
        try:
            return json.loads(self.environment)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_environment(self, data: dict) -> None:
        """Set environment from a dictionary."""
        self.environment = json.dumps(data) if data else None

    def mark_resolved(self, resolution_details: str) -> None:
        """Mark error as resolved."""
        self.resolution_status = "resolved"
        self.resolution_details = resolution_details
        self.resolved_at = datetime.now()


class ErrorPattern(Base):
    """Recurring error patterns for pattern recognition."""

    __tablename__ = "error_patterns"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    repository_path: Mapped[str] = mapped_column(String, nullable=False, index=True)
    pattern_name: Mapped[str] = mapped_column(String, nullable=False)
    error_signature: Mapped[str] = mapped_column(Text, nullable=False)  # Pattern matching signature
    description: Mapped[str] = mapped_column(Text, nullable=False)
    typical_causes: Mapped[str | None] = mapped_column(Text)  # JSON array of common causes
    suggested_solutions: Mapped[str | None] = mapped_column(Text)  # JSON array of solutions
    frequency: Mapped[int] = mapped_column(Integer, default=1)
    last_occurrence: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    confidence_score: Mapped[float] = mapped_column(Float, default=0.8)

    # Relationships
    occurrences: Mapped[list["ErrorLog"]] = relationship("ErrorLog", back_populates="pattern")

    def get_typical_causes(self) -> list[str]:
        """Get typical causes as a list."""
        if not self.typical_causes:
            return []
        try:
            return json.loads(self.typical_causes)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_typical_causes(self, causes: list[str]) -> None:
        """Set typical causes from a list."""
        self.typical_causes = json.dumps(causes) if causes else None

    def get_suggested_solutions(self) -> list[str]:
        """Get suggested solutions as a list."""
        if not self.suggested_solutions:
            return []
        try:
            return json.loads(self.suggested_solutions)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_suggested_solutions(self, solutions: list[str]) -> None:
        """Set suggested solutions from a list."""
        self.suggested_solutions = json.dumps(solutions) if solutions else None

    def increment_frequency(self) -> None:
        """Increment frequency and update last occurrence."""
        self.frequency += 1
        self.last_occurrence = datetime.now()


class LearningEntry(Base):
    """Learning entries from error resolution and patterns."""

    __tablename__ = "learning_entries"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    repository_path: Mapped[str] = mapped_column(String, nullable=False, index=True)
    learning_type: Mapped[str] = mapped_column(String, nullable=False)  # error_resolution, best_practice, pitfall
    category: Mapped[str] = mapped_column(String, nullable=False)  # development, testing, deployment, etc.
    title: Mapped[str] = mapped_column(String, nullable=False)
    lesson: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[str | None] = mapped_column(Text)  # JSON context
    source_error_id: Mapped[str | None] = mapped_column(String, ForeignKey("error_logs.id"))
    confidence: Mapped[float] = mapped_column(Float, default=0.8)
    applicability_score: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    applied_count: Mapped[int] = mapped_column(Integer, default=0)
    success_rate: Mapped[float] = mapped_column(Float, default=0.0)

    # Relationships
    source_error: Mapped["ErrorLog | None"] = relationship("ErrorLog")

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

    def record_application(self, success: bool) -> None:
        """Record an application of this learning."""
        self.applied_count += 1
        if success:
            self.success_rate = ((self.success_rate * (self.applied_count - 1)) + 1.0) / self.applied_count
        else:
            self.success_rate = (self.success_rate * (self.applied_count - 1)) / self.applied_count
