"""Task management tools for orchestrating development workflows."""

from typing import Any

import structlog
from fastmcp import FastMCP

from ...models import TaskStatus
from ...schemas.tasks import (
    AssignTasksBulkSchema,
    AutoAssignTasksSchema,
    CreateTaskBatchSchema,
    CreateTaskSchema,
    CreateWorkflowSchema,
    ListTasksSchema,
    SplitTaskSchema,
)
from ...services.task_service import TaskService

logger = structlog.get_logger("orchestration.tools.tasks")

# Import parse_ai_json for legacy compatibility
try:
    from ...orchestration_server import parse_ai_json
except ImportError:
    parse_ai_json = lambda x: x


def register_task_tools(app: FastMCP):
    """Register task management tools with the FastMCP app."""
    
    @app.tool(
        name="create_task",
        description="Create a new orchestrated development task with requirements, dependencies, and priority settings",
        tags={"orchestration", "task-management", "creation"}
    )
    async def create_task(params: CreateTaskSchema) -> dict[str, Any]:
        """Create a new orchestrated development task."""
        try:
            result = await TaskService.create_task(
                repository_path=params.repository_path,
                task_type=params.task_type,
                title=params.title,
                description=params.description,
                requirements=params.requirements,  # Already parsed by Pydantic schema
                priority=params.priority,
                parent_task_id=None,  # Not in schema, using default
                dependencies=params.dependencies,
            )
            return result

        except Exception as e:
            logger.error("Error creating task", error=str(e))
            return {"error": {"code": "TASK_CREATION_FAILED", "message": str(e)}}

    @app.tool(
        name="assign_task",
        description="Assign a specific task to an available agent for execution",
        tags={"orchestration", "task-management", "assignment"}
    )
    async def assign_task(task_id: str, agent_id: str) -> dict[str, Any]:
        """Assign a task to a specific agent."""
        try:
            success = await TaskService.assign_task(task_id, agent_id)
            if success:
                return {
                    "success": True,
                    "task_id": task_id,
                    "agent_id": agent_id,
                    "message": "Task assigned successfully",
                }
            return {"error": {"code": "TASK_ASSIGNMENT_FAILED", "message": "Failed to assign task"}}

        except Exception as e:
            logger.error("Error assigning task", error=str(e))
            return {"error": {"code": "TASK_ASSIGNMENT_FAILED", "message": str(e)}}

    @app.tool(
        name="get_task_status",
        description="Get detailed status information for a specific task including progress, assigned agent, and execution details",
        tags={"orchestration", "task-management", "monitoring"}
    )
    async def get_task_status(task_id: str) -> dict[str, Any]:
        """Get detailed status information for a task."""
        try:
            result = await TaskService.get_task_by_id(task_id)
            if result is None:
                return {"error": {"code": "TASK_NOT_FOUND", "message": f"Task {task_id} not found"}}

            return result

        except Exception as e:
            logger.error("Error getting task status", error=str(e))
            return {"error": {"code": "TASK_STATUS_FAILED", "message": str(e)}}

    @app.tool(
        name="list_tasks",
        description="List tasks with filtering by repository, status, and pagination for task management overview",
        tags={"orchestration", "task-management", "listing"}
    )
    async def list_tasks(params: ListTasksSchema) -> dict[str, Any]:
        """List tasks with filtering and pagination."""
        try:
            # Convert string status values to TaskStatus enums if provided
            status_enum_filter = None
            if params.status_filter:
                status_enum_filter = [TaskStatus(status) for status in params.status_filter]

            result = await TaskService.list_tasks(
                repository_path=params.repository_path,
                status_filter=status_enum_filter,
                limit=params.limit,
            )
            return result

        except Exception as e:
            logger.error("Error listing tasks", error=str(e))
            return {"error": {"code": "TASK_LIST_FAILED", "message": str(e)}}

    @app.tool(
        name="create_task_batch",
        description="Create multiple tasks in a single operation for efficient batch processing and workflow setup",
        tags={"orchestration", "task-management", "batch-operations"}
    )
    async def create_task_batch(params: CreateTaskBatchSchema) -> dict[str, Any]:
        """Create multiple tasks in a single operation."""
        try:
            # Tasks are already parsed by Pydantic schema
            tasks = params.tasks
            if isinstance(tasks, str):
                # This shouldn't happen with Pydantic, but fallback just in case
                return {"error": {"code": "INVALID_TASKS_FORMAT", "message": "Tasks should be parsed as list by schema"}}

            # Validate task definitions
            for i, task_def in enumerate(tasks):
                if not all(key in task_def for key in ["task_type", "title", "description"]):
                    return {"error": {"code": "INVALID_TASK_DEFINITION",
                                   "message": f"Task {i} missing required fields: task_type, title, description"}}

            result = await TaskService.create_task_batch(tasks, params.repository_path)
            return result

        except Exception as e:
            logger.error("Error creating task batch", error=str(e))
            return {"error": {"code": "TASK_BATCH_CREATION_FAILED", "message": str(e)}}

    @app.tool(
        name="create_workflow",
        description="Create a structured workflow with multiple steps, dependencies, and coordination for complex multi-step processes",
        tags={"orchestration", "workflow", "multi-step", "coordination"}
    )
    async def create_workflow(params: CreateWorkflowSchema) -> dict[str, Any]:
        """Create a structured workflow with multiple coordinated steps."""
        try:
            # Workflow steps are already parsed by Pydantic schema
            workflow_steps = params.workflow_steps
            if isinstance(workflow_steps, str):
                return {"error": {"code": "INVALID_WORKFLOW_FORMAT", "message": "Workflow steps should be parsed as list by schema"}}

            # Validate workflow step definitions
            for i, step in enumerate(workflow_steps):
                if not all(key in step for key in ["step_name", "agent_type", "description"]):
                    return {"error": {"code": "INVALID_WORKFLOW_STEP",
                                   "message": f"Step {i} missing required fields: step_name, agent_type, description"}}

            # Create workflow using TaskService
            result = await TaskService.create_workflow(
                workflow_name=params.workflow_name,
                description=params.description,
                workflow_steps=workflow_steps,
                repository_path=params.repository_path,
                auto_start=params.auto_start,
                parallel_execution=params.parallel_execution,
            )
            return result

        except Exception as e:
            logger.error("Error creating workflow", error=str(e))
            return {"error": {"code": "WORKFLOW_CREATION_FAILED", "message": str(e)}}

    @app.tool(
        name="split_task",
        description="Split a large task into smaller, manageable subtasks with proper dependency management",
        tags={"orchestration", "task-management", "decomposition"}
    )
    async def split_task(params: SplitTaskSchema) -> dict[str, Any]:
        """Split a large task into smaller, manageable subtasks."""
        try:
            # Subtask definitions are already parsed by Pydantic schema
            result = await TaskService.split_task(
                task_id=params.task_id,
                subtask_definitions=params.subtask_definitions,
                repository_path=params.repository_path,
                preserve_original=params.preserve_original,
                auto_assign=params.auto_assign,
            )
            return result

        except Exception as e:
            logger.error("Error splitting task", error=str(e))
            return {"error": {"code": "TASK_SPLIT_FAILED", "message": str(e)}}

    @app.tool(
        name="assign_tasks_bulk",
        description="Assign multiple tasks to agents in a single operation for efficient workforce management",
        tags={"orchestration", "task-management", "bulk-assignment"}
    )
    async def assign_tasks_bulk(params: AssignTasksBulkSchema) -> dict[str, Any]:
        """Assign multiple tasks to agents in a single operation."""
        try:
            # Task assignments are already parsed by Pydantic schema
            task_assignments = params.task_assignments
            if isinstance(task_assignments, str):
                return {"error": {"code": "INVALID_ASSIGNMENTS_FORMAT", "message": "Task assignments should be parsed as list by schema"}}

            # Validate assignment format
            for i, assignment in enumerate(task_assignments):
                if not all(key in assignment for key in ["task_id", "agent_id"]):
                    return {"error": {"code": "INVALID_ASSIGNMENT",
                                   "message": f"Assignment {i} missing required fields: task_id, agent_id"}}

            result = await TaskService.assign_tasks_bulk(
                task_assignments=task_assignments,
                repository_path=params.repository_path,
                override_existing=params.override_existing,
                validate_agent_capabilities=params.validate_agent_capabilities,
            )
            return result

        except Exception as e:
            logger.error("Error in bulk task assignment", error=str(e))
            return {"error": {"code": "BULK_ASSIGNMENT_FAILED", "message": str(e)}}

    @app.tool(
        name="auto_assign_tasks",
        description="Automatically assign pending tasks to available agents based on capabilities and workload",
        tags={"orchestration", "task-management", "auto-assignment", "optimization"}
    )
    async def auto_assign_tasks(params: AutoAssignTasksSchema) -> dict[str, Any]:
        """Automatically assign pending tasks to available agents."""
        try:
            # Agent capabilities are already parsed by Pydantic schema
            result = await TaskService.auto_assign_tasks(
                repository_path=params.repository_path,
                agent_capabilities=params.agent_capabilities,
                task_filter=params.task_filter,
                max_tasks_per_agent=params.max_tasks_per_agent,
                priority_weight=params.priority_weight,
            )
            return result

        except Exception as e:
            logger.error("Error in auto task assignment", error=str(e))
            return {"error": {"code": "AUTO_ASSIGNMENT_FAILED", "message": str(e)}}

    @app.tool(
        name="auto_assign_tasks_parallel",
        description="Automatically assign tasks to agents with parallel processing for high-performance workflows",
        tags={"orchestration", "task-management", "auto-assignment", "parallel-processing"}
    )
    async def auto_assign_tasks_parallel(params: AutoAssignTasksSchema) -> dict[str, Any]:
        """Automatically assign tasks with parallel processing optimization."""
        try:
            # Use the same schema as auto_assign_tasks but with parallel processing
            result = await TaskService.auto_assign_tasks_parallel(
                repository_path=params.repository_path,
                agent_capabilities=params.agent_capabilities,
                task_filter=params.task_filter,
                max_tasks_per_agent=params.max_tasks_per_agent,
                priority_weight=params.priority_weight,
            )
            return result

        except Exception as e:
            logger.error("Error in parallel auto task assignment", error=str(e))
            return {"error": {"code": "PARALLEL_AUTO_ASSIGNMENT_FAILED", "message": str(e)}}

    @app.tool(
        name="balance_workload",
        description="Balance task distribution across agents to optimize performance and prevent bottlenecks",
        tags={"orchestration", "workload-management", "optimization", "load-balancing"}
    )
    async def balance_workload(repository_path: str) -> dict[str, Any]:
        """Balance task distribution across available agents."""
        try:
            result = await TaskService.balance_workload(repository_path)
            return result

        except Exception as e:
            logger.error("Error balancing workload", error=str(e))
            return {"error": {"code": "WORKLOAD_BALANCE_FAILED", "message": str(e)}}

    @app.tool(
        name="get_agent_workload",
        description="Get detailed workload information for agents including task counts, types, and performance metrics",
        tags={"orchestration", "workload-management", "monitoring", "analytics"}
    )
    async def get_agent_workload(repository_path: str, agent_id: str | None = None) -> dict[str, Any]:
        """Get workload information for agents."""
        try:
            result = await TaskService.get_agent_workload(repository_path, agent_id)
            return result

        except Exception as e:
            logger.error("Error getting agent workload", error=str(e))
            return {"error": {"code": "WORKLOAD_INFO_FAILED", "message": str(e)}}