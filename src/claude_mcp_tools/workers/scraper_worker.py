"""Independent scraper worker process using database-backed job queue."""

import asyncio
import signal
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
import uvloop

# Set up uvloop for performance
uvloop.install()

logger = structlog.get_logger("scraper_worker")


class ScraperWorker:
    """Independent worker process for documentation scraping with database-backed coordination."""

    def __init__(self, data_dir: str | Path | None = None, worker_id: str | None = None):
        """Initialize scraper worker.
        
        Args:
            data_dir: Data directory for worker state and browser data
            worker_id: Unique worker identifier (auto-generated if not provided)
        """
        self.data_dir = Path(data_dir) if data_dir else Path.home() / ".mcptools" / "workers"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        
        # Worker identification
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        
        # Initialize job service for database-backed queue
        from ..services.scrape_job_service import ScrapeJobService
        self.job_service = ScrapeJobService(worker_id=self.worker_id)
        
        # Browser management
        self.browser_manager = None
        self.last_job_time = None
        self.browser_idle_timeout = 300  # 5 minutes
        self.poll_interval = 5  # seconds - increased for database polling
        self.heartbeat_interval = 30  # seconds
        
        # Worker state
        self.running = False
        self.current_job = None
        self.current_job_id = None
        self.heartbeat_task = None
        
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
                   worker_id=self.worker_id,
                   data_dir=str(self.data_dir))
        
        self.running = True
        
        # Register worker and cleanup any orphaned locks from previous runs
        await self._register_worker()
        
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
                job_data = await self._get_next_job()
                
                if job_data:
                    await self._process_job(job_data)
                else:
                    # No jobs - check if browser should be closed
                    await self._manage_browser_lifecycle()
                    
                    # Cleanup expired locks periodically
                    await self._cleanup_expired_locks()
                    
                    # Sleep before polling again
                    await asyncio.sleep(self.poll_interval)
                    
            except Exception as e:
                logger.error("Error in main loop", error=str(e))
                await asyncio.sleep(5)  # Wait before retrying

    async def _get_next_job(self) -> dict | None:
        """Get the next scraping job from the database queue."""
        try:
            job_data = await self.job_service.acquire_next_job(self.worker_id)
            
            if job_data:
                logger.info("Acquired scraping job", 
                           job_id=job_data['job_id'],
                           source_id=job_data['source_id'])
                
                self.current_job = job_data
                self.current_job_id = job_data['job_id']
                self.last_job_time = datetime.now(timezone.utc)
                
                # Start heartbeat task to keep job lock alive
                await self._start_heartbeat()
                
                return job_data
                
        except Exception as e:
            logger.error("Failed to acquire job from queue", error=str(e))
        
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
        
        # Add job_id if not present (for compatibility with thread interface)
        if 'job_id' not in job_data:
            import time
            job_data['job_id'] = f"thread-job-{int(time.time())}"
            
        # Call the internal processing method
        await self._process_job(job_data)

    async def _process_job(self, job_data: dict):
        """Process a scraping job."""
        job_id = job_data['job_id']
        source_id = job_data.get('source_id')
        job_params = job_data.get('job_data', {})
        
        try:
            logger.info("Processing scraping job", 
                       job_id=job_id,
                       source_id=source_id, 
                       url=job_params.get('source_url'))
            
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
                base_url=job_params.get('source_url'),
                crawl_depth=job_params.get('crawl_depth', 3),
                selectors=job_params.get('selectors'),
                allow_patterns=job_params.get('allow_patterns'),
                ignore_patterns=job_params.get('ignore_patterns'),
                include_subdomains=job_params.get('include_subdomains', False),
            )
            
            if result.get('success'):
                # Store results in database
                await self._store_scraping_results(source_id, result)
                
                # Mark job as completed
                completion_result = await self.job_service.complete_job(
                    job_id, 
                    {
                        'pages_scraped': result.get('entries_scraped', 0),
                        'success': True,
                        'scraped_urls': result.get('scraped_urls', []),
                        'entries': len(result.get('entries', [])),
                    },
                    self.worker_id
                )
                
                logger.info("Scraping job completed successfully", 
                           job_id=job_id,
                           source_id=source_id,
                           entries_scraped=result.get('entries_scraped', 0),
                           completion_success=completion_result.get('success', False))
            else:
                # Mark job as failed
                error_msg = result.get('error', 'Unknown scraping error')
                await self.job_service.fail_job(job_id, error_msg, self.worker_id)
                
                logger.error("Scraping job failed", 
                           job_id=job_id,
                           source_id=source_id, 
                           error=error_msg)
            
        except Exception as e:
            error_msg = f"Worker exception: {str(e)}"
            logger.error("Failed to process scraping job", 
                        job_id=job_id,
                        source_id=source_id, 
                        error=error_msg)
            
            # Mark job as failed
            try:
                await self.job_service.fail_job(job_id, error_msg, self.worker_id)
            except Exception as fail_error:
                logger.error("Failed to mark job as failed", 
                           job_id=job_id, 
                           error=str(fail_error))
        
        finally:
            # Stop heartbeat
            await self._stop_heartbeat()
            
            self.current_job = None
            self.current_job_id = None

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
        logger.info("Cleaning up scraper worker", worker_id=self.worker_id)
        
        # Stop heartbeat if running
        await self._stop_heartbeat()
        
        # Release current job lock if any
        if self.current_job_id:
            try:
                logger.info("Releasing job lock on shutdown", job_id=self.current_job_id)
                await self.job_service.fail_job(
                    self.current_job_id, 
                    "Worker shutdown - job released", 
                    self.worker_id
                )
            except Exception as e:
                logger.warning("Failed to release job lock on shutdown", 
                             job_id=self.current_job_id, 
                             error=str(e))
        
        # Close browser
        if self.browser_manager:
            try:
                await self.browser_manager.cleanup()
            except Exception as e:
                logger.warning("Error during browser cleanup", error=str(e))
        
        logger.info("Scraper worker cleanup complete", worker_id=self.worker_id)

    async def _register_worker(self):
        """Register worker and cleanup any orphaned locks from previous runs."""
        try:
            # Release any expired locks from this worker ID
            # (in case of unclean shutdown)
            result = await self.job_service.release_expired_locks(max_age_minutes=0)
            if result.get('success') and result.get('released_count', 0) > 0:
                logger.info("Released orphaned locks from previous run",
                           worker_id=self.worker_id,
                           released_count=result['released_count'])
                           
            logger.info("Worker registered successfully", worker_id=self.worker_id)
            
        except Exception as e:
            logger.warning("Failed to register worker", 
                         worker_id=self.worker_id, 
                         error=str(e))

    async def _start_heartbeat(self):
        """Start heartbeat task to keep current job lock alive."""
        if self.heartbeat_task:
            await self._stop_heartbeat()
            
        self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def _stop_heartbeat(self):
        """Stop heartbeat task."""
        if self.heartbeat_task:
            self.heartbeat_task.cancel()
            try:
                await self.heartbeat_task
            except asyncio.CancelledError:
                pass
            self.heartbeat_task = None

    async def _heartbeat_loop(self):
        """Background task to send periodic heartbeats for current job."""
        try:
            while self.current_job_id and self.running:
                await asyncio.sleep(self.heartbeat_interval)
                
                if self.current_job_id:  # Check again after sleep
                    try:
                        result = await self.job_service.heartbeat_job(
                            self.current_job_id, 
                            self.worker_id
                        )
                        
                        if result.get('success'):
                            logger.debug("Heartbeat sent successfully", 
                                       job_id=self.current_job_id,
                                       worker_id=self.worker_id)
                        else:
                            logger.warning("Heartbeat failed", 
                                         job_id=self.current_job_id,
                                         error=result.get('error'))
                            break  # Stop heartbeat on failure
                            
                    except Exception as e:
                        logger.error("Error sending heartbeat", 
                                   job_id=self.current_job_id,
                                   error=str(e))
                        break
                        
        except asyncio.CancelledError:
            logger.debug("Heartbeat task cancelled", 
                       job_id=self.current_job_id,
                       worker_id=self.worker_id)
        except Exception as e:
            logger.error("Heartbeat loop failed", 
                       job_id=self.current_job_id,
                       error=str(e))

    async def _cleanup_expired_locks(self):
        """Periodically cleanup expired locks from all workers."""
        try:
            # Only do this occasionally to avoid excessive database calls
            if hasattr(self, '_last_cleanup'):
                if (datetime.now(timezone.utc) - self._last_cleanup).total_seconds() < 300:
                    return  # Skip if cleaned up less than 5 minutes ago
            
            result = await self.job_service.release_expired_locks(max_age_minutes=60)
            if result.get('success') and result.get('released_count', 0) > 0:
                logger.info("Released expired locks from all workers",
                           released_count=result['released_count'])
                           
            self._last_cleanup = datetime.now(timezone.utc)
            
        except Exception as e:
            logger.warning("Failed to cleanup expired locks", error=str(e))


async def main():
    """Main entry point for the scraper worker."""
    import sys
    
    # Get worker ID from command line if provided
    worker_id = None
    if len(sys.argv) > 1:
        worker_id = sys.argv[1]
    
    logger.info("Starting scraper worker process", worker_id=worker_id)
    
    try:
        worker = ScraperWorker(worker_id=worker_id)
        await worker.start()
    except KeyboardInterrupt:
        logger.info("Worker interrupted by user")
    except Exception as e:
        logger.error("Worker failed", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())