"""Analysis and file operation tools for project understanding and maintenance."""

from typing import Any

import structlog
from fastmcp import FastMCP

from ...analysis.core.treesummary import TreeSummaryManager
from ...analysis.parsers.file_analyzer import FileAnalyzer
from ...schemas.analysis import (
    AnalyzeFileSymbolsSchema,
    AnalyzeProjectStructureSchema,
    CleanupOrphanedProjectsSchema,
    DetectDeadCodeSchema,
    EasyReplaceAllSchema,
    GenerateProjectSummarySchema,
)

logger = structlog.get_logger("orchestration.tools.analysis")


def register_analysis_tools(app: FastMCP):
    """Register analysis and file operation tools with the FastMCP app."""
    
    @app.tool(
        name="analyze_project_structure",
        description="Generate comprehensive project structure analysis with .treesummary files for AI context optimization",
        tags={"analysis", "project-structure", "ai-context", "treesummary"}
    )
    async def analyze_project_structure(params: AnalyzeProjectStructureSchema) -> dict[str, Any]:
        """Generate comprehensive project structure analysis."""
        try:
            tree_manager = TreeSummaryManager(params.project_path)
            result = await tree_manager.analyze_project_structure(
                include_hidden=params.include_hidden,
                max_depth=params.max_depth,
                file_types=params.file_types,  # Already parsed by Pydantic schema
            )
            return result

        except Exception as e:
            logger.error("Error analyzing project structure", project=params.project_path, error=str(e))
            return {"error": {"code": "ANALYZE_PROJECT_FAILED", "message": str(e)}}

    @app.tool(
        name="generate_project_summary",
        description="Generate AI-optimized project summary with dependencies, metrics, and key insights",
        tags={"analysis", "project-summary", "ai-optimization", "metrics"}
    )
    async def generate_project_summary(params: GenerateProjectSummarySchema) -> dict[str, Any]:
        """Generate AI-optimized project summary."""
        try:
            tree_manager = TreeSummaryManager(params.project_path)
            result = await tree_manager.generate_project_summary(
                include_dependencies=params.include_dependencies,
                include_metrics=params.include_metrics,
                max_file_samples=params.max_file_samples,
            )
            return result

        except Exception as e:
            logger.error("Error generating project summary", project=params.project_path, error=str(e))
            return {"error": {"code": "GENERATE_SUMMARY_FAILED", "message": str(e)}}

    @app.tool(
        name="detect_dead_code",
        description="Detect and report unused code, functions, and imports for code cleanup and optimization",
        tags={"analysis", "dead-code", "cleanup", "optimization"}
    )
    async def detect_dead_code(params: DetectDeadCodeSchema) -> dict[str, Any]:
        """Detect unused code and functions for cleanup."""
        try:
            analyzer = FileAnalyzer(params.project_path)
            result = await analyzer.detect_dead_code(
                file_extensions=params.file_extensions,  # Already parsed by Pydantic schema
                exclude_test_files=params.exclude_test_files,
                confidence_threshold=params.confidence_threshold,
            )
            return result

        except Exception as e:
            logger.error("Error detecting dead code", project=params.project_path, error=str(e))
            return {"error": {"code": "DETECT_DEAD_CODE_FAILED", "message": str(e)}}

    @app.tool(
        name="analyze_file_symbols",
        description="Analyze file symbols, imports, and dependencies for code understanding and navigation",
        tags={"analysis", "symbols", "imports", "dependencies"}
    )
    async def analyze_file_symbols(params: AnalyzeFileSymbolsSchema) -> dict[str, Any]:
        """Analyze file symbols and dependencies."""
        try:
            analyzer = FileAnalyzer()
            result = await analyzer.analyze_file_symbols(
                file_path=params.file_path,
                symbol_types=params.symbol_types,  # Already parsed by Pydantic schema
                include_imports=params.include_imports,
                include_dependencies=params.include_dependencies,
            )
            return result

        except Exception as e:
            logger.error("Error analyzing file symbols", file=params.file_path, error=str(e))
            return {"error": {"code": "ANALYZE_SYMBOLS_FAILED", "message": str(e)}}

    @app.tool(
        name="easy_replace_all",
        description="Perform bulk find-and-replace operations across multiple files with pattern matching and safety checks",
        tags={"file-operations", "bulk-replace", "refactoring", "maintenance"}
    )
    async def easy_replace_all(params: EasyReplaceAllSchema) -> dict[str, Any]:
        """Perform bulk find-and-replace operations across files."""
        try:
            # Replacements are already parsed by Pydantic schema
            replacements = params.replacements
            if isinstance(replacements, str):
                return {"error": {"code": "INVALID_REPLACEMENTS_FORMAT", "message": "Replacements should be parsed as list by schema"}}

            # Validate replacement format
            for i, replacement in enumerate(replacements):
                if not isinstance(replacement, dict) or not all(key in replacement for key in ["old", "new"]):
                    return {"error": {"code": "INVALID_REPLACEMENT", 
                                   "message": f"Replacement {i} must be a dict with 'old' and 'new' keys"}}

            # Import file operations utility
            from ...services.file_operations import FileOperationsService
            
            file_ops = FileOperationsService(params.repository_path)
            result = await file_ops.easy_replace_all(
                replacements=replacements,
                file_patterns=params.file_patterns,  # Already parsed by Pydantic schema
                exclude_patterns=params.exclude_patterns,
                dry_run=params.dry_run,
                case_sensitive=params.case_sensitive,
                backup=params.backup,
                max_files=params.max_files,
            )
            return result

        except Exception as e:
            logger.error("Error in bulk replace operation", error=str(e))
            return {"error": {"code": "BULK_REPLACE_FAILED", "message": str(e)}}

    @app.tool(
        name="cleanup_orphaned_projects",
        description="Clean up orphaned project data, stale caches, and unused resources for system maintenance",
        tags={"maintenance", "cleanup", "orphaned-data", "system-health"}
    )
    async def cleanup_orphaned_projects(params: CleanupOrphanedProjectsSchema) -> dict[str, Any]:
        """Clean up orphaned project data and resources."""
        try:
            # Repository paths are already parsed by Pydantic schema
            repository_paths = params.repository_paths

            # Import cleanup utility
            from ...services.cleanup_service import CleanupService
            
            cleanup_service = CleanupService()
            result = await cleanup_service.cleanup_orphaned_projects(
                repository_paths=repository_paths,
                dry_run=params.dry_run,
                force=params.force,
                backup_before_cleanup=params.backup_before_cleanup,
                cleanup_categories=params.cleanup_categories,  # Already parsed by Pydantic schema
                older_than_days=params.older_than_days,
            )
            return result

        except Exception as e:
            logger.error("Error cleaning up orphaned projects", error=str(e))
            return {"error": {"code": "CLEANUP_ORPHANED_FAILED", "message": str(e)}}

    @app.tool(
        name="update_treesummary_incremental",
        description="Incrementally update .treesummary files based on file changes for efficient AI context maintenance",
        tags={"analysis", "treesummary", "incremental", "ai-context"}
    )
    async def update_treesummary_incremental(project_path: str, changed_files: list[str] | None = None) -> dict[str, Any]:
        """Incrementally update treesummary files based on changes."""
        try:
            tree_manager = TreeSummaryManager(project_path)
            result = await tree_manager.update_treesummary_incremental(changed_files)
            return result

        except Exception as e:
            logger.error("Error updating treesummary incrementally", project=project_path, error=str(e))
            return {"error": {"code": "UPDATE_TREESUMMARY_FAILED", "message": str(e)}}

    @app.tool(
        name="watch_project_changes",
        description="Start watching project files for changes and automatically update analysis data",
        tags={"analysis", "file-watching", "auto-update", "monitoring"}
    )
    async def watch_project_changes(project_path: str, watch_patterns: list[str] | None = None) -> dict[str, Any]:
        """Start watching project files for changes."""
        try:
            from ...analysis.hooks.filesystem import TreeSummaryHook
            
            hook = TreeSummaryHook(project_path)
            result = await hook.start_watching(watch_patterns)
            return result

        except Exception as e:
            logger.error("Error starting project file watching", project=project_path, error=str(e))
            return {"error": {"code": "WATCH_PROJECT_FAILED", "message": str(e)}}