"""Independent scraper worker process using SQLite job queue."""

import asyncio
import json
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
import uvloop
from litequeue import LiteQueue

# Set up uvloop for performance
uvloop.install()

logger = structlog.get_logger("scraper_worker")


class ScraperWorker:
    """Independent worker process for documentation scraping with smart browser management."""

    def __init__(self, queue_db_path: str | Path, data_dir: str | Path | None = None):
        """Initialize scraper worker.
        
        Args:
            queue_db_path: Path to SQLite database for job queue
            data_dir: Data directory for worker state and browser data
        """
        self.queue_db_path = Path(queue_db_path)
        self.data_dir = Path(data_dir) if data_dir else Path.home() / ".mcptools" / "workers"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        
        # Job queue for scraping tasks
        self.job_queue = LiteQueue(str(self.queue_db_path), queue_name="scraping_jobs")
        
        # Browser management
        self.browser_manager = None
        self.last_job_time = None
        self.browser_idle_timeout = 300  # 5 minutes
        self.poll_interval = 2  # seconds
        
        # Worker state
        self.running = False
        self.current_job = None
        
        # Setup signal handlers for graceful shutdown (only in main thread)
        try:
            signal.signal(signal.SIGINT, self._signal_handler)
            signal.signal(signal.SIGTERM, self._signal_handler)
            logger.debug("Signal handlers installed successfully")
        except ValueError as e:
            # Signal handlers can only be set in main thread
            logger.debug("Skipping signal handlers (not in main thread)", error=str(e))

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully."""
        logger.info("Received shutdown signal", signal=signum)
        self.running = False

    async def start(self):
        """Start the worker process."""
        logger.info("Starting scraper worker", 
                   queue_path=str(self.queue_db_path),
                   data_dir=str(self.data_dir))
        
        self.running = True
        
        try:
            await self._main_loop()
        except Exception as e:
            logger.error("Worker failed with error", error=str(e))
            raise
        finally:
            await self._cleanup()

    async def _main_loop(self):
        """Main worker loop - poll for jobs and manage browser lifecycle."""
        while self.running:
            try:
                # Check for new jobs
                job_data = self._get_next_job()
                
                if job_data:
                    await self._process_job(job_data)
                else:
                    # No jobs - check if browser should be closed
                    await self._manage_browser_lifecycle()
                    
                    # Sleep before polling again
                    await asyncio.sleep(self.poll_interval)
                    
            except Exception as e:
                logger.error("Error in main loop", error=str(e))
                await asyncio.sleep(5)  # Wait before retrying

    def _get_next_job(self) -> dict | None:
        """Get the next scraping job from the queue."""
        try:
            task = self.job_queue.pop()
            if task:
                logger.info("Got scraping job", message_id=task.message_id)
                self.current_job = task
                self.last_job_time = datetime.now(timezone.utc)
                
                # Parse job data
                job_data = json.loads(task.message)
                job_data['message_id'] = task.message_id
                return job_data
        except Exception as e:
            logger.error("Failed to get job from queue", error=str(e))
        
        return None

    async def process_job(self, job_data: dict):
        """Public interface to process a scraping job.
        
        This method provides a public interface for the ScraperWorkerThread
        to call from the orchestration server.
        
        Args:
            job_data: Dictionary containing job parameters
        """
        logger.info("🚀 Public process_job called", 
                   source_id=job_data.get('source_id', 'unknown'),
                   url=job_data.get('url', 'unknown'))
        
        # Add message_id if not present (for compatibility with thread interface)
        if 'message_id' not in job_data:
            import time
            job_data['message_id'] = f"thread-job-{int(time.time())}"
            
        # Call the internal processing method
        await self._process_job(job_data)

    async def _process_job(self, job_data: dict):
        """Process a scraping job."""
        message_id = job_data['message_id']
        source_id = job_data.get('source_id')
        
        try:
            logger.info("Processing scraping job", 
                       source_id=source_id, 
                       url=job_data.get('url'))
            
            # Ensure browser is running
            await self._ensure_browser_running()
            
            # Import scraper here to avoid circular imports
            from ..services.web_scraper import DocumentationScraper
            
            # Create scraper instance
            scraper = DocumentationScraper()
            if not scraper.browser_context:
                await scraper.initialize()
            
            # Execute scraping
            result = await scraper.scrape_documentation_source(
                ctx=None,  # No context in worker mode
                base_url=job_data['url'],
                crawl_depth=job_data.get('crawl_depth', 3),
                selectors=job_data.get('selectors'),
                allow_patterns=job_data.get('allow_patterns'),
                ignore_patterns=job_data.get('ignore_patterns'),
            )
            
            if result.get('success'):
                # Store results in database
                await self._store_scraping_results(source_id, result)
                logger.info("Scraping job completed successfully", 
                           source_id=source_id,
                           entries_scraped=result.get('entries_scraped', 0))
            else:
                logger.error("Scraping job failed", 
                           source_id=source_id, 
                           error=result.get('error'))
            
            # Mark job as done
            self.job_queue.done(message_id)
            
        except Exception as e:
            logger.error("Failed to process scraping job", 
                        source_id=source_id, 
                        error=str(e))
            
            # Mark job as done even on failure to prevent infinite retry
            # TODO: Add retry logic with exponential backoff
            self.job_queue.done(message_id)
        
        finally:
            self.current_job = None

    async def _ensure_browser_running(self):
        """Ensure browser manager is initialized and running."""
        if self.browser_manager is None:
            # Import here to avoid circular imports during module initialization
            from ..services.web_scraper import DocumentationScraper
            
            logger.info("Initializing browser for scraping jobs")
            self.browser_manager = DocumentationScraper()
            await self.browser_manager.initialize()

    async def _manage_browser_lifecycle(self):
        """Close browser if idle for too long to save resources."""
        if self.browser_manager and self.last_job_time:
            idle_time = (datetime.now(timezone.utc) - self.last_job_time).total_seconds()
            
            if idle_time > self.browser_idle_timeout:
                logger.info("Closing idle browser to save resources", 
                           idle_seconds=idle_time)
                
                try:
                    await self.browser_manager.cleanup()
                except Exception as e:
                    logger.warning("Error closing browser", error=str(e))
                
                self.browser_manager = None
                self.last_job_time = None

    async def _store_scraping_results(self, source_id: str, result: dict):
        """Store scraping results in database."""
        try:
            # Import services here to avoid circular imports
            from ..services.documentation_service import DocumentationService
            from ..database import execute_query
            from sqlalchemy import select, update
            from sqlalchemy.ext.asyncio import AsyncSession
            from ..models.documentation import DocumentationSource, DocumentationEntry
            
            # Process and store scraped entries
            entries_data = result.get("entries", [])
            if not entries_data:
                logger.info("No entries to store", source_id=source_id)
                return
            
            async def _store_entries(session: AsyncSession):
                # Get source
                stmt = select(DocumentationSource).where(DocumentationSource.id == source_id)
                source_result = await session.execute(stmt)
                source = source_result.scalar_one_or_none()
                
                if not source:
                    logger.error("Source not found for storing results", source_id=source_id)
                    return
                
                # Store entries
                entries_created = 0
                entries_updated = 0
                
                for entry_data in entries_data:
                    # Check if entry exists by content hash
                    content_hash = entry_data.get("content_hash")
                    if content_hash:
                        existing_stmt = select(DocumentationEntry).where(
                            DocumentationEntry.content_hash == content_hash
                        )
                        existing_result = await session.execute(existing_stmt)
                        existing_entry = existing_result.scalar_one_or_none()
                        
                        if existing_entry:
                            # Update existing entry
                            existing_entry.content = entry_data.get("content", "")
                            existing_entry.title = entry_data.get("title", "")
                            existing_entry.last_updated = datetime.now(timezone.utc)
                            entries_updated += 1
                        else:
                            # Create new entry
                            new_entry = DocumentationEntry(
                                id=entry_data.get("id"),
                                source_id=source_id,
                                url=entry_data.get("url", ""),
                                title=entry_data.get("title", ""),
                                content=entry_data.get("content", ""),
                                content_hash=content_hash,
                                extracted_at=datetime.now(timezone.utc)
                            )
                            session.add(new_entry)
                            entries_created += 1
                
                # Update source last_scraped timestamp
                source.last_scraped = datetime.now(timezone.utc)
                await session.commit()
                
                logger.info("Stored scraping results", 
                           source_id=source_id,
                           entries_created=entries_created,
                           entries_updated=entries_updated)
            
            await execute_query(_store_entries)
            
        except Exception as e:
            logger.error("Failed to store scraping results", 
                        source_id=source_id, 
                        error=str(e))

    async def _cleanup(self):
        """Clean up resources on shutdown."""
        logger.info("Cleaning up scraper worker")
        
        # Finish current job if any
        if self.current_job:
            logger.info("Waiting for current job to finish")
            # Job will complete naturally in the main loop
        
        # Close browser
        if self.browser_manager:
            try:
                await self.browser_manager.cleanup()
            except Exception as e:
                logger.warning("Error during browser cleanup", error=str(e))
        
        logger.info("Scraper worker cleanup complete")


async def main():
    """Main entry point for the scraper worker."""
    import sys
    
    # Get queue database path from command line or use default
    if len(sys.argv) > 1:
        queue_db_path = sys.argv[1]
    else:
        # Default to the main database path
        queue_db_path = Path.home() / ".mcptools" / "data" / "orchestration.db"
    
    logger.info("Starting scraper worker process", queue_db_path=queue_db_path)
    
    try:
        worker = ScraperWorker(queue_db_path)
        await worker.start()
    except KeyboardInterrupt:
        logger.info("Worker interrupted by user")
    except Exception as e:
        logger.error("Worker failed", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())