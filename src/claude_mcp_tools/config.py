"""Configuration management for ClaudeMcpTools."""

import json
import logging
from pathlib import Path
from typing import Any

import structlog

# Default configuration
DEFAULT_CONFIG = {
    "logging": {
        "level": "INFO",
        "verbose": False,
        "debug": False,
        "capture_fastmcp_errors": True,
        "startup_logging": False
    },
    "server": {
        "startup_diagnostics": True,
        "health_checks": True,
        "error_buffering": True
    },
    "documentation": {
        "auto_bootstrap": True,
        "bootstrap_on_startup": True,
        "periodic_check_minutes": 30,
        "max_concurrent_scrapes": 3
    }
}

class McpToolsConfig:
    """Configuration manager for ClaudeMcpTools."""
    
    def __init__(self, config_path: Path | None = None):
        """Initialize configuration manager.
        
        Args:
            config_path: Path to config file. Defaults to ~/.mcptools/config.json
        """
        if config_path is None:
            mcptools_dir = Path.home() / ".mcptools"
            mcptools_dir.mkdir(exist_ok=True)
            config_path = mcptools_dir / "config.json"
        
        self.config_path = config_path
        self.config = self._load_config()
        self._configure_logging()
    
    def _load_config(self) -> dict[str, Any]:
        """Load configuration from file or create default."""
        if self.config_path.exists():
            try:
                with open(self.config_path, 'r') as f:
                    user_config = json.load(f)
                # Merge with defaults
                config = DEFAULT_CONFIG.copy()
                self._deep_merge(config, user_config)
                return config
            except (json.JSONDecodeError, OSError) as e:
                print(f"Warning: Invalid config file {self.config_path}, using defaults: {e}")
                return DEFAULT_CONFIG.copy()
        else:
            # Create default config file
            self._save_config(DEFAULT_CONFIG)
            return DEFAULT_CONFIG.copy()
    
    def _deep_merge(self, target: dict[str, Any], source: dict[str, Any]) -> None:
        """Deep merge source into target dictionary."""
        for key, value in source.items():
            if key in target and isinstance(target[key], dict) and isinstance(value, dict):
                self._deep_merge(target[key], value)
            else:
                target[key] = value
    
    def _save_config(self, config: dict[str, Any]) -> None:
        """Save configuration to file."""
        try:
            with open(self.config_path, 'w') as f:
                json.dump(config, f, indent=2)
        except OSError as e:
            print(f"Warning: Could not save config to {self.config_path}: {e}")
    
    def _configure_logging(self) -> None:
        """Configure structlog based on current config."""
        log_level = self.config["logging"]["level"]
        verbose = self.config["logging"]["verbose"]
        debug = self.config["logging"]["debug"]
        
        # Set log level
        if debug:
            level = logging.DEBUG
        elif verbose:
            level = logging.INFO
        else:
            level = getattr(logging, log_level.upper(), logging.INFO)
        
        # Configure structlog - ensure logs go to stderr for MCP compatibility
        import sys
        structlog.configure(
            processors=[
                structlog.processors.TimeStamper(fmt="iso"),
                structlog.dev.ConsoleRenderer() if debug or verbose else structlog.processors.JSONRenderer(),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(level),
            logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),  # Force stderr for MCP
            cache_logger_on_first_use=True,
        )
    
    def update_config(self, **kwargs) -> None:
        """Update configuration and save to file.
        
        Args:
            **kwargs: Configuration updates (e.g., verbose=True, debug=False)
        """
        for key, value in kwargs.items():
            if '.' in key:
                # Handle nested keys like "logging.verbose"
                keys = key.split('.')
                current = self.config
                for k in keys[:-1]:
                    if k not in current:
                        current[k] = {}
                    current = current[k]
                current[keys[-1]] = value
            else:
                self.config[key] = value
        
        self._save_config(self.config)
        self._configure_logging()
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value using dot notation.
        
        Args:
            key: Configuration key (e.g., "logging.level")
            default: Default value if key not found
            
        Returns:
            Configuration value
        """
        keys = key.split('.')
        current = self.config
        
        for k in keys:
            if isinstance(current, dict) and k in current:
                current = current[k]
            else:
                return default
        
        return current

# Global configuration instance
config = McpToolsConfig()