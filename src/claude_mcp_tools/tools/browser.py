"""Browser automation tools for navigation, screenshots, and content extraction."""

import base64
from pathlib import Path
from typing import Annotated, Any

import structlog
from pydantic import Field
from markdownify import markdownify

from ..services.web_scraper import DocumentationScraper
from .app import app

logger = structlog.get_logger("tools.browser")


@app.tool(tags={"browser", "navigation", "web"})
async def go_to_url(
    url: Annotated[str, Field(
        description="URL to navigate to",
        pattern=r"^https?://.*",
    )],
    wait_for: Annotated[str, Field(
        description="What to wait for after navigation",
        pattern=r"^(load|domcontentloaded|networkidle)$",
    )] = "domcontentloaded",
    timeout: Annotated[int, Field(
        description="Timeout in milliseconds",
        ge=1000,
        le=60000,
    )] = 30000,
) -> dict[str, Any]:
    """Navigate to a URL and confirm successful loading."""
    try:
        scraper = DocumentationScraper(headless=True)
        await scraper.initialize()
        
        page = await scraper.new_page()
        
        try:
            # Navigate with specified options
            success = await scraper.navigate_to_url(
                page, 
                url, 
                options={
                    "wait_until": wait_for,
                    "timeout": timeout
                }
            )
            
            if success:
                # Get basic page info
                title = await page.title()
                current_url = page.url
                
                return {
                    "success": True,
                    "url": current_url,
                    "title": title,
                    "message": f"Successfully navigated to {url}"
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to navigate to {url}",
                    "url": url
                }
                
        finally:
            await page.close()
            await scraper.close()
            
    except Exception as e:
        logger.error("Error navigating to URL", url=url, error=str(e))
        return {
            "success": False,
            "error": f"Navigation failed: {str(e)}",
            "url": url
        }


@app.tool(tags={"browser", "screenshot", "visual", "debugging"})
async def take_screenshot(
    url: Annotated[str, Field(
        description="URL to take screenshot of",
        pattern=r"^https?://.*",
    )],
    output_path: Annotated[str | None, Field(
        description="Optional path to save screenshot (defaults to temp file)",
        default=None,
    )] = None,
    full_page: Annotated[bool, Field(
        description="Capture full page or just viewport",
    )] = False,
    width: Annotated[int, Field(
        description="Viewport width",
        ge=320,
        le=1920,
    )] = 1280,
    height: Annotated[int, Field(
        description="Viewport height", 
        ge=240,
        le=1080,
    )] = 720,
) -> dict[str, Any]:
    """Take a screenshot of a webpage."""
    try:
        scraper = DocumentationScraper(headless=True)
        await scraper.initialize()
        
        page = await scraper.new_page()
        
        try:
            # Set viewport
            await page.set_viewport_size({"width": width, "height": height})
            
            # Navigate to URL
            success = await scraper.navigate_to_url(page, url)
            if not success:
                return {
                    "success": False,
                    "error": f"Failed to navigate to {url}",
                    "url": url
                }
            
            # Determine output path
            if output_path is None:
                from tempfile import NamedTemporaryFile
                import os
                temp_file = NamedTemporaryFile(suffix=".png", delete=False)
                output_path = temp_file.name
                temp_file.close()
            
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Take screenshot
            await page.screenshot(
                path=str(output_path),
                full_page=full_page
            )
            
            # Get file size
            file_size = output_path.stat().st_size
            
            return {
                "success": True,
                "screenshot_path": str(output_path),
                "url": url,
                "file_size_bytes": file_size,
                "viewport": {"width": width, "height": height},
                "full_page": full_page,
                "message": f"Screenshot saved to {output_path}"
            }
            
        finally:
            await page.close()
            await scraper.close()
            
    except Exception as e:
        logger.error("Error taking screenshot", url=url, error=str(e))
        return {
            "success": False,
            "error": f"Screenshot failed: {str(e)}",
            "url": url
        }


@app.tool(tags={"browser", "html", "content", "extraction"})
async def get_page_html(
    url: Annotated[str, Field(
        description="URL to extract HTML from",
        pattern=r"^https?://.*",
    )],
    selector: Annotated[str | None, Field(
        description="Optional CSS selector to extract specific element",
        default=None,
    )] = None,
    clean: Annotated[bool, Field(
        description="Remove scripts, styles and comments",
    )] = True,
) -> dict[str, Any]:
    """Extract raw HTML content from a webpage."""
    try:
        scraper = DocumentationScraper(headless=True)
        await scraper.initialize()
        
        page = await scraper.new_page()
        
        try:
            # Navigate to URL
            success = await scraper.navigate_to_url(page, url)
            if not success:
                return {
                    "success": False,
                    "error": f"Failed to navigate to {url}",
                    "url": url
                }
            
            # Get HTML content
            if selector:
                # Extract specific element
                try:
                    element = page.locator(selector)
                    html_content = await element.inner_html()
                    if not html_content:
                        return {
                            "success": False,
                            "error": f"No content found for selector: {selector}",
                            "url": url,
                            "selector": selector
                        }
                except Exception as e:
                    return {
                        "success": False,
                        "error": f"Failed to extract element with selector '{selector}': {str(e)}",
                        "url": url,
                        "selector": selector
                    }
            else:
                # Get full page HTML
                html_content = await page.content()
            
            # Clean HTML if requested
            if clean:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(html_content, 'html.parser')
                
                # Remove scripts, styles, and comments
                for tag in soup(["script", "style"]):
                    tag.decompose()
                
                # Remove comments
                from bs4 import Comment
                for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
                    comment.extract()
                
                html_content = str(soup)
            
            # Get page title
            title = await page.title()
            
            return {
                "success": True,
                "url": url,
                "title": title,
                "html": html_content,
                "selector": selector,
                "cleaned": clean,
                "html_length": len(html_content),
                "message": f"Extracted HTML from {url}"
            }
            
        finally:
            await page.close()
            await scraper.close()
            
    except Exception as e:
        logger.error("Error extracting HTML", url=url, error=str(e))
        return {
            "success": False,
            "error": f"HTML extraction failed: {str(e)}",
            "url": url
        }


@app.tool(tags={"browser", "markdown", "content", "text"})
async def get_page_markdown(
    url: Annotated[str, Field(
        description="URL to convert to markdown",
        pattern=r"^https?://.*",
    )],
    selector: Annotated[str | None, Field(
        description="Optional CSS selector to extract specific element",
        default=None,
    )] = None,
    strip_tags: Annotated[list[str] | None, Field(
        description="HTML tags to strip during conversion",
        default=None,
    )] = None,
) -> dict[str, Any]:
    """Convert webpage content to clean markdown format."""
    try:
        scraper = DocumentationScraper(headless=True)
        await scraper.initialize()
        
        page = await scraper.new_page()
        
        try:
            # Navigate to URL
            success = await scraper.navigate_to_url(page, url)
            if not success:
                return {
                    "success": False,
                    "error": f"Failed to navigate to {url}",
                    "url": url
                }
            
            # Get HTML content
            if selector:
                # Extract specific element
                try:
                    element = page.locator(selector)
                    html_content = await element.inner_html()
                    if not html_content:
                        return {
                            "success": False,
                            "error": f"No content found for selector: {selector}",
                            "url": url,
                            "selector": selector
                        }
                except Exception as e:
                    return {
                        "success": False,
                        "error": f"Failed to extract element with selector '{selector}': {str(e)}",
                        "url": url,
                        "selector": selector
                    }
            else:
                # Get full page HTML
                html_content = await page.content()
            
            # Clean HTML before conversion
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Remove scripts, styles, and comments
            for tag in soup(["script", "style", "meta", "link"]):
                tag.decompose()
            
            # Remove comments
            from bs4 import Comment
            for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
                comment.extract()
            
            # Strip additional tags if specified
            if strip_tags:
                for tag in soup(strip_tags):
                    tag.decompose()
            
            cleaned_html = str(soup)
            
            # Convert to markdown
            markdown_content = markdownify(
                cleaned_html,
                heading_style="ATX",
                strip=["script", "style"],
                convert=["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "a", "strong", "em", "code", "pre", "blockquote"]
            )
            
            # Clean up markdown
            lines = markdown_content.split('\n')
            cleaned_lines = []
            for line in lines:
                line = line.strip()
                if line:  # Skip empty lines
                    cleaned_lines.append(line)
            
            markdown_content = '\n\n'.join(cleaned_lines)
            
            # Get page title
            title = await page.title()
            
            return {
                "success": True,
                "url": url,
                "title": title,
                "markdown": markdown_content,
                "selector": selector,
                "stripped_tags": strip_tags,
                "markdown_length": len(markdown_content),
                "message": f"Converted {url} to markdown"
            }
            
        finally:
            await page.close()
            await scraper.close()
            
    except Exception as e:
        logger.error("Error converting to markdown", url=url, error=str(e))
        return {
            "success": False,
            "error": f"Markdown conversion failed: {str(e)}",
            "url": url
        }