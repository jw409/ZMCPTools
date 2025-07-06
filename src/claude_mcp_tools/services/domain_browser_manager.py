"""Domain-based browser context manager for coordinated web scraping."""

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import structlog

from .documentation_scraper import ThreadPoolDocumentationScraper

logger = structlog.get_logger("domain_browser_manager")


class DomainBrowserManager:
    """Manages browser contexts per domain to prevent conflicts and improve resource usage."""
    
    _instance: "DomainBrowserManager | None" = None
    _lock = asyncio.Lock()
    
    def __new__(cls) -> "DomainBrowserManager":
        """Ensure singleton pattern."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        """Initialize domain browser manager."""
        if hasattr(self, '_initialized'):
            return
        
        self._initialized = True
        self._domain_scrapers: dict[str, ThreadPoolDocumentationScraper] = {}
        self._domain_locks: dict[str, asyncio.Lock] = {}
        self._domain_queues: dict[str, list[dict[str, Any]]] = {}
        self._active_scraping: dict[str, set[str]] = {}  # domain -> set of source_ids
        self._base_data_dir: Path | None = None
        
    def set_base_data_dir(self, data_dir: Path) -> None:
        """Set the base directory for browser data."""
        self._base_data_dir = data_dir
        
    def _extract_domain(self, url: str) -> str:
        """Extract normalized, folder-friendly domain from URL."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            # Remove port if it's the default for the scheme
            if domain.endswith(':80') and parsed.scheme == 'http':
                domain = domain[:-3]
            elif domain.endswith(':443') and parsed.scheme == 'https':
                domain = domain[:-4]
            
            # Make folder-friendly: replace problematic characters
            folder_name = (domain
                          .replace(".", "_")
                          .replace(":", "_")
                          .replace("/", "_")
                          .replace("\\", "_")
                          .replace("?", "_")
                          .replace("<", "_")
                          .replace(">", "_")
                          .replace("|", "_")
                          .replace("*", "_")
                          .replace('"', "_"))
            
            # Remove any remaining invalid characters and limit length
            folder_name = "".join(c for c in folder_name if c.isalnum() or c in "_-")
            folder_name = folder_name[:50]  # Limit length for filesystem compatibility
            
            return folder_name if folder_name else "unknown_domain"
        except Exception as e:
            logger.warning("Failed to extract domain from URL", url=url, error=str(e))
            return "unknown_domain"
    
    async def get_scraper_for_domain(self, url: str, source_id: str) -> tuple[ThreadPoolDocumentationScraper, bool]:
        """Get or create a scraper for the given domain.
        
        Args:
            url: URL to extract domain from
            source_id: Source ID requesting the scraper
            
        Returns:
            Tuple of (scraper, is_new_scraper)
        """
        domain = self._extract_domain(url)
        
        # Get or create domain lock
        if domain not in self._domain_locks:
            self._domain_locks[domain] = asyncio.Lock()
        
        async with self._domain_locks[domain]:
            # Track this source as active for this domain
            if domain not in self._active_scraping:
                self._active_scraping[domain] = set()
            self._active_scraping[domain].add(source_id)
            
            # Return existing scraper if available
            if domain in self._domain_scrapers:
                logger.info("Reusing existing scraper for domain", domain=domain, source_id=source_id)
                return self._domain_scrapers[domain], False
            
            # Create new scraper for this domain
            logger.info("Creating new scraper for domain", domain=domain, source_id=source_id)
            
            try:
                scraper = ThreadPoolDocumentationScraper(max_concurrent_browsers=1)
                
                # Note: ThreadPoolDocumentationScraper manages its own browser contexts
                # No initialization needed - it handles browser setup in worker threads
                
                # Store scraper for this domain
                self._domain_scrapers[domain] = scraper
                
                logger.info("Successfully created ThreadPool scraper", 
                           domain=domain, 
                           source_id=source_id)
                
                return scraper, True
                
            except Exception as e:
                logger.error("Failed to create scraper for domain", 
                           domain=domain, 
                           source_id=source_id, 
                           error=str(e))
                # Remove from active tracking if creation failed
                if source_id in self._active_scraping.get(domain, set()):
                    self._active_scraping[domain].discard(source_id)
                raise
    
    async def release_scraper_for_source(self, url: str, source_id: str) -> None:
        """Release scraper usage for a specific source.
        
        Args:
            url: URL to extract domain from
            source_id: Source ID releasing the scraper
        """
        domain = self._extract_domain(url)
        
        if domain not in self._domain_locks:
            return
        
        async with self._domain_locks[domain]:
            # Remove source from active tracking
            if domain in self._active_scraping and source_id in self._active_scraping[domain]:
                self._active_scraping[domain].discard(source_id)
                logger.info("Released scraper for source", domain=domain, source_id=source_id)
                
                # If no more sources are using this domain, consider cleanup
                if not self._active_scraping[domain]:
                    logger.info("No more active sources for domain", domain=domain)
                    # Note: We keep the scraper alive for potential reuse
                    # Cleanup happens explicitly or after timeout
    
    async def cleanup_domain(self, url: str, force: bool = False) -> bool:
        """Clean up browser context for a domain.
        
        Args:
            url: URL to extract domain from
            force: Force cleanup even if sources are still active
            
        Returns:
            True if cleanup was performed
        """
        domain = self._extract_domain(url)
        
        if domain not in self._domain_locks:
            return False
        
        async with self._domain_locks[domain]:
            # Check if domain is still active
            if not force and domain in self._active_scraping and self._active_scraping[domain]:
                logger.info("Cannot cleanup domain - still has active sources", 
                           domain=domain, 
                           active_sources=list(self._active_scraping[domain]))
                return False
            
            # Clean up scraper if it exists
            if domain in self._domain_scrapers:
                try:
                    scraper = self._domain_scrapers[domain]
                    await scraper.shutdown()
                    del self._domain_scrapers[domain]
                    logger.info("Successfully cleaned up scraper for domain", domain=domain)
                except Exception as e:
                    logger.warning("Failed to cleanup scraper for domain", domain=domain, error=str(e))
            
            # Clean up tracking data
            if domain in self._active_scraping:
                del self._active_scraping[domain]
            
            return True
    
    async def cleanup_all_domains(self, force: bool = False) -> dict[str, bool]:
        """Clean up all domain browser contexts.
        
        Args:
            force: Force cleanup even if sources are still active
            
        Returns:
            Dict mapping domain to cleanup success status
        """
        cleanup_results = {}
        domains_to_cleanup = list(self._domain_scrapers.keys())
        
        for domain in domains_to_cleanup:
            # Create a fake URL for this domain to use existing cleanup method
            fake_url = f"https://{domain.replace('_', '.')}"
            try:
                result = await self.cleanup_domain(fake_url, force=force)
                cleanup_results[domain] = result
            except Exception as e:
                logger.error("Failed to cleanup domain", domain=domain, error=str(e))
                cleanup_results[domain] = False
        
        return cleanup_results
    
    def get_domain_status(self) -> dict[str, dict[str, Any]]:
        """Get status of all managed domains.
        
        Returns:
            Dict mapping domain to status information
        """
        status = {}
        
        for domain in self._domain_scrapers.keys():
            active_sources = list(self._active_scraping.get(domain, set()))
            status[domain] = {
                "scraper_active": True,
                "active_sources": active_sources,
                "source_count": len(active_sources),
                "has_lock": domain in self._domain_locks,
            }
        
        return status
    
    def is_domain_busy(self, url: str) -> bool:
        """Check if a domain is currently busy with scraping.
        
        Args:
            url: URL to extract domain from
            
        Returns:
            True if domain has active scraping operations
        """
        domain = self._extract_domain(url)
        return bool(self._active_scraping.get(domain, set()))
    
    def mark_domain_busy(self, url: str, source_id: str) -> None:
        """Mark a domain as busy with scraping for a specific source.
        
        Args:
            url: URL to extract domain from
            source_id: Source ID that will be scraping
        """
        domain = self._extract_domain(url)
        
        if domain not in self._active_scraping:
            self._active_scraping[domain] = set()
        
        self._active_scraping[domain].add(source_id)
        logger.info("Marked domain as busy", domain=domain, source_id=source_id)
    
    def release_domain(self, url: str, source_id: str) -> None:
        """Release domain for a specific source (synchronous wrapper).
        
        Args:
            url: URL to extract domain from
            source_id: Source ID releasing the domain
        """
        # This is a synchronous wrapper around the async method
        # for compatibility with existing code
        domain = self._extract_domain(url)
        
        if domain in self._active_scraping and source_id in self._active_scraping[domain]:
            self._active_scraping[domain].discard(source_id)
            logger.info("Released domain for source", domain=domain, source_id=source_id)
    
    async def wait_for_domain_availability(self, url: str, timeout: float = 300.0) -> bool:
        """Wait for a domain to become available for scraping.
        
        Args:
            url: URL to extract domain from
            timeout: Maximum time to wait in seconds
            
        Returns:
            True if domain became available, False if timeout
        """
        domain = self._extract_domain(url)
        
        if not self.is_domain_busy(url):
            return True
        
        logger.info("Domain is busy, waiting for availability", domain=domain, timeout=timeout)
        
        start_time = datetime.now(timezone.utc)
        while self.is_domain_busy(url):
            if (datetime.now(timezone.utc) - start_time).total_seconds() > timeout:
                logger.warning("Timeout waiting for domain availability", domain=domain)
                return False
            
            await asyncio.sleep(1.0)  # Check every second
        
        logger.info("Domain became available", domain=domain)
        return True


# Global instance
domain_manager = DomainBrowserManager()