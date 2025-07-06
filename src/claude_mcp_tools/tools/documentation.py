"""Documentation intelligence tools for context-aware development."""

import asyncio
from typing import Annotated, Any

import structlog
from fastmcp import Context
from pydantic import Field

from ..services.documentation_service import DocumentationService
from ..models import ScrapeJobStatus, DocumentationStatus
from .json_utils import parse_json_list, parse_json_dict, check_parsing_error
from .app import app

logger = structlog.get_logger("tools.documentation")


@app.tool(tags={"documentation", "scraping", "indexing", "knowledge-base"})
async def scrape_documentation(
    ctx: Context,
    source_name: Annotated[
        str,
        Field(
            description="Human-readable name for the documentation source",
            min_length=1,
            max_length=100,
        ),
    ],
    url: Annotated[
        str,
        Field(
            description="Base URL for documentation scraping",
            pattern=r"^https?://.*",
        ),
    ],
    source_type: Annotated[
        str,
        Field(
            description="Type of documentation",
            pattern=r"^(api|guide|reference|tutorial)$",
        ),
    ] = "guide",
    crawl_depth: Annotated[
        int,
        Field(
            description="Maximum depth for crawling linked pages",
            ge=1,
            le=10,
        ),
    ] = 3,
    update_frequency: Annotated[
        str,
        Field(
            description="How often to automatically update",
            pattern=r"^(hourly|daily|weekly)$",
        ),
    ] = "daily",
    selectors: Annotated[
        str | dict[str, str] | None,
        Field(
            description='CSS selectors for targeted content extraction. Can be JSON string or object: {"content": "article", "title": "h1"}',
            default=None,
        ),
    ] = None,
    allow_patterns: Annotated[
        str | list[str] | None,
        Field(
            description="URL patterns to include during crawling (allowlist). Supports both glob patterns and regex patterns. Glob patterns: * matches single level, ** matches multiple levels. Examples: '**/docs/**' (glob) matches any docs URL, '.*/api/.*' (regex) for advanced matching. Can be JSON array: [\"**/docs/**\", \"**/api/**\"].",
            default=None,
        ),
    ] = None,
    ignore_patterns: Annotated[
        str | list[str] | None,
        Field(
            description="URL patterns to skip during crawling (blocklist). Supports both glob patterns and regex patterns. Glob patterns: * matches single level, ** matches multiple levels. Examples: '**/blog/**' (glob) excludes blog URLs, '.*/community/.*' (regex) for advanced exclusion. Can be JSON array: [\"**/blog/**\", \"**/community/**\"]. Applied after allow_patterns.",
            default=None,
        ),
    ] = None,
    force_refresh: Annotated[
        bool,
        Field(
            description="Force refresh even if recently scraped",
        ),
    ] = False,
    scrape_immediately: Annotated[
        bool,
        Field(
            description="Immediately scrape after creating/updating the source",
        ),
    ] = True,
    # Additional convenience parameters for backward compatibility
    project_path: Annotated[
        str | None,
        Field(
            description="Project path (used to generate source_name if not provided)",
            default=None,
        ),
    ] = None,
    content_selector: Annotated[
        str | None,
        Field(
            description="Single CSS selector for content (will be used as 'content' in selectors)",
            default=None,
        ),
    ] = None,
    max_pages: Annotated[
        str | int | None,
        Field(
            description="Maximum number of pages to scrape (compatibility parameter). Can be string or integer.",
            default=None,
        ),
    ] = None,
    include_subdomains: Annotated[
        bool,
        Field(
            description="Include subdomains when filtering internal links for crawling",
        ),
    ] = False,
) -> dict[str, Any]:
    """Scrape and index documentation from websites."""
    logger.info("DEBUG: scrape_documentation function called", source_name=source_name, url=url)
    try:
        # Handle compatibility parameters
        if project_path and not source_name:
            # Generate source name from project path
            import os
            source_name = os.path.basename(project_path.rstrip('/'))
            try:
                await ctx.info(f"🔄 Generated source_name from project_path: {source_name}")
            except Exception as ctx_error:
                logger.warning("Context logging failed", error=str(ctx_error))
        
        if content_selector and not selectors:
            # Use content_selector as the main selector
            selectors = {"content": content_selector}
            try:
                await ctx.info(f"🔄 Using content_selector as main selector: {content_selector}")
            except Exception as ctx_error:
                logger.warning("Context logging failed", error=str(ctx_error))
        
        if max_pages:
            # Parse max_pages (can be string or int)
            try:
                if isinstance(max_pages, str):
                    max_pages = int(max_pages)
                if max_pages <= 0 or max_pages > 1000:
                    raise ValueError(f"max_pages must be between 1 and 1000, got {max_pages}")
                try:
                    await ctx.info(f"🔄 Max pages limit set to: {max_pages}")
                except Exception as ctx_error:
                    logger.warning("Context logging failed", error=str(ctx_error))
            except (ValueError, TypeError) as e:
                try:
                    await ctx.error(f"❌ Invalid max_pages value: {max_pages}")
                except Exception as ctx_error:
                    logger.warning("Context error logging failed", error=str(ctx_error))
                return {"error": {"code": "INVALID_MAX_PAGES", "message": f"max_pages must be a valid integer between 1 and 1000: {str(e)}"}}

        # Initialize progress and logging
        try:
            await ctx.info(f"🚀 Starting documentation scraping for {source_name} at {url}")
        except Exception as ctx_error:
            logger.warning("Context logging failed", error=str(ctx_error))
        try:
            await ctx.report_progress(0, 100)
        except Exception as ctx_error:
            logger.warning("Context progress reporting failed", error=str(ctx_error))

        # Parse selectors, allow_patterns, and ignore_patterns if provided as JSON strings
        try:
            await ctx.info("📝 Parsing selectors and pattern configuration...")
        except Exception as ctx_error:
            logger.warning("Context logging failed", error=str(ctx_error))
        
        parsed_selectors = parse_json_dict(selectors, "selectors")
        if check_parsing_error(parsed_selectors):
            try:
                await ctx.error(f"❌ Failed to parse selectors: {parsed_selectors}")
            except Exception as ctx_error:
                logger.warning("Context error logging failed", error=str(ctx_error))
            return parsed_selectors
        final_selectors: dict[str, str] | None = parsed_selectors

        parsed_allow_patterns = parse_json_list(allow_patterns, "allow_patterns")
        if check_parsing_error(parsed_allow_patterns):
            try:
                await ctx.error(f"❌ Failed to parse allow_patterns: {parsed_allow_patterns}")
            except Exception as ctx_error:
                logger.warning("Context error logging failed", error=str(ctx_error))
            return parsed_allow_patterns
        final_allow_patterns: list[str] | None = parsed_allow_patterns

        parsed_ignore_patterns = parse_json_list(ignore_patterns, "ignore_patterns")
        if check_parsing_error(parsed_ignore_patterns):
            try:
                await ctx.error(f"❌ Failed to parse ignore_patterns: {parsed_ignore_patterns}")
            except Exception as ctx_error:
                logger.warning("Context error logging failed", error=str(ctx_error))
            return parsed_ignore_patterns
        final_ignore_patterns: list[str] | None = parsed_ignore_patterns

        # If it's a simple string without JSON brackets, treat it as a single selector
        if isinstance(selectors, str) and "{" not in selectors:
            final_selectors = {"content": selectors}
            try:
                await ctx.info(f"🔧 Using simple selector: {selectors}")
            except Exception as ctx_error:
                logger.warning("Context logging failed", error=str(ctx_error))

        try:
            await ctx.report_progress(10, 100)
        except Exception as ctx_error:
            logger.warning("Context progress reporting failed", error=str(ctx_error))

        try:
            await ctx.info("🏗️ Initializing documentation service...")
        except Exception as ctx_error:
            logger.warning("Context logging failed", error=str(ctx_error))
        doc_service = DocumentationService()
        await doc_service.initialize()

        # First, add/update the documentation source
        try:
            await ctx.info("📦 Adding/updating documentation source...")
            await ctx.report_progress(20, 100)
        except Exception as ctx_error:
            logger.warning("Context logging failed", error=str(ctx_error))

        source_result = await doc_service.add_documentation_source(
            name=source_name,
            url=url,
            source_type=source_type,
            crawl_depth=crawl_depth,
            update_frequency=update_frequency,
            selectors=final_selectors,
            allow_patterns=final_allow_patterns,
            ignore_patterns=final_ignore_patterns,
            include_subdomains=include_subdomains,
        )

        if not source_result.get("success"):
            try:
                await ctx.error(f"❌ Failed to create documentation source: {source_result.get('error', 'Unknown error')}")
            except Exception as ctx_error:
                logger.warning("Context error logging failed", error=str(ctx_error))
            return {"error": {"code": "SOURCE_CREATION_FAILED", "message": source_result.get("error", "Unknown error")}}

        source_id = source_result["source_id"]
        try:
            await ctx.info(f"✅ Documentation source created with ID: {source_id}")
        except Exception as ctx_error:
            logger.warning("Context logging failed", error=str(ctx_error))

        # Conditionally scrape the documentation
        if scrape_immediately:
            try:
                await ctx.info(f"🕷️ Starting background scraping with depth {crawl_depth}...")
                await ctx.report_progress(30, 100)
            except Exception as ctx_error:
                logger.warning("Context logging failed", error=str(ctx_error))

            logger.info("DEBUG: About to call doc_service.scrape_documentation", source_id=source_id)
            try:
                await ctx.info("🔍 DEBUG: Calling scrape_documentation service...")
            except Exception as ctx_error:
                logger.warning("Context logging failed", error=str(ctx_error))
            
            result = await doc_service.scrape_documentation(
                source_id=source_id,
                force_refresh=force_refresh,
                ctx=ctx,
            )
            
            logger.info("DEBUG: doc_service.scrape_documentation completed", result=result)
            try:
                await ctx.info(f"🔍 DEBUG: Scrape service returned: {result}")
            except Exception as ctx_error:
                logger.warning("Context logging failed", error=str(ctx_error))

            try:
                await ctx.report_progress(100, 100)
            except Exception as ctx_error:
                logger.warning("Context progress reporting failed", error=str(ctx_error))
            
            if result.get("success"):
                try:
                    await ctx.info(f"🎉 Documentation scraping started! Source ID: {source_id}")
                    await ctx.info(f"📊 {source_name} is being scraped in the background")
                except Exception as ctx_error:
                    logger.warning("Context logging failed", error=str(ctx_error))
                
                logger.info("DEBUG: About to return success response", source_id=source_id)
                try:
                    await ctx.info("🔍 DEBUG: Preparing success response...")
                except Exception as ctx_error:
                    logger.warning("Context logging failed", error=str(ctx_error))
                
                return {
                    "success": True,
                    "message": "Documentation scraping started in background",
                    "source_id": source_id,
                    "source_name": source_name,
                    "url": url,
                    "scraping_in_progress": result.get("scraping_in_progress", True),
                }
            else:
                try:
                    await ctx.error(f"❌ Documentation scraping failed: {result.get('error', 'Unknown error')}")
                except Exception as ctx_error:
                    logger.warning("Context error logging failed", error=str(ctx_error))

                return result
        else:
            try:
                await ctx.info("📋 Documentation source created successfully, scraping skipped")
                await ctx.report_progress(100, 100)
            except Exception as ctx_error:
                logger.warning("Context logging failed", error=str(ctx_error))

            return {
                "success": True,
                "message": "Documentation source created successfully. Use scrape_by_source_id to scrape when ready.",
                "source_id": source_id,
                "source_name": source_name,
                "url": url,
            }

    except ValueError as e:
        try:
            await ctx.error(f"📝 Parameter validation error: {str(e)}")
        except Exception as ctx_error:
            logger.warning("Context error logging failed", error=str(ctx_error))
        logger.error("Parameter validation error in scrape_documentation", source=source_name, url=url, error=str(e))
        return {"error": {"code": "INVALID_PARAMETERS", "message": f"Parameter validation failed: {str(e)}"}}
    except ConnectionError as e:
        try:
            await ctx.error(f"🌐 Network connection error: {str(e)}")
        except Exception as ctx_error:
            logger.warning("Context error logging failed", error=str(ctx_error))
        logger.error("Network error in scrape_documentation", source=source_name, url=url, error=str(e))
        return {"error": {"code": "NETWORK_ERROR", "message": f"Failed to connect to {url}: {str(e)}"}}
    except TimeoutError as e:
        try:
            await ctx.error(f"⏰ Request timeout error: {str(e)}")
        except Exception as ctx_error:
            logger.warning("Context error logging failed", error=str(ctx_error))
        logger.error("Timeout error in scrape_documentation", source=source_name, url=url, error=str(e))
        return {"error": {"code": "TIMEOUT_ERROR", "message": f"Request timed out for {url}: {str(e)}"}}
    except Exception as e:
        logger.error("DEBUG: Exception caught in scrape_documentation", error=str(e), exc_info=True)
        try:
            await ctx.error(f"💥 Critical error in documentation scraping: {str(e)}")
        except Exception as ctx_error:
            logger.warning("Context error logging failed", error=str(ctx_error))
        logger.error("Unexpected error in scrape_documentation", source=source_name, url=url, error=str(e), exc_info=True)
        error_response = {"error": {"code": "SCRAPE_DOCUMENTATION_FAILED", "message": f"Unexpected error: {str(e)}", "type": type(e).__name__}}
        logger.info("DEBUG: Returning error response", response=error_response)
        return error_response


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
        await doc_service.initialize()
        result = await doc_service.update_documentation(
            source_name=source_name,
            force_refresh=force_refresh,
        )
        return result

    except ValueError as e:
        logger.error("Parameter validation error in update_documentation", source=source_name, error=str(e))
        return {"error": {"code": "INVALID_PARAMETERS", "message": f"Parameter validation failed: {str(e)}"}}
    except Exception as e:
        logger.error("Error updating documentation", source=source_name, error=str(e), exc_info=True)
        return {"error": {"code": "UPDATE_DOCUMENTATION_FAILED", "message": f"Unexpected error: {str(e)}", "type": type(e).__name__}}


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
        await doc_service.initialize()
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
        await doc_service.initialize()
        
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
        await doc_service.initialize()
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


@app.tool(tags={"documentation", "status", "monitoring", "scraping"})
async def get_scraping_status(
    source_id: Annotated[str, Field(
        description="ID of the documentation source to check",
    )],
) -> dict[str, Any]:
    """Check the status of documentation scraping for a source."""
    try:
        from ..database import execute_query
        from ..models import DocumentationSource
        from sqlalchemy import select
        
        doc_service = DocumentationService()
        await doc_service.initialize()
        
        # Check if scraping is currently in progress
        is_running = doc_service.is_scraping_running(source_id)
        
        # Get source information from database
        async def _get_source_info(session):
            stmt = select(DocumentationSource).where(DocumentationSource.id == source_id)
            result = await session.execute(stmt)
            return result.scalar_one_or_none()
        
        source = await execute_query(_get_source_info)
        
        if not source:
            return {
                "success": False,
                "source_id": source_id,
                "status": "not_found",
                "message": f"No documentation source found with ID: {source_id}",
            }
        
        # If currently running, override database status
        if is_running:
            return {
                "success": True,
                "source_id": source_id,
                "status": ScrapeJobStatus.IN_PROGRESS.value,
                "message": "Documentation scraping is currently running",
                "source_name": source.name,
                "url": source.url,
                "last_scraped": source.last_scraped.isoformat() if source.last_scraped else None,
            }
        
        # Return actual database status
        return {
            "success": True,
            "source_id": source_id,
            "status": source.status.value,  # Use enum value
            "message": f"Source status: {source.status.value}",
            "source_name": source.name,
            "url": source.url,
            "last_scraped": source.last_scraped.isoformat() if source.last_scraped else None,
            "created_at": source.created_at.isoformat(),
            "updated_at": source.updated_at.isoformat(),
        }
            
    except Exception as e:
        logger.error("Error checking scraping status", source_id=source_id, error=str(e))
        return {"error": {"code": "STATUS_CHECK_FAILED", "message": str(e)}}


@app.tool(tags={"documentation", "monitoring", "progress", "streaming"})
async def watch_scraping_progress(
    ctx: Context,
    source_id: Annotated[str, Field(
        description="ID of the documentation source to monitor",
    )],
    timeout_seconds: Annotated[int, Field(
        description="How long to watch for progress updates (max 60 seconds)",
        ge=5,
        le=60,
    )] = 30,
) -> dict[str, Any]:
    """Watch scraping progress for a limited time, then return status and events."""
    try:
        doc_service = DocumentationService()
        await doc_service.initialize()
        
        # Check if scraping is running
        if not doc_service.is_scraping_running(source_id):
            return {
                "success": True,
                "source_id": source_id,
                "status": "not_running",
                "message": "No active scraping for this source",
                "events": [],
            }
        
        import time
        start_time = time.time()
        events = []
        
        try:
            await ctx.info(f"👀 Watching scraping progress for {timeout_seconds}s...")
        except Exception:
            pass
        
        # Progress callback to collect events
        collected_events = []
        
        async def progress_collector(event):
            collected_events.append({
                "timestamp": time.time(),
                "event": event
            })
            # Log to context
            try:
                if event.get("type") == "page_start":
                    await ctx.info(f"📄 Starting page {event.get('page_number', '?')}: {event.get('url', '')[:60]}...")
                elif event.get("type") == "page_success":
                    await ctx.info(f"✅ Scraped: {event.get('title', 'Untitled')[:40]}")
                elif event.get("type") == "error":
                    await ctx.error(f"❌ Error: {event.get('error', 'Unknown error')}")
            except Exception:
                pass
        
        # Wait and collect events for the specified timeout
        while time.time() - start_time < timeout_seconds:
            if not doc_service.is_scraping_running(source_id):
                break
            await asyncio.sleep(1)  # Check every second
        
        final_status = ScrapeJobStatus.COMPLETED.value if not doc_service.is_scraping_running(source_id) else "still_running"
        
        try:
            await ctx.info(f"⏰ Watch period ended. Status: {final_status}")
        except Exception:
            pass
        
        return {
            "success": True,
            "source_id": source_id,
            "status": final_status,
            "watched_for_seconds": int(time.time() - start_time),
            "events": collected_events,
            "message": f"Watched for {int(time.time() - start_time)}s, scraping is {final_status}",
        }
        
    except Exception as e:
        logger.error("Error watching scraping progress", source_id=source_id, error=str(e))
        return {"error": {"code": "WATCH_PROGRESS_FAILED", "message": str(e)}}
