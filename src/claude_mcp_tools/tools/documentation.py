"""Documentation intelligence tools for context-aware development."""

import json
from typing import Annotated, Any

import structlog
from pydantic import Field

from ..services.documentation_service import DocumentationService
from .json_utils import parse_json_list, parse_json_dict, check_parsing_error
from .app import app

logger = structlog.get_logger("tools.documentation")


@app.tool(tags={"documentation", "scraping", "indexing", "knowledge-base"})
async def scrape_documentation(
    source_name: Annotated[str, Field(
        description="Human-readable name for the documentation source",
        min_length=1,
        max_length=100,
    )],
    url: Annotated[str, Field(
        description="Base URL for documentation scraping",
        pattern=r"^https?://.*",
    )],
    source_type: Annotated[str, Field(
        description="Type of documentation",
        pattern=r"^(api|guide|reference|tutorial)$",
    )] = "guide",
    crawl_depth: Annotated[int, Field(
        description="Maximum depth for crawling linked pages",
        ge=1,
        le=10,
    )] = 3,
    update_frequency: Annotated[str, Field(
        description="How often to automatically update",
        pattern=r"^(hourly|daily|weekly)$",
    )] = "daily",
    selectors: Annotated[str | dict[str, str] | None, Field(
        description='CSS selectors for targeted content extraction. Can be JSON string or object: {"content": "article", "title": "h1"}',
        default=None,
    )] = None,
    ignore_patterns: Annotated[list[str] | None, Field(
        description="URL patterns to skip during crawling",
        default=None,
    )] = None,
    force_refresh: Annotated[bool, Field(
        description="Force refresh even if recently scraped",
    )] = False,
    scrape_immediately: Annotated[bool, Field(
        description="Immediately scrape after creating/updating the source",
    )] = True,
) -> dict[str, Any]:
    """Scrape and index documentation from websites."""
    try:
        # Parse selectors if provided as JSON string
        parsed_selectors = parse_json_dict(selectors, "selectors")
        if check_parsing_error(parsed_selectors):
            return parsed_selectors
        final_selectors: dict[str, str] | None = parsed_selectors
        
        # If it's a simple string without JSON brackets, treat it as a single selector
        if isinstance(selectors, str) and "{" not in selectors:
            final_selectors = {"content": selectors}
        
        doc_service = DocumentationService()

        # First, add/update the documentation source
        source_result = await doc_service.add_documentation_source(
            name=source_name,
            url=url,
            source_type=source_type,
            crawl_depth=crawl_depth,
            update_frequency=update_frequency,
            selectors=final_selectors,
            ignore_patterns=ignore_patterns,
        )

        if not source_result.get("success"):
            return {"error": {"code": "SOURCE_CREATION_FAILED", "message": source_result.get("error", "Unknown error")}}

        source_id = source_result["source_id"]

        # Conditionally scrape the documentation
        if scrape_immediately:
            result = await doc_service.scrape_documentation(
                source_id=source_id,
                force_refresh=force_refresh,
            )
            return result
        else:
            return {
                "success": True,
                "message": "Documentation source created successfully. Use scrape_by_source_id to scrape when ready.",
                "source_id": source_id,
                "source_name": source_name,
                "url": url,
            }

    except Exception as e:
        logger.error("Error scraping documentation", source=source_name, url=url, error=str(e))
        return {"error": {"code": "SCRAPE_DOCUMENTATION_FAILED", "message": str(e)}}


@app.tool(tags={"documentation", "updates", "refresh", "maintenance"})
async def update_documentation(
    source_name: Annotated[str, Field(
        description="Name of the documentation source to update",
        min_length=1,
        max_length=100,
    )],
    force_refresh: Annotated[bool, Field(
        description="Force a complete refresh of the documentation",
    )] = False,
) -> dict[str, Any]:
    """Update previously scraped documentation sources."""
    try:
        doc_service = DocumentationService()
        result = await doc_service.update_documentation(
            source_name=source_name,
            force_refresh=force_refresh,
        )
        return result

    except Exception as e:
        logger.error("Error updating documentation", source=source_name, error=str(e))
        return {"error": {"code": "UPDATE_DOCUMENTATION_FAILED", "message": str(e)}}


@app.tool(tags={"documentation", "search", "semantic", "ai-powered"})
async def search_documentation(
    query: Annotated[str, Field(
        description="Search query for finding relevant documentation",
        min_length=1,
        max_length=500,
    )],
    source_names: Annotated[str | list[str] | None, Field(
        description="Specific documentation sources to search. Can be JSON array or list: [\"source1\", \"source2\"]",
        default=None,
    )] = None,
    content_types: Annotated[str | list[str] | None, Field(
        description="Types of content to include in search. Can be JSON array or list: [\"content\", \"code\", \"example\"]",
        default=None,
    )] = None,
    limit: Annotated[int, Field(
        description="Maximum number of results to return",
        ge=1,
        le=100,
    )] = 10,
    min_score: Annotated[float, Field(
        description="Minimum relevance score for results",
        ge=0.0,
        le=1.0,
    )] = 0.1,
) -> dict[str, Any]:
    """Search indexed documentation with AI-powered semantic search."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_source_names = parse_json_list(source_names, "source_names")
        if check_parsing_error(parsed_source_names):
            return parsed_source_names
        final_source_names: list[str] | None = parsed_source_names

        parsed_content_types = parse_json_list(content_types, "content_types")
        if check_parsing_error(parsed_content_types):
            return parsed_content_types
        final_content_types: list[str] | None = parsed_content_types

        doc_service = DocumentationService()
        result = await doc_service.search_documentation(
            query=query,
            source_names=final_source_names,
            content_types=final_content_types,
            limit=limit,
            min_relevance=min_score,
        )
        return result

    except Exception as e:
        logger.error("Error searching documentation", query=query, error=str(e))
        return {"error": {"code": "SEARCH_DOCUMENTATION_FAILED", "message": str(e)}}


@app.tool(tags={"documentation", "change-analysis", "api-updates", "maintenance"})
async def analyze_documentation_changes(
    repository_path: Annotated[str, Field(
        description="Path to the repository for context",
    )],
    source_names: Annotated[str | list[str] | None, Field(
        description="Documentation sources to analyze for changes. Can be JSON array or list: ['source1', 'source2']",
        default=None,
    )] = None,
    change_types: Annotated[str | list[str] | None, Field(
        description="Types of changes to analyze. Can be JSON array or list: ['created', 'updated', 'deleted']",
        default=None,
    )] = None,
    since_timestamp: Annotated[str | None, Field(
        description="ISO timestamp to analyze changes since",
        default=None,
    )] = None,
    impact_analysis: Annotated[bool, Field(
        description="Include impact analysis of documentation changes",
    )] = True,
    suggest_code_updates: Annotated[bool, Field(
        description="Suggest code updates based on documentation changes",
    )] = False,
) -> dict[str, Any]:
    """Analyze changes in documentation sources."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_source_names = parse_json_list(source_names, "source_names")
        if check_parsing_error(parsed_source_names):
            return parsed_source_names
        final_source_names: list[str] | None = parsed_source_names

        parsed_change_types = parse_json_list(change_types, "change_types")
        if check_parsing_error(parsed_change_types):
            return parsed_change_types
        final_change_types: list[str] | None = parsed_change_types

        doc_service = DocumentationService()
        
        # Calculate days_back from since_timestamp if provided
        days_back = 7  # Default
        if since_timestamp:
            from datetime import datetime
            try:
                since_dt = datetime.fromisoformat(since_timestamp.replace('Z', '+00:00'))
                now = datetime.now(since_dt.tzinfo)
                days_back = max(1, (now - since_dt).days)
            except ValueError:
                logger.warning(f"Invalid since_timestamp format: {since_timestamp}")
        
        # Handle source_names by iterating through each source
        if final_source_names:
            # Analyze each source individually then combine results
            all_results = []
            for source_name in final_source_names:
                try:
                    source_result = await doc_service.analyze_documentation_changes(
                        source_id=source_name,
                        days_back=days_back,
                        change_types=final_change_types,
                        impact_threshold="minor" if impact_analysis else "major",
                    )
                    if source_result:
                        all_results.append(source_result)
                except Exception as e:
                    logger.warning(f"Failed to analyze source {source_name}: {e}")
            
            result = {
                "success": True,
                "repository_path": repository_path,
                "sources_analyzed": final_source_names,
                "results": all_results,
                "total_sources": len(final_source_names),
                "successful_sources": len(all_results),
            }
        else:
            # Analyze all sources
            result = await doc_service.analyze_documentation_changes(
                source_id=None,
                days_back=days_back,
                change_types=final_change_types,
                impact_threshold="minor" if impact_analysis else "major",
            )
        
        # Add code update suggestions if requested
        if result.get("success") and suggest_code_updates:
            try:
                # Use the link_docs_to_code functionality for suggestions
                link_result = await DocumentationService.link_docs_to_code(
                    project_path=repository_path,
                    documentation_sources=final_source_names,
                    force_reanalysis=True,
                )
                result["code_update_suggestions"] = link_result
            except Exception as e:
                result["code_update_suggestions"] = {
                    "error": f"Failed to generate code suggestions: {e}",
                    "requested": True,
                }
        
        # Add analysis metadata
        if result.get("success"):
            result["analysis_parameters"] = {
                "repository_path": repository_path,
                "source_names": parsed_source_names,
                "since_timestamp": since_timestamp,
                "days_back": days_back,
                "change_types": parsed_change_types,
                "impact_analysis": impact_analysis,
                "suggest_code_updates": suggest_code_updates,
            }
        
        return result

    except Exception as e:
        logger.error("Error analyzing documentation changes", error=str(e))
        return {"error": {"code": "ANALYZE_DOC_CHANGES_FAILED", "message": str(e)}}


@app.tool(tags={"documentation", "code-linking", "context", "development-assistance"})
async def link_docs_to_code(
    repository_path: Annotated[str, Field(
        description="Path to the repository to analyze",
    )],
    documentation_sources: Annotated[str | list[str] | None, Field(
        description="Specific documentation sources to link against. Can be JSON array or list: ['source1', 'source2']",
        default=None,
    )] = None,
    file_patterns: Annotated[str | list[str] | None, Field(
        description="File patterns to include in analysis. Can be JSON array or list: ['*.py', '*.js']",
        default=None,
    )] = None,
    force_relink: Annotated[bool, Field(
        description="Force re-linking even if already done",
    )] = False,
) -> dict[str, Any]:
    """Link documentation to code files and functions."""
    try:
        # Parse list parameters if provided as JSON strings
        parsed_documentation_sources = parse_json_list(documentation_sources, "documentation_sources")
        if check_parsing_error(parsed_documentation_sources):
            return parsed_documentation_sources
        final_documentation_sources: list[str] | None = parsed_documentation_sources

        parsed_file_patterns = parse_json_list(file_patterns, "file_patterns")
        if check_parsing_error(parsed_file_patterns):
            return parsed_file_patterns
        final_file_patterns: list[str] | None = parsed_file_patterns

        doc_service = DocumentationService()
        result = await doc_service.link_docs_to_code(
            project_path=repository_path,
            documentation_sources=final_documentation_sources,
            file_patterns=final_file_patterns,
            force_reanalysis=force_relink,
        )
        return result

    except Exception as e:
        logger.error("Error linking docs to code", repository=repository_path, error=str(e))
        return {"error": {"code": "LINK_DOCS_TO_CODE_FAILED", "message": str(e)}}