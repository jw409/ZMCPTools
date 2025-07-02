"""Backup and recovery system for AgentTreeGraph storage.

Provides automated backup scheduling, compression, rotation, and recovery
capabilities for the centralized storage system.
"""

import json
import shutil
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles
import structlog

from .manager import ProjectStorageManager

logger = structlog.get_logger()


class BackupManager:
    """Manages backup and recovery operations for storage system."""

    def __init__(self, storage_manager: ProjectStorageManager | None = None):
        """Initialize backup manager.
        
        Args:
            storage_manager: Storage manager instance (creates new if None)
        """
        self.storage_manager = storage_manager or ProjectStorageManager()
        self.backup_root = self.storage_manager.backup_root
        self.daily_backup_dir = self.backup_root / "daily"
        self.weekly_backup_dir = self.backup_root / "weekly"
        self.monthly_backup_dir = self.backup_root / "monthly"

        # Ensure backup directories exist
        for backup_dir in [self.daily_backup_dir, self.weekly_backup_dir, self.monthly_backup_dir]:
            backup_dir.mkdir(parents=True, exist_ok=True)

        # Load backup configuration
        self.config = self._load_backup_config()

    def _load_backup_config(self) -> dict[str, Any]:
        """Load backup configuration."""
        config_file = self.storage_manager.treegraph_root / "config.json"
        default_config = {
            "backup_retention": {
                "daily": 7,
                "weekly": 4,
                "monthly": 12,
            },
            "compression_enabled": True,
            "compression_level": 6,
            "backup_schedule": {
                "daily": "02:00",
                "weekly": "Sunday",
                "monthly": 1,
            },
        }

        if config_file.exists():
            try:
                with config_file.open() as f:
                    full_config = json.load(f)
                    return full_config.get("backup_config", default_config)
            except (json.JSONDecodeError, OSError):
                pass

        return default_config

    async def create_backup(
        self,
        backup_type: str = "manual",
        project_ids: list[str] | None = None,
        compression: bool = True,
    ) -> dict[str, Any]:
        """Create a backup of storage data.
        
        Args:
            backup_type: Type of backup (daily, weekly, monthly, manual)
            project_ids: Specific projects to backup (None for all)
            compression: Enable compression for backup
            
        Returns:
            Backup result with metadata
        """
        timestamp = datetime.now(timezone.utc)
        backup_id = f"{backup_type}_{timestamp.strftime('%Y%m%d_%H%M%S')}"

        result = {
            "backup_id": backup_id,
            "backup_type": backup_type,
            "timestamp": timestamp.isoformat(),
            "success": False,
            "projects_backed_up": 0,
            "total_size_mb": 0.0,
            "backup_path": None,
            "compression_enabled": compression,
            "errors": [],
        }

        try:
            # Determine backup directory
            if backup_type == "daily":
                backup_dir = self.daily_backup_dir
            elif backup_type == "weekly":
                backup_dir = self.weekly_backup_dir
            elif backup_type == "monthly":
                backup_dir = self.monthly_backup_dir
            else:
                backup_dir = self.backup_root / "manual"
                backup_dir.mkdir(exist_ok=True)

            # Create backup archive path
            archive_name = f"{backup_id}.tar.gz" if compression else f"{backup_id}.tar"
            backup_path = backup_dir / archive_name
            result["backup_path"] = str(backup_path)

            # Get projects to backup
            if project_ids is None:
                projects = await self.storage_manager.list_projects()
                project_ids = [p.project_id for p in projects]

            # Create backup archive
            mode = "w:gz" if compression else "w"
            with tarfile.open(backup_path, mode) as tar:
                # Backup project data
                for project_id in project_ids:
                    project_dir = self.storage_manager.projects_root / project_id
                    metadata_file = self.storage_manager.metadata_root / f"{project_id}.json"

                    if project_dir.exists():
                        # Add project directory to archive
                        tar.add(project_dir, arcname=f"projects/{project_id}")
                        result["projects_backed_up"] += 1

                    if metadata_file.exists():
                        # Add metadata to archive
                        tar.add(metadata_file, arcname=f"metadata/{project_id}.json")

                # Backup global metadata and configuration
                config_file = self.storage_manager.treegraph_root / "config.json"
                if config_file.exists():
                    tar.add(config_file, arcname="config.json")

                # Backup indexes if they exist
                if self.storage_manager.indexes_root.exists():
                    tar.add(self.storage_manager.indexes_root, arcname="indexes")

            # Calculate backup size
            backup_size_mb = backup_path.stat().st_size / (1024 * 1024)
            result["total_size_mb"] = backup_size_mb

            # Create backup metadata
            backup_metadata = {
                "backup_id": backup_id,
                "backup_type": backup_type,
                "created_at": timestamp.isoformat(),
                "projects_count": result["projects_backed_up"],
                "total_size_mb": backup_size_mb,
                "compression_enabled": compression,
                "project_ids": project_ids,
            }

            metadata_path = backup_path.with_suffix(backup_path.suffix + ".meta.json")
            async with aiofiles.open(metadata_path, "w") as f:
                await f.write(json.dumps(backup_metadata, indent=2))

            result["success"] = True

            logger.info(
                "Backup created successfully",
                backup_id=backup_id,
                projects=result["projects_backed_up"],
                size_mb=backup_size_mb,
            )

        except Exception as e:
            result["errors"].append(str(e))
            logger.error(f"Backup creation failed: {e}", backup_id=backup_id)

        return result

    async def list_backups(self, backup_type: str | None = None) -> list[dict[str, Any]]:
        """List available backups.
        
        Args:
            backup_type: Filter by backup type (daily, weekly, monthly, manual)
            
        Returns:
            List of backup metadata
        """
        backups = []

        # Determine directories to search
        if backup_type:
            if backup_type == "manual":
                search_dirs = [self.backup_root / "manual"]
            else:
                search_dirs = [getattr(self, f"{backup_type}_backup_dir")]
        else:
            search_dirs = [
                self.daily_backup_dir,
                self.weekly_backup_dir,
                self.monthly_backup_dir,
                self.backup_root / "manual",
            ]

        for backup_dir in search_dirs:
            if not backup_dir.exists():
                continue

            # Find backup archives
            for archive_file in backup_dir.glob("*.tar*"):
                if archive_file.is_file() and not archive_file.name.endswith(".meta.json"):
                    metadata_file = archive_file.with_suffix(archive_file.suffix + ".meta.json")

                    backup_info = {
                        "backup_path": str(archive_file),
                        "size_mb": archive_file.stat().st_size / (1024 * 1024),
                        "created_at": datetime.fromtimestamp(
                            archive_file.stat().st_ctime, tz=timezone.utc,
                        ).isoformat(),
                    }

                    # Load metadata if available
                    if metadata_file.exists():
                        try:
                            async with aiofiles.open(metadata_file) as f:
                                content = await f.read()
                                metadata = json.loads(content)
                                backup_info.update(metadata)
                        except (json.JSONDecodeError, OSError):
                            pass

                    backups.append(backup_info)

        # Sort by creation time (newest first)
        return sorted(backups, key=lambda b: b["created_at"], reverse=True)

    async def restore_backup(
        self,
        backup_path: str,
        target_projects: list[str] | None = None,
        overwrite_existing: bool = False,
    ) -> dict[str, Any]:
        """Restore data from a backup archive.
        
        Args:
            backup_path: Path to backup archive
            target_projects: Specific projects to restore (None for all)
            overwrite_existing: Overwrite existing project data
            
        Returns:
            Restoration result
        """
        result = {
            "backup_path": backup_path,
            "success": False,
            "projects_restored": 0,
            "projects_skipped": 0,
            "errors": [],
            "started_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            backup_file = Path(backup_path)
            if not backup_file.exists():
                result["errors"].append(f"Backup file not found: {backup_path}")
                return result

            # Determine compression
            is_compressed = backup_file.name.endswith(".gz")
            mode = "r:gz" if is_compressed else "r"

            with tarfile.open(backup_file, mode) as tar:
                # Extract and restore projects
                for member in tar.getmembers():
                    if member.name.startswith("projects/") and member.isdir():
                        project_id = member.name.split("/")[1]

                        # Skip if not in target list
                        if target_projects and project_id not in target_projects:
                            continue

                        # Check if project already exists
                        existing_metadata = await self.storage_manager.get_project_metadata(project_id)
                        if existing_metadata and not overwrite_existing:
                            result["projects_skipped"] += 1
                            logger.info(f"Skipping existing project {project_id}")
                            continue

                        # Extract project data
                        project_extract_path = self.storage_manager.projects_root / project_id

                        # Remove existing if overwriting
                        if project_extract_path.exists() and overwrite_existing:
                            shutil.rmtree(project_extract_path)

                        # Extract project files
                        for project_member in tar.getmembers():
                            if project_member.name.startswith(f"projects/{project_id}/"):
                                tar.extract(project_member, self.storage_manager.storage_root)

                        # Extract metadata
                        for metadata_member in tar.getmembers():
                            if metadata_member.name == f"metadata/{project_id}.json":
                                tar.extract(metadata_member, self.storage_manager.storage_root)

                        result["projects_restored"] += 1
                        logger.info(f"Restored project {project_id}")

                # Restore configuration if present
                for member in tar.getmembers():
                    if member.name == "config.json":
                        tar.extract(member, self.storage_manager.treegraph_root)
                        break

            result["success"] = True
            result["completed_at"] = datetime.now(timezone.utc).isoformat()

            logger.info(
                "Backup restoration completed",
                backup_path=backup_path,
                restored=result["projects_restored"],
                skipped=result["projects_skipped"],
            )

        except Exception as e:
            result["errors"].append(str(e))
            logger.error(f"Backup restoration failed: {e}", backup_path=backup_path)

        return result

    async def cleanup_old_backups(self) -> dict[str, Any]:
        """Clean up old backups according to retention policy."""
        cleanup_result = {
            "cleaned_daily": 0,
            "cleaned_weekly": 0,
            "cleaned_monthly": 0,
            "space_freed_mb": 0.0,
            "errors": [],
        }

        retention = self.config.get("backup_retention", {})

        try:
            # Clean daily backups
            daily_retention = retention.get("daily", 7)
            cleanup_result["cleaned_daily"] = await self._cleanup_backup_type(
                self.daily_backup_dir, daily_retention, "daily",
            )

            # Clean weekly backups
            weekly_retention = retention.get("weekly", 4)
            cleanup_result["cleaned_weekly"] = await self._cleanup_backup_type(
                self.weekly_backup_dir, weekly_retention, "weekly",
            )

            # Clean monthly backups
            monthly_retention = retention.get("monthly", 12)
            cleanup_result["cleaned_monthly"] = await self._cleanup_backup_type(
                self.monthly_backup_dir, monthly_retention, "monthly",
            )

            logger.info(
                "Backup cleanup completed",
                daily=cleanup_result["cleaned_daily"],
                weekly=cleanup_result["cleaned_weekly"],
                monthly=cleanup_result["cleaned_monthly"],
            )

        except Exception as e:
            cleanup_result["errors"].append(str(e))
            logger.error(f"Backup cleanup failed: {e}")

        return cleanup_result

    async def _cleanup_backup_type(self, backup_dir: Path, retention_count: int, backup_type: str) -> int:
        """Clean up backups of a specific type."""
        if not backup_dir.exists():
            return 0

        # Get all backup files sorted by creation time (newest first)
        backup_files = []
        for backup_file in backup_dir.glob("*.tar*"):
            if backup_file.is_file() and not backup_file.name.endswith(".meta.json"):
                backup_files.append((backup_file, backup_file.stat().st_ctime))

        backup_files.sort(key=lambda x: x[1], reverse=True)

        # Remove old backups beyond retention count
        cleaned = 0
        for backup_file, _ in backup_files[retention_count:]:
            try:
                # Remove backup archive
                backup_file.unlink()

                # Remove metadata file if it exists
                metadata_file = backup_file.with_suffix(backup_file.suffix + ".meta.json")
                if metadata_file.exists():
                    metadata_file.unlink()

                cleaned += 1
                logger.debug(f"Removed old {backup_type} backup: {backup_file}")

            except OSError as e:
                logger.error(f"Failed to remove backup {backup_file}: {e}")

        return cleaned

    async def verify_backup_integrity(self, backup_path: str) -> dict[str, Any]:
        """Verify the integrity of a backup archive.
        
        Args:
            backup_path: Path to backup archive
            
        Returns:
            Verification results
        """
        verification = {
            "backup_path": backup_path,
            "valid": False,
            "compressed": False,
            "projects_count": 0,
            "total_files": 0,
            "issues": [],
        }

        try:
            backup_file = Path(backup_path)
            if not backup_file.exists():
                verification["issues"].append("Backup file not found")
                return verification

            # Determine compression
            verification["compressed"] = backup_file.name.endswith(".gz")
            mode = "r:gz" if verification["compressed"] else "r"

            # Verify archive can be opened and read
            with tarfile.open(backup_file, mode) as tar:
                members = tar.getmembers()
                verification["total_files"] = len(members)

                # Count projects
                project_dirs = {
                    member.name.split("/")[1]
                    for member in members
                    if member.name.startswith("projects/") and "/" in member.name[9:]
                }
                verification["projects_count"] = len(project_dirs)

                # Check for required files
                has_config = any(member.name == "config.json" for member in members)
                if not has_config:
                    verification["issues"].append("Missing config.json")

                # Verify each project has metadata
                for project_id in project_dirs:
                    has_metadata = any(
                        member.name == f"metadata/{project_id}.json"
                        for member in members
                    )
                    if not has_metadata:
                        verification["issues"].append(f"Missing metadata for project {project_id}")

            verification["valid"] = len(verification["issues"]) == 0

        except Exception as e:
            verification["issues"].append(f"Archive verification failed: {e}")

        return verification

    async def get_backup_schedule_status(self) -> dict[str, Any]:
        """Get the status of backup scheduling."""
        status = {
            "last_daily": None,
            "last_weekly": None,
            "last_monthly": None,
            "next_scheduled": {},
            "total_backups": 0,
            "total_size_mb": 0.0,
        }

        # Get recent backups
        all_backups = await self.list_backups()
        status["total_backups"] = len(all_backups)
        status["total_size_mb"] = sum(b.get("size_mb", 0) for b in all_backups)

        # Find latest of each type
        for backup in all_backups:
            backup_type = backup.get("backup_type", "unknown")
            if backup_type in ["daily", "weekly", "monthly"]:
                if not status[f"last_{backup_type}"]:
                    status[f"last_{backup_type}"] = backup["created_at"]

        return status
