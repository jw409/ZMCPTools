"""Unified scraper worker process with integrated browser management and database-backed job queue."""

import asyncio
import hashlib
import random
import re
import signal
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import structlog
import uvloop
from fake_useragent import UserAgent
from playwright.async_api import async_playwright, Page, Browser, BrowserContext

# Set up uvloop for performance
uvloop.install()

logger = structlog.get_logger("scraper_worker")


class ScraperWorker:
    """Unified worker process for documentation scraping with integrated browser management and database-backed coordination."""

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
        
        # Integrated browser management (no external dependencies)
        self.playwright = None
        self.browser = None
        self.browser_context = None
        self.user_agent = UserAgent(os="Windows")
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
        
        This method provides a public interface for external callers
        (like orchestration threads) to process scraping jobs.
        
        Args:
            job_data: Dictionary containing job parameters
        """
        logger.info("🚀 Public process_job called", 
                   source_id=job_data.get('source_id', 'unknown'),
                   url=job_data.get('url', 'unknown'))
        
        # Add job_id if not present (for compatibility with external interfaces)
        if 'job_id' not in job_data:
            import time
            job_data['job_id'] = f"external-job-{int(time.time())}"
            
        # Set as current job for proper cleanup
        self.current_job = job_data
        self.current_job_id = job_data['job_id']
        
        try:
            # Call the internal processing method
            await self._process_job(job_data)
        finally:
            # Ensure cleanup happens even if processing fails
            self.current_job = None
            self.current_job_id = None

    async def _process_job(self, job_data: dict):
        """Process a scraping job using integrated browser management."""
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
            
            # Execute scraping using integrated browser
            result = await self._scrape_documentation(
                url=job_params.get('source_url'),
                source_id=source_id,
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
                        'pages_scraped': result.get('pages_scraped', 0),
                        'success': True,
                        'scraped_urls': result.get('scraped_urls', []),
                        'entries': len(result.get('entries', [])),
                    },
                    self.worker_id
                )
                
                logger.info("Scraping job completed successfully", 
                           job_id=job_id,
                           source_id=source_id,
                           pages_scraped=result.get('pages_scraped', 0),
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
        """Ensure browser is initialized and running."""
        if self.playwright is None or self.browser_context is None:
            logger.info("Initializing browser for scraping jobs")
            await self._initialize_browser()

    async def _initialize_browser(self):
        """Initialize Playwright browser with anti-detection features."""
        try:
            # Start Playwright
            self.playwright = await async_playwright().start()
            
            # Create user data directory for persistence
            user_data_root = self.data_dir / "browser_data"
            user_data_root.mkdir(parents=True, exist_ok=True)
            persistent_dir = user_data_root / f"chrome_{self.worker_id}"
            persistent_dir.mkdir(parents=True, exist_ok=True)
            
            # Clean up any stale lock files
            lock_files = ["SingletonLock", "lockfile", "chrome.lock"]
            for lock_file in lock_files:
                lock_path = persistent_dir / lock_file
                if lock_path.exists():
                    try:
                        lock_path.unlink()
                        logger.debug("Cleaned up stale lock file", path=str(lock_path))
                    except Exception as e:
                        logger.warning("Failed to clean lock file", path=str(lock_path), error=str(e))
            
            # Browser launch options with anti-detection
            options = {
                "headless": True,
                "viewport": {
                    "width": random.randint(1280, 1920),
                    "height": random.randint(720, 1080),
                },
                "locale": "en-US",
                "timezone_id": "America/New_York",
                "user_agent": self.user_agent.chrome,
                "args": [
                    "--no-sandbox",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-features=VizDisplayCompositor",
                    "--disable-background-timer-throttling",
                    "--disable-extensions",
                    "--disable-plugins",
                    "--disable-sync",
                    "--disable-translate",
                    "--disable-background-networking",
                    "--disable-default-apps",
                    "--disable-notifications",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-software-rasterizer",
                ],
            }
            
            # Launch persistent browser context
            self.browser_context = await self.playwright.chromium.launch_persistent_context(
                user_data_dir=str(persistent_dir), 
                **options
            )
            
            logger.info("Browser initialized successfully", worker_id=self.worker_id)
            
        except Exception as e:
            logger.error("Failed to initialize browser", error=str(e))
            raise

    async def _manage_browser_lifecycle(self):
        """Close browser if idle for too long to save resources."""
        if self.browser_context and self.last_job_time:
            idle_time = (datetime.now(timezone.utc) - self.last_job_time).total_seconds()
            
            if idle_time > self.browser_idle_timeout:
                logger.info("Closing idle browser to save resources", 
                           idle_seconds=idle_time)
                
                try:
                    await self._close_browser()
                except Exception as e:
                    logger.warning("Error closing browser", error=str(e))

    async def _close_browser(self):
        """Close browser and cleanup resources."""
        if self.browser_context:
            try:
                await self.browser_context.close()
                self.browser_context = None
            except Exception as e:
                logger.warning("Error closing browser context", error=str(e))
        
        if self.playwright:
            try:
                await self.playwright.stop()
                self.playwright = None
            except Exception as e:
                logger.warning("Error stopping playwright", error=str(e))
        
        self.last_job_time = None

    async def _scrape_documentation(
        self,
        url: str,
        source_id: str,
        selectors: dict[str, str] | None = None,
        crawl_depth: int = 3,
        allow_patterns: list[str] | None = None,
        ignore_patterns: list[str] | None = None,
        include_subdomains: bool = False,
    ) -> dict[str, Any]:
        """Main documentation scraping method with integrated browser management."""
        start_time = time.time()
        scraped_urls = set()
        all_entries = []
        
        try:
            # Normalize the starting URL
            parsed_url = urlparse(url)
            base_domain = parsed_url.netloc
            base_url = f"{parsed_url.scheme}://{base_domain}"
            
            logger.info("Starting documentation scraping",
                       url=url, 
                       source_id=source_id,
                       crawl_depth=crawl_depth)
            
            # Check existing URLs in database to avoid re-scraping
            existing_urls = await self._check_existing_urls([url], source_id)
            
            # Initialize crawling queue
            to_crawl = [(url, 0)]  # (url, depth)
            crawled = set()
            
            # Process crawling queue
            while to_crawl and len(scraped_urls) < 1000:  # Safety limit
                current_url, depth = to_crawl.pop(0)
                
                # Skip if already crawled or too deep
                if current_url in crawled or depth > crawl_depth:
                    continue
                    
                # Skip if URL doesn't match patterns
                if not self._should_crawl_url(current_url, base_domain, include_subdomains, allow_patterns, ignore_patterns):
                    continue
                
                # Skip if already exists in database
                if current_url in existing_urls:
                    logger.debug("Skipping existing URL", url=current_url)
                    crawled.add(current_url)
                    continue
                
                # Scrape the page
                try:
                    page_result = await self._scrape_single_page(current_url, selectors)
                    
                    if page_result:
                        # Add scraped content
                        entry = {
                            "id": str(uuid.uuid4()),
                            "url": current_url,
                            "title": page_result.get("title", ""),
                            "content": page_result.get("content", ""),
                            "content_hash": self._generate_content_hash(page_result.get("content", "")),
                        }
                        all_entries.append(entry)
                        scraped_urls.add(current_url)
                        
                        # Add discovered links to crawl queue
                        for link in page_result.get("links", []):
                            if link not in crawled and (link, depth + 1) not in to_crawl:
                                to_crawl.append((link, depth + 1))
                        
                        logger.info("Successfully scraped page",
                                   url=current_url,
                                   title=page_result.get("title", "")[:50],
                                   content_length=len(page_result.get("content", "")))
                    
                    crawled.add(current_url)
                    
                    # Small delay between requests
                    await asyncio.sleep(random.uniform(0.5, 1.5))
                    
                except Exception as e:
                    logger.warning("Failed to scrape page", url=current_url, error=str(e))
                    crawled.add(current_url)
                    continue
            
            duration = time.time() - start_time
            
            logger.info("Documentation scraping completed",
                       source_id=source_id,
                       pages_scraped=len(scraped_urls),
                       total_entries=len(all_entries),
                       duration_seconds=round(duration, 2))
            
            return {
                "success": True,
                "pages_scraped": len(scraped_urls),
                "scraped_urls": list(scraped_urls),
                "entries": all_entries,
                "duration": duration,
            }
            
        except Exception as e:
            logger.error("Documentation scraping failed", 
                        source_id=source_id, 
                        error=str(e))
            return {
                "success": False,
                "error": str(e),
                "pages_scraped": len(scraped_urls),
                "scraped_urls": list(scraped_urls),
                "entries": all_entries,
            }

    async def _scrape_single_page(self, url: str, selectors: dict[str, str] | None = None) -> dict[str, Any] | None:
        """Scrape a single page and extract content."""
        try:
            # Create new page for this scraping task
            page = await self.browser_context.new_page()
            
            try:
                # Navigate to page with timeout
                await page.goto(url, timeout=30000, wait_until="networkidle")
                
                # Wait for content to load
                await page.wait_for_load_state("networkidle", timeout=15000)
                
                # Extract page title
                title = await page.evaluate("document.title") or ""
                if not title:
                    # Try common title selectors
                    for selector in ["h1", "h2", ".title", ".page-title"]:
                        try:
                            element = page.locator(selector).first
                            if await element.is_visible(timeout=2000):
                                title = await element.text_content() or ""
                                if title.strip():
                                    title = title.strip()
                                    break
                        except Exception:
                            continue
                
                # Extract content using selectors or default approach
                content = ""
                if selectors and "content" in selectors:
                    try:
                        content_element = page.locator(selectors["content"])
                        if await content_element.first.is_visible(timeout=5000):
                            content = await content_element.first.text_content() or ""
                    except Exception:
                        pass
                
                # Fallback to general content extraction
                if not content:
                    content = await self._extract_default_content(page)
                
                # Extract links for further crawling
                links = await self._extract_links(page)
                
                return {
                    "title": title.strip(),
                    "content": content.strip(),
                    "links": links,
                }
                
            finally:
                await page.close()
                
        except Exception as e:
            logger.warning("Failed to scrape page", url=url, error=str(e))
            return None

    async def _extract_default_content(self, page: Page) -> str:
        """Extract content using default selectors."""
        content_selectors = [
            "main",
            "article", 
            ".content",
            ".main-content",
            "#content",
            ".documentation",
            ".docs",
            "body",
        ]
        
        for selector in content_selectors:
            try:
                element = page.locator(selector).first
                if await element.is_visible(timeout=2000):
                    content = await element.text_content()
                    if content and len(content.strip()) > 100:  # Meaningful content
                        return content.strip()
            except Exception:
                continue
        
        # Final fallback
        try:
            return await page.evaluate("document.body.textContent") or ""
        except Exception:
            return ""

    async def _extract_links(self, page: Page) -> list[str]:
        """Extract links from the page for further crawling."""
        try:
            links = await page.evaluate("""
                () => {
                    return Array.from(document.querySelectorAll('a[href]'))
                                .map(a => {
                                    try {
                                        return new URL(a.href, window.location.href).href;
                                    } catch {
                                        return null;
                                    }
                                })
                                .filter(href => href !== null);
                }
            """)
            return links or []
        except Exception:
            return []

    def _should_crawl_url(
        self, 
        url: str, 
        base_domain: str, 
        include_subdomains: bool,
        allow_patterns: list[str] | None = None,
        ignore_patterns: list[str] | None = None
    ) -> bool:
        """Check if URL should be crawled based on patterns and domain rules."""
        try:
            parsed = urlparse(url)
            url_domain = parsed.netloc
            
            # Check domain restrictions
            if include_subdomains:
                if not url_domain.endswith(base_domain):
                    return False
            else:
                if url_domain != base_domain:
                    return False
            
            # Check ignore patterns first
            if ignore_patterns:
                for pattern in ignore_patterns:
                    if re.search(pattern, url):
                        return False
            
            # Check allow patterns if specified
            if allow_patterns:
                for pattern in allow_patterns:
                    if re.search(pattern, url):
                        return True
                return False  # No allow pattern matched
            
            return True
            
        except Exception:
            return False

    async def _check_existing_urls(self, urls: list[str], source_id: str) -> set[str]:
        """Check which URLs have already been scraped."""
        try:
            from ..database import execute_query
            from sqlalchemy import select
            from sqlalchemy.ext.asyncio import AsyncSession
            from ..models.documentation import ScrapedUrl
            
            if not urls:
                return set()
            
            async def _check_urls(session: AsyncSession):
                stmt = select(ScrapedUrl.normalized_url).where(
                    ScrapedUrl.source_id == source_id,
                    ScrapedUrl.normalized_url.in_(urls)
                )
                result = await session.execute(stmt)
                return {row[0] for row in result.fetchall()}
            
            return await execute_query(_check_urls)
            
        except Exception as e:
            logger.warning("Failed to check existing URLs", error=str(e))
            return set()

    def _generate_content_hash(self, content: str) -> str:
        """Generate content hash for deduplication."""
        return hashlib.sha256(content.encode('utf-8')).hexdigest()

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
        if self.browser_context or self.playwright:
            try:
                await self._close_browser()
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