"""
Tool modules for ClaudeMcpTools.

This package contains all the MCP tools organized by functionality.
Tools are automatically registered with the FastMCP app when imported.
"""

# Import all tool modules to register them with the app
from . import agents, analysis, communication, core, documentation, memory, tasks

__all__ = [
    # Core orchestration
    "orchestrate_objective",
    "get_system_status",

    # Agent management
    "spawn_agent",
    "spawn_agents_batch",
    "list_agents",
    "get_agent_status",
    "terminate_agent",

    # Task management
    "create_task",
    "assign_task",
    "get_task_status",
    "list_tasks",
    "create_task_batch",
    "create_workflow",
    "split_task",
    "assign_tasks_bulk",
    "auto_assign_tasks",
    "auto_assign_tasks_parallel",
    "balance_workload",
    "get_agent_workload",

    # Communication
    "join_room",
    "leave_room",
    "send_message",
    "broadcast_message",
    "get_messages",
    "wait_for_messages",

    # Documentation
    "scrape_documentation",
    "update_documentation",
    "search_documentation",
    "analyze_documentation_changes",
    "link_docs_to_code",

    # Memory & Learning
    "store_memory_entry",
    "query_shared_memory",
    "store_agent_insight",
    "get_agent_insights",
    "log_tool_call",
    "get_tool_call_history",
    "log_error",
    "get_recent_errors",
    "resolve_error",
    "get_learning_entries",
    "get_error_patterns",

    # Analysis
    "analyze_project_structure",
    "generate_project_summary",
    "detect_dead_code",
    "analyze_file_symbols",
    "easy_replace_all",
    "cleanup_orphaned_projects",
    "update_treesummary_incremental",
    "watch_project_changes",
]
