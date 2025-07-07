"""Project Storage Manager for AgentTreeGraph data.

Provides atomic operations, namespace isolation, and comprehensive project
data management with backup and recovery capabilities.
"""

import asyncio
import hashlib
import json
import shutil
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles
import aiofiles.os
import structlog

logger = structlog.get_logger()


@dataclass
class ProjectMetadata:
    """Project metadata for storage management."""
    project_id: str
    project_path: str
    name: str
    created_at: str
    last_updated: str
    version: str = "1.0.0"
    file_count: int = 0
    total_size_bytes: int = 0
    languages: dict[str, int] = None
    frameworks: list[str] = None

    def __post_init__(self):
        if self.languages is None:
            self.languages = {}
        if self.frameworks is None:
            self.frameworks = []


@dataclass
class StorageQuota:
    """Storage quota and usage tracking."""
    max_size_mb: int = 500
    current_size_mb: float = 0.0
    file_count: int = 0
    last_cleanup: str | None = None

    @property
    def usage_percent(self) -> float:
        """Calculate storage usage percentage."""
        return (self.current_size_mb / self.max_size_mb) * 100 if self.max_size_mb > 0 else 0.0

    @property
    def is_over_quota(self) -> bool:
        """Check if over storage quota."""
        return self.current_size_mb > self.max_size_mb


class ProjectStorageManager:
    """Comprehensive project storage manager with atomic operations."""

    def __init__(self, storage_root: str | None = None):
        """Initialize storage manager.
        
        Args:
            storage_root: Root storage directory (defaults to ~/.mcptools/data)
        """
        self.storage_root = Path(storage_root or Path.home() / ".mcptools" / "data")
        self.treegraph_root = self.storage_root / ".treegraph"
        self.projects_root = self.treegraph_root / "projects"
        self.metadata_root = self.treegraph_root / "metadata"
        self.indexes_root = self.treegraph_root / "indexes"
        self.cache_root = self.storage_root / "cache"
        self.backup_root = self.storage_root / "backup"

        # Ensure directories exist
        self._ensure_directories()

        # Load storage configuration
        self.config = self._load_config()

        # Lock for atomic operations
        self._locks: dict[str, asyncio.Lock] = {}

    def _ensure_directories(self):
        """Ensure all required directories exist."""
        for directory in [
            self.projects_root,
            self.metadata_root,
            self.indexes_root,
            self.cache_root,
            self.backup_root,
        ]:
            directory.mkdir(parents=True, exist_ok=True)

    def _load_config(self) -> dict[str, Any]:
        """Load storage configuration."""
        config_file = self.treegraph_root / "config.json"
        if config_file.exists():
            try:
                with config_file.open() as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning(f"Failed to load config: {e}")

        # Default configuration
        return {
            "version": "1.0.0",
            "storage_config": {
                "max_project_storage_mb": 500,
                "cache_retention_days": 30,
                "atomic_writes": True,
                "compression_enabled": True,
            },
        }

    def _get_project_id(self, project_path: str) -> str:
        """Generate unique project ID from path."""
        # Use SHA256 hash of absolute path for uniqueness
        abs_path = str(Path(project_path).resolve())
        return hashlib.sha256(abs_path.encode()).hexdigest()[:16]

    async def _get_lock(self, project_id: str) -> asyncio.Lock:
        """Get or create lock for project."""
        if project_id not in self._locks:
            self._locks[project_id] = asyncio.Lock()
        return self._locks[project_id]

    @asynccontextmanager
    async def _atomic_write(self, file_path: Path):
        """Context manager for atomic file writes."""
        temp_file = file_path.with_suffix(f"{file_path.suffix}.tmp")
        file_handle = None
        try:
            # Ensure parent directory exists
            file_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Open file handle outside of yield to prevent cancellation issues
            file_handle = await aiofiles.open(temp_file, "w")
            
            try:
                # Yield outside of resource management context to prevent cancellation bugs
                yield file_handle
            finally:
                # Ensure file handle is always closed
                if file_handle:
                    await file_handle.close()
            
            # Atomic move after file is closed
            await aiofiles.os.rename(str(temp_file), str(file_path))

        except Exception:
            # Cleanup temp file on error or cancellation
            if temp_file.exists():
                await aiofiles.os.unlink(str(temp_file))
            raise

    async def register_project(self, project_path: str, name: str | None = None) -> str:
        """Register a new project in storage.
        
        Args:
            project_path: Absolute path to project
            name: Optional project name (defaults to directory name)
            
        Returns:
            Project ID for storage operations
        """
        project_id = self._get_project_id(project_path)
        lock = await self._get_lock(project_id)

        async with lock:
            project_dir = self.projects_root / project_id
            metadata_file = self.metadata_root / f"{project_id}.json"

            # Create project directory
            project_dir.mkdir(exist_ok=True)

            # Create metadata
            metadata = ProjectMetadata(
                project_id=project_id,
                project_path=project_path,
                name=name or Path(project_path).name,
                created_at=datetime.now(timezone.utc).isoformat(),
                last_updated=datetime.now(timezone.utc).isoformat(),
            )

            # Write metadata atomically
            async with self._atomic_write(metadata_file) as f:
                await f.write(json.dumps(asdict(metadata), indent=2))

            logger.info(f"Registered project {project_id}", project_path=project_path)
            return project_id

    async def get_project_metadata(self, project_id: str) -> ProjectMetadata | None:
        """Get project metadata by ID."""
        metadata_file = self.metadata_root / f"{project_id}.json"

        if not metadata_file.exists():
            return None

        try:
            async with aiofiles.open(metadata_file) as f:
                content = await f.read()
                data = json.loads(content)
                return ProjectMetadata(**data)
        except (json.JSONDecodeError, OSError, TypeError) as e:
            logger.error(f"Failed to load project metadata: {e}", project_id=project_id)
            return None

    async def update_project_metadata(self, project_id: str, **updates) -> bool:
        """Update project metadata."""
        lock = await self._get_lock(project_id)

        async with lock:
            metadata = await self.get_project_metadata(project_id)
            if not metadata:
                return False

            # Update fields
            for key, value in updates.items():
                if hasattr(metadata, key):
                    setattr(metadata, key, value)

            metadata.last_updated = datetime.now(timezone.utc).isoformat()

            # Write updated metadata
            metadata_file = self.metadata_root / f"{project_id}.json"
            async with self._atomic_write(metadata_file) as f:
                await f.write(json.dumps(asdict(metadata), indent=2))

            return True

    async def store_analysis_data(
        self,
        project_id: str,
        file_path: str,
        analysis_data: dict[str, Any],
    ) -> bool:
        """Store analysis data for a file.
        
        Args:
            project_id: Project identifier
            file_path: Relative path within project
            analysis_data: Analysis results to store
            
        Returns:
            Success status
        """
        lock = await self._get_lock(project_id)

        async with lock:
            # Ensure project exists
            metadata = await self.get_project_metadata(project_id)
            if not metadata:
                logger.error(f"Project not found: {project_id}")
                return False

            # Create analysis file path
            safe_file_path = str(Path(file_path)).replace("/", "_").replace("\\", "_")
            analysis_file = self.projects_root / project_id / "symbols" / f"{safe_file_path}.json"

            # Add metadata to analysis
            analysis_data.update({
                "stored_at": datetime.now(timezone.utc).isoformat(),
                "file_path": file_path,
                "project_id": project_id,
            })

            # Store analysis data atomically
            try:
                async with self._atomic_write(analysis_file) as f:
                    await f.write(json.dumps(analysis_data, indent=2))

                logger.debug(f"Stored analysis for {file_path}", project_id=project_id)
                return True

            except Exception as e:
                logger.error(f"Failed to store analysis: {e}", project_id=project_id, file_path=file_path)
                return False

    async def get_analysis_data(self, project_id: str, file_path: str) -> dict[str, Any] | None:
        """Retrieve analysis data for a file."""
        safe_file_path = str(Path(file_path)).replace("/", "_").replace("\\", "_")
        analysis_file = self.projects_root / project_id / "symbols" / f"{safe_file_path}.json"

        if not analysis_file.exists():
            return None

        try:
            async with aiofiles.open(analysis_file) as f:
                content = await f.read()
                return json.loads(content)
        except (json.JSONDecodeError, OSError) as e:
            logger.error(f"Failed to read analysis data: {e}", project_id=project_id, file_path=file_path)
            return None

    async def remove_analysis_data(self, project_id: str, file_path: str) -> bool:
        """Remove analysis data for a deleted file."""
        lock = await self._get_lock(project_id)

        async with lock:
            safe_file_path = str(Path(file_path)).replace("/", "_").replace("\\", "_")
            analysis_file = self.projects_root / project_id / "symbols" / f"{safe_file_path}.json"

            if analysis_file.exists():
                try:
                    await aiofiles.os.unlink(str(analysis_file))
                    logger.debug(f"Removed analysis for {file_path}", project_id=project_id)
                    return True
                except OSError as e:
                    logger.error(f"Failed to remove analysis: {e}", project_id=project_id, file_path=file_path)
                    return False

            return True  # Already removed

    async def list_projects(self) -> list[ProjectMetadata]:
        """List all registered projects."""
        projects = []

        for metadata_file in self.metadata_root.glob("*.json"):
            try:
                async with aiofiles.open(metadata_file) as f:
                    content = await f.read()
                    data = json.loads(content)
                    projects.append(ProjectMetadata(**data))
            except (json.JSONDecodeError, OSError, TypeError) as e:
                logger.warning(f"Skipping invalid metadata file {metadata_file}: {e}")

        return sorted(projects, key=lambda p: p.last_updated, reverse=True)

    async def get_storage_quota(self) -> StorageQuota:
        """Get current storage quota and usage."""
        max_size_mb = self.config.get("storage_config", {}).get("max_project_storage_mb", 500)

        # Calculate current usage
        total_size = 0
        file_count = 0

        for project_dir in self.projects_root.iterdir():
            if project_dir.is_dir():
                for file_path in project_dir.rglob("*"):
                    if file_path.is_file():
                        try:
                            total_size += file_path.stat().st_size
                            file_count += 1
                        except OSError:
                            continue

        current_size_mb = total_size / (1024 * 1024)

        return StorageQuota(
            max_size_mb=max_size_mb,
            current_size_mb=current_size_mb,
            file_count=file_count,
        )

    async def cleanup_project(self, project_id: str) -> bool:
        """Clean up all data for a project."""
        lock = await self._get_lock(project_id)

        async with lock:
            try:
                # Remove project directory
                project_dir = self.projects_root / project_id
                if project_dir.exists():
                    shutil.rmtree(project_dir)

                # Remove metadata
                metadata_file = self.metadata_root / f"{project_id}.json"
                if metadata_file.exists():
                    await aiofiles.os.unlink(str(metadata_file))

                logger.info(f"Cleaned up project {project_id}")
                return True

            except Exception as e:
                logger.error(f"Failed to cleanup project: {e}", project_id=project_id)
                return False

    async def get_project_stats(self, project_id: str) -> dict[str, Any] | None:
        """Get comprehensive project statistics."""
        metadata = await self.get_project_metadata(project_id)
        if not metadata:
            return None

        project_dir = self.projects_root / project_id
        if not project_dir.exists():
            return None

        # Calculate storage usage
        total_size = 0
        file_count = 0

        for file_path in project_dir.rglob("*"):
            if file_path.is_file():
                try:
                    total_size += file_path.stat().st_size
                    file_count += 1
                except OSError:
                    continue

        return {
            "project_id": project_id,
            "metadata": asdict(metadata),
            "storage": {
                "total_size_bytes": total_size,
                "total_size_mb": total_size / (1024 * 1024),
                "file_count": file_count,
            },
            "last_accessed": datetime.now(timezone.utc).isoformat(),
        }
