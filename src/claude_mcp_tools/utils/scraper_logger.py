"""File-based logging system for web scraper with per-domain, per-run organization."""

import logging
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import structlog


class LogRotationConfig:
    """Configuration for log rotation and cleanup settings."""
    
    def __init__(
        self,
        max_file_size_mb: int = 10,
        max_files_per_domain: int = 20,
        days_to_keep: int = 30,
        total_size_limit_mb: int = 100,
        auto_cleanup_interval_hours: int = 24
    ):
        """Initialize rotation configuration.
        
        Args:
            max_file_size_mb: Maximum size per log file before rotation (MB)
            max_files_per_domain: Maximum number of log files per domain
            days_to_keep: Days to keep log files (age-based cleanup)
            total_size_limit_mb: Total size limit for all logs per domain (MB)
            auto_cleanup_interval_hours: Hours between automatic cleanup runs
        """
        self.max_file_size_mb = max_file_size_mb
        self.max_files_per_domain = max_files_per_domain
        self.days_to_keep = days_to_keep
        self.total_size_limit_mb = total_size_limit_mb
        self.auto_cleanup_interval_hours = auto_cleanup_interval_hours
        
    @property
    def max_file_size_bytes(self) -> int:
        """Convert max file size to bytes."""
        return self.max_file_size_mb * 1024 * 1024
        
    @property
    def total_size_limit_bytes(self) -> int:
        """Convert total size limit to bytes."""
        return self.total_size_limit_mb * 1024 * 1024


class ScraperFileLogger:
    """File-based logger for web scraping operations with domain-specific organization."""
    
    def __init__(self, job_id: str, base_url: str, rotation_config: Optional[LogRotationConfig] = None):
        """Initialize file logger for a scraping job.
        
        Args:
            job_id: Unique identifier for the scraping job
            base_url: Base URL being scraped (used for domain extraction)
            rotation_config: Configuration for log rotation and cleanup
        """
        self.job_id = job_id
        self.base_url = base_url
        self.domain = self._extract_domain(base_url)
        self.rotation_config = rotation_config or LogRotationConfig()
        
        # Create log directory structure
        self.log_dir = self._setup_log_directory()
        
        # Set up file logger with rotation
        self.current_log_path: Optional[Path] = None
        self.file_logger = self._setup_file_logger()
        
        # Keep structlog for console output
        self.console_logger = structlog.get_logger("web_scraper")
        
        # Perform cleanup on initialization
        self._cleanup_old_logs_for_domain()
        
    def _extract_domain(self, url: str) -> str:
        """Extract domain from URL for directory structure."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc
            # Clean domain for filesystem use
            return domain.replace(':', '_').replace('/', '_')
        except Exception:
            return "unknown_domain"
    
    def _setup_log_directory(self) -> Path:
        """Set up log directory structure: logs/{domain}/{timestamp}-{job_id}.log"""
        base_log_dir = Path.home() / ".mcptools" / "documentation" / "logs"
        domain_dir = base_log_dir / self.domain
        domain_dir.mkdir(parents=True, exist_ok=True)
        return domain_dir
    
    def _setup_file_logger(self) -> logging.Logger:
        """Set up Python logging for file output with custom format."""
        # Create timestamp for log filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_filename = f"{timestamp}-{self.job_id}.log"
        log_path = self.log_dir / log_filename
        self.current_log_path = log_path
        
        # Create file logger
        file_logger = logging.getLogger(f"scraper_file_{self.job_id}")
        file_logger.setLevel(logging.INFO)
        
        # Remove existing handlers to avoid duplicates
        for handler in file_logger.handlers[:]:
            file_logger.removeHandler(handler)
        
        # Create file handler with UTF-8 encoding
        file_handler = logging.FileHandler(log_path, encoding='utf-8')
        file_handler.setLevel(logging.INFO)
        
        # Custom formatter with emojis and structured output
        formatter = logging.Formatter(
            '[%(asctime)s] %(message)s',
            datefmt='%H:%M:%S'
        )
        file_handler.setFormatter(formatter)
        
        file_logger.addHandler(file_handler)
        file_logger.propagate = False  # Prevent duplicate console output
        
        return file_logger
    
    def _check_rotation_needed(self) -> bool:
        """Check if log rotation is needed based on file size."""
        if not self.current_log_path or not self.current_log_path.exists():
            return False
            
        try:
            file_size = self.current_log_path.stat().st_size
            return file_size >= self.rotation_config.max_file_size_bytes
        except OSError:
            return False
    
    def _rotate_log_file(self):
        """Rotate the current log file and create a new one."""
        if not self.current_log_path:
            return
            
        try:
            # Close current handlers
            for handler in self.file_logger.handlers[:]:
                handler.close()
                self.file_logger.removeHandler(handler)
            
            # Create new log file
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            new_log_filename = f"{timestamp}-{self.job_id}.log"
            new_log_path = self.log_dir / new_log_filename
            self.current_log_path = new_log_path
            
            # Set up new file handler
            file_handler = logging.FileHandler(new_log_path, encoding='utf-8')
            file_handler.setLevel(logging.INFO)
            
            formatter = logging.Formatter(
                '[%(asctime)s] %(message)s',
                datefmt='%H:%M:%S'
            )
            file_handler.setFormatter(formatter)
            
            self.file_logger.addHandler(file_handler)
            
            # Log the rotation
            self.file_logger.info(f"🔄 Log rotated to new file: {new_log_filename}")
            
            # Clean up if needed after rotation
            self._cleanup_old_logs_for_domain()
            
        except Exception as e:
            self.console_logger.error("Failed to rotate log file", error=str(e))
    
    def _log_with_rotation_check(self, message: str):
        """Log a message and check if rotation is needed."""
        if self._check_rotation_needed():
            self._rotate_log_file()
        self.file_logger.info(message)
    
    def _cleanup_old_logs_for_domain(self):
        """Clean up old logs for the current domain based on rotation config."""
        if not self.log_dir.exists():
            return
            
        try:
            # Get all log files in domain directory
            log_files = list(self.log_dir.glob("*.log"))
            if not log_files:
                return
            
            # Sort by modification time (newest first)
            log_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
            
            cutoff_date = datetime.now() - timedelta(days=self.rotation_config.days_to_keep)
            total_size = 0
            files_to_keep = []
            files_to_remove = []
            
            for i, log_file in enumerate(log_files):
                try:
                    stat = log_file.stat()
                    file_date = datetime.fromtimestamp(stat.st_mtime)
                    file_size = stat.st_size
                    
                    # Skip current active log file
                    if self.current_log_path and log_file == self.current_log_path:
                        files_to_keep.append(log_file)
                        total_size += file_size
                        continue
                    
                    # Check age limit
                    if file_date < cutoff_date:
                        files_to_remove.append(log_file)
                        continue
                    
                    # Check file count limit
                    if i >= self.rotation_config.max_files_per_domain:
                        files_to_remove.append(log_file)
                        continue
                    
                    # Check total size limit
                    if total_size + file_size > self.rotation_config.total_size_limit_bytes:
                        files_to_remove.append(log_file)
                        continue
                    
                    files_to_keep.append(log_file)
                    total_size += file_size
                    
                except (OSError, ValueError):
                    # If we can't read file stats, mark for removal
                    files_to_remove.append(log_file)
            
            # Remove files that exceed limits
            removed_count = 0
            total_removed_size = 0
            
            for log_file in files_to_remove:
                try:
                    file_size = log_file.stat().st_size
                    log_file.unlink()
                    removed_count += 1
                    total_removed_size += file_size
                except OSError:
                    continue
            
            # Log cleanup results if any files were removed
            if removed_count > 0:
                self.console_logger.info(
                    "Domain log cleanup completed",
                    domain=self.domain,
                    removed_files=removed_count,
                    removed_size_mb=round(total_removed_size / (1024 * 1024), 2),
                    kept_files=len(files_to_keep),
                    total_size_mb=round(total_size / (1024 * 1024), 2)
                )
                
        except Exception as e:
            self.console_logger.error("Failed to cleanup domain logs", domain=self.domain, error=str(e))
    
    def log_job_start(self, crawl_depth: int, allow_patterns: list[str] | None = None, 
                     ignore_patterns: list[str] | None = None):
        """Log the start of a scraping job with configuration."""
        message = f"🚀 Starting scraping job: {self.base_url}"
        details = f"   Job ID: {self.job_id}\n   Crawl Depth: {crawl_depth}"
        
        if allow_patterns:
            details += f"\n   Allow Patterns: {allow_patterns}"
        if ignore_patterns:
            details += f"\n   Ignore Patterns: {ignore_patterns}"
            
        self._log_with_rotation_check(f"{message}\n{details}")
        self.console_logger.info("Job started", job_id=self.job_id, domain=self.domain)
    
    def log_url_discovery(self, page_url: str, discovered_links: list[str]):
        """Log URL discovery on a page."""
        message = f"🔍 Found {len(discovered_links)} links on page: {page_url}"
        self._log_with_rotation_check(message)
        
        # Log sample of discovered links for debugging
        if discovered_links and len(discovered_links) <= 5:
            for link in discovered_links:
                self._log_with_rotation_check(f"   📎 Discovered: {link}")
        elif len(discovered_links) > 5:
            for link in discovered_links[:3]:
                self._log_with_rotation_check(f"   📎 Discovered: {link}")
            self._log_with_rotation_check(f"   📎 ... and {len(discovered_links) - 3} more links")
    
    def log_url_filtering(self, url: str, decision: str, reason: str):
        """Log URL filtering decisions with detailed reasoning.
        
        Args:
            url: The URL being filtered
            decision: "ALLOWED" or "FILTERED"
            reason: Explanation for the decision
        """
        if decision == "ALLOWED":
            emoji = "✅"
        else:
            emoji = "❌"
        
        message = f"{emoji} {decision}: {url} ({reason})"
        self._log_with_rotation_check(message)
    
    def log_navigation_start(self, url: str, attempt: int = 1):
        """Log the start of navigation to a URL."""
        message = f"🌐 Navigating to: {url}"
        if attempt > 1:
            message += f" (attempt {attempt})"
        
        self._log_with_rotation_check(message)
    
    def log_navigation_success(self, url: str, duration_seconds: float, final_url: str | None = None):
        """Log successful navigation with timing."""
        message = f"✅ Navigation successful ({duration_seconds:.1f}s)"
        if final_url and final_url != url:
            message += f" → redirected to: {final_url}"
        
        self._log_with_rotation_check(message)
    
    def log_navigation_failure(self, url: str, error: str, attempt: int = 1):
        """Log navigation failure with error details."""
        message = f"❌ Navigation failed: {url}"
        if attempt > 1:
            message += f" (attempt {attempt})"
        message += f" - {error}"
        
        self._log_with_rotation_check(message)
    
    def log_content_extraction_start(self, url: str, selector: str | None = None):
        """Log the start of content extraction."""
        if selector:
            message = f"🎯 Trying content selector: {selector}"
        else:
            message = f"🎯 Starting content extraction: {url}"
        
        self._log_with_rotation_check(message)
    
    def log_content_extraction_success(self, selector: str, content_length: int, extraction_method: str = ""):
        """Log successful content extraction."""
        message = f"✅ Content extracted: {content_length:,} characters"
        if selector:
            message += f" using {extraction_method or 'selector'}: {selector}"
        
        self._log_with_rotation_check(message)
    
    def log_content_extraction_failure(self, selector: str, error: str):
        """Log failed content extraction attempt."""
        message = f"❌ Content extraction failed for selector '{selector}': {error}"
        self._log_with_rotation_check(message)
    
    def log_browser_recovery(self, error: str, recovery_action: str):
        """Log browser recovery attempts."""
        message = f"🔧 Browser recovery: {error} → {recovery_action}"
        self._log_with_rotation_check(message)
    
    def log_page_processing_complete(self, url: str, success: bool, content_length: int = 0, 
                                   links_found: int = 0, depth: int = 0):
        """Log completion of page processing."""
        if success:
            message = f"✅ Page processed successfully: {url}"
            details = f"   Content: {content_length:,} chars, Links: {links_found}, Depth: {depth}"
        else:
            message = f"❌ Page processing failed: {url}"
            details = f"   Depth: {depth}"
        
        self.file_logger.info(f"{message}\n{details}")
    
    def log_database_operation(self, operation: str, success: bool, details: str = ""):
        """Log database operations (save, lookup, etc.)."""
        emoji = "💾" if success else "⚠️"
        status = "SUCCESS" if success else "FAILED"
        
        message = f"{emoji} Database {operation}: {status}"
        if details:
            message += f" - {details}"
        
        self._log_with_rotation_check(message)
    
    def log_job_progress(self, pages_processed: int, total_discovered: int, queue_remaining: int = 0):
        """Log job progress statistics."""
        message = f"📊 Progress: {pages_processed} processed, {total_discovered} discovered"
        if queue_remaining > 0:
            message += f", {queue_remaining} in queue"
        
        self._log_with_rotation_check(message)
    
    def log_job_completion(self, success: bool, total_pages: int, total_failed: int, 
                          duration_seconds: float, error: str | None = None):
        """Log job completion with summary statistics."""
        if success:
            message = f"🎉 Scraping job completed successfully in {duration_seconds:.1f}s"
            details = f"   Pages scraped: {total_pages}\n   Failed: {total_failed}"
        else:
            message = f"💥 Scraping job failed after {duration_seconds:.1f}s"
            details = f"   Pages scraped: {total_pages}\n   Failed: {total_failed}"
            if error:
                details += f"\n   Error: {error}"
        
        self.file_logger.info(f"{message}\n{details}")
        self.console_logger.info("Job completed", success=success, pages=total_pages, 
                               failed=total_failed, duration=duration_seconds)
    
    def log_external_link_filtering(self, url: str, pattern_type: str):
        """Log filtering of external links (Discord, social media, etc.)."""
        message = f"❌ FILTERED: {url} ({pattern_type} pattern)"
        self._log_with_rotation_check(message)
    
    def log_subdomain_filtering(self, url: str, base_domain: str, include_subdomains: bool):
        """Log subdomain filtering decisions."""
        parsed = urlparse(url)
        url_domain = parsed.netloc
        
        if include_subdomains:
            reason = "subdomain allowed"
        else:
            reason = f"subdomain, include_subdomains={include_subdomains}"
        
        message = f"❌ FILTERED: {url} ({reason})"
        self._log_with_rotation_check(message)
    
    def log_markdown_conversion(self, success: bool, original_length: int, converted_length: int = 0):
        """Log markdown conversion operations."""
        if success:
            message = f"📝 Markdown conversion: {original_length:,} → {converted_length:,} characters"
        else:
            message = f"⚠️ Markdown conversion failed for {original_length:,} characters"
        
        self._log_with_rotation_check(message)
    
    def log_duplicate_detection(self, url: str, content_hash: str, action: str):
        """Log duplicate content detection."""
        message = f"🔍 Duplicate detection: {url} (hash: {content_hash[:8]}...) → {action}"
        self._log_with_rotation_check(message)
    
    def log_debug(self, message: str, **kwargs):
        """Log debug information with context."""
        context = ""
        if kwargs:
            context = " | " + " | ".join(f"{k}={v}" for k, v in kwargs.items())
        
        self.file_logger.info(f"🐛 DEBUG: {message}{context}")
    
    def close(self):
        """Close the file logger and cleanup handlers."""
        for handler in self.file_logger.handlers[:]:
            handler.close()
            self.file_logger.removeHandler(handler)
    
    @classmethod
    def start_automatic_cleanup(cls, rotation_config: Optional[LogRotationConfig] = None):
        """Start automatic cleanup process in a background thread."""
        config = rotation_config or LogRotationConfig()
        
        def cleanup_worker():
            while True:
                try:
                    ScraperFileLogger.cleanup_all_logs(config)
                    time.sleep(config.auto_cleanup_interval_hours * 3600)  # Convert hours to seconds
                except Exception as e:
                    console_logger = structlog.get_logger("scraper_cleanup")
                    console_logger.error("Automatic cleanup failed", error=str(e))
                    time.sleep(3600)  # Wait 1 hour before retrying
        
        cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
        cleanup_thread.start()
        
        console_logger = structlog.get_logger("scraper_cleanup")
        console_logger.info("Automatic log cleanup started", 
                          interval_hours=config.auto_cleanup_interval_hours)
    
    @staticmethod
    def cleanup_all_logs(rotation_config: Optional[LogRotationConfig] = None):
        """Clean up all log files across all domains based on rotation config."""
        config = rotation_config or LogRotationConfig()
        log_base_dir = Path.home() / ".mcptools" / "documentation" / "logs"
        
        if not log_base_dir.exists():
            return
        
        console_logger = structlog.get_logger("scraper_cleanup")
        total_removed = 0
        total_removed_size = 0
        
        # Process each domain directory
        for domain_dir in log_base_dir.iterdir():
            if not domain_dir.is_dir():
                continue
                
            try:
                removed_count, removed_size = ScraperFileLogger._cleanup_domain_logs(domain_dir, config)
                total_removed += removed_count
                total_removed_size += removed_size
            except Exception as e:
                console_logger.error("Failed to cleanup domain", domain=domain_dir.name, error=str(e))
        
        if total_removed > 0:
            console_logger.info("Global log cleanup completed",
                              total_removed_files=total_removed,
                              total_removed_size_mb=round(total_removed_size / (1024 * 1024), 2))
    
    @staticmethod
    def _cleanup_domain_logs(domain_dir: Path, config: LogRotationConfig) -> tuple[int, int]:
        """Clean up logs for a specific domain directory."""
        log_files = list(domain_dir.glob("*.log"))
        if not log_files:
            return 0, 0
        
        # Sort by modification time (newest first)
        log_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        
        cutoff_date = datetime.now() - timedelta(days=config.days_to_keep)
        total_size = 0
        files_to_remove = []
        
        for i, log_file in enumerate(log_files):
            try:
                stat = log_file.stat()
                file_date = datetime.fromtimestamp(stat.st_mtime)
                file_size = stat.st_size
                
                # Check age limit
                if file_date < cutoff_date:
                    files_to_remove.append(log_file)
                    continue
                
                # Check file count limit
                if i >= config.max_files_per_domain:
                    files_to_remove.append(log_file)
                    continue
                
                # Check total size limit
                if total_size + file_size > config.total_size_limit_bytes:
                    files_to_remove.append(log_file)
                    continue
                
                total_size += file_size
                
            except (OSError, ValueError):
                # If we can't read file stats, mark for removal
                files_to_remove.append(log_file)
        
        # Remove files that exceed limits
        removed_count = 0
        total_removed_size = 0
        
        for log_file in files_to_remove:
            try:
                file_size = log_file.stat().st_size
                log_file.unlink()
                removed_count += 1
                total_removed_size += file_size
            except OSError:
                continue
        
        return removed_count, total_removed_size

    @staticmethod
    def cleanup_old_logs(days_to_keep: int = 7):
        """Clean up log files older than specified days."""
        log_base_dir = Path.home() / ".mcptools" / "documentation" / "logs"
        
        if not log_base_dir.exists():
            return
        
        cutoff_date = datetime.now() - timedelta(days=days_to_keep)
        removed_count = 0
        
        # Walk through all domain directories
        for domain_dir in log_base_dir.iterdir():
            if domain_dir.is_dir():
                for log_file in domain_dir.glob("*.log"):
                    try:
                        # Parse timestamp from filename
                        filename = log_file.stem
                        if "-" in filename:
                            timestamp_str = filename.split("-")[0]
                            file_date = datetime.strptime(timestamp_str, "%Y%m%d_%H%M%S")
                            
                            if file_date < cutoff_date:
                                log_file.unlink()
                                removed_count += 1
                    except (ValueError, OSError):
                        # Skip files that don't match expected format or can't be deleted
                        continue
        
        # Log cleanup results
        console_logger = structlog.get_logger("scraper_logger")
        console_logger.info("Log cleanup completed", 
                          removed_files=removed_count, 
                          days_kept=days_to_keep)


def create_scraper_logger(job_id: str, base_url: str, rotation_config: Optional[LogRotationConfig] = None) -> ScraperFileLogger:
    """Factory function to create a scraper file logger."""
    return ScraperFileLogger(job_id, base_url, rotation_config)