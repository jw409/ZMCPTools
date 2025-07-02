"""File-based caching system for .treesummary integration.

Implements incremental caching that integrates with the .treesummary system
for real-time analysis updates and cache invalidation.
"""

import asyncio
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

logger = structlog.get_logger()


class FileAnalysisCache:
    """File-based cache that integrates with .treesummary system."""

    def __init__(self, project_path: str, cache_manager):
        self.project_path = Path(project_path)
        self.cache_manager = cache_manager

        # .treesummary integration
        self.treesummary_path = self.project_path / ".treesummary"
        self.cache_path = self.treesummary_path / "cache"
        self.symbols_path = self.treesummary_path / "symbols"

        # File monitoring
        self.file_hashes: dict[str, str] = {}
        self.cached_files: set[str] = set()
        self.observer: Observer | None = None

        # Cache statistics
        self.cache_stats = {
            "files_cached": 0,
            "cache_hits": 0,
            "cache_misses": 0,
            "invalidations": 0,
            "incremental_updates": 0,
        }

        self._ensure_cache_structure()

    def _ensure_cache_structure(self):
        """Ensure .treesummary cache structure exists."""
        directories = [
            self.treesummary_path,
            self.cache_path,
            self.symbols_path,
            self.cache_path / "analysis",
            self.cache_path / "hashes",
            self.cache_path / "metadata",
        ]

        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)

        # Create .gitignore for cache directory
        gitignore = self.cache_path / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text("*.cache\n*.tmp\n*.lock\nanalysis/\nhashes/\n")

    async def initialize(self):
        """Initialize file cache and load existing state."""
        await self._load_file_hashes()
        await self._scan_cached_files()
        await self._setup_file_watching()

        logger.info("FileAnalysisCache initialized",
                   project_path=str(self.project_path),
                   cached_files=len(self.cached_files))

    async def _load_file_hashes(self):
        """Load file content hashes from cache."""
        hash_file = self.cache_path / "hashes" / "file_hashes.json"

        if hash_file.exists():
            try:
                with hash_file.open() as f:
                    self.file_hashes = json.load(f)
                logger.debug("File hashes loaded", count=len(self.file_hashes))
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Failed to load file hashes", error=str(e))
                self.file_hashes = {}

    async def _save_file_hashes(self):
        """Save file content hashes to cache."""
        hash_file = self.cache_path / "hashes" / "file_hashes.json"

        try:
            with hash_file.open("w") as f:
                json.dump(self.file_hashes, f, indent=2)
        except OSError as e:
            logger.error("Failed to save file hashes", error=str(e))

    async def _scan_cached_files(self):
        """Scan for existing cached analysis files."""
        analysis_dir = self.cache_path / "analysis"

        if analysis_dir.exists():
            for cache_file in analysis_dir.rglob("*.json"):
                # Extract original file path from cache file
                relative_path = cache_file.relative_to(analysis_dir)
                # Remove .json extension to get original file path
                original_path = str(relative_path)[:-5]  # Remove .json
                self.cached_files.add(original_path)

        logger.debug("Cached files scanned", count=len(self.cached_files))

    async def _setup_file_watching(self):
        """Setup file system watching for incremental updates."""
        if self.observer:
            return

        event_handler = CacheFileSystemEventHandler(self)
        self.observer = Observer()
        self.observer.schedule(
            event_handler,
            str(self.project_path),
            recursive=True,
        )
        self.observer.start()

        logger.info("File watching started", project_path=str(self.project_path))

    def _get_file_hash(self, file_path: str) -> str:
        """Get content hash for a file."""
        try:
            with open(file_path, "rb") as f:
                content = f.read()
                return hashlib.sha256(content).hexdigest()
        except OSError:
            return ""

    def _get_cache_file_path(self, file_path: str) -> Path:
        """Get cache file path for analysis results."""
        # Convert absolute path to relative path for cache storage
        try:
            relative_path = Path(file_path).relative_to(self.project_path)
        except ValueError:
            # File is outside project, use absolute path hash
            path_hash = hashlib.md5(file_path.encode()).hexdigest()[:16]
            relative_path = Path(f"external_{path_hash}")

        return self.cache_path / "analysis" / f"{relative_path}.json"

    async def get_cached_analysis(self, file_path: str) -> dict[str, Any] | None:
        """Get cached analysis for a file if still valid.
        
        Args:
            file_path: Absolute path to the file
            
        Returns:
            Cached analysis result or None if not available/invalid
        """
        # Check if file has changed
        current_hash = self._get_file_hash(file_path)
        if not current_hash:
            return None

        cached_hash = self.file_hashes.get(file_path)
        if cached_hash != current_hash:
            # File has changed, invalidate cache
            await self._invalidate_file_cache(file_path)
            self.cache_stats["cache_misses"] += 1
            return None

        # Check for cached analysis file
        cache_file = self._get_cache_file_path(file_path)
        if not cache_file.exists():
            self.cache_stats["cache_misses"] += 1
            return None

        try:
            with cache_file.open() as f:
                data = json.load(f)

            # Validate cache data structure
            if not isinstance(data, dict) or "analysis" not in data:
                self.cache_stats["cache_misses"] += 1
                return None

            # Update access time
            data["last_accessed"] = datetime.utcnow().isoformat()
            data["access_count"] = data.get("access_count", 0) + 1

            # Save updated metadata
            with cache_file.open("w") as f:
                json.dump(data, f, indent=2)

            self.cache_stats["cache_hits"] += 1
            logger.debug("Cache hit", file_path=file_path,
                        access_count=data["access_count"])

            return data["analysis"]

        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to read cache file",
                          cache_file=str(cache_file), error=str(e))
            self.cache_stats["cache_misses"] += 1
            return None

    async def cache_analysis_result(
        self,
        file_path: str,
        analysis_result: dict[str, Any],
        template_id: str,
    ) -> bool:
        """Cache analysis result for a file.
        
        Args:
            file_path: Absolute path to the analyzed file
            analysis_result: Analysis result to cache
            template_id: Template used for analysis
            
        Returns:
            True if successfully cached, False otherwise
        """
        try:
            # Get current file hash
            current_hash = self._get_file_hash(file_path)
            if not current_hash:
                return False

            # Create cache entry
            cache_data = {
                "file_path": file_path,
                "content_hash": current_hash,
                "template_id": template_id,
                "analysis": analysis_result,
                "cached_at": datetime.utcnow().isoformat(),
                "last_accessed": datetime.utcnow().isoformat(),
                "access_count": 0,
                "cache_version": "1.0",
            }

            # Save to cache file
            cache_file = self._get_cache_file_path(file_path)
            cache_file.parent.mkdir(parents=True, exist_ok=True)

            # Atomic write using temporary file
            temp_file = cache_file.with_suffix(".tmp")
            with temp_file.open("w") as f:
                json.dump(cache_data, f, indent=2)
            temp_file.rename(cache_file)

            # Update hash tracking
            self.file_hashes[file_path] = current_hash
            self.cached_files.add(file_path)
            await self._save_file_hashes()

            # Update statistics
            self.cache_stats["files_cached"] += 1

            # Also update .treesummary symbols file
            await self._update_treesummary_symbol(file_path, analysis_result)

            logger.debug("Analysis cached", file_path=file_path,
                        template_id=template_id)

            return True

        except (OSError, json.JSONEncodeError) as e:
            logger.error("Failed to cache analysis",
                        file_path=file_path, error=str(e))
            return False

    async def _update_treesummary_symbol(self, file_path: str, analysis_result: dict[str, Any]):
        """Update .treesummary symbols file with analysis result."""
        try:
            relative_path = Path(file_path).relative_to(self.project_path)
            symbol_file = self.symbols_path / f"{relative_path}.json"

            # Ensure parent directories exist
            symbol_file.parent.mkdir(parents=True, exist_ok=True)

            # Create symbol file data
            symbol_data = {
                **analysis_result,
                "updated_at": datetime.utcnow().isoformat(),
                "relative_path": str(relative_path),
                "cached": True,
            }

            # Atomic write
            temp_file = symbol_file.with_suffix(".tmp")
            with temp_file.open("w") as f:
                json.dump(symbol_data, f, indent=2)
            temp_file.rename(symbol_file)

        except (ValueError, OSError) as e:
            logger.warning("Failed to update treesummary symbol",
                          file_path=file_path, error=str(e))

    async def _invalidate_file_cache(self, file_path: str):
        """Invalidate cache for a specific file."""
        # Remove from tracking
        self.file_hashes.pop(file_path, None)
        self.cached_files.discard(file_path)

        # Remove cache file
        cache_file = self._get_cache_file_path(file_path)
        if cache_file.exists():
            try:
                cache_file.unlink()
            except OSError as e:
                logger.warning("Failed to remove cache file",
                              cache_file=str(cache_file), error=str(e))

        # Update statistics
        self.cache_stats["invalidations"] += 1

        logger.debug("File cache invalidated", file_path=file_path)

    async def invalidate_project_cache(self):
        """Invalidate entire project cache."""
        # Clear in-memory tracking
        self.file_hashes.clear()
        self.cached_files.clear()

        # Remove all cache files
        analysis_dir = self.cache_path / "analysis"
        if analysis_dir.exists():
            for cache_file in analysis_dir.rglob("*.json"):
                try:
                    cache_file.unlink()
                except OSError:
                    pass

        # Clear hash file
        hash_file = self.cache_path / "hashes" / "file_hashes.json"
        if hash_file.exists():
            try:
                hash_file.unlink()
            except OSError:
                pass

        logger.info("Project cache invalidated", project_path=str(self.project_path))

    async def on_file_modified(self, file_path: str):
        """Handle file modification event."""
        if file_path in self.cached_files:
            await self._invalidate_file_cache(file_path)
            self.cache_stats["incremental_updates"] += 1

            logger.debug("File modification detected", file_path=file_path)

    async def on_file_deleted(self, file_path: str):
        """Handle file deletion event."""
        if file_path in self.cached_files:
            await self._invalidate_file_cache(file_path)

            # Also remove from .treesummary symbols
            try:
                relative_path = Path(file_path).relative_to(self.project_path)
                symbol_file = self.symbols_path / f"{relative_path}.json"
                if symbol_file.exists():
                    symbol_file.unlink()
            except (ValueError, OSError):
                pass

            logger.debug("File deletion detected", file_path=file_path)

    async def cleanup_expired_cache(self, max_age_days: int = 7):
        """Clean up expired cache entries."""
        from datetime import timedelta

        cutoff_time = datetime.utcnow() - timedelta(days=max_age_days)
        expired_files = []

        analysis_dir = self.cache_path / "analysis"
        if analysis_dir.exists():
            for cache_file in analysis_dir.rglob("*.json"):
                try:
                    # Check file modification time
                    mtime = datetime.fromtimestamp(cache_file.stat().st_mtime)
                    if mtime < cutoff_time:
                        cache_file.unlink()
                        expired_files.append(str(cache_file))
                except OSError:
                    continue

        logger.info("Cache cleanup completed",
                   expired_files=len(expired_files),
                   cutoff_days=max_age_days)

    def get_cache_statistics(self) -> dict[str, Any]:
        """Get comprehensive cache statistics."""
        total_requests = self.cache_stats["cache_hits"] + self.cache_stats["cache_misses"]
        hit_rate = (self.cache_stats["cache_hits"] / total_requests * 100) if total_requests > 0 else 0

        # Calculate cache size
        cache_size_bytes = 0
        analysis_dir = self.cache_path / "analysis"
        if analysis_dir.exists():
            for cache_file in analysis_dir.rglob("*.json"):
                try:
                    cache_size_bytes += cache_file.stat().st_size
                except OSError:
                    continue

        return {
            "hit_rate_percent": round(hit_rate, 2),
            "cache_size_mb": round(cache_size_bytes / (1024 * 1024), 2),
            "cached_files_count": len(self.cached_files),
            "project_path": str(self.project_path),
            **self.cache_stats,
        }

    async def shutdown(self):
        """Shutdown file cache system."""
        if self.observer:
            self.observer.stop()
            self.observer.join()

        await self._save_file_hashes()

        logger.info("FileAnalysisCache shutdown complete")


class CacheFileSystemEventHandler(FileSystemEventHandler):
    """File system event handler for cache invalidation."""

    def __init__(self, file_cache: FileAnalysisCache):
        self.file_cache = file_cache

        # File extensions to monitor
        self.monitored_extensions = {
            ".py", ".js", ".ts", ".jsx", ".tsx", ".vue", ".svelte",
            ".java", ".cpp", ".c", ".h", ".hpp", ".cs", ".php",
            ".rb", ".go", ".rs", ".kt", ".swift", ".dart",
        }

    def _should_monitor_file(self, file_path: str) -> bool:
        """Check if file should be monitored for changes."""
        path = Path(file_path)

        # Skip hidden files and directories
        if any(part.startswith(".") for part in path.parts):
            return False

        # Skip cache directories
        if ".treesummary" in str(path) or "node_modules" in str(path):
            return False

        # Check extension
        return path.suffix.lower() in self.monitored_extensions

    def on_modified(self, event):
        if not event.is_directory and self._should_monitor_file(event.src_path):
            asyncio.create_task(self.file_cache.on_file_modified(event.src_path))

    def on_deleted(self, event):
        if not event.is_directory and self._should_monitor_file(event.src_path):
            asyncio.create_task(self.file_cache.on_file_deleted(event.src_path))
