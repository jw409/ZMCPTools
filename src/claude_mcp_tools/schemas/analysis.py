"""Pydantic schemas for analysis and file operation MCP tools."""

from typing import Annotated

from pydantic import Field

from . import BaseToolSchema


class EasyReplaceAllSchema(BaseToolSchema):
    """Schema for easy_replace_all tool parameters."""
    
    repository_path: Annotated[str, Field(
        description="Path to the repository to perform replacements in"
    )]
    
    replacements: Annotated[str | list[dict[str, str]], Field(
        description="List of replacement operations (JSON array or string)"
    )]
    
    file_patterns: Annotated[str | list[str] | None, Field(
        description="File patterns to include in replacements (glob patterns)",
        default=None
    )]
    
    exclude_patterns: Annotated[list[str] | None, Field(
        description="File patterns to exclude from replacements",
        default=None
    )]
    
    dry_run: Annotated[bool, Field(
        description="Preview changes without actually making them"
    )] = False
    
    case_sensitive: Annotated[bool, Field(
        description="Whether replacements should be case sensitive"
    )] = True
    
    backup: Annotated[bool, Field(
        description="Create backup files before making changes"
    )] = True
    
    max_files: Annotated[int, Field(
        description="Maximum number of files to process",
        ge=1,
        le=10000
    )] = 1000


class CleanupOrphanedProjectsSchema(BaseToolSchema):
    """Schema for cleanup_orphaned_projects tool parameters."""
    
    repository_paths: Annotated[list[str], Field(
        description="List of repository paths to cleanup",
        min_items=1,
        max_items=100
    )]
    
    dry_run: Annotated[bool, Field(
        description="Preview cleanup without actually performing it"
    )] = True
    
    force: Annotated[bool, Field(
        description="Force cleanup even if projects appear active"
    )] = False
    
    backup_before_cleanup: Annotated[bool, Field(
        description="Create backups before cleaning up"
    )] = True
    
    cleanup_categories: Annotated[list[str] | None, Field(
        description="Categories of data to cleanup",
        default=None
    )]
    
    older_than_days: Annotated[int, Field(
        description="Only cleanup data older than specified days",
        ge=1,
        le=365
    )] = 30


class AnalyzeProjectStructureSchema(BaseToolSchema):
    """Schema for analyze_project_structure tool parameters."""
    
    project_path: Annotated[str, Field(
        description="Path to the project to analyze"
    )]
    
    include_hidden: Annotated[bool, Field(
        description="Include hidden files and directories in analysis"
    )] = False
    
    max_depth: Annotated[int, Field(
        description="Maximum depth to analyze",
        ge=1,
        le=20
    )] = 10
    
    file_types: Annotated[list[str] | None, Field(
        description="Specific file types to focus on",
        default=None
    )]


class GenerateProjectSummarySchema(BaseToolSchema):
    """Schema for generate_project_summary tool parameters."""
    
    project_path: Annotated[str, Field(
        description="Path to the project to summarize"
    )]
    
    include_dependencies: Annotated[bool, Field(
        description="Include dependency analysis in summary"
    )] = True
    
    include_metrics: Annotated[bool, Field(
        description="Include code metrics in summary"
    )] = True
    
    max_file_samples: Annotated[int, Field(
        description="Maximum number of file samples to include",
        ge=5,
        le=100
    )] = 20


class DetectDeadCodeSchema(BaseToolSchema):
    """Schema for detect_dead_code tool parameters."""
    
    project_path: Annotated[str, Field(
        description="Path to the project to analyze for dead code"
    )]
    
    file_extensions: Annotated[list[str] | None, Field(
        description="File extensions to analyze",
        default=None
    )]
    
    exclude_test_files: Annotated[bool, Field(
        description="Exclude test files from dead code detection"
    )] = True
    
    confidence_threshold: Annotated[float, Field(
        description="Confidence threshold for dead code detection",
        ge=0.0,
        le=1.0
    )] = 0.8


class AnalyzeFileSymbolsSchema(BaseToolSchema):
    """Schema for analyze_file_symbols tool parameters."""
    
    file_path: Annotated[str, Field(
        description="Path to the file to analyze for symbols"
    )]
    
    symbol_types: Annotated[list[str] | None, Field(
        description="Types of symbols to analyze",
        default=None
    )]
    
    include_imports: Annotated[bool, Field(
        description="Include import analysis"
    )] = True
    
    include_dependencies: Annotated[bool, Field(
        description="Include dependency relationships"
    )] = True