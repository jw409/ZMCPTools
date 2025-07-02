"""Documentation intelligence tools for context-aware development."""

from typing import Any

import structlog
from fastmcp import FastMCP

from ...schemas.documentation import (
    AnalyzeDocumentationChangesSchema,
    LinkDocsToCodeSchema,
    SearchDocumentationSchema,
    ScrapeDocumentationSchema,
    UpdateDocumentationSchema,
)
from ...services.documentation_service import DocumentationService

logger = structlog.get_logger("orchestration.tools.documentation")


def register_documentation_tools(app: FastMCP):
    """Register documentation intelligence tools with the FastMCP app."""
    
    @app.tool(
        name="scrape_documentation",
        description="Scrape and index documentation from websites for intelligent search and code linking",
        tags={"documentation", "scraping", "indexing", "knowledge-base"}
    )
    async def scrape_documentation(params: ScrapeDocumentationSchema) -> dict[str, Any]:
        """Scrape and index documentation from websites."""
        try:
            doc_service = DocumentationService()
            result = await doc_service.scrape_documentation(
                source_name=params.source_name,
                url=params.url,
                source_type=params.source_type,
                crawl_depth=params.crawl_depth,
                update_frequency=params.update_frequency,
                selectors=params.selectors,  # Already parsed by Pydantic schema
                ignore_patterns=params.ignore_patterns,
                force_refresh=params.force_refresh,
            )
            return result

        except Exception as e:
            logger.error("Error scraping documentation", source=params.source_name, url=params.url, error=str(e))
            return {"error": {"code": "SCRAPE_DOCUMENTATION_FAILED", "message": str(e)}}

    @app.tool(
        name="update_documentation",
        description="Update previously scraped documentation sources to get the latest content",
        tags={"documentation", "updates", "refresh", "maintenance"}
    )
    async def update_documentation(params: UpdateDocumentationSchema) -> dict[str, Any]:
        """Update previously scraped documentation sources."""
        try:
            doc_service = DocumentationService()
            result = await doc_service.update_documentation(
                source_name=params.source_name,
                repository_path=params.repository_path,
                force_refresh=params.force_refresh,
            )
            return result

        except Exception as e:
            logger.error("Error updating documentation", source=params.source_name, error=str(e))
            return {"error": {"code": "UPDATE_DOCUMENTATION_FAILED", "message": str(e)}}

    @app.tool(
        name="search_documentation",
        description="Search indexed documentation with AI-powered semantic search for relevant information",
        tags={"documentation", "search", "semantic", "ai-powered"}
    )
    async def search_documentation(params: SearchDocumentationSchema) -> dict[str, Any]:
        """Search indexed documentation with AI-powered semantic search."""
        try:
            doc_service = DocumentationService()
            result = await doc_service.search_documentation(
                query=params.query,
                source_names=params.source_names,  # Already parsed by Pydantic schema
                content_types=params.content_types,  # Already parsed by Pydantic schema
                limit=params.limit,
                min_score=params.min_score,
            )
            return result

        except Exception as e:
            logger.error("Error searching documentation", query=params.query, error=str(e))
            return {"error": {"code": "SEARCH_DOCUMENTATION_FAILED", "message": str(e)}}

    @app.tool(
        name="analyze_documentation_changes",
        description="Analyze changes in documentation sources and suggest code updates based on API changes",
        tags={"documentation", "change-analysis", "api-updates", "maintenance"}
    )
    async def analyze_documentation_changes(params: AnalyzeDocumentationChangesSchema) -> dict[str, Any]:
        """Analyze changes in documentation sources."""
        try:
            doc_service = DocumentationService()
            result = await doc_service.analyze_documentation_changes(
                repository_path=params.repository_path,
                source_names=params.source_names,  # Already parsed by Pydantic schema
                change_types=params.change_types,  # Already parsed by Pydantic schema
                since_timestamp=params.since_timestamp,
                impact_analysis=params.impact_analysis,
                suggest_code_updates=params.suggest_code_updates,
            )
            return result

        except Exception as e:
            logger.error("Error analyzing documentation changes", error=str(e))
            return {"error": {"code": "ANALYZE_DOC_CHANGES_FAILED", "message": str(e)}}

    @app.tool(
        name="link_docs_to_code",
        description="Link documentation to code files and functions for context-aware development assistance",
        tags={"documentation", "code-linking", "context", "development-assistance"}
    )
    async def link_docs_to_code(params: LinkDocsToCodeSchema) -> dict[str, Any]:
        """Link documentation to code files and functions."""
        try:
            doc_service = DocumentationService()
            result = await doc_service.link_docs_to_code(
                repository_path=params.repository_path,
                documentation_sources=params.documentation_sources,  # Already parsed by Pydantic schema
                file_patterns=params.file_patterns,  # Already parsed by Pydantic schema
                force_relink=params.force_relink,
            )
            return result

        except Exception as e:
            logger.error("Error linking docs to code", repository=params.repository_path, error=str(e))
            return {"error": {"code": "LINK_DOCS_TO_CODE_FAILED", "message": str(e)}}