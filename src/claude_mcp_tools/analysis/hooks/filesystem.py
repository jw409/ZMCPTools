"""Real-time hook system for .treesummary updates with file watching.

This module provides filesystem watching capabilities that trigger incremental
.treesummary updates when files are created, modified, or deleted.
"""

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any

import structlog

# Optional import for file watching - graceful fallback if not available
try:
    from watchdog.events import FileSystemEventHandler as WatchdogHandler
    from watchdog.observers import Observer
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    Observer = None
    WatchdogHandler = None

from ..core.treesummary import TreeSummaryManager

logger = structlog.get_logger()


class TreeSummaryHook:
    """Hook system for real-time .treesummary updates with file system monitoring."""

    def __init__(self, project_path: str):
        """Initialize the hook system for a project.
        
        Args:
            project_path: Absolute path to the project root
        """
        self.project_path = Path(project_path)
        self.summary_manager = TreeSummaryManager(project_path)
        self.observers: list[Observer] = []
        self.callbacks: dict[str, list[Callable]] = {
            "file_created": [],
            "file_modified": [],
            "file_deleted": [],
            "analysis_complete": [],
            "error": [],
        }
        self.watching = False
        self._file_extensions = {
            ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".cpp", ".c", ".h",
            ".cs", ".php", ".rb", ".go", ".rs", ".swift", ".kt", ".scala",
            ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".md", ".txt",
        }
        self._ignore_patterns = {
            ".git", "__pycache__", "node_modules", ".venv", "venv",
            ".treesummary", "dist", "build", ".pytest_cache", ".coverage",
        }

    def register_callback(self, event_type: str, callback: Callable):
        """Register callback for specific event type.
        
        Args:
            event_type: Type of event (file_created, file_modified, file_deleted, etc.)
            callback: Async or sync function to call when event occurs
        """
        if event_type in self.callbacks:
            self.callbacks[event_type].append(callback)
            logger.debug("Registered callback", event_type=event_type, callback=callback.__name__)
        else:
            logger.warning("Unknown event type for callback", event_type=event_type)

    def unregister_callback(self, event_type: str, callback: Callable):
        """Unregister a callback for specific event type.
        
        Args:
            event_type: Type of event
            callback: Function to unregister
        """
        if event_type in self.callbacks and callback in self.callbacks[event_type]:
            self.callbacks[event_type].remove(callback)
            logger.debug("Unregistered callback", event_type=event_type, callback=callback.__name__)

    async def trigger_callbacks(self, event_type: str, **kwargs):
        """Trigger all callbacks for event type.
        
        Args:
            event_type: Type of event to trigger
            **kwargs: Additional arguments to pass to callbacks
        """
        for callback in self.callbacks.get(event_type, []):
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(**kwargs)
                else:
                    callback(**kwargs)
            except Exception as e:
                logger.error("Hook callback failed",
                           event_type=event_type,
                           callback=callback.__name__,
                           error=str(e))
                await self.trigger_callbacks("error",
                                            event_type=event_type,
                                            callback=callback.__name__,
                                            error=str(e))

    def should_analyze_file(self, file_path: str) -> bool:
        """Determine if a file should be analyzed based on extension and path.
        
        Args:
            file_path: Path to the file
            
        Returns:
            True if file should be analyzed, False otherwise
        """
        path = Path(file_path)

        # Check if file is in ignored directory
        for part in path.parts:
            if part in self._ignore_patterns:
                return False

        # Check file extension
        if path.suffix.lower() not in self._file_extensions:
            return False

        # Check if file is too large (>10MB)
        try:
            if path.exists() and path.stat().st_size > 10 * 1024 * 1024:
                return False
        except OSError:
            return False

        # Check if file is within project bounds
        try:
            path.relative_to(self.project_path)
            return True
        except ValueError:
            return False

    async def on_file_created(self, file_path: str):
        """Handle file creation event.
        
        Args:
            file_path: Path to the created file
        """
        if not self.should_analyze_file(file_path):
            return

        logger.info("File created, triggering analysis", file_path=file_path)

        try:
            # Import analyzer dynamically to avoid circular imports
            from ..parsers.file_analyzer import FileAnalyzer

            analyzer = FileAnalyzer()
            analysis = await analyzer.analyze_file(file_path)

            if analysis:
                success = await self.summary_manager.update_file_analysis(file_path, analysis)
                if success:
                    await self.trigger_callbacks("file_created",
                                                file_path=file_path,
                                                analysis=analysis)
                    await self.trigger_callbacks("analysis_complete",
                                                file_path=file_path,
                                                event_type="created",
                                                success=True)

        except Exception as e:
            logger.error("Failed to analyze created file", file_path=file_path, error=str(e))
            await self.trigger_callbacks("error",
                                        event_type="file_created",
                                        file_path=file_path,
                                        error=str(e))

    async def on_file_modified(self, file_path: str):
        """Handle file modification event.
        
        Args:
            file_path: Path to the modified file
        """
        if not self.should_analyze_file(file_path):
            return

        logger.info("File modified, triggering re-analysis", file_path=file_path)

        try:
            # Import analyzer dynamically to avoid circular imports
            from ..parsers.file_analyzer import FileAnalyzer

            analyzer = FileAnalyzer()
            analysis = await analyzer.analyze_file(file_path)

            if analysis:
                success = await self.summary_manager.update_file_analysis(file_path, analysis)
                if success:
                    await self.trigger_callbacks("file_modified",
                                                file_path=file_path,
                                                analysis=analysis)
                    await self.trigger_callbacks("analysis_complete",
                                                file_path=file_path,
                                                event_type="modified",
                                                success=True)

        except Exception as e:
            logger.error("Failed to re-analyze modified file", file_path=file_path, error=str(e))
            await self.trigger_callbacks("error",
                                        event_type="file_modified",
                                        file_path=file_path,
                                        error=str(e))

    async def on_file_deleted(self, file_path: str):
        """Handle file deletion event.
        
        Args:
            file_path: Path to the deleted file
        """
        # Always try to remove analysis for deleted files
        logger.info("File deleted, removing analysis", file_path=file_path)

        try:
            success = await self.summary_manager.remove_file_analysis(file_path)
            if success:
                await self.trigger_callbacks("file_deleted", file_path=file_path)
                await self.trigger_callbacks("analysis_complete",
                                            file_path=file_path,
                                            event_type="deleted",
                                            success=True)

        except Exception as e:
            logger.error("Failed to remove analysis for deleted file",
                        file_path=file_path, error=str(e))
            await self.trigger_callbacks("error",
                                        event_type="file_deleted",
                                        file_path=file_path,
                                        error=str(e))

    def start_watching(self) -> bool:
        """Start file system monitoring.
        
        Returns:
            True if watching started successfully, False otherwise
        """
        if not WATCHDOG_AVAILABLE:
            logger.warning("Watchdog not available, file watching disabled")
            return False

        if self.watching:
            logger.info("File watching already active")
            return True

        try:
            event_handler = FileSystemEventHandler(self)
            observer = Observer()
            observer.schedule(event_handler, str(self.project_path), recursive=True)
            observer.start()
            self.observers.append(observer)
            self.watching = True

            logger.info("Started file system watching", project_path=str(self.project_path))
            return True

        except Exception as e:
            logger.error("Failed to start file watching", error=str(e))
            return False

    def stop_watching(self):
        """Stop file system monitoring."""
        if not self.watching:
            return

        for observer in self.observers:
            try:
                observer.stop()
                observer.join(timeout=5)
            except Exception as e:
                logger.error("Error stopping observer", error=str(e))

        self.observers.clear()
        self.watching = False
        logger.info("Stopped file system watching", project_path=str(self.project_path))

    def is_watching(self) -> bool:
        """Check if file watching is active.
        
        Returns:
            True if watching is active, False otherwise
        """
        return self.watching

    async def manual_trigger(self, event_type: str, file_path: str):
        """Manually trigger an event for testing or fallback scenarios.
        
        Args:
            event_type: Type of event (created, modified, deleted)
            file_path: Path to the file
        """
        if event_type == "created":
            await self.on_file_created(file_path)
        elif event_type == "modified":
            await self.on_file_modified(file_path)
        elif event_type == "deleted":
            await self.on_file_deleted(file_path)
        else:
            logger.warning("Unknown manual trigger event type", event_type=event_type)

    def get_status(self) -> dict[str, Any]:
        """Get current status of the hook system.
        
        Returns:
            Status information dictionary
        """
        return {
            "watching": self.watching,
            "project_path": str(self.project_path),
            "watchdog_available": WATCHDOG_AVAILABLE,
            "active_observers": len(self.observers),
            "registered_callbacks": {
                event_type: len(callbacks)
                for event_type, callbacks in self.callbacks.items()
            },
            "supported_extensions": sorted(self._file_extensions),
            "ignore_patterns": sorted(self._ignore_patterns),
        }


class FileSystemEventHandler:
    """File system event handler for .treesummary updates."""

    def __init__(self, hook: TreeSummaryHook):
        """Initialize event handler.
        
        Args:
            hook: TreeSummaryHook instance to handle events
        """
        self.hook = hook
        self._pending_events = {}  # For debouncing rapid file changes
        self._debounce_delay = 0.5  # seconds

    def on_created(self, event):
        """Handle file creation events."""
        if not event.is_directory:
            self._schedule_event("created", event.src_path)

    def on_modified(self, event):
        """Handle file modification events."""
        if not event.is_directory:
            self._schedule_event("modified", event.src_path)

    def on_deleted(self, event):
        """Handle file deletion events."""
        if not event.is_directory:
            self._schedule_event("deleted", event.src_path)

    def on_moved(self, event):
        """Handle file move events as delete + create."""
        if not event.is_directory:
            # Treat move as deletion of old path and creation of new path
            self._schedule_event("deleted", event.src_path)
            self._schedule_event("created", event.dest_path)

    def _schedule_event(self, event_type: str, file_path: str):
        """Schedule an event with debouncing to avoid rapid-fire events.
        
        Args:
            event_type: Type of event
            file_path: Path to the file
        """
        # Cancel any pending event for this file
        event_key = (event_type, file_path)
        if event_key in self._pending_events:
            self._pending_events[event_key].cancel()

        # Schedule new event
        loop = asyncio.get_event_loop()
        task = loop.call_later(
            self._debounce_delay,
            self._execute_event,
            event_type,
            file_path,
        )
        self._pending_events[event_key] = task

    def _execute_event(self, event_type: str, file_path: str):
        """Execute the actual event handling.
        
        Args:
            event_type: Type of event
            file_path: Path to the file
        """
        # Remove from pending events
        event_key = (event_type, file_path)
        self._pending_events.pop(event_key, None)

        # Execute the event
        if event_type == "created":
            asyncio.create_task(self.hook.on_file_created(file_path))
        elif event_type == "modified":
            asyncio.create_task(self.hook.on_file_modified(file_path))
        elif event_type == "deleted":
            asyncio.create_task(self.hook.on_file_deleted(file_path))


# If watchdog is not available, create stub classes
if not WATCHDOG_AVAILABLE:
    class FileSystemEventHandler:
        """Stub implementation when watchdog is not available."""

        def __init__(self, hook):
            self.hook = hook
            logger.warning("FileSystemEventHandler stub - watchdog not available")

        def on_created(self, event): pass
        def on_modified(self, event): pass
        def on_deleted(self, event): pass
        def on_moved(self, event): pass
