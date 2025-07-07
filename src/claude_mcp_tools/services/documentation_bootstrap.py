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
from ..services.scrape_job_service import ScrapeJobService
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
                
                # Initialize scrape job service
                job_service = ScrapeJobService()
                logger.info("✅ Scrape job service ready for documentation scraping")
                
                scheduled_count = 0
                
                # Schedule immediate scraping for each unscraped source
                for source in unscraped_sources:
                    if source.id not in self.processed_sources:
                        try:
                            task_id = await self._schedule_source_scraping(source, job_service)
                            self.processed_sources.add(source.id)
                            scheduled_count += 1
                            
                            logger.info(f"📝 Scheduled scraping for source: {source.name}",
                                       source_id=source.id, task_id=task_id)
                            
                            # Start a background task to monitor completion and save results
                            asyncio.create_task(self._monitor_and_save_results(source, task_id))
                        
                        except Exception as e:
                            logger.error(f"❌ Failed to schedule source: {source.name}",
                                       source_id=source.id, error=str(e))
                
                logger.info(f"✅ Bootstrap complete: {scheduled_count} sources scheduled for scraping",
                           total_sources=len(unscraped_sources),
                           job_service_worker=job_service.worker_id,
                           architecture="unified_scraper_worker")
                
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
    
    async def _schedule_source_scraping(self, source: DocumentationSource, job_service: ScrapeJobService) -> str:
        """Schedule immediate scraping for a documentation source using unified job queue.
        
        Args:
            source: DocumentationSource to scrape
            job_service: ScrapeJobService instance for job queue operations
            
        Returns:
            Job ID for the scheduled scraping job (processed by ScraperWorker)
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
        
        # Submit to scrape job service
        result = await job_service.queue_scrape_job(
            source_id=str(source.id),
            job_params={
                "url": source.url,
                "selectors": selectors,
                "crawl_depth": source.crawl_depth or 3,
                "max_pages": 50,  # Default max pages since model doesn't have this field
                "allow_patterns": allow_patterns,
                "ignore_patterns": ignore_patterns
            }
        )
        task_id = result.get("job_id")
        
        return task_id
    
    async def _monitor_and_save_results(self, source: DocumentationSource, task_id: str):
        """Monitor task completion using unified job queue system."""
        job_service = ScrapeJobService()
        
        # Monitor job status every 10 seconds for up to 10 minutes
        max_wait_time = 600  # 10 minutes
        check_interval = 10  # 10 seconds
        elapsed_time = 0
        
        logger.info(f"📊 Starting job monitoring for source: {source.name}", 
                   source_id=source.id, task_id=task_id)
        
        while elapsed_time < max_wait_time:
            try:
                # Get job status from unified job queue
                job_status = await job_service.get_job_status(task_id)
                
                if not job_status:
                    logger.error(f"❌ Job not found: {task_id} for source: {source.name}")
                    return
                
                status = job_status["status"]
                
                if status == "COMPLETED":
                    pages_scraped = job_status.get("pages_scraped", 0)
                    logger.info(f"✅ Job completed for source: {source.name}", 
                               source_id=source.id, task_id=task_id, pages_scraped=pages_scraped)
                    # Results are already saved by ScraperWorker, just log completion
                    return
                    
                elif status in ["FAILED", "CANCELLED"]: 
                    logger.error(f"❌ Job {status.lower()} for source: {source.name}",
                               source_id=source.id, task_id=task_id, 
                               error=job_status.get("error_message"))
                    return
                
                elif status in ["IN_PROGRESS", "PENDING"]:
                    # Log progress for long-running jobs
                    if elapsed_time % 60 == 0:  # Every minute
                        logger.info(f"⏳ Job still {status.lower()} for source: {source.name}",
                                   source_id=source.id, task_id=task_id, elapsed_minutes=elapsed_time//60)
                    
                # Still running, wait and check again
                await asyncio.sleep(check_interval)
                elapsed_time += check_interval
                
            except Exception as e:
                logger.error(f"❌ Error monitoring job for source: {source.name}",
                           source_id=source.id, task_id=task_id, error=str(e))
                return
        
        logger.warning(f"⚠️ Job monitoring timed out for source: {source.name}", 
                       source_id=source.id, task_id=task_id, elapsed_minutes=max_wait_time//60)
    
    
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