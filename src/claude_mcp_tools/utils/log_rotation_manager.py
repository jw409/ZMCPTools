"""Log rotation and cleanup management utilities for the scraper logging system."""

import argparse
import sys
from pathlib import Path
from typing import Optional

import structlog

from .scraper_logger import LogRotationConfig, ScraperFileLogger


class LogRotationManager:
    """Manager for configuring and controlling log rotation and cleanup."""
    
    def __init__(self, config: Optional[LogRotationConfig] = None):
        """Initialize the log rotation manager.
        
        Args:
            config: Custom rotation configuration, uses defaults if None
        """
        self.config = config or LogRotationConfig()
        self.logger = structlog.get_logger("log_rotation_manager")
    
    def start_automatic_cleanup(self):
        """Start the automatic cleanup background process."""
        try:
            ScraperFileLogger.start_automatic_cleanup(self.config)
            self.logger.info("Automatic cleanup started successfully", 
                           interval_hours=self.config.auto_cleanup_interval_hours)
        except Exception as e:
            self.logger.error("Failed to start automatic cleanup", error=str(e))
            raise
    
    def run_manual_cleanup(self):
        """Run a manual cleanup of all log files."""
        try:
            self.logger.info("Starting manual log cleanup")
            ScraperFileLogger.cleanup_all_logs(self.config)
            self.logger.info("Manual cleanup completed successfully")
        except Exception as e:
            self.logger.error("Manual cleanup failed", error=str(e))
            raise
    
    def get_log_statistics(self) -> dict:
        """Get statistics about current log files."""
        log_base_dir = Path.home() / ".mcptools" / "documentation" / "logs"
        
        if not log_base_dir.exists():
            return {
                "total_domains": 0,
                "total_files": 0,
                "total_size_mb": 0,
                "domains": {}
            }
        
        stats = {
            "total_domains": 0,
            "total_files": 0,
            "total_size_mb": 0,
            "domains": {}
        }
        
        for domain_dir in log_base_dir.iterdir():
            if not domain_dir.is_dir():
                continue
                
            domain_stats = {
                "file_count": 0,
                "total_size_mb": 0,
                "oldest_file": None,
                "newest_file": None
            }
            
            log_files = list(domain_dir.glob("*.log"))
            if log_files:
                domain_stats["file_count"] = len(log_files)
                
                total_size = 0
                oldest_time = float('inf')
                newest_time = 0
                
                for log_file in log_files:
                    try:
                        stat = log_file.stat()
                        total_size += stat.st_size
                        
                        if stat.st_mtime < oldest_time:
                            oldest_time = stat.st_mtime
                            domain_stats["oldest_file"] = log_file.name
                        
                        if stat.st_mtime > newest_time:
                            newest_time = stat.st_mtime
                            domain_stats["newest_file"] = log_file.name
                            
                    except OSError:
                        continue
                
                domain_stats["total_size_mb"] = round(total_size / (1024 * 1024), 2)
                stats["total_files"] += domain_stats["file_count"]
                stats["total_size_mb"] += domain_stats["total_size_mb"]
            
            if domain_stats["file_count"] > 0:
                stats["domains"][domain_dir.name] = domain_stats
                stats["total_domains"] += 1
        
        stats["total_size_mb"] = round(stats["total_size_mb"], 2)
        return stats
    
    def print_statistics(self):
        """Print current log statistics to console."""
        stats = self.get_log_statistics()
        
        print(f"\n📊 Log Statistics")
        print(f"=================")
        print(f"Total domains: {stats['total_domains']}")
        print(f"Total files: {stats['total_files']}")
        print(f"Total size: {stats['total_size_mb']} MB")
        
        if stats["domains"]:
            print(f"\n📁 Per-domain breakdown:")
            for domain, domain_stats in stats["domains"].items():
                print(f"  {domain}:")
                print(f"    Files: {domain_stats['file_count']}")
                print(f"    Size: {domain_stats['total_size_mb']} MB")
                print(f"    Oldest: {domain_stats['oldest_file']}")
                print(f"    Newest: {domain_stats['newest_file']}")
        
        print(f"\n⚙️  Current Configuration:")
        print(f"Max file size: {self.config.max_file_size_mb} MB")
        print(f"Max files per domain: {self.config.max_files_per_domain}")
        print(f"Days to keep: {self.config.days_to_keep}")
        print(f"Total size limit per domain: {self.config.total_size_limit_mb} MB")
        print(f"Auto cleanup interval: {self.config.auto_cleanup_interval_hours} hours")


def create_config_from_args(args) -> LogRotationConfig:
    """Create a LogRotationConfig from command line arguments."""
    return LogRotationConfig(
        max_file_size_mb=args.max_file_size,
        max_files_per_domain=args.max_files,
        days_to_keep=args.days_to_keep,
        total_size_limit_mb=args.total_size_limit,
        auto_cleanup_interval_hours=args.cleanup_interval
    )


def main():
    """Command line interface for log rotation management."""
    parser = argparse.ArgumentParser(
        description="Manage scraper log rotation and cleanup",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Show current statistics
  python -m claude_mcp_tools.utils.log_rotation_manager stats
  
  # Run manual cleanup with default settings
  python -m claude_mcp_tools.utils.log_rotation_manager cleanup
  
  # Start automatic cleanup with custom settings
  python -m claude_mcp_tools.utils.log_rotation_manager start --max-file-size 5 --days-to-keep 14
  
  # Run cleanup with aggressive settings
  python -m claude_mcp_tools.utils.log_rotation_manager cleanup --max-files 5 --total-size-limit 50
        """
    )
    
    parser.add_argument(
        "command",
        choices=["stats", "cleanup", "start"],
        help="Command to execute: stats (show statistics), cleanup (run manual cleanup), start (start automatic cleanup)"
    )
    
    parser.add_argument(
        "--max-file-size",
        type=int,
        default=10,
        help="Maximum file size in MB before rotation (default: 10)"
    )
    
    parser.add_argument(
        "--max-files",
        type=int,
        default=20,
        help="Maximum number of files per domain (default: 20)"
    )
    
    parser.add_argument(
        "--days-to-keep",
        type=int,
        default=30,
        help="Number of days to keep log files (default: 30)"
    )
    
    parser.add_argument(
        "--total-size-limit",
        type=int,
        default=100,
        help="Total size limit per domain in MB (default: 100)"
    )
    
    parser.add_argument(
        "--cleanup-interval",
        type=int,
        default=24,
        help="Hours between automatic cleanup runs (default: 24)"
    )
    
    args = parser.parse_args()
    
    # Create configuration from arguments
    config = create_config_from_args(args)
    manager = LogRotationManager(config)
    
    try:
        if args.command == "stats":
            manager.print_statistics()
        
        elif args.command == "cleanup":
            print("🧹 Starting manual log cleanup...")
            manager.run_manual_cleanup()
            print("✅ Manual cleanup completed")
            
        elif args.command == "start":
            print("🚀 Starting automatic log cleanup...")
            manager.start_automatic_cleanup()
            print("✅ Automatic cleanup started")
            print("💡 The cleanup process will run in the background.")
            print("   Press Ctrl+C to stop.")
            
            # Keep the script running
            try:
                import time
                while True:
                    time.sleep(60)
            except KeyboardInterrupt:
                print("\n🛑 Stopping automatic cleanup...")
                sys.exit(0)
                
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()