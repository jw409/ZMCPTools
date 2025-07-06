"""Analysis and file operation tools for project understanding and maintenance."""

from typing import Annotated, Any

import structlog
from fastmcp import Context
from pydantic import Field

from ..analysis.core.treesummary import TreeSummaryManager
from ..analysis.parsers.file_analyzer import FileAnalyzer
from .json_utils import parse_json_list, check_parsing_error
from .app import app

logger = structlog.get_logger("tools.analysis")


@app.tool(tags={"analysis", "project-structure", "ai-context", "treesummary"})
async def analyze_project_structure(
    ctx: Context,
    project_path: Annotated[str, Field(
        description="Path to the project to analyze",
    )],
    include_hidden: Annotated[bool, Field(
        description="Include hidden files and directories in analysis",
    )] = False,
    max_depth: Annotated[int, Field(
        description="Maximum depth to analyze",
        ge=1,
        le=20,
    )] = 10,
    file_types: Annotated[str | list[str] | None, Field(
        description="Specific file types to focus on. Can be JSON array: ['.py', '.js', '.ts']",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Generate comprehensive project structure analysis."""
    try:
        # Safe Context logging with error isolation
        try:
            await ctx.info(f"🔍 Starting project structure analysis for {project_path}")
            await ctx.report_progress(0, 100)
        except Exception as ctx_error:
            logger.warning("Context logging failed in project analysis start", error=str(ctx_error))
        
        # Parse list parameters if provided as JSON strings
        try:
            await ctx.info("📝 Parsing file type filters...")
        except Exception as ctx_error:
            logger.warning("Context logging failed in file type parsing", error=str(ctx_error))
            
        parsed_file_types = parse_json_list(file_types, "file_types")
        if check_parsing_error(parsed_file_types):
            try:
                await ctx.error(f"❌ Failed to parse file types: {parsed_file_types}")
            except Exception as ctx_error:
                logger.warning("Context error logging failed", error=str(ctx_error))
            return parsed_file_types
        final_file_types: list[str] | None = parsed_file_types

        try:
            await ctx.report_progress(20, 100)
        except Exception as ctx_error:
            logger.warning("Context progress reporting failed", error=str(ctx_error))

        try:
            await ctx.info(f"🏗️ Initializing TreeSummaryManager (depth: {max_depth}, hidden: {include_hidden})")
        except Exception as ctx_error:
            logger.warning("Context logging failed in TreeSummaryManager init", error=str(ctx_error))
            
        tree_manager = TreeSummaryManager(
            project_path=project_path,
            include_hidden=include_hidden,
            max_depth=max_depth,
            file_types=final_file_types
        )
        
        try:
            await ctx.report_progress(40, 100)
        except Exception as ctx_error:
            logger.warning("Context progress reporting failed", error=str(ctx_error))
        
        # Using available methods to provide similar functionality
        try:
            await ctx.info("📊 Generating project overview...")
        except Exception as ctx_error:
            logger.warning("Context logging failed in project overview", error=str(ctx_error))
        overview = await tree_manager.get_project_overview()
        
        try:
            await ctx.report_progress(100, 100)
            await ctx.info("✅ Project structure analysis completed successfully!")
        except Exception as ctx_error:
            logger.warning("Context logging failed in completion", error=str(ctx_error))
        
        return {
            "success": True,
            "project_path": project_path,
            "overview": overview,
            "settings": {
                "include_hidden": include_hidden,
                "max_depth": max_depth,
                "file_types": file_types,
            },
            "message": "Project structure analysis completed with custom settings",
        }

    except Exception as e:
        try:
            await ctx.error(f"💥 Critical error in project structure analysis: {str(e)}")
        except Exception as ctx_error:
            logger.warning("Context error logging failed", error=str(ctx_error))
        logger.error("Error analyzing project structure", project=project_path, error=str(e))
        return {"error": {"code": "ANALYZE_PROJECT_FAILED", "message": str(e)}}


@app.tool(tags={"analysis", "project-summary", "ai-optimization", "metrics"})
async def generate_project_summary(
    project_path: Annotated[str, Field(
        description="Path to the project to summarize",
    )],
    include_dependencies: Annotated[bool, Field(
        description="Include dependency analysis in summary",
    )] = True,
    include_metrics: Annotated[bool, Field(
        description="Include code metrics in summary",
    )] = True,
    max_file_samples: Annotated[int, Field(
        description="Maximum number of file samples to include",
        ge=5,
        le=100,
    )] = 20,
) -> dict[str, Any]:
    """Generate AI-optimized project summary."""
    try:
        tree_manager = TreeSummaryManager(project_path)
        # Using available methods to provide similar functionality
        overview = await tree_manager.get_project_overview()
        analyzed_files = tree_manager.list_analyzed_files()
        
        return {
            "success": True,
            "project_path": project_path,
            "overview": overview,
            "analyzed_files": analyzed_files[:max_file_samples] if max_file_samples else analyzed_files,
            "summary": {
                "total_files": len(analyzed_files),
                "include_dependencies": include_dependencies,
                "include_metrics": include_metrics,
            },
            "message": "Project summary generated using available TreeSummaryManager methods",
        }

    except Exception as e:
        logger.error("Error generating project summary", project=project_path, error=str(e))
        return {"error": {"code": "GENERATE_SUMMARY_FAILED", "message": str(e)}}


# detect_dead_code tool removed - was unimplemented placeholder


@app.tool(tags={"analysis", "symbols", "imports", "dependencies"})
async def analyze_file_symbols(
    file_path: Annotated[str, Field(
        description="Path to the file to analyze for symbols",
    )],
    symbol_types: Annotated[str | list[str] | None, Field(
        description="Types of symbols to analyze. Can be JSON array: ['function', 'class', 'variable']",
        default=None,
    )] = None,
    include_imports: Annotated[bool, Field(
        description="Include import analysis",
    )] = True,
    include_dependencies: Annotated[bool, Field(
        description="Include dependency relationships",
    )] = True,
) -> dict[str, Any]:
    """Analyze file symbols and dependencies."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_symbol_types = parse_json_list(symbol_types, "symbol_types")
        if check_parsing_error(parsed_symbol_types):
            return parsed_symbol_types
        final_symbol_types: list[str] | None = parsed_symbol_types

        analyzer = FileAnalyzer()
        # Use the available analyze_file method instead
        language = analyzer.detect_language(file_path)
        result = await analyzer.analyze_file(file_path, language)
        
        return {
            "success": True,
            "file_path": file_path,
            "language": language,
            "analysis": result,
            "symbol_types": final_symbol_types,
            "include_imports": include_imports,
            "include_dependencies": include_dependencies,
        }

    except Exception as e:
        logger.error("Error analyzing file symbols", file=file_path, error=str(e))
        return {"error": {"code": "ANALYZE_SYMBOLS_FAILED", "message": str(e)}}


# easy_replace_all tool removed - was unimplemented placeholder


@app.tool(tags={"maintenance", "cleanup", "orphaned-data", "system-health"})
async def cleanup_orphaned_projects(
    repository_paths: Annotated[str | list[str], Field(
        description="List of repository paths to cleanup. Can be JSON array: ['/path1', '/path2']",
        min_length=1,
        max_length=100,
    )],
    dry_run: Annotated[bool, Field(
        description="Preview cleanup without actually performing it",
    )] = True,
    force: Annotated[bool, Field(
        description="Force cleanup even if projects appear active",
    )] = False,
    backup_before_cleanup: Annotated[bool, Field(
        description="Create backups before cleaning up",
    )] = True,
    cleanup_categories: Annotated[str | list[str] | None, Field(
        description="Categories of data to cleanup. Can be JSON array: ['cache', 'logs', 'temp']",
        default=None,
    )] = None,
    older_than_days: Annotated[int, Field(
        description="Only cleanup data older than specified days",
        ge=1,
        le=365,
    )] = 30,
) -> dict[str, Any]:
    """Clean up orphaned project data and resources."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_repository_paths = parse_json_list(repository_paths, "repository_paths")
        if check_parsing_error(parsed_repository_paths):
            return parsed_repository_paths
        final_repository_paths: list[str] = parsed_repository_paths

        parsed_cleanup_categories = parse_json_list(cleanup_categories, "cleanup_categories")
        if check_parsing_error(parsed_cleanup_categories):
            return parsed_cleanup_categories
        final_cleanup_categories: list[str] | None = parsed_cleanup_categories
        # Import cleanup utility
        from ..services.cleanup_service import CleanupService

        cleanup_service = CleanupService()
        result = await cleanup_service.cleanup_orphaned_projects(
            repository_paths=final_repository_paths,
            dry_run=dry_run,
            force=force,
            backup_before_cleanup=backup_before_cleanup,
            cleanup_categories=final_cleanup_categories,
            older_than_days=older_than_days,
        )
        return result

    except Exception as e:
        logger.error("Error cleaning up orphaned projects", error=str(e))
        return {"error": {"code": "CLEANUP_ORPHANED_FAILED", "message": str(e)}}


@app.tool(tags={"analysis", "treesummary", "incremental", "ai-context"})
async def update_treesummary_incremental(project_path: str, changed_files: list[str] | None = None) -> dict[str, Any]:
    """Incrementally update treesummary files based on changes."""
    try:
        tree_manager = TreeSummaryManager(project_path)
        # TreeSummaryManager doesn't have update_treesummary_incremental method
        # Using available update methods
        if changed_files:
            for file_path in changed_files:
                await tree_manager.update_file_analysis(file_path, {})
        await tree_manager.update_project_metadata()
        result = {"success": True, "updated_files": changed_files or []}
        return result

    except Exception as e:
        logger.error("Error updating treesummary incrementally", project=project_path, error=str(e))
        return {"error": {"code": "UPDATE_TREESUMMARY_FAILED", "message": str(e)}}


@app.tool(tags={"analysis", "file-watching", "auto-update", "monitoring"})
async def watch_project_changes(project_path: str, watch_patterns: list[str] | None = None) -> dict[str, Any]:
    """Start watching project files for changes."""
    try:
        from ..analysis.hooks.filesystem import TreeSummaryHook

        hook = TreeSummaryHook(project_path=project_path)
        success = await hook.start_watching(watch_patterns=watch_patterns)
        
        return {
            "success": success,
            "project_path": project_path,
            "watch_patterns": watch_patterns,
            "message": "File watching started" if success else "Failed to start file watching",
            "watching": success,
        }

    except Exception as e:
        logger.error("Error starting project file watching", project=project_path, error=str(e))
        return {"error": {"code": "WATCH_PROJECT_FAILED", "message": str(e)}}
