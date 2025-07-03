"""Documentation intelligence service using SQLAlchemy ORM."""

import asyncio
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import execute_query
from ..models import (
    CodeDocumentationLink,
    DocumentationChange,
    DocumentationEmbedding,
    DocumentationEntry,
    DocumentationSource,
    SectionType,
    SourceType,
    UpdateFrequency,
)
from .vector_service import get_vector_service
from .web_scraper import DocumentationScraper

logger = structlog.get_logger()


class DocumentationService:
    """Service for documentation intelligence operations using SQLAlchemy ORM."""

    def __init__(self, orchestration_path: Path | None = None):
        """Initialize documentation service.
        
        Args:
            orchestration_path: Path to orchestration data directory
        """
        if orchestration_path is None:
            self.orchestration_path = Path.home() / ".claude-orchestration"
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
        self._running_scrapers: dict[str, asyncio.Task] = {}
        self._web_scraper: DocumentationScraper | None = None

    async def initialize(self) -> None:
        """Initialize documentation service components."""
        try:
            # Initialize vector service (ChromaDB)
            self._vector_service = await get_vector_service(self.vector_db_path)

            # Initialize web scraper
            self._web_scraper = DocumentationScraper(headless=True)
            scraper_user_data = self.docs_path / "browser_data"
            await self._web_scraper.initialize(user_data_dir=scraper_user_data)

            logger.info("Documentation service initialized",
                       docs_path=str(self.docs_path))

        except Exception as e:
            logger.error("Failed to initialize documentation service", error=str(e))
            raise

    async def cleanup(self) -> None:
        """Clean up documentation service resources."""
        try:
            # Stop all running scrapers
            for scraper_id, task in self._running_scrapers.items():
                if not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass

            # Close web scraper
            if self._web_scraper:
                await self._web_scraper.close()
                self._web_scraper = None

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
        ignore_patterns: list[str] | None = None,
    ) -> dict[str, Any]:
        """Add a new documentation source for scraping.
        
        Args:
            name: Human-readable name for the source
            url: Base URL for documentation
            source_type: Type of documentation (api, guide, reference, tutorial)
            crawl_depth: Maximum depth for crawling
            update_frequency: How often to update (hourly, daily, weekly)
            selectors: CSS selectors for content extraction
            ignore_patterns: URL patterns to ignore during crawling
            
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
                    source_type=SourceType(source_type),
                    crawl_depth=crawl_depth,
                    update_frequency=UpdateFrequency(update_frequency),
                    status="active",
                )

                # Set selectors and ignore patterns
                if selectors:
                    source.set_selectors(selectors)
                if ignore_patterns:
                    source.set_ignore_patterns(ignore_patterns)

                # Add to session
                session.add(source)
                await session.commit()

                logger.info("Documentation source created",
                           source_id=source_id,
                           name=name,
                           url=url,
                           source_type=source_type)

                return {
                    "success": True,
                    "source_id": source_id,
                    "name": name,
                    "url": url,
                    "source_type": source_type,
                    "created_at": source.created_at.isoformat(),
                }

            except Exception as e:
                logger.error("Failed to create documentation source",
                            name=name, url=url, error=str(e))
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
            stmt = select(DocumentationSource).where(DocumentationSource.id == source_id)
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
                "last_scraped": source.last_scraped.isoformat() if source.last_scraped else None,
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

                source_list.append({
                    "id": source.id,
                    "name": source.name,
                    "url": source.url,
                    "source_type": source.source_type.value,
                    "last_scraped": source.last_scraped.isoformat() if source.last_scraped else None,
                    "entry_count": entry_count,
                    "status": source.status,
                })

            return source_list

        return await execute_query(_list_sources)

    async def scrape_documentation(
        self,
        source_id: str,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        """Scrape documentation from a configured source.
        
        Args:
            source_id: ID of the documentation source
            force_refresh: Force refresh even if recently scraped
            
        Returns:
            Scraping result with statistics
        """
        async def _get_source_for_scraping(session: AsyncSession):
            stmt = select(DocumentationSource).where(DocumentationSource.id == source_id)
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

        # Get source configuration
        source_data = await execute_query(_get_source_for_scraping)
        if not source_data:
            return {
                "success": False,
                "error": f"Source {source_id} not found",
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

        # Start scraping task
        scraper_task = asyncio.create_task(
            self._scrape_source_content(source_data),
        )

        self._running_scrapers[source_id] = scraper_task

        try:
            result = await scraper_task

            # Update last scraped timestamp
            await self._update_source_last_scraped(source_id)

            return result

        except Exception as e:
            logger.error("Documentation scraping failed",
                        source_id=source_id, error=str(e))
            return {
                "success": False,
                "error": str(e),
            }
        finally:
            # Clean up task reference
            if source_id in self._running_scrapers:
                del self._running_scrapers[source_id]

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
                    content_type_enums = [SectionType(ct) for ct in content_types if ct in SectionType]
                    if content_type_enums:
                        stmt = stmt.where(DocumentationEntry.section_type.in_(content_type_enums))

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
                        text_results.append({
                            "id": entry.id,
                            "title": entry.title,
                            "url": entry.url,
                            "content": entry.content[:500] + "..." if len(entry.content) > 500 else entry.content,
                            "source_name": entry.source.name,
                            "section_type": entry.section_type.value,
                            "relevance_score": relevance,
                            "search_method": "text",
                            "last_updated": entry.last_updated.isoformat() if entry.last_updated else None,
                        })

            # Combine results
            if search_type == "hybrid":
                # Create combined results with unique entries
                seen_ids = set()
                combined_results = []

                # Add vector results first (typically higher quality)
                for vr in vector_results:
                    if vr["entry_id"] not in seen_ids:
                        # Get entry details from database
                        entry_stmt = select(DocumentationEntry).options(
                            selectinload(DocumentationEntry.source),
                        ).where(DocumentationEntry.id == vr["entry_id"])
                        entry_result = await session.execute(entry_stmt)
                        entry = entry_result.scalar_one_or_none()

                        if entry:
                            combined_results.append({
                                "id": entry.id,
                                "title": entry.title,
                                "url": entry.url,
                                "content": vr["content"],
                                "source_name": entry.source.name,
                                "section_type": entry.section_type.value,
                                "relevance_score": vr["similarity_score"],
                                "search_method": "vector",
                                "last_updated": entry.last_updated.isoformat() if entry.last_updated else None,
                            })
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
                    entry_stmt = select(DocumentationEntry).options(
                        selectinload(DocumentationEntry.source),
                    ).where(DocumentationEntry.id == vr["entry_id"])
                    entry_result = await session.execute(entry_stmt)
                    entry = entry_result.scalar_one_or_none()

                    if entry:
                        results.append({
                            "id": entry.id,
                            "title": entry.title,
                            "url": entry.url,
                            "content": vr["content"],
                            "source_name": entry.source.name,
                            "section_type": entry.section_type.value,
                            "relevance_score": vr["similarity_score"],
                            "search_method": "vector",
                            "last_updated": entry.last_updated.isoformat() if entry.last_updated else None,
                        })

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
                "search_timestamp": datetime.utcnow().isoformat(),
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
                stmt = select(DocumentationSource).where(DocumentationSource.id == source_id)
            elif source_name:
                stmt = select(DocumentationSource).where(DocumentationSource.name == source_name)
            else:
                stmt = select(DocumentationSource).where(DocumentationSource.status == "active")

            result = await session.execute(stmt)
            sources = result.scalars().all()

            for source in sources:
                try:
                    # Check if update is needed
                    if not force_refresh and source.last_scraped:
                        time_since_scrape = datetime.utcnow() - source.last_scraped
                        frequency_map = {
                            UpdateFrequency.HOURLY: timedelta(hours=1),
                            UpdateFrequency.DAILY: timedelta(days=1),
                            UpdateFrequency.WEEKLY: timedelta(weeks=1),
                        }
                        threshold = frequency_map.get(source.update_frequency, timedelta(days=1))

                        if time_since_scrape < threshold:
                            continue

                    # Update source (this would trigger scraping)
                    update_stats["sources_updated"] += 1

                    # Update timestamp
                    source.last_scraped = datetime.utcnow()

                except Exception as e:
                    logger.error("Failed to update documentation source",
                                source_id=source.id, error=str(e))
                    update_stats["errors"].append({
                        "source_id": source.id,
                        "source_name": source.name,
                        "error": str(e),
                    })

            await session.commit()

            return {
                "success": True,
                "update_stats": update_stats,
                "updated_at": datetime.utcnow().isoformat(),
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
            since_date = datetime.utcnow() - timedelta(days=days_back)

            # Build query for changes
            stmt = select(DocumentationChange).options(
                selectinload(DocumentationChange.entry),
            ).where(DocumentationChange.detected_at >= since_date)

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
                change_summary["by_type"][change_type] = change_summary["by_type"].get(change_type, 0) + 1

                # Count by impact
                impact = change.impact_level
                change_summary["by_impact"][impact] = change_summary["by_impact"].get(impact, 0) + 1

                # High impact changes
                if impact_order.get(impact, 0) >= threshold_level:
                    change_summary["high_impact_changes"].append({
                        "id": change.id,
                        "entry_title": change.entry.title if change.entry else "Unknown",
                        "entry_url": change.entry.url if change.entry else "Unknown",
                        "change_type": change.change_type,
                        "impact_level": change.impact_level,
                        "description": change.description,
                        "detected_at": change.detected_at.isoformat(),
                    })

            return {
                "success": True,
                "analysis_period": {
                    "since": since_date.isoformat(),
                    "until": datetime.utcnow().isoformat(),
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
                project_symbols = await _extract_project_symbols(project_path, file_patterns)

                # Perform AI-powered linking analysis (placeholder)
                links_created = []

                # For each documentation entry, find matching code symbols
                for doc in docs:
                    # Simple keyword matching for now (would be enhanced with AI)
                    doc_keywords = _extract_keywords(doc.title + " " + doc.content[:1000])

                    for symbol in project_symbols:
                        # Calculate confidence based on keyword overlap
                        confidence = _calculate_doc_code_confidence(doc_keywords, symbol)

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
                            links_created.append({
                                "id": link_id,
                                "file_path": symbol["file_path"],
                                "symbol_name": symbol["name"],
                                "documentation_title": doc.title,
                                "documentation_url": doc.url,
                                "confidence": confidence,
                            })

                await session.commit()

                return {
                    "success": True,
                    "project_path": project_path,
                    "links_created": len(links_created),
                    "links": links_created[:100],  # Limit response size
                    "confidence_threshold": confidence_threshold,
                    "analysis_timestamp": datetime.utcnow().isoformat(),
                }

            except Exception as e:
                logger.error("Documentation-to-code linking failed",
                            project_path=project_path, error=str(e))
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_link_docs_to_code)

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
            recent_date = datetime.utcnow() - timedelta(days=7)
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
                "generated_at": datetime.utcnow().isoformat(),
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

    # Private helper methods


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

    async def _scrape_source_content(self, source: DocumentationSource) -> dict[str, Any]:
        """Scrape content from a documentation source using Patchright."""
        if not self._web_scraper:
            return {
                "success": False,
                "error": "Web scraper not initialized",
                "entries_scraped": 0,
                "entries_updated": 0,
                "errors": [],
            }

        try:
            logger.info("🚀 Starting source scraping", 
                       source_id=source.id, 
                       source_name=source.name, 
                       url=source.url)

            # Get scraping configuration
            selectors = source.get_selectors()
            ignore_patterns = source.get_ignore_patterns()

            # Scrape the documentation
            scrape_result = await self._web_scraper.scrape_documentation_source(
                base_url=source.url,
                crawl_depth=source.crawl_depth,
                selectors=selectors if selectors else None,
                ignore_patterns=ignore_patterns if ignore_patterns else None,
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
            storage_result = await self._store_scraped_entries(source.id, entries_data)

            logger.info("✅ Source scraping completed", 
                       source_id=source.id,
                       entries_scraped=len(entries_data),
                       entries_stored=storage_result.get("entries_stored", 0))

            return {
                "success": True,
                "entries_scraped": len(entries_data),
                "entries_updated": storage_result.get("entries_updated", 0),
                "entries_stored": storage_result.get("entries_stored", 0),
                "errors": storage_result.get("errors", []),
            }

        except Exception as e:
            logger.error("❌ Source scraping failed", 
                        source_id=source.id, 
                        error=str(e))
            return {
                "success": False,
                "error": str(e),
                "entries_scraped": 0,
                "entries_updated": 0,
                "errors": [str(e)],
            }

    async def _store_scraped_entries(self, source_id: str, entries_data: list[dict[str, Any]]) -> dict[str, Any]:
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
                            existing_entry.url = entry_data.get("url", existing_entry.url)
                            updated = True
                        if existing_entry.title != entry_data.get("title"):
                            existing_entry.title = entry_data.get("title", existing_entry.title)
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
                            extracted_at=entry_data.get("extracted_at", datetime.now(timezone.utc)),
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
                                await self._vector_service.create_embeddings_for_entry(new_entry.id)
                            except Exception as e:
                                logger.warning("Failed to create embeddings", 
                                             entry_id=new_entry.id, 
                                             error=str(e))

                except Exception as e:
                    error_msg = f"Failed to store entry {entry_data.get('url', 'unknown')}: {e}"
                    logger.error("Entry storage failed", error=error_msg)
                    stats["errors"].append(error_msg)

            await session.commit()
            return stats

        return await execute_query(_store_entries)

    async def _update_source_last_scraped(self, source_id: str) -> None:
        """Update the last scraped timestamp for a source."""
        async def _update_timestamp(session: AsyncSession):
            stmt = update(DocumentationSource).where(
                DocumentationSource.id == source_id,
            ).values(last_scraped=datetime.now(timezone.utc))
            await session.execute(stmt)
            await session.commit()

        await execute_query(_update_timestamp)


# Helper functions

def _generate_change_recommendations(change_summary: dict[str, Any]) -> list[str]:
    """Generate recommendations based on change analysis."""
    recommendations = []

    if change_summary["by_impact"].get("breaking", 0) > 0:
        recommendations.append("Review breaking changes for potential impact on existing integrations")

    if change_summary["by_type"].get("updated", 0) > 5:
        recommendations.append("High documentation update activity - consider reviewing for consistency")

    if change_summary["by_type"].get("deleted", 0) > 0:
        recommendations.append("Documentation deletions detected - verify if related code/links need updates")

    return recommendations


async def _extract_project_symbols(project_path: str, file_patterns: list[str] | None = None) -> list[dict[str, Any]]:
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
    meaningful_words = [w for w in words if len(w) > 3 and w not in ["the", "and", "for", "with", "this", "that"]]
    return list(set(meaningful_words))


def _calculate_doc_code_confidence(doc_keywords: list[str], symbol: dict[str, Any]) -> float:
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
