"""Task orchestration and management models."""

import json
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from . import Base, TaskStatus


class Task(Base):
    """Task orchestration and management."""

    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    repository_path: Mapped[str] = mapped_column(String, nullable=False)
    task_type: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[TaskStatus] = mapped_column(default=TaskStatus.PENDING)
    assigned_agent_id: Mapped[str | None] = mapped_column(String, ForeignKey("agent_sessions.id"))
    parent_task_id: Mapped[str | None] = mapped_column(String, ForeignKey("tasks.id"))
    priority: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    requirements: Mapped[str | None] = mapped_column(Text)  # JSON
    results: Mapped[str | None] = mapped_column(Text)  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    assigned_agent: Mapped["AgentSession | None"] = relationship("AgentSession", back_populates="tasks")
    parent_task: Mapped["Task | None"] = relationship("Task", remote_side=[id])
    subtasks: Mapped[list["Task"]] = relationship("Task")
    dependencies: Mapped[list["TaskDependency"]] = relationship("TaskDependency", foreign_keys="TaskDependency.task_id", back_populates="task")
    dependents: Mapped[list["TaskDependency"]] = relationship("TaskDependency", foreign_keys="TaskDependency.depends_on_task_id", back_populates="depends_on_task")

    def get_requirements(self) -> dict:
        """Get requirements as a dictionary."""
        if not self.requirements:
            return {}
        try:
            return json.loads(self.requirements)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_requirements(self, reqs: dict) -> None:
        """Set requirements from a dictionary."""
        self.requirements = json.dumps(reqs) if reqs else None

    def get_results(self) -> dict:
        """Get results as a dictionary."""
        if not self.results:
            return {}
        try:
            return json.loads(self.results)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_results(self, results: dict) -> None:
        """Set results from a dictionary."""
        self.results = json.dumps(results) if results else None


class TaskDependency(Base):
    """Task dependencies for complex workflows."""

    __tablename__ = "task_dependencies"

    task_id: Mapped[str] = mapped_column(String, ForeignKey("tasks.id"), primary_key=True)
    depends_on_task_id: Mapped[str] = mapped_column(String, ForeignKey("tasks.id"), primary_key=True)
    dependency_type: Mapped[str] = mapped_column(String, default="completion")

    # Relationships
    task: Mapped["Task"] = relationship("Task", foreign_keys=[task_id], back_populates="dependencies")
    depends_on_task: Mapped["Task"] = relationship("Task", foreign_keys=[depends_on_task_id], back_populates="dependents")
