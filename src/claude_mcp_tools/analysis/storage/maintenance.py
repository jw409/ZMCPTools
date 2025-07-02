"""Maintenance and optimization utilities for AgentTreeGraph storage.

Provides automated cleanup, optimization, integrity checking, and health
monitoring for the centralized storage system.
"""

import json
import shutil
from datetime import datetime, timezone
from typing import Any

import structlog

from .backup import BackupManager
from .cache import CacheManager
from .manager import ProjectStorageManager

logger = structlog.get_logger()


class MaintenanceManager:
    """Comprehensive maintenance and optimization manager."""

    def __init__(
        self,
        storage_manager: ProjectStorageManager | None = None,
        backup_manager: BackupManager | None = None,
        cache_manager: CacheManager | None = None,
    ):
        """Initialize maintenance manager.
        
        Args:
            storage_manager: Storage manager instance
            backup_manager: Backup manager instance
            cache_manager: Cache manager instance
        """
        self.storage_manager = storage_manager or ProjectStorageManager()
        self.backup_manager = backup_manager or BackupManager(self.storage_manager)
        self.cache_manager = cache_manager or CacheManager()

        # Maintenance configuration
        self.config = {
            "auto_cleanup_enabled": True,
            "quota_enforcement": True,
            "integrity_check_interval_hours": 24,
            "cleanup_schedule": "daily",
            "orphan_cleanup_enabled": True,
            "compression_optimization": True,
        }

    async def run_daily_maintenance(self) -> dict[str, Any]:
        """Run comprehensive daily maintenance tasks.
        
        Returns:
            Maintenance summary report
        """
        maintenance_report = {
            "started_at": datetime.now(timezone.utc).isoformat(),
            "tasks_completed": [],
            "tasks_failed": [],
            "statistics": {},
            "recommendations": [],
        }

        logger.info("Starting daily maintenance routine")

        try:
            # 1. Clean up expired cache
            logger.info("Cleaning up expired cache entries")
            cache_stats = await self.cache_manager.cleanup_expired_cache()
            maintenance_report["tasks_completed"].append({
                "task": "cache_cleanup",
                "result": cache_stats,
            })

            # 2. Check and enforce storage quotas
            logger.info("Checking storage quotas")
            quota_result = await self._enforce_storage_quotas()
            maintenance_report["tasks_completed"].append({
                "task": "quota_enforcement",
                "result": quota_result,
            })

            # 3. Clean up orphaned files
            logger.info("Cleaning up orphaned files")
            orphan_result = await self._cleanup_orphaned_files()
            maintenance_report["tasks_completed"].append({
                "task": "orphan_cleanup",
                "result": orphan_result,
            })

            # 4. Optimize storage compression
            logger.info("Optimizing storage compression")
            compression_result = await self._optimize_compression()
            maintenance_report["tasks_completed"].append({
                "task": "compression_optimization",
                "result": compression_result,
            })

            # 5. Clean up old backups
            logger.info("Cleaning up old backups")
            backup_cleanup = await self.backup_manager.cleanup_old_backups()
            maintenance_report["tasks_completed"].append({
                "task": "backup_cleanup",
                "result": backup_cleanup,
            })

            # 6. Generate health statistics
            logger.info("Generating health statistics")
            health_stats = await self.get_system_health()
            maintenance_report["statistics"] = health_stats

            # 7. Generate recommendations
            maintenance_report["recommendations"] = await self._generate_recommendations(health_stats)

        except Exception as e:
            logger.error(f"Daily maintenance failed: {e}")
            maintenance_report["tasks_failed"].append({
                "task": "daily_maintenance",
                "error": str(e),
            })

        maintenance_report["completed_at"] = datetime.now(timezone.utc).isoformat()

        # Save maintenance report
        await self._save_maintenance_report(maintenance_report)

        logger.info(
            "Daily maintenance completed",
            tasks_completed=len(maintenance_report["tasks_completed"]),
            tasks_failed=len(maintenance_report["tasks_failed"]),
        )

        return maintenance_report

    async def _enforce_storage_quotas(self) -> dict[str, Any]:
        """Enforce storage quotas and clean up if necessary."""
        quota_result = {
            "quota_status": "unknown",
            "projects_cleaned": 0,
            "space_freed_mb": 0.0,
            "actions_taken": [],
        }

        try:
            # Get current quota status
            quota = await self.storage_manager.get_storage_quota()
            quota_result["quota_status"] = "over_quota" if quota.is_over_quota else "within_quota"
            quota_result["usage_percent"] = quota.usage_percent

            if quota.is_over_quota:
                logger.warning(f"Storage over quota: {quota.usage_percent:.1f}%")

                # Get projects sorted by last access time (oldest first)
                projects = await self.storage_manager.list_projects()
                projects_with_stats = []

                for project in projects:
                    stats = await self.storage_manager.get_project_stats(project.project_id)
                    if stats:
                        projects_with_stats.append((project, stats))

                # Sort by last updated (oldest first)
                projects_with_stats.sort(key=lambda x: x[0].last_updated)

                # Clean up oldest projects until within quota
                for project, stats in projects_with_stats:
                    if not quota.is_over_quota:
                        break

                    # Check if project hasn't been accessed recently
                    last_updated = datetime.fromisoformat(project.last_updated)
                    days_since_update = (datetime.now(timezone.utc) - last_updated).days

                    if days_since_update > 30:  # Clean projects older than 30 days
                        project_size_mb = stats["storage"]["total_size_mb"]

                        success = await self.storage_manager.cleanup_project(project.project_id)
                        if success:
                            quota_result["projects_cleaned"] += 1
                            quota_result["space_freed_mb"] += project_size_mb
                            quota_result["actions_taken"].append(f"Cleaned project {project.name}")

                            # Recalculate quota
                            quota = await self.storage_manager.get_storage_quota()

                            logger.info(f"Cleaned up project {project.name} ({project_size_mb:.1f}MB)")

        except Exception as e:
            logger.error(f"Quota enforcement failed: {e}")
            quota_result["error"] = str(e)

        return quota_result

    async def _cleanup_orphaned_files(self) -> dict[str, Any]:
        """Clean up orphaned files and directories."""
        cleanup_result = {
            "orphaned_files_removed": 0,
            "orphaned_dirs_removed": 0,
            "space_freed_mb": 0.0,
            "errors": [],
        }

        try:
            # Get list of valid project IDs
            valid_projects = await self.storage_manager.list_projects()
            valid_project_ids = {project.project_id for project in valid_projects}

            # Check project directories
            projects_root = self.storage_manager.projects_root
            if projects_root.exists():
                for project_dir in projects_root.iterdir():
                    if project_dir.is_dir() and project_dir.name not in valid_project_ids:
                        # Orphaned project directory
                        try:
                            size_mb = sum(
                                f.stat().st_size for f in project_dir.rglob("*") if f.is_file()
                            ) / (1024 * 1024)

                            shutil.rmtree(project_dir)
                            cleanup_result["orphaned_dirs_removed"] += 1
                            cleanup_result["space_freed_mb"] += size_mb

                            logger.info(f"Removed orphaned project directory: {project_dir.name}")

                        except OSError as e:
                            cleanup_result["errors"].append(f"Failed to remove {project_dir}: {e}")

            # Check metadata files
            metadata_root = self.storage_manager.metadata_root
            if metadata_root.exists():
                for metadata_file in metadata_root.glob("*.json"):
                    project_id = metadata_file.stem
                    if project_id not in valid_project_ids:
                        # Check if corresponding project directory exists
                        project_dir = projects_root / project_id
                        if not project_dir.exists():
                            try:
                                size_mb = metadata_file.stat().st_size / (1024 * 1024)
                                metadata_file.unlink()
                                cleanup_result["orphaned_files_removed"] += 1
                                cleanup_result["space_freed_mb"] += size_mb

                                logger.info(f"Removed orphaned metadata file: {metadata_file.name}")

                            except OSError as e:
                                cleanup_result["errors"].append(f"Failed to remove {metadata_file}: {e}")

        except Exception as e:
            logger.error(f"Orphan cleanup failed: {e}")
            cleanup_result["errors"].append(str(e))

        return cleanup_result

    async def _optimize_compression(self) -> dict[str, Any]:
        """Optimize storage by compressing large uncompressed files."""
        optimization_result = {
            "files_compressed": 0,
            "space_saved_mb": 0.0,
            "errors": [],
        }

        try:
            # Find large uncompressed files in project directories
            for project_dir in self.storage_manager.projects_root.iterdir():
                if not project_dir.is_dir():
                    continue

                for json_file in project_dir.rglob("*.json"):
                    if json_file.is_file():
                        file_size = json_file.stat().st_size

                        # Compress files larger than 50KB
                        if file_size > 50 * 1024:
                            try:
                                # Read file content
                                with json_file.open() as f:
                                    content = f.read()

                                # Compress and write to .gz file
                                import gzip
                                compressed_file = json_file.with_suffix(".json.gz")

                                with gzip.open(compressed_file, "wt") as f:
                                    f.write(content)

                                # Check compression ratio
                                compressed_size = compressed_file.stat().st_size
                                compression_ratio = compressed_size / file_size

                                # Only keep compressed version if significant savings
                                if compression_ratio < 0.8:  # 20% or more savings
                                    json_file.unlink()  # Remove original
                                    space_saved = (file_size - compressed_size) / (1024 * 1024)

                                    optimization_result["files_compressed"] += 1
                                    optimization_result["space_saved_mb"] += space_saved

                                    logger.debug(f"Compressed {json_file.name} ({compression_ratio:.2%} ratio)")
                                else:
                                    # Remove compressed version if not worth it
                                    compressed_file.unlink()

                            except Exception as e:
                                optimization_result["errors"].append(f"Failed to compress {json_file}: {e}")

        except Exception as e:
            logger.error(f"Compression optimization failed: {e}")
            optimization_result["errors"].append(str(e))

        return optimization_result

    async def check_data_integrity(self) -> dict[str, Any]:
        """Perform comprehensive data integrity check."""
        integrity_report = {
            "total_projects": 0,
            "healthy_projects": 0,
            "projects_with_issues": 0,
            "corrupted_files": 0,
            "missing_metadata": 0,
            "issues": [],
            "recommendations": [],
        }

        try:
            projects = await self.storage_manager.list_projects()
            integrity_report["total_projects"] = len(projects)

            for project in projects:
                project_issues = []

                # Check if project directory exists
                project_dir = self.storage_manager.projects_root / project.project_id
                if not project_dir.exists():
                    project_issues.append("Missing project directory")

                # Check metadata file
                metadata_file = self.storage_manager.metadata_root / f"{project.project_id}.json"
                if not metadata_file.exists():
                    project_issues.append("Missing metadata file")
                    integrity_report["missing_metadata"] += 1

                # Check project data files
                if project_dir.exists():
                    symbols_dir = project_dir / "symbols"
                    if symbols_dir.exists():
                        for symbol_file in symbols_dir.rglob("*.json*"):
                            try:
                                # Try to read and parse JSON files
                                if symbol_file.name.endswith(".gz"):
                                    import gzip
                                    with gzip.open(symbol_file, "rt") as f:
                                        json.load(f)
                                else:
                                    with symbol_file.open() as f:
                                        json.load(f)
                            except (json.JSONDecodeError, OSError, UnicodeDecodeError):
                                project_issues.append(f"Corrupted file: {symbol_file.name}")
                                integrity_report["corrupted_files"] += 1

                if project_issues:
                    integrity_report["projects_with_issues"] += 1
                    integrity_report["issues"].append({
                        "project_id": project.project_id,
                        "project_name": project.name,
                        "issues": project_issues,
                    })
                else:
                    integrity_report["healthy_projects"] += 1

            # Generate recommendations based on issues found
            if integrity_report["corrupted_files"] > 0:
                integrity_report["recommendations"].append(
                    f"Found {integrity_report['corrupted_files']} corrupted files - consider restoring from backup",
                )

            if integrity_report["missing_metadata"] > 0:
                integrity_report["recommendations"].append(
                    f"Found {integrity_report['missing_metadata']} projects with missing metadata - regenerate metadata",
                )

        except Exception as e:
            logger.error(f"Integrity check failed: {e}")
            integrity_report["error"] = str(e)

        return integrity_report

    async def get_system_health(self) -> dict[str, Any]:
        """Get comprehensive system health metrics."""
        health_metrics = {
            "storage": {},
            "cache": {},
            "backups": {},
            "projects": {},
            "overall_health": "unknown",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        try:
            # Storage health
            quota = await self.storage_manager.get_storage_quota()
            health_metrics["storage"] = {
                "usage_percent": quota.usage_percent,
                "total_files": quota.file_count,
                "is_over_quota": quota.is_over_quota,
                "current_size_mb": quota.current_size_mb,
                "max_size_mb": quota.max_size_mb,
            }

            # Cache health
            cache_stats = await self.cache_manager.get_cache_stats()
            health_metrics["cache"] = cache_stats

            # Backup health
            backup_status = await self.backup_manager.get_backup_schedule_status()
            health_metrics["backups"] = backup_status

            # Project statistics
            projects = await self.storage_manager.list_projects()
            health_metrics["projects"] = {
                "total_count": len(projects),
                "languages": {},
                "avg_size_mb": 0.0,
            }

            # Calculate language distribution and average size
            total_size = 0.0
            language_counts = {}

            for project in projects:
                if project.languages:
                    for lang, count in project.languages.items():
                        language_counts[lang] = language_counts.get(lang, 0) + count

                # Get project size
                stats = await self.storage_manager.get_project_stats(project.project_id)
                if stats:
                    total_size += stats["storage"]["total_size_mb"]

            health_metrics["projects"]["languages"] = language_counts
            health_metrics["projects"]["avg_size_mb"] = total_size / len(projects) if projects else 0.0

            # Determine overall health
            health_score = 100

            if quota.is_over_quota:
                health_score -= 30
            elif quota.usage_percent > 85:
                health_score -= 15

            if cache_stats["total_size_mb"] > 500:  # Large cache
                health_score -= 10

            if not backup_status.get("last_daily"):
                health_score -= 20

            if health_score >= 90:
                health_metrics["overall_health"] = "excellent"
            elif health_score >= 75:
                health_metrics["overall_health"] = "good"
            elif health_score >= 50:
                health_metrics["overall_health"] = "fair"
            else:
                health_metrics["overall_health"] = "poor"

            health_metrics["health_score"] = health_score

        except Exception as e:
            logger.error(f"Health check failed: {e}")
            health_metrics["error"] = str(e)
            health_metrics["overall_health"] = "error"

        return health_metrics

    async def _generate_recommendations(self, health_stats: dict[str, Any]) -> list[str]:
        """Generate maintenance recommendations based on health statistics."""
        recommendations = []

        try:
            # Storage recommendations
            storage = health_stats.get("storage", {})
            if storage.get("is_over_quota"):
                recommendations.append("Storage is over quota - consider cleaning up old projects or increasing quota")
            elif storage.get("usage_percent", 0) > 85:
                recommendations.append("Storage usage is high - consider scheduling cleanup or backup")

            # Cache recommendations
            cache = health_stats.get("cache", {})
            if cache.get("total_size_mb", 0) > 200:
                recommendations.append("Cache size is large - consider reducing TTL or running cleanup")

            # Backup recommendations
            backups = health_stats.get("backups", {})
            if not backups.get("last_daily"):
                recommendations.append("No recent daily backup found - schedule backup creation")

            # Project recommendations
            projects = health_stats.get("projects", {})
            if projects.get("total_count", 0) > 50:
                recommendations.append("Large number of projects - consider archiving inactive projects")

            if projects.get("avg_size_mb", 0) > 50:
                recommendations.append("Large average project size - consider optimizing compression")

        except Exception as e:
            logger.error(f"Failed to generate recommendations: {e}")
            recommendations.append("Error generating recommendations - check system logs")

        return recommendations

    async def _save_maintenance_report(self, report: dict[str, Any]) -> str:
        """Save maintenance report to logs directory."""
        try:
            logs_dir = self.storage_manager.storage_root / "logs" / "storage"
            logs_dir.mkdir(parents=True, exist_ok=True)

            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            report_file = logs_dir / f"maintenance_report_{timestamp}.json"

            with report_file.open("w") as f:
                json.dump(report, f, indent=2, default=str)

            logger.info(f"Maintenance report saved to {report_file}")
            return str(report_file)

        except Exception as e:
            logger.error(f"Failed to save maintenance report: {e}")
            return ""
