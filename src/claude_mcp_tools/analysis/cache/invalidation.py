"""Cache invalidation strategies for AgentTreeGraph integration.

Implements sophisticated cache invalidation patterns to maintain data consistency
while maximizing cache hit rates and token savings.
"""

from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


class InvalidationTrigger(Enum):
    """Types of cache invalidation triggers."""
    FILE_MODIFIED = "file_modified"
    FILE_DELETED = "file_deleted"
    FILE_RENAMED = "file_renamed"
    DEPENDENCY_CHANGED = "dependency_changed"
    TEMPLATE_UPDATED = "template_updated"
    MANUAL = "manual"
    SCHEDULED = "scheduled"
    SIZE_LIMIT = "size_limit"


class InvalidationScope(Enum):
    """Scope of cache invalidation."""
    SINGLE_FILE = "single_file"
    FILE_DEPENDENCIES = "file_dependencies"
    DIRECTORY = "directory"
    PROJECT = "project"
    TEMPLATE_GLOBAL = "template_global"


class CacheInvalidationStrategy:
    """Advanced cache invalidation with dependency tracking."""

    def __init__(self, cache_manager, file_cache):
        self.cache_manager = cache_manager
        self.file_cache = file_cache

        # Dependency tracking
        self.file_dependencies: dict[str, set[str]] = {}  # file -> dependencies
        self.reverse_dependencies: dict[str, set[str]] = {}  # file -> dependents

        # Invalidation history
        self.invalidation_log: list[dict[str, Any]] = []

        # Strategy configuration
        self.config = {
            "max_invalidation_batch_size": 100,
            "dependency_depth_limit": 5,
            "age_based_cleanup_days": 7,
            "size_based_cleanup_mb": 500,
            "template_cache_ttl_hours": 24,
        }

    async def track_file_dependencies(self, file_path: str, dependencies: list[str]):
        """Track dependencies for a file to enable cascade invalidation.
        
        Args:
            file_path: Path to the file
            dependencies: List of files this file depends on
        """
        # Clear existing dependencies
        old_deps = self.file_dependencies.get(file_path, set())
        for dep in old_deps:
            self.reverse_dependencies.get(dep, set()).discard(file_path)

        # Track new dependencies
        self.file_dependencies[file_path] = set(dependencies)

        # Update reverse dependencies
        for dep in dependencies:
            if dep not in self.reverse_dependencies:
                self.reverse_dependencies[dep] = set()
            self.reverse_dependencies[dep].add(file_path)

        logger.debug("File dependencies tracked",
                    file_path=file_path,
                    dependencies=len(dependencies))

    async def invalidate_file(
        self,
        file_path: str,
        trigger: InvalidationTrigger,
        scope: InvalidationScope = InvalidationScope.FILE_DEPENDENCIES,
        cascade: bool = True,
    ) -> dict[str, Any]:
        """Invalidate cache for a file with optional cascade.
        
        Args:
            file_path: Path to the file
            trigger: What triggered the invalidation
            scope: Scope of invalidation
            cascade: Whether to cascade to dependent files
            
        Returns:
            Invalidation result summary
        """
        start_time = datetime.utcnow()
        invalidated_files = set()

        try:
            # Always invalidate the target file
            await self._invalidate_single_file(file_path)
            invalidated_files.add(file_path)

            # Handle different scopes
            if scope == InvalidationScope.FILE_DEPENDENCIES and cascade:
                # Cascade to dependent files
                dependents = await self._get_cascade_dependents(file_path)
                for dependent in dependents:
                    await self._invalidate_single_file(dependent)
                    invalidated_files.add(dependent)

            elif scope == InvalidationScope.DIRECTORY:
                # Invalidate entire directory
                directory_files = await self._get_directory_files(file_path)
                for dir_file in directory_files:
                    await self._invalidate_single_file(dir_file)
                    invalidated_files.add(dir_file)

            elif scope == InvalidationScope.PROJECT:
                # Invalidate entire project
                await self.file_cache.invalidate_project_cache()
                invalidated_files.add("*")  # Represents all files

            # Log invalidation
            log_entry = {
                "timestamp": start_time.isoformat(),
                "trigger": trigger.value,
                "scope": scope.value,
                "target_file": file_path,
                "invalidated_files": list(invalidated_files),
                "count": len(invalidated_files),
                "duration_ms": (datetime.utcnow() - start_time).total_seconds() * 1000,
            }

            self.invalidation_log.append(log_entry)

            # Keep log size manageable
            if len(self.invalidation_log) > 1000:
                self.invalidation_log = self.invalidation_log[-500:]

            logger.info("Cache invalidation completed",
                       file_path=file_path,
                       trigger=trigger.value,
                       scope=scope.value,
                       invalidated_count=len(invalidated_files))

            return {
                "success": True,
                "invalidated_files": list(invalidated_files),
                "count": len(invalidated_files),
                "duration_ms": log_entry["duration_ms"],
            }

        except Exception as e:
            logger.error("Cache invalidation failed",
                        file_path=file_path,
                        trigger=trigger.value,
                        error=str(e))

            return {
                "success": False,
                "error": str(e),
                "invalidated_files": list(invalidated_files),
            }

    async def _invalidate_single_file(self, file_path: str):
        """Invalidate cache for a single file."""
        # Invalidate in file cache
        await self.file_cache._invalidate_file_cache(file_path)

        # Invalidate in main cache manager
        await self.cache_manager.invalidate_file_cache(file_path)

    async def _get_cascade_dependents(
        self,
        file_path: str,
        visited: set[str] | None = None,
        depth: int = 0,
    ) -> set[str]:
        """Get all files that depend on this file (recursive)."""
        if visited is None:
            visited = set()

        if depth > self.config["dependency_depth_limit"] or file_path in visited:
            return set()

        visited.add(file_path)
        dependents = set()

        # Direct dependents
        direct_dependents = self.reverse_dependencies.get(file_path, set())
        dependents.update(direct_dependents)

        # Recursive dependents
        for dependent in direct_dependents:
            if dependent not in visited:
                recursive_deps = await self._get_cascade_dependents(
                    dependent, visited.copy(), depth + 1,
                )
                dependents.update(recursive_deps)

        return dependents

    async def _get_directory_files(self, file_path: str) -> list[str]:
        """Get all cached files in the same directory."""
        directory = Path(file_path).parent
        directory_files = []

        for cached_file in self.file_cache.cached_files:
            if Path(cached_file).parent == directory:
                directory_files.append(cached_file)

        return directory_files

    async def invalidate_by_template(
        self,
        template_id: str,
        cascade: bool = False,
    ) -> dict[str, Any]:
        """Invalidate all cache entries using a specific template.
        
        Args:
            template_id: Template identifier
            cascade: Whether to cascade to dependent files
            
        Returns:
            Invalidation result summary
        """
        start_time = datetime.utcnow()
        invalidated_files = set()

        try:
            # Find all cache entries using this template
            template_files = await self._find_files_by_template(template_id)

            for file_path in template_files:
                if cascade:
                    result = await self.invalidate_file(
                        file_path,
                        InvalidationTrigger.TEMPLATE_UPDATED,
                        InvalidationScope.FILE_DEPENDENCIES,
                    )
                    invalidated_files.update(result.get("invalidated_files", []))
                else:
                    await self._invalidate_single_file(file_path)
                    invalidated_files.add(file_path)

            logger.info("Template-based invalidation completed",
                       template_id=template_id,
                       invalidated_count=len(invalidated_files))

            return {
                "success": True,
                "template_id": template_id,
                "invalidated_files": list(invalidated_files),
                "count": len(invalidated_files),
                "duration_ms": (datetime.utcnow() - start_time).total_seconds() * 1000,
            }

        except Exception as e:
            logger.error("Template invalidation failed",
                        template_id=template_id,
                        error=str(e))

            return {
                "success": False,
                "error": str(e),
                "template_id": template_id,
            }

    async def _find_files_by_template(self, template_id: str) -> list[str]:
        """Find all files that have cached analysis using a specific template."""
        template_files = []

        # Check file cache
        analysis_dir = self.file_cache.cache_path / "analysis"
        if analysis_dir.exists():
            import json
            for cache_file in analysis_dir.rglob("*.json"):
                try:
                    with cache_file.open() as f:
                        data = json.load(f)

                    if data.get("template_id") == template_id:
                        template_files.append(data.get("file_path"))

                except (json.JSONDecodeError, OSError):
                    continue

        return template_files

    async def age_based_cleanup(self, max_age_days: int | None = None) -> dict[str, Any]:
        """Clean up cache entries based on age.
        
        Args:
            max_age_days: Maximum age in days (uses config default if None)
            
        Returns:
            Cleanup result summary
        """
        if max_age_days is None:
            max_age_days = self.config["age_based_cleanup_days"]

        start_time = datetime.utcnow()
        cutoff_time = start_time - timedelta(days=max_age_days)

        try:
            # Clean file cache
            await self.file_cache.cleanup_expired_cache(max_age_days)

            # Clean main cache
            await self.cache_manager.cleanup_expired_entries(max_age_days)

            # Clean invalidation log
            self.invalidation_log = [
                entry for entry in self.invalidation_log
                if datetime.fromisoformat(entry["timestamp"]) > cutoff_time
            ]

            logger.info("Age-based cleanup completed",
                       max_age_days=max_age_days,
                       cutoff_time=cutoff_time.isoformat())

            return {
                "success": True,
                "max_age_days": max_age_days,
                "cutoff_time": cutoff_time.isoformat(),
                "duration_ms": (datetime.utcnow() - start_time).total_seconds() * 1000,
            }

        except Exception as e:
            logger.error("Age-based cleanup failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
            }

    async def size_based_cleanup(self, max_size_mb: int | None = None) -> dict[str, Any]:
        """Clean up cache entries based on size limits.
        
        Args:
            max_size_mb: Maximum cache size in MB
            
        Returns:
            Cleanup result summary
        """
        if max_size_mb is None:
            max_size_mb = self.config["size_based_cleanup_mb"]

        start_time = datetime.utcnow()

        try:
            # Get current cache size
            stats = self.file_cache.get_cache_statistics()
            current_size_mb = stats.get("cache_size_mb", 0)

            if current_size_mb <= max_size_mb:
                return {
                    "success": True,
                    "action": "no_cleanup_needed",
                    "current_size_mb": current_size_mb,
                    "max_size_mb": max_size_mb,
                }

            # Find least recently used cache files
            cache_files = await self._get_cache_files_by_usage()

            removed_count = 0
            freed_mb = 0.0

            for cache_file_info in cache_files:
                if current_size_mb - freed_mb <= max_size_mb:
                    break

                file_path = cache_file_info["file_path"]
                file_size_mb = cache_file_info["size_mb"]

                await self._invalidate_single_file(file_path)
                removed_count += 1
                freed_mb += file_size_mb

            logger.info("Size-based cleanup completed",
                       removed_files=removed_count,
                       freed_mb=round(freed_mb, 2),
                       max_size_mb=max_size_mb)

            return {
                "success": True,
                "removed_files": removed_count,
                "freed_mb": round(freed_mb, 2),
                "current_size_mb": round(current_size_mb - freed_mb, 2),
                "max_size_mb": max_size_mb,
                "duration_ms": (datetime.utcnow() - start_time).total_seconds() * 1000,
            }

        except Exception as e:
            logger.error("Size-based cleanup failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
            }

    async def _get_cache_files_by_usage(self) -> list[dict[str, Any]]:
        """Get cache files sorted by usage (least recently used first)."""
        cache_files = []
        analysis_dir = self.file_cache.cache_path / "analysis"

        if analysis_dir.exists():
            import json
            for cache_file in analysis_dir.rglob("*.json"):
                try:
                    with cache_file.open() as f:
                        data = json.load(f)

                    last_accessed = data.get("last_accessed")
                    access_count = data.get("access_count", 0)
                    file_size = cache_file.stat().st_size

                    cache_files.append({
                        "file_path": data.get("file_path"),
                        "last_accessed": last_accessed,
                        "access_count": access_count,
                        "size_mb": file_size / (1024 * 1024),
                        "cache_file": str(cache_file),
                    })

                except (json.JSONDecodeError, OSError):
                    continue

        # Sort by usage (access count, then by last accessed time)
        cache_files.sort(key=lambda x: (x["access_count"], x["last_accessed"] or ""))

        return cache_files

    async def get_invalidation_statistics(self) -> dict[str, Any]:
        """Get comprehensive invalidation statistics."""
        recent_log = [
            entry for entry in self.invalidation_log
            if datetime.fromisoformat(entry["timestamp"]) > datetime.utcnow() - timedelta(hours=24)
        ]

        trigger_counts = {}
        scope_counts = {}

        for entry in recent_log:
            trigger = entry["trigger"]
            scope = entry["scope"]

            trigger_counts[trigger] = trigger_counts.get(trigger, 0) + 1
            scope_counts[scope] = scope_counts.get(scope, 0) + 1

        return {
            "total_invalidations_24h": len(recent_log),
            "total_invalidations_all_time": len(self.invalidation_log),
            "trigger_breakdown": trigger_counts,
            "scope_breakdown": scope_counts,
            "tracked_dependencies": len(self.file_dependencies),
            "reverse_dependencies": len(self.reverse_dependencies),
            "config": self.config,
        }

    async def optimize_invalidation_strategy(self) -> dict[str, Any]:
        """Analyze invalidation patterns and optimize strategy."""
        stats = await self.get_invalidation_statistics()

        recommendations = []

        # Analyze trigger patterns
        trigger_counts = stats.get("trigger_breakdown", {})
        total_invalidations = sum(trigger_counts.values())

        if total_invalidations > 0:
            file_mod_percent = (trigger_counts.get("file_modified", 0) / total_invalidations) * 100

            if file_mod_percent > 80:
                recommendations.append({
                    "type": "reduce_file_watching_sensitivity",
                    "reason": f"High file modification invalidations ({file_mod_percent:.1f}%)",
                    "suggestion": "Consider debouncing file change events",
                })

        # Check dependency depth
        if stats["tracked_dependencies"] > 1000:
            recommendations.append({
                "type": "optimize_dependency_tracking",
                "reason": f"Large dependency graph ({stats['tracked_dependencies']} files)",
                "suggestion": "Consider limiting dependency depth or using sampling",
            })

        return {
            "analysis_timestamp": datetime.utcnow().isoformat(),
            "current_performance": stats,
            "recommendations": recommendations,
            "optimized_config": self._get_optimized_config(stats),
        }

    def _get_optimized_config(self, stats: dict[str, Any]) -> dict[str, Any]:
        """Generate optimized configuration based on usage patterns."""
        optimized = self.config.copy()

        # Adjust batch size based on invalidation frequency
        recent_invalidations = stats.get("total_invalidations_24h", 0)
        if recent_invalidations > 100:
            optimized["max_invalidation_batch_size"] = min(200, optimized["max_invalidation_batch_size"] * 2)
        elif recent_invalidations < 10:
            optimized["max_invalidation_batch_size"] = max(50, optimized["max_invalidation_batch_size"] // 2)

        # Adjust dependency depth based on graph size
        dependency_count = stats.get("tracked_dependencies", 0)
        if dependency_count > 500:
            optimized["dependency_depth_limit"] = min(3, optimized["dependency_depth_limit"])
        elif dependency_count < 100:
            optimized["dependency_depth_limit"] = max(7, optimized["dependency_depth_limit"])

        return optimized

    async def apply_optimized_config(self, config: dict[str, Any]):
        """Apply optimized configuration."""
        self.config.update(config)

        logger.info("Invalidation strategy optimized", new_config=self.config)

    async def shutdown(self):
        """Shutdown invalidation system."""
        # Save invalidation log if needed
        log_file = self.file_cache.cache_path / "metadata" / "invalidation_log.json"

        try:
            import json
            with log_file.open("w") as f:
                json.dump({
                    "invalidation_log": self.invalidation_log[-100:],  # Keep last 100 entries
                    "file_dependencies": {k: list(v) for k, v in self.file_dependencies.items()},
                    "reverse_dependencies": {k: list(v) for k, v in self.reverse_dependencies.items()},
                }, f, indent=2)
        except Exception as e:
            logger.warning("Failed to save invalidation log", error=str(e))

        logger.info("CacheInvalidationStrategy shutdown complete")
