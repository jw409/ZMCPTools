"""Background task manager for running web scraping concurrently with FastMCP server.

This uses ProcessPoolExecutor to isolate browser automation from uvloop/asyncio,
following the FIX_LOOP.md guide to prevent event loop conflicts.
"""

import asyncio
import structlog
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from dataclasses import dataclass, field
from enum import Enum
from concurrent.futures import ProcessPoolExecutor

logger = structlog.get_logger("background_task_manager")


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running" 
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class BackgroundTask:
    id: str
    name: str
    worker_func: Callable  # Function that runs in separate process
    args: tuple = field(default_factory=tuple)
    kwargs: dict = field(default_factory=dict)
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Any = None
    error: Optional[str] = None
    progress: dict = field(default_factory=dict)


class BackgroundTaskManager:
    """Manages background tasks using ProcessPoolExecutor to isolate browser automation.
    
    This prevents uvloop/asyncio conflicts by running browser automation in 
    separate processes while maintaining async coordination from the main process.
    """
    
    def __init__(self, max_workers: int = 3):
        self.max_workers = max_workers
        self.executor: Optional[ProcessPoolExecutor] = None
        self.tasks: dict[str, BackgroundTask] = {}
        self.running_futures: dict[str, asyncio.Future] = {}
        self._started = False
    
    async def start(self):
        """Start the background task manager."""
        if self._started:
            return
            
        logger.info("🚀 Starting background task manager", max_workers=self.max_workers)
        
        # Initialize ProcessPoolExecutor
        self.executor = ProcessPoolExecutor(max_workers=self.max_workers)
        
        self._started = True
        logger.info("✅ Background task manager started")
    
    async def shutdown(self):
        """Gracefully shutdown the background task manager."""
        if not self._started:
            return
            
        logger.info("🔄 Shutting down background task manager...")
        
        # Cancel all running futures
        for task_id, future in self.running_futures.items():
            if not future.done():
                logger.info("🛑 Cancelling running task", task_id=task_id)
                future.cancel()
                
        # Shutdown the ProcessPoolExecutor
        if self.executor:
            self.executor.shutdown(wait=True)
            self.executor = None
        
        self._started = False
        logger.info("✅ Background task manager shutdown complete")
    
    async def submit_task(
        self, 
        task_id: str,
        name: str, 
        worker_func: Callable,
        *args,
        **kwargs
    ) -> str:
        """Submit a task for background execution in a separate process.
        
        Args:
            task_id: Unique identifier for the task
            name: Human-readable task name
            worker_func: Function to execute in separate process
            *args: Positional arguments for the function
            **kwargs: Keyword arguments for the function
            
        Returns:
            Task ID
        """
        if not self._started:
            await self.start()
            
        if not self.executor:
            raise RuntimeError("Task manager not properly initialized")
            
        task = BackgroundTask(
            id=task_id,
            name=name,
            worker_func=worker_func,
            args=args,
            kwargs=kwargs
        )
        
        # Update task status
        task.status = TaskStatus.RUNNING
        task.started_at = datetime.now(timezone.utc)
        self.tasks[task_id] = task
        
        # Submit to ProcessPoolExecutor
        # Note: run_in_executor only accepts positional args, not kwargs
        # We need to create a wrapper or pass all args positionally
        loop = asyncio.get_running_loop()
        
        if kwargs:
            # Create a wrapper function that handles kwargs
            import functools
            wrapper_func = functools.partial(worker_func, *args, **kwargs)
            future = loop.run_in_executor(self.executor, wrapper_func)
        else:
            future = loop.run_in_executor(self.executor, worker_func, *args)
            
        self.running_futures[task_id] = future
        
        # Set up completion callback
        future.add_done_callback(lambda f: asyncio.create_task(self._handle_task_completion(task_id, f)))
        
        logger.info("📝 Task submitted to process pool", task_id=task_id, name=name)
        return task_id
    
    def get_task_status(self, task_id: str) -> Optional[BackgroundTask]:
        """Get the status of a task."""
        return self.tasks.get(task_id)
    
    def list_tasks(self, status_filter: Optional[TaskStatus] = None) -> list[BackgroundTask]:
        """List all tasks, optionally filtered by status."""
        tasks = list(self.tasks.values())
        if status_filter:
            tasks = [t for t in tasks if t.status == status_filter]
        return tasks
    
    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a running task."""
        if task_id in self.running_futures:
            future = self.running_futures[task_id]
            if not future.done():
                future.cancel()
                if task_id in self.tasks:
                    self.tasks[task_id].status = TaskStatus.CANCELLED
                    self.tasks[task_id].completed_at = datetime.now(timezone.utc)
                logger.info("🛑 Task cancelled", task_id=task_id)
                return True
        return False
    
    async def _handle_task_completion(self, task_id: str, future: asyncio.Future):
        """Handle completion of a background task."""
        if task_id not in self.tasks:
            return
            
        task = self.tasks[task_id]
        
        try:
            if future.cancelled():
                task.status = TaskStatus.CANCELLED
                task.completed_at = datetime.now(timezone.utc)
                logger.info("🛑 Task cancelled", task_id=task_id, name=task.name)
            
            elif future.exception():
                task.status = TaskStatus.FAILED
                task.error = str(future.exception())
                task.completed_at = datetime.now(timezone.utc)
                logger.error("❌ Task failed", task_id=task_id, name=task.name, error=task.error)
            
            else:
                task.status = TaskStatus.COMPLETED
                task.result = future.result()
                task.completed_at = datetime.now(timezone.utc)
                logger.info("✅ Task completed successfully", task_id=task_id, name=task.name)
                
        except Exception as e:
            logger.error("❌ Error handling task completion", task_id=task_id, error=str(e))
        
        finally:
            # Clean up
            if task_id in self.running_futures:
                del self.running_futures[task_id]


# Global instance for use across the application
background_task_manager = BackgroundTaskManager()


# Browser worker function for ProcessPoolExecutor
def browser_scraping_worker(
    url: str,
    source_id: str,
    selectors: Optional[dict] = None,
    crawl_depth: int = 3,
    max_pages: int = 10,
    allow_patterns: Optional[list[str]] = None,
    ignore_patterns: Optional[list[str]] = None,
) -> dict:
    """Worker function that runs browser automation in a separate process.
    
    This function is executed by ProcessPoolExecutor to isolate browser
    automation from the main uvloop/asyncio event loop.
    """
    import asyncio
    import hashlib
    import uuid
    from datetime import datetime, timezone
    from urllib.parse import urljoin, urlparse
    from patchright.async_api import async_playwright
    import re
    
    async def browser_task():
        """Complete browser automation task with Playwright async API."""
        print(f"🚀 Starting browser automation for {url}")
        scraped_urls = set()
        failed_urls = set()
        scraped_entries = []
        
        # Each process creates its own Playwright instance and event loop
        async with async_playwright() as p:
            # Launch browser with Chrome (headless for WSL compatibility)
            browser = await p.chromium.launch(
                headless=True,
                channel="chrome",
                args=[
                    "--no-sandbox",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage"
                ]
            )
            
            try:
                # Create new browser context
                context = await browser.new_context(
                    viewport={"width": 1280, "height": 720},
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                )
                
                # Track URLs to scrape with depth
                urls_to_scrape = [(url, 0)]  # (url, depth)
                pages_processed = 0
                
                while urls_to_scrape and pages_processed < max_pages:
                    current_url, depth = urls_to_scrape.pop(0)
                    
                    # Skip if already processed or depth exceeded
                    if current_url in scraped_urls or current_url in failed_urls:
                        continue
                    if depth > crawl_depth:
                        continue
                        
                    # Check URL patterns
                    if allow_patterns and not any(re.search(pattern, current_url) for pattern in allow_patterns):
                        continue
                        
                    if ignore_patterns and any(re.search(pattern, current_url) for pattern in ignore_patterns):
                        continue
                    
                    try:
                        # Create new page for this URL
                        page = await context.new_page()
                        
                        # Navigate to URL with timeout
                        print(f"📄 Scraping page: {current_url}")
                        await page.goto(current_url, wait_until="networkidle", timeout=30000)
                        
                        # Extract title
                        title = await page.title()
                        
                        # Extract content using selectors or fallback
                        content = ""
                        if selectors and "content" in selectors:
                            try:
                                content_element = await page.query_selector(selectors["content"])
                                if content_element:
                                    content = await content_element.inner_text()
                            except Exception:
                                pass
                        
                        # Fallback to smart content extraction
                        if not content:
                            content_selectors = [
                                "main", "article", ".content", "#content", 
                                ".documentation", ".docs", "[role='main']"
                            ]
                            
                            for selector in content_selectors:
                                try:
                                    element = await page.query_selector(selector)
                                    if element:
                                        content = await element.inner_text()
                                        break
                                except Exception:
                                    continue
                            
                            # Final fallback to body
                            if not content:
                                body = await page.query_selector("body")
                                if body:
                                    content = await body.inner_text()
                        
                        # Extract links for crawling
                        links = []
                        try:
                            link_elements = await page.query_selector_all("a[href]")
                            for link_elem in link_elements:
                                href = await link_elem.get_attribute("href")
                                if href:
                                    absolute_url = urljoin(page.url, href)
                                    links.append(absolute_url)
                        except Exception:
                            pass
                        
                        # Generate entry
                        entry = {
                            "id": str(uuid.uuid4()),
                            "url": current_url,
                            "title": title,
                            "content": content,
                            "content_hash": hashlib.sha256(content.encode()).hexdigest(),
                            "links": links,
                            "code_examples": [],
                            "extracted_at": datetime.now(timezone.utc),
                            "depth": depth
                        }
                        
                        scraped_entries.append(entry)
                        scraped_urls.add(current_url)
                        pages_processed += 1
                        
                        # Extract and queue internal links for next depth level
                        if depth < crawl_depth:
                            base_domain = urlparse(url).netloc
                            internal_links = []
                            
                            for link in links:
                                try:
                                    parsed = urlparse(link)
                                    if parsed.netloc == base_domain or not parsed.netloc:
                                        if not parsed.netloc:
                                            link = urljoin(url, link)
                                        internal_links.append(link)
                                except Exception:
                                    continue
                            
                            # Add up to 5 internal links per page
                            for link in internal_links[:5]:
                                if link not in scraped_urls:
                                    urls_to_scrape.append((link, depth + 1))
                        
                        await page.close()
                        
                    except Exception as page_error:
                        failed_urls.add(current_url)
                        if 'page' in locals():
                            await page.close()
                        continue
                
                return {
                    "success": True,
                    "source_id": source_id,
                    "pages_scraped": pages_processed,
                    "entries": scraped_entries,
                    "scraped_urls": list(scraped_urls),
                    "failed_urls": list(failed_urls),
                    "total_discovered": len(scraped_urls) + len(failed_urls)
                }
                
            finally:
                # Ensure browser cleanup
                await browser.close()
    
    # Each worker process gets its own isolated event loop via asyncio.run()
    # This completely bypasses uvloop conflicts in the main thread
    return asyncio.run(browser_task())


async def submit_web_scraping_task(
    source_id: str,
    url: str,
    selectors: Optional[dict] = None,
    crawl_depth: int = 3,
    max_pages: int = 10,
    allow_patterns: Optional[list[str]] = None,
    ignore_patterns: Optional[list[str]] = None
) -> str:
    """Submit a web scraping task to run in the background.
    
    This uses ProcessPoolExecutor to isolate browser automation from uvloop.
    """
    task_id = f"scrape-{source_id}"
    task_name = f"Scraping documentation from {url}"
    
    await background_task_manager.submit_task(
        task_id=task_id,
        name=task_name,
        worker_func=browser_scraping_worker,
        url=url,
        source_id=source_id,
        selectors=selectors,
        crawl_depth=crawl_depth,
        max_pages=max_pages,
        allow_patterns=allow_patterns,
        ignore_patterns=ignore_patterns
    )
    
    return task_id


def get_scraping_task_status(source_id: str) -> Optional[BackgroundTask]:
    """Get the status of a web scraping task."""
    task_id = f"scrape-{source_id}"
    return background_task_manager.get_task_status(task_id)