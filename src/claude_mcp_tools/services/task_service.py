"""Task management service using SQLAlchemy ORM."""

import uuid
from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import execute_query
from ..models import Task, TaskDependency, TaskStatus

logger = structlog.get_logger()


class TaskService:
    """Service for task management operations using SQLAlchemy ORM."""

    @staticmethod
    async def create_task(
        repository_path: str,
        task_type: str,
        title: str,
        description: str,
        requirements: dict[str, Any] | None = None,
        priority: int = 0,
        parent_task_id: str | None = None,
        dependencies: list[str] | None = None,
    ) -> dict[str, Any]:
        """Create a new task.
        
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
            Task creation result with task_id
        """
        async def _create_task(session: AsyncSession):
            # Generate task ID
            task_id = str(uuid.uuid4())

            # Create task instance
            task = Task(
                id=task_id,
                repository_path=repository_path,
                task_type=task_type,
                description=f"{title}: {description}",
                priority=priority,
                parent_task_id=parent_task_id,
                status=TaskStatus.PENDING,
            )

            # Set requirements if provided
            if requirements:
                task.set_requirements(requirements)

            # Add to session
            session.add(task)
            await session.commit()

            # Handle dependencies if provided
            if dependencies:
                for dep_task_id in dependencies:
                    dependency = TaskDependency(
                        task_id=task_id,
                        depends_on_task_id=dep_task_id,
                        dependency_type="completion",
                    )
                    session.add(dependency)

                await session.commit()

            logger.info("Task created",
                       task_id=task_id,
                       task_type=task_type,
                       title=title,
                       repository_path=repository_path)

            return {
                "task_id": task_id,
                "status": task.status.value,
                "required_capabilities": requirements.get("capabilities", []) if requirements else [],
                "created_at": task.created_at.isoformat(),
            }

        return await execute_query(_create_task)

    @staticmethod
    async def get_task_by_id(task_id: str) -> dict[str, Any] | None:
        """Get task by ID.
        
        Args:
            task_id: Task ID to retrieve
            
        Returns:
            Task information or None if not found
        """
        async def _get_task(session: AsyncSession):
            # Query with eager loading of relationships
            stmt = select(Task).options(
                selectinload(Task.assigned_agent),
                selectinload(Task.dependencies),
                selectinload(Task.dependents),
            ).where(Task.id == task_id)

            result = await session.execute(stmt)
            task = result.scalar_one_or_none()

            if not task:
                return None

            return {
                "id": task.id,
                "repository_path": task.repository_path,
                "task_type": task.task_type,
                "status": task.status.value,
                "assigned_agent_id": task.assigned_agent_id,
                "parent_task_id": task.parent_task_id,
                "priority": task.priority,
                "description": task.description,
                "requirements": task.get_requirements(),
                "results": task.get_results(),
                "created_at": task.created_at.isoformat(),
                "updated_at": task.updated_at.isoformat(),
                "assigned_agent": {
                    "id": task.assigned_agent.id,
                    "name": task.assigned_agent.agent_name,
                    "status": task.assigned_agent.status.value,
                } if task.assigned_agent else None,
            }

        return await execute_query(_get_task)

    @staticmethod
    async def assign_task(task_id: str, agent_id: str) -> bool:
        """Assign a task to an agent.
        
        Args:
            task_id: Task ID to assign
            agent_id: Agent ID to assign to
            
        Returns:
            True if assignment successful, False otherwise
        """
        async def _assign_task(session: AsyncSession):
            # Get the task
            stmt = select(Task).where(Task.id == task_id)
            result = await session.execute(stmt)
            task = result.scalar_one_or_none()

            if not task:
                logger.error("Task not found for assignment", task_id=task_id)
                return False

            if task.status != TaskStatus.PENDING:
                logger.error("Task not in pending status", task_id=task_id, status=task.status)
                return False

            # Update task
            task.assigned_agent_id = agent_id
            task.status = TaskStatus.IN_PROGRESS
            task.updated_at = datetime.now()

            await session.commit()

            logger.info("Task assigned", task_id=task_id, agent_id=agent_id)
            return True

        return await execute_query(_assign_task)

    @staticmethod
    async def update_task_status(
        task_id: str,
        status: TaskStatus,
        results: dict[str, Any] | None = None,
    ) -> bool:
        """Update task status and results.
        
        Args:
            task_id: Task ID to update
            status: New task status
            results: Task results if completed
            
        Returns:
            True if update successful, False otherwise
        """
        async def _update_task(session: AsyncSession):
            # Get the task
            stmt = select(Task).where(Task.id == task_id)
            result = await session.execute(stmt)
            task = result.scalar_one_or_none()

            if not task:
                logger.error("Task not found for status update", task_id=task_id)
                return False

            # Update task
            task.status = status
            task.updated_at = datetime.now()

            if results:
                task.set_results(results)

            await session.commit()

            logger.info("Task status updated", task_id=task_id, status=status.value)
            return True

        return await execute_query(_update_task)

    @staticmethod
    async def list_tasks_safe(
        repository_path: str | None = None,
        status_filter: list[TaskStatus] | None = None,
        task_type_filter: str | None = None,
        assigned_agent_filter: str | None = None,
        include_completed: bool = False,
        limit: int = 100,
    ) -> dict[str, Any]:
        """List tasks with MCP-safe session management.
        
        This method uses MCP-safe database access patterns to prevent 
        communication channel conflicts in FastMCP resource handlers.
        
        Args:
            repository_path: Filter by repository path
            status_filter: Filter by task status
            task_type_filter: Filter by task type
            assigned_agent_filter: Filter by assigned agent ID
            include_completed: Include completed tasks in results
            limit: Maximum number of tasks to return
            
        Returns:
            Dictionary with tasks list and metadata
        """
        from ..database import mcp_safe_execute_query
        
        async def _list_tasks_safe(session):
            # Simplified query to minimize session lifetime - no eager loading
            stmt = select(Task)

            # Apply filters
            if repository_path:
                stmt = stmt.where(Task.repository_path == repository_path)

            if status_filter:
                stmt = stmt.where(Task.status.in_(status_filter))
            
            if task_type_filter:
                stmt = stmt.where(Task.task_type == task_type_filter)
            
            if assigned_agent_filter:
                stmt = stmt.where(Task.assigned_agent_id == assigned_agent_filter)
            
            # Handle include_completed flag
            if not include_completed:
                stmt = stmt.where(Task.status != TaskStatus.COMPLETED)

            # Order by priority (desc) and created_at (desc)
            stmt = stmt.order_by(Task.priority.desc(), Task.created_at.desc())

            # Apply limit
            stmt = stmt.limit(limit)

            result = await session.execute(stmt)
            tasks = result.scalars().all()

            task_list = []
            for task in tasks:
                task_dict = {
                    "id": task.id,
                    "repository_path": task.repository_path,
                    "task_type": task.task_type,
                    "status": task.status.value,
                    "assigned_agent_id": task.assigned_agent_id,
                    "parent_task_id": task.parent_task_id,
                    "priority": task.priority,
                    "description": task.description,
                    "requirements": task.get_requirements(),
                    "created_at": task.created_at.isoformat(),
                    "updated_at": task.updated_at.isoformat(),
                    "assigned_agent": None,  # Skip expensive agent loading for MCP
                }

                task_list.append(task_dict)

            return {
                "tasks": task_list,
                "count": len(task_list),
                "filters": {
                    "repository_path": repository_path,
                    "status_filter": [s.value for s in status_filter] if status_filter else None,
                    "task_type_filter": task_type_filter,
                    "assigned_agent_filter": assigned_agent_filter,
                    "include_completed": include_completed,
                },
            }
        
        # Use MCP-safe execution with 3 second timeout for fast response
        try:
            result = await mcp_safe_execute_query(_list_tasks_safe, timeout=3.0)
            return result
        except Exception as e:
            logger.error("MCP-safe list_tasks failed", error=str(e))
            return {"error": f"Database error: {e}"}

    @staticmethod
    async def list_tasks(
        repository_path: str | None = None,
        status_filter: list[TaskStatus] | None = None,
        task_type_filter: str | None = None,
        assigned_agent_filter: str | None = None,
        include_completed: bool = False,
        limit: int = 100,
    ) -> dict[str, Any]:
        """List tasks with optional filtering.
        
        Args:
            repository_path: Filter by repository path
            status_filter: Filter by task status
            task_type_filter: Filter by task type
            assigned_agent_filter: Filter by assigned agent ID
            include_completed: Include completed tasks in results
            limit: Maximum number of tasks to return
            
        Returns:
            Dictionary with tasks list and metadata
        """
        async def _list_tasks(session: AsyncSession):
            # Build query
            stmt = select(Task).options(selectinload(Task.assigned_agent))

            # Apply filters
            if repository_path:
                stmt = stmt.where(Task.repository_path == repository_path)

            if status_filter:
                stmt = stmt.where(Task.status.in_(status_filter))
            
            if task_type_filter:
                stmt = stmt.where(Task.task_type == task_type_filter)
            
            if assigned_agent_filter:
                stmt = stmt.where(Task.assigned_agent_id == assigned_agent_filter)
            
            # Handle include_completed flag
            if not include_completed:
                stmt = stmt.where(Task.status != TaskStatus.COMPLETED)

            # Order by priority (desc) and created_at (desc)
            stmt = stmt.order_by(Task.priority.desc(), Task.created_at.desc())

            # Apply limit
            stmt = stmt.limit(limit)

            result = await session.execute(stmt)
            tasks = result.scalars().all()

            task_list = []
            for task in tasks:
                task_dict = {
                    "id": task.id,
                    "repository_path": task.repository_path,
                    "task_type": task.task_type,
                    "status": task.status.value,
                    "assigned_agent_id": task.assigned_agent_id,
                    "parent_task_id": task.parent_task_id,
                    "priority": task.priority,
                    "description": task.description,
                    "requirements": task.get_requirements(),
                    "created_at": task.created_at.isoformat(),
                    "updated_at": task.updated_at.isoformat(),
                }

                if task.assigned_agent:
                    task_dict["assigned_agent"] = {
                        "id": task.assigned_agent.id,
                        "name": task.assigned_agent.agent_name,
                        "status": task.assigned_agent.status.value,
                    }

                task_list.append(task_dict)

            return {
                "tasks": task_list,
                "count": len(task_list),
                "filters": {
                    "repository_path": repository_path,
                    "status_filter": [s.value for s in status_filter] if status_filter else None,
                    "task_type_filter": task_type_filter,
                    "assigned_agent_filter": assigned_agent_filter,
                    "include_completed": include_completed,
                },
            }

        return await execute_query(_list_tasks)

    @staticmethod
    async def check_task_dependencies(task_id: str) -> bool:
        """Check if all task dependencies are satisfied.
        
        Args:
            task_id: Task ID to check
            
        Returns:
            True if all dependencies are satisfied, False otherwise
        """
        async def _check_dependencies(session: AsyncSession):
            # Get all dependencies for this task
            stmt = select(TaskDependency).options(
                selectinload(TaskDependency.depends_on_task),
            ).where(TaskDependency.task_id == task_id)

            result = await session.execute(stmt)
            dependencies = result.scalars().all()

            # Check if all dependency tasks are completed
            for dep in dependencies:
                if dep.depends_on_task.status != TaskStatus.COMPLETED:
                    return False

            return True

        return await execute_query(_check_dependencies)

    @staticmethod
    async def create_task_batch(
        tasks: list[dict[str, Any]],
        repository_path: str,
    ) -> dict[str, Any]:
        """Create multiple tasks in a single transaction.
        
        Args:
            tasks: List of task definitions with keys: task_type, title, description, 
                  requirements (optional), priority (optional), parent_task_id (optional),
                  dependencies (optional)
            repository_path: Repository path for all tasks
            
        Returns:
            Dictionary with created task IDs and summary
        """
        async def _create_batch(session: AsyncSession):
            created_tasks = []
            task_id_map = {}  # For resolving cross-references

            # First pass: Create all tasks without dependencies
            for i, task_def in enumerate(tasks):
                task_id = str(uuid.uuid4())
                task_id_map[i] = task_id

                task = Task(
                    id=task_id,
                    repository_path=repository_path,
                    task_type=task_def["task_type"],
                    description=f"{task_def['title']}: {task_def['description']}",
                    priority=task_def.get("priority", 0),
                    parent_task_id=task_def.get("parent_task_id"),
                    status=TaskStatus.PENDING,
                )

                # Set requirements if provided
                requirements = task_def.get("requirements")
                if requirements:
                    task.set_requirements(requirements)

                session.add(task)
                created_tasks.append({
                    "task_id": task_id,
                    "task_type": task_def["task_type"],
                    "title": task_def["title"],
                    "index": i,
                })

            # Commit tasks first
            await session.commit()

            # Second pass: Handle dependencies
            for i, task_def in enumerate(tasks):
                dependencies = task_def.get("dependencies", [])
                if dependencies:
                    task_id = task_id_map[i]

                    for dep in dependencies:
                        # Support both index references and direct task IDs
                        if isinstance(dep, int) and dep < len(tasks):
                            dep_task_id = task_id_map[dep]
                        else:
                            dep_task_id = dep  # Assume it's a direct task ID

                        dependency = TaskDependency(
                            task_id=task_id,
                            depends_on_task_id=dep_task_id,
                            dependency_type="completion",
                        )
                        session.add(dependency)

            # Commit dependencies
            await session.commit()

            logger.info("Task batch created",
                       count=len(created_tasks),
                       repository_path=repository_path)

            return {
                "success": True,
                "created_tasks": created_tasks,
                "count": len(created_tasks),
                "repository_path": repository_path,
            }

        return await execute_query(_create_batch)

    @staticmethod
    async def create_workflow(
        workflow_name: str,
        repository_path: str,
        workflow_steps: list[dict[str, Any]],
        workflow_type: str = "sequential",
    ) -> dict[str, Any]:
        """Create a complete workflow with multiple interconnected tasks.
        
        Args:
            workflow_name: Name/title of the workflow
            repository_path: Repository path
            workflow_steps: List of workflow steps with task definitions
            workflow_type: "sequential", "parallel", or "custom"
            
        Returns:
            Dictionary with workflow creation result
        """
        async def _create_workflow(session: AsyncSession):
            # Create a parent task for the workflow
            workflow_id = str(uuid.uuid4())
            workflow_task = Task(
                id=workflow_id,
                repository_path=repository_path,
                task_type=f"workflow_{workflow_type}",
                description=f"Workflow: {workflow_name}",
                priority=10,  # High priority for workflow coordination
                status=TaskStatus.PENDING,
            )

            session.add(workflow_task)
            await session.commit()

            # Prepare task definitions based on workflow type
            tasks = []
            for i, step in enumerate(workflow_steps):
                task_def = {
                    "task_type": step.get("task_type", "implementation"),
                    "title": step["title"],
                    "description": step["description"],
                    "requirements": step.get("requirements", {}),
                    "priority": step.get("priority", 5),
                    "parent_task_id": workflow_id,
                }

                # Add dependencies based on workflow type
                if workflow_type == "sequential" and i > 0:
                    task_def["dependencies"] = [i - 1]  # Depend on previous task
                elif workflow_type == "custom" and "depends_on" in step:
                    task_def["dependencies"] = step["depends_on"]
                # parallel workflow has no dependencies between tasks

                tasks.append(task_def)

            # Create all workflow tasks
            batch_result = await TaskService.create_task_batch(tasks, repository_path)

            logger.info("Workflow created",
                       workflow_id=workflow_id,
                       workflow_name=workflow_name,
                       steps_count=len(workflow_steps),
                       workflow_type=workflow_type)

            return {
                "success": True,
                "workflow_id": workflow_id,
                "workflow_name": workflow_name,
                "workflow_type": workflow_type,
                "steps": batch_result["created_tasks"],
                "total_tasks": len(workflow_steps) + 1,  # +1 for workflow task
            }

        return await execute_query(_create_workflow)

    @staticmethod
    async def start_workflow(workflow_id: str) -> dict[str, Any]:
        """Start a workflow by activating its first available tasks.
        
        Args:
            workflow_id: ID of the workflow to start
            
        Returns:
            Dictionary with workflow start result
        """
        async def _start_workflow(session: AsyncSession):
            # Get the workflow task
            workflow_stmt = select(Task).where(Task.id == workflow_id)
            workflow_result = await session.execute(workflow_stmt)
            workflow_task = workflow_result.scalar_one_or_none()
            
            if not workflow_task:
                return {"success": False, "error": "Workflow not found"}
            
            if workflow_task.status != TaskStatus.PENDING:
                return {"success": False, "error": f"Workflow not in pending status: {workflow_task.status.value}"}
            
            # Get all workflow steps (child tasks)
            steps_stmt = select(Task).options(
                selectinload(Task.dependencies)
            ).where(Task.parent_task_id == workflow_id)
            
            steps_result = await session.execute(steps_stmt)
            workflow_steps = steps_result.scalars().all()
            
            if not workflow_steps:
                return {"success": False, "error": "No workflow steps found"}
            
            # Find tasks with no dependencies (can start immediately)
            startable_tasks = []
            for step in workflow_steps:
                if step.status == TaskStatus.PENDING:
                    # Check if all dependencies are satisfied
                    dependencies_satisfied = await TaskService.check_task_dependencies(step.id)
                    if dependencies_satisfied or not step.dependencies:
                        startable_tasks.append(step)
            
            # Update workflow status to IN_PROGRESS
            workflow_task.status = TaskStatus.IN_PROGRESS
            workflow_task.updated_at = datetime.now()
            
            # Mark startable tasks as ready for assignment
            started_tasks = []
            for task in startable_tasks:
                if task.status == TaskStatus.PENDING:
                    # Keep as PENDING but mark as ready in metadata
                    task.updated_at = datetime.now()
                    # Add workflow_started flag to requirements
                    requirements = task.get_requirements() or {}
                    requirements["workflow_started"] = True
                    requirements["workflow_id"] = workflow_id
                    task.set_requirements(requirements)
                    
                    started_tasks.append({
                        "task_id": task.id,
                        "task_type": task.task_type,
                        "title": task.description.split(":")[0] if ":" in task.description else task.description[:50],
                        "status": "ready_for_assignment"
                    })
            
            await session.commit()
            
            logger.info("Workflow started",
                       workflow_id=workflow_id,
                       total_steps=len(workflow_steps),
                       startable_tasks=len(started_tasks))
            
            return {
                "success": True,
                "workflow_id": workflow_id,
                "workflow_status": "in_progress",
                "total_steps": len(workflow_steps),
                "started_tasks": len(started_tasks),
                "ready_tasks": started_tasks,
                "message": f"Workflow started with {len(started_tasks)} tasks ready for assignment"
            }
        
        return await execute_query(_start_workflow)

    @staticmethod
    async def split_task(
        parent_task_id: str,
        subtask_definitions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Split a large task into multiple subtasks.
        
        Args:
            parent_task_id: ID of the task to split
            subtask_definitions: List of subtask definitions
            
        Returns:
            Dictionary with split task result
        """
        async def _split_task(session: AsyncSession):
            # Get the parent task
            stmt = select(Task).where(Task.id == parent_task_id)
            result = await session.execute(stmt)
            parent_task = result.scalar_one_or_none()

            if not parent_task:
                return {"error": {"code": "PARENT_TASK_NOT_FOUND", "message": "Parent task not found"}}

            # Create subtasks
            tasks = []
            for subtask_def in subtask_definitions:
                task_def = {
                    "task_type": subtask_def.get("task_type", parent_task.task_type),
                    "title": subtask_def["title"],
                    "description": subtask_def["description"],
                    "requirements": subtask_def.get("requirements", {}),
                    "priority": subtask_def.get("priority", parent_task.priority),
                    "parent_task_id": parent_task_id,
                    "dependencies": subtask_def.get("dependencies", []),
                }
                tasks.append(task_def)

            # Create all subtasks
            batch_result = await TaskService.create_task_batch(tasks, parent_task.repository_path)

            # Update parent task status to indicate it's been split
            parent_task.status = TaskStatus.IN_PROGRESS
            parent_task.updated_at = datetime.now()
            await session.commit()

            logger.info("Task split",
                       parent_task_id=parent_task_id,
                       subtasks_count=len(subtask_definitions))

            return {
                "success": True,
                "parent_task_id": parent_task_id,
                "subtasks": batch_result["created_tasks"],
                "subtasks_count": len(subtask_definitions),
            }

        return await execute_query(_split_task)

    @staticmethod
    async def assign_tasks_bulk(
        task_assignments: list[dict[str, str]],
    ) -> dict[str, Any]:
        """Assign multiple tasks to agents in a single operation.
        
        Args:
            task_assignments: List of dictionaries with 'task_id' and 'agent_id' keys
            
        Returns:
            Dictionary with assignment results
        """
        async def _assign_bulk(session: AsyncSession):
            assignment_results = []
            successful_assignments = 0
            failed_assignments = 0

            for assignment in task_assignments:
                task_id = assignment["task_id"]
                agent_id = assignment["agent_id"]

                try:
                    # Get the task
                    stmt = select(Task).where(Task.id == task_id)
                    result = await session.execute(stmt)
                    task = result.scalar_one_or_none()

                    if not task:
                        assignment_results.append({
                            "task_id": task_id,
                            "agent_id": agent_id,
                            "success": False,
                            "error": "Task not found",
                        })
                        failed_assignments += 1
                        continue

                    if task.status != TaskStatus.PENDING:
                        assignment_results.append({
                            "task_id": task_id,
                            "agent_id": agent_id,
                            "success": False,
                            "error": f"Task not in pending status: {task.status.value}",
                        })
                        failed_assignments += 1
                        continue

                    # Assign the task
                    task.assigned_agent_id = agent_id
                    task.status = TaskStatus.IN_PROGRESS
                    task.updated_at = datetime.now()

                    assignment_results.append({
                        "task_id": task_id,
                        "agent_id": agent_id,
                        "success": True,
                        "task_type": task.task_type,
                        "title": task.description.split(":")[0] if ":" in task.description else task.description[:50],
                    })
                    successful_assignments += 1

                except Exception as e:
                    assignment_results.append({
                        "task_id": task_id,
                        "agent_id": agent_id,
                        "success": False,
                        "error": str(e),
                    })
                    failed_assignments += 1

            # Commit all assignments
            await session.commit()

            logger.info("Bulk task assignment completed",
                       total=len(task_assignments),
                       successful=successful_assignments,
                       failed=failed_assignments)

            return {
                "success": True,
                "total_assignments": len(task_assignments),
                "successful_assignments": successful_assignments,
                "failed_assignments": failed_assignments,
                "assignment_results": assignment_results,
            }

        return await execute_query(_assign_bulk)

    @staticmethod
    async def auto_assign_tasks(
        repository_path: str,
        agent_capabilities: dict[str, list[str]] | None = None,
        max_tasks_per_agent: int = 3,
    ) -> dict[str, Any]:
        """Automatically assign pending tasks to available agents based on capabilities.
        
        Args:
            repository_path: Repository to assign tasks for
            agent_capabilities: Dict mapping agent_id to list of capabilities
            max_tasks_per_agent: Maximum tasks to assign per agent
            
        Returns:
            Dictionary with auto-assignment results
        """
        async def _auto_assign(session: AsyncSession):
            # Get all pending tasks for the repository
            pending_tasks_stmt = select(Task).where(
                and_(
                    Task.repository_path == repository_path,
                    Task.status == TaskStatus.PENDING,
                ),
            ).order_by(Task.priority.desc(), Task.created_at.asc())

            pending_result = await session.execute(pending_tasks_stmt)
            pending_tasks = pending_result.scalars().all()

            if not pending_tasks:
                return {
                    "success": True,
                    "message": "No pending tasks to assign",
                    "assignments": [],
                }

            # Get current agent workloads (count of in-progress tasks)
            from ..models import AgentStatus
            from ..services.agent_service import AgentService

            agents_result = await AgentService.list_agents(
                repository_path=repository_path,
                status_filter=[AgentStatus.ACTIVE, AgentStatus.IDLE],
            )

            if not agents_result.get("agents"):
                return {
                    "success": False,
                    "error": "No available agents for assignment",
                }

            available_agents = agents_result["agents"]

            # Calculate current workloads
            agent_workloads = {}
            for agent in available_agents:
                workload_stmt = select(func.count(Task.id)).where(
                    and_(
                        Task.assigned_agent_id == agent["id"],
                        Task.status == TaskStatus.IN_PROGRESS,
                    ),
                )
                workload_result = await session.execute(workload_stmt)
                current_workload = workload_result.scalar() or 0
                agent_workloads[agent["id"]] = current_workload

            # Smart assignment algorithm
            assignments = []
            for task in pending_tasks:
                best_agent = None
                best_score = -1

                for agent in available_agents:
                    agent_id = agent["id"]

                    # Skip if agent is at max capacity
                    if agent_workloads[agent_id] >= max_tasks_per_agent:
                        continue

                    # Calculate assignment score
                    score = 0

                    # Prefer agents with lower workload
                    score += (max_tasks_per_agent - agent_workloads[agent_id]) * 10

                    # Prefer agents with matching capabilities
                    if agent_capabilities and agent_id in agent_capabilities:
                        agent_caps = agent_capabilities[agent_id]
                        task_requirements = task.get_requirements()
                        required_caps = task_requirements.get("capabilities", [])

                        for cap in required_caps:
                            if cap in agent_caps:
                                score += 20  # High bonus for capability match

                    # Prefer active agents over idle ones
                    if agent["status"] == "active":
                        score += 5

                    if score > best_score:
                        best_score = score
                        best_agent = agent_id

                # Assign to best agent if found
                if best_agent:
                    task.assigned_agent_id = best_agent
                    task.status = TaskStatus.IN_PROGRESS
                    task.updated_at = datetime.now()

                    agent_workloads[best_agent] += 1

                    assignments.append({
                        "task_id": task.id,
                        "agent_id": best_agent,
                        "task_type": task.task_type,
                        "title": task.description.split(":")[0] if ":" in task.description else task.description[:50],
                        "assignment_score": best_score,
                    })

            await session.commit()

            logger.info("Auto-assignment completed",
                       repository_path=repository_path,
                       pending_tasks=len(pending_tasks),
                       assignments_made=len(assignments))

            return {
                "success": True,
                "repository_path": repository_path,
                "pending_tasks_count": len(pending_tasks),
                "assignments_made": len(assignments),
                "unassigned_tasks": len(pending_tasks) - len(assignments),
                "assignments": assignments,
            }

        return await execute_query(_auto_assign)

    @staticmethod
    async def balance_workload(
        repository_path: str,
        target_tasks_per_agent: int = 2,
    ) -> dict[str, Any]:
        """Rebalance task assignments to distribute workload evenly.
        
        Args:
            repository_path: Repository to balance workload for
            target_tasks_per_agent: Target number of tasks per agent
            
        Returns:
            Dictionary with rebalancing results
        """
        async def _balance_workload(session: AsyncSession):
            # Get all active agents and their current workloads
            from ..models import AgentStatus
            from ..services.agent_service import AgentService

            agents_result = await AgentService.list_agents(
                repository_path=repository_path,
                status_filter=[AgentStatus.ACTIVE, AgentStatus.IDLE],
            )

            if not agents_result.get("agents"):
                return {
                    "success": False,
                    "error": "No available agents for rebalancing",
                }

            available_agents = agents_result["agents"]

            # Get current task assignments
            in_progress_tasks_stmt = select(Task).where(
                and_(
                    Task.repository_path == repository_path,
                    Task.status == TaskStatus.IN_PROGRESS,
                    Task.assigned_agent_id.isnot(None),
                ),
            ).order_by(Task.priority.desc())

            result = await session.execute(in_progress_tasks_stmt)
            active_tasks = result.scalars().all()

            # Calculate current workloads
            agent_workloads = {agent["id"]: [] for agent in available_agents}

            for task in active_tasks:
                if task.assigned_agent_id in agent_workloads:
                    agent_workloads[task.assigned_agent_id].append(task)

            # Identify overloaded and underloaded agents
            overloaded_agents = []
            underloaded_agents = []

            for agent_id, tasks in agent_workloads.items():
                if len(tasks) > target_tasks_per_agent:
                    overloaded_agents.append((agent_id, tasks))
                elif len(tasks) < target_tasks_per_agent:
                    underloaded_agents.append((agent_id, tasks))

            # Rebalance by moving tasks from overloaded to underloaded agents
            rebalancing_actions = []

            for overloaded_agent_id, overloaded_tasks in overloaded_agents:
                excess_tasks = len(overloaded_tasks) - target_tasks_per_agent

                # Sort by priority (move lower priority tasks first)
                tasks_to_move = sorted(overloaded_tasks, key=lambda t: t.priority)[:excess_tasks]

                for task in tasks_to_move:
                    # Find best underloaded agent
                    best_agent = None
                    min_workload = float("inf")

                    for underloaded_agent_id, underloaded_tasks in underloaded_agents:
                        if len(underloaded_tasks) < min_workload:
                            min_workload = len(underloaded_tasks)
                            best_agent = underloaded_agent_id

                    if best_agent and min_workload < target_tasks_per_agent:
                        # Move the task
                        task.assigned_agent_id = best_agent
                        task.updated_at = datetime.now()

                        rebalancing_actions.append({
                            "task_id": task.id,
                            "from_agent": overloaded_agent_id,
                            "to_agent": best_agent,
                            "task_type": task.task_type,
                            "title": task.description.split(":")[0] if ":" in task.description else task.description[:50],
                        })

                        # Update workload tracking
                        for i, (agent_id, tasks) in enumerate(underloaded_agents):
                            if agent_id == best_agent:
                                underloaded_agents[i] = (agent_id, tasks + [task])
                                break

            await session.commit()

            logger.info("Workload rebalancing completed",
                       repository_path=repository_path,
                       rebalancing_actions=len(rebalancing_actions))

            return {
                "success": True,
                "repository_path": repository_path,
                "target_tasks_per_agent": target_tasks_per_agent,
                "rebalancing_actions": len(rebalancing_actions),
                "actions": rebalancing_actions,
            }

        return await execute_query(_balance_workload)

    @staticmethod
    async def auto_assign_tasks_parallel(
        repository_path: str,
        agent_capabilities: dict[str, list[str]] | None = None,
        max_tasks_per_agent: int = 3,
        batch_size: int = 10,
    ) -> dict[str, Any]:
        """Automatically assign pending tasks to available agents using parallel processing.
        
        This is an optimized version of auto_assign_tasks that processes tasks in parallel
        for improved performance with large task sets.
        
        Args:
            repository_path: Repository to assign tasks for
            agent_capabilities: Dict mapping agent_id to list of capabilities
            max_tasks_per_agent: Maximum tasks to assign per agent
            batch_size: Number of tasks to process in each parallel batch
            
        Returns:
            Dictionary with auto-assignment results
        """
        from ..database import execute_concurrent_queries

        async def _auto_assign_parallel(session: AsyncSession):
            # Get all pending tasks for the repository
            pending_tasks_stmt = select(Task).where(
                and_(
                    Task.repository_path == repository_path,
                    Task.status == TaskStatus.PENDING,
                ),
            ).order_by(Task.priority.desc(), Task.created_at.asc())

            pending_result = await session.execute(pending_tasks_stmt)
            pending_tasks = pending_result.scalars().all()

            if not pending_tasks:
                return {
                    "success": True,
                    "message": "No pending tasks to assign",
                    "assignments": [],
                }

            # Get current agent workloads (count of in-progress tasks)
            from ..models import AgentStatus
            from ..services.agent_service import AgentService

            agents_result = await AgentService.list_agents(
                repository_path=repository_path,
                status_filter=[AgentStatus.ACTIVE, AgentStatus.IDLE],
            )

            if not agents_result.get("agents"):
                return {
                    "success": False,
                    "error": "No available agents for assignment",
                }

            available_agents = agents_result["agents"]

            # Calculate current workloads for all agents in parallel
            workload_queries = []
            for agent in available_agents:
                workload_queries.append({
                    "func": lambda session, agent_id=agent["id"]: session.execute(
                        select(func.count(Task.id)).where(
                            and_(
                                Task.assigned_agent_id == agent_id,
                                Task.status == TaskStatus.IN_PROGRESS,
                            ),
                        ),
                    ),
                    "id": agent["id"],
                })

            # Execute workload queries in parallel
            workload_results = await execute_concurrent_queries(workload_queries)
            agent_workloads = {}
            for i, agent in enumerate(available_agents):
                workload_count = workload_results[i].scalar() if i < len(workload_results) else 0
                agent_workloads[agent["id"]] = workload_count or 0

            # Process tasks in parallel batches
            task_batches = [pending_tasks[i:i + batch_size] for i in range(0, len(pending_tasks), batch_size)]
            all_assignments = []

            for batch in task_batches:
                # Process each batch in parallel
                batch_assignments = await _process_task_batch_parallel(
                    batch, available_agents, agent_workloads, agent_capabilities, max_tasks_per_agent,
                )

                # Apply assignments and update workloads
                for assignment in batch_assignments:
                    if assignment["assigned"]:
                        task_id = assignment["task_id"]
                        agent_id = assignment["agent_id"]

                        # Update task in database
                        task = next((t for t in batch if t.id == task_id), None)
                        if task:
                            task.assigned_agent_id = agent_id
                            task.status = TaskStatus.IN_PROGRESS
                            task.updated_at = datetime.now()
                            agent_workloads[agent_id] += 1

                        all_assignments.append(assignment)

            await session.commit()

            logger.info("Parallel auto-assignment completed",
                       repository_path=repository_path,
                       pending_tasks=len(pending_tasks),
                       assignments_made=len(all_assignments),
                       batches_processed=len(task_batches))

            return {
                "success": True,
                "repository_path": repository_path,
                "pending_tasks_count": len(pending_tasks),
                "assignments_made": len(all_assignments),
                "unassigned_tasks": len(pending_tasks) - len(all_assignments),
                "assignments": all_assignments,
                "batches_processed": len(task_batches),
                "batch_size": batch_size,
            }

        return await execute_query(_auto_assign_parallel)


async def _process_task_batch_parallel(
    tasks: list,
    available_agents: list[dict[str, Any]],
    agent_workloads: dict[str, int],
    agent_capabilities: dict[str, list[str]] | None = None,
    max_tasks_per_agent: int = 3,
) -> list[dict[str, Any]]:
    """Process a batch of tasks for assignment in parallel.
    
    Args:
        tasks: List of Task objects to assign
        available_agents: List of available agent dictionaries
        agent_workloads: Current workload count per agent
        agent_capabilities: Agent capabilities mapping
        max_tasks_per_agent: Maximum tasks per agent
        
    Returns:
        List of assignment results
    """
    import asyncio

    async def assign_single_task(task) -> dict[str, Any]:
        """Assign a single task to the best available agent."""
        best_agent = None
        best_score = -1

        for agent in available_agents:
            agent_id = agent["id"]

            # Skip if agent is at max capacity
            if agent_workloads[agent_id] >= max_tasks_per_agent:
                continue

            # Calculate assignment score
            score = 0

            # Prefer agents with lower workload
            score += (max_tasks_per_agent - agent_workloads[agent_id]) * 10

            # Prefer agents with matching capabilities
            if agent_capabilities and agent_id in agent_capabilities:
                agent_caps = agent_capabilities[agent_id]
                task_requirements = task.get_requirements()
                required_caps = task_requirements.get("capabilities", [])

                for cap in required_caps:
                    if cap in agent_caps:
                        score += 20  # High bonus for capability match

            # Prefer active agents over idle ones
            if agent["status"] == "active":
                score += 5

            if score > best_score:
                best_score = score
                best_agent = agent_id

        if best_agent:
            return {
                "task_id": task.id,
                "agent_id": best_agent,
                "task_type": task.task_type,
                "title": task.description.split(":")[0] if ":" in task.description else task.description[:50],
                "assignment_score": best_score,
                "assigned": True,
            }
        return {
            "task_id": task.id,
            "task_type": task.task_type,
            "title": task.description.split(":")[0] if ":" in task.description else task.description[:50],
            "assigned": False,
            "reason": "No available agents or all at capacity",
        }

    # Process all tasks in the batch concurrently
    assignment_tasks = [assign_single_task(task) for task in tasks]
    assignments = await asyncio.gather(*assignment_tasks)

    return assignments
