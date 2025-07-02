"""TreeSummary management with real-time updates and caching.

This module provides the TreeSummaryManager class that manages .treesummary
directories with incremental updates, atomic file operations, and project
metadata tracking optimized for AI consumption.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


class TreeSummaryManager:
    """Manages .treesummary directory with incremental updates and atomic operations."""

    def __init__(self, project_path: str):
        """Initialize TreeSummaryManager for a project.
        
        Args:
            project_path: Absolute path to project root
        """
        self.project_path = Path(project_path)
        self.summary_path = self.project_path / ".treesummary"
        self.ensure_summary_structure()

    def ensure_summary_structure(self):
        """Create .treesummary directory structure with required subdirectories."""
        directories = [
            self.summary_path,
            self.summary_path / "symbols",
            self.summary_path / "cache",
            self.summary_path / "agents",
        ]

        for dir_path in directories:
            dir_path.mkdir(exist_ok=True, parents=True)

        # Create .gitignore for cache directory
        gitignore = self.summary_path / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text("cache/\n*.tmp\n__pycache__/\n")

    async def update_file_analysis(self, file_path: str, analysis_data: dict[str, Any]) -> bool:
        """Update analysis for single file with atomic write operation.
        
        Args:
            file_path: Absolute path to the analyzed file
            analysis_data: Analysis results from agents
            
        Returns:
            True if update successful, False otherwise
        """
        try:
            relative_path = Path(file_path).relative_to(self.project_path)
            symbol_file = self.summary_path / "symbols" / f"{relative_path}.json"

            # Ensure parent directories exist
            symbol_file.parent.mkdir(parents=True, exist_ok=True)

            # Add metadata
            enhanced_data = {
                **analysis_data,
                "updated_at": datetime.utcnow().isoformat() + "Z",
                "relative_path": str(relative_path),
                "absolute_path": str(file_path),
                "file_size": Path(file_path).stat().st_size if Path(file_path).exists() else 0,
            }

            # Write atomically using temporary file
            temp_file = symbol_file.with_suffix(".tmp")
            with temp_file.open("w", encoding="utf-8") as f:
                json.dump(enhanced_data, f, indent=2, ensure_ascii=False)

            # Atomic rename
            temp_file.rename(symbol_file)

            # Update project metadata
            await self.update_project_metadata()

            logger.info("Updated file analysis",
                       file_path=str(relative_path),
                       symbols_count=len(enhanced_data.get("symbols", {}).get("functions", [])))

            return True

        except Exception as e:
            logger.error("Failed to update file analysis",
                        file_path=file_path, error=str(e))
            return False

    async def remove_file_analysis(self, file_path: str) -> bool:
        """Remove analysis for deleted file and clean up empty directories.
        
        Args:
            file_path: Absolute path to the removed file
            
        Returns:
            True if removal successful, False otherwise
        """
        try:
            relative_path = Path(file_path).relative_to(self.project_path)
            symbol_file = self.summary_path / "symbols" / f"{relative_path}.json"

            if symbol_file.exists():
                symbol_file.unlink()
                logger.info("Removed file analysis", file_path=str(relative_path))

                # Clean up empty directories
                parent = symbol_file.parent
                while parent != self.summary_path / "symbols" and parent.exists():
                    try:
                        if not any(parent.iterdir()):
                            parent.rmdir()
                            parent = parent.parent
                        else:
                            break
                    except OSError:
                        break

            # Update project metadata
            await self.update_project_metadata()
            return True

        except Exception as e:
            logger.error("Failed to remove file analysis",
                        file_path=file_path, error=str(e))
            return False

    async def update_project_metadata(self):
        """Update project-level metadata and statistics."""
        try:
            metadata = {
                "project_path": str(self.project_path),
                "project_name": self.project_path.name,
                "last_updated": datetime.utcnow().isoformat() + "Z",
                "version": "1.0.0",
                "analyzer": "AgentTreeGraph-ClaudeMcpTools",
            }

            # Count files and gather statistics
            symbol_files = list((self.summary_path / "symbols").rglob("*.json"))
            metadata["file_count"] = len(symbol_files)

            # Calculate language distribution and complexity metrics
            languages = {}
            total_functions = 0
            total_classes = 0
            complexity_scores = []

            for symbol_file in symbol_files:
                try:
                    with symbol_file.open(encoding="utf-8") as f:
                        data = json.load(f)

                    # Language tracking
                    lang = data.get("language", "unknown")
                    languages[lang] = languages.get(lang, 0) + 1

                    # Symbol counting
                    symbols = data.get("symbols", {})
                    if isinstance(symbols, dict):
                        total_functions += len(symbols.get("functions", []))
                        total_classes += len(symbols.get("classes", []))

                    # Complexity tracking
                    complexity = data.get("complexity_score")
                    if complexity and isinstance(complexity, (int, float)):
                        complexity_scores.append(complexity)

                except (json.JSONDecodeError, KeyError, TypeError) as e:
                    logger.warning("Skipping corrupted analysis file",
                                 file=str(symbol_file), error=str(e))
                    continue

            metadata.update({
                "languages": languages,
                "statistics": {
                    "total_functions": total_functions,
                    "total_classes": total_classes,
                    "average_complexity": sum(complexity_scores) / len(complexity_scores) if complexity_scores else 0,
                    "high_complexity_files": len([s for s in complexity_scores if s > 7]),
                },
            })

            # Write metadata atomically
            metadata_file = self.summary_path / "metadata.json"
            temp_file = metadata_file.with_suffix(".tmp")

            with temp_file.open("w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)

            temp_file.rename(metadata_file)

            logger.debug("Updated project metadata",
                        file_count=metadata["file_count"],
                        languages=list(languages.keys()))

        except Exception as e:
            logger.error("Failed to update project metadata", error=str(e))

    async def get_project_overview(self) -> dict[str, Any]:
        """Get complete project overview from metadata.
        
        Returns:
            Project metadata dictionary or error information
        """
        try:
            metadata_file = self.summary_path / "metadata.json"
            if not metadata_file.exists():
                return {"error": "No project analysis found", "project_path": str(self.project_path)}

            with metadata_file.open(encoding="utf-8") as f:
                return json.load(f)

        except (FileNotFoundError, json.JSONDecodeError) as e:
            logger.error("Failed to read project overview", error=str(e))
            return {"error": f"Failed to read project overview: {e}", "project_path": str(self.project_path)}

    def get_file_analysis(self, file_path: str) -> dict[str, Any] | None:
        """Get analysis for specific file.
        
        Args:
            file_path: Absolute path to the file
            
        Returns:
            Analysis data dictionary or None if not found
        """
        try:
            relative_path = Path(file_path).relative_to(self.project_path)
            symbol_file = self.summary_path / "symbols" / f"{relative_path}.json"

            if not symbol_file.exists():
                return None

            with symbol_file.open(encoding="utf-8") as f:
                return json.load(f)

        except (json.JSONDecodeError, FileNotFoundError, ValueError) as e:
            logger.warning("Failed to read file analysis",
                          file_path=file_path, error=str(e))
            return None

    def list_analyzed_files(self) -> list[dict[str, Any]]:
        """List all files with analysis data.
        
        Returns:
            List of file information dictionaries
        """
        files = []
        symbol_dir = self.summary_path / "symbols"

        if not symbol_dir.exists():
            return files

        for symbol_file in symbol_dir.rglob("*.json"):
            try:
                with symbol_file.open(encoding="utf-8") as f:
                    data = json.load(f)

                files.append({
                    "relative_path": data.get("relative_path"),
                    "absolute_path": data.get("absolute_path"),
                    "language": data.get("language"),
                    "updated_at": data.get("updated_at"),
                    "complexity_score": data.get("complexity_score"),
                    "symbol_count": len(data.get("symbols", {}).get("functions", [])),
                })

            except (json.JSONDecodeError, KeyError) as e:
                logger.warning("Skipping corrupted analysis file",
                             file=str(symbol_file), error=str(e))
                continue

        return sorted(files, key=lambda x: x.get("updated_at", ""), reverse=True)

    async def cleanup_stale_analyses(self, max_age_days: int = 30) -> int:
        """Remove analysis files for non-existent source files.
        
        Args:
            max_age_days: Remove analyses older than this many days
            
        Returns:
            Number of files cleaned up
        """
        cleaned_count = 0
        cutoff_time = datetime.utcnow().timestamp() - (max_age_days * 24 * 3600)

        symbol_dir = self.summary_path / "symbols"
        if not symbol_dir.exists():
            return 0

        for symbol_file in symbol_dir.rglob("*.json"):
            try:
                # Check if source file exists
                with symbol_file.open(encoding="utf-8") as f:
                    data = json.load(f)

                source_path = Path(data.get("absolute_path", ""))
                if not source_path.exists():
                    symbol_file.unlink()
                    cleaned_count += 1
                    logger.info("Cleaned stale analysis", file=str(symbol_file))
                    continue

                # Check age
                file_mtime = symbol_file.stat().st_mtime
                if file_mtime < cutoff_time:
                    symbol_file.unlink()
                    cleaned_count += 1
                    logger.info("Cleaned old analysis", file=str(symbol_file))

            except (json.JSONDecodeError, KeyError, OSError) as e:
                logger.warning("Error during cleanup",
                             file=str(symbol_file), error=str(e))
                continue

        if cleaned_count > 0:
            await self.update_project_metadata()

        return cleaned_count

    def get_cache_path(self, cache_key: str) -> Path:
        """Get path for cached analysis data.
        
        Args:
            cache_key: Unique identifier for cached data
            
        Returns:
            Path to cache file
        """
        return self.summary_path / "cache" / f"{cache_key}.json"

    async def store_cache(self, cache_key: str, data: dict[str, Any]) -> bool:
        """Store data in cache.
        
        Args:
            cache_key: Unique identifier for cached data
            data: Data to cache
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cache_file = self.get_cache_path(cache_key)
            cache_file.parent.mkdir(exist_ok=True)

            cached_data = {
                "data": data,
                "cached_at": datetime.utcnow().isoformat() + "Z",
                "cache_key": cache_key,
            }

            temp_file = cache_file.with_suffix(".tmp")
            with temp_file.open("w", encoding="utf-8") as f:
                json.dump(cached_data, f, indent=2)

            temp_file.rename(cache_file)
            return True

        except Exception as e:
            logger.error("Failed to store cache", cache_key=cache_key, error=str(e))
            return False

    def get_cache(self, cache_key: str, max_age_seconds: int = 3600) -> dict[str, Any] | None:
        """Retrieve data from cache if not expired.
        
        Args:
            cache_key: Unique identifier for cached data
            max_age_seconds: Maximum age of cached data in seconds
            
        Returns:
            Cached data or None if not found/expired
        """
        try:
            cache_file = self.get_cache_path(cache_key)
            if not cache_file.exists():
                return None

            # Check age
            file_age = datetime.utcnow().timestamp() - cache_file.stat().st_mtime
            if file_age > max_age_seconds:
                cache_file.unlink()  # Remove expired cache
                return None

            with cache_file.open(encoding="utf-8") as f:
                cached_data = json.load(f)

            return cached_data.get("data")

        except (json.JSONDecodeError, FileNotFoundError, KeyError) as e:
            logger.warning("Failed to read cache", cache_key=cache_key, error=str(e))
            return None
