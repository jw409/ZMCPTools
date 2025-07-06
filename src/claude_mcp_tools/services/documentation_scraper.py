"""Documentation scraping service using synchronous Patchright for documentation intelligence."""

import asyncio
import atexit
import hashlib
import random
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import structlog
from fake_useragent import UserAgent
from patchright.sync_api import sync_playwright

from claude_mcp_tools.database import check_existing_urls_sync, save_scraped_urls_sync
from claude_mcp_tools.models import ScrapeJobStatus
from claude_mcp_tools.models.documentation import ScrapedUrl
from claude_mcp_tools.utils.scraper_logger import create_scraper_logger

logger = structlog.get_logger("documentation_scraper")


class ThreadPoolDocumentationScraper:
    """ThreadPoolExecutor-based documentation scraper with event loop isolation.

    This class solves uvloop + Playwright conflicts by using ThreadPoolExecutor
    where each thread gets its own isolated asyncio.run() event loop.
    Research-validated approach for I/O-bound browser automation.
    """

    def __init__(self, max_concurrent_browsers: int = 2):
        self.executor = ThreadPoolExecutor(max_workers=max_concurrent_browsers)
        self.active_jobs = {}  # Direct tracking without complex queues
        self._file_loggers = {}  # Track file loggers per job

    async def _check_existing_urls(self, urls: list[str], source_id: str) -> set[str]:
        """Check which URLs have already been scraped using database lookups.

        Args:
            urls: List of URLs to check
            source_id: Documentation source ID

        Returns:
            Set of normalized URLs that already exist in database
        """
        if not urls:
            return set()

        try:
            # Use sync database function for ThreadPoolExecutor compatibility
            existing_normalized = check_existing_urls_sync(urls, source_id)

            logger.info("🔍 Database URL check completed",
                       total_urls=len(urls),
                       existing_count=len(existing_normalized),
                       new_count=len(urls) - len(existing_normalized))

            return existing_normalized

        except Exception as e:
            logger.warning("Failed to check existing URLs in database", error=str(e))
            return set()

    async def _save_scraped_urls(self, scraped_data: list[dict], source_id: str) -> None:
        """Save scraped URLs to database using sync database connection.

        Args:
            scraped_data: List of scraped entry dictionaries
            source_id: Documentation source identifier
        """
        if not scraped_data:
            return

        try:
            # Use sync database function for ThreadPoolExecutor compatibility
            save_scraped_urls_sync(scraped_data, source_id)

            logger.info("💾 Saved scraped URLs to database",
                       count=len(scraped_data),
                       source_id=source_id)

        except Exception as e:
            logger.warning("Failed to save scraped URLs to database", error=str(e))

    async def scrape_documentation(
        self,
        url: str,
        source_id: str,
        selectors: dict[str, str] | None = None,
        crawl_depth: int = 3,
        batch_size: int = 20,  # Parameter kept for API compatibility
        allow_patterns: list[str] | None = None,
        ignore_patterns: list[str] | None = None,
        include_subdomains: bool = False,
    ) -> dict[str, Any]:
        """Scrape documentation using single-page navigation with unlimited link discovery.
        
        Args:
            url: Base URL to scrape
            source_id: Documentation source identifier
            selectors: CSS selectors for content extraction
            crawl_depth: Maximum depth for link crawling
            batch_size: Number of URLs to process per batch (not currently used)
            allow_patterns: URL patterns to include (allowlist)
            ignore_patterns: URL patterns to skip (blocklist)
            include_subdomains: Include subdomains when filtering internal links for crawling
            
        Returns:
            Dictionary with scraping results and metadata
        """
        logger.info("🚀 Starting ThreadPool documentation scraping",
                   url=url, source_id=source_id, crawl_depth=crawl_depth)

        # Initialize file logger for this job
        file_logger = create_scraper_logger(source_id, url)
        self._file_loggers[source_id] = file_logger
        file_logger.log_job_start(crawl_depth, allow_patterns, ignore_patterns)

        # Track job start
        self.active_jobs[source_id] = {
            "status": ScrapeJobStatus.IN_PROGRESS.value,
            "url": url,
            "start_time": datetime.now(timezone.utc),
            "pages_processed": 0,
        }

        try:
            # Get the current event loop (FastMCP's uvloop)
            loop = asyncio.get_running_loop()

            # Run browser work in ThreadPoolExecutor with timeout safeguard
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(
                        self.executor,
                        self._browser_worker_thread,
                        url,
                        source_id,
                        selectors,
                        crawl_depth,
                        batch_size,
                        allow_patterns,
                        ignore_patterns,
                        include_subdomains,
                    ),
                    timeout=3600,  # 1 hour timeout for scraping
                )
            except asyncio.TimeoutError:
                logger.error("⏰ Browser worker thread timed out after 1 hour", source_id=source_id)
                raise Exception("Scraping operation timed out")

            # Save scraped entries to database (async operation in main thread)
            if result.get("success") and result.get("entries"):
                try:
                    await self._save_scraped_urls(result["entries"], source_id)
                    logger.info("💾 Saved all scraped URLs to database",
                               count=len(result["entries"]))
                except Exception as e:
                    logger.warning("Failed to save scraped URLs to database", error=str(e))

            # Log job completion and cleanup
            if source_id in self._file_loggers:
                duration = (datetime.now(timezone.utc) - self.active_jobs[source_id]["start_time"]).total_seconds()
                self._file_loggers[source_id].log_job_completion(
                    True, result.get("pages_scraped", 0),
                    len(result.get("failed_urls", [])), duration,
                )
                self._file_loggers[source_id].close()
                del self._file_loggers[source_id]

            # Update job tracking
            self.active_jobs[source_id]["status"] = ScrapeJobStatus.COMPLETED.value
            self.active_jobs[source_id]["end_time"] = datetime.now(timezone.utc)

            logger.info("✅ ThreadPool documentation scraping completed",
                       source_id=source_id, pages=result.get("pages_scraped", 0))

            return result

        except Exception as e:
            # Log job failure and cleanup
            if source_id in self._file_loggers:
                duration = (datetime.now(timezone.utc) - self.active_jobs[source_id]["start_time"]).total_seconds()
                self._file_loggers[source_id].log_job_completion(
                    False, 0, 0, duration, str(e),
                )
                self._file_loggers[source_id].close()
                del self._file_loggers[source_id]

            # Update job tracking
            self.active_jobs[source_id]["status"] = ScrapeJobStatus.FAILED.value
            self.active_jobs[source_id]["end_time"] = datetime.now(timezone.utc)
            self.active_jobs[source_id]["error"] = str(e)

            logger.error("❌ ThreadPool documentation scraping failed",
                        source_id=source_id, error=str(e))

            return {
                "success": False,
                "error": str(e),
                "pages_scraped": 0,
                "entries": [],
            }

    def _browser_worker_thread(
        self,
        url: str,
        source_id: str,
        selectors: dict[str, str] | None,
        crawl_depth: int,
        batch_size: int,  # Parameter kept for API compatibility
        allow_patterns: list[str] | None,
        ignore_patterns: list[str] | None,
        include_subdomains: bool,
    ) -> dict[str, Any]:
        """Browser worker function that runs in separate thread with synchronous Playwright.

        This function uses sync_playwright to avoid conflicts with FastMCP's uvloop
        in the main thread. No asyncio.run() needed - pure synchronous execution.
        """

        logger.info("🔧 Starting browser task in isolated thread",
                   thread_id=threading.current_thread().ident,
                   source_id=source_id)

        scraped_urls = set()
        failed_urls = set()
        all_scraped_entries = []
        pages_processed = 0

        # Each thread creates its own Playwright instance (thread safety)
        with sync_playwright() as p:
            # Launch browser (headless for WSL compatibility)
            browser = p.chromium.launch(
                headless=True,  # WSL-compatible headless mode
                channel="chrome",  # Use system Chrome if available
                args=[
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
                ],
            )

            context = None  # Initialize context variable to avoid unbound issues
            try:
                # Create user agent instance for this thread
                user_agent = UserAgent(os="Windows")

                # Create new browser context with randomized viewport
                context = browser.new_context(
                    viewport={
                        "width": random.randint(1280, 1920),
                        "height": random.randint(720, 1080),
                    },
                    user_agent=user_agent.chrome,
                )

                # Add enhanced filtering to ignore patterns
                enhanced_ignore_patterns = ignore_patterns.copy() if ignore_patterns else []
                enhanced_ignore_patterns.append(r"/docs/v\d+\.\d+/.*")  # Ignore versioned docs

                # Add patterns to ignore external chat/social/non-doc links
                external_link_patterns = [
                    r"discord\.com.*", r"chat\..*", r"twitter\.com.*", r"x\.com.*",
                    r"facebook\.com.*", r"linkedin\.com.*", r"youtube\.com.*",
                    r"reddit\.com.*", r"stackoverflow\.com.*", r"mailto:.*",
                    r"tel:.*", r".*\.exe$",
                ]
                enhanced_ignore_patterns.extend(external_link_patterns)

                logger.info("🚀 Starting single-page navigation",
                           initial_url=url, crawl_depth=crawl_depth)

                # Create single page for navigation
                page = context.new_page()

                try:
                    # URL processing queue
                    urls_to_scrape = [(url, 0)]  # (url, depth)

                    # Process URLs one by one using single page navigation
                    while urls_to_scrape:
                        current_url, depth = urls_to_scrape.pop(0)

                        # Normalize URL for consistent tracking
                        normalized_url = ScrapedUrl.normalize_url(current_url)

                        # Skip if already processed
                        if normalized_url in scraped_urls or normalized_url in failed_urls:
                            continue

                        # Skip if depth exceeded
                        if depth > crawl_depth:
                            continue

                        # Check allow patterns first (allowlist)
                        if allow_patterns and not any(re.search(pattern, current_url) for pattern in allow_patterns):
                            logger.debug("🚫 Skipping URL (allow patterns)", url=current_url)
                            continue

                        # Check ignore patterns (blocklist)
                        if any(re.search(pattern, current_url) for pattern in enhanced_ignore_patterns):
                            logger.debug("🚫 Skipping URL (ignore patterns)", url=current_url)
                            continue

                        logger.info(
                    "📄 Scraping page",
                    page_num=pages_processed + 1,
                    url=current_url,
                )

                        try:
                            # Navigate to page
                            response = page.goto(current_url, timeout=30000, wait_until="domcontentloaded")
                            if not response or response.status >= 400:
                                status = response.status if response else "No response"
                                logger.warning(
                                    "❌ HTTP error",
                                    status=status,
                                    url=current_url,
                                )
                                failed_urls.add(normalized_url)
                                continue

                            # Wait for page to be ready
                            page.wait_for_load_state("networkidle", timeout=10000)

                            # Extract page content
                            page_data = self._extract_page_data_sync(page, selectors)
                            if page_data and page_data.get("content"):
                                # Generate content hash
                                content_hash = hashlib.sha256(page_data["content"].encode()).hexdigest()

                                entry_data = {
                                    "id": str(uuid.uuid4()),
                                    "url": current_url,
                                    "title": page_data.get("title", ""),
                                    "content": page_data["content"],
                                    "content_hash": content_hash,
                                    "links": page_data.get("links", []),
                                    "code_examples": page_data.get("code_examples", []),
                                    "extracted_at": datetime.now(timezone.utc),
                                }

                                all_scraped_entries.append(entry_data)
                                scraped_urls.add(normalized_url)
                                pages_processed += 1

                                title_preview = page_data.get("title", "Untitled")[:50]
                                logger.info("✅ Successfully scraped", title=title_preview)

                                # Extract and queue new URLs for crawling (if not at max depth)
                                if depth < crawl_depth:
                                    new_links = self._filter_internal_links_sync(
                                        page_data.get("links", []),
                                        url,
                                        include_subdomains=include_subdomains,
                                    )
                                    for link in new_links:
                                        link_normalized = ScrapedUrl.normalize_url(link)
                                        if (
                                            link_normalized not in scraped_urls
                                            and link_normalized not in failed_urls
                                            and (link, depth + 1) not in urls_to_scrape
                                        ):
                                            urls_to_scrape.append((link, depth + 1))

                            else:
                                logger.warning("❌ No content extracted", url=current_url)
                                failed_urls.add(normalized_url)

                        except Exception as e:
                            logger.error("❌ Failed to scrape", url=current_url, error=str(e))
                            failed_urls.add(normalized_url)

                        # Add delay between requests to be respectful
                        time.sleep(random.uniform(0.5, 1.5))

                finally:
                    page.close()

            finally:
                if context is not None:
                    context.close()
                browser.close()

        logger.info("🎯 Browser worker thread completed",
                   source_id=source_id,
                   pages_scraped=pages_processed,
                   failed_count=len(failed_urls))

        return {
            "success": True,
            "pages_scraped": pages_processed,
            "entries": all_scraped_entries,
            "failed_urls": list(failed_urls),
        }

    def _extract_page_data_sync(self, page, selectors: dict[str, str] | None = None) -> dict[str, Any]:
        """Extract data from page using sync methods."""
        try:
            # Extract title
            title = page.evaluate("document.title") or ""
            if not title:
                # Try common title selectors
                for selector in ["h1", "h2", ".title", ".page-title"]:
                    try:
                        element = page.locator(selector).first
                        if element.is_visible(timeout=2000):
                            title = element.text_content() or ""
                            if title.strip():
                                title = title.strip()
                                break
                    except Exception:
                        continue

            # Extract content using selectors or fallback
            content = ""
            if selectors and "content" in selectors:
                try:
                    element = page.locator(selectors["content"]).first
                    if element.is_visible(timeout=2000):
                        content = element.text_content() or ""
                except Exception:
                    pass

            # Fallback to common content selectors
            if not content:
                for selector in ["main", "article", ".content", ".main-content", "#content"]:
                    try:
                        element = page.locator(selector).first
                        if element.is_visible(timeout=2000):
                            content = element.text_content() or ""
                            if content and len(content.strip()) > 50:
                                break
                    except Exception:
                        continue

            # Extract links
            links = []
            try:
                links = page.evaluate("""
                    () => {
                        return Array.from(document.querySelectorAll('a[href]'))
                                    .map(a => {
                                        try {
                                            return new URL(a.href, window.location.href).href;
                                        } catch {
                                            return null;
                                        }
                                    })
                                    .filter(url => url && url.startsWith('http'))
                                    .filter((url, index, arr) => arr.indexOf(url) === index);
                    }
                """)
            except Exception as e:
                logger.warning("Failed to extract links", error=str(e))

            return {
                "title": title,
                "content": content.strip() if content else "",
                "links": links,
                "code_examples": [],  # Could be enhanced later
            }

        except Exception as e:
            logger.error("Failed to extract page data", error=str(e))
            return {"title": "", "content": "", "links": [], "code_examples": []}

    def _filter_internal_links_sync(
        self,
        links: list[str],
        base_url: str,
        *,
        include_subdomains: bool = False,
    ) -> list[str]:
        """Filter links to only include internal ones."""
        base_domain = urlparse(base_url).netloc
        internal_links = []

        for link in links:
            try:
                parsed = urlparse(link)
                # Include if same domain, subdomain (if allowed), or relative URL
                if self._is_allowed_domain_sync(
                    parsed.netloc, base_domain, include_subdomains=include_subdomains,
                ):
                    internal_links.append(link)
            except Exception:
                continue

        return list(set(internal_links))  # Remove duplicates

    def _is_allowed_domain_sync(
        self, url_domain: str, base_domain: str, *, include_subdomains: bool,
    ) -> bool:
        """Check if a domain is allowed based on subdomain policy."""
        if not url_domain:
            return False

        # Exact domain match is always allowed
        if url_domain == base_domain:
            return True

        # Subdomain check only if explicitly enabled
        return include_subdomains and url_domain.endswith(f".{base_domain}")

    async def shutdown(self):
        """Shutdown the scraper and clean up resources."""
        logger.info("🔄 Shutting down ThreadPool documentation scraper...")

        # Cancel all running jobs
        for source_id in list(self.active_jobs.keys()):
            if self.active_jobs[source_id].get("status") == ScrapeJobStatus.IN_PROGRESS.value:
                logger.info("🛑 Cancelling running job", source_id=source_id)
                self.active_jobs[source_id]["status"] = ScrapeJobStatus.FAILED.value
                self.active_jobs[source_id]["error"] = "Shutdown requested"

        # Close file loggers
        for source_id, file_logger in self._file_loggers.items():
            try:
                file_logger.close()
            except Exception as e:
                logger.warning(
                    "Failed to close file logger", source_id=source_id, error=str(e),
                )

        # Shutdown ThreadPoolExecutor
        self.executor.shutdown(wait=True, cancel_futures=True)
        logger.info("✅ ThreadPool documentation scraper shutdown complete")


# Global thread pool scraper instance
thread_pool_scraper = ThreadPoolDocumentationScraper(max_concurrent_browsers=2)

# Register cleanup - use synchronous shutdown for atexit
def _cleanup_thread_pool():
    """Synchronous cleanup for atexit handler."""
    try:
        thread_pool_scraper.executor.shutdown(wait=False, cancel_futures=True)
    except Exception:
        pass  # Ignore cleanup errors during shutdown

atexit.register(_cleanup_thread_pool)
