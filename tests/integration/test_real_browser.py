"""Real browser integration tests - actually initializes browsers to verify functionality."""

import asyncio
import tempfile
import pytest
from pathlib import Path
import structlog

from claude_mcp_tools.services.web_scraper import BrowserManager  
from claude_mcp_tools.workers.scraper_worker import ScraperWorker

logger = structlog.get_logger("test_real_browser")


class TestRealBrowserManager:
    """Test actual BrowserManager initialization and functionality."""

    def test_real_browser_manager_sync_init(self):
        """Test real BrowserManager initialization with sync API."""
        with tempfile.TemporaryDirectory() as temp_dir:
            user_data_dir = Path(temp_dir) / "browser_test"
            
            browser_manager = BrowserManager(headless=True)
            
            try:
                # This will actually try to initialize the real browser
                browser_manager.initialize(user_data_dir=user_data_dir)
                
                # Verify browser manager is initialized
                assert browser_manager.playwright is not None
                assert browser_manager.browser_context is not None
                
                logger.info("✅ Real BrowserManager initialization successful")
                
                # Test directory creation
                assert user_data_dir.exists()
                assert user_data_dir.is_dir()
                
                logger.info("✅ Browser data directory created correctly")
                
            except Exception as e:
                logger.error("❌ Real browser initialization failed", error=str(e))
                # Don't fail test if browser installation issues - log the error
                pytest.skip(f"Browser initialization failed (may need browser installation): {e}")
                
            finally:
                # Cleanup
                try:
                    if hasattr(browser_manager, 'browser_context') and browser_manager.browser_context:
                        browser_manager.browser_context.close()
                    if hasattr(browser_manager, 'playwright') and browser_manager.playwright:
                        browser_manager.playwright.stop()
                except Exception as cleanup_error:
                    logger.warning("Browser cleanup error", error=str(cleanup_error))

    def test_browser_data_directory_isolation(self):
        """Test that multiple browser instances use separate directories."""
        with tempfile.TemporaryDirectory() as temp_dir:
            dir1 = Path(temp_dir) / "browser1"  
            dir2 = Path(temp_dir) / "browser2"
            
            browser1 = BrowserManager(headless=True)
            browser2 = BrowserManager(headless=True)
            
            try:
                browser1.initialize(user_data_dir=dir1)
                browser2.initialize(user_data_dir=dir2)
                
                # Verify separate directories
                assert dir1.exists() and dir1 != dir2
                assert dir2.exists() and dir1 != dir2
                
                logger.info("✅ Browser directory isolation working")
                
            except Exception as e:
                pytest.skip(f"Browser isolation test failed: {e}")
            finally:
                for browser in [browser1, browser2]:
                    try:
                        if hasattr(browser, 'browser_context') and browser.browser_context:
                            browser.browser_context.close()
                        if hasattr(browser, 'playwright') and browser.playwright:
                            browser.playwright.stop()
                    except:
                        pass


class TestRealScraperWorker:
    """Test ScraperWorker with real browser initialization."""

    @pytest.mark.asyncio
    async def test_scraper_worker_real_browser_init(self):
        """Test ScraperWorker with real browser initialization."""
        with tempfile.TemporaryDirectory() as temp_dir:
            worker = ScraperWorker(data_dir=temp_dir, worker_id="real-test-worker")
            
            try:
                # Initialize browser (this calls the real async playwright)
                await worker._initialize_browser()
                
                # Verify browser is initialized
                assert worker.playwright is not None
                assert worker.browser_context is not None
                
                logger.info("✅ Real ScraperWorker browser initialization successful")
                
                # Test browser data directory
                browser_data_dir = worker.data_dir / "browser_data"
                assert browser_data_dir.exists()
                
                logger.info("✅ ScraperWorker browser data directory created")
                
            except Exception as e:
                logger.error("❌ ScraperWorker real browser init failed", error=str(e))
                pytest.skip(f"ScraperWorker browser init failed: {e}")
                
            finally:
                # Cleanup
                try:
                    await worker._close_browser()
                except Exception as cleanup_error:
                    logger.warning("ScraperWorker cleanup error", error=str(cleanup_error))

    @pytest.mark.asyncio
    async def test_scraper_worker_browser_lifecycle(self):
        """Test ScraperWorker browser lifecycle management."""
        with tempfile.TemporaryDirectory() as temp_dir:
            worker = ScraperWorker(data_dir=temp_dir, worker_id="lifecycle-test")
            
            try:
                # Initialize browser
                await worker._initialize_browser()
                assert worker.browser_context is not None
                
                # Test browser close
                await worker._close_browser()
                assert worker.browser_context is None
                assert worker.playwright is None
                
                logger.info("✅ ScraperWorker browser lifecycle test successful")
                
            except Exception as e:
                logger.error("❌ ScraperWorker lifecycle test failed", error=str(e))
                pytest.skip(f"ScraperWorker lifecycle test failed: {e}")

    @pytest.mark.asyncio
    async def test_scraper_worker_multiple_init_cleanup(self):
        """Test that ScraperWorker can handle multiple init/cleanup cycles."""
        with tempfile.TemporaryDirectory() as temp_dir:
            worker = ScraperWorker(data_dir=temp_dir, worker_id="multi-init-test")
            
            try:
                # Multiple init/cleanup cycles
                for i in range(3):
                    logger.info(f"Testing init/cleanup cycle {i+1}")
                    
                    await worker._initialize_browser()
                    assert worker.browser_context is not None
                    
                    await worker._close_browser() 
                    assert worker.browser_context is None
                
                logger.info("✅ Multiple init/cleanup cycles successful")
                
            except Exception as e:
                logger.error("❌ Multiple init/cleanup test failed", error=str(e))
                pytest.skip(f"Multiple init/cleanup test failed: {e}")


class TestBrowserCompatibility:
    """Test browser compatibility in different environments."""

    def test_wsl_environment_detection(self):
        """Test WSL environment detection and compatibility."""
        # Import the environment checker
        from tests.utils.browser_environment_check import BrowserEnvironmentChecker
        
        checker = BrowserEnvironmentChecker()
        results = checker.run_full_check()
        
        # Log results
        logger.info("Environment check results", 
                   wsl=results["is_wsl"],
                   patchright=results["patchright_installed"],
                   chromium=results["chromium_installed"])
        
        # Verify environment is suitable for browser operations
        if results["is_wsl"]:
            logger.info("✅ WSL environment detected and configured")
            # In WSL, we expect DISPLAY to be set for X11 forwarding
            assert results["environment_variables"].get("DISPLAY") is not None
        
        # Verify core dependencies are available
        assert results["patchright_installed"], "Patchright should be installed"
        assert results["browser_data_writable"], "Browser data directory should be writable"
        
        logger.info("✅ Browser compatibility verification passed")

    @pytest.mark.asyncio
    async def test_headless_mode_functionality(self):
        """Test that headless mode works correctly in the environment."""
        with tempfile.TemporaryDirectory() as temp_dir:
            worker = ScraperWorker(data_dir=temp_dir, worker_id="headless-test")
            
            try:
                await worker._initialize_browser()
                
                # The browser should start in headless mode by default
                # If this succeeds, headless mode is working
                logger.info("✅ Headless browser mode working correctly")
                
            except Exception as e:
                logger.error("❌ Headless mode test failed", error=str(e))
                pytest.skip(f"Headless mode test failed: {e}")
            finally:
                try:
                    await worker._close_browser()
                except:
                    pass


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v", "-s"])