"""Pydantic schemas for task management MCP tools."""

from typing import Annotated, Any

from pydantic import Field

from . import BaseToolSchema


class CreateTaskSchema(BaseToolSchema):
    """Schema for create_task tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for task execution",
    )]

    task_type: Annotated[str, Field(
        description="Type of task to create",
        pattern=r"^(feature|bugfix|refactor|documentation|testing|deployment|analysis)$",
    )]

    title: Annotated[str, Field(
        description="Brief title for the task",
        min_length=1,
        max_length=200,
    )]

    description: Annotated[str, Field(
        description="Detailed description of the task",
        min_length=1,
        max_length=2000,
    )]

    requirements: Annotated[str | dict[str, Any] | None, Field(
        description="Task requirements and specifications (JSON object or string)",
        default=None,
    )]

    dependencies: Annotated[list[str] | None, Field(
        description="List of task IDs this task depends on",
        default=None,
    )]

    priority: Annotated[str, Field(
        description="Priority level for the task",
        pattern=r"^(low|medium|high|critical)$",
    )] = "medium"

    estimated_hours: Annotated[float | None, Field(
        description="Estimated hours to complete the task",
        ge=0.1,
        le=1000.0,
        default=None,
    )]

    assigned_agent_id: Annotated[str | None, Field(
        description="ID of the agent assigned to this task",
        default=None,
    )]


class ListTasksSchema(BaseToolSchema):
    """Schema for list_tasks tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository to filter tasks by",
    )]

    status_filter: Annotated[list[str] | None, Field(
        description="Filter tasks by status (pending, in_progress, completed, failed, blocked)",
        default=None,
    )]

    task_type_filter: Annotated[str | None, Field(
        description="Filter by task type",
        default=None,
    )]

    assigned_agent_filter: Annotated[str | None, Field(
        description="Filter by assigned agent ID",
        default=None,
    )]

    include_completed: Annotated[bool, Field(
        description="Include completed tasks in results",
    )] = False

    limit: Annotated[int, Field(
        description="Maximum number of tasks to return",
        ge=1,
        le=100,
    )] = 50


class CreateTaskBatchSchema(BaseToolSchema):
    """Schema for create_task_batch tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for task execution",
    )]

    tasks: Annotated[str | list[dict[str, Any]], Field(
        description="List of task configurations to create (JSON array or string)",
    )]

    auto_assign: Annotated[bool, Field(
        description="Automatically assign tasks to available agents",
    )] = False

    default_priority: Annotated[str, Field(
        description="Default priority for tasks without specified priority",
        pattern=r"^(low|medium|high|critical)$",
    )] = "medium"


class CreateWorkflowSchema(BaseToolSchema):
    """Schema for create_workflow tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for workflow execution",
    )]

    workflow_name: Annotated[str, Field(
        description="Name for the workflow",
        min_length=1,
        max_length=100,
    )]

    description: Annotated[str, Field(
        description="Description of the workflow",
        min_length=1,
        max_length=1000,
    )]

    workflow_steps: Annotated[str | list[dict[str, Any]], Field(
        description="List of workflow step configurations (JSON array or string)",
    )]

    auto_start: Annotated[bool, Field(
        description="Automatically start the workflow after creation",
    )] = False

    parallel_execution: Annotated[bool, Field(
        description="Allow parallel execution of independent steps",
    )] = True


class SplitTaskSchema(BaseToolSchema):
    """Schema for split_task tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository",
    )]

    task_id: Annotated[str, Field(
        description="ID of the task to split",
    )]

    subtask_definitions: Annotated[list[dict[str, Any]], Field(
        description="List of subtask definitions (JSON array)",
    )]

    preserve_original: Annotated[bool, Field(
        description="Keep the original task as a parent task",
    )] = True

    auto_assign: Annotated[bool, Field(
        description="Automatically assign subtasks to available agents",
    )] = False


class AssignTasksBulkSchema(BaseToolSchema):
    """Schema for assign_tasks_bulk tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository",
    )]

    task_assignments: Annotated[str | list[dict[str, str]], Field(
        description="List of task-to-agent assignments (JSON array or string)",
    )]

    override_existing: Annotated[bool, Field(
        description="Override existing task assignments",
    )] = False

    validate_agent_capabilities: Annotated[bool, Field(
        description="Validate that agents have required capabilities for tasks",
    )] = True


class AutoAssignTasksSchema(BaseToolSchema):
    """Schema for auto_assign_tasks and auto_assign_tasks_parallel tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository",
    )]

    agent_capabilities: Annotated[dict[str, list[str]] | None, Field(
        description="Mapping of agent IDs to their capabilities (JSON object)",
        default=None,
    )]

    task_filter: Annotated[str | None, Field(
        description="Filter tasks by type or status",
        default=None,
    )]

    max_tasks_per_agent: Annotated[int, Field(
        description="Maximum number of tasks to assign per agent",
        ge=1,
        le=50,
    )] = 5

    priority_weight: Annotated[float, Field(
        description="Weight for task priority in assignment algorithm",
        ge=0.0,
        le=1.0,
    )] = 0.5
