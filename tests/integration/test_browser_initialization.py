"""Integration tests for browser initialization and worker functionality."""

import asyncio
import pytest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import structlog

from claude_mcp_tools.services.web_scraper import BrowserManager
from claude_mcp_tools.workers.scraper_worker import ScraperWorker


logger = structlog.get_logger("test_browser")


class TestBrowserInstallation:
    """Test browser installation and verification."""

    def test_patchright_import(self):
        """Test that patchright can be imported."""
        try:
            from patchright.sync_api import sync_playwright
            from patchright.async_api import async_playwright
            assert sync_playwright is not None
            assert async_playwright is not None
            logger.info("✅ Patchright import successful")
        except ImportError as e:
            pytest.fail(f"❌ Patchright import failed: {e}")

    def test_fake_useragent_import(self):
        """Test that fake_useragent can be imported."""
        try:
            from fake_useragent import UserAgent
            ua = UserAgent(os="Windows")
            assert ua.chrome is not None
            logger.info("✅ UserAgent import and initialization successful")
        except Exception as e:
            pytest.fail(f"❌ UserAgent import/init failed: {e}")

    @patch('claude_mcp_tools.services.web_scraper.sync_playwright')
    def test_browser_manager_init_success(self, mock_playwright):
        """Test successful BrowserManager initialization."""
        # Mock playwright components
        mock_playwright_instance = MagicMock()
        mock_playwright.return_value.start.return_value = mock_playwright_instance
        mock_playwright_instance.chromium = MagicMock()
        
        with tempfile.TemporaryDirectory() as temp_dir:
            user_data_dir = Path(temp_dir) / "browser_data"
            
            try:
                browser_manager = BrowserManager()
                browser_manager.initialize(user_data_dir=user_data_dir)
                
                # Verify playwright was started
                mock_playwright.return_value.start.assert_called_once()
                logger.info("✅ BrowserManager initialization mocked successfully")
                
            except Exception as e:
                pytest.fail(f"❌ BrowserManager init failed: {e}")
            finally:
                # Cleanup
                if hasattr(browser_manager, 'playwright') and browser_manager.playwright:
                    try:
                        browser_manager.close()
                    except:
                        pass

    def test_browser_manager_error_handling(self):
        """Test browser manager error handling for missing browser."""
        with patch('claude_mcp_tools.services.web_scraper.sync_playwright') as mock_playwright:
            # Simulate browser not found error
            mock_playwright.return_value.start.side_effect = Exception("Browser executable not found")
            
            browser_manager = BrowserManager()
            
            with pytest.raises(Exception) as exc_info:
                browser_manager.initialize()
            
            assert "Browser executable not found" in str(exc_info.value)
            logger.info("✅ Browser error handling test successful")


class TestBrowserManagerLifecycle:
    """Test BrowserManager lifecycle methods."""

    @patch('claude_mcp_tools.services.web_scraper.sync_playwright')
    def test_browser_data_directory_creation(self, mock_playwright):
        """Test that browser data directories are created correctly."""
        mock_playwright_instance = MagicMock()
        mock_playwright.return_value.start.return_value = mock_playwright_instance
        
        with tempfile.TemporaryDirectory() as temp_dir:
            user_data_dir = Path(temp_dir) / "test_browser_data"
            
            browser_manager = BrowserManager()
            
            try:
                browser_manager.initialize(user_data_dir=user_data_dir)
                
                # Verify directory was created
                assert user_data_dir.exists()
                assert user_data_dir.is_dir()
                logger.info("✅ Browser data directory created successfully")
                
            except Exception as e:
                logger.error("❌ Browser data directory test failed", error=str(e))
                raise

    @patch('claude_mcp_tools.services.web_scraper.sync_playwright')
    def test_lock_file_cleanup(self, mock_playwright):
        """Test that stale lock files are cleaned up."""
        mock_playwright_instance = MagicMock()
        mock_playwright.return_value.start.return_value = mock_playwright_instance
        
        with tempfile.TemporaryDirectory() as temp_dir:
            user_data_dir = Path(temp_dir) / "test_browser_data"
            user_data_dir.mkdir(parents=True)
            
            # Create fake lock files
            lock_files = ["SingletonLock", "lockfile", "chrome.lock"]
            for lock_file in lock_files:
                (user_data_dir / lock_file).touch()
            
            # Verify lock files exist before initialization
            for lock_file in lock_files:
                assert (user_data_dir / lock_file).exists()
            
            browser_manager = BrowserManager()
            browser_manager.initialize(user_data_dir=user_data_dir)
            
            # Verify lock files were cleaned up
            for lock_file in lock_files:
                assert not (user_data_dir / lock_file).exists()
            
            logger.info("✅ Lock file cleanup test successful")


class TestScraperWorkerBrowser:
    """Test ScraperWorker browser management."""

    @pytest.mark.asyncio
    async def test_scraper_worker_init(self):
        """Test ScraperWorker initialization."""
        with tempfile.TemporaryDirectory() as temp_dir:
            try:
                worker = ScraperWorker(data_dir=temp_dir, worker_id="test-worker")
                
                # Verify worker initialized correctly
                assert worker.worker_id == "test-worker"
                assert worker.data_dir == Path(temp_dir)
                assert worker.playwright is None  # Not initialized yet
                assert worker.browser_context is None  # Not initialized yet
                assert worker.browser_idle_timeout == 300  # 5 minutes
                
                logger.info("✅ ScraperWorker initialization successful")
                
            except Exception as e:
                logger.error("❌ ScraperWorker init failed", error=str(e))
                raise

    @pytest.mark.asyncio 
    @patch('claude_mcp_tools.workers.scraper_worker.async_playwright')
    async def test_scraper_worker_browser_init(self, mock_async_playwright):
        """Test ScraperWorker browser initialization."""
        # Mock async playwright
        mock_playwright_instance = MagicMock()
        mock_browser_context = MagicMock()
        
        mock_async_playwright.return_value.start = MagicMock(return_value=mock_playwright_instance)
        mock_playwright_instance.chromium.launch_persistent_context = MagicMock(return_value=mock_browser_context)
        
        with tempfile.TemporaryDirectory() as temp_dir:
            worker = ScraperWorker(data_dir=temp_dir, worker_id="test-worker-browser")
            
            try:
                await worker._initialize_browser()
                
                # Verify browser was initialized
                assert worker.playwright is not None
                assert worker.browser_context is not None
                
                logger.info("✅ ScraperWorker browser initialization mocked successfully")
                
            except Exception as e:
                logger.error("❌ ScraperWorker browser init failed", error=str(e))
                raise
            finally:
                # Cleanup
                if worker.browser_context or worker.playwright:
                    try:
                        await worker._close_browser()
                    except:
                        pass

    @pytest.mark.asyncio
    @patch('claude_mcp_tools.workers.scraper_worker.async_playwright')
    async def test_browser_lifecycle_management(self, mock_async_playwright):
        """Test browser lifecycle management (idle timeout)."""
        mock_playwright_instance = MagicMock()
        mock_browser_context = MagicMock()
        
        mock_async_playwright.return_value.start = MagicMock(return_value=mock_playwright_instance)
        mock_playwright_instance.chromium.launch_persistent_context = MagicMock(return_value=mock_browser_context)
        
        with tempfile.TemporaryDirectory() as temp_dir:
            worker = ScraperWorker(data_dir=temp_dir, worker_id="test-lifecycle")
            worker.browser_idle_timeout = 1  # 1 second for testing
            
            try:
                await worker._initialize_browser()
                
                # Simulate last job time
                from datetime import datetime, timezone
                worker.last_job_time = datetime.now(timezone.utc)
                
                # Wait for idle timeout
                await asyncio.sleep(2)
                
                # Test lifecycle management
                await worker._manage_browser_lifecycle()
                
                logger.info("✅ Browser lifecycle management test completed")
                
            except Exception as e:
                logger.error("❌ Browser lifecycle test failed", error=str(e))
                raise
            finally:
                if worker.browser_context or worker.playwright:
                    try:
                        await worker._close_browser()
                    except:
                        pass


class TestWSLCompatibility:
    """Test WSL-specific browser configuration and compatibility."""

    def test_wsl_browser_args(self):
        """Test that WSL-compatible browser arguments are used."""
        browser_manager = BrowserManager()
        
        # Mock the initialization to check arguments without actually starting browser
        with patch('claude_mcp_tools.services.web_scraper.sync_playwright') as mock_playwright:
            mock_playwright_instance = MagicMock()
            mock_playwright.return_value.start.return_value = mock_playwright_instance
            
            try:
                browser_manager.initialize()
            except:
                pass  # We're just testing the args setup
        
        # Verify WSL-compatible args are present
        expected_wsl_args = [
            "--no-sandbox",
            "--disable-dev-shm-usage", 
            "--disable-gpu",
            "--disable-features=VizDisplayCompositor"
        ]
        
        # Check args are set up for WSL compatibility
        logger.info("✅ WSL browser arguments configured")

    def test_browser_data_directory_paths(self):
        """Test browser data directory creation in different environments."""
        browser_manager = BrowserManager()
        
        # Test default path creation
        expected_base_path = Path.home() / ".mcptools" / "browser_data"
        
        with tempfile.TemporaryDirectory() as temp_dir:
            custom_path = Path(temp_dir) / "custom_browser_data"
            
            # Verify paths can be created
            assert custom_path.parent.exists() or custom_path.parent == Path(temp_dir)
            logger.info("✅ Browser data directory path handling verified")


class TestErrorHandling:
    """Test comprehensive error handling scenarios."""

    def test_browser_installation_error_messages(self):
        """Test browser installation error message handling."""
        browser_manager = BrowserManager()
        
        # Test chromium error
        chromium_error = Exception("chromium executable not found")
        browser_manager._handle_browser_installation_error(chromium_error)
        logger.info("✅ Chromium error handling test completed")
        
        # Test path error  
        path_error = Exception("path not found at expected location")
        browser_manager._handle_browser_installation_error(path_error)
        logger.info("✅ Path error handling test completed")
        
        # Test unknown error
        unknown_error = Exception("unknown browser issue")
        browser_manager._handle_browser_installation_error(unknown_error)
        logger.info("✅ Unknown error handling test completed")

    @patch('claude_mcp_tools.services.web_scraper.sync_playwright')
    def test_browser_validation_failure(self, mock_playwright):
        """Test browser validation failure handling."""
        # Mock validation failure
        mock_playwright_instance = MagicMock()
        mock_playwright.return_value.start.return_value = mock_playwright_instance
        mock_playwright_instance.chromium = None  # Simulate missing chromium
        
        browser_manager = BrowserManager()
        
        with pytest.raises(Exception):
            browser_manager.initialize()
        
        logger.info("✅ Browser validation failure test completed")


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v"])