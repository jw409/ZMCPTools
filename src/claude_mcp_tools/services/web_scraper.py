"""Base web scraping classes using synchronous Patchright."""

import random
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import structlog
from fake_useragent import UserAgent
from patchright.sync_api import sync_playwright

logger = structlog.get_logger("web_scraper")


class BrowserManager:
    """Browser manager with anti-detection features using sync Patchright."""

    def __init__(self, browser_type: str = "chrome", headless: bool = True):
        self.browser_type = browser_type
        self.headless = headless
        self.user_agent = UserAgent(os="Windows")
        self.browser_context = None
        self.playwright = None
        self.retry_count = 3
        self.retry_delay = 2.0

    def initialize(self, user_data_dir: Path | None = None):
        """Initialize browser with anti-detection features."""
        logger.info("🔧 Initializing patchright browser...", browser_type=self.browser_type)

        try:
            # Start patchright playwright with browser path validation
            self.playwright = sync_playwright().start()

            # Validate browser installation
            self._validate_browser_installation()

        except Exception as e:
            logger.error("Failed to initialize patchright playwright", error=str(e))
            self._handle_browser_installation_error(e)
            raise

        # Base launch options with anti-detection
        base_options = {
            "headless": self.headless,
            "viewport": {
                "width": random.randint(1280, 1920),
                "height": random.randint(720, 1080),
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

        # Chrome configuration with WSL-compatible flags
        options = {
            **base_options,
            "channel": "chrome",
            "user_agent": self.user_agent.chrome,
            "bypass_csp": True,
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
                "--remote-debugging-port=9222",
            ],
            "permissions": [
                "notifications",
                "geolocation",
                "clipboard-read",
                "clipboard-write",
            ],
        }

        self.browser_context = self.playwright.chromium.launch_persistent_context(
            user_data_dir=str(persistent_dir), **options,
        )

        # Set up common headers and handlers
        self._setup_context()
        logger.info("✅ Browser initialized successfully")

    def _validate_browser_installation(self):
        """Validate that browsers are properly installed and accessible."""
        try:
            # Check if playwright is initialized and chromium executable exists
            if not self.playwright:
                raise RuntimeError("Playwright not initialized")
            
            chromium_path = self.playwright.chromium.executable_path
            logger.info("Browser executable found", path=chromium_path)

            # Verify the executable exists
            if not Path(chromium_path).exists():
                raise FileNotFoundError(f"Chromium executable not found at: {chromium_path}")

            # Verify it's executable
            if not Path(chromium_path).is_file():
                raise PermissionError(f"Chromium executable is not a valid file: {chromium_path}")

            logger.info("✅ Browser installation validated", executable_path=chromium_path)

        except Exception as e:
            logger.error("Browser validation failed", error=str(e))
            raise

    def _handle_browser_installation_error(self, error: Exception):
        """Handle browser installation errors with helpful guidance."""
        error_msg = str(error)

        logger.error("=== BROWSER INSTALLATION ERROR ===")
        logger.error("Error details", error=error_msg)

        if "chromium" in error_msg.lower() or "browser" in error_msg.lower():
            logger.error("🔧 Browser Installation Issue Detected")
            logger.error("   This is likely because patchright browsers need to be installed.")
            logger.error("   Run this command to install browsers:")
            logger.error("   uv run python -m patchright install chromium")
            logger.error("")
            logger.error("   Or if using the ClaudeMcpTools CLI:")
            logger.error("   claude-mcp-tools install  # Browsers are auto-installed during setup")

        elif "path" in error_msg.lower() or "not found" in error_msg.lower():
            logger.error("🔍 Browser Path Issue Detected")
            logger.error("   The browser executable was not found at the expected location.")
            logger.error("   This may happen if:")
            logger.error("   1. Browsers were not installed: Run 'uv run python -m patchright install chromium'")
            logger.error("   2. Installation directory changed: Check ~/.cache/ms-playwright/")
            logger.error("   3. Permissions issue: Ensure browser executable has proper permissions")

        else:
            logger.error("🚨 Unknown Browser Error")
            logger.error("   Please check:")
            logger.error("   1. Browser installation: uv run python -m patchright install chromium")
            logger.error("   2. System requirements: https://playwright.dev/docs/intro")
            logger.error("   3. WSL compatibility (if using WSL): Extra dependencies may be needed")

        logger.error("=== END BROWSER ERROR DETAILS ===")

    def _setup_context(self):
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
            page.set_extra_http_headers(headers)

        # Set up page event handlers
        self.browser_context.on("page", self._setup_page_handlers)

    def _setup_page_handlers(self, page):
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
        page.set_extra_http_headers(headers)

        # Set up event handlers
        page.on("dialog", lambda dialog: dialog.dismiss())
        page.on("pageerror", lambda err: logger.error("Page error", error=str(err)))
        page.on("crash", lambda: logger.error("Page crashed", url=page.url))

    def new_page(self):
        """Create a new page."""
        if not self.browser_context:
            self.initialize()
        if not self.browser_context:
            raise RuntimeError("Browser context is not initialized")
        return self.browser_context.new_page()

    def close(self):
        """Close browser context."""
        if self.browser_context:
            self.browser_context.close()
        if self.playwright:
            self.playwright.stop()


class NavigationMixin:
    """Navigation utilities with retry logic."""

    def navigate_to_url(self, page, url: str, options: dict | None = None) -> bool:
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

        for attempt in range(getattr(self, "retry_count", 3)):
            try:
                logger.info("🌐 Navigating to URL", url=url, attempt=attempt + 1)

                # Enhanced navigation options
                nav_options = {
                    "wait_until": "domcontentloaded",
                    "timeout": 30000,
                    **options,
                }

                page.goto(url, **nav_options)

                # Wait for page to be ready
                page.wait_for_load_state("networkidle", timeout=10000)

                # Verify we actually navigated to the correct URL
                final_url = page.url
                if final_url != url and not final_url.startswith(url):
                    logger.warning("⚠️ URL mismatch after navigation", expected=url, actual=final_url)
                    # Continue anyway - redirects are common

                logger.info("✅ Successfully navigated", url=url, final_url=final_url)
                return True

            except Exception as e:
                logger.warning("Navigation attempt failed", url=url, attempt=attempt + 1, error=str(e))
                if attempt < getattr(self, "retry_count", 3) - 1:
                    time.sleep(getattr(self, "retry_delay", 2.0) * (attempt + 1))
                else:
                    logger.error("❌ All navigation attempts failed", url=url)
                    return False
        return False


class InteractionMixin:
    """Element interaction utilities."""

    def click_element(self, page, selector: str, options: dict | None = None) -> bool:
        """Click element with human-like behavior."""
        options = options or {}

        try:
            # Wait for element to be visible and stable
            page.wait_for_selector(selector, state="visible", timeout=10000)

            # Scroll element into view
            page.locator(selector).scroll_into_view_if_needed()

            # Add human-like delay
            time.sleep(random.uniform(0.1, 0.3))

            # Click with options
            click_options = {
                "delay": random.randint(50, 150),
                "force": False,
                **options,
            }

            page.locator(selector).click(**click_options)

            # Wait for any navigation or dynamic content
            page.wait_for_load_state("networkidle", timeout=5000)

            logger.info("✅ Clicked element", selector=selector)
            return True

        except Exception as e:
            logger.error("❌ Failed to click element", selector=selector, error=str(e))
            return False

    def fill_input(self, page, selector: str, text: str, options: dict | None = None) -> bool:
        """Fill input with human-like typing."""
        options = options or {}

        try:
            # Wait for input to be ready
            page.wait_for_selector(selector, state="visible", timeout=10000)

            # Clear existing content
            page.locator(selector).clear()

            # Type with human-like delay
            type_options = {
                "delay": random.randint(50, 150),
                **options,
            }

            page.locator(selector).fill(text, **type_options)

            logger.info("✅ Filled input", selector=selector, text=text)
            return True

        except Exception as e:
            logger.error("❌ Failed to fill input", selector=selector, error=str(e))
            return False


class ExtractionMixin:
    """Content extraction utilities."""

    def extract_text(self, page, selector: str, options: dict | None = None) -> str | None:
        """Extract text from element with proper waiting and visibility checks."""
        options = options or {}
        timeout = options.get("timeout", 5000)

        try:
            # Wait for element to exist
            page.wait_for_selector(selector, timeout=timeout)

            # Get the first matching element
            element = page.locator(selector).first

            # Check if element is visible before extracting
            if not element.is_visible(timeout=2000):
                logger.debug("Element not visible", selector=selector)
                return None

            # Get text content
            text = element.text_content()

            # Clean text if needed
            if options.get("clean", True):
                text = text.strip() if text else ""

            return text if text else None

        except Exception as e:
            logger.debug("Failed to extract text", selector=selector, error=str(e))
            return None

    def extract_multiple(self, page, selector: str, options: dict | None = None) -> list[str]:
        """Extract text from multiple elements with visibility checks."""
        options = options or {}
        timeout = options.get("timeout", 5000)
        only_visible = options.get("only_visible", True)

        try:
            # Wait for at least one element
            page.wait_for_selector(selector, timeout=timeout)

            # Get all matching elements
            elements = page.locator(selector)
            count = elements.count()

            results = []
            for i in range(count):
                try:
                    element = elements.nth(i)

                    # Check visibility if requested
                    if only_visible and not element.is_visible(timeout=1000):
                        continue

                    text = element.text_content()
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

    def extract_page_content(self, page) -> dict[str, Any]:
        """Extract basic page content including title and links."""
        try:
            # Wait for page to be fully loaded
            page.wait_for_load_state("networkidle", timeout=15000)

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

            # Extract links (pattern-based or same-domain)
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

    def filter_internal_links(self, links: list[str], base_url: str, include_subdomains: bool = False) -> list[str]:
        """Filter links to only include internal ones with subdomain control."""
        base_domain = urlparse(base_url).netloc
        internal_links = []

        for link in links:
            try:
                parsed = urlparse(link)
                # Include if same domain, subdomain (if allowed), or relative URL
                if self._is_allowed_domain(parsed.netloc, base_domain, include_subdomains) or not parsed.netloc:
                    # Convert relative to absolute
                    if not parsed.netloc:
                        link = urljoin(base_url, link)
                    internal_links.append(link)
            except Exception:
                continue

        return list(set(internal_links))  # Remove duplicates

    def _is_allowed_domain(self, url_domain: str, base_domain: str, include_subdomains: bool) -> bool:
        """Check if a domain is allowed based on subdomain policy."""
        if not url_domain:
            return False

        # Exact domain match is always allowed
        if url_domain == base_domain:
            return True

        # Subdomain check only if explicitly enabled
        if include_subdomains and url_domain.endswith(f".{base_domain}"):
            return True

        return False

    def convert_pattern_to_regex(self, pattern: str) -> str:
        """Convert glob pattern to regex pattern or return regex as-is.
        
        Auto-detects pattern type:
        - Glob patterns: **/docs/**, /docs/*, *.html
        - Regex patterns: .*/docs/.*, \\d+, [a-z]+
        
        Examples:
        - '**/docs/**' → '.*/docs(/.*)?'  (matches /docs and /docs/anything)
        - '/docs/**' → '/docs(/.*)?'  
        - '*.html' → '[^/]*\\.html'
        - '.*/docs/.*' → '.*/docs/.*' (already regex)
        """
        # Check if it's already a regex pattern (contains regex-specific chars)
        regex_indicators = [".*", "\\d", "\\w", "\\s", "[", "]", "{", "}", "(", ")", "|", "^", "$"]
        if any(indicator in pattern for indicator in regex_indicators):
            return pattern  # Already a regex

        # Convert glob pattern to regex
        regex_pattern = pattern

        # Escape regex special characters except * and ?
        regex_pattern = re.escape(regex_pattern)

        # Convert glob wildcards back to regex
        # Special handling for ** at end to make trailing path optional
        if regex_pattern.endswith("\\*\\*"):
            # **/docs/** → .*/docs(/.*)? (matches /docs and /docs/anything)
            regex_pattern = regex_pattern[:-4] + "(/.*)?"
        else:
            # Regular ** in middle → .*
            regex_pattern = regex_pattern.replace("\\*\\*", ".*")

        regex_pattern = regex_pattern.replace("\\*", "[^/]*")  # * matches any chars except /
        regex_pattern = regex_pattern.replace("\\?", ".")      # ? matches single char

        return regex_pattern
