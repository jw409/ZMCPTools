"""Communication management for Claude MCP Orchestration Layer."""

import asyncio
from datetime import datetime
from typing import Any

import structlog
from pydantic import BaseModel

from ..database import DatabaseManager

logger = structlog.get_logger()


class RoomInfo(BaseModel):
    """Information about a communication room."""
    name: str
    display_name: str | None = None
    description: str | None = None
    repository_path: str | None = None
    member_count: int = 0
    created_at: str


class Message(BaseModel):
    """Communication message."""
    message_id: str
    agent_name: str
    message: str
    timestamp: str
    mentions: list[str] = []
    message_type: str = "standard"
    reply_to_message_id: str | None = None
    task_id: str | None = None


class CommunicationManager:
    """Manages inter-agent communication and coordination."""

    def __init__(self, db_manager: DatabaseManager):
        """Initialize communication manager.
        
        Args:
            db_manager: Database manager instance
        """
        self.db_manager = db_manager
        self._waiting_agents: dict[str, list[asyncio.Event]] = {}
        self._message_cache: dict[str, list[Message]] = {}

    async def create_room(
        self,
        room_name: str,
        description: str | None = None,
        repository_path: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        """Create a communication room.
        
        Args:
            room_name: Unique room name
            description: Room description
            repository_path: Associated repository
            metadata: Additional metadata
            
        Returns:
            True if room created successfully
        """
        success = await self.db_manager.create_chat_room(
            room_name=room_name,
            description=description,
            repository_path=repository_path,
            metadata=metadata,
        )

        if success:
            # Initialize room in cache
            self._message_cache[room_name] = []
            self._waiting_agents[room_name] = []

            logger.info("Communication room created",
                       room_name=room_name,
                       repository_path=repository_path)

        return success

    async def join_room(
        self,
        room_name: str,
        agent_name: str,
        agent_id: str,
    ) -> dict[str, Any]:
        """Join an agent to a communication room.
        
        Args:
            room_name: Room to join
            agent_name: Display name for the agent
            agent_id: Agent UUID
            
        Returns:
            Join result with room info and recent messages
        """
        # Ensure room exists
        room_exists = await self._ensure_room_exists(room_name)
        if not room_exists:
            # Create default room
            await self.create_room(room_name, f"Auto-created room: {room_name}")

        # Get room info and recent messages
        room_info = await self._get_room_info(room_name)
        recent_messages = await self.get_messages(
            room_name=room_name,
            agent_id=agent_id,
            limit=10,
        )

        # Log join event
        await self.send_message(
            room_name=room_name,
            agent_id=agent_id,
            agent_name=agent_name,
            message=f"{agent_name} joined the room",
            message_type="system",
        )

        logger.info("Agent joined room",
                   agent_name=agent_name,
                   room_name=room_name)

        return {
            "success": True,
            "room_info": room_info,
            "recent_messages": recent_messages.get("messages", []),
        }

    async def leave_room(
        self,
        room_name: str,
        agent_id: str,
        agent_name: str | None = None,
    ) -> dict[str, Any]:
        """Leave an agent from a communication room.
        
        Args:
            room_name: Room to leave
            agent_id: Agent UUID
            agent_name: Agent display name
            
        Returns:
            Leave result
        """
        # Log leave event
        if agent_name:
            await self.send_message(
                room_name=room_name,
                agent_id=agent_id,
                agent_name=agent_name,
                message=f"{agent_name} left the room",
                message_type="system",
            )

        logger.info("Agent left room",
                   agent_name=agent_name or agent_id,
                   room_name=room_name)

        return {
            "success": True,
            "left_at": datetime.now().isoformat(),
        }

    async def send_message(
        self,
        room_name: str,
        agent_id: str,
        agent_name: str,
        message: str,
        mentions: list[str] | None = None,
        message_type: str = "standard",
        reply_to_message_id: str | None = None,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        """Send a message to a room.
        
        Args:
            room_name: Target room
            agent_id: Sending agent UUID
            agent_name: Sending agent name
            message: Message content
            mentions: List of mentioned agents
            message_type: Type of message
            reply_to_message_id: Message being replied to
            task_id: Associated task
            
        Returns:
            Send result with message ID and delivery info
        """
        # Send message to database
        message_id = await self.db_manager.send_message(
            room_name=room_name,
            agent_name=agent_name,
            message=message,
            mentions=mentions,
            message_type=message_type,
        )

        # Create message object
        message_obj = Message(
            message_id=message_id,
            agent_name=agent_name,
            message=message,
            timestamp=datetime.now().isoformat(),
            mentions=mentions or [],
            message_type=message_type,
            reply_to_message_id=reply_to_message_id,
            task_id=task_id,
        )

        # Add to cache
        if room_name not in self._message_cache:
            self._message_cache[room_name] = []
        self._message_cache[room_name].append(message_obj)

        # Keep cache size reasonable
        if len(self._message_cache[room_name]) > 100:
            self._message_cache[room_name] = self._message_cache[room_name][-100:]

        # Notify waiting agents
        await self._notify_waiting_agents(room_name)

        # Determine delivery targets
        delivered_to = [agent_name]  # Sender is always "delivered"
        if mentions:
            delivered_to.extend(mentions)

        logger.info("Message sent",
                   message_id=message_id,
                   room_name=room_name,
                   agent_name=agent_name,
                   message_type=message_type)

        return {
            "success": True,
            "message_id": message_id,
            "timestamp": message_obj.timestamp,
            "delivered_to": list(set(delivered_to)),
        }

    async def get_messages(
        self,
        room_name: str,
        agent_id: str,
        limit: int = 50,
        before_message_id: str | None = None,
        since_timestamp: str | None = None,
        message_type_filter: list[str] | None = None,
    ) -> dict[str, Any]:
        """Get messages from a room.
        
        Args:
            room_name: Room to get messages from
            agent_id: Requesting agent UUID
            limit: Maximum number of messages
            before_message_id: Get messages before this ID
            since_timestamp: Get messages since this timestamp
            message_type_filter: Filter by message types
            
        Returns:
            Messages with pagination info
        """
        # Get messages from database
        messages = await self.db_manager.get_messages(
            room_name=room_name,
            limit=limit,
            after_timestamp=since_timestamp,
        )

        # Apply filters
        filtered_messages = []
        for msg in messages:
            # Message type filter
            if message_type_filter and msg.get("message_type") not in message_type_filter:
                continue

            # Before message ID filter (basic implementation)
            if before_message_id and msg.get("id") == before_message_id:
                break

            filtered_messages.append({
                "message_id": msg["id"],
                "agent_name": msg["agent_name"],
                "message": msg["message"],
                "timestamp": msg["timestamp"],
                "message_type": msg.get("message_type", "standard"),
                "mentions": msg.get("mentions", []),
                "reply_to_message_id": None,  # TODO: Implement reply tracking
                "task_id": None,  # TODO: Implement task association
            })

        has_more = len(messages) == limit

        return {
            "messages": filtered_messages,
            "has_more": has_more,
        }

    async def wait_for_messages(
        self,
        room_name: str,
        agent_id: str,
        timeout: int = 30,
        since_message_id: str | None = None,
    ) -> dict[str, Any]:
        """Wait for new messages in a room using long-polling.
        
        Args:
            room_name: Room to monitor
            agent_id: Waiting agent UUID
            timeout: Maximum wait time in seconds
            since_message_id: Get messages after this ID
            
        Returns:
            New messages or timeout indication
        """
        # Check for immediate messages
        recent_messages = await self.get_messages(
            room_name=room_name,
            agent_id=agent_id,
            limit=10,
            since_timestamp=datetime.now().isoformat() if not since_message_id else None,
        )

        if recent_messages.get("messages"):
            return {
                "new_messages": recent_messages["messages"],
                "timeout_reached": False,
            }

        # Set up waiting
        if room_name not in self._waiting_agents:
            self._waiting_agents[room_name] = []

        wait_event = asyncio.Event()
        self._waiting_agents[room_name].append(wait_event)

        try:
            # Wait for new messages or timeout
            await asyncio.wait_for(wait_event.wait(), timeout=timeout)

            # Get new messages
            new_messages = await self.get_messages(
                room_name=room_name,
                agent_id=agent_id,
                limit=10,
            )

            return {
                "new_messages": new_messages.get("messages", []),
                "timeout_reached": False,
            }

        except asyncio.TimeoutError:
            return {
                "new_messages": [],
                "timeout_reached": True,
            }

        finally:
            # Clean up waiting event
            if wait_event in self._waiting_agents.get(room_name, []):
                self._waiting_agents[room_name].remove(wait_event)

    async def list_rooms(
        self,
        repository_path: str | None = None,
    ) -> list[dict[str, Any]]:
        """List available communication rooms.
        
        Args:
            repository_path: Filter by repository
            
        Returns:
            List of room information
        """
        # This would need a proper database query implementation
        # For now, return a placeholder
        return [
            {
                "name": "general",
                "display_name": "General Discussion",
                "description": "General purpose communication room",
                "member_count": 0,
                "created_at": datetime.now().isoformat(),
            },
        ]

    async def get_room_members(self, room_name: str) -> list[str]:
        """Get list of room members.
        
        Args:
            room_name: Room to query
            
        Returns:
            List of member names
        """
        # TODO: Implement room membership tracking
        return []

    async def _ensure_room_exists(self, room_name: str) -> bool:
        """Ensure a room exists, creating it if necessary.
        
        Args:
            room_name: Room name to check
            
        Returns:
            True if room exists or was created
        """
        # Check if room exists in cache or database
        # For now, assume room needs to be created
        return False

    async def _get_room_info(self, room_name: str) -> dict[str, Any]:
        """Get room information.
        
        Args:
            room_name: Room name
            
        Returns:
            Room information
        """
        return {
            "name": room_name,
            "display_name": room_name.replace("-", " ").title(),
            "description": f"Communication room: {room_name}",
            "member_count": len(self.get_room_members(room_name)),
            "created_at": datetime.now().isoformat(),
        }

    async def _notify_waiting_agents(self, room_name: str) -> None:
        """Notify agents waiting for messages in a room.
        
        Args:
            room_name: Room where message was sent
        """
        waiting_events = self._waiting_agents.get(room_name, [])
        for event in waiting_events:
            event.set()

        # Clear waiting events
        if room_name in self._waiting_agents:
            self._waiting_agents[room_name] = []

    async def cleanup(self) -> None:
        """Clean up communication resources."""
        # Notify all waiting agents
        for room_name in self._waiting_agents:
            await self._notify_waiting_agents(room_name)

        self._waiting_agents.clear()
        self._message_cache.clear()

        logger.info("Communication manager cleanup complete")
