"""Communication tools for multi-agent coordination and messaging."""

from typing import Annotated, Any

import structlog
from pydantic import Field

from ..services.communication_service import CommunicationService
from .app import app

logger = structlog.get_logger("tools.communication")


@app.tool(tags={"communication", "multi-agent", "coordination", "rooms"})
async def join_room(
    room_name: Annotated[str, Field(
        description="Name of the room to join",
        min_length=1,
        max_length=100,
    )],
    agent_name: Annotated[str, Field(
        description="Display name for the agent joining the room",
        min_length=1,
        max_length=100,
    )],
    agent_id: Annotated[str | None, Field(
        description="ID of the agent joining the room",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Join a coordination room for agent communication."""
    try:
        result = await CommunicationService.join_room(
            room_name=room_name,
            agent_name=agent_name,
            agent_id=agent_id,
        )
        return result

    except Exception as e:
        logger.error("Error joining room", room=room_name, error=str(e))
        return {"error": {"code": "JOIN_ROOM_FAILED", "message": str(e)}}


@app.tool(tags={"communication", "multi-agent", "coordination", "rooms"})
async def leave_room(
    room_name: Annotated[str, Field(
        description="Name of the room to leave",
        min_length=1,
        max_length=100,
    )],
    agent_name: Annotated[str, Field(
        description="Display name for the agent leaving the room",
        min_length=1,
        max_length=100,
    )],
    agent_id: Annotated[str | None, Field(
        description="ID of the agent leaving the room",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Leave a coordination room."""
    try:
        result = await CommunicationService.leave_room(
            room_name=room_name,
            agent_name=agent_name,
            agent_id=agent_id,
        )
        return result

    except Exception as e:
        logger.error("Error leaving room", room=room_name, error=str(e))
        return {"error": {"code": "LEAVE_ROOM_FAILED", "message": str(e)}}


@app.tool(tags={"communication", "multi-agent", "messaging"})
async def send_message(
    room_name: Annotated[str, Field(
        description="Name of the room to send message to",
        min_length=1,
        max_length=100,
    )],
    agent_name: Annotated[str, Field(
        description="Display name of the sending agent",
        min_length=1,
        max_length=100,
    )],
    message: Annotated[str, Field(
        description="Message content to send",
        min_length=1,
        max_length=2000,
    )],
    message_type: Annotated[str, Field(
        description="Type of message",
        pattern=r"^(info|question|update|alert|command)$",
    )] = "info",
    mentions: Annotated[list[str] | None, Field(
        description="List of agent IDs to mention in the message",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Send a message to a room or specific agents."""
    try:
        result = await CommunicationService.send_message(
            room_name=room_name,
            agent_name=agent_name,
            message=message,
            message_type=message_type,
            mentions=mentions,
        )
        return result

    except Exception as e:
        logger.error("Error sending message", room=room_name, error=str(e))
        return {"error": {"code": "SEND_MESSAGE_FAILED", "message": str(e)}}


@app.tool(tags={"communication", "multi-agent", "broadcasting", "announcements"})
async def broadcast_message(
    agent_name: Annotated[str, Field(
        description="Display name of the broadcasting agent",
        min_length=1,
        max_length=100,
    )],
    message: Annotated[str, Field(
        description="Message content to broadcast",
        min_length=1,
        max_length=2000,
    )],
    rooms: Annotated[list[str], Field(
        description="List of room names to broadcast to",
        min_length=1,
        max_length=50,
    )],
    message_type: Annotated[str, Field(
        description="Type of broadcast message",
        pattern=r"^(announcement|alert|update|emergency)$",
    )] = "announcement",
) -> dict[str, Any]:
    """Broadcast a message to multiple rooms simultaneously."""
    try:
        results = []

        for room_name in rooms:
            try:
                result = await CommunicationService.send_message(
                    room_name=room_name,
                    agent_name=agent_name,
                    message=message,
                    message_type=message_type,
                )
                results.append({
                    "room_name": room_name,
                    "success": result.get("success", False),
                    "message_id": result.get("message_id"),
                })
            except Exception as e:
                results.append({
                    "room_name": room_name,
                    "success": False,
                    "error": str(e),
                })

        successful_rooms = [r for r in results if r.get("success")]
        failed_rooms = [r for r in results if not r.get("success")]

        return {
            "success": True,
            "broadcast_stats": {
                "total_rooms": len(rooms),
                "successful": len(successful_rooms),
                "failed": len(failed_rooms),
            },
            "results": results,
            "message": message,
            "message_type": message_type,
        }

    except Exception as e:
        logger.error("Error broadcasting message", error=str(e))
        return {"error": {"code": "BROADCAST_FAILED", "message": str(e)}}


@app.tool(tags={"communication", "multi-agent", "monitoring", "history"})
async def get_messages(
    room_name: Annotated[str, Field(
        description="Name of the room to get messages from",
        min_length=1,
        max_length=100,
    )],
    limit: Annotated[int, Field(
        description="Maximum number of messages to return",
        ge=1,
        le=1000,
    )] = 50,
    since_timestamp: Annotated[str | None, Field(
        description="ISO timestamp to get messages since",
        default=None,
    )] = None,
    message_type_filter: Annotated[list[str] | None, Field(
        description="Filter messages by type",
        default=None,
    )] = None,
    before_message_id: Annotated[str | None, Field(
        description="Get messages before this message ID",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Retrieve messages from a room with filtering."""
    try:
        result = await CommunicationService.get_messages(
            room_name=room_name,
            limit=limit,
            before_message_id=before_message_id,
            since_timestamp=since_timestamp,
            message_type_filter=message_type_filter,
        )
        return result

    except Exception as e:
        logger.error("Error getting messages", room=room_name, error=str(e))
        return {"error": {"code": "GET_MESSAGES_FAILED", "message": str(e)}}


@app.tool(tags={"communication", "multi-agent", "synchronization", "waiting"})
async def wait_for_messages(
    room_name: Annotated[str, Field(
        description="Name of the room to wait for messages in",
        min_length=1,
        max_length=100,
    )],
    timeout: Annotated[int, Field(
        description="Maximum time to wait for messages",
        ge=1,
        le=3600,
    )] = 30,
    since_message_id: Annotated[str | None, Field(
        description="Get messages after this message ID",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Wait for new messages in a room with optional pattern matching."""
    try:
        result = await CommunicationService.wait_for_messages(
            room_name=room_name,
            timeout=timeout,
            since_message_id=since_message_id,
        )
        return result

    except Exception as e:
        logger.error("Error waiting for messages", room=room_name, error=str(e))
        return {"error": {"code": "WAIT_MESSAGES_FAILED", "message": str(e)}}
