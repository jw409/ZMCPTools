"""Integration hooks for existing file operation tools.

This module provides hooks that integrate AgentTreeGraph analysis
with existing ClaudeMcpTools file operations for real-time updates.
"""

import asyncio
from pathlib import Path
from typing import Any

import structlog

from ..parsers.file_analyzer import FileAnalyzer
from .filesystem import TreeSummaryHook

logger = structlog.get_logger()

# Global registry of active analysis hooks
_active_hooks: dict[str, TreeSummaryHook] = {}


async def trigger_file_analysis_hook(
    file_path: str,
    change_type: str = "modified",
    project_path: str | None = None,
) -> dict[str, Any]:
    """Trigger analysis hook for file changes from existing tools.
    
    Args:
        file_path: Absolute path to the changed file
        change_type: Type of change (modified, created, deleted)
        project_path: Optional project path (auto-detected if not provided)
        
    Returns:
        Hook execution result
    """
    try:
        # Auto-detect project path if not provided
        if not project_path:
            analyzer = FileAnalyzer()
            project_path = analyzer.find_project_root(file_path)
            if not project_path:
                logger.debug("No project root found for file", file_path=file_path)
                return {
                    "success": False,
                    "reason": "no_project_root",
                    "file_path": file_path,
                }

        # Get or create hook for this project
        if project_path not in _active_hooks:
            # Check if there's an existing TreeSummary directory
            treesummary_path = Path(project_path) / ".treesummary"
            if not treesummary_path.exists():
                logger.debug("No .treesummary directory found", project_path=project_path)
                return {
                    "success": False,
                    "reason": "no_treesummary",
                    "file_path": file_path,
                    "project_path": project_path,
                }

            # Create hook for this project
            hook = TreeSummaryHook(project_path)
            _active_hooks[project_path] = hook
            logger.info("Created analysis hook for project", project_path=project_path)

        hook = _active_hooks[project_path]

        # Trigger the appropriate hook method
        if change_type == "modified":
            await hook.on_file_modified(file_path)
        elif change_type == "created":
            await hook.on_file_created(file_path)
        elif change_type == "deleted":
            await hook.on_file_deleted(file_path)
        else:
            logger.warning("Unknown change type", change_type=change_type)
            return {
                "success": False,
                "reason": "unknown_change_type",
                "file_path": file_path,
                "change_type": change_type,
            }

        return {
            "success": True,
            "file_path": file_path,
            "project_path": project_path,
            "change_type": change_type,
            "hook_triggered": True,
        }

    except Exception as e:
        logger.error("Analysis hook failed", file_path=file_path, error=str(e))
        return {
            "success": False,
            "error": str(e),
            "file_path": file_path,
            "change_type": change_type,
        }


def register_project_hook(project_path: str, hook: TreeSummaryHook):
    """Register an analysis hook for a project.
    
    Args:
        project_path: Absolute path to project root
        hook: TreeSummaryHook instance
    """
    _active_hooks[project_path] = hook
    logger.info("Registered analysis hook", project_path=project_path)


def unregister_project_hook(project_path: str):
    """Unregister an analysis hook for a project.
    
    Args:
        project_path: Absolute path to project root
    """
    if project_path in _active_hooks:
        hook = _active_hooks.pop(project_path)
        hook.stop_watching()
        logger.info("Unregistered analysis hook", project_path=project_path)


def get_active_hooks() -> dict[str, TreeSummaryHook]:
    """Get all currently active analysis hooks.
    
    Returns:
        Dictionary mapping project paths to hooks
    """
    return _active_hooks.copy()


def is_analysis_enabled(file_path: str) -> bool:
    """Check if analysis is enabled for a file's project.
    
    Args:
        file_path: Path to check
        
    Returns:
        True if analysis is enabled, False otherwise
    """
    try:
        analyzer = FileAnalyzer()
        project_path = analyzer.find_project_root(file_path)
        if not project_path:
            return False

        # Check if .treesummary exists
        treesummary_path = Path(project_path) / ".treesummary"
        return treesummary_path.exists()

    except Exception:
        return False


async def cleanup_all_hooks():
    """Clean up all active analysis hooks."""
    for project_path in list(_active_hooks.keys()):
        unregister_project_hook(project_path)

    logger.info("Cleaned up all analysis hooks")


# Hook wrapper functions for existing file operations
async def wrap_file_operation(
    operation_func,
    file_path: str,
    *args,
    **kwargs,
) -> Any:
    """Wrap a file operation with analysis hooks.
    
    Args:
        operation_func: The original file operation function
        file_path: Path to the file being operated on
        *args: Arguments to pass to operation function
        **kwargs: Keyword arguments to pass to operation function
        
    Returns:
        Result from the original operation function
    """
    # Execute the original operation
    result = operation_func(file_path, *args, **kwargs)

    # If operation was successful and analysis is enabled, trigger hook
    if (isinstance(result, str) and "✅" in result) or \
       (isinstance(result, dict) and result.get("success", False)):

        if is_analysis_enabled(file_path):
            # Run hook asynchronously without blocking the original operation
            asyncio.create_task(
                trigger_file_analysis_hook(file_path, "modified"),
            )

    return result


async def wrap_async_file_operation(
    operation_func,
    file_path: str,
    *args,
    **kwargs,
) -> Any:
    """Wrap an async file operation with analysis hooks.
    
    Args:
        operation_func: The original async file operation function
        file_path: Path to the file being operated on
        *args: Arguments to pass to operation function
        **kwargs: Keyword arguments to pass to operation function
        
    Returns:
        Result from the original operation function
    """
    # Execute the original operation
    result = await operation_func(file_path, *args, **kwargs)

    # If operation was successful and analysis is enabled, trigger hook
    if (isinstance(result, str) and "✅" in result) or \
       (isinstance(result, dict) and result.get("success", False)):

        if is_analysis_enabled(file_path):
            await trigger_file_analysis_hook(file_path, "modified")

    return result
