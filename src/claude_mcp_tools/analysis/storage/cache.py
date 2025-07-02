"""Cache management for AgentTreeGraph analysis results.

Provides intelligent caching for analysis results, prompt responses, and
computed data to optimize performance and reduce redundant processing.
"""

import asyncio
import gzip
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import aiofiles
import structlog

logger = structlog.get_logger()


class CacheManager:
    """Manages intelligent caching for analysis data and results."""

    def __init__(self, cache_root: Path | None = None):
        """Initialize cache manager.
        
        Args:
            cache_root: Root cache directory (defaults to ~/.claude/zmcptools/cache)
        """
        self.cache_root = cache_root or (Path.home() / ".claude" / "zmcptools" / "cache")
        self.analysis_cache = self.cache_root / "analysis"
        self.prompt_cache = self.cache_root / "prompts"
        self.result_cache = self.cache_root / "results"

        # Ensure cache directories exist
        for cache_dir in [self.analysis_cache, self.prompt_cache, self.result_cache]:
            cache_dir.mkdir(parents=True, exist_ok=True)

        # Cache configuration
        self.config = {
            "max_cache_size_mb": 1000,
            "default_ttl_hours": 24,
            "prompt_cache_ttl_hours": 168,  # 1 week for prompts
            "compression_threshold_kb": 10,
            "cleanup_interval_hours": 6,
        }

        # In-memory cache for frequently accessed items
        self._memory_cache: dict[str, tuple[Any, datetime]] = {}
        self._memory_cache_size = 0
        self._max_memory_cache_mb = 50

        # Lock for cache operations
        self._cache_lock = asyncio.Lock()

    def _get_cache_key(self, *args, **kwargs) -> str:
        """Generate cache key from arguments."""
        # Create deterministic key from arguments
        key_data = {
            "args": args,
            "kwargs": sorted(kwargs.items()) if kwargs else {},
        }
        key_string = json.dumps(key_data, sort_keys=True, default=str)
        return hashlib.sha256(key_string.encode()).hexdigest()

    def _should_compress(self, data_size: int) -> bool:
        """Determine if data should be compressed."""
        return data_size > (self.config["compression_threshold_kb"] * 1024)

    async def _write_cache_file(self, file_path: Path, data: Any, compress: bool = False) -> bool:
        """Write data to cache file with optional compression."""
        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)

            # Prepare data for storage
            cache_entry = {
                "data": data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "compressed": compress,
            }

            json_data = json.dumps(cache_entry, default=str)

            if compress:
                # Write compressed
                async with aiofiles.open(file_path.with_suffix(".gz"), "wb") as f:
                    compressed_data = gzip.compress(json_data.encode())
                    await f.write(compressed_data)
            else:
                # Write uncompressed
                async with aiofiles.open(file_path, "w") as f:
                    await f.write(json_data)

            return True

        except Exception as e:
            logger.error(f"Failed to write cache file: {e}", file_path=str(file_path))
            return False

    async def _read_cache_file(self, file_path: Path) -> tuple[Any, datetime] | None:
        """Read data from cache file."""
        try:
            # Check for compressed version first
            compressed_path = file_path.with_suffix(".gz")
            if compressed_path.exists():
                async with aiofiles.open(compressed_path, "rb") as f:
                    compressed_data = await f.read()
                    json_data = gzip.decompress(compressed_data).decode()
            elif file_path.exists():
                async with aiofiles.open(file_path) as f:
                    json_data = await f.read()
            else:
                return None

            cache_entry = json.loads(json_data)
            timestamp = datetime.fromisoformat(cache_entry["timestamp"])

            return cache_entry["data"], timestamp

        except Exception as e:
            logger.error(f"Failed to read cache file: {e}", file_path=str(file_path))
            return None

    async def _is_cache_valid(self, timestamp: datetime, ttl_hours: int) -> bool:
        """Check if cache entry is still valid."""
        expiry_time = timestamp + timedelta(hours=ttl_hours)
        return datetime.now(timezone.utc) < expiry_time

    async def cache_analysis_result(
        self,
        file_path: str,
        file_hash: str,
        analysis_data: dict[str, Any],
        ttl_hours: int | None = None,
    ) -> bool:
        """Cache analysis result for a file.
        
        Args:
            file_path: Path to analyzed file
            file_hash: Hash of file content for invalidation
            analysis_data: Analysis results to cache
            ttl_hours: Time to live in hours (defaults to config)
            
        Returns:
            Success status
        """
        async with self._cache_lock:
            try:
                cache_key = self._get_cache_key("analysis", file_path, file_hash)
                cache_file = self.analysis_cache / f"{cache_key}.json"

                # Add cache metadata
                cached_data = {
                    "file_path": file_path,
                    "file_hash": file_hash,
                    "analysis": analysis_data,
                    "cached_at": datetime.now(timezone.utc).isoformat(),
                    "ttl_hours": ttl_hours or self.config["default_ttl_hours"],
                }

                # Determine if compression is needed
                data_size = len(json.dumps(cached_data, default=str).encode())
                compress = self._should_compress(data_size)

                success = await self._write_cache_file(cache_file, cached_data, compress)

                if success:
                    # Add to memory cache if small enough
                    if data_size < (1024 * 1024):  # 1MB threshold
                        self._memory_cache[cache_key] = (cached_data, datetime.now(timezone.utc))
                        self._memory_cache_size += data_size
                        await self._cleanup_memory_cache()

                return success

            except Exception as e:
                logger.error(f"Failed to cache analysis result: {e}", file_path=file_path)
                return False

    async def get_cached_analysis(
        self,
        file_path: str,
        file_hash: str,
        ttl_hours: int | None = None,
    ) -> dict[str, Any] | None:
        """Retrieve cached analysis result.
        
        Args:
            file_path: Path to analyzed file
            file_hash: Current hash of file content
            ttl_hours: Custom TTL for validation
            
        Returns:
            Cached analysis data or None if not found/invalid
        """
        try:
            cache_key = self._get_cache_key("analysis", file_path, file_hash)

            # Check memory cache first
            if cache_key in self._memory_cache:
                cached_data, timestamp = self._memory_cache[cache_key]
                ttl = ttl_hours or cached_data.get("ttl_hours", self.config["default_ttl_hours"])

                if await self._is_cache_valid(timestamp, ttl):
                    return cached_data["analysis"]
                # Remove expired entry
                del self._memory_cache[cache_key]

            # Check disk cache
            cache_file = self.analysis_cache / f"{cache_key}.json"
            cache_result = await self._read_cache_file(cache_file)

            if cache_result:
                cached_data, timestamp = cache_result
                ttl = ttl_hours or cached_data.get("ttl_hours", self.config["default_ttl_hours"])

                # Verify file hash matches (for invalidation)
                if cached_data.get("file_hash") != file_hash:
                    logger.debug("Cache invalidated due to file hash mismatch", file_path=file_path)
                    return None

                if await self._is_cache_valid(timestamp, ttl):
                    # Add back to memory cache
                    self._memory_cache[cache_key] = (cached_data, timestamp)
                    return cached_data["analysis"]
                # Remove expired file
                try:
                    cache_file.unlink()
                    if cache_file.with_suffix(".gz").exists():
                        cache_file.with_suffix(".gz").unlink()
                except OSError:
                    pass

            return None

        except Exception as e:
            logger.error(f"Failed to retrieve cached analysis: {e}", file_path=file_path)
            return None

    async def cache_prompt_response(
        self,
        prompt_hash: str,
        response_data: Any,
        model: str = "unknown",
        ttl_hours: int | None = None,
    ) -> bool:
        """Cache LLM prompt response for reuse.
        
        Args:
            prompt_hash: Hash of the prompt for caching
            response_data: LLM response to cache
            model: Model used for response
            ttl_hours: Time to live (defaults to prompt cache TTL)
            
        Returns:
            Success status
        """
        async with self._cache_lock:
            try:
                cache_key = self._get_cache_key("prompt", prompt_hash, model)
                cache_file = self.prompt_cache / f"{cache_key}.json"

                cached_data = {
                    "prompt_hash": prompt_hash,
                    "model": model,
                    "response": response_data,
                    "cached_at": datetime.now(timezone.utc).isoformat(),
                    "ttl_hours": ttl_hours or self.config["prompt_cache_ttl_hours"],
                }

                data_size = len(json.dumps(cached_data, default=str).encode())
                compress = self._should_compress(data_size)

                return await self._write_cache_file(cache_file, cached_data, compress)

            except Exception as e:
                logger.error(f"Failed to cache prompt response: {e}", prompt_hash=prompt_hash)
                return False

    async def get_cached_prompt_response(
        self,
        prompt_hash: str,
        model: str = "unknown",
        ttl_hours: int | None = None,
    ) -> Any | None:
        """Retrieve cached prompt response.
        
        Args:
            prompt_hash: Hash of the prompt
            model: Model used for original response
            ttl_hours: Custom TTL for validation
            
        Returns:
            Cached response or None if not found/invalid
        """
        try:
            cache_key = self._get_cache_key("prompt", prompt_hash, model)
            cache_file = self.prompt_cache / f"{cache_key}.json"

            cache_result = await self._read_cache_file(cache_file)
            if cache_result:
                cached_data, timestamp = cache_result
                ttl = ttl_hours or cached_data.get("ttl_hours", self.config["prompt_cache_ttl_hours"])

                if await self._is_cache_valid(timestamp, ttl):
                    return cached_data["response"]
                # Remove expired file
                try:
                    cache_file.unlink()
                    if cache_file.with_suffix(".gz").exists():
                        cache_file.with_suffix(".gz").unlink()
                except OSError:
                    pass

            return None

        except Exception as e:
            logger.error(f"Failed to retrieve cached prompt response: {e}", prompt_hash=prompt_hash)
            return None

    async def invalidate_file_cache(self, file_path: str) -> int:
        """Invalidate all cache entries for a specific file.
        
        Args:
            file_path: Path to file whose cache should be invalidated
            
        Returns:
            Number of cache entries removed
        """
        removed_count = 0

        try:
            # Find and remove analysis cache entries
            for cache_file in self.analysis_cache.glob("*.json*"):
                try:
                    cache_result = await self._read_cache_file(cache_file)
                    if cache_result:
                        cached_data, _ = cache_result
                        if cached_data.get("file_path") == file_path:
                            cache_file.unlink()
                            if cache_file.with_suffix(".gz").exists():
                                cache_file.with_suffix(".gz").unlink()
                            removed_count += 1
                except (OSError, json.JSONDecodeError):
                    continue

            # Remove from memory cache
            keys_to_remove = []
            for cache_key, (cached_data, _) in self._memory_cache.items():
                if cached_data.get("file_path") == file_path:
                    keys_to_remove.append(cache_key)

            for key in keys_to_remove:
                del self._memory_cache[key]
                removed_count += 1

            logger.debug(f"Invalidated {removed_count} cache entries", file_path=file_path)

        except Exception as e:
            logger.error(f"Failed to invalidate file cache: {e}", file_path=file_path)

        return removed_count

    async def cleanup_expired_cache(self) -> dict[str, int]:
        """Remove expired cache entries.
        
        Returns:
            Cleanup statistics
        """
        stats = {
            "analysis_removed": 0,
            "prompt_removed": 0,
            "result_removed": 0,
            "space_freed_mb": 0.0,
        }

        async with self._cache_lock:
            try:
                current_time = datetime.now(timezone.utc)

                # Clean analysis cache
                for cache_file in self.analysis_cache.glob("*.json*"):
                    try:
                        cache_result = await self._read_cache_file(cache_file)
                        if cache_result:
                            cached_data, timestamp = cache_result
                            ttl = cached_data.get("ttl_hours", self.config["default_ttl_hours"])

                            if not await self._is_cache_valid(timestamp, ttl):
                                size_mb = cache_file.stat().st_size / (1024 * 1024)
                                cache_file.unlink()
                                if cache_file.with_suffix(".gz").exists():
                                    size_mb += cache_file.with_suffix(".gz").stat().st_size / (1024 * 1024)
                                    cache_file.with_suffix(".gz").unlink()

                                stats["analysis_removed"] += 1
                                stats["space_freed_mb"] += size_mb
                    except (OSError, json.JSONDecodeError):
                        continue

                # Clean prompt cache
                for cache_file in self.prompt_cache.glob("*.json*"):
                    try:
                        cache_result = await self._read_cache_file(cache_file)
                        if cache_result:
                            cached_data, timestamp = cache_result
                            ttl = cached_data.get("ttl_hours", self.config["prompt_cache_ttl_hours"])

                            if not await self._is_cache_valid(timestamp, ttl):
                                size_mb = cache_file.stat().st_size / (1024 * 1024)
                                cache_file.unlink()
                                if cache_file.with_suffix(".gz").exists():
                                    size_mb += cache_file.with_suffix(".gz").stat().st_size / (1024 * 1024)
                                    cache_file.with_suffix(".gz").unlink()

                                stats["prompt_removed"] += 1
                                stats["space_freed_mb"] += size_mb
                    except (OSError, json.JSONDecodeError):
                        continue

                # Clean memory cache
                expired_keys = []
                for cache_key, (cached_data, timestamp) in self._memory_cache.items():
                    ttl = cached_data.get("ttl_hours", self.config["default_ttl_hours"])
                    if not await self._is_cache_valid(timestamp, ttl):
                        expired_keys.append(cache_key)

                for key in expired_keys:
                    del self._memory_cache[key]

                logger.info(
                    "Cache cleanup completed",
                    analysis_removed=stats["analysis_removed"],
                    prompt_removed=stats["prompt_removed"],
                    space_freed_mb=stats["space_freed_mb"],
                )

            except Exception as e:
                logger.error(f"Cache cleanup failed: {e}")

        return stats

    async def _cleanup_memory_cache(self):
        """Clean up memory cache if over size limit."""
        current_size_mb = self._memory_cache_size / (1024 * 1024)

        if current_size_mb > self._max_memory_cache_mb:
            # Sort by timestamp (oldest first) and remove until under limit
            sorted_items = sorted(
                self._memory_cache.items(),
                key=lambda x: x[1][1],  # Sort by timestamp
            )

            while current_size_mb > self._max_memory_cache_mb and sorted_items:
                key, (data, _) = sorted_items.pop(0)
                data_size = len(json.dumps(data, default=str).encode())
                del self._memory_cache[key]
                self._memory_cache_size -= data_size
                current_size_mb = self._memory_cache_size / (1024 * 1024)

    async def get_cache_stats(self) -> dict[str, Any]:
        """Get comprehensive cache statistics."""
        stats = {
            "analysis_cache": {"files": 0, "size_mb": 0.0},
            "prompt_cache": {"files": 0, "size_mb": 0.0},
            "result_cache": {"files": 0, "size_mb": 0.0},
            "memory_cache": {
                "entries": len(self._memory_cache),
                "size_mb": self._memory_cache_size / (1024 * 1024),
            },
            "total_size_mb": 0.0,
        }

        # Calculate disk cache statistics
        for cache_type, cache_dir in [
            ("analysis_cache", self.analysis_cache),
            ("prompt_cache", self.prompt_cache),
            ("result_cache", self.result_cache),
        ]:
            for cache_file in cache_dir.glob("*.json*"):
                if cache_file.is_file():
                    stats[cache_type]["files"] += 1
                    stats[cache_type]["size_mb"] += cache_file.stat().st_size / (1024 * 1024)

        stats["total_size_mb"] = sum(
            cache_stats["size_mb"] for cache_stats in stats.values()
            if isinstance(cache_stats, dict) and "size_mb" in cache_stats
        )

        return stats
