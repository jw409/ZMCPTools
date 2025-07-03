"""Pydantic schemas for documentation MCP tools."""

from typing import Annotated

from pydantic import Field

from . import BaseToolSchema


class ScrapeDocumentationSchema(BaseToolSchema):
    """Schema for scrape_documentation tool parameters."""

    source_name: Annotated[str, Field(
        description="Human-readable name for the documentation source",
        min_length=1,
        max_length=100,
    )]

    url: Annotated[str, Field(
        description="Base URL for documentation scraping",
        pattern=r"^https?://.*",
    )]

    source_type: Annotated[str, Field(
        description="Type of documentation",
        pattern=r"^(api|guide|reference|tutorial)$",
    )] = "guide"

    crawl_depth: Annotated[int, Field(
        description="Maximum depth for crawling linked pages",
        ge=1,
        le=10,
    )] = 3

    update_frequency: Annotated[str, Field(
        description="How often to automatically update",
        pattern=r"^(hourly|daily|weekly)$",
    )] = "daily"

    selectors: Annotated[dict[str, str] | None, Field(
        description='CSS selectors for targeted content extraction. Provide as object: {"content": "article", "title": "h1"}',
        default=None,
    )]

    ignore_patterns: Annotated[list[str] | None, Field(
        description="URL patterns to skip during crawling",
        default=None,
    )]

    force_refresh: Annotated[bool, Field(
        description="Force refresh even if recently scraped",
    )] = False


class SearchDocumentationSchema(BaseToolSchema):
    """Schema for search_documentation tool parameters."""

    query: Annotated[str, Field(
        description="Search query for finding relevant documentation",
        min_length=1,
        max_length=500,
    )]

    source_names: Annotated[list[str] | None, Field(
        description="Specific documentation sources to search (optional)",
        default=None,
    )]

    content_types: Annotated[list[str] | None, Field(
        description="Types of content to include in search",
        default=None,
    )]

    limit: Annotated[int, Field(
        description="Maximum number of results to return",
        ge=1,
        le=100,
    )] = 10

    min_score: Annotated[float, Field(
        description="Minimum relevance score for results",
        ge=0.0,
        le=1.0,
    )] = 0.1


class LinkDocsToCodeSchema(BaseToolSchema):
    """Schema for link_docs_to_code tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository to analyze",
    )]

    documentation_sources: Annotated[list[str] | None, Field(
        description="Specific documentation sources to link against",
        default=None,
    )]

    file_patterns: Annotated[list[str] | None, Field(
        description="File patterns to include in analysis",
        default=None,
    )]

    force_relink: Annotated[bool, Field(
        description="Force re-linking even if already done",
    )] = False


class GetDocumentationChangesSchema(BaseToolSchema):
    """Schema for get_documentation_changes tool parameters."""

    source_names: Annotated[list[str] | None, Field(
        description="Documentation sources to check for changes",
        default=None,
    )]

    since_days: Annotated[int, Field(
        description="Number of days back to check for changes",
        ge=1,
        le=365,
    )] = 7

    change_types: Annotated[list[str] | None, Field(
        description="Types of changes to include",
        default=None,
    )]

    limit: Annotated[int, Field(
        description="Maximum number of changes to return",
        ge=1,
        le=100,
    )] = 20


class AnalyzeDocumentationChangesSchema(BaseToolSchema):
    """Schema for analyze_documentation_changes tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    source_names: Annotated[list[str] | None, Field(
        description="Documentation sources to analyze for changes",
        default=None,
    )]

    change_types: Annotated[list[str] | None, Field(
        description="Types of changes to analyze",
        default=None,
    )]

    since_timestamp: Annotated[str | None, Field(
        description="ISO timestamp to analyze changes since",
        default=None,
    )]

    impact_analysis: Annotated[bool, Field(
        description="Include impact analysis of documentation changes",
    )] = True

    suggest_code_updates: Annotated[bool, Field(
        description="Suggest code updates based on documentation changes",
    )] = False


class UpdateDocumentationSchema(BaseToolSchema):
    """Schema for update_documentation tool parameters."""

    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )]

    source_name: Annotated[str, Field(
        description="Name of the documentation source to update",
        min_length=1,
        max_length=100,
    )]

    force_refresh: Annotated[bool, Field(
        description="Force a complete refresh of the documentation",
    )] = False
