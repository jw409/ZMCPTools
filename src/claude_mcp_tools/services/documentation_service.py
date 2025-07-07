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
        self._scrape_job_service: ScrapeJobService | None = None

    async def initialize(self) -> None:
        """Initialize documentation service components."""
        try:
            # Initialize vector service (ChromaDB)
            self._vector_service = await get_vector_service(self.vector_db_path)

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
            return {
                "success": False,
                "error": "ScrapeJobService not initialized",
            }

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

        # Check if scraping is currently running through job queue
        if await self._is_scraping_via_jobs(source_id):
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
            if self._should_skip_based_on_frequency(source_data, time_since_scrape):
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

            # Note: Background workers are managed externally via ScraperWorker processes
            logger.info(
                "Documentation scraping job queued successfully - ensure ScraperWorker is running to process",
                source_id=source_id,
                job_id=job_result.get("job_id"),
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
                "recommendations": DocumentationService._generate_change_recommendations(change_summary),
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
                project_symbols = await DocumentationService._extract_project_symbols(
                    project_path, file_patterns
                )

                # Perform AI-powered linking analysis (placeholder)
                links_created = []

                # For each documentation entry, find matching code symbols
                for doc in docs:
                    # Simple keyword matching for now (would be enhanced with AI)
                    doc_keywords = DocumentationService._extract_keywords(
                        doc.title + " " + doc.content[:1000]
                    )

                    for symbol in project_symbols:
                        # Calculate confidence based on keyword overlap
                        confidence = DocumentationService._calculate_doc_code_confidence(
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

            # Legacy scraper tracking removed - using only job queue

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

    # =============================================================================
    # MCP-SAFE DATABASE ACCESS METHODS
    # =============================================================================

    @staticmethod
    async def list_documentation_sources_safe() -> list[dict[str, Any]]:
        """List all documentation sources with MCP-safe database access.
        
        This method uses MCP-safe database access patterns to prevent 
        communication channel conflicts in FastMCP resource handlers.
        
        Returns:
            List of documentation sources with essential metadata
        """
        from ..database import mcp_safe_execute_query
        
        async def _list_sources_safe(session):
            # Streamlined query to minimize session lifetime - no entry counts
            stmt = select(DocumentationSource).order_by(DocumentationSource.name)
            result = await session.execute(stmt)
            sources = result.scalars().all()
            
            source_list = []
            for source in sources:
                source_list.append({
                    "id": source.id,
                    "name": source.name,
                    "url": source.url,
                    "source_type": source.source_type.value,
                    "last_scraped": (
                        source.last_scraped.isoformat()
                        if source.last_scraped
                        else None
                    ),
                    "status": source.status.value,
                    # Skip entry_count for speed - can be fetched separately if needed
                })
            
            return source_list
        
        try:
            result = await mcp_safe_execute_query(_list_sources_safe, timeout=3.0)
            return result if result is not None else []
        except Exception as e:
            logger.error("MCP-safe list_documentation_sources failed", error=str(e))
            return []
    
    @staticmethod
    async def get_documentation_source_safe(source_id: str) -> dict[str, Any] | None:
        """Get documentation source by ID with MCP-safe database access.
        
        This method uses MCP-safe database access patterns to prevent 
        communication channel conflicts in FastMCP resource handlers.
        
        Args:
            source_id: Source ID to retrieve
            
        Returns:
            Source information or None if not found
        """
        from ..database import mcp_safe_execute_query
        
        async def _get_source_safe(session):
            stmt = select(DocumentationSource).where(
                DocumentationSource.id == source_id
            )
            result = await session.execute(stmt)
            source = result.scalar_one_or_none()
            
            if not source:
                return None
            
            # Skip entry count query for speed - can be fetched separately if needed
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
                "status": source.status.value,
                "created_at": source.created_at.isoformat(),
                "updated_at": source.updated_at.isoformat(),
                # entry_count omitted for speed
            }
        
        try:
            result = await mcp_safe_execute_query(_get_source_safe, timeout=3.0)
            return result
        except Exception as e:
            logger.error("MCP-safe get_documentation_source failed", source_id=source_id, error=str(e))
            return None
    
    @staticmethod
    async def get_documentation_stats_safe() -> dict[str, Any]:
        """Get comprehensive documentation statistics with MCP-safe database access.
        
        This method uses MCP-safe database access patterns to prevent 
        communication channel conflicts in FastMCP resource handlers.
        
        Returns:
            Statistics about documentation sources, entries, and usage
        """
        from ..database import mcp_safe_execute_query
        
        async def _get_stats_safe(session):
            # Use separate simple queries instead of complex joins
            
            # Count sources
            source_count_stmt = select(func.count(DocumentationSource.id))
            source_count = await session.execute(source_count_stmt)
            total_sources = source_count.scalar() or 0
            
            # Count entries
            entry_count_stmt = select(func.count(DocumentationEntry.id))
            entry_count = await session.execute(entry_count_stmt)
            total_entries = entry_count.scalar() or 0
            
            # Count embeddings (use hasattr check for safety)
            total_embeddings = 0
            if hasattr(session, 'execute'):
                try:
                    embedding_count_stmt = select(func.count(DocumentationEmbedding.id))
                    embedding_count = await session.execute(embedding_count_stmt)
                    total_embeddings = embedding_count.scalar() or 0
                except Exception:
                    # Graceful degradation if embedding table doesn't exist
                    total_embeddings = 0
            
            # Count code links (use hasattr check for safety)
            total_links = 0
            if hasattr(session, 'execute'):
                try:
                    link_count_stmt = select(func.count(CodeDocumentationLink.id))
                    link_count = await session.execute(link_count_stmt)
                    total_links = link_count.scalar() or 0
                except Exception:
                    # Graceful degradation if link table doesn't exist
                    total_links = 0
            
            # Recent activity (simplified)
            recent_entries_count = 0
            try:
                recent_date = datetime.now(timezone.utc) - timedelta(days=7)
                recent_entries_stmt = select(func.count(DocumentationEntry.id)).where(
                    DocumentationEntry.extracted_at >= recent_date,
                )
                recent_entries = await session.execute(recent_entries_stmt)
                recent_entries_count = recent_entries.scalar() or 0
            except Exception:
                # Graceful degradation if date filtering fails
                recent_entries_count = 0
            
            return {
                "total_sources": total_sources,
                "total_entries": total_entries,
                "total_embeddings": total_embeddings,
                "total_code_links": total_links,
                "recent_entries_7_days": recent_entries_count,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
        
        try:
            result = await mcp_safe_execute_query(_get_stats_safe, timeout=3.0)
            return result if result is not None else {
                "total_sources": 0,
                "total_entries": 0,
                "total_embeddings": 0,
                "total_code_links": 0,
                "recent_entries_7_days": 0,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error("MCP-safe get_documentation_stats failed", error=str(e))
            return {
                "error": f"Database error: {e}",
                "total_sources": 0,
                "total_entries": 0,
                "total_embeddings": 0,
                "total_code_links": 0,
                "recent_entries_7_days": 0,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

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

    async def _is_scraping_via_jobs(self, source_id: str) -> bool:
        """Check if scraping is currently running for a source via job queue."""
        if not self._scrape_job_service:
            return False
        
        try:
            # Check for active jobs for this source
            jobs_result = await self._scrape_job_service.list_jobs(limit=10)
            if jobs_result.get("success"):
                for job in jobs_result.get("jobs", []):
                    if (job.get("source_id") == source_id and 
                        job.get("status") in ["PENDING", "IN_PROGRESS"]):
                        return True
            return False
        except Exception as e:
            logger.error("Error checking scraping status", source_id=source_id, error=str(e))
            return False

    def _should_skip_based_on_frequency(self, source_data: Any, time_since_scrape: timedelta) -> bool:
        """Check if scraping should be skipped based on update frequency."""
        frequency_map = {
            UpdateFrequency.HOURLY: timedelta(hours=1),
            UpdateFrequency.DAILY: timedelta(days=1),
            UpdateFrequency.WEEKLY: timedelta(weeks=1),
        }
        threshold = frequency_map.get(source_data.update_frequency, timedelta(days=1))
        return time_since_scrape < threshold

    @staticmethod
    def _generate_change_recommendations(change_summary: dict[str, Any]) -> list[str]:
        """Generate recommendations based on documentation changes."""
        recommendations = []
        
        high_impact_count = len(change_summary.get("high_impact_changes", []))
        total_changes = change_summary.get("total_changes", 0)
        
        if high_impact_count > 0:
            recommendations.append(f"Review {high_impact_count} high-impact documentation changes")
        
        if total_changes > 10:
            recommendations.append("Consider updating related code due to significant documentation changes")
        
        breaking_changes = change_summary.get("by_impact", {}).get("breaking", 0)
        if breaking_changes > 0:
            recommendations.append(f"Critical: {breaking_changes} breaking changes detected - immediate review required")
            
        return recommendations

    @staticmethod
    async def _extract_project_symbols(project_path: str, file_patterns: list[str] | None = None) -> list[dict[str, Any]]:
        """Extract symbols from project files (placeholder implementation)."""
        # This is a placeholder - would integrate with actual code analysis
        symbols = []
        
        # Default patterns if none provided
        if not file_patterns:
            file_patterns = ["*.py", "*.js", "*.ts", "*.tsx"]
        
        # Placeholder symbol extraction
        symbols.append({
            "name": "example_function",
            "type": "function",
            "file_path": f"{project_path}/example.py",
            "line_number": 1,
        })
        
        return symbols

    @staticmethod
    def _extract_keywords(text: str) -> list[str]:
        """Extract keywords from text content."""
        # Simple keyword extraction - would be enhanced with NLP
        import re
        
        # Remove HTML tags and normalize
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'[^\w\s]', ' ', text)
        
        # Split into words and filter
        words = text.lower().split()
        keywords = [word for word in words if len(word) > 3 and word.isalpha()]
        
        # Return unique keywords
        return list(set(keywords[:20]))  # Limit to 20 keywords

    @staticmethod
    def _calculate_doc_code_confidence(doc_keywords: list[str], symbol: dict[str, Any]) -> float:
        """Calculate confidence score for doc-to-code linking."""
        symbol_name = symbol.get("name", "").lower()
        symbol_file = symbol.get("file_path", "").lower()
        
        # Simple keyword matching confidence
        matches = 0
        for keyword in doc_keywords:
            if keyword in symbol_name or keyword in symbol_file:
                matches += 1
        
        # Calculate confidence based on matches
        if not doc_keywords:
            return 0.0
        
        confidence = min(1.0, matches / len(doc_keywords))
        return confidence

    @staticmethod
    async def get_documentation_source_entries_safe(source_id: str) -> dict[str, Any]:
        """Get documentation entries for a source with MCP-safe database access.
        
        This method uses MCP-safe database access patterns to prevent 
        communication channel conflicts in FastMCP resource handlers.
        
        Args:
            source_id: Source ID to get entries for
            
        Returns:
            Dictionary with source entries and metadata
        """
        from ..database import mcp_safe_execute_query
        
        async def _get_source_entries_safe(session):
            # First verify the source exists with a simple query
            source_stmt = select(DocumentationSource).where(
                DocumentationSource.id == source_id
            )
            source_result = await session.execute(source_stmt)
            source = source_result.scalar_one_or_none()
            
            if not source:
                return {
                    "source_id": source_id,
                    "status": "not_found",
                    "error": "Documentation source not found",
                }
            
            # Get entries for this source - streamlined query without eager loading
            entries_stmt = select(DocumentationEntry).where(
                DocumentationEntry.source_id == source_id
            ).order_by(
                DocumentationEntry.last_updated.desc()
            ).limit(50)  # Reduced limit for faster execution
            
            entries_result = await session.execute(entries_stmt)
            entries = entries_result.scalars().all()
            
            # Count total entries in separate query
            count_stmt = select(func.count(DocumentationEntry.id)).where(
                DocumentationEntry.source_id == source_id
            )
            count_result = await session.execute(count_stmt)
            total_entries = count_result.scalar() or 0
            
            # Format entries quickly
            entry_list = []
            for entry in entries:
                entry_list.append({
                    "id": entry.id,
                    "title": entry.title,
                    "url": entry.url,
                    "content_preview": entry.content[:200] + "..." if len(entry.content) > 200 else entry.content,
                    "content_length": len(entry.content),
                    "section_type": entry.section_type.value if hasattr(entry, 'section_type') else "unknown",
                    "extracted_at": entry.extracted_at.isoformat() if hasattr(entry, 'extracted_at') and entry.extracted_at else None,
                    "last_updated": entry.last_updated.isoformat() if hasattr(entry, 'last_updated') and entry.last_updated else None,
                    "content_hash": entry.content_hash if hasattr(entry, 'content_hash') else None,
                })
            
            return {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source_id": source_id,
                "source_name": source.name,
                "source_url": source.url,
                "total_entries": total_entries,
                "entries_returned": len(entry_list),
                "entries_limit": 50,
                "entries": entry_list,
            }
        
        try:
            result = await mcp_safe_execute_query(_get_source_entries_safe, timeout=3.0)
            return result if result is not None else {
                "source_id": source_id,
                "status": "error",
                "error": "Database timeout or connection error",
                "entries": [],
                "total_entries": 0,
            }
        except Exception as e:
            logger.error("MCP-safe get_documentation_source_entries failed", 
                        source_id=source_id, error=str(e))
            return {
                "error": f"Database error: {e}",
                "source_id": source_id,
                "entries": [],
                "total_entries": 0,
            }

