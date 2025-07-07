"""Browser environment verification and installation status checker."""

import os
import sys
import subprocess
import platform
from pathlib import Path
import structlog

logger = structlog.get_logger("browser_env_check")


class BrowserEnvironmentChecker:
    """Comprehensive browser environment verification."""

    def __init__(self):
        self.results = {
            "python_version": sys.version,
            "platform": platform.platform(),
            "is_wsl": self._detect_wsl(),
            "patchright_installed": False,
            "patchright_version": None,
            "chromium_installed": False,
            "chromium_path": None,
            "browser_data_writable": False,
            "dependencies_available": {},
            "environment_variables": {},
            "errors": [],
            "warnings": [],
            "recommendations": []
        }

    def _detect_wsl(self) -> bool:
        """Detect if running in WSL environment."""
        try:
            # Check for WSL indicators
            if os.path.exists('/proc/version'):
                with open('/proc/version', 'r') as f:
                    version_info = f.read().lower()
                    if 'microsoft' in version_info or 'wsl' in version_info:
                        return True
            
            # Check WSL environment variable
            if os.environ.get('WSL_DISTRO_NAME'):
                return True
                
            return False
        except Exception:
            return False

    def check_patchright_installation(self):
        """Check if patchright is installed and working."""
        try:
            import patchright
            self.results["patchright_installed"] = True
            self.results["patchright_version"] = getattr(patchright, '__version__', 'unknown')
            logger.info("✅ Patchright package found", version=self.results["patchright_version"])
            
            # Try importing sync and async APIs
            try:
                from patchright.sync_api import sync_playwright
                from patchright.async_api import async_playwright
                logger.info("✅ Patchright APIs imported successfully")
            except ImportError as e:
                self.results["errors"].append(f"Patchright API import failed: {e}")
                logger.error("❌ Patchright API import failed", error=str(e))
                
        except ImportError as e:
            self.results["patchright_installed"] = False
            self.results["errors"].append(f"Patchright not installed: {e}")
            logger.error("❌ Patchright package not found", error=str(e))

    def check_chromium_installation(self):
        """Check if Chromium browser is installed."""
        try:
            # Try running patchright install check
            result = subprocess.run([
                sys.executable, "-m", "patchright", "install", "--dry-run", "chromium"
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                logger.info("✅ Patchright chromium installation verified")
                self.results["chromium_installed"] = True
            else:
                logger.warning("⚠️ Patchright chromium installation check failed", 
                             stderr=result.stderr, stdout=result.stdout)
                self.results["warnings"].append(f"Chromium check failed: {result.stderr}")
                
        except subprocess.TimeoutExpired:
            self.results["errors"].append("Chromium installation check timed out")
            logger.error("❌ Chromium check timed out")
        except FileNotFoundError:
            self.results["errors"].append("patchright command not found")
            logger.error("❌ patchright command not available")
        except Exception as e:
            self.results["errors"].append(f"Chromium check failed: {e}")
            logger.error("❌ Chromium check failed", error=str(e))

    def check_browser_data_directory(self):
        """Check if browser data directory can be created and is writable."""
        try:
            # Check default browser data location
            browser_data_dir = Path.home() / ".mcptools" / "browser_data"
            browser_data_dir.mkdir(parents=True, exist_ok=True)
            
            # Test write permissions
            test_file = browser_data_dir / "write_test.txt"
            test_file.write_text("test")
            test_file.unlink()
            
            self.results["browser_data_writable"] = True
            logger.info("✅ Browser data directory writable", path=str(browser_data_dir))
            
        except Exception as e:
            self.results["browser_data_writable"] = False
            self.results["errors"].append(f"Browser data directory not writable: {e}")
            logger.error("❌ Browser data directory not writable", error=str(e))

    def check_dependencies(self):
        """Check for required dependencies."""
        dependencies = [
            "fake_useragent",
            "structlog", 
            "asyncio",
            "pathlib",
            "urllib",
            "random",
            "time",
            "uuid",
            "hashlib",
            "re"
        ]
        
        for dep in dependencies:
            try:
                __import__(dep)
                self.results["dependencies_available"][dep] = True
                logger.debug("✅ Dependency available", dependency=dep)
            except ImportError:
                self.results["dependencies_available"][dep] = False
                self.results["warnings"].append(f"Dependency {dep} not available")
                logger.warning("⚠️ Dependency not available", dependency=dep)

    def check_environment_variables(self):
        """Check relevant environment variables."""
        env_vars = [
            "DISPLAY",
            "XAUTHORITY", 
            "WSL_DISTRO_NAME",
            "CHROME_BIN",
            "CHROMIUM_BIN",
            "PLAYWRIGHT_BROWSERS_PATH"
        ]
        
        for var in env_vars:
            value = os.environ.get(var)
            self.results["environment_variables"][var] = value
            if value:
                logger.info("📝 Environment variable set", var=var, value=value[:50])

    def generate_recommendations(self):
        """Generate recommendations based on findings."""
        recommendations = []
        
        if not self.results["patchright_installed"]:
            recommendations.append("Install patchright: uv add patchright")
            
        if not self.results["chromium_installed"]:
            recommendations.append("Install Chromium browser: uv run python -m patchright install chromium")
            
        if self.results["is_wsl"] and not self.results["environment_variables"].get("DISPLAY"):
            recommendations.append("WSL detected: Consider setting up X11 forwarding or using headless mode")
            
        if not self.results["browser_data_writable"]:
            recommendations.append("Fix browser data directory permissions: chmod 755 ~/.mcptools/browser_data")
            
        if len(self.results["errors"]) > 0:
            recommendations.append("Review errors above and install missing dependencies")
            
        self.results["recommendations"] = recommendations

    def run_full_check(self) -> dict:
        """Run complete environment check."""
        logger.info("🔍 Starting browser environment verification...")
        
        self.check_patchright_installation()
        self.check_chromium_installation()
        self.check_browser_data_directory()
        self.check_dependencies()
        self.check_environment_variables()
        self.generate_recommendations()
        
        return self.results

    def print_report(self):
        """Print comprehensive environment report."""
        print("\n" + "="*80)
        print("🔍 BROWSER ENVIRONMENT VERIFICATION REPORT")
        print("="*80)
        
        print(f"\n📋 SYSTEM INFO:")
        print(f"  Python Version: {self.results['python_version']}")
        print(f"  Platform: {self.results['platform']}")
        print(f"  WSL Environment: {'Yes' if self.results['is_wsl'] else 'No'}")
        
        print(f"\n🔧 PATCHRIGHT STATUS:")
        print(f"  Installed: {'✅ Yes' if self.results['patchright_installed'] else '❌ No'}")
        print(f"  Version: {self.results['patchright_version'] or 'N/A'}")
        
        print(f"\n🌐 CHROMIUM STATUS:")
        print(f"  Installed: {'✅ Yes' if self.results['chromium_installed'] else '⚠️ Unknown/No'}")
        
        print(f"\n📁 DIRECTORIES:")
        print(f"  Browser Data Writable: {'✅ Yes' if self.results['browser_data_writable'] else '❌ No'}")
        
        print(f"\n📦 DEPENDENCIES:")
        for dep, available in self.results["dependencies_available"].items():
            status = "✅" if available else "❌"
            print(f"  {dep}: {status}")
        
        if self.results["environment_variables"]:
            print(f"\n🌍 ENVIRONMENT VARIABLES:")
            for var, value in self.results["environment_variables"].items():
                if value:
                    print(f"  {var}: {value}")
        
        if self.results["errors"]:
            print(f"\n❌ ERRORS:")
            for error in self.results["errors"]:
                print(f"  - {error}")
        
        if self.results["warnings"]:
            print(f"\n⚠️ WARNINGS:")
            for warning in self.results["warnings"]:
                print(f"  - {warning}")
        
        if self.results["recommendations"]:
            print(f"\n💡 RECOMMENDATIONS:")
            for rec in self.results["recommendations"]:
                print(f"  - {rec}")
        
        print("\n" + "="*80)


def main():
    """Main entry point for environment check."""
    checker = BrowserEnvironmentChecker()
    results = checker.run_full_check()
    checker.print_report()
    
    # Return exit code based on critical errors
    if results["errors"] and not results["patchright_installed"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())