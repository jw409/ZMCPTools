"""Web scraping service using Patchright for documentation intelligence."""

import asyncio
import hashlib
import random
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import structlog
from bs4 import BeautifulSoup
from fake_useragent import UserAgent
from patchright.async_api import async_playwright

logger = structlog.get_logger("web_scraper")


class SimpleBrowserManager:
    """Browser manager with anti-detection features using Patchright."""

    def __init__(self, browser_type: str = "chrome", headless: bool = True):
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

        # Create user data directory for persistence
        if user_data_dir is None:
            user_data_root = Path("./user_data")
            user_data_root.mkdir(parents=True, exist_ok=True)
            persistent_dir = user_data_root / f"{self.browser_type}_{random.randint(1000, 9999)}"
        else:
            persistent_dir = user_data_dir

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

                logger.info("✅ Successfully navigated", url=url)
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
        """Extract text from element."""
        options = options or {}

        try:
            # Wait for element
            await page.wait_for_selector(selector, timeout=5000)

            # Get text content
            element = page.locator(selector)
            text = await element.text_content()

            # Clean text if needed
            if options.get("clean", True):
                text = text.strip() if text else ""

            return text

        except Exception as e:
            logger.error("❌ Failed to extract text", selector=selector, error=str(e))
            return None

    async def extract_multiple(self, page, selector: str, options: dict | None = None) -> list[str]:
        """Extract text from multiple elements."""
        options = options or {}

        try:
            # Wait for at least one element
            await page.wait_for_selector(selector, timeout=5000)

            # Get all matching elements
            elements = page.locator(selector)
            count = await elements.count()

            results = []
            for i in range(count):
                try:
                    text = await elements.nth(i).text_content()
                    if text and text.strip():
                        results.append(text.strip())
                except Exception:
                    continue

            return results

        except Exception as e:
            logger.error("❌ Failed to extract multiple", selector=selector, error=str(e))
            return []

    async def extract_page_content(self, page) -> dict[str, Any]:
        """Extract comprehensive page content."""
        try:
            # Get page HTML
            content = await page.content()
            soup = BeautifulSoup(content, "html.parser")

            # Extract title
            title_elem = soup.find("title")
            title = title_elem.get_text().strip() if title_elem else ""

            # Try multiple title selectors if title tag is empty
            if not title:
                title_selectors = ["h1", "h2", ".title", ".page-title", "[data-testid='title']"]
                for selector in title_selectors:
                    try:
                        title_text = await self.extract_text(page, selector)
                        if title_text:
                            title = title_text
                            break
                    except Exception:
                        continue

            # Extract main content using various selectors
            content_selectors = [
                "main",
                "article",
                ".content",
                ".main-content",
                "#content",
                ".documentation",
                ".doc-content",
            ]

            main_content = ""
            for selector in content_selectors:
                try:
                    content_text = await self.extract_text(page, selector)
                    if content_text and len(content_text) > len(main_content):
                        main_content = content_text
                except Exception:
                    continue

            # Fallback to body if no main content found
            if not main_content:
                try:
                    main_content = await self.extract_text(page, "body") or ""
                except Exception:
                    main_content = ""

            # Extract links
            links = []
            try:
                link_elements = soup.find_all("a", href=True)
                for link in link_elements:
                    href = link.get("href")
                    if href and isinstance(href, str):
                        # Convert relative URLs to absolute
                        absolute_url = urljoin(page.url, href)
                        links.append(absolute_url)
            except Exception as e:
                logger.warning("Failed to extract links", error=str(e))

            # Extract code examples
            code_examples = []
            try:
                code_selectors = ["pre", "code", ".highlight", ".code-block"]
                for selector in code_selectors:
                    codes = await self.extract_multiple(page, selector)
                    code_examples.extend(codes)
            except Exception as e:
                logger.warning("Failed to extract code examples", error=str(e))

            return {
                "title": title,
                "content": main_content,
                "links": links,
                "code_examples": code_examples,
                "url": page.url,
            }

        except Exception as e:
            logger.error("❌ Failed to extract page content", error=str(e))
            return {
                "title": "",
                "content": "",
                "links": [],
                "code_examples": [],
                "url": page.url,
            }


class DocumentationScraper(SimpleBrowserManager, NavigationMixin, InteractionMixin, ExtractionMixin):
    """Complete documentation scraper with all capabilities."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.scraped_urls = set()
        self.failed_urls = set()

    async def scrape_documentation_source(
        self,
        base_url: str,
        crawl_depth: int = 3,
        selectors: dict[str, str] | None = None,
        ignore_patterns: list[str] | None = None,
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

            while urls_to_scrape:
                url, depth = urls_to_scrape.pop(0)

                # Skip if already scraped or failed
                if url in self.scraped_urls or url in self.failed_urls:
                    continue

                # Skip if depth exceeded
                if depth > crawl_depth:
                    continue

                # Skip if matches ignore patterns
                if ignore_patterns and any(re.search(pattern, url) for pattern in ignore_patterns):
                    logger.debug("Skipping URL due to ignore pattern", url=url)
                    continue

                # Scrape this URL
                entry_data = await self._scrape_single_url(url, selectors)
                if entry_data:
                    scraped_entries.append(entry_data)
                    self.scraped_urls.add(url)

                    # Add internal links for deeper crawling if within depth limit
                    if depth < crawl_depth:
                        internal_links = self._filter_internal_links(entry_data.get("links", []), base_url)
                        for link in internal_links:
                            if link not in self.scraped_urls and link not in self.failed_urls:
                                urls_to_scrape.append((link, depth + 1))
                else:
                    self.failed_urls.add(url)

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
                # Navigate to URL
                if not await self.navigate_to_url(page, url):
                    return None

                # Extract content using custom selectors if provided
                if selectors:
                    content_data = await self._extract_with_selectors(page, selectors)
                else:
                    content_data = await self.extract_page_content(page)

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

    async def _extract_with_selectors(self, page, selectors: dict[str, str]) -> dict[str, Any]:
        """Extract content using custom CSS selectors."""
        extracted_data = {
            "title": "",
            "content": "",
            "links": [],
            "code_examples": [],
        }

        try:
            # Extract title
            if "title" in selectors:
                title = await self.extract_text(page, selectors["title"])
                if title:
                    extracted_data["title"] = title

            # Extract content
            if "content" in selectors:
                content = await self.extract_text(page, selectors["content"])
                if content:
                    extracted_data["content"] = content

            # Extract links if selector provided
            if "links" in selectors:
                # Get all link elements and extract hrefs
                content = await page.content()
                soup = BeautifulSoup(content, "html.parser")
                link_elements = soup.select(selectors["links"])
                for elem in link_elements:
                    href = elem.get("href")
                    if href and isinstance(href, str):
                        absolute_url = urljoin(page.url, href)
                        extracted_data["links"].append(absolute_url)

            # Extract code examples if selector provided
            if "code" in selectors:
                codes = await self.extract_multiple(page, selectors["code"])
                extracted_data["code_examples"] = codes

            # Fallback to default extraction if nothing found
            if not extracted_data["title"] and not extracted_data["content"]:
                fallback_data = await self.extract_page_content(page)
                extracted_data.update(fallback_data)

        except Exception as e:
            logger.warning("Failed to extract with custom selectors", error=str(e))
            # Fallback to default extraction
            extracted_data = await self.extract_page_content(page)

        return extracted_data

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