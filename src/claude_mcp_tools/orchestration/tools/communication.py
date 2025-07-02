"""Communication tools for multi-agent coordination and messaging."""

from typing import Any

import structlog
from fastmcp import FastMCP

from ...schemas.communication import (
    BroadcastMessageSchema,
    GetMessagesSchema,
    JoinRoomSchema,
    LeaveRoomSchema,
    SendMessageSchema,
    WaitForMessagesSchema,
)
from ...services.communication_service import CommunicationService

logger = structlog.get_logger("orchestration.tools.communication")


def register_communication_tools(app: FastMCP):
    """Register communication tools with the FastMCP app."""
    
    @app.tool(
        name="join_room",
        description="Join a coordination room for agent communication and task synchronization",
        tags={"communication", "multi-agent", "coordination", "rooms"}
    )
    async def join_room(params: JoinRoomSchema) -> dict[str, Any]:
        """Join a coordination room for agent communication."""
        try:
            comm_service = CommunicationService(params.repository_path)
            result = await comm_service.join_room(
                room_name=params.room_name,
                agent_id=params.agent_id,
            )
            return result

        except Exception as e:
            logger.error("Error joining room", room=params.room_name, error=str(e))
            return {"error": {"code": "JOIN_ROOM_FAILED", "message": str(e)}}

    @app.tool(
        name="leave_room",
        description="Leave a coordination room and stop receiving messages from it",
        tags={"communication", "multi-agent", "coordination", "rooms"}
    )
    async def leave_room(params: LeaveRoomSchema) -> dict[str, Any]:
        """Leave a coordination room."""
        try:
            comm_service = CommunicationService(params.repository_path)
            result = await comm_service.leave_room(
                room_name=params.room_name,
                agent_id=params.agent_id,
            )
            return result

        except Exception as e:
            logger.error("Error leaving room", room=params.room_name, error=str(e))
            return {"error": {"code": "LEAVE_ROOM_FAILED", "message": str(e)}}

    @app.tool(
        name="send_message",
        description="Send a message to a room or specific agents with support for mentions, replies, and task references",
        tags={"communication", "multi-agent", "messaging"}
    )
    async def send_message(params: SendMessageSchema) -> dict[str, Any]:
        """Send a message to a room or specific agents."""
        try:
            comm_service = CommunicationService(params.repository_path)
            result = await comm_service.send_message(
                room_name=params.room_name,
                message=params.message,
                message_type=params.message_type,
                mentions=params.mentions,
                priority=params.priority,
            )
            return result

        except Exception as e:
            logger.error("Error sending message", room=params.room_name, error=str(e))
            return {"error": {"code": "SEND_MESSAGE_FAILED", "message": str(e)}}

    @app.tool(
        name="broadcast_message",
        description="Broadcast a message to multiple rooms simultaneously for system-wide announcements",
        tags={"communication", "multi-agent", "broadcasting", "announcements"}
    )
    async def broadcast_message(params: BroadcastMessageSchema) -> dict[str, Any]:
        """Broadcast a message to multiple rooms simultaneously."""
        try:
            comm_service = CommunicationService(params.repository_path)
            results = []
            
            for room_name in params.rooms:
                try:
                    result = await comm_service.send_message(
                        room_name=room_name,
                        message=params.message,
                        message_type=params.message_type,
                        sender_id=params.sender_id,
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
                    "total_rooms": len(params.rooms),
                    "successful": len(successful_rooms),
                    "failed": len(failed_rooms),
                },
                "results": results,
                "message": params.message,
                "message_type": params.message_type,
            }

        except Exception as e:
            logger.error("Error broadcasting message", error=str(e))
            return {"error": {"code": "BROADCAST_FAILED", "message": str(e)}}

    @app.tool(
        name="get_messages",
        description="Retrieve messages from a room with filtering and pagination for monitoring conversations",
        tags={"communication", "multi-agent", "monitoring", "history"}
    )
    async def get_messages(params: GetMessagesSchema) -> dict[str, Any]:
        """Retrieve messages from a room with filtering."""
        try:
            comm_service = CommunicationService(params.repository_path)
            result = await comm_service.get_messages(
                room_name=params.room_name,
                limit=params.limit,
                since_timestamp=params.since_timestamp,
                message_type_filter=params.message_type_filter,
                sender_filter=params.sender_filter,
                include_metadata=params.include_metadata,
            )
            return result

        except Exception as e:
            logger.error("Error getting messages", room=params.room_name, error=str(e))
            return {"error": {"code": "GET_MESSAGES_FAILED", "message": str(e)}}

    @app.tool(
        name="wait_for_messages",
        description="Wait for new messages in a room with optional pattern matching for coordination synchronization",
        tags={"communication", "multi-agent", "synchronization", "waiting"}
    )
    async def wait_for_messages(params: WaitForMessagesSchema) -> dict[str, Any]:
        """Wait for new messages in a room with optional pattern matching."""
        try:
            comm_service = CommunicationService(params.repository_path)
            result = await comm_service.wait_for_messages(
                room_name=params.room_name,
                timeout_seconds=params.timeout_seconds,
                message_pattern=params.message_pattern,
            )
            return result

        except Exception as e:
            logger.error("Error waiting for messages", room=params.room_name, error=str(e))
            return {"error": {"code": "WAIT_MESSAGES_FAILED", "message": str(e)}}