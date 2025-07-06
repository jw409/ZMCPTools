"""Documentation intelligence service using SQLAlchemy ORM."""

import asyncio
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import execute_query
from ..models import (
    CodeDocumentationLink,
    DocumentationChange,
    DocumentationEmbedding,
    DocumentationEntry,
    DocumentationSource,
    DocumentationStatus,
    ScrapeJob,
    ScrapeJobStatus,
    SectionType,
    SourceType,
    UpdateFrequency,
)
from .vector_service import get_vector_service
from .documentation_scraper import ThreadPoolDocumentationScraper, thread_pool_scraper
from .domain_browser_manager import domain_manager
from .scrape_job_service import ScrapeJobService

logger = structlog.get_logger()


class DocumentationService:
    """Service for documentation intelligence operations using SQLAlchemy ORM."""

    def __init__(self, orchestration_path: Path | None = None):
        """Initialize documentation service.

        Args:
            orchestration_path: Path to orchestration data directory
        """
        if orchestration_path is None:
            self.orchestration_path = Path.home() / ".mcptools"
        else:
            self.orchestration_path = Path(orchestration_path)

        self.docs_path = self.orchestration_path / "documentation"
        self.cache_path = self.docs_path / "cache"
        self.vector_db_path = self.docs_path / "vectors"

        # Ensure directories exist
        self.docs_path.mkdir(parents=True, exist_ok=True)
        self.cache_path.mkdir(parents=True, exist_ok=True)
        self.vector_db_path.mkdir(parents=True, exist_ok=True)

        self._vector_service = None
        self._running_scrapers: dict[str, dict[str, Any]] = {}  # Track scraping jobs by source_id
        self._web_scraper: ThreadPoolDocumentationScraper | None = None
        self._scrape_job_service: ScrapeJobService | None = None
        self._worker_tasks: dict[str, asyncio.Task] = {}  # Track background worker tasks

    async def initialize(self) -> None:
        """Initialize documentation service components."""
        try:
            # Initialize vector service (ChromaDB)
            self._vector_service = await get_vector_service(self.vector_db_path)

            # Initialize domain browser manager with our base data directory
            domain_manager.set_base_data_dir(self.docs_path)

            # Initialize scrape job service
            self._scrape_job_service = ScrapeJobService()

            logger.info(
                "Documentation service initialized", docs_path=str(self.docs_path)
            )

        except Exception as e:
            logger.error("Failed to initialize documentation service", error=str(e))
            raise

    async def cleanup(self) -> None:
        """Clean up documentation service resources."""
        try:
            # Clean up completed worker tasks first
            await self._cleanup_completed_workers()
            
            # Clear running scraper tracking (these are job metadata, not tasks)
            self._running_scrapers.clear()

            # Stop all worker tasks
            for worker_id, task in self._worker_tasks.items():
                if not task.done():
                    logger.info(f"Cancelling worker task {worker_id}")
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                    except Exception as e:
                        logger.warning(f"Error stopping worker {worker_id}: {e}")

            # Clean up all domain browser contexts
            await domain_manager.cleanup_all_domains(force=True)

            # Close vector service
            if self._vector_service:
                # ChromaDB cleanup if needed
                self._vector_service = None

            logger.info("Documentation service cleanup complete")

        except Exception as e:
            logger.error("Error during documentation service cleanup", error=str(e))

    @staticmethod
    async def add_documentation_source(
        name: str,
        url: str,
        source_type: str = "guide",
        crawl_depth: int = 3,
        update_frequency: str = "daily",
        selectors: dict[str, str] | None = None,
        allow_patterns: list[str] | None = None,
        ignore_patterns: list[str] | None = None,
        include_subdomains: bool = False,
    ) -> dict[str, Any]:
        """Add a new documentation source for scraping.

        Args:
            name: Human-readable name for the source
            url: Base URL for documentation
            source_type: Type of documentation (api, guide, reference, tutorial)
            crawl_depth: Maximum depth for crawling
            update_frequency: How often to update (hourly, daily, weekly)
            selectors: CSS selectors for content extraction
            allow_patterns: URL patterns to include during crawling (allowlist)
            ignore_patterns: URL patterns to ignore during crawling (blocklist)
            include_subdomains: Include subdomains when filtering internal links for crawling

        Returns:
            Source creation result with ID and status
        """

        async def _create_source(session: AsyncSession):
            try:
                # Generate source ID
                source_id = str(uuid.uuid4())

                # Create source instance
                source = DocumentationSource(
                    id=source_id,
                    name=name,
                    url=url,
                    source_type=SourceType.from_string(source_type),
                    crawl_depth=crawl_depth,
                    update_frequency=UpdateFrequency.from_string(update_frequency),
                    status=DocumentationStatus.NOT_STARTED,
                    include_subdomains=include_subdomains,
                )

                # Set selectors and pattern filters
                if selectors:
                    source.set_selectors(selectors)
                if allow_patterns:
                    source.set_allow_patterns(allow_patterns)
                if ignore_patterns:
                    source.set_ignore_patterns(ignore_patterns)

                # Add to session
                session.add(source)
                await session.commit()

                logger.info(
                    "Documentation source created",
                    source_id=source_id,
                    name=name,
                    url=url,
                    source_type=source_type,
                )

                return {
                    "success": True,
                    "source_id": source_id,
                    "name": name,
                    "url": url,
                    "source_type": source_type,
                    "created_at": source.created_at.isoformat(),
                }

            except Exception as e:
                logger.error(
                    "Failed to create documentation source",
                    name=name,
                    url=url,
                    error=str(e),
                )
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_create_source)

    @staticmethod
    async def get_documentation_source(source_id: str) -> dict[str, Any] | None:
        """Get documentation source by ID.

        Args:
            source_id: Source ID to retrieve

        Returns:
            Source information or None if not found
        """

        async def _get_source(session: AsyncSession):
            stmt = select(DocumentationSource).where(
                DocumentationSource.id == source_id
            )
            result = await session.execute(stmt)
            source = result.scalar_one_or_none()

            if not source:
                return None

            # Count entries for this source
            entry_count_stmt = select(func.count(DocumentationEntry.id)).where(
                DocumentationEntry.source_id == source_id,
            )
            count_result = await session.execute(entry_count_stmt)
            entry_count = count_result.scalar() or 0

            return {
                "id": source.id,
                "name": source.name,
                "url": source.url,
                "source_type": source.source_type.value,
                "crawl_depth": source.crawl_depth,
                "update_frequency": source.update_frequency.value,
                "selectors": source.get_selectors(),
                "ignore_patterns": source.get_ignore_patterns(),
                "last_scraped": (
                    source.last_scraped.isoformat() if source.last_scraped else None
                ),
                "status": source.status,
                "entry_count": entry_count,
                "created_at": source.created_at.isoformat(),
                "updated_at": source.updated_at.isoformat(),
            }

        return await execute_query(_get_source)

    @staticmethod
    async def list_documentation_sources() -> list[dict[str, Any]]:
        """List all documentation sources.

        Returns:
            List of documentation sources with metadata
        """

        async def _list_sources(session: AsyncSession):
            # Query sources with entry counts
            stmt = select(DocumentationSource).order_by(DocumentationSource.name)
            result = await session.execute(stmt)
            sources = result.scalars().all()

            source_list = []
            for source in sources:
                # Count entries for this source
                entry_count_stmt = select(func.count(DocumentationEntry.id)).where(
                    DocumentationEntry.source_id == source.id,
                )
                count_result = await session.execute(entry_count_stmt)
                entry_count = count_result.scalar() or 0

                source_list.append(
                    {
                        "id": source.id,
                        "name": source.name,
                        "url": source.url,
                        "source_type": source.source_type.value,
                        "last_scraped": (
                            source.last_scraped.isoformat()
                            if source.last_scraped
                            else None
                        ),
                        "entry_count": entry_count,
                        "status": source.status.value,
                    }
                )

            return source_list

        return await execute_query(_list_sources)

    async def scrape_documentation(
        self,
        source_id: str,
        force_refresh: bool = False,
        ctx=None,
        progress_callback=None,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Queue documentation scraping job using the background job service.

        Args:
            source_id: ID of the documentation source
            force_refresh: Force refresh even if recently scraped
            ctx: Context for progress reporting (optional)
            progress_callback: Callback for progress updates (optional)
            agent_id: Agent ID for tracking (optional)

        Returns:
            Job queueing result with job_id and status
        """
        if not self._scrape_job_service:
            # Fallback to legacy behavior if job service not initialized
            logger.warning(
                "ScrapeJobService not initialized, falling back to direct execution"
            )
            return await self._scrape_documentation_direct(
                source_id, force_refresh, ctx, progress_callback, agent_id
            )

        async def _get_source_for_scraping(session: AsyncSession):
            stmt = select(DocumentationSource).where(
                DocumentationSource.id == source_id
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

        # Get source configuration
        source_data = await execute_query(_get_source_for_scraping)
        if not source_data:
            return {
                "success": False,
                "error": f"Source {source_id} not found",
            }

        # Check if scraping is currently running
        if await self.is_scraping_running(source_id):
            return {
                "success": True,
                "skipped": True,
                "reason": "Scraping already in progress",
                "source_id": source_id,
                "message": f"Scraping is already running for {source_data.name}",
            }

        # Check if scraping is needed
        if not force_refresh and source_data.last_scraped:
            time_since_scrape = datetime.now(timezone.utc) - source_data.last_scraped
            if self._should_skip_scraping(source_data, time_since_scrape):
                return {
                    "success": True,
                    "skipped": True,
                    "reason": "Recently scraped",
                    "last_scraped": source_data.last_scraped.isoformat(),
                }

        # Prepare job parameters
        job_params = {
            "force_refresh": force_refresh,
            "selectors": source_data.get_selectors(),
            "crawl_depth": source_data.crawl_depth,
            "allow_patterns": source_data.get_allow_patterns(),
            "ignore_patterns": source_data.get_ignore_patterns(),
            "include_subdomains": source_data.include_subdomains,
            "agent_id": agent_id,
            "source_url": source_data.url,
            "source_name": source_data.name,
        }

        # Queue the scraping job
        job_result = await self._scrape_job_service.queue_scrape_job(
            source_id=source_id, job_params=job_params, priority=5  # Default priority
        )

        if job_result.get("success"):
            logger.info(
                "Documentation scraping job queued",
                source_id=source_id,
                job_id=job_result.get("job_id"),
            )

            # Auto-start a background worker if there are pending jobs and no active workers
            try:
                await self._ensure_worker_running()
            except Exception as e:
                logger.warning(
                    "Failed to auto-start worker, jobs will remain pending until manual start",
                    error=str(e),
                )

            return {
                "success": True,
                "job_id": job_result.get("job_id"),
                "source_id": source_id,
                "status": "queued",
                "message": f"Scraping job queued for {source_data.name}",
                "queued_at": job_result.get("created_at"),
                "using_job_queue": True,
            }
        else:
            # Handle existing job or queue failure
            existing_job_id = job_result.get("existing_job_id")
            if existing_job_id:
                logger.info(
                    "Existing scraping job found",
                    source_id=source_id,
                    existing_job_id=existing_job_id,
                )

                return {
                    "success": True,
                    "job_id": existing_job_id,
                    "source_id": source_id,
                    "status": job_result.get("existing_status", "unknown"),
                    "message": f"Scraping job already exists for {source_data.name}",
                    "existing_job": True,
                    "using_job_queue": True,
                }
            else:
                return {
                    "success": False,
                    "error": job_result.get("error", "Failed to queue scraping job"),
                    "source_id": source_id,
                }

    async def search_documentation(
        self,
        query: str,
        source_names: list[str] | None = None,
        content_types: list[str] | None = None,
        search_type: str = "hybrid",
        limit: int = 20,
        min_relevance: float = 0.3,
    ) -> dict[str, Any]:
        """Search documentation content using text and semantic similarity.

        Args:
            query: Search query
            source_names: Filter by specific source names
            content_types: Filter by content types
            search_type: Search method (text, vector, hybrid)
            limit: Maximum number of results
            min_relevance: Minimum relevance score threshold

        Returns:
            Search results with relevance scores
        """

        async def _search_docs(session: AsyncSession):
            results = []

            # Get source IDs if source names provided
            source_ids = None
            if source_names:
                source_subquery = select(DocumentationSource.id).where(
                    DocumentationSource.name.in_(source_names),
                )
                source_result = await session.execute(source_subquery)
                source_ids = [row[0] for row in source_result.fetchall()]

            # Vector search
            vector_results = []
            if search_type in ["vector", "hybrid"] and self._vector_service:
                try:
                    vector_results = await self._vector_service.search_similar_content(
                        query=query,
                        source_ids=source_ids,
                        limit=limit * 2,  # Get more for better hybrid results
                        similarity_threshold=min_relevance,
                    )
                except Exception as e:
                    logger.warning("Vector search failed", error=str(e))

            # Text search
            text_results = []
            if search_type in ["text", "hybrid"]:
                # Build text search query
                stmt = select(DocumentationEntry).options(
                    selectinload(DocumentationEntry.source),
                )

                # Apply filters
                if source_ids:
                    stmt = stmt.where(DocumentationEntry.source_id.in_(source_ids))

                if content_types:
                    content_type_enums = []
                    for ct in content_types:
                        try:
                            content_type_enums.append(SectionType(ct))
                        except ValueError:
                            # Skip invalid content types
                            pass
                    if content_type_enums:
                        stmt = stmt.where(
                            DocumentationEntry.section_type.in_(content_type_enums)
                        )

                # Text search conditions
                stmt = stmt.where(
                    or_(
                        DocumentationEntry.title.ilike(f"%{query}%"),
                        DocumentationEntry.content.ilike(f"%{query}%"),
                    ),
                )

                stmt = stmt.order_by(DocumentationEntry.last_updated.desc())
                stmt = stmt.limit(limit * 2)

                result = await session.execute(stmt)
                entries = result.scalars().all()

                # Format text results
                for entry in entries:
                    # Calculate text relevance score
                    title_matches = entry.title.lower().count(query.lower())
                    content_matches = entry.content.lower()[:1000].count(query.lower())
                    relevance = min(1.0, (title_matches * 0.3 + content_matches * 0.1))

                    if relevance >= min_relevance:
                        text_results.append(
                            {
                                "id": entry.id,
                                "title": entry.title,
                                "url": entry.url,
                                "content": (
                                    entry.content[:500] + "..."
                                    if len(entry.content) > 500
                                    else entry.content
                                ),
                                "source_name": entry.source.name,
                                "section_type": entry.section_type.value,
                                "relevance_score": relevance,
                                "search_method": "text",
                                "last_updated": (
                                    entry.last_updated.isoformat()
                                    if entry.last_updated
                                    else None
                                ),
                            }
                        )

            # Combine results
            if search_type == "hybrid":
                # Create combined results with unique entries
                seen_ids = set()
                combined_results = []

                # Add vector results first (typically higher quality)
                for vr in vector_results:
                    if vr["entry_id"] not in seen_ids:
                        # Get entry details from database
                        entry_stmt = (
                            select(DocumentationEntry)
                            .options(
                                selectinload(DocumentationEntry.source),
                            )
                            .where(DocumentationEntry.id == vr["entry_id"])
                        )
                        entry_result = await session.execute(entry_stmt)
                        entry = entry_result.scalar_one_or_none()

                        if entry:
                            combined_results.append(
                                {
                                    "id": entry.id,
                                    "title": entry.title,
                                    "url": entry.url,
                                    "content": vr["content"],
                                    "source_name": entry.source.name,
                                    "section_type": entry.section_type.value,
                                    "relevance_score": vr["similarity_score"],
                                    "search_method": "vector",
                                    "last_updated": (
                                        entry.last_updated.isoformat()
                                        if entry.last_updated
                                        else None
                                    ),
                                }
                            )
                            seen_ids.add(entry.id)

                # Add text results that weren't found by vector search
                for tr in text_results:
                    if tr["id"] not in seen_ids:
                        tr["search_method"] = "text"
                        combined_results.append(tr)
                        seen_ids.add(tr["id"])

                results = combined_results

            elif search_type == "vector":
                # Vector-only results - convert to standard format
                for vr in vector_results:
                    entry_stmt = (
                        select(DocumentationEntry)
                        .options(
                            selectinload(DocumentationEntry.source),
                        )
                        .where(DocumentationEntry.id == vr["entry_id"])
                    )
                    entry_result = await session.execute(entry_stmt)
                    entry = entry_result.scalar_one_or_none()

                    if entry:
                        results.append(
                            {
                                "id": entry.id,
                                "title": entry.title,
                                "url": entry.url,
                                "content": vr["content"],
                                "source_name": entry.source.name,
                                "section_type": entry.section_type.value,
                                "relevance_score": vr["similarity_score"],
                                "search_method": "vector",
                                "last_updated": (
                                    entry.last_updated.isoformat()
                                    if entry.last_updated
                                    else None
                                ),
                            }
                        )

            else:  # text search only
                results = text_results

            # Sort by relevance score and limit
            results.sort(key=lambda x: x["relevance_score"], reverse=True)
            results = results[:limit]

            return {
                "success": True,
                "query": query,
                "results": results,
                "total_found": len(results),
                "search_type": search_type,
                "vector_search_available": self._vector_service is not None,
                "search_timestamp": datetime.now(timezone.utc).isoformat(),
            }

        return await execute_query(_search_docs)

    @staticmethod
    async def update_documentation(
        source_id: str | None = None,
        source_name: str | None = None,
        force_refresh: bool = False,
        cleanup_cache: bool = True,
    ) -> dict[str, Any]:
        """Update documentation from existing sources with cache maintenance.

        Args:
            source_id: Specific source ID to update
            source_name: Specific source name to update
            force_refresh: Force refresh even if recently updated
            cleanup_cache: Perform cache cleanup after update

        Returns:
            Update result with statistics
        """

        async def _update_docs(session: AsyncSession):
            update_stats = {
                "sources_updated": 0,
                "entries_updated": 0,
                "entries_added": 0,
                "entries_removed": 0,
                "errors": [],
            }

            # Get sources to update
            if source_id:
                stmt = select(DocumentationSource).where(
                    DocumentationSource.id == source_id
                )
            elif source_name:
                stmt = select(DocumentationSource).where(
                    DocumentationSource.name == source_name
                )
            else:
                stmt = select(DocumentationSource).where(
                    DocumentationSource.status.in_(
                        [
                            DocumentationStatus.NOT_STARTED,
                            DocumentationStatus.COMPLETED,
                            DocumentationStatus.STALE,
                        ]
                    )
                )

            result = await session.execute(stmt)
            sources = result.scalars().all()

            for source in sources:
                try:
                    # Check if update is needed
                    if not force_refresh and source.last_scraped:
                        time_since_scrape = datetime.now(timezone.utc) - source.last_scraped
                        frequency_map = {
                            UpdateFrequency.HOURLY: timedelta(hours=1),
                            UpdateFrequency.DAILY: timedelta(days=1),
                            UpdateFrequency.WEEKLY: timedelta(weeks=1),
                        }
                        threshold = frequency_map.get(
                            source.update_frequency, timedelta(days=1)
                        )

                        if time_since_scrape < threshold:
                            continue

                    # Update source (this would trigger scraping)
                    update_stats["sources_updated"] += 1

                    # Update timestamp
                    source.last_scraped = datetime.now(timezone.utc)

                except Exception as e:
                    logger.error(
                        "Failed to update documentation source",
                        source_id=source.id,
                        error=str(e),
                    )
                    update_stats["errors"].append(
                        {
                            "source_id": source.id,
                            "source_name": source.name,
                            "error": str(e),
                        }
                    )

            await session.commit()

            return {
                "success": True,
                "update_stats": update_stats,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

        return await execute_query(_update_docs)

    @staticmethod
    async def analyze_documentation_changes(
        source_id: str | None = None,
        days_back: int = 7,
        change_types: list[str] | None = None,
        impact_threshold: str = "minor",
    ) -> dict[str, Any]:
        """Analyze recent documentation changes and their potential impact.

        Args:
            source_id: Analyze specific source (all sources if None)
            days_back: Number of days to look back for changes
            change_types: Filter by change types
            impact_threshold: Minimum impact level

        Returns:
            Change analysis with impact assessment
        """

        async def _analyze_changes(session: AsyncSession):
            since_date = datetime.now(timezone.utc) - timedelta(days=days_back)

            # Build query for changes
            stmt = (
                select(DocumentationChange)
                .options(
                    selectinload(DocumentationChange.entry),
                )
                .where(DocumentationChange.detected_at >= since_date)
            )

            if source_id:
                # Filter by source
                entry_subquery = select(DocumentationEntry.id).where(
                    DocumentationEntry.source_id == source_id,
                )
                entry_ids = await session.execute(entry_subquery)
                entry_id_list = [row[0] for row in entry_ids.fetchall()]
                stmt = stmt.where(DocumentationChange.entry_id.in_(entry_id_list))

            if change_types:
                stmt = stmt.where(DocumentationChange.change_type.in_(change_types))

            # Filter by impact threshold
            impact_order = {"minor": 0, "major": 1, "breaking": 2}
            threshold_level = impact_order.get(impact_threshold, 0)

            stmt = stmt.order_by(DocumentationChange.detected_at.desc())

            result = await session.execute(stmt)
            changes = result.scalars().all()

            # Analyze changes
            change_summary = {
                "total_changes": len(changes),
                "by_type": {},
                "by_impact": {},
                "high_impact_changes": [],
            }

            for change in changes:
                # Count by type
                change_type = change.change_type
                change_summary["by_type"][change_type] = (
                    change_summary["by_type"].get(change_type, 0) + 1
                )

                # Count by impact
                impact = change.impact_level
                change_summary["by_impact"][impact] = (
                    change_summary["by_impact"].get(impact, 0) + 1
                )

                # High impact changes
                if impact_order.get(impact, 0) >= threshold_level:
                    change_summary["high_impact_changes"].append(
                        {
                            "id": change.id,
                            "entry_title": (
                                change.entry.title if change.entry else "Unknown"
                            ),
                            "entry_url": (
                                change.entry.url if change.entry else "Unknown"
                            ),
                            "change_type": change.change_type,
                            "impact_level": change.impact_level,
                            "description": change.description,
                            "detected_at": change.detected_at.isoformat(),
                        }
                    )

            return {
                "success": True,
                "analysis_period": {
                    "since": since_date.isoformat(),
                    "until": datetime.now(timezone.utc).isoformat(),
                    "days_back": days_back,
                },
                "source_id": source_id,
                "change_summary": change_summary,
                "recommendations": _generate_change_recommendations(change_summary),
            }

        return await execute_query(_analyze_changes)

    @staticmethod
    async def link_docs_to_code(
        project_path: str,
        documentation_sources: list[str] | None = None,
        file_patterns: list[str] | None = None,
        confidence_threshold: float = 0.7,
        max_links_per_symbol: int = 3,
        force_reanalysis: bool = False,
    ) -> dict[str, Any]:
        """Create AI-powered links between documentation and code symbols.

        Args:
            project_path: Absolute path to code project
            documentation_sources: Specific doc sources to link
            file_patterns: File patterns to analyze
            confidence_threshold: Minimum confidence for creating links
            max_links_per_symbol: Maximum documentation links per code symbol
            force_reanalysis: Force re-analysis of existing symbols

        Returns:
            Linking results with created references and confidence scores
        """

        async def _link_docs_to_code(session: AsyncSession):
            try:
                # Get documentation entries to analyze
                stmt = select(DocumentationEntry).options(
                    selectinload(DocumentationEntry.source),
                )

                if documentation_sources:
                    source_subquery = select(DocumentationSource.id).where(
                        DocumentationSource.name.in_(documentation_sources),
                    )
                    source_ids = await session.execute(source_subquery)
                    source_id_list = [row[0] for row in source_ids.fetchall()]
                    stmt = stmt.where(DocumentationEntry.source_id.in_(source_id_list))

                result = await session.execute(stmt)
                docs = result.scalars().all()

                # Extract project symbols (placeholder - would integrate with existing analysis)
                project_symbols = await _extract_project_symbols(
                    project_path, file_patterns
                )

                # Perform AI-powered linking analysis (placeholder)
                links_created = []

                # For each documentation entry, find matching code symbols
                for doc in docs:
                    # Simple keyword matching for now (would be enhanced with AI)
                    doc_keywords = _extract_keywords(
                        doc.title + " " + doc.content[:1000]
                    )

                    for symbol in project_symbols:
                        # Calculate confidence based on keyword overlap
                        confidence = _calculate_doc_code_confidence(
                            doc_keywords, symbol
                        )

                        if confidence >= confidence_threshold:
                            # Create link
                            link_id = str(uuid.uuid4())
                            link = CodeDocumentationLink(
                                id=link_id,
                                file_path=symbol["file_path"],
                                line_number=symbol["line_number"],
                                symbol_name=symbol["name"],
                                symbol_type=symbol["type"],
                                documentation_entry_id=doc.id,
                                confidence=confidence,
                                relevance_score=confidence,
                            )

                            session.add(link)
                            links_created.append(
                                {
                                    "id": link_id,
                                    "file_path": symbol["file_path"],
                                    "symbol_name": symbol["name"],
                                    "documentation_title": doc.title,
                                    "documentation_url": doc.url,
                                    "confidence": confidence,
                                }
                            )

                await session.commit()

                return {
                    "success": True,
                    "project_path": project_path,
                    "links_created": len(links_created),
                    "links": links_created[:100],  # Limit response size
                    "confidence_threshold": confidence_threshold,
                    "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
                }

            except Exception as e:
                logger.error(
                    "Documentation-to-code linking failed",
                    project_path=project_path,
                    error=str(e),
                )
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_link_docs_to_code)

    async def get_scrape_job_status(self, job_id: str) -> dict[str, Any] | None:
        """Get status of a specific scrape job.

        Args:
            job_id: Job ID to check status for

        Returns:
            Job status details or None if not found
        """
        if not self._scrape_job_service:
            return None

        return await self._scrape_job_service.get_job_status(job_id)

    async def list_scrape_jobs(
        self,
        source_id: str | None = None,
        status_filter: list[str] | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """List scrape jobs with optional filtering.

        Args:
            source_id: Filter by source ID (optional)
            status_filter: Filter by job status (optional)
            limit: Maximum number of jobs to return

        Returns:
            List of jobs with metadata
        """
        if not self._scrape_job_service:
            return {
                "success": False,
                "error": "ScrapeJobService not initialized",
            }

        try:
            # Convert string status filter to enum if provided
            enum_status_filter = None
            if status_filter:
                from ..models import ScrapeJobStatus

                enum_status_filter = []
                for status_str in status_filter:
                    try:
                        enum_status_filter.append(ScrapeJobStatus(status_str.upper()))
                    except ValueError:
                        logger.warning(f"Invalid status filter: {status_str}")

            result = await self._scrape_job_service.list_jobs(
                status_filter=enum_status_filter, limit=limit
            )

            # Filter by source_id if provided
            if source_id and result.get("success"):
                filtered_jobs = [
                    job
                    for job in result.get("jobs", [])
                    if job.get("source_id") == source_id
                ]
                result["jobs"] = filtered_jobs
                result["total_returned"] = len(filtered_jobs)
                result["filtered_by_source"] = source_id

            return result

        except Exception as e:
            logger.error("Failed to list scrape jobs", error=str(e))
            return {
                "success": False,
                "error": str(e),
            }

    async def get_scraping_status(self, source_id: str | None = None) -> dict[str, Any]:
        """Get comprehensive scraping status for sources.

        Args:
            source_id: Check specific source (all sources if None)

        Returns:
            Scraping status with job queue information
        """
        if not self._scrape_job_service:
            return {
                "success": False,
                "error": "ScrapeJobService not initialized",
            }

        try:
            # Get all jobs if no specific source requested
            status_result = {
                "success": True,
                "source_id": source_id,
                "legacy_scrapers": {},
                "queued_jobs": [],
                "active_jobs": [],
                "completed_jobs": [],
                "failed_jobs": [],
            }

            # Check legacy scraper tracking
            if source_id:
                if source_id in self._running_scrapers:
                    status_result["legacy_scrapers"][source_id] = (
                        self._running_scrapers[source_id]
                    )
            else:
                status_result["legacy_scrapers"] = dict(self._running_scrapers)

            # Get job queue status
            jobs_result = await self._scrape_job_service.list_jobs(limit=100)
            if jobs_result.get("success"):
                for job in jobs_result.get("jobs", []):
                    job_source_id = job.get("source_id")

                    # Filter by source_id if specified
                    if source_id and job_source_id != source_id:
                        continue

                    job_status = job.get("status")
                    if job_status == ScrapeJobStatus.PENDING.value:
                        status_result["queued_jobs"].append(job)
                    elif job_status == ScrapeJobStatus.IN_PROGRESS.value:
                        status_result["active_jobs"].append(job)
                    elif job_status == ScrapeJobStatus.COMPLETED.value:
                        status_result["completed_jobs"].append(job)
                    elif job_status == ScrapeJobStatus.FAILED.value:
                        status_result["failed_jobs"].append(job)

            # Add summary counts
            status_result["summary"] = {
                "total_legacy_scrapers": len(status_result["legacy_scrapers"]),
                "total_queued": len(status_result["queued_jobs"]),
                "total_active": len(status_result["active_jobs"]),
                "total_completed": len(status_result["completed_jobs"]),
                "total_failed": len(status_result["failed_jobs"]),
                "has_active_work": len(status_result["active_jobs"]) > 0
                or len(status_result["legacy_scrapers"]) > 0,
            }

            return status_result

        except Exception as e:
            logger.error(
                "Failed to get scraping status", source_id=source_id, error=str(e)
            )
            return {
                "success": False,
                "error": str(e),
            }

    @staticmethod
    async def get_documentation_stats() -> dict[str, Any]:
        """Get comprehensive documentation statistics.

        Returns:
            Statistics about documentation sources, entries, and usage
        """

        async def _get_stats(session: AsyncSession):
            # Count sources
            source_count_stmt = select(func.count(DocumentationSource.id))
            source_count = await session.execute(source_count_stmt)
            total_sources = source_count.scalar() or 0

            # Count entries
            entry_count_stmt = select(func.count(DocumentationEntry.id))
            entry_count = await session.execute(entry_count_stmt)
            total_entries = entry_count.scalar() or 0

            # Count embeddings
            embedding_count_stmt = select(func.count(DocumentationEmbedding.id))
            embedding_count = await session.execute(embedding_count_stmt)
            total_embeddings = embedding_count.scalar() or 0

            # Count code links
            link_count_stmt = select(func.count(CodeDocumentationLink.id))
            link_count = await session.execute(link_count_stmt)
            total_links = link_count.scalar() or 0

            # Recent activity
            recent_date = datetime.now(timezone.utc) - timedelta(days=7)
            recent_entries_stmt = select(func.count(DocumentationEntry.id)).where(
                DocumentationEntry.extracted_at >= recent_date,
            )
            recent_entries = await session.execute(recent_entries_stmt)
            recent_entries_count = recent_entries.scalar() or 0

            return {
                "total_sources": total_sources,
                "total_entries": total_entries,
                "total_embeddings": total_embeddings,
                "total_code_links": total_links,
                "recent_entries_7_days": recent_entries_count,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        return await execute_query(_get_stats)

    async def create_embeddings_for_entry(self, entry_id: str) -> dict[str, Any]:
        """Create embeddings for a documentation entry.

        Args:
            entry_id: Documentation entry ID

        Returns:
            Result with embedding creation statistics
        """
        if not self._vector_service:
            return {"success": False, "error": "Vector service not initialized"}

        return await self._vector_service.create_embeddings_for_entry(entry_id)

    async def _scrape_documentation_direct(
        self,
        source_id: str,
        force_refresh: bool = False,
        ctx=None,
        progress_callback=None,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Direct scraping execution (legacy fallback when job service not available).

        This method preserves the original ThreadPool-based scraping behavior.
        """

        async def _get_source_for_scraping(session: AsyncSession):
            stmt = select(DocumentationSource).where(
                DocumentationSource.id == source_id
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

        # Get source configuration
        source_data = await execute_query(_get_source_for_scraping)
        if not source_data:
            return {
                "success": False,
                "error": f"Source {source_id} not found",
            }

        # Check if domain is already being scraped
        if domain_manager.is_domain_busy(source_data.url):
            domain_status = domain_manager.get_domain_status()

            # Extract domain safely
            from urllib.parse import urlparse

            try:
                parsed = urlparse(source_data.url)
                domain = parsed.netloc.lower().replace(".", "_").replace(":", "_")
            except Exception:
                domain = "unknown_domain"

            # Find which sources are currently using this domain
            active_sources = domain_status.get(domain, {}).get("active_sources", [])

            return {
                "success": True,
                "domain_busy": True,
                "reason": "Domain already being scraped",
                "domain": domain,
                "active_sources": active_sources,
                "message": f"Domain {domain} is already being scraped by sources: {', '.join(active_sources)}",
                "suggestion": f"Check status of existing scraping jobs: {', '.join(active_sources)}",
            }

        # Mark domain as busy to prevent concurrent scraping
        domain_manager.mark_domain_busy(source_data.url, source_id)

        # Update source status to in_progress
        async def _update_source_status(session: AsyncSession):
            stmt = (
                update(DocumentationSource)
                .where(DocumentationSource.id == source_id)
                .values(
                    status=DocumentationStatus.IN_PROGRESS,
                    last_scraped=datetime.now(timezone.utc),
                )
            )
            await session.execute(stmt)
            await session.commit()

        await execute_query(_update_source_status)

        # Use ThreadPoolExecutor for scraping (legacy fallback)
        try:
            logger.info(
                "🚀 Starting direct ThreadPool documentation scraping",
                source_id=source_id,
                url=source_data.url,
            )

            # Track the job for this source
            self._running_scrapers[source_id] = {
                "type": "threadpool_job",
                "started_at": datetime.now(timezone.utc),
                "url": source_data.url,
                "status": ScrapeJobStatus.IN_PROGRESS.value,
            }

            # Run scraping using ThreadPoolExecutor with isolated event loops
            scraping_result = await thread_pool_scraper.scrape_documentation(
                url=source_data.url,
                source_id=source_id,
                selectors=source_data.get_selectors(),
                crawl_depth=source_data.crawl_depth,
                batch_size=20,  # Process URLs in batches of 20
                allow_patterns=source_data.get_allow_patterns(),
                ignore_patterns=source_data.get_ignore_patterns(),
                include_subdomains=source_data.include_subdomains,
            )

            # Process and save the scraped results
            if scraping_result.get("success"):
                await self._store_scraped_entries(
                    source_id=source_id, entries_data=scraping_result.get("entries", [])
                )

                # Update source status to completed
                async def _complete_source_status(session: AsyncSession):
                    stmt = (
                        update(DocumentationSource)
                        .where(DocumentationSource.id == source_id)
                        .values(
                            status=DocumentationStatus.COMPLETED,
                            last_scraped=datetime.now(timezone.utc),
                        )
                    )
                    await session.execute(stmt)
                    await session.commit()

                await execute_query(_complete_source_status)

                # Update tracking
                self._running_scrapers[source_id][
                    "status"
                ] = ScrapeJobStatus.COMPLETED.value
                self._running_scrapers[source_id]["completed_at"] = datetime.now(
                    timezone.utc
                )
                self._running_scrapers[source_id]["pages_scraped"] = (
                    scraping_result.get("pages_scraped", 0)
                )

                logger.info(
                    "✅ Direct ThreadPool documentation scraping completed successfully",
                    source_id=source_id,
                    pages=scraping_result.get("pages_scraped", 0),
                )

                return {
                    "success": True,
                    "message": f"Documentation scraping completed successfully for {source_data.name}",
                    "source_id": source_id,
                    "scraping_in_progress": False,
                    "pages_scraped": scraping_result.get("pages_scraped", 0),
                    "entries_saved": len(scraping_result.get("entries", [])),
                    "scraped_urls": scraping_result.get("scraped_urls", []),
                    "failed_urls": scraping_result.get("failed_urls", []),
                    "using_job_queue": False,
                }
            else:
                # Handle scraping failure
                error_message = scraping_result.get("error", "Unknown scraping error")

                # Update source status to failed
                async def _fail_source_status(session: AsyncSession):
                    stmt = (
                        update(DocumentationSource)
                        .where(DocumentationSource.id == source_id)
                        .values(status=DocumentationStatus.FAILED)
                    )
                    await session.execute(stmt)
                    await session.commit()

                await execute_query(_fail_source_status)

                # Update tracking
                self._running_scrapers[source_id][
                    "status"
                ] = ScrapeJobStatus.FAILED.value
                self._running_scrapers[source_id]["error"] = error_message
                self._running_scrapers[source_id]["failed_at"] = datetime.now(
                    timezone.utc
                )

                logger.error(
                    "❌ Direct ThreadPool documentation scraping failed",
                    source_id=source_id,
                    error=error_message,
                )

                return {
                    "success": False,
                    "error": f"Scraping failed: {error_message}",
                    "source_id": source_id,
                }

        except Exception as e:
            # Handle unexpected errors
            logger.error(
                "❌ Unexpected error during direct ThreadPool scraping",
                source_id=source_id,
                error=str(e),
            )

            # Update source status to failed
            try:

                async def _error_source_status(session: AsyncSession):
                    stmt = (
                        update(DocumentationSource)
                        .where(DocumentationSource.id == source_id)
                        .values(status=DocumentationStatus.FAILED)
                    )
                    await session.execute(stmt)
                    await session.commit()

                await execute_query(_error_source_status)
            except Exception as db_error:
                logger.error(
                    "Failed to update source status after error",
                    source_id=source_id,
                    db_error=str(db_error),
                )

            # Update tracking
            if source_id in self._running_scrapers:
                self._running_scrapers[source_id][
                    "status"
                ] = ScrapeJobStatus.FAILED.value
                self._running_scrapers[source_id]["error"] = str(e)
                self._running_scrapers[source_id]["failed_at"] = datetime.now(
                    timezone.utc
                )

            return {
                "success": False,
                "error": f"Scraping execution failed: {str(e)}",
                "source_id": source_id,
            }

        finally:
            # Always release domain lock
            domain_manager.release_domain(source_data.url, source_id)

    # Private helper methods

    async def _ensure_worker_running(self):
        """Ensure a background worker is running to process pending jobs."""
        try:
            # Clean up completed worker tasks first
            await self._cleanup_completed_workers()
            
            # Check if there are any active workers already processing jobs
            if self._scrape_job_service:
                # Get queue stats to see if there are workers active
                stats = await self._scrape_job_service.get_queue_stats()

                if stats.get("success"):
                    active_workers = stats.get("active_workers", [])
                    pending_count = stats.get("queue_stats", {}).get("pending_count", 0)
                    tracked_workers = len(self._worker_tasks)

                    logger.debug(
                        f"Worker check: {len(active_workers)} active workers (DB), {tracked_workers} tracked worker tasks, {pending_count} pending jobs"
                    )

                    if pending_count > 0 and len(active_workers) == 0 and tracked_workers == 0:
                        logger.info(
                            f"🚀 Found {pending_count} pending jobs with no active workers, starting background worker..."
                        )

                        # Start a background worker with proper tracking
                        await self._start_tracked_worker()

                        logger.info(
                            "✅ Background scraper worker started automatically"
                        )

        except Exception as e:
            logger.warning("Failed to check/start background worker", error=str(e))

    async def _start_tracked_worker(self) -> str:
        """Start a background worker with proper task tracking and error handling."""
        from ..workers.scraper_worker import ScraperWorker
        import uuid
        
        # Generate unique worker ID
        worker_id = f"auto-worker-{uuid.uuid4().hex[:8]}"
        
        try:
            worker = ScraperWorker(worker_id=worker_id)
            
            # Create and track the worker task
            worker_task = asyncio.create_task(
                self._run_worker_with_monitoring(worker, worker_id)
            )
            
            # Store task reference for tracking
            self._worker_tasks[worker_id] = worker_task
            
            logger.info(
                "Started tracked background worker",
                worker_id=worker_id,
                task_id=id(worker_task)
            )
            
            return worker_id
            
        except Exception as e:
            logger.error(
                "Failed to start tracked worker",
                worker_id=worker_id,
                error=str(e)
            )
            raise

    async def _run_worker_with_monitoring(self, worker, worker_id: str):
        """Run worker with monitoring and error handling."""
        try:
            logger.info(f"Worker {worker_id} starting...")
            await worker.start()
            logger.info(f"Worker {worker_id} completed normally")
            
        except Exception as e:
            logger.error(
                f"Worker {worker_id} failed with exception",
                error=str(e),
                worker_id=worker_id
            )
            raise
        finally:
            # Remove from tracking when done (success or failure)
            if worker_id in self._worker_tasks:
                del self._worker_tasks[worker_id]
                logger.debug(f"Removed worker {worker_id} from tracking")

    async def _cleanup_completed_workers(self):
        """Clean up completed worker tasks from tracking."""
        completed_workers = []
        
        for worker_id, task in self._worker_tasks.items():
            if task.done():
                completed_workers.append(worker_id)
                
                # Log any exceptions from completed tasks
                try:
                    # This will raise the exception if the task failed
                    await task
                except Exception as e:
                    logger.error(
                        f"Completed worker {worker_id} had exception",
                        error=str(e),
                        worker_id=worker_id
                    )
        
        # Remove completed workers from tracking
        for worker_id in completed_workers:
            del self._worker_tasks[worker_id]
            logger.debug(f"Cleaned up completed worker {worker_id}")
        
        if completed_workers:
            logger.info(f"Cleaned up {len(completed_workers)} completed worker tasks")

    async def check_worker_health(self) -> dict[str, Any]:
        """Check health of all tracked workers and restart if needed."""
        try:
            health_stats: dict[str, Any] = {
                "tracked_workers": len(self._worker_tasks),
                "healthy_workers": 0,
                "failed_workers": 0,
                "restarted_workers": 0,
                "database_workers": 0,
                "pending_jobs": 0,
            }
            
            # Clean up completed workers first
            await self._cleanup_completed_workers()
            
            # Check database for active workers
            if self._scrape_job_service:
                stats = await self._scrape_job_service.get_queue_stats()
                if stats.get("success"):
                    health_stats["database_workers"] = len(stats.get("active_workers", []))
                    health_stats["pending_jobs"] = stats.get("queue_stats", {}).get("pending_count", 0)
            
            # Check each tracked worker
            for worker_id, task in list(self._worker_tasks.items()):
                if task.done():
                    # Check if it failed
                    try:
                        await task
                        health_stats["healthy_workers"] += 1
                    except Exception as e:
                        health_stats["failed_workers"] += 1
                        logger.error(f"Worker {worker_id} failed", error=str(e))
                else:
                    health_stats["healthy_workers"] += 1
            
            # Auto-restart workers if we have pending jobs but no active workers
            if (health_stats["pending_jobs"] > 0 and 
                health_stats["database_workers"] == 0 and 
                health_stats["tracked_workers"] == 0):
                
                logger.info(f"Auto-restarting worker: {health_stats['pending_jobs']} pending jobs, no active workers")
                try:
                    await self._start_tracked_worker()
                    health_stats["restarted_workers"] = 1
                except Exception as e:
                    logger.error("Failed to auto-restart worker", error=str(e))
            
            health_stats["timestamp"] = datetime.now(timezone.utc).isoformat()
            health_stats["status"] = "healthy" if health_stats["failed_workers"] == 0 else "degraded"
            
            return {"success": True, "health": health_stats}
            
        except Exception as e:
            logger.error("Failed to check worker health", error=str(e))
            return {"success": False, "error": str(e)}

    async def restart_failed_workers(self, max_workers: int = 1) -> dict[str, Any]:
        """Restart failed workers if there are pending jobs."""
        try:
            restart_stats = {
                "workers_restarted": 0,
                "errors": [],
            }
            
            # Check if restart is needed
            if self._scrape_job_service:
                stats = await self._scrape_job_service.get_queue_stats()
                if stats.get("success"):
                    active_workers = stats.get("active_workers", [])
                    pending_count = stats.get("queue_stats", {}).get("pending_count", 0)
                    
                    if pending_count > 0 and len(active_workers) == 0 and len(self._worker_tasks) == 0:
                        # Need to restart workers
                        workers_to_start = min(max_workers, pending_count)
                        
                        for i in range(workers_to_start):
                            try:
                                worker_id = await self._start_tracked_worker()
                                restart_stats["workers_restarted"] += 1
                                logger.info(f"Restarted worker {worker_id} ({i+1}/{workers_to_start})")
                            except Exception as e:
                                error_msg = f"Failed to restart worker {i+1}: {e}"
                                restart_stats["errors"].append(error_msg)
                                logger.error(error_msg)
            
            return {"success": True, "restart_stats": restart_stats}
            
        except Exception as e:
            logger.error("Failed to restart workers", error=str(e))
            return {"success": False, "error": str(e)}

    async def diagnose_stuck_jobs(self) -> dict[str, Any]:
        """Diagnose jobs that are stuck in pending or in_progress state."""
        try:
            
            async def _diagnose_jobs(session: AsyncSession):
                now = datetime.now(timezone.utc)
                diagnosis = {
                    "stuck_jobs": [],
                    "summary": {
                        "total_stuck": 0,
                        "long_pending": 0,
                        "long_running": 0,
                        "orphaned": 0,
                    },
                    "recommendations": [],
                }
                
                # Find jobs that have been pending or in_progress for too long
                stuck_threshold = timedelta(minutes=30)  # Jobs stuck for more than 30 minutes
                long_running_threshold = timedelta(hours=2)  # Jobs running for more than 2 hours
                
                # Query for potentially stuck jobs
                stmt = select(ScrapeJob).where(
                    or_(
                        ScrapeJob.status == ScrapeJobStatus.PENDING,
                        ScrapeJob.status == ScrapeJobStatus.IN_PROGRESS
                    )
                )
                result = await session.execute(stmt)
                jobs = result.scalars().all()
                
                for job in jobs:
                    job_age = now - job.created_at
                    last_activity_age = None
                    
                    # Use locked_at as heartbeat/activity indicator
                    if job.locked_at:
                        last_activity_age = now - job.locked_at
                    
                    is_stuck = False
                    stuck_reason = []
                    
                    # Check for various stuck conditions
                    if job.status == ScrapeJobStatus.PENDING and job_age > stuck_threshold:
                        is_stuck = True
                        stuck_reason.append(f"Pending for {job_age}")
                        diagnosis["summary"]["long_pending"] += 1
                    
                    elif job.status == ScrapeJobStatus.IN_PROGRESS:
                        if job_age > long_running_threshold:
                            is_stuck = True
                            stuck_reason.append(f"Running for {job_age}")
                            diagnosis["summary"]["long_running"] += 1
                        
                        if last_activity_age and last_activity_age > timedelta(minutes=10):
                            is_stuck = True
                            stuck_reason.append(f"No activity for {last_activity_age}")
                            diagnosis["summary"]["orphaned"] += 1
                    
                    if is_stuck:
                        diagnosis["stuck_jobs"].append({
                            "job_id": job.id,
                            "source_id": job.source_id,
                            "status": job.status.value,
                            "created_at": job.created_at.isoformat(),
                            "last_activity_at": job.locked_at.isoformat() if job.locked_at else None,
                            "locked_by": job.locked_by,
                            "job_age_minutes": int(job_age.total_seconds() / 60),
                            "stuck_reasons": stuck_reason,
                        })
                        diagnosis["summary"]["total_stuck"] += 1
                
                # Generate recommendations
                if diagnosis["summary"]["long_pending"] > 0:
                    diagnosis["recommendations"].append(
                        f"Found {diagnosis['summary']['long_pending']} jobs pending for >30min. Check if workers are running."
                    )
                
                if diagnosis["summary"]["orphaned"] > 0:
                    diagnosis["recommendations"].append(
                        f"Found {diagnosis['summary']['orphaned']} jobs with stale activity. Workers may have crashed."
                    )
                
                if diagnosis["summary"]["long_running"] > 0:
                    diagnosis["recommendations"].append(
                        f"Found {diagnosis['summary']['long_running']} jobs running for >2hrs. May need manual intervention."
                    )
                
                if diagnosis["summary"]["total_stuck"] == 0:
                    diagnosis["recommendations"].append("No stuck jobs detected. System appears healthy.")
                
                return diagnosis
            
            result = await execute_query(_diagnose_jobs)
            return {"success": True, "diagnosis": result}
            
        except Exception as e:
            logger.error("Failed to diagnose stuck jobs", error=str(e))
            return {"success": False, "error": str(e)}

    async def cleanup_stuck_jobs(self, max_age_hours: int = 4) -> dict[str, Any]:
        """Clean up jobs that have been stuck for too long."""
        try:
            
            async def _cleanup_jobs(session: AsyncSession):
                now = datetime.now(timezone.utc)
                cleanup_threshold = now - timedelta(hours=max_age_hours)
                cleanup_stats = {
                    "jobs_cleaned": 0,
                    "jobs_failed": 0,
                }
                
                # Find old stuck jobs
                stmt = select(ScrapeJob).where(
                    and_(
                        or_(
                            ScrapeJob.status == ScrapeJobStatus.PENDING,
                            ScrapeJob.status == ScrapeJobStatus.IN_PROGRESS
                        ),
                        ScrapeJob.created_at < cleanup_threshold
                    )
                )
                result = await session.execute(stmt)
                stuck_jobs = result.scalars().all()
                
                for job in stuck_jobs:
                    try:
                        # Mark job as failed
                        job.status = ScrapeJobStatus.FAILED
                        job.completed_at = now
                        job.error_message = f"Cleaned up after being stuck for >{max_age_hours}h"
                        
                        cleanup_stats["jobs_cleaned"] += 1
                        logger.info(f"Cleaned up stuck job {job.id} (age: {now - job.created_at})")
                        
                    except Exception as e:
                        cleanup_stats["jobs_failed"] += 1
                        logger.error(f"Failed to cleanup job {job.id}", error=str(e))
                
                await session.commit()
                return cleanup_stats
            
            result = await execute_query(_cleanup_jobs)
            return {"success": True, "cleanup_stats": result}
            
        except Exception as e:
            logger.error("Failed to cleanup stuck jobs", error=str(e))
            return {"success": False, "error": str(e)}

    def _should_skip_scraping(
        self,
        source: DocumentationSource,
        time_since_scrape: timedelta,
    ) -> bool:
        """Determine if scraping should be skipped based on update frequency."""
        frequency_map = {
            UpdateFrequency.HOURLY: timedelta(hours=1),
            UpdateFrequency.DAILY: timedelta(days=1),
            UpdateFrequency.WEEKLY: timedelta(weeks=1),
        }

        threshold = frequency_map.get(source.update_frequency, timedelta(days=1))
        return time_since_scrape < threshold

    async def is_scraping_running(self, source_id: str) -> bool:
        """Check if scraping is currently running for a source."""
        from ..models import ScrapeJobStatus

        # Check legacy tracking first
        if source_id in self._running_scrapers:
            scraper_info = self._running_scrapers[source_id]
            if (
                isinstance(scraper_info, dict)
                and scraper_info.get("status") == ScrapeJobStatus.IN_PROGRESS.value
            ):
                return True

        # Check job queue if available
        if self._scrape_job_service:
            try:
                jobs = await self._scrape_job_service.list_jobs(
                    status_filter=[
                        ScrapeJobStatus.PENDING,
                        ScrapeJobStatus.IN_PROGRESS,
                    ],
                    limit=100,
                )

                if jobs.get("success"):
                    for job in jobs.get("jobs", []):
                        if job.get("source_id") == source_id:
                            return True
            except Exception as e:
                logger.warning("Failed to check job queue status", error=str(e))

        return False

    async def _scrape_source_content_with_cleanup(
        self,
        source: DocumentationSource,
        source_id: str,
        ctx=None,
        progress_callback=None,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """Scrape content with automatic cleanup of task tracking and agent termination."""
        try:
            # Mark context as background mode to prevent spam in main chat
            if ctx:
                ctx._background_mode = True
                logger.debug(
                    "Context marked as background mode to prevent main chat spam"
                )

            result = await self._scrape_source_content(source, ctx, progress_callback)

            # Update last scraped timestamp on success
            if result.get("success"):
                await self._update_source_last_scraped(source_id)

            return result

        except Exception as e:
            logger.error(
                "Documentation scraping failed", source_id=source_id, error=str(e)
            )

            # Call progress callback for error
            if progress_callback:
                try:
                    await progress_callback(
                        {
                            "type": "error",
                            "source_id": source_id,
                            "error": str(e),
                            "fatal": True,
                        }
                    )
                except Exception as callback_error:
                    logger.warning(
                        "Progress callback failed during error",
                        error=str(callback_error),
                    )

            return {
                "success": False,
                "error": str(e),
            }
        finally:
            # Clean up task reference
            if source_id in self._running_scrapers:
                del self._running_scrapers[source_id]

            # Auto-terminate agent if provided
            if agent_id:
                try:
                    from .agent_service import AgentService

                    agent_service = AgentService()
                    await agent_service.terminate_agent(
                        agent_id,
                    )
                    logger.info(
                        "Auto-terminated agent after scraping completion",
                        agent_id=agent_id,
                    )
                except Exception as cleanup_error:
                    logger.warning(
                        "Failed to auto-terminate agent",
                        agent_id=agent_id,
                        error=str(cleanup_error),
                    )

    async def _scrape_source_content(
        self, source: DocumentationSource, ctx=None, progress_callback=None
    ) -> dict[str, Any]:
        """Scrape content from a documentation source using domain-managed browser."""
        try:
            # Get domain-managed scraper for this source
            scraper, is_new = await domain_manager.get_scraper_for_domain(
                source.url, source.id
            )
            logger.info(
                "Got domain scraper", source_id=source.id, domain_scraper_new=is_new
            )
        except Exception as e:
            logger.error(
                "Failed to get domain scraper", source_id=source.id, error=str(e)
            )
            return {
                "success": False,
                "error": f"Failed to get domain scraper: {str(e)}",
                "entries_scraped": 0,
                "entries_updated": 0,
                "errors": [],
            }

        try:
            logger.info(
                "🚀 Starting source scraping",
                source_id=source.id,
                source_name=source.name,
                url=source.url,
            )

            if ctx:
                try:
                    await ctx.report_progress(40, 100)
                except Exception as ctx_error:
                    logger.warning(
                        "Context progress reporting failed", error=str(ctx_error)
                    )

            # Get scraping configuration
            selectors = source.get_selectors()
            allow_patterns = source.get_allow_patterns()
            ignore_patterns = source.get_ignore_patterns()

            if ctx:
                try:
                    await ctx.report_progress(45, 100)
                except Exception as ctx_error:
                    logger.warning(
                        "Context progress reporting failed", error=str(ctx_error)
                    )

            # Scrape the documentation using domain-managed scraper
            scrape_result = await scraper.scrape_documentation_source(
                ctx=ctx,
                base_url=source.url,
                crawl_depth=source.crawl_depth,
                selectors=selectors if selectors else None,
                allow_patterns=allow_patterns if allow_patterns else None,
                ignore_patterns=ignore_patterns if ignore_patterns else None,
                progress_callback=progress_callback,
            )

            if not scrape_result.get("success"):
                return {
                    "success": False,
                    "error": scrape_result.get("error", "Unknown scraping error"),
                    "entries_scraped": 0,
                    "entries_updated": 0,
                    "errors": [scrape_result.get("error", "Unknown error")],
                }

            # Process and store the scraped entries
            entries_data = scrape_result.get("entries", [])

            if ctx:
                try:
                    await ctx.report_progress(85, 100)
                except Exception as ctx_error:
                    logger.warning(
                        "Context progress reporting failed", error=str(ctx_error)
                    )

            storage_result = await self._store_scraped_entries(source.id, entries_data)

            if ctx:
                try:
                    await ctx.report_progress(95, 100)
                except Exception as ctx_error:
                    logger.warning(
                        "Context progress reporting failed", error=str(ctx_error)
                    )

            logger.info(
                "✅ Source scraping completed",
                source_id=source.id,
                entries_scraped=len(entries_data),
                entries_stored=storage_result.get("entries_stored", 0),
            )

            return {
                "success": True,
                "entries_scraped": len(entries_data),
                "entries_updated": storage_result.get("entries_updated", 0),
                "entries_stored": storage_result.get("entries_stored", 0),
                "errors": storage_result.get("errors", []),
            }

        except Exception as e:
            logger.error("❌ Source scraping failed", source_id=source.id, error=str(e))
            return {
                "success": False,
                "error": str(e),
                "entries_scraped": 0,
                "entries_updated": 0,
                "errors": [str(e)],
            }
        finally:
            # Release domain scraper for this source
            try:
                await domain_manager.release_scraper_for_source(source.url, source.id)
                logger.info("Released domain scraper for source", source_id=source.id)
            except Exception as cleanup_error:
                logger.warning(
                    "Failed to release domain scraper",
                    source_id=source.id,
                    error=str(cleanup_error),
                )

    async def _store_scraped_entries(
        self, source_id: str, entries_data: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Store scraped entries in the database with deduplication."""

        async def _store_entries(session: AsyncSession):
            stats = {
                "entries_stored": 0,
                "entries_updated": 0,
                "entries_skipped": 0,
                "errors": [],
            }

            for entry_data in entries_data:
                try:
                    content_hash = entry_data.get("content_hash")
                    if not content_hash:
                        # Generate hash if not provided
                        content = entry_data.get("content", "")
                        content_hash = hashlib.sha256(content.encode()).hexdigest()

                    # Check if entry already exists by content hash
                    existing_stmt = select(DocumentationEntry).where(
                        DocumentationEntry.content_hash == content_hash
                    )
                    existing_result = await session.execute(existing_stmt)
                    existing_entry = existing_result.scalar_one_or_none()

                    if existing_entry:
                        # Update existing entry if content or URL changed
                        updated = False
                        if existing_entry.url != entry_data.get("url"):
                            existing_entry.url = entry_data.get(
                                "url", existing_entry.url
                            )
                            updated = True
                        if existing_entry.title != entry_data.get("title"):
                            existing_entry.title = entry_data.get(
                                "title", existing_entry.title
                            )
                            updated = True

                        if updated:
                            existing_entry.last_updated = datetime.now(timezone.utc)
                            stats["entries_updated"] += 1
                        else:
                            stats["entries_skipped"] += 1
                    else:
                        # Create new entry
                        new_entry = DocumentationEntry(
                            id=entry_data.get("id", str(uuid.uuid4())),
                            source_id=source_id,
                            url=entry_data.get("url", ""),
                            title=entry_data.get("title", ""),
                            content=entry_data.get("content", ""),
                            content_hash=content_hash,
                            extracted_at=entry_data.get(
                                "extracted_at", datetime.now(timezone.utc)
                            ),
                            section_type=SectionType.CONTENT,  # Default type
                        )

                        # Set metadata if provided
                        metadata = {
                            "links": entry_data.get("links", []),
                            "code_examples": entry_data.get("code_examples", []),
                        }
                        new_entry.set_metadata(metadata)

                        session.add(new_entry)
                        stats["entries_stored"] += 1

                        # Create embeddings if vector service is available
                        if self._vector_service:
                            try:
                                await self._vector_service.create_embeddings_for_entry(
                                    new_entry.id
                                )
                            except Exception as e:
                                logger.warning(
                                    "Failed to create embeddings",
                                    entry_id=new_entry.id,
                                    error=str(e),
                                )

                except Exception as e:
                    error_msg = (
                        f"Failed to store entry {entry_data.get('url', 'unknown')}: {e}"
                    )
                    logger.error("Entry storage failed", error=error_msg)
                    stats["errors"].append(error_msg)

            await session.commit()
            return stats

        return await execute_query(_store_entries)

    async def _update_source_last_scraped(self, source_id: str) -> None:
        """Update the last scraped timestamp for a source."""

        async def _update_timestamp(session: AsyncSession):
            stmt = (
                update(DocumentationSource)
                .where(
                    DocumentationSource.id == source_id,
                )
                .values(last_scraped=datetime.now(timezone.utc))
            )
            await session.execute(stmt)
            await session.commit()

        await execute_query(_update_timestamp)


# Helper functions


def _generate_change_recommendations(change_summary: dict[str, Any]) -> list[str]:
    """Generate recommendations based on change analysis."""
    recommendations = []

    if change_summary["by_impact"].get("breaking", 0) > 0:
        recommendations.append(
            "Review breaking changes for potential impact on existing integrations"
        )

    if change_summary["by_type"].get("updated", 0) > 5:
        recommendations.append(
            "High documentation update activity - consider reviewing for consistency"
        )

    if change_summary["by_type"].get("deleted", 0) > 0:
        recommendations.append(
            "Documentation deletions detected - verify if related code/links need updates"
        )

    return recommendations


async def _extract_project_symbols(
    project_path: str, file_patterns: list[str] | None = None
) -> list[dict[str, Any]]:
    """Extract symbols from project code (placeholder for integration with existing analysis)."""
    # This would integrate with existing AgentTreeGraph analysis
    # Placeholder implementation
    return [
        {
            "file_path": f"{project_path}/example.py",
            "line_number": 10,
            "name": "example_function",
            "type": "function",
        },
    ]


def _extract_keywords(text: str) -> list[str]:
    """Extract keywords from text for matching."""
    # Simple keyword extraction - could be enhanced with NLP
    import re

    words = re.findall(r"\b\w+\b", text.lower())
    # Filter out common words and keep meaningful terms
    meaningful_words = [
        w
        for w in words
        if len(w) > 3 and w not in ["the", "and", "for", "with", "this", "that"]
    ]
    return list(set(meaningful_words))


def _calculate_doc_code_confidence(
    doc_keywords: list[str], symbol: dict[str, Any]
) -> float:
    """Calculate confidence score for documentation-code linking."""
    # Simple keyword-based confidence calculation
    symbol_name = symbol["name"].lower()
    symbol_words = _extract_keywords(symbol_name)

    # Count keyword matches
    matches = set(doc_keywords) & set(symbol_words)
    if not doc_keywords:
        return 0.0

    confidence = len(matches) / len(doc_keywords)

    # Boost confidence for exact symbol name matches
    if any(keyword in symbol_name for keyword in doc_keywords):
        confidence = min(1.0, confidence * 1.5)

    return confidence
