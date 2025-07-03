"""Pydantic schemas for communication MCP tools."""

from typing import Annotated

from pydantic import Field

from . import BaseToolSchema


class SendMessageSchema(BaseToolSchema):
    """Schema for send_message tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    room_name: Annotated[str, Field(
        description="Name of the room to send message to",
        min_length=1,
        max_length=100,
    )]

    agent_name: Annotated[str, Field(
        description="Display name of the sending agent",
        min_length=1,
        max_length=100,
    )]

    message: Annotated[str, Field(
        description="Message content to send",
        min_length=1,
        max_length=2000,
    )]

    message_type: Annotated[str, Field(
        description="Type of message",
        pattern=r"^(info|question|update|alert|command)$",
    )] = "info"

    mentions: Annotated[list[str] | None, Field(
        description="List of agent IDs to mention in the message",
        default=None,
    )]

    priority: Annotated[str, Field(
        description="Message priority level",
        pattern=r"^(low|medium|high|urgent)$",
    )] = "medium"


class BroadcastMessageSchema(BaseToolSchema):
    """Schema for broadcast_message tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    agent_name: Annotated[str, Field(
        description="Display name of the broadcasting agent",
        min_length=1,
        max_length=100,
    )]

    message: Annotated[str, Field(
        description="Message content to broadcast",
        min_length=1,
        max_length=2000,
    )]

    rooms: Annotated[list[str], Field(
        description="List of room names to broadcast to",
        min_items=1,
        max_items=50,
    )]

    message_type: Annotated[str, Field(
        description="Type of broadcast message",
        pattern=r"^(announcement|alert|update|emergency)$",
    )] = "announcement"

    sender_id: Annotated[str | None, Field(
        description="ID of the sending agent",
        default=None,
    )]


class GetMessagesSchema(BaseToolSchema):
    """Schema for get_messages tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    room_name: Annotated[str, Field(
        description="Name of the room to get messages from",
        min_length=1,
        max_length=100,
    )]

    limit: Annotated[int, Field(
        description="Maximum number of messages to return",
        ge=1,
        le=1000,
    )] = 50

    since_timestamp: Annotated[str | None, Field(
        description="ISO timestamp to get messages since",
        default=None,
    )]

    message_type_filter: Annotated[list[str] | None, Field(
        description="Filter messages by type",
        default=None,
    )]

    before_message_id: Annotated[str | None, Field(
        description="Get messages before this message ID",
        default=None,
    )]


class JoinRoomSchema(BaseToolSchema):
    """Schema for join_room tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    room_name: Annotated[str, Field(
        description="Name of the room to join",
        min_length=1,
        max_length=100,
    )]

    agent_name: Annotated[str, Field(
        description="Display name for the agent joining the room",
        min_length=1,
        max_length=100,
    )]

    agent_id: Annotated[str | None, Field(
        description="ID of the agent joining the room",
        default=None,
    )]


class LeaveRoomSchema(BaseToolSchema):
    """Schema for leave_room tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    room_name: Annotated[str, Field(
        description="Name of the room to leave",
        min_length=1,
        max_length=100,
    )]

    agent_name: Annotated[str, Field(
        description="Display name for the agent leaving the room",
        min_length=1,
        max_length=100,
    )]

    agent_id: Annotated[str | None, Field(
        description="ID of the agent leaving the room",
        default=None,
    )]


class WaitForMessagesSchema(BaseToolSchema):
    """Schema for wait_for_messages tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    room_name: Annotated[str, Field(
        description="Name of the room to wait for messages in",
        min_length=1,
        max_length=100,
    )]

    timeout: Annotated[int, Field(
        description="Maximum time to wait for messages",
        ge=1,
        le=3600,
    )] = 30

    since_message_id: Annotated[str | None, Field(
        description="Get messages after this message ID",
        default=None,
    )]
