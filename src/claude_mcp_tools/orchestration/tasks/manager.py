"""Task orchestration and management for Claude MCP Orchestration Layer."""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any

import structlog
from pydantic import BaseModel

from ..database import DatabaseManager

logger = structlog.get_logger()


class TaskRequirements(BaseModel):
    """Task requirements and constraints."""
    capabilities: list[str] = []
    estimated_duration: int | None = None  # seconds
    max_agents: int = 1
    priority_boost: int = 0
    dependencies: list[str] = []
    environment: dict[str, Any] = {}


class TaskProgress(BaseModel):
    """Task progress tracking."""
    percentage: int = 0
    current_step: str = ""
    steps_completed: int = 0
    total_steps: int = 0
    last_update: str | None = None


class TaskResult(BaseModel):
    """Task execution result."""
    success: bool
    output: dict[str, Any] = {}
    files_modified: list[str] = []
    execution_time: int | None = None
    error_details: dict[str, Any] | None = None


class TaskManager:
    """Manages task orchestration and execution."""

    def __init__(self, db_manager: DatabaseManager):
        """Initialize task manager.
        
        Args:
            db_manager: Database manager instance
        """
        self.db_manager = db_manager
        self._task_monitors: dict[str, asyncio.Task] = {}
        self._execution_logs: dict[str, list[dict[str, Any]]] = {}

    async def create_task(
        self,
        repository_path: str,
        task_type: str,
        title: str,
        description: str,
        requirements: dict[str, Any] | None = None,
        priority: int = 0,
        parent_task_id: str | None = None,
        dependencies: list[str] | None = None,
    ) -> dict[str, Any]:
        """Create a new orchestrated task.
        
        Args:
            repository_path: Repository the task relates to
            task_type: Type/category of task
            title: Brief title for the task
            description: Detailed task description
            requirements: Task requirements and constraints
            priority: Task priority (higher = more urgent)
            parent_task_id: Parent task if this is a subtask
            dependencies: List of task IDs this depends on
            
        Returns:
            Task creation result
        """
        # Parse requirements
        task_requirements = TaskRequirements(**(requirements or {}))
        if dependencies:
            task_requirements.dependencies = dependencies

        # Create task in database
        task_id = await self.db_manager.create_task(
            repository_path=repository_path,
            task_type=task_type,
            description=f"{title}: {description}",
            requirements=task_requirements.model_dump(),
            priority=priority,
            parent_task_id=parent_task_id,
        )

        # Initialize execution log
        self._execution_logs[task_id] = []
        self._log_task_event(
            task_id=task_id,
            event_type="created",
            message=f"Task created: {title}",
        )

        # Handle dependencies
        if task_requirements.dependencies:
            await self._add_task_dependencies(task_id, task_requirements.dependencies)

        # Calculate estimated completion
        estimated_completion = None
        if task_requirements.estimated_duration:
            estimated_completion = (
                datetime.now() + timedelta(seconds=task_requirements.estimated_duration)
            ).isoformat()

        logger.info("Task created",
                   task_id=task_id,
                   task_type=task_type,
                   title=title,
                   repository_path=repository_path)

        return {
            "task_id": task_id,
            "status": "pending",
            "estimated_duration": task_requirements.estimated_duration,
            "required_capabilities": task_requirements.capabilities,
            "created_at": datetime.now().isoformat(),
        }

    async def assign_task(self, task_id: str, agent_id: str) -> dict[str, Any]:
        """Assign a task to a specific agent.
        
        Args:
            task_id: Task to assign
            agent_id: Agent to assign to
            
        Returns:
            Assignment result
        """
        # Check if task exists and is assignable
        task_info = await self._get_task_info(task_id)
        if not task_info:
            raise ValueError(f"Task {task_id} not found")

        if task_info.get("status") != "pending":
            raise ValueError(f"Task {task_id} is not in pending status")

        # Check dependencies
        if not await self._check_task_dependencies(task_id):
            raise ValueError(f"Task {task_id} has unmet dependencies")

        # Assign task
        success = await self.db_manager.assign_task(task_id, agent_id)
        if not success:
            raise RuntimeError(f"Failed to assign task {task_id} to agent {agent_id}")

        # Log assignment
        self._log_task_event(
            task_id=task_id,
            event_type="assigned",
            message=f"Task assigned to agent {agent_id}",
        )

        # Start monitoring task execution
        monitor_task = asyncio.create_task(
            self._monitor_task_execution(task_id, agent_id),
        )
        self._task_monitors[task_id] = monitor_task

        # Calculate estimated completion
        task_requirements = TaskRequirements(**task_info.get("requirements", {}))
        estimated_completion = None
        if task_requirements.estimated_duration:
            estimated_completion = (
                datetime.now() + timedelta(seconds=task_requirements.estimated_duration)
            ).isoformat()

        logger.info("Task assigned",
                   task_id=task_id,
                   agent_id=agent_id)

        return {
            "success": True,
            "task_id": task_id,
            "agent_id": agent_id,
            "assigned_at": datetime.now().isoformat(),
            "estimated_completion": estimated_completion,
        }

    async def get_task_status(self, task_id: str) -> dict[str, Any] | None:
        """Get detailed status information for a task.
        
        Args:
            task_id: Task ID to query
            
        Returns:
            Task status information or None if not found
        """
        task_info = await self._get_task_info(task_id)
        if not task_info:
            return None

        # Get execution log
        execution_log = self._execution_logs.get(task_id, [])

        # Parse results if available
        results = None
        error_details = None
        if task_info.get("results"):
            try:
                parsed_results = json.loads(task_info["results"])
                if isinstance(parsed_results, dict):
                    results = parsed_results.get("output")
                    error_details = parsed_results.get("error_details")
            except (json.JSONDecodeError, AttributeError):
                pass

        # Calculate progress
        progress = self._calculate_task_progress(task_id, execution_log)

        # Get agent information
        assigned_agent = {
            "agent_id": task_info.get("assigned_agent_id"),
            "agent_name": None,  # TODO: Look up agent name
        }

        return {
            "task_id": task_id,
            "title": self._extract_task_title(task_info.get("description", "")),
            "task_type": task_info.get("task_type"),
            "status": task_info.get("status"),
            "assigned_agent": assigned_agent,
            "progress": progress,
            "results": results,
            "error_details": error_details,
            "created_at": task_info.get("created_at"),
            "started_at": self._get_task_start_time(execution_log),
            "completed_at": self._get_task_completion_time(execution_log),
            "execution_log": execution_log,
        }

    async def list_tasks(
        self,
        repository_path: str | None = None,
        status_filter: list[str] | None = None,
        assigned_agent_id: str | None = None,
        task_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """List tasks with filtering and pagination.
        
        Args:
            repository_path: Filter by repository
            status_filter: Filter by task status
            assigned_agent_id: Filter by assigned agent
            task_type: Filter by task type
            limit: Maximum number of results
            offset: Pagination offset
            
        Returns:
            List of tasks with pagination info
        """
        # Get tasks from database (simplified - would need proper SQL queries)
        all_tasks = await self.db_manager.get_pending_tasks(repository_path)

        # Apply filters
        filtered_tasks = []
        for task in all_tasks:
            # Status filter
            if status_filter and task.get("status", "pending") not in status_filter:
                continue

            # Agent filter
            if assigned_agent_id and task.get("assigned_agent_id") != assigned_agent_id:
                continue

            # Task type filter
            if task_type and task.get("task_type") != task_type:
                continue

            # Build task summary
            task_summary = {
                "task_id": task["id"],
                "title": self._extract_task_title(task.get("description", "")),
                "task_type": task.get("task_type"),
                "status": task.get("status", "pending"),
                "priority": task.get("priority", 0),
                "assigned_agent_name": None,  # TODO: Look up agent name
                "created_at": task.get("created_at"),
                "estimated_duration": None,  # TODO: Extract from requirements
            }

            filtered_tasks.append(task_summary)

        # Apply pagination
        total_count = len(filtered_tasks)
        paginated_tasks = filtered_tasks[offset:offset + limit]

        return {
            "tasks": paginated_tasks,
            "total_count": total_count,
            "has_more": offset + limit < total_count,
        }

    async def update_task_progress(
        self,
        task_id: str,
        progress: dict[str, Any],
    ) -> bool:
        """Update task progress information.
        
        Args:
            task_id: Task to update
            progress: Progress information
            
        Returns:
            True if update successful
        """
        # Log progress update
        self._log_task_event(
            task_id=task_id,
            event_type="progress_update",
            message=f"Progress: {progress.get('percentage', 0)}% - {progress.get('current_step', 'unknown')}",
        )

        logger.info("Task progress updated",
                   task_id=task_id,
                   progress=progress)

        return True

    async def complete_task(
        self,
        task_id: str,
        results: dict[str, Any],
        success: bool = True,
    ) -> bool:
        """Mark a task as completed with results.
        
        Args:
            task_id: Task to complete
            results: Task execution results
            success: Whether task completed successfully
            
        Returns:
            True if completion successful
        """
        status = "completed" if success else "failed"

        # Create result object
        task_result = TaskResult(
            success=success,
            output=results,
            execution_time=self._calculate_execution_time(task_id),
        )

        # Update task in database
        update_success = await self.db_manager.update_task_status(
            task_id=task_id,
            status=status,
            results=task_result.model_dump(),
        )

        if update_success:
            # Log completion
            self._log_task_event(
                task_id=task_id,
                event_type="completed" if success else "failed",
                message=f"Task {'completed successfully' if success else 'failed'}",
            )

            # Clean up monitoring
            monitor_task = self._task_monitors.get(task_id)
            if monitor_task:
                monitor_task.cancel()
                del self._task_monitors[task_id]

            logger.info("Task completed",
                       task_id=task_id,
                       success=success)

        return update_success

    async def _monitor_task_execution(self, task_id: str, agent_id: str) -> None:
        """Monitor task execution and handle timeouts.
        
        Args:
            task_id: Task to monitor
            agent_id: Assigned agent
        """
        try:
            # Log task start
            self._log_task_event(
                task_id=task_id,
                event_type="started",
                message=f"Task execution started by agent {agent_id}",
            )

            # Get task requirements for timeout
            task_info = await self._get_task_info(task_id)
            if not task_info:
                return

            requirements = TaskRequirements(**task_info.get("requirements", {}))
            timeout = requirements.estimated_duration or 3600  # Default 1 hour

            # Wait for completion or timeout
            await asyncio.sleep(timeout)

            # Check if task is still running
            updated_task_info = await self._get_task_info(task_id)
            if updated_task_info and updated_task_info.get("status") == "in_progress":
                # Task timed out
                logger.warning("Task execution timeout",
                             task_id=task_id,
                             agent_id=agent_id,
                             timeout=timeout)

                self._log_task_event(
                    task_id=task_id,
                    event_type="timeout",
                    message=f"Task execution timed out after {timeout} seconds",
                )

                # Mark as failed
                await self.complete_task(
                    task_id=task_id,
                    results={"error": "Task execution timed out"},
                    success=False,
                )

        except asyncio.CancelledError:
            logger.info("Task monitoring cancelled", task_id=task_id)
        except Exception as e:
            logger.error("Task monitoring failed",
                        task_id=task_id,
                        error=str(e))

    async def _get_task_info(self, task_id: str) -> dict[str, Any] | None:
        """Get task information from database.
        
        Args:
            task_id: Task ID
            
        Returns:
            Task information or None if not found
        """
        # This would need a proper database query
        # For now, returning a simplified placeholder
        return None

    async def _check_task_dependencies(self, task_id: str) -> bool:
        """Check if all task dependencies are satisfied.
        
        Args:
            task_id: Task to check
            
        Returns:
            True if all dependencies are met
        """
        # TODO: Implement dependency checking
        return True

    async def _add_task_dependencies(self, task_id: str, dependencies: list[str]) -> None:
        """Add task dependencies to the database.
        
        Args:
            task_id: Task ID
            dependencies: List of dependency task IDs
        """
        # TODO: Implement dependency tracking

    def _log_task_event(
        self,
        task_id: str,
        event_type: str,
        message: str,
    ) -> None:
        """Log a task execution event.
        
        Args:
            task_id: Task ID
            event_type: Type of event
            message: Event message
        """
        if task_id not in self._execution_logs:
            self._execution_logs[task_id] = []

        event = {
            "timestamp": datetime.now().isoformat(),
            "event_type": event_type,
            "message": message,
        }

        self._execution_logs[task_id].append(event)

    def _extract_task_title(self, description: str) -> str:
        """Extract title from task description.
        
        Args:
            description: Full task description
            
        Returns:
            Extracted title
        """
        if ":" in description:
            return description.split(":", 1)[0].strip()
        return description[:50] + "..." if len(description) > 50 else description

    def _calculate_task_progress(
        self,
        task_id: str,
        execution_log: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Calculate task progress from execution log.
        
        Args:
            task_id: Task ID
            execution_log: Execution log entries
            
        Returns:
            Progress information
        """
        # Simple progress calculation based on events
        total_events = len(execution_log)
        completed_events = sum(1 for event in execution_log
                             if event.get("event_type") in ["completed", "progress_update"])

        percentage = int((completed_events / max(total_events, 1)) * 100)

        # Get current step from latest event
        current_step = ""
        if execution_log:
            latest_event = execution_log[-1]
            current_step = latest_event.get("message", "")

        return {
            "percentage": min(percentage, 100),
            "current_step": current_step,
            "steps_completed": completed_events,
            "total_steps": total_events,
        }

    def _get_task_start_time(self, execution_log: list[dict[str, Any]]) -> str | None:
        """Get task start time from execution log.
        
        Args:
            execution_log: Execution log entries
            
        Returns:
            Start timestamp or None
        """
        for event in execution_log:
            if event.get("event_type") == "started":
                return event.get("timestamp")
        return None

    def _get_task_completion_time(self, execution_log: list[dict[str, Any]]) -> str | None:
        """Get task completion time from execution log.
        
        Args:
            execution_log: Execution log entries
            
        Returns:
            Completion timestamp or None
        """
        for event in reversed(execution_log):
            if event.get("event_type") in ["completed", "failed"]:
                return event.get("timestamp")
        return None

    def _calculate_execution_time(self, task_id: str) -> int | None:
        """Calculate task execution time in seconds.
        
        Args:
            task_id: Task ID
            
        Returns:
            Execution time in seconds or None
        """
        execution_log = self._execution_logs.get(task_id, [])
        start_time = self._get_task_start_time(execution_log)
        end_time = self._get_task_completion_time(execution_log)

        if start_time and end_time:
            try:
                start_dt = datetime.fromisoformat(start_time)
                end_dt = datetime.fromisoformat(end_time)
                return int((end_dt - start_dt).total_seconds())
            except ValueError:
                pass

        return None

    async def cleanup(self) -> None:
        """Clean up task monitoring resources."""
        # Cancel all monitoring tasks
        for task in self._task_monitors.values():
            task.cancel()

        self._task_monitors.clear()
        self._execution_logs.clear()

        logger.info("Task manager cleanup complete")
