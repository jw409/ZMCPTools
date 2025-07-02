"""Communication service using SQLAlchemy ORM."""

import asyncio
import uuid
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import execute_query
from ..models.communication import ChatMessage, ChatRoom, RoomMembership

logger = structlog.get_logger()


class CommunicationService:
    """Service for inter-agent communication operations using SQLAlchemy ORM."""

    # Class-level cache for waiting agents and messages - optimized for non-blocking operations
    _waiting_agents: dict[str, list[asyncio.Event]] = {}
    _message_cache: dict[str, list[dict[str, Any]]] = {}
    _message_broadcast_queue: dict[str, asyncio.Queue] = {}
    _notification_lock = asyncio.Lock()

    @staticmethod
    async def create_room(
        name: str,
        description: str | None = None,
        repository_path: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a communication room.
        
        Args:
            name: Unique room name
            description: Room description
            repository_path: Associated repository path
            metadata: Additional room metadata
            
        Returns:
            Room creation result
        """
        async def _create_room(session: AsyncSession):
            # Check if room already exists
            stmt = select(ChatRoom).where(ChatRoom.name == name)
            result = await session.execute(stmt)
            existing_room = result.scalar_one_or_none()

            if existing_room:
                return {
                    "success": False,
                    "error": "Room already exists",
                    "room_name": name,
                }

            # Create room instance
            room = ChatRoom(
                name=name,
                description=description,
                repository_path=repository_path,
            )

            # Set metadata if provided
            if metadata:
                room.set_metadata(metadata)

            # Add to session
            session.add(room)
            await session.commit()

            # Initialize room in cache
            CommunicationService._message_cache[name] = []
            CommunicationService._waiting_agents[name] = []

            logger.info("Communication room created",
                       room_name=name,
                       repository_path=repository_path)

            return {
                "success": True,
                "room_name": name,
                "created_at": room.created_at.isoformat(),
            }

        return await execute_query(_create_room)

    @staticmethod
    async def join_room(
        room_name: str,
        agent_name: str,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Join an agent to a communication room.
        
        Args:
            room_name: Room to join
            agent_name: Display name for the agent
            agent_id: Optional agent UUID for tracking
            
        Returns:
            Join result with room info
        """
        async def _join_room(session: AsyncSession):
            # Ensure room exists, create if not
            stmt = select(ChatRoom).where(ChatRoom.name == room_name)
            result = await session.execute(stmt)
            room = result.scalar_one_or_none()

            if not room:
                # Create default room
                room = ChatRoom(
                    name=room_name,
                    description=f"Auto-created room: {room_name}",
                )
                session.add(room)
                await session.commit()

            # Check if membership already exists
            membership_stmt = select(RoomMembership).where(
                and_(
                    RoomMembership.room_name == room_name,
                    RoomMembership.agent_name == agent_name,
                ),
            )
            membership_result = await session.execute(membership_stmt)
            existing_membership = membership_result.scalar_one_or_none()

            if not existing_membership:
                # Create membership
                membership = RoomMembership(
                    room_name=room_name,
                    agent_name=agent_name,
                    status="active",
                )
                session.add(membership)
                await session.commit()
            elif existing_membership.status == "left":
                # Reactivate membership
                existing_membership.status = "active"
                existing_membership.joined_at = datetime.now()
                await session.commit()

            # Get recent messages
            recent_messages = await CommunicationService._get_recent_messages(
                session, room_name, limit=10,
            )

            # Log join event
            await CommunicationService._create_system_message(
                session, room_name, f"{agent_name} joined the room",
            )

            logger.info("Agent joined room",
                       agent_name=agent_name,
                       room_name=room_name)

            return {
                "success": True,
                "room_name": room_name,
                "agent_name": agent_name,
                "recent_messages": recent_messages,
            }

        return await execute_query(_join_room)

    @staticmethod
    async def leave_room(
        room_name: str,
        agent_name: str,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Leave an agent from a communication room.
        
        Args:
            room_name: Room to leave
            agent_name: Agent display name
            agent_id: Optional agent UUID for tracking
            
        Returns:
            Leave result
        """
        async def _leave_room(session: AsyncSession):
            # Update membership status
            stmt = select(RoomMembership).where(
                and_(
                    RoomMembership.room_name == room_name,
                    RoomMembership.agent_name == agent_name,
                ),
            )
            result = await session.execute(stmt)
            membership = result.scalar_one_or_none()

            if membership:
                membership.status = "left"
                await session.commit()

            # Log leave event
            await CommunicationService._create_system_message(
                session, room_name, f"{agent_name} left the room",
            )

            logger.info("Agent left room",
                       agent_name=agent_name,
                       room_name=room_name)

            return {
                "success": True,
                "room_name": room_name,
                "agent_name": agent_name,
                "left_at": datetime.now().isoformat(),
            }

        return await execute_query(_leave_room)

    @staticmethod
    async def send_message(
        room_name: str,
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
            agent_name: Sending agent name
            message: Message content
            mentions: List of mentioned agents
            message_type: Type of message (standard, system, etc.)
            reply_to_message_id: Message being replied to
            task_id: Associated task ID
            
        Returns:
            Send result with message ID and delivery info
        """
        async def _send_message(session: AsyncSession):
            # Generate message ID
            message_id = str(uuid.uuid4())

            # Create message instance
            chat_message = ChatMessage(
                id=message_id,
                room_name=room_name,
                agent_name=agent_name,
                message=message,
                message_type=message_type,
            )

            # Set mentions if provided
            if mentions:
                chat_message.set_mentions(mentions)

            # Add to session
            session.add(chat_message)
            await session.commit()

            # Create message dict for cache
            message_dict = {
                "message_id": message_id,
                "agent_name": agent_name,
                "message": message,
                "timestamp": chat_message.timestamp.isoformat(),
                "mentions": mentions or [],
                "message_type": message_type,
                "reply_to_message_id": reply_to_message_id,
                "task_id": task_id,
            }

            # Add to cache
            if room_name not in CommunicationService._message_cache:
                CommunicationService._message_cache[room_name] = []
            CommunicationService._message_cache[room_name].append(message_dict)

            # Keep cache size reasonable
            if len(CommunicationService._message_cache[room_name]) > 100:
                CommunicationService._message_cache[room_name] = \
                    CommunicationService._message_cache[room_name][-100:]

            # Notify waiting agents asynchronously (non-blocking)
            asyncio.create_task(CommunicationService._notify_waiting_agents_async(room_name))

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
                "timestamp": chat_message.timestamp.isoformat(),
                "delivered_to": list(set(delivered_to)),
            }

        return await execute_query(_send_message)

    @staticmethod
    async def get_messages(
        room_name: str,
        limit: int = 50,
        before_message_id: str | None = None,
        since_timestamp: str | None = None,
        message_type_filter: list[str] | None = None,
    ) -> dict[str, Any]:
        """Get messages from a room.
        
        Args:
            room_name: Room to get messages from
            limit: Maximum number of messages
            before_message_id: Get messages before this ID
            since_timestamp: Get messages since this timestamp
            message_type_filter: Filter by message types
            
        Returns:
            Messages with pagination info
        """
        async def _get_messages(session: AsyncSession):
            # Build query
            stmt = select(ChatMessage).where(ChatMessage.room_name == room_name)

            # Apply filters
            if since_timestamp:
                try:
                    since_dt = datetime.fromisoformat(since_timestamp.replace("Z", "+00:00"))
                    stmt = stmt.where(ChatMessage.timestamp > since_dt)
                except ValueError:
                    logger.warning("Invalid timestamp format", timestamp=since_timestamp)

            if message_type_filter:
                stmt = stmt.where(ChatMessage.message_type.in_(message_type_filter))

            # Order by timestamp descending (most recent first)
            stmt = stmt.order_by(desc(ChatMessage.timestamp))

            # Handle before_message_id (pagination)
            if before_message_id:
                # Get the timestamp of the before message
                before_stmt = select(ChatMessage.timestamp).where(ChatMessage.id == before_message_id)
                before_result = await session.execute(before_stmt)
                before_timestamp = before_result.scalar_one_or_none()

                if before_timestamp:
                    stmt = stmt.where(ChatMessage.timestamp < before_timestamp)

            # Apply limit
            stmt = stmt.limit(limit)

            result = await session.execute(stmt)
            messages = result.scalars().all()

            # Convert to dictionaries
            message_list = []
            for msg in messages:
                message_dict = {
                    "message_id": msg.id,
                    "agent_name": msg.agent_name,
                    "message": msg.message,
                    "timestamp": msg.timestamp.isoformat(),
                    "message_type": msg.message_type,
                    "mentions": msg.get_mentions(),
                }
                message_list.append(message_dict)

            # Reverse to get chronological order (oldest first)
            message_list.reverse()

            has_more = len(messages) == limit

            return {
                "messages": message_list,
                "has_more": has_more,
                "count": len(message_list),
            }

        return await execute_query(_get_messages)

    @staticmethod
    async def wait_for_messages(
        room_name: str,
        timeout: int = 30,
        since_message_id: str | None = None,
    ) -> dict[str, Any]:
        """Wait for new messages in a room using long-polling.
        
        Args:
            room_name: Room to monitor
            timeout: Maximum wait time in seconds
            since_message_id: Get messages after this ID
            
        Returns:
            New messages or timeout indication
        """
        # Check for immediate messages
        recent_messages = await CommunicationService.get_messages(
            room_name=room_name,
            limit=10,
            since_timestamp=datetime.now().isoformat() if not since_message_id else None,
        )

        if recent_messages.get("messages"):
            return {
                "new_messages": recent_messages["messages"],
                "timeout_reached": False,
            }

        # Set up waiting
        if room_name not in CommunicationService._waiting_agents:
            CommunicationService._waiting_agents[room_name] = []

        wait_event = asyncio.Event()
        CommunicationService._waiting_agents[room_name].append(wait_event)

        try:
            # Wait for new messages or timeout
            await asyncio.wait_for(wait_event.wait(), timeout=timeout)

            # Get new messages
            new_messages = await CommunicationService.get_messages(
                room_name=room_name,
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
            if wait_event in CommunicationService._waiting_agents.get(room_name, []):
                CommunicationService._waiting_agents[room_name].remove(wait_event)

    @staticmethod
    async def list_rooms(
        repository_path: str | None = None,
    ) -> list[dict[str, Any]]:
        """List available communication rooms.
        
        Args:
            repository_path: Filter by repository path
            
        Returns:
            List of room information
        """
        async def _list_rooms(session: AsyncSession):
            # Build query with member count
            stmt = select(
                ChatRoom,
                func.count(RoomMembership.agent_name).label("member_count"),
            ).outerjoin(
                RoomMembership,
                and_(
                    ChatRoom.name == RoomMembership.room_name,
                    RoomMembership.status == "active",
                ),
            ).group_by(ChatRoom.name)

            # Apply repository filter if provided
            if repository_path:
                stmt = stmt.where(ChatRoom.repository_path == repository_path)

            result = await session.execute(stmt)
            rooms_with_counts = result.all()

            room_list = []
            for room, member_count in rooms_with_counts:
                room_dict = {
                    "name": room.name,
                    "description": room.description,
                    "repository_path": room.repository_path,
                    "member_count": member_count or 0,
                    "created_at": room.created_at.isoformat(),
                    "metadata": room.get_metadata(),
                }
                room_list.append(room_dict)

            return room_list

        return await execute_query(_list_rooms)

    @staticmethod
    async def get_room_status(room_name: str) -> dict[str, Any]:
        """Get detailed status of a specific room.
        
        Args:
            room_name: Room name to get status for
            
        Returns:
            Room status information
        """
        async def _get_room_status(session: AsyncSession):
            # Get room info
            room_stmt = select(ChatRoom).where(ChatRoom.name == room_name)
            room_result = await session.execute(room_stmt)
            room = room_result.scalar_one_or_none()

            if not room:
                return {
                    "exists": False,
                    "error": "Room not found",
                }

            # Get active members
            members_stmt = select(RoomMembership).where(
                and_(
                    RoomMembership.room_name == room_name,
                    RoomMembership.status == "active",
                ),
            )
            members_result = await session.execute(members_stmt)
            members = members_result.scalars().all()

            # Get message count
            message_count_stmt = select(func.count(ChatMessage.id)).where(
                ChatMessage.room_name == room_name,
            )
            message_count_result = await session.execute(message_count_stmt)
            message_count = message_count_result.scalar() or 0

            # Get recent message timestamp
            recent_message_stmt = select(func.max(ChatMessage.timestamp)).where(
                ChatMessage.room_name == room_name,
            )
            recent_message_result = await session.execute(recent_message_stmt)
            last_message_at = recent_message_result.scalar()

            return {
                "exists": True,
                "name": room.name,
                "description": room.description,
                "repository_path": room.repository_path,
                "created_at": room.created_at.isoformat(),
                "member_count": len(members),
                "active_members": [m.agent_name for m in members],
                "message_count": message_count,
                "last_message_at": last_message_at.isoformat() if last_message_at else None,
                "metadata": room.get_metadata(),
            }

        return await execute_query(_get_room_status)

    @staticmethod
    async def _get_recent_messages(
        session: AsyncSession,
        room_name: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Get recent messages from a room (internal helper).
        
        Args:
            session: Database session
            room_name: Room name
            limit: Number of messages to retrieve
            
        Returns:
            List of recent messages
        """
        stmt = select(ChatMessage).where(
            ChatMessage.room_name == room_name,
        ).order_by(desc(ChatMessage.timestamp)).limit(limit)

        result = await session.execute(stmt)
        messages = result.scalars().all()

        message_list = []
        for msg in reversed(messages):  # Reverse to get chronological order
            message_dict = {
                "message_id": msg.id,
                "agent_name": msg.agent_name,
                "message": msg.message,
                "timestamp": msg.timestamp.isoformat(),
                "message_type": msg.message_type,
                "mentions": msg.get_mentions(),
            }
            message_list.append(message_dict)

        return message_list

    @staticmethod
    async def _create_system_message(
        session: AsyncSession,
        room_name: str,
        message: str,
    ) -> None:
        """Create a system message (internal helper).
        
        Args:
            session: Database session
            room_name: Room name
            message: System message content
        """
        system_message = ChatMessage(
            id=str(uuid.uuid4()),
            room_name=room_name,
            agent_name="system",
            message=message,
            message_type="system",
        )

        session.add(system_message)
        await session.commit()

    @staticmethod
    async def _notify_waiting_agents(room_name: str) -> None:
        """Notify agents waiting for messages in a room (legacy method).
        
        Args:
            room_name: Room where message was sent
        """
        # Delegate to async version
        await CommunicationService._notify_waiting_agents_async(room_name)

    @staticmethod
    async def _notify_waiting_agents_async(room_name: str) -> None:
        """Asynchronously notify agents waiting for messages in a room.
        
        This method uses non-blocking operations to prevent message delivery
        from being blocked by slow notification processing.
        
        Args:
            room_name: Room where message was sent
        """
        async with CommunicationService._notification_lock:
            # Notify via events (fast)
            waiting_events = CommunicationService._waiting_agents.get(room_name, [])
            for event in waiting_events:
                event.set()

            # Notify via broadcast queue (for high-throughput scenarios)
            if room_name not in CommunicationService._message_broadcast_queue:
                CommunicationService._message_broadcast_queue[room_name] = asyncio.Queue()

            try:
                # Non-blocking queue notification
                CommunicationService._message_broadcast_queue[room_name].put_nowait({
                    "type": "new_message",
                    "room_name": room_name,
                    "timestamp": datetime.now().isoformat(),
                })
            except asyncio.QueueFull:
                # Queue is full, skip this notification to prevent blocking
                logger.warning("Message broadcast queue full", room_name=room_name)

            # Clear waiting events after notification
            if room_name in CommunicationService._waiting_agents:
                CommunicationService._waiting_agents[room_name] = []

    @staticmethod
    async def cleanup() -> None:
        """Clean up communication resources."""
        # Notify all waiting agents
        for room_name in CommunicationService._waiting_agents:
            await CommunicationService._notify_waiting_agents(room_name)

        CommunicationService._waiting_agents.clear()
        CommunicationService._message_cache.clear()
        CommunicationService._message_broadcast_queue.clear()

        logger.info("Communication service cleanup complete")

    @staticmethod
    async def broadcast_to_multiple_rooms(
        rooms: list[str],
        agent_name: str,
        agent_id: str,
        message: str,
        message_type: str = "broadcast",
    ) -> dict[str, Any]:
        """Broadcast a message to multiple rooms concurrently.
        
        Args:
            rooms: List of room names to broadcast to
            agent_name: Name of the broadcasting agent
            agent_id: ID of the broadcasting agent
            message: Message content to broadcast
            message_type: Type of message being broadcast
            
        Returns:
            Results of all broadcast operations
        """
        if not rooms:
            return {"success": True, "broadcasts": 0, "results": []}

        # Create broadcast tasks for concurrent execution
        broadcast_tasks = []
        for room_name in rooms:
            task = CommunicationService.send_message(
                room_name=room_name,
                agent_name=agent_name,
                agent_id=agent_id,
                message=message,
                message_type=message_type,
            )
            broadcast_tasks.append(task)

        # Execute all broadcasts concurrently
        try:
            results = await asyncio.gather(*broadcast_tasks, return_exceptions=True)

            successful_broadcasts = 0
            failed_broadcasts = 0
            broadcast_results = []

            for i, result in enumerate(results):
                room_name = rooms[i]
                if isinstance(result, Exception):
                    broadcast_results.append({
                        "room": room_name,
                        "success": False,
                        "error": str(result),
                    })
                    failed_broadcasts += 1
                elif isinstance(result, dict) and result.get("success"):
                    broadcast_results.append({
                        "room": room_name,
                        "success": True,
                        "message_id": result.get("message_id"),
                    })
                    successful_broadcasts += 1
                else:
                    broadcast_results.append({
                        "room": room_name,
                        "success": False,
                        "error": "Unknown broadcast error",
                    })
                    failed_broadcasts += 1

            logger.info("Multi-room broadcast completed",
                       rooms_count=len(rooms),
                       successful=successful_broadcasts,
                       failed=failed_broadcasts)

            return {
                "success": failed_broadcasts == 0,
                "total_rooms": len(rooms),
                "successful_broadcasts": successful_broadcasts,
                "failed_broadcasts": failed_broadcasts,
                "results": broadcast_results,
            }

        except Exception as e:
            logger.error("Multi-room broadcast failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
                "total_rooms": len(rooms),
            }
