"""Task management tools for orchestrating development workflows."""

from typing import Annotated, Any

import structlog
from pydantic import Field

from ..models import TaskStatus
from ..services.task_service import TaskService
from .json_utils import parse_json_list, check_parsing_error
from .app import app

logger = structlog.get_logger("tools.tasks")

# Legacy import no longer needed


@app.tool(tags={"orchestration", "task-management", "creation"})
async def create_task(
    repository_path: Annotated[str, Field(
        description="Path to the repository for task execution",
    )],
    task_type: Annotated[str, Field(
        description="Type of task to create",
        pattern=r"^(feature|bugfix|refactor|documentation|testing|deployment|analysis)$",
    )],
    title: Annotated[str, Field(
        description="Brief title for the task",
        min_length=1,
        max_length=200,
    )],
    description: Annotated[str, Field(
        description="Detailed description of the task",
        min_length=1,
        max_length=2000,
    )],
    requirements: Annotated[str | dict[str, Any] | None, Field(
        description="Task requirements and specifications (JSON object or string)",
        default=None,
    )] = None,
    dependencies: Annotated[str | list[str] | None, Field(
        description="List of task IDs this task depends on. Can be JSON array: ['task1', 'task2']",
        default=None,
    )] = None,
    priority: Annotated[str, Field(
        description="Priority level for the task",
        pattern=r"^(low|medium|high|critical)$",
    )] = "medium",
    estimated_hours: Annotated[float | None, Field(
        description="Estimated hours to complete the task",
        ge=0.1,
        le=1000.0,
        default=None,
    )] = None,
    assigned_agent_id: Annotated[str | None, Field(
        description="ID of the agent assigned to this task",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Create a new orchestrated development task."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_dependencies = parse_json_list(dependencies, "dependencies")
        if check_parsing_error(parsed_dependencies):
            return parsed_dependencies
        final_dependencies: list[str] | None = parsed_dependencies

        # Parse requirements if string
        parsed_requirements: dict[str, Any] | None = requirements if isinstance(requirements, dict) else None
        if isinstance(requirements, str):
            import json
            try:
                parsed_requirements = json.loads(requirements)
            except json.JSONDecodeError:
                return {"error": {"code": "INVALID_REQUIREMENTS_FORMAT", "message": "Invalid JSON in requirements string"}}
        
        # Ensure we have a requirements dict and add estimated_hours if provided
        if parsed_requirements is None:
            parsed_requirements = {}
        if estimated_hours is not None:
            parsed_requirements["estimated_hours"] = estimated_hours
        
        # Convert priority string to int
        priority_map = {"low": 1, "medium": 2, "high": 3, "critical": 4}
        priority_int = priority_map.get(priority, 2)
        
        result = await TaskService.create_task(
            repository_path=repository_path,
            task_type=task_type,
            title=title,
            description=description,
            requirements=parsed_requirements,
            priority=priority_int,
            parent_task_id=None,
            dependencies=final_dependencies,
        )
        
        # Auto-assign if agent ID provided
        if result.get("success") and assigned_agent_id:
            task_id = result.get("task_id")
            if task_id:
                assign_result = await TaskService.assign_task(task_id, assigned_agent_id)
                if assign_result:
                    result["assigned_to"] = assigned_agent_id
        return result

    except Exception as e:
        logger.error("Error creating task", error=str(e))
        return {"error": {"code": "TASK_CREATION_FAILED", "message": str(e)}}


@app.tool(tags={"orchestration", "task-management", "assignment"})
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


@app.tool(tags={"orchestration", "task-management", "monitoring"})
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


@app.tool(tags={"orchestration", "task-management", "listing"})
async def list_tasks(
    repository_path: Annotated[str, Field(
        description="Path to the repository to filter tasks by",
    )],
    status_filter: Annotated[str | list[str] | None, Field(
        description="Filter tasks by status. Can be JSON array: ['pending', 'in_progress', 'completed']",
        default=None,
    )] = None,
    task_type_filter: Annotated[str | None, Field(
        description="Filter by task type",
        default=None,
    )] = None,
    assigned_agent_filter: Annotated[str | None, Field(
        description="Filter by assigned agent ID",
        default=None,
    )] = None,
    include_completed: Annotated[bool, Field(
        description="Include completed tasks in results",
    )] = False,
    limit: Annotated[int, Field(
        description="Maximum number of tasks to return",
        ge=1,
        le=100,
    )] = 50,
) -> dict[str, Any]:
    """List tasks with filtering and pagination."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_status_filter = parse_json_list(status_filter, "status_filter")
        if check_parsing_error(parsed_status_filter):
            return parsed_status_filter
        final_status_filter: list[str] | None = parsed_status_filter

        # Convert string status values to TaskStatus enums if provided
        status_enum_filter = None
        if final_status_filter:
            status_enum_filter = [TaskStatus(status) for status in final_status_filter]

        result = await TaskService.list_tasks(
            repository_path=repository_path,
            status_filter=status_enum_filter,
            task_type_filter=task_type_filter,
            assigned_agent_filter=assigned_agent_filter,
            include_completed=include_completed,
            limit=limit,
        )
        return result

    except Exception as e:
        logger.error("Error listing tasks", error=str(e))
        return {"error": {"code": "TASK_LIST_FAILED", "message": str(e)}}


@app.tool(tags={"orchestration", "task-management", "batch-operations"})
async def create_task_batch(
    repository_path: Annotated[str, Field(
        description="Path to the repository for task execution",
    )],
    tasks: Annotated[str | list[dict[str, Any]], Field(
        description="List of task configurations to create (JSON array or string)",
    )],
    auto_assign: Annotated[bool, Field(
        description="Automatically assign tasks to available agents",
    )] = False,
    default_priority: Annotated[str, Field(
        description="Default priority for tasks without specified priority",
        pattern=r"^(low|medium|high|critical)$",
    )] = "medium",
) -> dict[str, Any]:
    """Create multiple tasks in a single operation."""
    try:
        # Parse tasks if string
        parsed_tasks = tasks
        if isinstance(tasks, str):
            import json
            try:
                parsed_tasks = json.loads(tasks)
            except json.JSONDecodeError:
                return {"error": {"code": "INVALID_TASKS_FORMAT", "message": "Invalid JSON in tasks string"}}

        # Validate task definitions
        for i, task_def in enumerate(parsed_tasks):
            if not all(key in task_def for key in ["task_type", "title", "description"]):
                return {"error": {"code": "INVALID_TASK_DEFINITION",
                               "message": f"Task {i} missing required fields: task_type, title, description"}}

        # Convert parsed tasks to have proper priorities
        if isinstance(parsed_tasks, list):
            for task in parsed_tasks:
                if isinstance(task, dict):
                    if "priority" in task and isinstance(task["priority"], str):
                        priority_map = {"low": 1, "medium": 2, "high": 3, "critical": 4}
                        task["priority"] = priority_map.get(task["priority"], 2)
                    elif "priority" not in task:
                        priority_map = {"low": 1, "medium": 2, "high": 3, "critical": 4}
                        task["priority"] = priority_map.get(default_priority, 2)
                
        # Ensure parsed_tasks is a list before passing to service
        if not isinstance(parsed_tasks, list):
            return {"error": {"code": "INVALID_TASKS_TYPE", "message": "Tasks must be a list"}}
        
        result = await TaskService.create_task_batch(tasks=parsed_tasks, repository_path=repository_path)
        
        # Auto-assign if requested
        if result.get("success") and auto_assign:
            created_tasks = result.get("created_tasks", [])
            for task in created_tasks:
                task_id = task.get("task_id")
                if task_id:
                    # Try to auto-assign (simplified - would need agent matching logic)
                    auto_result = await TaskService.auto_assign_tasks(repository_path=repository_path)
                    if auto_result:
                        logger.info(f"Auto-assigned task {task_id}")
        return result

    except Exception as e:
        logger.error("Error creating task batch", error=str(e))
        return {"error": {"code": "TASK_BATCH_CREATION_FAILED", "message": str(e)}}


@app.tool(tags={"orchestration", "workflow", "multi-step", "coordination"})
async def create_workflow(
    repository_path: Annotated[str, Field(
        description="Path to the repository for workflow execution",
    )],
    workflow_name: Annotated[str, Field(
        description="Name for the workflow",
        min_length=1,
        max_length=100,
    )],
    description: Annotated[str, Field(
        description="Description of the workflow",
        min_length=1,
        max_length=1000,
    )],
    workflow_steps: Annotated[str | list[dict[str, Any]], Field(
        description="List of workflow step configurations (JSON array or string)",
    )],
    auto_start: Annotated[bool, Field(
        description="Automatically start the workflow after creation",
    )] = False,
    parallel_execution: Annotated[bool, Field(
        description="Allow parallel execution of independent steps",
    )] = True,
) -> dict[str, Any]:
    """Create a structured workflow with multiple coordinated steps."""
    try:
        # Parse workflow steps if string
        parsed_steps = workflow_steps
        if isinstance(workflow_steps, str):
            import json
            try:
                parsed_steps = json.loads(workflow_steps)
            except json.JSONDecodeError:
                return {"error": {"code": "INVALID_WORKFLOW_FORMAT", "message": "Invalid JSON in workflow steps string"}}

        # Validate workflow step definitions
        for i, step in enumerate(parsed_steps):
            if not all(key in step for key in ["step_name", "agent_type", "description"]):
                return {"error": {"code": "INVALID_WORKFLOW_STEP",
                               "message": f"Step {i} missing required fields: step_name, agent_type, description"}}

        # Create workflow using TaskService
        # Ensure parsed_steps is a list before passing to service
        if not isinstance(parsed_steps, list):
            return {"error": {"code": "INVALID_WORKFLOW_TYPE", "message": "Workflow steps must be a list"}}
        
        result = await TaskService.create_workflow(
            workflow_name=workflow_name,
            workflow_steps=parsed_steps,
            repository_path=repository_path,
        )
        
        # If workflow creation succeeded, apply additional settings
        if result.get("success"):
            workflow_id = result.get("workflow_id")
            
            # Update workflow with description if TaskService supports it
            if description and workflow_id:
                # Add description to result for client awareness
                result["description"] = description
            
            # Auto-start workflow if requested
            if auto_start and workflow_id:
                try:
                    start_result = await TaskService.start_workflow(workflow_id)
                    result["auto_started"] = start_result
                    result["started"] = start_result.get("success", False)
                except AttributeError:
                    # start_workflow method doesn't exist, note for future implementation
                    result["auto_start_note"] = "Auto-start requested but not yet implemented"
            
            # Add parallel execution setting to result
            result["parallel_execution"] = parallel_execution
            result["settings"] = {
                "auto_start": auto_start,
                "parallel_execution": parallel_execution,
                "description": description,
            }
        
        return result

    except Exception as e:
        logger.error("Error creating workflow", error=str(e))
        return {"error": {"code": "WORKFLOW_CREATION_FAILED", "message": str(e)}}


@app.tool(tags={"orchestration", "task-management", "decomposition"})
async def split_task(
    repository_path: Annotated[str, Field(
        description="Path to the repository",
    )],
    task_id: Annotated[str, Field(
        description="ID of the task to split",
    )],
    subtask_definitions: Annotated[list[dict[str, Any]], Field(
        description="List of subtask definitions (JSON array)",
    )],
    preserve_original: Annotated[bool, Field(
        description="Keep the original task as a parent task",
    )] = True,
    auto_assign: Annotated[bool, Field(
        description="Automatically assign subtasks to available agents",
    )] = False,
) -> dict[str, Any]:
    """Split a large task into smaller, manageable subtasks."""
    try:
        result = await TaskService.split_task(
            parent_task_id=task_id,
            subtask_definitions=subtask_definitions,
        )
        return result

    except Exception as e:
        logger.error("Error splitting task", error=str(e))
        return {"error": {"code": "TASK_SPLIT_FAILED", "message": str(e)}}


@app.tool(tags={"orchestration", "task-management", "bulk-assignment"})
async def assign_tasks_bulk(
    repository_path: Annotated[str, Field(
        description="Path to the repository",
    )],
    task_assignments: Annotated[str | list[dict[str, str]], Field(
        description="List of task-to-agent assignments (JSON array or string)",
    )],
    override_existing: Annotated[bool, Field(
        description="Override existing task assignments",
    )] = False,
    validate_agent_capabilities: Annotated[bool, Field(
        description="Validate that agents have required capabilities for tasks",
    )] = True,
) -> dict[str, Any]:
    """Assign multiple tasks to agents in a single operation."""
    try:
        # Parse task assignments if string
        parsed_assignments = task_assignments
        if isinstance(task_assignments, str):
            import json
            try:
                parsed_assignments = json.loads(task_assignments)
            except json.JSONDecodeError:
                return {"error": {"code": "INVALID_ASSIGNMENTS_FORMAT", "message": "Invalid JSON in task assignments string"}}

        # Validate assignment format
        for i, assignment in enumerate(parsed_assignments):
            if not all(key in assignment for key in ["task_id", "agent_id"]):
                return {"error": {"code": "INVALID_ASSIGNMENT",
                               "message": f"Assignment {i} missing required fields: task_id, agent_id"}}

        # Ensure parsed_assignments is a list before passing to service
        if not isinstance(parsed_assignments, list):
            return {"error": {"code": "INVALID_ASSIGNMENTS_TYPE", "message": "Task assignments must be a list"}}
        
        result = await TaskService.assign_tasks_bulk(
            task_assignments=parsed_assignments,
        )
        return result

    except Exception as e:
        logger.error("Error in bulk task assignment", error=str(e))
        return {"error": {"code": "BULK_ASSIGNMENT_FAILED", "message": str(e)}}


@app.tool(tags={"orchestration", "task-management", "auto-assignment", "optimization"})
async def auto_assign_tasks(
    repository_path: Annotated[str, Field(
        description="Path to the repository",
    )],
    agent_capabilities: Annotated[dict[str, list[str]] | None, Field(
        description="Mapping of agent IDs to their capabilities (JSON object)",
        default=None,
    )] = None,
    task_filter: Annotated[str | None, Field(
        description="Filter tasks by type or status",
        default=None,
    )] = None,
    max_tasks_per_agent: Annotated[int, Field(
        description="Maximum number of tasks to assign per agent",
        ge=1,
        le=50,
    )] = 5,
    priority_weight: Annotated[float, Field(
        description="Weight for task priority in assignment algorithm",
        ge=0.0,
        le=1.0,
    )] = 0.5,
) -> dict[str, Any]:
    """Automatically assign pending tasks to available agents."""
    try:
        result = await TaskService.auto_assign_tasks(
            repository_path=repository_path,
        )
        return result

    except Exception as e:
        logger.error("Error in auto task assignment", error=str(e))
        return {"error": {"code": "AUTO_ASSIGNMENT_FAILED", "message": str(e)}}


@app.tool(tags={"orchestration", "task-management", "auto-assignment", "parallel-processing"})
async def auto_assign_tasks_parallel(
    repository_path: Annotated[str, Field(
        description="Path to the repository",
    )],
    agent_capabilities: Annotated[dict[str, list[str]] | None, Field(
        description="Mapping of agent IDs to their capabilities (JSON object)",
        default=None,
    )] = None,
    task_filter: Annotated[str | None, Field(
        description="Filter tasks by type or status",
        default=None,
    )] = None,
    max_tasks_per_agent: Annotated[int, Field(
        description="Maximum number of tasks to assign per agent",
        ge=1,
        le=50,
    )] = 5,
    priority_weight: Annotated[float, Field(
        description="Weight for task priority in assignment algorithm",
        ge=0.0,
        le=1.0,
    )] = 0.5,
) -> dict[str, Any]:
    """Automatically assign tasks with parallel processing optimization."""
    try:
        result = await TaskService.auto_assign_tasks_parallel(
            repository_path=repository_path,
        )
        return result

    except Exception as e:
        logger.error("Error in parallel auto task assignment", error=str(e))
        return {"error": {"code": "PARALLEL_AUTO_ASSIGNMENT_FAILED", "message": str(e)}}


@app.tool(tags={"orchestration", "workload-management", "optimization", "load-balancing"})
async def balance_workload(repository_path: str) -> dict[str, Any]:
    """Balance task distribution across available agents."""
    try:
        result = await TaskService.balance_workload(repository_path)
        return result

    except Exception as e:
        logger.error("Error balancing workload", error=str(e))
        return {"error": {"code": "WORKLOAD_BALANCE_FAILED", "message": str(e)}}


# get_agent_workload tool removed - was unimplemented placeholder
