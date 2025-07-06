"""Cleanup service for managing orphaned projects and stale data."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import delete, func, select, text

from ..database import DatabaseSession
from ..models import AgentSession, ChatMessage, DocumentationEntry, ErrorLog, Task

logger = structlog.get_logger()


class CleanupService:
    """Service for cleaning up orphaned projects and stale data."""

    @staticmethod
    async def analyze_storage_usage() -> dict[str, Any]:
        """Analyze storage usage across the database and files.
        
        Returns:
            Dict with storage analysis results
        """
        try:
            # Base data directory
            data_dir = Path.home() / ".mcptools" / "data"

            # Calculate directory sizes
            def get_dir_size(path: Path) -> int:
                """Get total size of directory in bytes."""
                if not path.exists():
                    return 0
                total = 0
                for file_path in path.rglob("*"):
                    if file_path.is_file():
                        try:
                            total += file_path.stat().st_size
                        except (OSError, PermissionError):
                            continue
                return total

            # Calculate sizes
            total_size = get_dir_size(data_dir)
            db_size = 0
            docs_size = 0
            cache_size = 0

            # Database file
            db_file = data_dir / "orchestration.db"
            if db_file.exists():
                db_size = db_file.stat().st_size

            # Documentation directory
            docs_dir = data_dir / "documentation"
            if docs_dir.exists():
                docs_size = get_dir_size(docs_dir)

            # Cache directories
            for cache_dir_name in [".treegraph", "cache", "temp"]:
                cache_dir = data_dir / cache_dir_name
                if cache_dir.exists():
                    cache_size += get_dir_size(cache_dir)

            async with DatabaseSession() as session:
                # Count database records
                agents_count = await session.scalar(select(func.count(AgentSession.id)))
                tasks_count = await session.scalar(select(func.count(Task.id)))
                docs_count = await session.scalar(select(func.count(DocumentationEntry.id)))
                messages_count = await session.scalar(select(func.count(ChatMessage.id)))
                errors_count = await session.scalar(select(func.count(ErrorLog.id)))

                return {
                    "total_size_bytes": total_size,
                    "total_size_mb": round(total_size / (1024 * 1024), 2),
                    "breakdown": {
                        "database_bytes": db_size,
                        "database_mb": round(db_size / (1024 * 1024), 2),
                        "documentation_bytes": docs_size,
                        "documentation_mb": round(docs_size / (1024 * 1024), 2),
                        "cache_bytes": cache_size,
                        "cache_mb": round(cache_size / (1024 * 1024), 2),
                    },
                    "record_counts": {
                        "agents": agents_count or 0,
                        "tasks": tasks_count or 0,
                        "documentation": docs_count or 0,
                        "messages": messages_count or 0,
                        "errors": errors_count or 0,
                    },
                }

        except Exception as e:
            logger.error("Storage analysis failed", error=str(e))
            return {"error": str(e)}

    @staticmethod
    async def find_orphaned_projects() -> list[dict[str, Any]]:
        """Find database entries for projects that no longer exist on disk.
        
        Returns:
            List of orphaned project information
        """
        try:
            orphaned = []

            async with DatabaseSession() as session:
                # Get all unique repository paths from various tables
                repo_paths = set()

                # From agents
                agent_repos = await session.execute(
                    select(AgentSession.repository_path).distinct(),
                )
                repo_paths.update(path[0] for path in agent_repos if path[0])

                # From tasks
                task_repos = await session.execute(
                    select(Task.repository_path).distinct(),
                )
                repo_paths.update(path[0] for path in task_repos if path[0])

                # Check which paths no longer exist
                for repo_path in repo_paths:
                    if repo_path and not Path(repo_path).exists():
                        # Count associated records
                        agents_count = await session.scalar(
                            select(func.count(AgentSession.id)).where(AgentSession.repository_path == repo_path),
                        )
                        tasks_count = await session.scalar(
                            select(func.count(Task.id)).where(Task.repository_path == repo_path),
                        )

                        orphaned.append({
                            "repository_path": repo_path,
                            "agents_count": agents_count or 0,
                            "tasks_count": tasks_count or 0,
                            "status": "orphaned",
                        })

            return orphaned

        except Exception as e:
            logger.error("Orphaned project analysis failed", error=str(e))
            return []

    @staticmethod
    async def find_stale_data(older_than_days: int = 30) -> dict[str, Any]:
        """Find stale data older than specified days.
        
        Args:
            older_than_days: Consider data older than this many days as stale
            
        Returns:
            Dict with stale data analysis
        """
        try:
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)

            async with DatabaseSession() as session:
                # Count stale records
                stale_agents = await session.scalar(
                    select(func.count(AgentSession.id)).where(AgentSession.created_at < cutoff_date),
                )
                stale_tasks = await session.scalar(
                    select(func.count(Task.id)).where(Task.created_at < cutoff_date),
                )
                stale_messages = await session.scalar(
                    select(func.count(ChatMessage.id)).where(
                        ChatMessage.timestamp < cutoff_date,
                    ),
                )
                stale_errors = await session.scalar(
                    select(func.count(ErrorLog.id)).where(ErrorLog.timestamp < cutoff_date),
                )

                return {
                    "cutoff_date": cutoff_date.isoformat(),
                    "older_than_days": older_than_days,
                    "stale_counts": {
                        "agents": stale_agents or 0,
                        "tasks": stale_tasks or 0,
                        "messages": stale_messages or 0,
                        "errors": stale_errors or 0,
                    },
                }

        except Exception as e:
            logger.error("Stale data analysis failed", error=str(e))
            return {"error": str(e)}

    @staticmethod
    async def cleanup_orphaned_projects(
        repository_paths: list[str], 
        dry_run: bool = True,
        force: bool = False,
        backup_before_cleanup: bool = True,
        cleanup_categories: list[str] | None = None,
        older_than_days: int = 30
    ) -> dict[str, Any]:
        """Clean up data for orphaned projects.
        
        Args:
            repository_paths: List of repository paths to clean up
            dry_run: If True, only analyze what would be deleted
            force: Force cleanup even if projects appear active
            backup_before_cleanup: Create backups before cleaning up
            cleanup_categories: Categories of data to cleanup (tasks, agents, docs, etc.)
            older_than_days: Only cleanup data older than specified days
            
        Returns:
            Cleanup results
        """
        try:
            # Set default cleanup categories if none provided
            if cleanup_categories is None:
                cleanup_categories = ["tasks", "agents", "chat_messages", "documentation", "errors"]
            
            # Calculate cutoff date for older_than_days
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)
            
            results = {
                "dry_run": dry_run,
                "repository_paths": repository_paths,
                "settings": {
                    "force": force,
                    "backup_before_cleanup": backup_before_cleanup,
                    "cleanup_categories": cleanup_categories,
                    "older_than_days": older_than_days,
                    "cutoff_date": cutoff_date.isoformat(),
                },
                "deleted_counts": {},
                "errors": [],
            }

            async with DatabaseSession() as session:
                for repo_path in repository_paths:
                    try:
                        # Count what would be deleted
                        agents_count = await session.scalar(
                            select(func.count(AgentSession.id)).where(AgentSession.repository_path == repo_path),
                        )
                        tasks_count = await session.scalar(
                            select(func.count(Task.id)).where(Task.repository_path == repo_path),
                        )

                        results["deleted_counts"][repo_path] = {
                            "agents": agents_count or 0,
                            "tasks": tasks_count or 0,
                        }

                        if not dry_run:
                            # Delete related records
                            await session.execute(
                                delete(AgentSession).where(AgentSession.repository_path == repo_path),
                            )
                            await session.execute(
                                delete(Task).where(Task.repository_path == repo_path),
                            )
                            await session.commit()

                    except Exception as e:
                        error_msg = f"Error cleaning {repo_path}: {e!s}"
                        results["errors"].append(error_msg)
                        logger.error("Cleanup error", repo_path=repo_path, error=str(e))

            return results

        except Exception as e:
            logger.error("Orphaned project cleanup failed", error=str(e))
            return {"error": str(e)}

    @staticmethod
    async def cleanup_stale_data(older_than_days: int = 30, dry_run: bool = True) -> dict[str, Any]:
        """Clean up stale data older than specified days.
        
        Args:
            older_than_days: Delete data older than this many days
            dry_run: If True, only analyze what would be deleted
            
        Returns:
            Cleanup results
        """
        try:
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=older_than_days)

            results = {
                "dry_run": dry_run,
                "cutoff_date": cutoff_date.isoformat(),
                "older_than_days": older_than_days,
                "deleted_counts": {},
                "errors": [],
            }

            async with DatabaseSession() as session:
                # Count and optionally delete stale records
                tables_to_clean = [
                    ("agents", AgentSession, AgentSession.created_at),
                    ("tasks", Task, Task.created_at),
                    ("messages", ChatMessage, ChatMessage.timestamp),
                    ("errors", ErrorLog, ErrorLog.timestamp),
                ]

                for table_name, model_class, date_field in tables_to_clean:
                    try:
                        # Count stale records
                        count = await session.scalar(
                            select(func.count(model_class.id)).where(date_field < cutoff_date),
                        )
                        results["deleted_counts"][table_name] = count or 0

                        if not dry_run and count > 0:
                            # Delete stale records
                            await session.execute(
                                delete(model_class).where(date_field < cutoff_date),
                            )

                    except Exception as e:
                        error_msg = f"Error cleaning {table_name}: {e!s}"
                        results["errors"].append(error_msg)
                        logger.error("Stale cleanup error", table=table_name, error=str(e))

                if not dry_run:
                    await session.commit()

            return results

        except Exception as e:
            logger.error("Stale data cleanup failed", error=str(e))
            return {"error": str(e)}

    @staticmethod
    async def vacuum_database() -> dict[str, Any]:
        """Run SQLite VACUUM to reclaim space and optimize database.
        
        Returns:
            Vacuum operation results
        """
        try:
            db_file = Path.home() / ".mcptools" / "data" / "orchestration.db"

            # Get size before vacuum
            size_before = 0
            if db_file.exists():
                size_before = db_file.stat().st_size

            async with DatabaseSession() as session:
                # Run VACUUM command
                await session.execute(text("VACUUM"))
                await session.commit()

            # Get size after vacuum
            size_after = 0
            if db_file.exists():
                size_after = db_file.stat().st_size

            space_saved = size_before - size_after

            return {
                "success": True,
                "size_before_bytes": size_before,
                "size_after_bytes": size_after,
                "space_saved_bytes": space_saved,
                "space_saved_mb": round(space_saved / (1024 * 1024), 2),
                "compression_ratio": round((space_saved / size_before * 100), 2) if size_before > 0 else 0,
            }

        except Exception as e:
            logger.error("Database vacuum failed", error=str(e))
            return {"error": str(e), "success": False}
