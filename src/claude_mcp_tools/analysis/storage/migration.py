"""Migration utilities for existing .treesummary files.

Provides tools to migrate existing .treesummary directories into the new
centralized storage system while preserving all analysis data.
"""

import asyncio
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles
import structlog

from .manager import ProjectStorageManager

logger = structlog.get_logger()


class MigrationManager:
    """Manages migration of existing .treesummary data to centralized storage."""

    def __init__(self, storage_manager: ProjectStorageManager | None = None):
        """Initialize migration manager.
        
        Args:
            storage_manager: Storage manager instance (creates new if None)
        """
        self.storage_manager = storage_manager or ProjectStorageManager()
        self.migration_log: list[dict[str, Any]] = []

    async def discover_treesummary_projects(self, search_paths: list[str]) -> list[dict[str, Any]]:
        """Discover existing .treesummary directories in search paths.
        
        Args:
            search_paths: List of root directories to search
            
        Returns:
            List of discovered projects with metadata
        """
        discovered = []

        for search_path in search_paths:
            search_root = Path(search_path)
            if not search_root.exists():
                logger.warning(f"Search path does not exist: {search_path}")
                continue

            logger.info(f"Searching for .treesummary directories in {search_path}")

            # Find all .treesummary directories
            for treesummary_dir in search_root.rglob(".treesummary"):
                if treesummary_dir.is_dir():
                    project_root = treesummary_dir.parent

                    # Analyze existing .treesummary structure
                    analysis = await self._analyze_treesummary_dir(treesummary_dir)

                    discovered.append({
                        "project_path": str(project_root),
                        "treesummary_path": str(treesummary_dir),
                        "analysis": analysis,
                        "estimated_size_mb": analysis.get("total_size_mb", 0),
                        "file_count": analysis.get("file_count", 0),
                        "last_modified": analysis.get("last_modified"),
                    })

        logger.info(f"Discovered {len(discovered)} .treesummary projects")
        return discovered

    async def _analyze_treesummary_dir(self, treesummary_dir: Path) -> dict[str, Any]:
        """Analyze existing .treesummary directory structure."""
        analysis = {
            "has_metadata": False,
            "has_symbols": False,
            "file_count": 0,
            "total_size_bytes": 0,
            "total_size_mb": 0.0,
            "languages": {},
            "last_modified": None,
            "structure": [],
        }

        try:
            # Check for metadata.json
            metadata_file = treesummary_dir / "metadata.json"
            if metadata_file.exists():
                analysis["has_metadata"] = True
                try:
                    async with aiofiles.open(metadata_file) as f:
                        content = await f.read()
                        metadata = json.loads(content)
                        analysis["existing_metadata"] = metadata
                        analysis["languages"] = metadata.get("languages", {})
                except (json.JSONDecodeError, OSError):
                    pass

            # Check for symbols directory
            symbols_dir = treesummary_dir / "symbols"
            if symbols_dir.exists() and symbols_dir.is_dir():
                analysis["has_symbols"] = True

                # Count files and calculate sizes
                for symbol_file in symbols_dir.rglob("*.json"):
                    if symbol_file.is_file():
                        try:
                            stat = symbol_file.stat()
                            analysis["file_count"] += 1
                            analysis["total_size_bytes"] += stat.st_size

                            # Track latest modification time
                            mod_time = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                            if not analysis["last_modified"] or mod_time > datetime.fromisoformat(analysis["last_modified"]):
                                analysis["last_modified"] = mod_time.isoformat()
                        except OSError:
                            continue

            # Calculate MB
            analysis["total_size_mb"] = analysis["total_size_bytes"] / (1024 * 1024)

            # Document directory structure
            for item in treesummary_dir.iterdir():
                if item.is_dir():
                    analysis["structure"].append({
                        "name": item.name,
                        "type": "directory",
                        "files": len(list(item.rglob("*"))) if item.exists() else 0,
                    })
                else:
                    analysis["structure"].append({
                        "name": item.name,
                        "type": "file",
                        "size": item.stat().st_size if item.exists() else 0,
                    })

        except Exception as e:
            logger.error(f"Error analyzing .treesummary directory: {e}", path=str(treesummary_dir))
            analysis["error"] = str(e)

        return analysis

    async def migrate_project(
        self,
        project_path: str,
        treesummary_path: str,
        preserve_original: bool = True,
        force: bool = False,
    ) -> dict[str, Any]:
        """Migrate a single project from .treesummary to centralized storage.
        
        Args:
            project_path: Path to project root
            treesummary_path: Path to existing .treesummary directory
            preserve_original: Keep original .treesummary after migration
            force: Force migration even if target exists
            
        Returns:
            Migration result with status and details
        """
        result = {
            "success": False,
            "project_path": project_path,
            "treesummary_path": treesummary_path,
            "project_id": None,
            "files_migrated": 0,
            "size_migrated_mb": 0.0,
            "errors": [],
            "started_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            # Validate paths
            treesummary_dir = Path(treesummary_path)
            if not treesummary_dir.exists():
                result["errors"].append(f"Source .treesummary directory not found: {treesummary_path}")
                return result

            # Register project in storage
            project_name = Path(project_path).name
            project_id = await self.storage_manager.register_project(project_path, project_name)
            result["project_id"] = project_id

            # Check if already migrated
            existing_metadata = await self.storage_manager.get_project_metadata(project_id)
            if existing_metadata and not force:
                result["errors"].append("Project already exists in storage (use force=True to override)")
                return result

            # Migrate metadata.json if it exists
            metadata_file = treesummary_dir / "metadata.json"
            if metadata_file.exists():
                try:
                    async with aiofiles.open(metadata_file) as f:
                        content = await f.read()
                        metadata = json.loads(content)

                    # Update project metadata with migrated info
                    await self.storage_manager.update_project_metadata(
                        project_id,
                        file_count=metadata.get("file_count", 0),
                        languages=metadata.get("languages", {}),
                        frameworks=metadata.get("frameworks", []),
                    )

                except (json.JSONDecodeError, OSError) as e:
                    result["errors"].append(f"Failed to migrate metadata: {e}")

            # Migrate symbol files
            symbols_dir = treesummary_dir / "symbols"
            if symbols_dir.exists():
                for symbol_file in symbols_dir.rglob("*.json"):
                    if symbol_file.is_file():
                        try:
                            # Read analysis data
                            async with aiofiles.open(symbol_file) as f:
                                content = await f.read()
                                analysis_data = json.loads(content)

                            # Determine original file path
                            relative_symbol_path = symbol_file.relative_to(symbols_dir)
                            # Convert symbol filename back to actual file path
                            file_path = str(relative_symbol_path).replace("_", "/").replace(".json", "")

                            # Store in new system
                            success = await self.storage_manager.store_analysis_data(
                                project_id, file_path, analysis_data,
                            )

                            if success:
                                result["files_migrated"] += 1
                                result["size_migrated_mb"] += symbol_file.stat().st_size / (1024 * 1024)
                            else:
                                result["errors"].append(f"Failed to migrate symbol file: {symbol_file}")

                        except (json.JSONDecodeError, OSError) as e:
                            result["errors"].append(f"Error migrating {symbol_file}: {e}")

            # Migrate other important files
            other_files = ["project_summary.json", "dead_code.json"]
            for file_name in other_files:
                source_file = treesummary_dir / file_name
                if source_file.exists():
                    try:
                        async with aiofiles.open(source_file) as f:
                            content = await f.read()
                            data = json.loads(content)

                        # Store as special analysis data
                        await self.storage_manager.store_analysis_data(
                            project_id, f"_meta/{file_name}", data,
                        )
                        result["files_migrated"] += 1

                    except (json.JSONDecodeError, OSError) as e:
                        result["errors"].append(f"Error migrating {file_name}: {e}")

            # Remove original if requested
            if not preserve_original and result["files_migrated"] > 0:
                try:
                    shutil.rmtree(treesummary_dir)
                    result["original_removed"] = True
                except OSError as e:
                    result["errors"].append(f"Failed to remove original: {e}")

            result["success"] = True
            result["completed_at"] = datetime.now(timezone.utc).isoformat()

            logger.info(
                f"Migration completed for {project_path}",
                project_id=project_id,
                files_migrated=result["files_migrated"],
                errors=len(result["errors"]),
            )

        except Exception as e:
            result["errors"].append(f"Migration failed: {e}")
            logger.error(f"Migration error: {e}", project_path=project_path)

        # Log migration
        self.migration_log.append(result)
        return result

    async def migrate_multiple_projects(
        self,
        projects: list[dict[str, Any]],
        preserve_original: bool = True,
        force: bool = False,
        max_concurrent: int = 3,
    ) -> dict[str, Any]:
        """Migrate multiple projects concurrently.
        
        Args:
            projects: List of project dicts from discover_treesummary_projects
            preserve_original: Keep original .treesummary directories
            force: Force migration even if targets exist
            max_concurrent: Maximum concurrent migrations
            
        Returns:
            Migration summary with results for all projects
        """
        summary = {
            "total_projects": len(projects),
            "successful": 0,
            "failed": 0,
            "total_files": 0,
            "total_size_mb": 0.0,
            "results": [],
            "started_at": datetime.now(timezone.utc).isoformat(),
        }

        # Create semaphore for concurrency control
        semaphore = asyncio.Semaphore(max_concurrent)

        async def migrate_single(project_info):
            async with semaphore:
                return await self.migrate_project(
                    project_info["project_path"],
                    project_info["treesummary_path"],
                    preserve_original=preserve_original,
                    force=force,
                )

        # Execute migrations concurrently
        tasks = [migrate_single(project) for project in projects]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results
        for result in results:
            if isinstance(result, Exception):
                summary["failed"] += 1
                summary["results"].append({
                    "success": False,
                    "error": str(result),
                })
            else:
                summary["results"].append(result)
                if result["success"]:
                    summary["successful"] += 1
                    summary["total_files"] += result["files_migrated"]
                    summary["total_size_mb"] += result["size_migrated_mb"]
                else:
                    summary["failed"] += 1

        summary["completed_at"] = datetime.now(timezone.utc).isoformat()

        logger.info(
            "Batch migration completed",
            total=summary["total_projects"],
            successful=summary["successful"],
            failed=summary["failed"],
        )

        return summary

    async def create_migration_report(self, output_path: str | None = None) -> str:
        """Create detailed migration report.
        
        Args:
            output_path: Optional path to save report file
            
        Returns:
            Path to generated report file
        """
        report = {
            "migration_summary": {
                "total_migrations": len(self.migration_log),
                "successful": len([r for r in self.migration_log if r["success"]]),
                "failed": len([r for r in self.migration_log if not r["success"]]),
                "total_files_migrated": sum(r["files_migrated"] for r in self.migration_log),
                "total_size_migrated_mb": sum(r["size_migrated_mb"] for r in self.migration_log),
            },
            "migrations": self.migration_log,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        # Determine output path
        if not output_path:
            output_path = self.storage_manager.storage_root / "logs" / "migration_report.json"

        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)

        # Write report
        async with aiofiles.open(output_file, "w") as f:
            await f.write(json.dumps(report, indent=2))

        logger.info(f"Migration report saved to {output_file}")
        return str(output_file)

    async def verify_migration(self, project_id: str, original_treesummary_path: str) -> dict[str, Any]:
        """Verify migration integrity by comparing original and migrated data.
        
        Args:
            project_id: Migrated project ID
            original_treesummary_path: Path to original .treesummary directory
            
        Returns:
            Verification results
        """
        verification = {
            "project_id": project_id,
            "original_path": original_treesummary_path,
            "verified": False,
            "issues": [],
            "statistics": {
                "original_files": 0,
                "migrated_files": 0,
                "missing_files": 0,
                "corrupted_files": 0,
            },
        }

        try:
            original_dir = Path(original_treesummary_path)
            if not original_dir.exists():
                verification["issues"].append("Original .treesummary directory not found")
                return verification

            # Check migrated project exists
            metadata = await self.storage_manager.get_project_metadata(project_id)
            if not metadata:
                verification["issues"].append("Migrated project not found in storage")
                return verification

            # Compare symbol files
            symbols_dir = original_dir / "symbols"
            if symbols_dir.exists():
                for original_file in symbols_dir.rglob("*.json"):
                    verification["statistics"]["original_files"] += 1

                    # Determine file path
                    relative_path = original_file.relative_to(symbols_dir)
                    file_path = str(relative_path).replace("_", "/").replace(".json", "")

                    # Check if migrated
                    migrated_data = await self.storage_manager.get_analysis_data(project_id, file_path)
                    if migrated_data:
                        verification["statistics"]["migrated_files"] += 1

                        # Compare content
                        try:
                            async with aiofiles.open(original_file) as f:
                                original_content = await f.read()
                                original_data = json.loads(original_content)

                            # Basic integrity check
                            if len(migrated_data) != len(original_data):
                                verification["issues"].append(f"Data mismatch in {file_path}")
                                verification["statistics"]["corrupted_files"] += 1

                        except (json.JSONDecodeError, OSError):
                            verification["issues"].append(f"Cannot read original file {original_file}")
                    else:
                        verification["statistics"]["missing_files"] += 1
                        verification["issues"].append(f"Missing migrated data for {file_path}")

            # Overall verification status
            verification["verified"] = (
                verification["statistics"]["missing_files"] == 0 and
                verification["statistics"]["corrupted_files"] == 0 and
                len(verification["issues"]) == 0
            )

        except Exception as e:
            verification["issues"].append(f"Verification error: {e}")

        return verification
