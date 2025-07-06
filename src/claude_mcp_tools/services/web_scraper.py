"""Web scraping service using synchronous Patchright for documentation intelligence."""

import asyncio
import hashlib
import queue
import random
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import structlog
from fake_useragent import UserAgent
from patchright.sync_api import sync_playwright

logger = structlog.get_logger("web_scraper")

# Synchronous browser operations with background threading for queue processing


class SimpleBrowserManager:
    """Browser manager with anti-detection features using Patchright."""

    def __init__(self, browser_type: str = "chrome", headless: bool = False):
        self.browser_type = browser_type
        self.headless = headless
        self.user_agent = UserAgent(os="Windows")
        self.browser_context = None
        self.playwright = None
        self.retry_count = 3
        self.retry_delay = 2.0

    async def initialize(self, user_data_dir: Path | None = None):
        """Initialize browser with anti-detection features."""
        logger.info("🔧 Initializing patchright browser...", browser_type=self.browser_type)

        # Start patchright playwright
        self.playwright = await async_playwright().start()

        # Base launch options with anti-detection
        base_options = {
            "headless": self.headless,
            "viewport": {
                "width": random.randint(1080, 1680),
                "height": random.randint(500, 800),
            },
            "locale": "en-US",
            "timezone_id": "America/New_York",
            "geolocation": {"latitude": 40.7128, "longitude": -74.0060},
            "accept_downloads": True,
        }

        # Create user data directory for persistence in ~/.mcptools
        if user_data_dir is None:
            user_data_root = Path.home() / ".mcptools" / "browser_data"
            user_data_root.mkdir(parents=True, exist_ok=True)
            persistent_dir = user_data_root / f"{self.browser_type}_{random.randint(1000, 9999)}"
            persistent_dir.mkdir(parents=True, exist_ok=True)  # Ensure directory exists
        else:
            persistent_dir = user_data_dir
            persistent_dir.mkdir(parents=True, exist_ok=True)  # Ensure directory exists
        
        # Clean up any stale lock files from previous Chrome instances
        lock_files = ["SingletonLock", "lockfile", "chrome.lock"]
        for lock_file in lock_files:
            lock_path = persistent_dir / lock_file
            if lock_path.exists():
                try:
                    lock_path.unlink()
                    logger.info(f"Cleaned up stale lock file: {lock_path}")
                except Exception as e:
                    logger.warning(f"Failed to clean lock file {lock_path}: {e}")

        # Chrome configuration (only using Chrome as requested)
        options = {
            **base_options,
            "channel": "chrome",
            "user_agent": self.user_agent.chrome,
            "bypass_csp": True,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--disable-notifications",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--no-default-browser-check",
                "--no-sandbox",  # WSL compatibility
                "--disable-gpu",  # WSL compatibility  
                "--disable-software-rasterizer",
                "--remote-debugging-port=9222",
            ],
            "permissions": [
                "notifications",
                "geolocation",
                "clipboard-read",
                "clipboard-write",
            ],
        }

        self.browser_context = await self.playwright.chromium.launch_persistent_context(
            user_data_dir=str(persistent_dir), **options
        )

        # Set up common headers and handlers
        await self._setup_context()
        logger.info("✅ Browser initialized successfully")

    async def _setup_context(self):
        """Set up context with common headers and handlers."""
        if not self.browser_context:
            return

        # Common headers for all pages
        headers = {
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "DNT": "1",
            "User-Agent": self.user_agent.chrome,
        }

        # Set headers for existing pages
        for page in self.browser_context.pages:
            await page.set_extra_http_headers(headers)

        # Set up page event handlers
        self.browser_context.on("page", self._setup_page_handlers)

    async def _setup_page_handlers(self, page):
        """Set up handlers for new pages."""
        # Set headers for new pages
        headers = {
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "DNT": "1",
            "User-Agent": self.user_agent.chrome,
        }
        await page.set_extra_http_headers(headers)

        # Set up event handlers
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.dismiss()))
        page.on("pageerror", lambda err: logger.error("Page error", error=str(err)))
        page.on("crash", lambda: logger.error("Page crashed", url=page.url))

    async def new_page(self):
        """Create a new page."""
        if not self.browser_context:
            await self.initialize()
        if not self.browser_context:
            raise RuntimeError("Browser context is not initialized")
        return await self.browser_context.new_page()

    async def close(self):
        """Close browser context."""
        if self.browser_context:
            await self.browser_context.close()
        if self.playwright:
            await self.playwright.stop()


class NavigationMixin:
    """Navigation utilities with retry logic."""

    async def navigate_to_url(self, page, url: str, options: dict | None = None) -> bool:
        """Navigate to URL with retry logic."""
        options = options or {}

        # Check if we're already on the correct page (important for reused browser contexts)
        try:
            current_url = page.url
            if current_url == url:
                logger.info("✅ Already on target URL", url=url)
                return True
        except Exception:
            # If we can't get current URL, proceed with navigation
            pass

        for attempt in range(getattr(self, 'retry_count', 3)):
            try:
                logger.info("🌐 Navigating to URL", url=url, attempt=attempt + 1)

                # Enhanced navigation options
                nav_options = {
                    "wait_until": "domcontentloaded",
                    "timeout": 30000,
                    **options,
                }

                await page.goto(url, **nav_options)

                # Wait for page to be ready
                await page.wait_for_load_state("networkidle", timeout=10000)

                # Verify we actually navigated to the correct URL
                final_url = page.url
                if final_url != url and not final_url.startswith(url):
                    logger.warning("⚠️ URL mismatch after navigation", expected=url, actual=final_url)
                    # Continue anyway - redirects are common

                logger.info("✅ Successfully navigated", url=url, final_url=final_url)
                return True

            except Exception as e:
                logger.warning("Navigation attempt failed", url=url, attempt=attempt + 1, error=str(e))
                if attempt < getattr(self, 'retry_count', 3) - 1:
                    await asyncio.sleep(getattr(self, 'retry_delay', 2.0) * (attempt + 1))
                else:
                    logger.error("❌ All navigation attempts failed", url=url)
                    return False
        return False


class InteractionMixin:
    """Element interaction utilities."""

    async def click_element(self, page, selector: str, options: dict | None = None) -> bool:
        """Click element with human-like behavior."""
        options = options or {}

        try:
            # Wait for element to be visible and stable
            await page.wait_for_selector(selector, state="visible", timeout=10000)

            # Scroll element into view
            await page.locator(selector).scroll_into_view_if_needed()

            # Add human-like delay
            await asyncio.sleep(random.uniform(0.1, 0.3))

            # Click with options
            click_options = {
                "delay": random.randint(50, 150),
                "force": False,
                **options,
            }

            await page.locator(selector).click(**click_options)

            # Wait for any navigation or dynamic content
            await page.wait_for_load_state("networkidle", timeout=5000)

            logger.info("✅ Clicked element", selector=selector)
            return True

        except Exception as e:
            logger.error("❌ Failed to click element", selector=selector, error=str(e))
            return False

    async def fill_input(self, page, selector: str, text: str, options: dict | None = None) -> bool:
        """Fill input with human-like typing."""
        options = options or {}

        try:
            # Wait for input to be ready
            await page.wait_for_selector(selector, state="visible", timeout=10000)

            # Clear existing content
            await page.locator(selector).clear()

            # Type with human-like delay
            type_options = {
                "delay": random.randint(50, 150),
                **options,
            }

            await page.locator(selector).fill(text, **type_options)

            logger.info("✅ Filled input", selector=selector, text=text)
            return True

        except Exception as e:
            logger.error("❌ Failed to fill input", selector=selector, error=str(e))
            return False


class ExtractionMixin:
    """Content extraction utilities."""

    async def extract_text(self, page, selector: str, options: dict | None = None) -> str | None:
        """Extract text from element with proper waiting and visibility checks."""
        options = options or {}
        timeout = options.get("timeout", 5000)

        try:
            # Wait for element to exist
            await page.wait_for_selector(selector, timeout=timeout)

            # Get the first matching element
            element = page.locator(selector).first
            
            # Check if element is visible before extracting
            if not await element.is_visible(timeout=2000):
                logger.debug("Element not visible", selector=selector)
                return None

            # Get text content
            text = await element.text_content()

            # Clean text if needed
            if options.get("clean", True):
                text = text.strip() if text else ""

            return text if text else None

        except Exception as e:
            logger.debug("Failed to extract text", selector=selector, error=str(e))
            return None

    async def extract_multiple(self, page, selector: str, options: dict | None = None) -> list[str]:
        """Extract text from multiple elements with visibility checks."""
        options = options or {}
        timeout = options.get("timeout", 5000)
        only_visible = options.get("only_visible", True)

        try:
            # Wait for at least one element
            await page.wait_for_selector(selector, timeout=timeout)

            # Get all matching elements
            elements = page.locator(selector)
            count = await elements.count()

            results = []
            for i in range(count):
                try:
                    element = elements.nth(i)
                    
                    # Check visibility if requested
                    if only_visible and not await element.is_visible(timeout=1000):
                        continue
                    
                    text = await element.text_content()
                    if text and text.strip():
                        cleaned_text = text.strip()
                        # Avoid duplicates
                        if cleaned_text not in results:
                            results.append(cleaned_text)
                except Exception:
                    continue

            return results

        except Exception as e:
            logger.debug("Failed to extract multiple elements", selector=selector, error=str(e))
            return []

    async def _handle_dynamic_content(self, page) -> None:
        """Handle dynamic content loading, SPAs, and lazy loading."""
        try:
            # Check if this is a Single Page Application
            is_spa = await page.evaluate("""
                () => {
                    // Common SPA indicators
                    const frameworks = ['react', 'vue', 'angular', 'svelte'];
                    const bodyClasses = document.body.className.toLowerCase();
                    const htmlAttributes = document.documentElement.outerHTML.toLowerCase();
                    
                    return frameworks.some(fw => 
                        bodyClasses.includes(fw) || 
                        htmlAttributes.includes(fw) ||
                        window[fw] !== undefined
                    );
                }
            """)
            
            if is_spa:
                logger.debug("Detected SPA, waiting for content to render")
                # Wait a bit longer for SPAs to fully render
                await asyncio.sleep(2)
                await page.wait_for_load_state("networkidle", timeout=10000)
            
            # Handle lazy loading by scrolling down to trigger content
            await self._trigger_lazy_loading(page)
            
            # Wait for any final content to load
            await page.wait_for_load_state("networkidle", timeout=5000)
            
        except Exception as e:
            logger.debug("Dynamic content handling failed", error=str(e))

    async def _trigger_lazy_loading(self, page) -> None:
        """Trigger lazy loading by scrolling and waiting for content."""
        try:
            # Get initial content count
            initial_content = await page.evaluate("document.body.innerText.length")
            
            # Scroll down in steps to trigger lazy loading
            for i in range(3):  # Scroll 3 times max
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await asyncio.sleep(1)  # Wait for lazy content to load
                
                # Check if new content was loaded
                new_content = await page.evaluate("document.body.innerText.length")
                if new_content > initial_content * 1.1:  # 10% more content
                    logger.debug(f"Lazy loading triggered, content increased from {initial_content} to {new_content}")
                    initial_content = new_content
                else:
                    break  # No more content being loaded
            
            # Scroll back to top
            await page.evaluate("window.scrollTo(0, 0)")
            await asyncio.sleep(0.5)
            
        except Exception as e:
            logger.debug("Lazy loading trigger failed", error=str(e))

    async def extract_page_content(self, page) -> dict[str, Any]:
        """Extract page content using simplified approach: selector -> AI alternatives -> fallback."""
        try:
            # Wait for page to be fully loaded
            await page.wait_for_load_state("networkidle", timeout=15000)
            
            # Extract title
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

            # Extract links (pattern-based or same-domain)
            links = []
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
                                    .filter(url => url && url.startsWith('http'))
                                    .filter((url, index, arr) => arr.indexOf(url) === index); // Remove duplicates
                    }
                """)
            except Exception as e:
                logger.warning("Failed to extract links", error=str(e))

            return {
                "title": title,
                "content": "",  # Will be filled by selector-based extraction
                "links": links,
                "code_examples": [],  # Will be extracted if needed
                "url": page.url,
            }

        except Exception as e:
            logger.error("❌ Failed to extract page content", error=str(e), url=page.url)
            return {
                "title": "",
                "content": "",
                "links": [],
                "code_examples": [],
                "url": page.url,
            }

    async def extract_content_with_strategy(self, page, selectors: dict[str, str] | None = None) -> dict[str, Any]:
        """Extract content using the new simplified strategy: selector -> AI alternatives -> fallback."""
        content_data = await self.extract_page_content(page)
        
        # Strategy 1: Try provided CSS selector
        if selectors and "content" in selectors:
            content = await self._try_css_selector(page, selectors["content"])
            if content and content.strip():
                content_data["content"] = content.strip()
                logger.info("✅ Content extracted using provided selector")
                return content_data
        
        # Strategy 2: Try default content selectors
        default_selectors = [
            "main", "article", ".content", ".main-content", "#content", 
            ".documentation", ".doc-content", "[role='main']"
        ]
        
        for selector in default_selectors:
            content = await self._try_css_selector(page, selector)
            if content and content.strip():
                content_data["content"] = content.strip()
                logger.info("✅ Content extracted using default selector", selector=selector)
                return content_data
        
        # Strategy 3: AI-suggested alternative selectors (placeholder for future implementation)
        # TODO: Implement AI selector suggestion based on page structure
        logger.info("🤖 AI selector suggestion not yet implemented, falling back to body extraction")
        
        # Strategy 4: Fallback - clean body content and convert to markdown
        logger.info("📄 Falling back to body content extraction with cleanup")
        content = await self._extract_clean_body_content(page)
        if content:
            content_data["content"] = content
            logger.info("✅ Content extracted using fallback body cleanup")
        else:
            logger.warning("⚠️ No content could be extracted from page")
        
        return content_data
    
    async def _try_css_selector(self, page, selector: str) -> str | None:
        """Try to extract content using a CSS selector."""
        try:
            element = page.locator(selector).first
            if await element.is_visible(timeout=2000):
                content = await element.text_content()
                return content if content and len(content.strip()) > 20 else None
        except Exception:
            pass
        return None
    
    async def _extract_clean_body_content(self, page) -> str:
        """Extract and clean body content, convert to markdown-like format."""
        try:
            # Extract body content and clean it
            cleaned_content = await page.evaluate(r"""
                () => {
                    // Clone body to avoid modifying original page
                    const clone = document.body.cloneNode(true);
                    
                    // Remove unwanted elements
                    const unwantedSelectors = [
                        'script', 'style', 'nav', 'header', 'footer', 
                        '.navigation', '.menu', '.sidebar', '.ad', '.advertisement',
                        '.cookie-banner', '.popup', '.modal', '.overlay'
                    ];
                    
                    unwantedSelectors.forEach(selector => {
                        clone.querySelectorAll(selector).forEach(el => el.remove());
                    });
                    
                    // Simple markdown-like conversion
                    function nodeToMarkdown(node) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            return node.textContent.trim();
                        }
                        
                        if (node.nodeType !== Node.ELEMENT_NODE) {
                            return '';
                        }
                        
                        const tagName = node.tagName.toLowerCase();
                        const text = Array.from(node.childNodes)
                            .map(child => nodeToMarkdown(child))
                            .join('')
                            .trim();
                        
                        if (!text) return '';
                        
                        // Convert common elements to markdown-like format
                        switch (tagName) {
                            case 'h1': return `# ${text}\\n\\n`;
                            case 'h2': return `## ${text}\\n\\n`;
                            case 'h3': return `### ${text}\\n\\n`;
                            case 'h4': return `#### ${text}\\n\\n`;
                            case 'h5': return `##### ${text}\\n\\n`;
                            case 'h6': return `###### ${text}\\n\\n`;
                            case 'p': return `${text}\\n\\n`;
                            case 'pre': return `\`\`\`\\n${text}\\n\`\`\`\\n\\n`;
                            case 'code': return text.includes('\\n') ? `\`\`\`\\n${text}\\n\`\`\`` : `\`${text}\``;
                            case 'li': return `- ${text}\\n`;
                            case 'br': return '\\n';
                            default: return text + ' ';
                        }
                    }
                    
                    return nodeToMarkdown(clone).replace(/\\n\\s*\\n\\s*\\n/g, '\\n\\n').trim();
                }
            """)
            
            return cleaned_content if cleaned_content and len(cleaned_content.strip()) > 50 else ""
            
        except Exception as e:
            logger.error("Failed to extract clean body content", error=str(e))
            return ""


class DocumentationScraper(SimpleBrowserManager, NavigationMixin, InteractionMixin, ExtractionMixin):
    """Complete documentation scraper with all capabilities."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.scraped_urls = set()
        self.failed_urls = set()

    async def scrape_documentation_source(
        self,
        ctx,
        base_url: str,
        crawl_depth: int = 3,
        selectors: dict[str, str] | None = None,
        allow_patterns: list[str] | None = None,
        ignore_patterns: list[str] | None = None,
        progress_callback = None,
    ) -> dict[str, Any]:
        """Scrape documentation from a source with crawling."""
        logger.info("🚀 Starting documentation scraping", url=base_url, depth=crawl_depth)

        try:
            # Initialize browser if not already done
            if not self.browser_context:
                await self.initialize()

            # Reset tracking sets
            self.scraped_urls.clear()
            self.failed_urls.clear()

            # Start scraping from base URL
            scraped_entries = []
            urls_to_scrape = [(base_url, 0)]  # (url, depth)
            pages_processed = 0
            total_discovered = 1  # Start with the base URL

            # Only report progress if context is available and not in background mode
            if ctx and getattr(ctx, '_background_mode', False) is False:
                try:
                    await ctx.report_progress(pages_processed, total_discovered)
                except Exception as ctx_error:
                    logger.debug("Context progress reporting failed", error=str(ctx_error))

            while urls_to_scrape:
                url, depth = urls_to_scrape.pop(0)

                # Skip if already scraped or failed
                if url in self.scraped_urls or url in self.failed_urls:
                    continue

                # Skip if depth exceeded
                if depth > crawl_depth:
                    continue

                # Check allow patterns first (allowlist) - if specified, URL must match at least one
                if allow_patterns and not any(re.search(pattern, url) for pattern in allow_patterns):
                    logger.debug("Skipping URL - doesn't match allow patterns", url=url, patterns=allow_patterns)
                    if ctx and getattr(ctx, '_background_mode', False) is False:
                        try:
                            await ctx.info(f"⏭️ Skipping {url} (doesn't match allow patterns)")
                        except Exception as ctx_error:
                            logger.debug("Context logging failed", error=str(ctx_error))
                    continue

                # Check ignore patterns (blocklist) - applied after allow patterns
                if ignore_patterns and any(re.search(pattern, url) for pattern in ignore_patterns):
                    logger.debug("Skipping URL due to ignore pattern", url=url, patterns=ignore_patterns)
                    if ctx and getattr(ctx, '_background_mode', False) is False:
                        try:
                            await ctx.info(f"⏭️ Skipping {url} (matches ignore pattern)")
                        except Exception as ctx_error:
                            logger.debug("Context logging failed", error=str(ctx_error))
                    continue

                # Scrape this URL
                if ctx and getattr(ctx, '_background_mode', False) is False:
                    try:
                        await ctx.info(f"📄 Scraping page {pages_processed + 1}/{total_discovered}: {url}")
                    except Exception as ctx_error:
                        logger.debug("Context logging failed", error=str(ctx_error))
                
                # Call progress callback for page start
                if progress_callback:
                    try:
                        await progress_callback({
                            "type": "page_start",
                            "url": url,
                            "page_number": pages_processed + 1,
                            "total_discovered": total_discovered,
                            "depth": depth
                        })
                    except Exception as callback_error:
                        logger.warning("Progress callback failed", error=str(callback_error))
                
                entry_data = await self._scrape_single_url(url, selectors)
                if entry_data:
                    scraped_entries.append(entry_data)
                    self.scraped_urls.add(url)
                    
                    title = entry_data.get("title", "Untitled")[:50]
                    if ctx and getattr(ctx, '_background_mode', False) is False:
                        try:
                            await ctx.info(f"✅ Successfully scraped: {title}")
                        except Exception as ctx_error:
                            logger.debug("Context logging failed", error=str(ctx_error))
                    
                    # Call progress callback for success
                    if progress_callback:
                        try:
                            await progress_callback({
                                "type": "page_success",
                                "url": url,
                                "title": title,
                                "content_length": len(entry_data.get("content", "")),
                                "links_found": len(entry_data.get("links", []))
                            })
                        except Exception as callback_error:
                            logger.warning("Progress callback failed", error=str(callback_error))

                    # Add internal links for deeper crawling if within depth limit
                    if depth < crawl_depth:
                        internal_links = self._filter_internal_links(entry_data.get("links", []), base_url)
                        new_links_count = 0
                        for link in internal_links:
                            if link not in self.scraped_urls and link not in self.failed_urls:
                                urls_to_scrape.append((link, depth + 1))
                                new_links_count += 1
                        
                        # Update total discovered pages (total grows as we find more links)
                        total_discovered += new_links_count
                        if ctx and new_links_count > 0 and getattr(ctx, '_background_mode', False) is False:
                            try:
                                await ctx.info(f"🔗 Discovered {new_links_count} new links (total: {total_discovered})")
                            except Exception as ctx_error:
                                logger.debug("Context logging failed", error=str(ctx_error))
                else:
                    self.failed_urls.add(url)
                    if ctx and getattr(ctx, '_background_mode', False) is False:
                        try:
                            await ctx.error(f"❌ Failed to scrape: {url}")
                        except Exception as ctx_error:
                            logger.debug("Context error logging failed", error=str(ctx_error))

                # Update progress - pages processed vs current total discovered
                pages_processed += 1
                if ctx and getattr(ctx, '_background_mode', False) is False:
                    # Use current progress vs total discovered, capped to not exceed the range 50-80
                    # (leaving room for post-processing in the parent function)
                    progress_range = 30  # 50 to 80 (80-50)
                    progress_ratio = min(pages_processed / max(total_discovered, 1), 1.0)
                    current_progress = 50 + int(progress_ratio * progress_range)
                    try:
                        await ctx.report_progress(current_progress, 100)
                    except Exception as ctx_error:
                        logger.debug("Context progress reporting failed", error=str(ctx_error))

                # Add delay between requests
                await asyncio.sleep(random.uniform(1, 3))

            logger.info(
                "✅ Documentation scraping completed",
                total_scraped=len(scraped_entries),
                failed_count=len(self.failed_urls),
            )

            return {
                "success": True,
                "entries_scraped": len(scraped_entries),
                "entries_failed": len(self.failed_urls),
                "entries": scraped_entries,
                "base_url": base_url,
                "crawl_depth": crawl_depth,
            }

        except Exception as e:
            logger.error("❌ Documentation scraping failed", error=str(e))
            return {
                "success": False,
                "error": str(e),
                "entries_scraped": 0,
                "entries_failed": 0,
                "entries": [],
            }

    async def _scrape_single_url(self, url: str, selectors: dict[str, str] | None = None) -> dict[str, Any] | None:
        """Scrape a single URL and return structured data."""
        try:
            logger.debug("📄 Scraping single URL", url=url)

            # Create new page
            page = await self.new_page()

            try:
                # CRITICAL: Always navigate to the requested URL, even for reused browser contexts
                # This ensures we don't stay on a previous page when domain browsers are reused
                logger.info("🌐 Navigating to requested URL", url=url)
                if not await self.navigate_to_url(page, url):
                    logger.error("❌ Failed to navigate to URL", url=url)
                    return None

                # Extract content using new simplified strategy
                content_data = await self.extract_content_with_strategy(page, selectors)

                # Generate content hash for deduplication
                content_text = content_data.get("content", "")
                content_hash = hashlib.sha256(content_text.encode()).hexdigest()

                # Create entry data
                entry_data = {
                    "id": str(uuid.uuid4()),
                    "url": url,
                    "title": content_data.get("title", ""),
                    "content": content_text,
                    "content_hash": content_hash,
                    "links": content_data.get("links", []),
                    "code_examples": content_data.get("code_examples", []),
                    "extracted_at": datetime.now(timezone.utc),
                }

                logger.debug("✅ Successfully scraped URL", url=url, title=entry_data["title"][:50])
                return entry_data

            finally:
                await page.close()

        except Exception as e:
            logger.error("❌ Failed to scrape URL", url=url, error=str(e))
            return None


    def _filter_internal_links(self, links: list[str], base_url: str) -> list[str]:
        """Filter links to only include internal ones."""
        base_domain = urlparse(base_url).netloc
        internal_links = []

        for link in links:
            try:
                parsed = urlparse(link)
                # Include if same domain or relative URL
                if parsed.netloc == base_domain or not parsed.netloc:
                    # Convert relative to absolute
                    if not parsed.netloc:
                        link = urljoin(base_url, link)
                    internal_links.append(link)
            except Exception:
                continue

        return list(set(internal_links))  # Remove duplicates


class ThreadPoolDocumentationScraper:
    """ThreadPoolExecutor-based documentation scraper with event loop isolation.
    
    This class solves uvloop + Playwright conflicts by using ThreadPoolExecutor
    where each thread gets its own isolated asyncio.run() event loop.
    Research-validated approach for I/O-bound browser automation.
    """
    
    def __init__(self, max_concurrent_browsers: int = 2):
        self.executor = ThreadPoolExecutor(max_workers=max_concurrent_browsers)
        self.active_jobs = {}  # Direct tracking without complex queues
        
    async def scrape_documentation(
        self,
        url: str,
        source_id: str,
        selectors: dict[str, str] | None = None,
        crawl_depth: int = 3,
        max_pages: int = 100,
        allow_patterns: list[str] | None = None,
        ignore_patterns: list[str] | None = None,
    ) -> dict[str, Any]:
        """Scrape documentation using ThreadPoolExecutor with isolated event loops.
        
        Args:
            url: Base URL to scrape
            source_id: Documentation source identifier
            selectors: CSS selectors for content extraction
            crawl_depth: Maximum depth for link crawling
            max_pages: Maximum number of pages to scrape
            allow_patterns: URL patterns to include (allowlist)
            ignore_patterns: URL patterns to skip (blocklist)
            
        Returns:
            Dictionary with scraping results and metadata
        """
        logger.info("🚀 Starting ThreadPool documentation scraping", 
                   url=url, source_id=source_id, crawl_depth=crawl_depth)
        
        # Track job start
        self.active_jobs[source_id] = {
            "status": "in_progress",
            "url": url,
            "start_time": datetime.now(timezone.utc),
            "pages_processed": 0
        }
        
        try:
            # Get the current event loop (FastMCP's uvloop)
            loop = asyncio.get_running_loop()
            
            # Run browser work in ThreadPoolExecutor with isolated event loop
            result = await loop.run_in_executor(
                self.executor,
                self._browser_worker_thread,
                url,
                source_id,
                selectors,
                crawl_depth,
                max_pages,
                allow_patterns,
                ignore_patterns
            )
            
            # Update job tracking
            self.active_jobs[source_id]["status"] = "completed"
            self.active_jobs[source_id]["end_time"] = datetime.now(timezone.utc)
            
            logger.info("✅ ThreadPool documentation scraping completed", 
                       source_id=source_id, pages=result.get("pages_scraped", 0))
            
            return result
            
        except Exception as e:
            # Update job tracking
            self.active_jobs[source_id]["status"] = "failed"
            self.active_jobs[source_id]["error"] = str(e)
            self.active_jobs[source_id]["end_time"] = datetime.now(timezone.utc)
            
            logger.error("❌ ThreadPool documentation scraping failed", 
                        source_id=source_id, error=str(e))
            
            return {
                "success": False,
                "error": str(e),
                "source_id": source_id,
                "pages_scraped": 0,
                "entries": []
            }
    
    def _browser_worker_thread(
        self,
        url: str,
        source_id: str,
        selectors: dict[str, str] | None,
        crawl_depth: int,
        max_pages: int,
        allow_patterns: list[str] | None,
        ignore_patterns: list[str] | None,
    ) -> dict[str, Any]:
        """Browser worker function that runs in separate thread with isolated event loop.
        
        This function runs asyncio.run() to create a completely isolated event loop,
        avoiding conflicts with FastMCP's uvloop in the main thread.
        """
        import asyncio
        from patchright.async_api import async_playwright
        
        async def browser_task():
            """Complete browser automation task with Playwright async API."""
            logger.info("🔧 Starting browser task in isolated thread", 
                       thread_id=threading.current_thread().ident,
                       source_id=source_id)
            
            scraped_urls = set()
            failed_urls = set()
            scraped_entries = []
            
            # Each thread creates its own Playwright instance (thread safety)
            async with async_playwright() as p:
                # Launch browser (headless for WSL compatibility)
                browser = await p.chromium.launch(
                    headless=True,  # WSL-compatible headless mode
                    channel="chrome",  # Use system Chrome if available
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
                            logger.debug("Skipping URL - doesn't match allow patterns", 
                                       url=current_url)
                            continue
                            
                        if ignore_patterns and any(re.search(pattern, current_url) for pattern in ignore_patterns):
                            logger.debug("Skipping URL - matches ignore patterns", 
                                       url=current_url)
                            continue
                        
                        try:
                            # Create new page for this URL
                            page = await context.new_page()
                            
                            # Navigate to URL with timeout
                            logger.info("📄 Scraping page", url=current_url, depth=depth)
                            await page.goto(current_url, wait_until="networkidle", timeout=30000)
                            
                            # Extract content using selectors or smart extraction
                            content_data = await self._extract_page_content(page, selectors)
                            
                            # Generate entry
                            entry = {
                                "id": str(uuid.uuid4()),
                                "url": current_url,
                                "title": content_data.get("title", ""),
                                "content": content_data.get("content", ""),
                                "content_hash": hashlib.sha256(
                                    content_data.get("content", "").encode()
                                ).hexdigest(),
                                "links": content_data.get("links", []),
                                "code_examples": content_data.get("code_examples", []),
                                "extracted_at": datetime.now(timezone.utc),
                                "depth": depth
                            }
                            
                            scraped_entries.append(entry)
                            scraped_urls.add(current_url)
                            pages_processed += 1
                            
                            # Update job progress
                            if source_id in self.active_jobs:
                                self.active_jobs[source_id]["pages_processed"] = pages_processed
                            
                            logger.info("✅ Successfully scraped page", 
                                       url=current_url, title=entry["title"][:50])
                            
                            # Extract and queue internal links for next depth level
                            if depth < crawl_depth:
                                internal_links = self._filter_internal_links(
                                    content_data.get("links", []), url
                                )
                                for link in internal_links:  # No limit - URL deduplication handles efficiency
                                    if link not in scraped_urls:
                                        urls_to_scrape.append((link, depth + 1))
                            
                            await page.close()
                            
                        except Exception as page_error:
                            logger.warning("❌ Failed to scrape page", 
                                         url=current_url, error=str(page_error))
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
                    logger.info("🔧 Browser closed for thread", 
                               thread_id=threading.current_thread().ident)
        
        # Each thread gets its own isolated event loop via asyncio.run()
        # This completely bypasses uvloop conflicts in the main thread
        return asyncio.run(browser_task())
    
    async def _extract_page_content(self, page, selectors: dict[str, str] | None) -> dict[str, Any]:
        """Extract content from page using selectors or smart extraction."""
        content_data = {"title": "", "content": "", "links": [], "code_examples": []}
        
        try:
            # Extract title
            content_data["title"] = await page.title()
            
            # Extract content using selectors or fallback to smart extraction
            if selectors and "content" in selectors:
                try:
                    content_element = await page.query_selector(selectors["content"])
                    if content_element:
                        content_data["content"] = await content_element.inner_text()
                except Exception:
                    pass
            
            # Fallback to smart content extraction
            if not content_data["content"]:
                # Try common content selectors
                content_selectors = [
                    "main", "article", ".content", "#content", 
                    ".documentation", ".docs", "[role='main']"
                ]
                
                for selector in content_selectors:
                    try:
                        element = await page.query_selector(selector)
                        if element:
                            content_data["content"] = await element.inner_text()
                            break
                    except Exception:
                        continue
                
                # Final fallback to body
                if not content_data["content"]:
                    body = await page.query_selector("body")
                    if body:
                        content_data["content"] = await body.inner_text()
            
            # Expand all collapsed navigation and trigger hover states
            logger.info("🔧 Expanding collapsed navigation...")
            expansion_result = await page.evaluate("""
                () => {
                    let clickedCount = 0;
                    let unhiddenCount = 0;
                    let hoveredCount = 0;
                    
                    try {
                        // Click all expandable elements
                        const expandableSelectors = [
                            '[aria-expanded="false"]',
                            '.collapsed', '[data-collapsed]', 
                            '.menu__list-item--collapsed .menu__link',  // Docusaurus
                            '.sidebar-toggle', '.nav-toggle', '.hamburger',
                            '[data-toggle="collapse"]', '[data-bs-toggle="collapse"]',  // Bootstrap
                            '.accordion-toggle', '.dropdown-toggle',
                            '.expand', '.expandable', '.toggle',
                            'summary',  // HTML details/summary
                            '[role="button"][aria-expanded="false"]'
                        ];
                        
                        expandableSelectors.forEach(selector => {
                            document.querySelectorAll(selector).forEach(el => {
                                try { 
                                    el.click(); 
                                    clickedCount++;
                                } catch(e) {
                                    console.log('Click error:', e);
                                }
                            });
                        });
                        
                        // Show all hidden elements
                        const hiddenSelectors = [
                            '[style*="display: none"]', '[style*="display:none"]',
                            '[hidden]', '.hidden', '.d-none',
                            '.menu-hidden', '.sidebar-hidden', '.nav-hidden',
                            '.collapse:not(.show)', '.collapsed-content'
                        ];
                        
                        hiddenSelectors.forEach(selector => {
                            document.querySelectorAll(selector).forEach(el => {
                                try {
                                    el.style.display = 'block';
                                    el.style.visibility = 'visible';
                                    el.removeAttribute('hidden');
                                    el.classList.remove('hidden', 'd-none');
                                    unhiddenCount++;
                                } catch(e) {
                                    console.log('Unhide error:', e);
                                }
                            });
                        });
                        
                        // Trigger hover on navigation elements to reveal dropdowns
                        const navSelectors = [
                            'nav a', '.navigation a', '.menu a', '.sidebar a',
                            '.nav-item', '.menu-item', '.dropdown', '.has-dropdown'
                        ];
                        
                        navSelectors.forEach(selector => {
                            document.querySelectorAll(selector).forEach(el => {
                                try {
                                    el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
                                    el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
                                    hoveredCount++;
                                } catch(e) {
                                    console.log('Hover error:', e);
                                }
                            });
                        });
                        
                    } catch(e) {
                        console.log('Overall expansion error:', e);
                    }
                    
                    return {clicked: clickedCount, unhidden: unhiddenCount, hovered: hoveredCount};
                }
            """)
            
            logger.info("🎯 Navigation expansion complete", 
                       clicked=expansion_result.get('clicked', 0),
                       unhidden=expansion_result.get('unhidden', 0), 
                       hovered=expansion_result.get('hovered', 0))
            
            # Wait longer for navigation expansions and animations to complete
            await page.wait_for_timeout(3000)
            
            # Wait for any additional network requests triggered by expansion
            try:
                await page.wait_for_load_state('networkidle', timeout=5000)
            except Exception:
                # Continue if network idle timeout - some sites have continuous requests
                pass
            
            # Extract links using JavaScript evaluation to handle React/SPA apps
            content_data["links"] = []
            
            # Use evaluate to get href values that JavaScript has set
            extracted_hrefs = await page.evaluate("""
                () => {
                    const links = Array.from(document.querySelectorAll('a'));
                    return links.map(link => ({
                        href: link.href,
                        text: link.textContent?.trim() || ''
                    })).filter(link => link.href && link.href.trim());
                }
            """)
            
            print(f"🔗 Found {len(extracted_hrefs)} valid links via evaluate")
            
            for link_data in extracted_hrefs:
                href = link_data['href']
                if href and href.strip():
                    content_data["links"].append(href)
            
            print(f"🔗 Total links extracted: {len(content_data['links'])}")
            
            # Extract code examples
            code_elements = await page.query_selector_all("code, pre, .highlight, .code")
            content_data["code_examples"] = []
            for code_elem in code_elements:
                try:
                    code_text = await code_elem.inner_text()
                    if code_text.strip():
                        content_data["code_examples"].append(code_text.strip())
                except Exception:
                    continue
                    
        except Exception as e:
            logger.warning("Failed to extract page content", error=str(e))
        
        return content_data
    
    def _filter_internal_links(self, links: list[str], base_url: str) -> list[str]:
        """Filter links to only include internal ones."""
        base_domain = urlparse(base_url).netloc
        internal_links = []
        
        for link in links:
            try:
                parsed = urlparse(link)
                # Include if same domain or relative URL
                if parsed.netloc == base_domain or not parsed.netloc:
                    # Convert relative to absolute
                    if not parsed.netloc:
                        link = urljoin(base_url, link)
                    internal_links.append(link)
            except Exception:
                continue
        
        return list(set(internal_links))  # Remove duplicates
    
    def get_job_status(self, source_id: str) -> dict[str, Any] | None:
        """Get current status of a scraping job."""
        return self.active_jobs.get(source_id)
    
    def cleanup_completed_jobs(self, max_age_hours: int = 24):
        """Clean up old completed job entries."""
        current_time = datetime.now(timezone.utc)
        cutoff_time = current_time - timedelta(hours=max_age_hours)
        
        to_remove = []
        for source_id, job_data in self.active_jobs.items():
            end_time = job_data.get("end_time")
            if end_time and end_time < cutoff_time:
                to_remove.append(source_id)
        
        for source_id in to_remove:
            del self.active_jobs[source_id]
            
        logger.info("🧹 Cleaned up old job entries", removed=len(to_remove))
    
    async def shutdown(self):
        """Gracefully shutdown the ThreadPoolExecutor."""
        logger.info("🔧 Shutting down ThreadPoolExecutor...")
        self.executor.shutdown(wait=True)
        logger.info("✅ ThreadPoolExecutor shutdown completed")


# Global instance for use by FastMCP tools
thread_pool_scraper = ThreadPoolDocumentationScraper()

