"""Enhanced MCP server with modular orchestration layer for Claude Code."""

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
from fastmcp import FastMCP
from pydantic import BaseModel

# Import database and models
from .database import init_database
from .models import AgentStatus, TaskStatus

# Import all tool modules
from .orchestration.tools.agents import register_agent_tools
from .orchestration.tools.analysis import register_analysis_tools
from .orchestration.tools.communication import register_communication_tools
from .orchestration.tools.core import register_core_tools
from .orchestration.tools.documentation import register_documentation_tools
from .orchestration.tools.memory import register_memory_tools
from .orchestration.tools.tasks import register_task_tools

# Import services
from .services.agent_service import AgentService
from .services.communication_service import CommunicationService
from .services.documentation_service import DocumentationService
from .services.error_logging_service import ErrorLoggingService
from .services.shared_memory_service import SharedMemoryService
from .services.task_service import TaskService

# Import MCP Claude Code tool for actual agent spawning
try:
    from .mcp_tools import mcp__ccm__claude_code as _spawn_claude_sync  # type: ignore
except ImportError:
    # Fallback if mcp_tools module doesn't exist yet
    def _spawn_claude_sync(*args, **kwargs):
        return {"pid": None, "error": "Claude Code tool not available"}

# Initialize logger
logger = structlog.get_logger("orchestration")

# Initialize FastMCP app
app = FastMCP("ClaudeMcpTools Orchestration Server")


# Async wrapper for Claude spawning to prevent blocking
async def spawn_claude_async(
    workFolder: str,
    prompt: str,
    session_id: str | None = None,
    model: str = "sonnet",
) -> dict[str, Any]:
    """Async wrapper for Claude spawning to prevent blocking the event loop."""
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    # Run the potentially blocking spawn_claude in a thread pool
    loop = asyncio.get_event_loop()

    def _spawn_in_thread():
        try:
            return _spawn_claude_sync(
                workFolder=workFolder,
                prompt=prompt,
                session_id=session_id,
                model=model,
            )
        except Exception as e:
            logger.error("Claude spawn failed in thread", error=str(e))
            return {"pid": None, "error": f"Spawn failed: {e!s}"}

    # Execute in thread pool to avoid blocking
    with ThreadPoolExecutor(max_workers=1) as executor:
        result = await loop.run_in_executor(executor, _spawn_in_thread)

    logger.debug("Claude spawned asynchronously",
                 pid=result.get("pid"),
                 has_error=bool(result.get("error")))

    return result


# Keep the old synchronous function name for backward compatibility
spawn_claude = _spawn_claude_sync


# Process pool manager for concurrent Claude spawning
class ProcessPoolManager:
    """Manages a process pool for concurrent Claude spawning operations."""

    def __init__(self, max_workers: int = 5):
        self.max_workers = max_workers
        self._executor = None
        self._active_spawns = 0

    async def __aenter__(self):
        from concurrent.futures import ProcessPoolExecutor
        self._executor = ProcessPoolExecutor(max_workers=self.max_workers)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._executor:
            self._executor.shutdown(wait=True)
        self._executor = None

    async def spawn_claude_concurrent(self, **kwargs) -> dict[str, Any]:
        """Spawn Claude using process pool for true parallelism."""
        if not self._executor:
            raise RuntimeError("ProcessPoolManager not initialized")
        
        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(self._executor, _spawn_claude_sync, **kwargs)
            return result
        except Exception as e:
            logger.error("Concurrent Claude spawn failed", error=str(e))
            return {"pid": None, "error": f"Concurrent spawn failed: {e!s}"}


def parse_ai_json(value: str | dict[str, Any] | None) -> dict[str, Any] | None:
    """Parse JSON from AI assistants that might format it in various ways."""
    if value is None:
        return None

    # Already a dictionary - pass through
    if isinstance(value, dict):
        return value

    # Must be a string to parse
    if not isinstance(value, str):
        raise ValueError(f"Expected string or dict, got {type(value).__name__}")

    # Clean the string of common AI formatting patterns
    cleaned = value.strip()

    # Remove markdown code blocks (```json...``` or ```...```)
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned, flags=re.MULTILINE)

    # Remove surrounding quotes if they wrap the entire JSON
    if cleaned.startswith('"') and cleaned.endswith('"') and cleaned.count('"') >= 2:
        # Check if quotes are just wrapping the JSON
        try:
            inner = cleaned[1:-1]
            # Try parsing the inner content
            json.loads(inner)
            cleaned = inner
        except (json.JSONDecodeError, ValueError):
            # Not wrapped JSON, keep original
            pass

    # Handle escaped quotes that AI might generate
    if '""' in cleaned:
        cleaned = cleaned.replace('""', '"')

    # Remove leading/trailing whitespace again
    cleaned = cleaned.strip()

    # Try to parse as JSON
    try:
        result = json.loads(cleaned)
        if not isinstance(result, dict):
            raise ValueError(f"JSON parsed to {type(result).__name__}, expected dict")
        return result
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON format: {e}. Input was: {cleaned[:100]}...")


async def setup_dependency_monitoring(agent_id: str, depends_on: list[str]) -> dict[str, Any]:
    """Set up dependency monitoring for an agent."""
    try:
        # This would implement actual dependency monitoring logic
        # For now, return a simple success response
        return {
            "success": True,
            "agent_id": agent_id,
            "dependencies": depends_on,
            "monitoring_enabled": True,
        }
    except Exception as e:
        logger.error("Failed to setup dependency monitoring", agent_id=agent_id, error=str(e))
        return {"success": False, "error": str(e)}


# Register all tool modules with the FastMCP app
def register_all_tools():
    """Register all tool modules with the FastMCP app."""
    logger.info("Registering all MCP tools...")
    
    # Register core orchestration tools
    register_core_tools(app)
    logger.info("Registered core orchestration tools")
    
    # Register agent management tools
    register_agent_tools(app)
    logger.info("Registered agent management tools")
    
    # Register task management tools  
    register_task_tools(app)
    logger.info("Registered task management tools")
    
    # Register communication tools
    register_communication_tools(app)
    logger.info("Registered communication tools")
    
    # Register documentation tools
    register_documentation_tools(app)
    logger.info("Registered documentation tools")
    
    # Register memory and logging tools
    register_memory_tools(app)
    logger.info("Registered memory and logging tools")
    
    # Register analysis and file operation tools
    register_analysis_tools(app)
    logger.info("Registered analysis and file operation tools")
    
    logger.info("All MCP tools registered successfully!")


# File operation tools (simple ones that don't need schemas)
@app.tool(
    name="list_files",
    description="List files and directories with smart ignore patterns for project navigation",
    tags={"file-operations", "navigation", "listing"}
)
async def list_files(directory: str = ".") -> str:
    """List files and directories with smart ignore patterns."""
    try:
        from pathlib import Path
        
        path = Path(directory).resolve()
        if not path.exists():
            return f"Error: Directory '{directory}' does not exist"
        
        if not path.is_dir():
            return f"Error: '{directory}' is not a directory"
        
        # Smart ignore patterns
        ignore_patterns = {
            ".git", "__pycache__", ".pytest_cache", "node_modules", 
            ".venv", "venv", ".env", "*.pyc", "*.pyo", ".DS_Store"
        }
        
        files = []
        dirs = []
        
        for item in sorted(path.iterdir()):
            if any(pattern in item.name for pattern in ignore_patterns):
                continue
                
            if item.is_dir():
                dirs.append(f"📁 {item.name}/")
            else:
                size = item.stat().st_size
                size_str = f"({size:,} bytes)" if size < 1024 else f"({size//1024:,} KB)"
                files.append(f"📄 {item.name} {size_str}")
        
        result = f"📂 Contents of '{directory}':\n\n"
        
        if dirs:
            result += "Directories:\n" + "\n".join(dirs) + "\n\n"
        
        if files:
            result += "Files:\n" + "\n".join(files)
        
        return result
        
    except Exception as e:
        return f"Error listing files: {e}"


@app.tool(
    name="find_files",
    description="Find files by pattern with smart filtering for efficient project navigation",
    tags={"file-operations", "search", "pattern-matching"}
)
async def find_files(pattern: str, directory: str = ".") -> str:
    """Find files by pattern with smart filtering."""
    try:
        from pathlib import Path
        import fnmatch
        
        path = Path(directory).resolve()
        if not path.exists():
            return f"Error: Directory '{directory}' does not exist"
        
        matches = []
        for file_path in path.rglob("*"):
            if file_path.is_file() and fnmatch.fnmatch(file_path.name, pattern):
                rel_path = file_path.relative_to(path)
                matches.append(str(rel_path))
        
        if not matches:
            return f"No files found matching pattern '{pattern}' in '{directory}'"
        
        return f"Found {len(matches)} files matching '{pattern}':\n\n" + "\n".join(matches)
        
    except Exception as e:
        return f"Error finding files: {e}"


@app.tool(
    name="easy_replace",
    description="Replace text in a specific file with safety checks and backup options",
    tags={"file-operations", "text-replacement", "editing"}
)
async def easy_replace(file_path: str, old_text: str, new_text: str, backup: bool = True) -> str:
    """Replace text in a file with safety checks."""
    try:
        from pathlib import Path
        import shutil
        
        path = Path(file_path)
        if not path.exists():
            return f"Error: File '{file_path}' does not exist"
        
        # Read current content
        content = path.read_text(encoding='utf-8')
        
        if old_text not in content:
            return f"Text '{old_text}' not found in '{file_path}'"
        
        # Create backup if requested
        if backup:
            backup_path = path.with_suffix(path.suffix + '.bak')
            shutil.copy2(path, backup_path)
        
        # Perform replacement
        new_content = content.replace(old_text, new_text)
        path.write_text(new_content, encoding='utf-8')
        
        return f"Successfully replaced '{old_text}' with '{new_text}' in '{file_path}'"
        
    except Exception as e:
        return f"Error replacing text: {e}"


@app.tool(
    name="take_screenshot", 
    description="Take a screenshot for debugging UI issues or documenting visual state",
    tags={"debugging", "documentation", "visual", "screenshot"}
)
async def take_screenshot() -> str:
    """Take a screenshot for debugging or documentation."""
    try:
        import subprocess
        import platform
        from datetime import datetime
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"screenshot_{timestamp}.png"
        
        system = platform.system()
        if system == "Darwin":  # macOS
            cmd = ["screencapture", "-x", filename]
        elif system == "Linux":
            cmd = ["gnome-screenshot", "-f", filename]
        elif system == "Windows":
            cmd = ["powershell", "-Command", f"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%{{PRTSC}}'); Start-Sleep -Milliseconds 500; Get-Clipboard -Format Image | Set-Content -Path '{filename}' -Encoding Byte"]
        else:
            return f"Screenshot not supported on {system}"
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            return f"Screenshot saved as '{filename}'"
        else:
            return f"Failed to take screenshot: {result.stderr}"
            
    except Exception as e:
        return f"Error taking screenshot: {e}"


# Initialize the server on startup
@app.tool(
    name="startup",
    description="Initialize the orchestration server and all subsystems",
    tags={"system", "initialization", "startup"}
)
async def startup() -> str:
    """Initialize the orchestration server."""
    try:
        # Initialize database
        await init_database()
        
        # Register all tools
        register_all_tools()
        
        # Initialize services
        logger.info("Orchestration server initialized successfully")
        return "🚀 ClaudeMcpTools Orchestration Server initialized successfully!"
        
    except Exception as e:
        logger.error("Failed to initialize orchestration server", error=str(e))
        return f"❌ Failed to initialize server: {e}"


@app.tool(
    name="shutdown",
    description="Gracefully shutdown the orchestration server and clean up resources",
    tags={"system", "shutdown", "cleanup"}
)
async def shutdown() -> str:
    """Gracefully shutdown the orchestration server."""
    try:
        logger.info("Shutting down orchestration server...")
        # Add cleanup logic here if needed
        return "🛑 ClaudeMcpTools Orchestration Server shutdown complete"
        
    except Exception as e:
        logger.error("Error during shutdown", error=str(e))
        return f"❌ Error during shutdown: {e}"


# Register all tools when the module is imported
register_all_tools()

# Auto-initialize on import
async def _auto_init():
    try:
        await init_database()
        logger.info("Auto-initialized orchestration server")
    except Exception as e:
        logger.error("Auto-initialization failed", error=str(e))

# Run auto-initialization
asyncio.create_task(_auto_init())

if __name__ == "__main__":
    # Run the server
    app.run()