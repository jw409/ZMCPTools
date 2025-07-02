"""Inter-agent communication models."""

import json
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from . import Base


class ChatRoom(Base):
    """Inter-agent communication rooms."""

    __tablename__ = "chat_rooms"

    name: Mapped[str] = mapped_column(String, primary_key=True)
    description: Mapped[str | None] = mapped_column(Text)
    repository_path: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    room_metadata: Mapped[str | None] = mapped_column(Text)  # JSON

    # Relationships
    messages: Mapped[list["ChatMessage"]] = relationship("ChatMessage", back_populates="room")
    memberships: Mapped[list["RoomMembership"]] = relationship("RoomMembership", back_populates="room")

    def get_metadata(self) -> dict:
        """Get metadata as a dictionary."""
        if not self.room_metadata:
            return {}
        try:
            return json.loads(self.room_metadata)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_metadata(self, data: dict) -> None:
        """Set metadata from a dictionary."""
        self.room_metadata = json.dumps(data) if data else None


class ChatMessage(Base):
    """Agent communication messages."""

    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    room_name: Mapped[str] = mapped_column(String, ForeignKey("chat_rooms.name"), nullable=False)
    agent_name: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    mentions: Mapped[str | None] = mapped_column(Text)  # JSON array
    message_type: Mapped[str] = mapped_column(String, default="standard")

    # Relationships
    room: Mapped["ChatRoom"] = relationship("ChatRoom", back_populates="messages")

    def get_mentions(self) -> list[str]:
        """Get mentions as a list."""
        if not self.mentions:
            return []
        try:
            return json.loads(self.mentions)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_mentions(self, mentions: list[str]) -> None:
        """Set mentions from a list."""
        self.mentions = json.dumps(mentions) if mentions else None


class RoomMembership(Base):
    """Room membership tracking."""

    __tablename__ = "room_memberships"

    room_name: Mapped[str] = mapped_column(String, ForeignKey("chat_rooms.name"), primary_key=True)
    agent_name: Mapped[str] = mapped_column(String, primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    status: Mapped[str] = mapped_column(String, default="active")  # active, left

    # Relationships
    room: Mapped["ChatRoom"] = relationship("ChatRoom", back_populates="memberships")
