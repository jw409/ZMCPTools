"""Agent lifecycle and session management models."""

import json
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from . import AgentStatus, Base


class AgentSession(Base):
    """Agent session tracking and lifecycle management."""

    __tablename__ = "agent_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    agent_name: Mapped[str] = mapped_column(String, nullable=False)
    repository_path: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[AgentStatus] = mapped_column(default=AgentStatus.ACTIVE)
    capabilities: Mapped[str | None] = mapped_column(Text)  # JSON array
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    last_heartbeat: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    agent_metadata: Mapped[str | None] = mapped_column(Text)  # JSON

    # Relationships
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="assigned_agent")
    capabilities_rel: Mapped[list["AgentCapability"]] = relationship("AgentCapability", back_populates="agent")

    def get_capabilities(self) -> list[str]:
        """Get capabilities as a list."""
        if not self.capabilities:
            return []
        try:
            return json.loads(self.capabilities)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_capabilities(self, caps: list[str]) -> None:
        """Set capabilities from a list."""
        self.capabilities = json.dumps(caps)

    def get_metadata(self) -> dict:
        """Get metadata as a dictionary."""
        if not self.agent_metadata:
            return {}
        try:
            return json.loads(self.agent_metadata)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_metadata(self, data: dict) -> None:
        """Set metadata from a dictionary."""
        self.agent_metadata = json.dumps(data)


class AgentCapability(Base):
    """Agent capabilities and specializations."""

    __tablename__ = "agent_capabilities"

    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agent_sessions.id"), primary_key=True)
    capability: Mapped[str] = mapped_column(String, primary_key=True)
    proficiency_level: Mapped[int] = mapped_column(Integer, default=1)  # 1-5 scale

    # Relationships
    agent: Mapped["AgentSession"] = relationship("AgentSession", back_populates="capabilities_rel")
