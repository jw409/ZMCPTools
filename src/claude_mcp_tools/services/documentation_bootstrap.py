"""Documentation bootstrap service for auto-scheduling unscraped sources.

Automatically detects documentation sources that have never been scraped
and schedules them for immediate processing in the background.
"""

import asyncio
import structlog
from datetime import datetime, timezone
from typing import Optional

from ..database import DatabaseSession
from ..models.documentation import DocumentationSource, DocumentationEntry
from ..services.background_task_manager import submit_web_scraping_task, background_task_manager
from ..config import config
from sqlalchemy import select, func

logger = structlog.get_logger("documentation_bootstrap")


class DocumentationBootstrapService:
    """Service for bootstrapping unscraped documentation sources."""
    
    def __init__(self):
        self.processed_sources = set()
    
    async def bootstrap_unscraped_sources(self) -> dict:
        """Find and schedule unscraped documentation sources for immediate processing.
        
        Returns:
            Dict with bootstrap results including scheduled task count
        """
        # Check if auto bootstrap is enabled
        auto_bootstrap = config.get("documentation.auto_bootstrap", True)
        logger.info("🔍 Starting documentation bootstrap check", 
                   auto_bootstrap_enabled=auto_bootstrap,
                   max_concurrent=config.get("documentation.max_concurrent_scrapes", 3))
        
        if not auto_bootstrap:
            logger.info("⏭️ Auto bootstrap disabled in configuration")
            return {"unscraped_found": 0, "tasks_scheduled": 0, "auto_bootstrap_disabled": True}
        
        try:
            async with DatabaseSession() as session:
                # Find sources with no entries (never scraped)
                unscraped_sources = await self._find_unscraped_sources(session)
                
                if not unscraped_sources:
                    logger.info("✅ All documentation sources have been scraped")
                    return {"unscraped_found": 0, "tasks_scheduled": 0}
                
                logger.info(f"📚 Found {len(unscraped_sources)} unscraped documentation sources",
                           sources=[{"name": s.name, "url": s.url} for s in unscraped_sources])
                
                # Start background task manager if not already started
                if not background_task_manager._started:
                    logger.info("🚀 Starting background task manager for documentation scraping")
                    await background_task_manager.start()
                    logger.info("✅ Background task manager ready")
                else:
                    logger.info("✅ Background task manager already running")
                
                scheduled_count = 0
                
                # Schedule immediate scraping for each unscraped source
                for source in unscraped_sources:
                    if source.id not in self.processed_sources:
                        try:
                            task_id = await self._schedule_source_scraping(source)
                            self.processed_sources.add(source.id)
                            scheduled_count += 1
                            
                            logger.info(f"📝 Scheduled scraping for source: {source.name}",
                                       source_id=source.id, task_id=task_id)
                            
                            # Start a background task to monitor completion and save results
                            asyncio.create_task(self._monitor_and_save_results(source, task_id))
                        
                        except Exception as e:
                            logger.error(f"❌ Failed to schedule source: {source.name}",
                                       source_id=source.id, error=str(e))
                
                logger.info(f"✅ Bootstrap complete: {scheduled_count} sources scheduled for scraping")
                
                return {
                    "unscraped_found": len(unscraped_sources),
                    "tasks_scheduled": scheduled_count,
                    "sources": [{"id": s.id, "name": s.name, "url": s.url} for s in unscraped_sources]
                }
                
        except Exception as e:
            logger.error("❌ Bootstrap failed", error=str(e))
            return {"error": str(e), "unscraped_found": 0, "tasks_scheduled": 0}
    
    async def _find_unscraped_sources(self, session) -> list[DocumentationSource]:
        """Find documentation sources that have never been scraped (0 entries)."""
        
        # Query for sources with no entries
        query = (
            select(DocumentationSource)
            .outerjoin(DocumentationEntry, DocumentationSource.id == DocumentationEntry.source_id)
            .group_by(DocumentationSource.id)
            .having(func.count(DocumentationEntry.id) == 0)
            .where(DocumentationSource.status == "active")
        )
        
        result = await session.execute(query)
        return result.scalars().all()
    
    async def _schedule_source_scraping(self, source: DocumentationSource) -> str:
        """Schedule immediate scraping for a documentation source.
        
        Args:
            source: DocumentationSource to scrape
            
        Returns:
            Task ID for the scheduled scraping job
        """
        
        # Parse selectors if available
        selectors = None
        if source.selectors:
            try:
                import json
                selectors = json.loads(source.selectors) if isinstance(source.selectors, str) else source.selectors
            except Exception:
                logger.warning(f"Invalid selectors for source {source.name}, using defaults")
        
        # Parse patterns
        allow_patterns = None
        ignore_patterns = None
        
        if source.allow_patterns:
            try:
                import json
                allow_patterns = json.loads(source.allow_patterns) if isinstance(source.allow_patterns, str) else source.allow_patterns
            except Exception:
                logger.warning(f"Invalid allow_patterns for source {source.name}")
        
        if source.ignore_patterns:
            try:
                import json  
                ignore_patterns = json.loads(source.ignore_patterns) if isinstance(source.ignore_patterns, str) else source.ignore_patterns
            except Exception:
                logger.warning(f"Invalid ignore_patterns for source {source.name}")
        
        # Submit to background task manager
        task_id = await submit_web_scraping_task(
            source_id=str(source.id),
            url=source.url,
            selectors=selectors,
            crawl_depth=source.crawl_depth or 3,
            max_pages=50,  # Default max pages since model doesn't have this field
            allow_patterns=allow_patterns,
            ignore_patterns=ignore_patterns
        )
        
        return task_id
    
    async def _monitor_and_save_results(self, source: DocumentationSource, task_id: str):
        """Monitor task completion and save results to database."""
        from ..services.background_task_manager import get_scraping_task_status
        
        # Wait for task to complete (check every 5 seconds, max 10 minutes)
        max_wait_time = 600  # 10 minutes
        check_interval = 5   # 5 seconds
        elapsed_time = 0
        
        while elapsed_time < max_wait_time:
            try:
                task_status = get_scraping_task_status(str(source.id))
                
                if not task_status:
                    logger.error(f"❌ Task status not found for source: {source.name}", source_id=source.id)
                    return
                
                if task_status.status.value == "completed":
                    logger.info(f"✅ Task completed, saving results for source: {source.name}", source_id=source.id)
                    await self._save_scraping_results(source, task_status.result)
                    return
                
                elif task_status.status.value in ["failed", "cancelled"]:
                    logger.error(f"❌ Task {task_status.status.value} for source: {source.name}", 
                               source_id=source.id, error=task_status.error)
                    return
                
                # Still running, wait and check again
                await asyncio.sleep(check_interval)
                elapsed_time += check_interval
                
            except Exception as e:
                logger.error(f"❌ Error monitoring task for source: {source.name}", 
                           source_id=source.id, error=str(e))
                return
        
        logger.warning(f"⚠️ Task monitoring timed out for source: {source.name}", source_id=source.id)
    
    async def _save_scraping_results(self, source: DocumentationSource, result: dict):
        """Save scraping results to the database."""
        if not result or not result.get("success"):
            logger.error(f"❌ No valid results to save for source: {source.name}", source_id=source.id)
            return
        
        try:
            async with DatabaseSession() as session:
                from ..models.documentation import DocumentationEntry
                from datetime import datetime, timezone
                
                entries = result.get("entries", [])
                if not entries:
                    logger.warning(f"⚠️ No entries in results for source: {source.name}", source_id=source.id)
                    return
                
                saved_count = 0
                
                for entry_data in entries:
                    try:
                        # Create DocumentationEntry
                        entry = DocumentationEntry(
                            id=entry_data["id"],
                            source_id=str(source.id),
                            url=entry_data["url"],
                            title=entry_data["title"],
                            content=entry_data["content"],
                            content_hash=entry_data["content_hash"],
                            extracted_at=entry_data["extracted_at"],
                            section_type="content"  # Default section type
                        )
                        
                        session.add(entry)
                        saved_count += 1
                        
                    except Exception as e:
                        logger.error(f"❌ Failed to create entry for URL: {entry_data.get('url', 'unknown')}", 
                                   error=str(e))
                
                # Update source last_scraped timestamp
                source.last_scraped = datetime.now(timezone.utc)
                session.add(source)
                
                # Commit all changes
                await session.commit()
                
                logger.info(f"✅ Saved {saved_count} entries for source: {source.name}", 
                           source_id=source.id, total_entries=len(entries))
                
        except Exception as e:
            logger.error(f"❌ Failed to save scraping results for source: {source.name}", 
                       source_id=source.id, error=str(e))
    
    async def check_and_bootstrap_periodically(self, interval_minutes: int = 30):
        """Periodically check for new unscraped sources and bootstrap them.
        
        Args:
            interval_minutes: How often to check for new sources
        """
        logger.info(f"🔄 Starting periodic bootstrap check every {interval_minutes} minutes")
        
        while True:
            try:
                await asyncio.sleep(interval_minutes * 60)
                await self.bootstrap_unscraped_sources()
            except asyncio.CancelledError:
                logger.info("🛑 Periodic bootstrap check cancelled")
                break
            except Exception as e:
                logger.error("❌ Periodic bootstrap check failed", error=str(e))


# Global bootstrap service instance
documentation_bootstrap = DocumentationBootstrapService()


async def bootstrap_documentation_sources() -> dict:
    """Convenience function to bootstrap unscraped documentation sources.
    
    Returns:
        Dict with bootstrap results
    """
    return await documentation_bootstrap.bootstrap_unscraped_sources()