"""Enhanced MCP server with modular orchestration layer for Claude Code."""

import asyncio
import json
import os
import queue
import re
import signal
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
import uvloop
import warnings
from mcp.types import PromptMessage, TextContent

# Import anyio exceptions for server-level stream error handling
try:
    from anyio import ClosedResourceError, BrokenResourceError
except ImportError:
    # Fallback definitions if anyio is not available
    class ClosedResourceError(Exception):
        """Fallback for anyio.ClosedResourceError when anyio is not available."""
        pass
    
    class BrokenResourceError(Exception):
        """Fallback for anyio.BrokenResourceError when anyio is not available."""
        pass

# Install uvloop for 2x+ performance boost
# Suppress deprecation warning when running as MCP server to avoid stderr noise
with warnings.catch_warnings():
    warnings.filterwarnings("ignore", category=DeprecationWarning, module="uvloop")
    uvloop.install()

# Import configuration system first to set up logging
from .config import config

# Import all tool modules - this registers them with the shared app instance
# Import database and models
from .database import init_database

# Import services

# Import MCP Claude Code tool for actual agent spawning
try:
    from .mcp_tools import mcp__ccm__claude_code as _spawn_claude_sync  # type: ignore
except ImportError:
    # Fallback if mcp_tools module doesn't exist yet
    def _spawn_claude_sync(*args, **kwargs):
        return {"pid": None, "error": "Claude Code tool not available"}

# Initialize logger after config is loaded
logger = structlog.get_logger("orchestration")

# Import the shared app instance from tools
from .tools.app import app

# ========================================
# PROCESS LIFECYCLE MANAGEMENT
# ========================================

# Global registry to track spawned Claude processes
_spawned_processes: dict[int, subprocess.Popen] = {}
_process_registry_lock = threading.Lock()
_reaper_thread: threading.Thread | None = None
_shutdown_event = threading.Event()


class ProcessReaper:
    """Background daemon thread that monitors and reaps finished Claude processes."""
    
    def __init__(self):
        self.is_running = False
        
    def start(self) -> None:
        """Start the process reaper daemon thread."""
        global _reaper_thread
        
        if _reaper_thread is not None and _reaper_thread.is_alive():
            # logger.debug("Process reaper already running")
            return
            
        # logger.info("Starting process reaper daemon thread")
        _shutdown_event.clear()
        _reaper_thread = threading.Thread(target=self._reap_loop, daemon=True)
        _reaper_thread.start()
        self.is_running = True
        
    def stop(self) -> None:
        """Stop the process reaper daemon thread."""
        global _reaper_thread
        
        # logger.info("Stopping process reaper daemon thread")
        _shutdown_event.set()
        self.is_running = False
        
        if _reaper_thread and _reaper_thread.is_alive():
            _reaper_thread.join(timeout=5.0)
            
    def _reap_loop(self) -> None:
        """Main reaper loop that runs in background thread."""
        # logger.info("Process reaper started")
        
        while not _shutdown_event.is_set():
            try:
                reaped_count = self._reap_finished_processes()
                if reaped_count > 0:
                    # logger.info("Reaped finished processes", count=reaped_count)
                    pass
                    
                # Check every 2 seconds for finished processes
                _shutdown_event.wait(timeout=2.0)
                
            except Exception as e:
                # logger.error("Error in process reaper loop", error=str(e))
                _shutdown_event.wait(timeout=5.0)  # Longer wait after error
                
        # logger.info("Process reaper stopped")
        
    def _reap_finished_processes(self) -> int:
        """Check all tracked processes and reap finished ones."""
        reaped_count = 0
        processes_to_remove = []
        
        with _process_registry_lock:
            for pid, process in _spawned_processes.items():
                try:
                    # Non-blocking check if process has finished
                    return_code = process.poll()
                    
                    if return_code is not None:
                        # Process has finished - reap it
                        # logger.debug("Reaping finished Claude process", 
                        #            pid=pid, return_code=return_code)
                        
                        # Call wait() to officially reap the process
                        try:
                            process.wait(timeout=0.1)
                        except subprocess.TimeoutExpired:
                            # Process still finishing, will catch it next cycle
                            continue
                            
                        processes_to_remove.append(pid)
                        reaped_count += 1
                        
                except Exception as e:
                    # logger.warning("Error checking process status", 
                    #              pid=pid, error=str(e))
                    # Remove problematic process from tracking
                    processes_to_remove.append(pid)
                    
            # Remove reaped processes from tracking
            for pid in processes_to_remove:
                del _spawned_processes[pid]
                
        return reaped_count
        
    def register_process(self, process: subprocess.Popen) -> None:
        """Register a new process for monitoring."""
        if process.pid is None:
            # logger.warning("Cannot register process with no PID")
            return
            
        with _process_registry_lock:
            _spawned_processes[process.pid] = process
            # logger.debug("Registered process for monitoring", pid=process.pid)
            
    def get_tracked_process_count(self) -> int:
        """Get the number of currently tracked processes."""
        with _process_registry_lock:
            return len(_spawned_processes)


# Global process reaper instance
_process_reaper = ProcessReaper()


# Synchronous Claude spawning (no async complexity)
def spawn_claude_sync(
    workFolder: str,
    prompt: str,
    session_id: str | None = None,
    model: str = "sonnet",
) -> dict[str, Any]:
    """Spawn Claude CLI directly with bypassed permissions (inspired by claude-code-mcp)."""
    import os
    from pathlib import Path
    from datetime import datetime

    # Add file logging for debugging
    debug_log_path = os.path.join(workFolder, "spawn_debug.log")
    
    def log_to_file(message):
        with open(debug_log_path, "a") as f:
            timestamp = datetime.now().isoformat()
            f.write(f"[{timestamp}] {message}\n")
            f.flush()
    
    log_to_file(f"=== SPAWN CLAUDE ASYNC CALLED ===")
    log_to_file(f"workFolder: {workFolder}")
    log_to_file(f"prompt: {prompt[:100]}...")
    log_to_file(f"session_id: {session_id}")
    log_to_file(f"model: {model}")

    try:
        # Find Claude CLI with validation and debugging
        def find_claude_cli():
            import shutil
            
            # Check custom CLI name from env
            custom_cli = os.getenv('CLAUDE_CLI_NAME', 'claude')
            # logger.debug("Claude CLI discovery started", custom_cli_name=custom_cli, path_env=os.getenv('PATH', '')[:200])
            
            if os.path.isabs(custom_cli):
                if os.path.exists(custom_cli) and os.access(custom_cli, os.X_OK):
                    # logger.info("Using absolute Claude CLI path", path=custom_cli)
                    return custom_cli
                else:
                    # logger.error("Absolute Claude CLI path not executable", path=custom_cli, exists=os.path.exists(custom_cli))
                    raise FileNotFoundError(f"Claude CLI not executable at {custom_cli}")
            
            # Check local install path
            local_path = Path.home() / '.claude' / 'local' / 'claude'
            if local_path.exists() and os.access(local_path, os.X_OK):
                # logger.info("Using local Claude CLI installation", path=str(local_path))
                return str(local_path)
            elif local_path.exists():
                # logger.warning("Local Claude CLI exists but not executable", path=str(local_path))
                pass
            
            # Check PATH using shutil.which
            path_claude = shutil.which(custom_cli)
            if path_claude:
                # logger.info("Found Claude CLI in PATH", path=path_claude, command=custom_cli)
                return path_claude
            
            # Final fallback - log detailed error
            # logger.error("Claude CLI not found anywhere", 
            #            custom_cli=custom_cli,
            #            local_path_exists=local_path.exists(),
            #            local_path_executable=local_path.exists() and os.access(local_path, os.X_OK),
            #            which_result=shutil.which(custom_cli),
            #            path_dirs=os.getenv('PATH', '').split(':')[:5])  # First 5 PATH dirs
            raise FileNotFoundError(f"Claude CLI '{custom_cli}' not found in PATH or local installation")

        claude_cli_path = find_claude_cli()
        log_to_file(f"Found Claude CLI at: {claude_cli_path}")
        
        # Set up environment variables
        env = os.environ.copy()
        if session_id:
            env["CLAUDE_SESSION_ID"] = session_id
        log_to_file(f"Environment setup complete, session_id: {session_id}")

        # Build command args - this is the key insight from claude-code-mcp
        cmd = [
            claude_cli_path,
            '--dangerously-skip-permissions',  # This bypasses interactive prompts
            '-p', prompt  # Pass prompt directly
        ]
        log_to_file(f"Command built: {' '.join(cmd[:3])}... (truncated)")

        # logger.debug("Preparing Claude CLI subprocess", 
        #            claude_cli=claude_cli_path,
        #            work_folder=workFolder,
        #            cmd_length=len(cmd),
        #            prompt_length=len(prompt),
        #            has_session=bool(session_id),
        #            cwd_exists=os.path.exists(workFolder),
        #            cwd_writable=os.access(workFolder, os.W_OK))

        # Execute Claude CLI with simple subprocess (each agent gets its own thread)
        try:
            import subprocess
            
            log_to_file(f"About to start subprocess with Popen")
            
            # logger.debug("Starting Claude CLI subprocess with Popen",
            #            cmd=" ".join(cmd),
            #            work_folder=workFolder)
            
            process = subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=workFolder,
            )
            
            log_to_file(f"Subprocess created, getting PID...")
            
            # Get PID immediately - process runs independently
            pid = process.pid
            if pid is None:
                log_to_file(f"ERROR: PID is None!")
                raise RuntimeError("Subprocess created but PID is None")
            
            log_to_file(f"SUCCESS: Got PID {pid}")
            
            # Register process with the reaper to prevent zombie processes
            _process_reaper.register_process(process)
            log_to_file(f"Process {pid} registered with reaper")
            
            # Start the process reaper if not already running
            if not _process_reaper.is_running:
                _process_reaper.start()
            
            # logger.info("Claude CLI subprocess started successfully",
            #           pid=pid,
            #           work_folder=workFolder,
            #           session_id=session_id,
            #           command=claude_cli_path,
            #           tracked_processes=_process_reaper.get_tracked_process_count())
                       
        except OSError as e:
            log_to_file(f"OSError in subprocess creation: {e}")
            # logger.error("Failed to create Claude CLI subprocess - OS error",
            #            error=str(e),
            #            cmd=cmd,
            #            work_folder=workFolder,
            #            errno=getattr(e, 'errno', None))
            raise RuntimeError(f"Failed to start Claude CLI: {e}")
        except Exception as e:
            log_to_file(f"Unexpected error in subprocess creation: {type(e).__name__}: {e}")
            # logger.error("Unexpected error creating Claude CLI subprocess",
            #            error=str(e),
            #            error_type=type(e).__name__,
            #            cmd=cmd,
            #            work_folder=workFolder)
            raise

        log_to_file(f"Returning success result with PID {pid}")
        return {
            "success": True,
            "pid": pid,
            "work_folder": workFolder,
            "session_id": session_id,
            "spawned_at": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        log_to_file(f"OUTER EXCEPTION: {type(e).__name__}: {e}")
        # logger.error("Claude CLI spawn failed", error=str(e), work_folder=workFolder)
        
        return {
            "success": False,
            "pid": None, 
            "error": f"Spawn failed: {e!s}",
            "work_folder": workFolder,
        }


# Remove old synchronous function - we're fully async now!


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
            # logger.error("Concurrent Claude spawn failed", error=str(e))
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

    # Remove newlines and extra whitespace that are NOT within quoted strings
    # This handles multiline JSON that AI often generates like:
    # '{\n  "key": "value",\n  "other": "data"\n}'
    if "\n" in cleaned:
        # Split by quotes to preserve quoted content
        parts = []
        in_quotes = False
        current_part = ""
        i = 0

        while i < len(cleaned):
            char = cleaned[i]

            if char == '"' and (i == 0 or cleaned[i-1] != "\\"):
                # Toggle quote state (ignore escaped quotes)
                in_quotes = not in_quotes
                current_part += char
            elif char == "\n" and not in_quotes:
                # Replace newlines outside quotes with space
                current_part += " "
            else:
                current_part += char
            i += 1

        cleaned = current_part

    # Clean up multiple spaces that may have been created
    cleaned = re.sub(r"\s+", " ", cleaned)

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


def setup_dependency_monitoring(agent_id: str, depends_on: list[str]) -> dict[str, Any]:
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
        # logger.error("Failed to setup dependency monitoring", agent_id=agent_id, error=str(e))
        return {"success": False, "error": str(e)}





# Register all tool modules with the FastMCP app
# Tools are now automatically registered when the tools package is imported above
# logger.info("MCP tools automatically registered via imports")


# File operation tools (simple ones that don't need schemas)
@app.tool(
    name="list_files",
    description="List files and directories with smart ignore patterns for project navigation",
    tags={"file-operations", "navigation", "listing"},
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
            ".venv", "venv", ".env", "*.pyc", "*.pyo", ".DS_Store",
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
    tags={"file-operations", "search", "pattern-matching"},
)
async def find_files(pattern: str, directory: str = ".") -> str:
    """Find files by pattern with smart filtering."""
    try:
        import fnmatch
        from pathlib import Path

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
    tags={"file-operations", "text-replacement", "editing"},
)
async def easy_replace(file_path: str, old_text: str, new_text: str, backup: bool = True) -> str:
    """Replace text in a file with safety checks."""
    try:
        import shutil
        from pathlib import Path

        path = Path(file_path)
        if not path.exists():
            return f"Error: File '{file_path}' does not exist"

        # Read current content
        content = path.read_text(encoding="utf-8")

        if old_text not in content:
            return f"Text '{old_text}' not found in '{file_path}'"

        # Create backup if requested
        if backup:
            backup_path = path.with_suffix(path.suffix + ".bak")
            shutil.copy2(path, backup_path)

        # Perform replacement
        new_content = content.replace(old_text, new_text)
        path.write_text(new_content, encoding="utf-8")

        return f"Successfully replaced '{old_text}' with '{new_text}' in '{file_path}'"

    except Exception as e:
        return f"Error replacing text: {e}"


@app.tool(
    name="get_connection_status",
    description="Get client connection status and stream error monitoring for debugging",
    tags={"monitoring", "connections", "stream-errors", "debugging"},
)
async def get_connection_status() -> dict[str, Any]:
    """Get current client connection status and stream error monitoring."""
    try:
        connection_status = _connection_monitor.get_status()
        
        return {
            "status": "healthy" if connection_status["consecutive_failures"] < 3 else "degraded",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "connection_monitoring": connection_status,
            "stream_error_handling": {
                "enabled": True,
                "handled_error_types": [
                    "ClosedResourceError",
                    "BrokenResourceError", 
                    "ConnectionResetError",
                    "OSError (broken pipe/connection reset)"
                ],
                "retry_strategy": "exponential_backoff",
                "max_consecutive_retries": 3,
                "connection_persistence": "server_continues_after_client_disconnect"
            },
            "recommendations": {
                "healthy": connection_status["consecutive_failures"] == 0,
                "needs_attention": connection_status["consecutive_failures"] > 2,
                "retry_capability": connection_status["should_retry"]
            }
        }
        
    except Exception as e:
        return {
            "status": "error",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": str(e),
            "error_type": type(e).__name__
        }


@app.tool(
    name="get_server_health",
    description="Get comprehensive server health status and metrics for monitoring",
    tags={"monitoring", "health", "system-status"},
)
async def get_server_health() -> dict[str, Any]:
    """Get comprehensive server health status and metrics."""
    import psutil
    import time
    
    try:
        current_process = psutil.Process()
        
        # Get process metrics
        memory_info = current_process.memory_info()
        memory_mb = memory_info.rss / 1024 / 1024
        
        # Get system metrics
        cpu_percent = current_process.cpu_percent()
        open_files = len(current_process.open_files())
        threads = current_process.num_threads()
        
        # Get child processes (spawned agents)
        children = current_process.children(recursive=True)
        active_agents = len(children)
        
        # Get process reaper status
        reaper_status = {
            "running": _process_reaper.is_running,
            "tracked_processes": _process_reaper.get_tracked_process_count(),
        }
        
        # Get connection monitoring status
        connection_status = _connection_monitor.get_status()
        
        # Database health
        db_healthy = True
        db_error = None
        try:
            from .database import engine
            if engine:
                # Quick connection test
                async with engine.begin() as conn:
                    await conn.exec_driver_sql("SELECT 1")
            else:
                db_healthy = False
                db_error = "No database engine"
        except Exception as e:
            db_healthy = False
            db_error = str(e)
        
        health_status = {
            "status": "healthy" if db_healthy and memory_mb < 1000 and connection_status["consecutive_failures"] < 3 else "degraded",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "process": {
                "pid": current_process.pid,
                "memory_mb": round(memory_mb, 2),
                "cpu_percent": round(cpu_percent, 1),
                "open_files": open_files,
                "threads": threads,
                "uptime_seconds": round(time.time() - current_process.create_time(), 1)
            },
            "agents": {
                "active_count": active_agents,
                "child_pids": [child.pid for child in children]
            },
            "process_reaper": reaper_status,
            "database": {
                "healthy": db_healthy,
                "error": db_error
            },
            "connections": {
                "active_connections": connection_status["active_connections"],
                "consecutive_failures": connection_status["consecutive_failures"],
                "disconnect_count": connection_status["disconnect_count"],
                "healthy": connection_status["consecutive_failures"] < 3,
                "stream_error_handling_enabled": True
            },
            "system": {
                "memory_warning": memory_mb > 500,
                "high_file_usage": open_files > 100,
                "connection_issues": connection_status["consecutive_failures"] > 0
            }
        }
        
        return health_status
        
    except Exception as e:
        return {
            "status": "error",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": str(e),
            "error_type": type(e).__name__
        }


# ========================================
# FASTMCP PROMPTS FOR ENHANCED UX
# ========================================

@app.prompt(
    name="build_agent_objective",
    description="Analyze a user request and suggest optimal agent objectives with multi-agent coordination",
    tags={"agent-planning", "objective-building", "multi-agent"},
)
async def build_agent_objective(user_request: str, project_type: str = "general") -> list[PromptMessage]:
    """Help users break down complex tasks into agent-friendly objectives with coordination."""

    analysis_prompt = f"""
Analyze this user request for a {project_type} project and suggest the optimal agent orchestration approach:

USER REQUEST: "{user_request}"

Please provide:

1. **COMPLEXITY ASSESSMENT**
   - Is this a single-agent task or multi-agent workflow?
   - What are the main complexity factors?

2. **RECOMMENDED APPROACH**
   - Should they use `orchestrate_objective()` (multi-agent) or `spawn_agent()` (single)?
   - What agent types are needed?

3. **OPTIMAL OBJECTIVE BREAKDOWN**
   - Primary objective for orchestrate_objective()
   - OR specific agent type + task for spawn_agent()

4. **SUGGESTED COORDINATION**
   - What dependencies between agents?
   - Communication patterns needed?

5. **ENHANCED OBJECTIVE**
   Write the exact objective string they should use, optimized for:
   - Clear agent coordination
   - Proper dependency sequencing  
   - Comprehensive requirements

Format your response to guide them toward the most effective agent orchestration strategy.
"""

    return [
        PromptMessage(role="user", content=TextContent(type="text", text=analysis_prompt)),
        PromptMessage(role="assistant", content=TextContent(type="text", text="I'll analyze your request and suggest the optimal agent orchestration approach with specific objectives you can use directly.")),
    ]


@app.prompt(
    name="suggest_multi_agent_workflow",
    description="Suggest multi-agent workflows for common development patterns",
    tags={"multi-agent", "workflows", "development-patterns"},
)
async def suggest_multi_agent_workflow(task_category: str, requirements: str = "") -> list[PromptMessage]:
    """Suggest optimal multi-agent workflows for common development scenarios."""

    workflow_prompt = f"""
Suggest an optimal multi-agent workflow for this scenario:

TASK CATEGORY: {task_category}
ADDITIONAL REQUIREMENTS: {requirements}

Provide a comprehensive multi-agent workflow including:

1. **AGENT SEQUENCE**
   - What types of agents needed?
   - Optimal execution order
   - Dependencies between agents

2. **ORCHESTRATE_OBJECTIVE COMMAND**
   ```python
   orchestrate_objective(
       objective="[specific objective here]",
       repository_path=".",
       foundation_session_id="[optional-shared-context]"
   )
   ```

3. **WORKFLOW EXPLANATION**
   - Why this agent sequence?
   - How agents coordinate
   - Expected outcomes

4. **ALTERNATIVE APPROACHES**
   - Single agent alternatives
   - When to use which approach

5. **OPTIMIZATION TIPS**
   - Foundation sessions for cost reduction
   - Communication patterns
   - Error handling

Focus on proven patterns: Frontend+Backend+Testing, Documentation+Implementation, Investigation+Fix+Verification, etc.
"""

    return [
        PromptMessage(role="user", content=TextContent(type="text", text=workflow_prompt)),
        PromptMessage(role="assistant", content=TextContent(type="text", text="I'll suggest an optimal multi-agent workflow with specific orchestration commands you can use.")),
    ]


@app.prompt(
    name="resolve_agent_dependencies",
    description="Analyze tasks and suggest optimal agent dependency chains",
    tags={"agent-dependencies", "coordination", "task-analysis"},
)
async def resolve_agent_dependencies(objectives: list[str], constraint_info: str = "") -> list[PromptMessage]:
    """Analyze multiple objectives and suggest optimal agent coordination."""

    objectives_str = "\n".join([f"{i+1}. {obj}" for i, obj in enumerate(objectives)])

    dependency_prompt = f"""
Analyze these objectives and design optimal agent coordination:

OBJECTIVES:
{objectives_str}

CONSTRAINTS: {constraint_info}

Please provide:

1. **DEPENDENCY ANALYSIS**
   - Which objectives depend on others?
   - Potential conflicts or blockers
   - Parallel vs sequential execution

2. **AGENT COORDINATION STRATEGY**
   - Sequential agent spawning with dependencies
   - OR single orchestrate_objective with coordinated agents
   - Communication patterns needed

3. **IMPLEMENTATION APPROACH**

   **Option A - Sequential Spawning:**
   ```python
   # Step 1
   agent1 = await spawn_agent("type1", ".", "objective1")
   
   # Step 2 (depends on agent1)
   agent2 = await spawn_agent("type2", ".", "objective2", 
                             depends_on=[agent1["agent_id"]])
   ```

   **Option B - Orchestrated Workflow:**
   ```python
   orchestrate_objective(
       objective="[combined objective with coordination]",
       repository_path="."
   )
   ```

4. **COORDINATION RECOMMENDATIONS**
   - Shared memory usage
   - Error handling strategies
   - Progress monitoring

5. **OPTIMAL EXECUTION PLAN**
   - Recommended approach with rationale
   - Step-by-step implementation
   - Expected timeline and outcomes

Help them choose the most efficient coordination strategy.
"""

    return [
        PromptMessage(role="user", content=TextContent(type="text", text=dependency_prompt)),
        PromptMessage(role="assistant", content=TextContent(type="text", text="I'll analyze your objectives and suggest the optimal agent coordination strategy with specific implementation steps.")),
    ]


@app.prompt(
    name="improve_from_errors",
    description="Analyze recent errors and suggest improved agent approaches",
    tags={"error-analysis", "improvement", "learning"},
)
async def improve_from_errors(error_context: str, original_objective: str = "") -> list[PromptMessage]:
    """Help users learn from errors and improve agent orchestration."""

    improvement_prompt = f"""
Analyze this error context and suggest improved agent orchestration:

ERROR CONTEXT: {error_context}
ORIGINAL OBJECTIVE: {original_objective}

Please provide:

1. **ERROR ANALYSIS**
   - Root cause identification
   - Agent coordination issues
   - Resource/dependency problems

2. **IMPROVED STRATEGY**
   - Better agent type selection
   - Enhanced objective formulation
   - Improved coordination patterns

3. **PREVENTION TECHNIQUES**
   - Error handling patterns
   - Validation strategies
   - Monitoring approaches

4. **REVISED IMPLEMENTATION**
   ```python
   # Improved approach:
   orchestrate_objective(
       objective="[enhanced objective]",
       repository_path=".",
       foundation_session_id="[for shared context]"
   )
   ```

5. **LEARNING INSIGHTS**
   - Key lessons for future workflows
   - Best practices to adopt
   - Common pitfalls to avoid

Help them evolve their agent orchestration skills based on practical experience.
"""

    return [
        PromptMessage(role="user", content=TextContent(type="text", text=improvement_prompt)),
        PromptMessage(role="assistant", content=TextContent(type="text", text="I'll analyze the errors and suggest improved agent orchestration strategies you can implement immediately.")),
    ]


@app.prompt(
    name="setup_agent_communication",
    description="Guide users on setting up effective agent communication workflows with chat rooms",
    tags={"communication", "chat-rooms", "coordination", "multi-agent"},
)
async def setup_agent_communication(workflow_type: str, agent_count: int = 3) -> list[PromptMessage]:
    """Help users set up effective agent communication patterns."""

    communication_prompt = f"""
Set up effective agent communication for this workflow:

WORKFLOW TYPE: {workflow_type}
AGENT COUNT: {agent_count}

Design optimal communication strategy:

1. **CHAT ROOM ARCHITECTURE**
   - Room naming conventions
   - Agent assignment to rooms
   - Communication hierarchy

2. **COORDINATION PATTERNS**
   ```python
   # Main coordination room
   await join_room(room_name="main-{workflow_type}", agent_id="coordinator")
   
   # Specialized rooms for different phases
   await join_room(room_name="{workflow_type}-backend", agent_id="backend-agent")
   await join_room(room_name="{workflow_type}-frontend", agent_id="frontend-agent")
   await join_room(room_name="{workflow_type}-testing", agent_id="test-agent")
   ```

3. **MESSAGE TYPES & PROTOCOLS**
   - Status updates: `@all Backend API endpoints completed`
   - Dependency notifications: `@frontend Ready for integration testing`
   - Error alerts: `@coordinator Issue with database connection`
   - Completion signals: `@all Phase 1 complete, moving to Phase 2`

4. **COMMUNICATION BEST PRACTICES**
   - Regular status broadcasts
   - Dependency checkpoint messages
   - Error escalation patterns
   - Completion confirmation chains

5. **MONITORING & COORDINATION**
   - Use `get_messages()` to track progress
   - Set up `wait_for_messages()` for synchronization
   - Broadcast important updates to multiple rooms
   - Monitor communication with resources: `agents://active/summary`

Help them create a communication strategy that ensures smooth multi-agent coordination and prevents workflow blockers.
"""

    return [
        PromptMessage(role="user", content=TextContent(type="text", text=communication_prompt)),
        PromptMessage(role="assistant", content=TextContent(type="text", text="I'll design an optimal agent communication strategy with specific room setups and messaging protocols for your workflow.")),
    ]


@app.prompt(
    name="manage_shared_insights",
    description="Guide users on storing and leveraging shared memory insights for cross-agent learning",
    tags={"shared-memory", "insights", "learning", "knowledge-sharing"},
)
async def manage_shared_insights(project_context: str, learning_focus: str = "general") -> list[PromptMessage]:
    """Help users effectively use shared memory for cross-agent learning."""

    insights_prompt = f"""
Optimize shared memory and insights for cross-agent learning:

PROJECT CONTEXT: {project_context}
LEARNING FOCUS: {learning_focus}

Design effective knowledge sharing strategy:

1. **INSIGHT STORAGE PATTERNS**
   ```python
   # Store architectural discoveries
   await store_agent_insight(
       repository_path=".",
       agent_id="backend-agent",
       insight_type="architecture",
       category="database",
       title="Optimal connection pooling pattern",
       description="Found that connection pool size of 20 reduces latency by 40%",
       context={{"database": "postgresql", "load": "high"}},
       confidence=0.85
   )
   
   # Store debugging insights
   await store_agent_insight(
       repository_path=".",
       agent_id="test-agent", 
       insight_type="debugging",
       category="testing",
       title="Flaky test resolution pattern",
       description="Adding 200ms wait before assertions eliminates race conditions",
       confidence=0.9
   )
   ```

2. **KNOWLEDGE RETRIEVAL STRATEGIES**
   ```python
   # Query for relevant insights before starting work
   insights = await query_shared_memory(
       repository_path=".",
       query_text="database optimization patterns",
       entry_types=["insight", "pattern"],
       limit=5
   )
   
   # Get category-specific insights
   db_insights = await get_agent_insights(
       repository_path=".",
       categories=["database", "performance"],
       min_confidence=0.7
   )
   ```

3. **CROSS-AGENT LEARNING LOOPS**
   - Before starting: Query for relevant insights
   - During work: Store discoveries and patterns  
   - After completion: Document lessons learned
   - Monitor insights: Use `memory://./insights` resource

4. **INSIGHT CATEGORIES**
   - **Architecture**: Design patterns, structure decisions
   - **Performance**: Optimization discoveries, bottlenecks
   - **Debugging**: Common issues and solutions
   - **Integration**: API patterns, coordination techniques
   - **Testing**: Test strategies, reliability patterns

5. **MEMORY MAINTENANCE**
   ```python
   # Store high-value insights for project memory
   await store_memory_entry(
       repository_path=".",
       agent_id="coordinator",
       entry_type="project-knowledge",
       title="Key architectural decisions",
       content="Document critical design choices for future reference"
   )
   ```

Help them build a knowledge base that accelerates future agent work and prevents repeating solved problems.
"""

    return [
        PromptMessage(role="user", content=TextContent(type="text", text=insights_prompt)),
        PromptMessage(role="assistant", content=TextContent(type="text", text="I'll design a comprehensive shared memory strategy that enables effective cross-agent learning and knowledge accumulation for your project.")),
    ]


@app.prompt(
    name="coordinate_agent_workflow",
    description="Guide users on orchestrating agents with effective communication and shared learning",
    tags={"coordination", "workflow", "communication", "shared-memory", "orchestration"},
)
async def coordinate_agent_workflow(objective: str, complexity: str = "medium") -> list[PromptMessage]:
    """Help users orchestrate agents with optimal communication and learning patterns."""

    coordination_prompt = f"""
Orchestrate agents with effective communication and shared learning:

OBJECTIVE: {objective}
COMPLEXITY: {complexity}

Design complete coordination strategy:

1. **ORCHESTRATION SETUP**
   ```python
   # Start with shared context for cost efficiency
   orchestrate_objective(
       objective="{objective}",
       repository_path=".",
       foundation_session_id="shared-project-context"
   )
   ```

2. **COMMUNICATION ARCHITECTURE**
   ```python
   # Agents automatically join project coordination rooms:
   # - "main-project": Overall coordination
   # - "backend-team": Backend agent communication  
   # - "frontend-team": Frontend agent communication
   # - "testing-team": Testing agent coordination
   # - "docs-team": Documentation agent updates
   ```

3. **SHARED LEARNING INTEGRATION**
   ```python
   # Each agent queries project insights before starting:
   relevant_insights = await query_shared_memory(
       repository_path=".",
       query_text="{objective} best practices",
       limit=10
   )
   
   # Agents store discoveries during work:
   await store_agent_insight(
       repository_path=".",
       agent_id="current-agent",
       insight_type="implementation",
       category="project-specific",
       title="Optimal approach for {objective}",
       description="Discovered efficient pattern...",
       confidence=0.8
   )
   ```

4. **COORDINATION CHECKPOINTS**
   - **Initialization**: Agents query shared memory, join rooms
   - **Progress Updates**: Regular status broadcasts to team rooms
   - **Dependency Gates**: Agents wait for prerequisite completion
   - **Knowledge Sharing**: Store insights as they're discovered
   - **Completion**: Final insights stored, lessons documented

5. **MONITORING RESOURCES**
   - `agents://active/summary` - See all active agents and their rooms
   - `memory://./insights` - Access accumulated project knowledge
   - `tasks://./history` - Review coordination patterns
   - `system://orchestration/health` - Overall system status

6. **OPTIMIZATION STRATEGIES**
   - Use foundation sessions to share context across agents
   - Set up error escalation through communication rooms
   - Create feedback loops between insights and agent spawning
   - Monitor coordination patterns for continuous improvement

This creates a self-improving multi-agent system where each agent benefits from collective knowledge and effective coordination.
"""

    return [
        PromptMessage(role="user", content=TextContent(type="text", text=coordination_prompt)),
        PromptMessage(role="assistant", content=TextContent(type="text", text="I'll design a comprehensive agent coordination strategy that integrates effective communication and shared learning for optimal multi-agent workflows.")),
    ]


# ========================================
# FASTMCP RESOURCES FOR TRANSPARENCY
# ========================================

@app.resource("project://{repo_path}/analysis",
             name="Project Analysis Data",
             description="Real-time project structure analysis and metrics")
async def get_project_analysis(repo_path: str) -> dict[str, Any]:
    """Expose project analysis data as a readable resource."""
    try:
        from .analysis.core.treesummary import TreeSummaryManager

        # Clean up the repo path (remove any project:// prefix)
        clean_path = repo_path.replace("project://", "").replace("/analysis", "")
        if not clean_path or clean_path == ".":
            clean_path = "."

        tree_manager = TreeSummaryManager(clean_path)
        analysis = await tree_manager.get_project_overview()

        return {
            "repository_path": clean_path,
            "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
            "structure": analysis,
            "summary": {
                "total_files": analysis.get("file_count", 0),
                "code_languages": analysis.get("languages", []),
                "project_type": analysis.get("project_type", "unknown"),
                "complexity_score": analysis.get("complexity_score", 0),
            },
        }

    except Exception as e:
        # logger.error("Error getting project analysis", repo_path=repo_path, error=str(e))
        return {"error": f"Failed to analyze project: {e}"}


@app.resource("agents://{agent_id}/status",
             name="Agent Status Information",
             description="Real-time status and progress of specific agents")
async def get_agent_status(agent_id: str) -> dict[str, Any]:
    """Expose agent status and progress as a readable resource."""
    try:
        # Add timeout protection for the entire resource handler
        async with asyncio.timeout(8.0):  # 8 second timeout for MCP resource handler
            from .services.agent_service import AgentService

            # Use MCP-safe method to prevent communication channel conflicts
            status = await AgentService.get_agent_by_id_safe(agent_id)

            if not status:
                return {
                    "agent_id": agent_id,
                    "status": "not_found",
                    "error": "Agent not found or not active",
                }

            # Return simplified response for fast MCP communication
            return {
                "agent_id": agent_id,
                "status": status.get("status", "unknown"),
                "agent_type": status.get("agent_type", "unknown"),
                "created_at": status.get("created_at"),
                "last_activity": status.get("last_heartbeat"),  # Use available field
                "capabilities": status.get("capabilities", []),
                "active_tasks": status.get("active_tasks", 0),
                "metadata": status.get("metadata", {}),
            }

    except asyncio.TimeoutError:
        # logger.warning("Agent status request timed out", agent_id=agent_id)
        return {
            "agent_id": agent_id,
            "error": "Database timeout - agent status unavailable",
            "status": "timeout"
        }
    except Exception as e:
        # logger.error("Error getting agent status", agent_id=agent_id, error=str(e))
        return {
            "agent_id": agent_id,
            "error": f"Failed to get agent status: {e}",
            "status": "error"
        }


@app.resource("agents://active/summary",
             name="Active Agents Summary",
             description="Overview of all currently active agents")
async def get_active_agents_summary() -> dict[str, Any]:
    """Provide summary of all active agents for system monitoring."""
    try:
        from .services.agent_service import AgentService

        agents_result = await AgentService.list_agents()
        agents = agents_result.get("agents", [])

        summary = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_active": len(agents),
            "agents_by_status": {},
            "agents_by_type": {},
            "active_agents": [],
        }

        for agent in agents:
            # Count by status
            status = agent.get("status", "unknown")
            summary["agents_by_status"][status] = summary["agents_by_status"].get(status, 0) + 1

            # Count by type
            agent_type = agent.get("agent_type", "unknown")
            summary["agents_by_type"][agent_type] = summary["agents_by_type"].get(agent_type, 0) + 1

            # Add to active list
            summary["active_agents"].append({
                "agent_id": agent.get("agent_id"),
                "agent_type": agent_type,
                "status": status,
                "created_at": agent.get("created_at"),
                "current_task": agent.get("current_task", "")[:100] + "..." if len(agent.get("current_task", "")) > 100 else agent.get("current_task", ""),
            })

        return summary

    except Exception as e:
        # logger.error("Error getting active agents summary", error=str(e))
        return {"error": f"Failed to get agents summary: {e}"}


@app.resource("docs://{source_name}/search/{query}",
             name="Documentation Search Results",
             description="Search results from indexed documentation sources")
async def search_documentation_resource(source_name: str, query: str) -> dict[str, Any]:
    """Expose documentation search as a readable resource."""
    try:
        from .services.documentation_service import DocumentationService

        doc_service = DocumentationService()
        results = await doc_service.search_documentation(
            query=query,
            source_names=[source_name] if source_name != "all" else None,
            limit=10,
        )

        return {
            "source_name": source_name,
            "query": query,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "results": results.get("results", []),
            "total_results": results.get("total_results", 0),
            "search_metadata": {
                "sources_searched": results.get("sources_searched", []),
                "search_time_ms": results.get("search_time_ms", 0),
            },
        }

    except Exception as e:
        # logger.error("Error searching documentation", source=source_name, query=query, error=str(e))
        return {"error": f"Failed to search documentation: {e}"}


@app.resource("memory://{repo_path}/insights",
             name="Shared Memory Insights",
             description="Agent insights and learning entries from shared memory")
async def get_memory_insights(repo_path: str) -> dict[str, Any]:
    """Expose shared memory insights as a readable resource."""
    try:
        from .services.shared_memory_service import SharedMemoryService

        # Clean up the repo path
        clean_path = repo_path.replace("memory://", "").replace("/insights", "")
        if not clean_path or clean_path == ".":
            clean_path = "."

        # Get recent insights and learning entries
        insights = await SharedMemoryService.get_insights_safe(clean_path, limit=50)
        # Using insights for learning data

        return {
            "repository_path": clean_path,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "insights": {
                "total_insights": len(insights.get("insights", [])),
                "recent_insights": insights.get("insights", [])[:10],
                "insights_by_category": insights.get("insights_by_category", {}),
                "top_categories": list(insights.get("insights_by_category", {}).keys())[:5],
            },
            "system_health": {
                "active_agents_count": insights.get("active_agents", 0),
                "recent_error_count": insights.get("recent_errors", 0),
                "knowledge_base_size": insights.get("knowledge_base_size", 0),
            },
        }

    except Exception as e:
        # logger.error("Error getting memory insights", repo_path=repo_path, error=str(e))
        return {"error": f"Failed to get memory insights: {e}"}


@app.resource("tasks://{repo_path}/history",
             name="Task Execution History",
             description="Historical view of task execution and coordination patterns")
async def get_task_history(repo_path: str) -> dict[str, Any]:
    """Expose task execution history as a readable resource."""
    try:
        from .services.task_service import TaskService

        # Clean up the repo path
        clean_path = repo_path.replace("tasks://", "").replace("/history", "")
        if not clean_path or clean_path == ".":
            clean_path = "."

        # Get recent task history
        tasks_result = await TaskService.list_tasks(clean_path, limit=50)
        recent_tasks = tasks_result.get("tasks", [])

        # Analyze patterns
        task_types = {}
        completion_rates = {"completed": 0, "failed": 0, "in_progress": 0}

        for task in recent_tasks:
            task_type = task.get("task_type", "unknown")
            task_types[task_type] = task_types.get(task_type, 0) + 1

            status = task.get("status", "unknown")
            if status in completion_rates:
                completion_rates[status] += 1

        return {
            "repository_path": clean_path,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "task_history": {
                "total_tasks": len(recent_tasks),
                "recent_tasks": recent_tasks[:15],
                "task_types": task_types,
                "completion_rates": completion_rates,
                "success_rate": round(completion_rates["completed"] / max(sum(completion_rates.values()), 1) * 100, 2),
            },
            "coordination_patterns": {
                "multi_agent_tasks": len([t for t in recent_tasks if t.get("dependencies", [])]),
                "average_task_duration": 0,  # Would need to calculate from task timestamps
                "common_dependencies": [],  # Would need to analyze task dependencies
            },
        }

    except Exception as e:
        # logger.error("Error getting task history", repo_path=repo_path, error=str(e))
        return {"error": f"Failed to get task history: {e}"}


@app.resource("fastmcp://context-logging",
             name="FastMCP Context Logging",
             description="Context and logging information for FastMCP operations")
async def get_context_logging() -> dict[str, Any]:
    """Provide FastMCP context and logging information."""
    try:
        tool_list = await app._list_tools()
        resources = await app._list_resources()
        prompts = await app._list_prompts()
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "logging_enabled": True,
            "log_level": "INFO",
            "context_tracking": {
                "active_contexts": 0,
                "context_history": [],
                "session_tracking": True,
            },
            "fastmcp_status": {
                "version": "2.9.0",
                "tools_registered": len(tool_list),
                "resources_registered": len(resources),
                "prompts_registered": len(prompts),
            },
        }
    except Exception as e:
        # logger.error("Error getting FastMCP context logging", error=str(e))
        return {"error": f"Failed to get context logging: {e}"}


@app.resource("connections://status",
             name="Connection Status Monitoring",
             description="Real-time client connection status and stream error monitoring")
async def get_connection_monitoring() -> dict[str, Any]:
    """Provide real-time connection status and stream error monitoring."""
    try:
        connection_status = _connection_monitor.get_status()
        
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "connection_state": {
                "active_connections": connection_status["active_connections"],
                "total_disconnects": connection_status["disconnect_count"],
                "consecutive_failures": connection_status["consecutive_failures"],
                "last_disconnect": connection_status.get("last_disconnect"),
                "should_retry": connection_status["should_retry"]
            },
            "stream_error_handling": {
                "enabled": True,
                "handled_errors": [
                    "anyio.ClosedResourceError",
                    "anyio.BrokenResourceError",
                    "ConnectionResetError", 
                    "OSError (broken pipe/connection reset)"
                ],
                "retry_mechanism": {
                    "strategy": "exponential_backoff",
                    "max_retries": 3,
                    "backoff_range": "1-10 seconds"
                }
            },
            "recent_events": connection_status["recent_events"],
            "health_status": {
                "healthy": connection_status["consecutive_failures"] < 3,
                "degraded": connection_status["consecutive_failures"] >= 3,
                "critical": not connection_status["should_retry"]
            }
        }
        
    except Exception as e:
        # logger.error("Error getting connection monitoring", error=str(e))
        return {"error": f"Failed to get connection monitoring: {e}"}


@app.resource("system://orchestration/health",
             name="Orchestration System Health",
             description="Overall health and performance metrics of the orchestration system")
async def get_system_health() -> dict[str, Any]:
    """Provide comprehensive system health information."""
    try:
        from .services.agent_service import AgentService
        from .services.error_logging_service import ErrorLoggingService

        # Get system metrics
        agents_result = await AgentService.list_agents()
        active_agents = agents_result.get("agents", [])
        recent_errors = await ErrorLoggingService.get_recent_errors(".", hours_back=24)
        error_patterns = await ErrorLoggingService.get_error_patterns(".")

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "system_status": "operational" if len(recent_errors.get("errors", [])) < 10 else "degraded",
            "performance_metrics": {
                "active_agents": len(active_agents),
                "errors_24h": len(recent_errors.get("errors", [])),
                "error_rate": round(len(recent_errors.get("errors", [])) / 24, 2),
                "top_error_patterns": error_patterns.get("top_patterns", [])[:5],
            },
            "resource_utilization": {
                "agents_by_type": {},  # Populated from active_agents
                "coordination_load": len([a for a in active_agents if a.get("dependencies")]),
                "communication_rooms_active": len(set(a.get("room_name") for a in active_agents if a.get("room_name"))),
            },
            "recommendations": {
                "scale_up_needed": len(active_agents) > 20,
                "error_attention_needed": len(recent_errors.get("errors", [])) > 10,
                "cleanup_recommended": error_patterns.get("cleanup_needed", False),
            },
        }

    except Exception as e:
        # logger.error("Error getting system health", error=str(e))
        return {"error": f"Failed to get system health: {e}"}


@app.resource("documentation-sources://list",
             name="Documentation Sources List",
             description="List all available documentation sources with metadata")
async def get_documentation_sources_list() -> dict[str, Any]:
    """Expose all documentation sources as a readable resource."""
    try:
        from .services.documentation_service import DocumentationService

        sources = await DocumentationService.list_documentation_sources_safe()
        
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_sources": len(sources),
            "sources": sources,
        }

    except Exception as e:
        # logger.error("Error listing documentation sources", error=str(e))
        return {"error": f"Failed to list documentation sources: {e}"}


@app.resource("documentation-sources://{source_id}",
             name="Documentation Source Details",
             description="Detailed information about a specific documentation source")
async def get_documentation_source_details(source_id: str) -> dict[str, Any]:
    """Expose specific documentation source details as a readable resource."""
    try:
        from .services.documentation_service import DocumentationService

        source = await DocumentationService.get_documentation_source_safe(source_id)
        
        if not source:
            return {
                "source_id": source_id,
                "status": "not_found",
                "error": "Documentation source not found",
            }

        # Get additional statistics
        stats = await DocumentationService.get_documentation_stats_safe()
        
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source_id": source_id,
            "source_details": source,
            "system_stats": {
                "total_sources": stats.get("total_sources", 0),
                "total_entries": stats.get("total_entries", 0),
                "total_embeddings": stats.get("total_embeddings", 0),
            },
        }

    except Exception as e:
        # logger.error("Error getting documentation source details", source_id=source_id, error=str(e))
        return {"error": f"Failed to get documentation source details: {e}"}


@app.resource("documentation-sources://{source_id}/status",
             name="Documentation Source Scraping Status",
             description="Real-time scraping status and progress for a documentation source")
async def get_documentation_source_status(source_id: str) -> dict[str, Any]:
    """Expose documentation source scraping status as a readable resource."""
    try:
        from .services.documentation_service import DocumentationService

        # Initialize service to get scraping status
        doc_service = DocumentationService()
        await doc_service.initialize()
        
        try:
            # Get comprehensive scraping status
            status = await doc_service.get_scraping_status(source_id)
            
            # Get source details for additional context
            source_details = await DocumentationService.get_documentation_source_safe(source_id)
            
            if not source_details:
                return {
                    "source_id": source_id,
                    "status": "not_found",
                    "error": "Documentation source not found",
                }

            return {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source_id": source_id,
                "source_name": source_details.get("name"),
                "source_url": source_details.get("url"),
                "last_scraped": source_details.get("last_scraped"),
                "source_status": source_details.get("status"),
                "scraping_status": status,
            }
            
        finally:
            await doc_service.cleanup()

    except Exception as e:
        # logger.error("Error getting documentation source status", source_id=source_id, error=str(e))
        return {"error": f"Failed to get documentation source status: {e}"}


@app.resource("documentation-sources://{source_id}/entries",
             name="Documentation Source Entries",
             description="Documentation entries and content for a specific source")
async def get_documentation_source_entries(source_id: str) -> dict[str, Any]:
    """Expose documentation entries for a specific source as a readable resource."""
    try:
        from .services.documentation_service import DocumentationService

        # Use MCP-safe method to prevent communication channel conflicts
        return await DocumentationService.get_documentation_source_entries_safe(source_id)

    except Exception as e:
        # logger.error("Error getting documentation source entries", source_id=source_id, error=str(e))
        return {"error": f"Failed to get documentation source entries: {e}"}


# Register all tools when the module is imported
# Tools are automatically registered via imports at module load time

# Auto-initialize on import
async def _auto_init():
    try:
        await init_database()
        # logger.info("Auto-initialized orchestration server")
    except Exception as e:
        # logger.error("Auto-initialization failed", error=str(e))
        pass

# Auto-initialization will be handled by the server when it starts

async def run_startup_diagnostics() -> bool:
    """Run startup diagnostics and health checks.
    
    Returns:
        bool: True if all checks pass, False otherwise
    """
    if not config.get("server.startup_diagnostics", True):
        return True
    
    # logger.info("Running startup diagnostics...")
    
    try:
        # Check database connectivity
        # logger.info("Checking database connectivity...")
        await init_database()
        # logger.info("✓ Database connectivity verified")
        
        # Check required dependencies
        # logger.info("Checking dependencies...")
        import fastmcp
        import sqlalchemy
        # logger.info("✓ Dependencies verified", fastmcp_version=fastmcp.__version__)
        
        # Validate configuration
        # logger.info("Validating configuration...")
        if config.get("logging.level") not in ["DEBUG", "INFO", "WARNING", "ERROR"]:
            logger.warning("Invalid log level in config, using INFO")
        # logger.info("✓ Configuration validated")
        
        # Bootstrap unscraped documentation sources
        if config.get("documentation.auto_bootstrap", True):
            # logger.info("Bootstrapping unscraped documentation sources...")
            try:
                from .services.documentation_bootstrap import bootstrap_documentation_sources
                bootstrap_result = await bootstrap_documentation_sources()
                
                if bootstrap_result.get("error"):
                    logger.error("Documentation bootstrap failed", error=bootstrap_result["error"])
                else:
                    # logger.info("✓ Documentation bootstrap completed",
                    #           sources_found=bootstrap_result.get("unscraped_found", 0),
                    #           tasks_scheduled=bootstrap_result.get("tasks_scheduled", 0))
                    pass
            except Exception as e:
                logger.error("Documentation bootstrap failed", error=str(e))
        
        # logger.info("All startup diagnostics passed")
        return True
        
    except Exception as e:
        logger.error("Startup diagnostics failed", error=str(e), exc_info=True)
        return False

def _handle_runtime_crash(exception: Exception) -> None:
    """Handle runtime server crashes with comprehensive logging and cleanup."""
    import signal
    import platform
    import psutil
    
    logger.error("=== RUNTIME CRASH DETECTED ===")
    logger.error("Server crashed during runtime operation")
    
    # Basic crash information
    logger.error("Exception Type: %s", type(exception).__name__)
    logger.error("Exception Message: %s", str(exception))
    logger.error("Time: %s", datetime.now(timezone.utc).isoformat())
    
    # System information
    logger.error("System Info:")
    logger.error("  Platform: %s", platform.platform())
    logger.error("  Python: %s", platform.python_version())
    logger.error("  PID: %s", os.getpid())
    
    # Process information
    try:
        process = psutil.Process()
        logger.error("  Memory Usage: %.2f MB", process.memory_info().rss / 1024 / 1024)
        logger.error("  CPU Percent: %.1f%%", process.cpu_percent())
        logger.error("  Open Files: %d", len(process.open_files()))
        logger.error("  Threads: %d", process.num_threads())
    except Exception:
        logger.error("  Process info unavailable")
    
    # Full stack trace
    logger.error("Stack Trace:")
    for line in traceback.format_exc().splitlines():
        logger.error("  %s", line)
    
    # Save crash dump to file
    try:
        crash_dir = Path.home() / ".mcptools" / "crashes"
        crash_dir.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        crash_file = crash_dir / f"crash_{timestamp}.log"
        
        with open(crash_file, 'w') as f:
            f.write(f"ClaudeMcpTools Orchestration Server Crash Report\n")
            f.write(f"Time: {datetime.now(timezone.utc).isoformat()}\n")
            f.write(f"Exception: {type(exception).__name__}: {str(exception)}\n")
            f.write(f"Platform: {platform.platform()}\n")
            f.write(f"Python: {platform.python_version()}\n")
            f.write(f"PID: {os.getpid()}\n\n")
            f.write(f"Stack Trace:\n{traceback.format_exc()}\n")
            
            # Add system info
            try:
                process = psutil.Process()
                f.write(f"\nProcess Info:\n")
                f.write(f"Memory: {process.memory_info().rss / 1024 / 1024:.2f} MB\n")
                f.write(f"CPU: {process.cpu_percent():.1f}%\n")
                f.write(f"Files: {len(process.open_files())}\n")
                f.write(f"Threads: {process.num_threads()}\n")
            except Exception:
                f.write(f"Process info unavailable\n")
        
        logger.error("Crash dump saved to: %s", crash_file)
        
    except Exception as crash_save_error:
        logger.error("Failed to save crash dump: %s", str(crash_save_error))
    
    # Cleanup resources
    logger.error("Attempting cleanup...")
    try:
        # Close database connections
        from .database import engine
        if engine:
            asyncio.run(engine.dispose())
            logger.error("Database connections closed")
    except Exception as cleanup_error:
        logger.error("Cleanup error: %s", str(cleanup_error))
    
    logger.error("=== END RUNTIME CRASH REPORT ===")

# ========================================
# CONNECTION STATE MONITORING
# ========================================

class ConnectionStateMonitor:
    """Monitor and track client connection state for graceful error handling."""
    
    def __init__(self):
        self.active_connections = 0
        self.connection_history = []
        self.last_disconnect_time = None
        self.disconnect_count = 0
        self.consecutive_failures = 0
        self._lock = threading.Lock()
    
    def log_connection_established(self) -> None:
        """Log when a client connection is established."""
        with self._lock:
            self.active_connections += 1
            self.consecutive_failures = 0
            event = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "event": "connection_established",
                "active_count": self.active_connections
            }
            self.connection_history.append(event)
            # Keep only last 100 events
            self.connection_history = self.connection_history[-100:]
            
        # logger.info("Client connection established", active_connections=self.active_connections)
    
    def log_connection_disconnected(self, error_type: str = "normal") -> None:
        """Log when a client connection is lost."""
        with self._lock:
            self.active_connections = max(0, self.active_connections - 1)
            self.disconnect_count += 1
            self.last_disconnect_time = datetime.now(timezone.utc)
            
            if error_type in ["ClosedResourceError", "BrokenResourceError"]:
                self.consecutive_failures += 1
            
            event = {
                "timestamp": self.last_disconnect_time.isoformat(),
                "event": "connection_disconnected",
                "error_type": error_type,
                "active_count": self.active_connections,
                "consecutive_failures": self.consecutive_failures
            }
            self.connection_history.append(event)
            self.connection_history = self.connection_history[-100:]
            
        # logger.info("Client connection disconnected", 
        #           error_type=error_type,
        #           active_connections=self.active_connections,
        #           consecutive_failures=self.consecutive_failures)
    
    def should_retry(self) -> bool:
        """Determine if the server should attempt to continue after connection errors."""
        with self._lock:
            # Don't retry if too many consecutive failures
            if self.consecutive_failures > 5:
                return False
            
            # Check if we've had too many disconnects recently
            if len(self.connection_history) >= 10:
                recent_disconnects = [
                    event for event in self.connection_history[-10:]
                    if event["event"] == "connection_disconnected"
                ]
                if len(recent_disconnects) >= 8:  # 8 out of last 10 events were disconnects
                    return False
            
            return True
    
    def get_status(self) -> dict[str, Any]:
        """Get current connection status for monitoring."""
        with self._lock:
            return {
                "active_connections": self.active_connections,
                "disconnect_count": self.disconnect_count,
                "consecutive_failures": self.consecutive_failures,
                "last_disconnect": self.last_disconnect_time.isoformat() if self.last_disconnect_time else None,
                "recent_events": self.connection_history[-5:],
                "should_retry": self.should_retry()
            }

# Global connection monitor
_connection_monitor = ConnectionStateMonitor()


def _setup_signal_handlers() -> None:
    """Setup signal handlers for graceful shutdown."""
    import signal
    
    def signal_handler(signum, frame):
        signal_name = signal.Signals(signum).name
        logger.info("Received %s signal, initiating graceful shutdown...", signal_name)
        
        # Cleanup resources
        try:
            # Close database connections
            from .database import engine
            if engine:
                asyncio.run(engine.dispose())
                logger.info("Database connections closed")
        except Exception as e:
            logger.error("Error during database cleanup: %s", str(e))
        
        # Cleanup handled by individual services
        
        # Stop the process reaper
        try:
            _process_reaper.stop()
            logger.info("Process reaper stopped")
        except Exception as e:
            logger.error("Error stopping process reaper: %s", str(e))
        
        # Cleanup tracked spawned processes
        try:
            with _process_registry_lock:
                processes_to_cleanup = list(_spawned_processes.values())
                _spawned_processes.clear()
                
            for process in processes_to_cleanup:
                try:
                    if process.poll() is None:  # Still running
                        process.terminate()
                        try:
                            process.wait(timeout=2.0)
                            logger.info("Gracefully terminated Claude process: %d", process.pid)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
                            logger.info("Force killed Claude process: %d", process.pid)
                except Exception as e:
                    logger.warning("Error terminating Claude process: %s", str(e))
                    
        except Exception as e:
            logger.error("Error during tracked process cleanup: %s", str(e))
        
        # Cleanup any remaining spawned agent processes
        try:
            # Kill any orphaned Claude processes
            import psutil
            current_process = psutil.Process()
            children = current_process.children(recursive=True)
            for child in children:
                try:
                    child.terminate()
                    logger.info("Terminated child process: %d", child.pid)
                except Exception:
                    pass
        except Exception as e:
            logger.error("Error during process cleanup: %s", str(e))
        
        logger.info("Graceful shutdown completed")
        sys.exit(0)
    
    # Register handlers for common termination signals
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    if hasattr(signal, 'SIGHUP'):  # Not available on Windows
        signal.signal(signal.SIGHUP, signal_handler)
    
    logger.info("Signal handlers registered for graceful shutdown")


async def run_server_with_robust_error_handling() -> None:
    """
    Run the FastMCP server with comprehensive error handling for stream disconnections.
    
    This wrapper provides:
    1. Server-level exception handling for ClosedResourceError and BrokenResourceError
    2. Connection state monitoring and logging
    3. Graceful client disconnection handling
    4. Retry logic for transient connection issues
    5. Server continuation after client disconnections
    """
    max_consecutive_retries = 3
    current_retry = 0
    
    while True:
        try:
            # Log that we're starting the server
            # logger.info("Starting FastMCP server with robust error handling",
            #           retry_attempt=current_retry,
            #           max_retries=max_consecutive_retries)
            
            # Track connection establishment
            _connection_monitor.log_connection_established()
            
            # Reset retry counter on successful start
            current_retry = 0
            
            # Run the FastMCP server
            app.run()
            
            # If we reach here, the server exited normally
            # logger.info("FastMCP server exited normally")
            break
            
        except (ClosedResourceError, BrokenResourceError) as e:
            # Handle anyio stream errors gracefully
            error_type = type(e).__name__
            error_msg = str(e)
            
            # Log the disconnection
            _connection_monitor.log_connection_disconnected(error_type)
            
            # logger.warning("Client stream disconnection detected",
            #              error_type=error_type,
            #              error_message=error_msg[:200],
            #              connection_status=_connection_monitor.get_status())
            
            # Check if we should continue trying
            if not _connection_monitor.should_retry():
                logger.error("Too many consecutive connection failures, shutting down server",
                           connection_status=_connection_monitor.get_status())
                break
            
            # Implement exponential backoff for retries
            if current_retry < max_consecutive_retries:
                backoff_time = min(2 ** current_retry, 10)  # Max 10 seconds
                # logger.info("Attempting graceful recovery after stream error",
                #           retry_attempt=current_retry + 1,
                #           backoff_seconds=backoff_time)
                
                # Brief delay before retrying
                await asyncio.sleep(backoff_time)
                current_retry += 1
                continue
            else:
                logger.error("Maximum retry attempts reached for stream errors, shutting down",
                           max_retries=max_consecutive_retries)
                break
                
        except ConnectionResetError as e:
            # Handle connection reset errors
            _connection_monitor.log_connection_disconnected("ConnectionResetError")
            
            # logger.info("Connection reset by client - this is normal",
            #           error_message=str(e)[:100],
            #           connection_status=_connection_monitor.get_status())
            
            # Brief pause and continue
            await asyncio.sleep(1)
            continue
            
        except OSError as e:
            # Handle OS-level connection errors
            if "Broken pipe" in str(e) or "Connection reset" in str(e):
                _connection_monitor.log_connection_disconnected("OSError")
                # logger.info("OS-level connection error - client likely disconnected",
                #           error_message=str(e)[:100])
                await asyncio.sleep(1)
                continue
            else:
                # Other OS errors should be handled differently
                logger.error("OS error during server operation", error=str(e))
                raise
                
        except KeyboardInterrupt:
            logger.info("Server shutdown requested by user")
            break
            
        except Exception as e:
            # Handle all other exceptions
            error_type = type(e).__name__
            error_msg = str(e)
            
            logger.error("Unexpected server error",
                        error_type=error_type,
                        error_message=error_msg[:200],
                        connection_status=_connection_monitor.get_status())
            
            # For unexpected errors, we should probably break rather than retry
            # unless it's a known recoverable error type
            recoverable_errors = [
                "TimeoutError",
                "asyncio.TimeoutError", 
                "ConnectionAbortedError",
                "ConnectionError"
            ]
            
            if any(err in error_type for err in recoverable_errors):
                # logger.info("Recoverable error detected, attempting to continue",
                #           error_type=error_type)
                await asyncio.sleep(2)
                continue
            else:
                # Unknown error - break and let the main function handle it
                logger.error("Non-recoverable error, propagating to main handler")
                raise


def main():
    """Main entry point for the orchestration server."""
    startup_errors = []
    
    try:
        # Log startup configuration
        if config.get("logging.startup_logging", True):
            logger.info("Starting ClaudeMcpTools Orchestration Server",
                       config_path=str(config.config_path),
                       log_level=config.get("logging.level"),
                       verbose=config.get("logging.verbose"),
                       debug=config.get("logging.debug"))
        
        # Setup signal handlers for graceful shutdown
        _setup_signal_handlers()
        
        # Configure multiprocessing for clean process isolation
        import multiprocessing
        try:
            multiprocessing.set_start_method("spawn", force=True)
            logger.info("🔧 Multiprocessing configured with spawn method")
        except RuntimeError as e:
            logger.warning("⚠️ Multiprocessing start method already set", error=str(e))
        
        # Documentation scraping now uses ThreadPoolExecutor (no separate worker process needed)
        logger.info("📄 Documentation scraping configured with ThreadPoolExecutor")
        
        # Run startup diagnostics if enabled
        if config.get("server.startup_diagnostics", True):
            # Run diagnostics - create clean event loop for startup
            try:
                diagnostics_passed = asyncio.run(run_startup_diagnostics())
                if not diagnostics_passed:
                    logger.error("Startup diagnostics failed, continuing anyway...")
            except Exception as diag_error:
                logger.error("Startup diagnostics crashed: %s", str(diag_error))
                logger.error("Continuing with server startup anyway...")
        
        # Start the FastMCP server with comprehensive error handling for stream disconnections
        if config.get("logging.debug") or config.get("logging.verbose"):
            logger.info("Starting FastMCP server with robust stream error handling...")
            
        try:
            # Run the FastMCP server directly - let external process manager handle restarts
            app.run()
            
        except Exception as e:
            # This catches any remaining unhandled exceptions from the server wrapper
            error_type = type(e).__name__
            error_msg = str(e)
            
            logger.error("Server wrapper encountered unhandled exception",
                        error_type=error_type,
                        error_message=error_msg[:200],
                        connection_status=_connection_monitor.get_status())
            
            # Handle the runtime crash
            _handle_runtime_crash(e)
            sys.exit(1)
        
    except KeyboardInterrupt:
        logger.info("Server shutdown requested by user")
        sys.exit(0)
        
    except Exception as e:
        error_msg = f"Failed to start orchestration server: {str(e)}"
        startup_errors.append(error_msg)
        
        # Enhanced error reporting
        if config.get("server.error_buffering", True):
            logger.error("=== STARTUP ERROR DETAILS ===")
            logger.error("Error: %s", str(e))
            logger.error("Type: %s", type(e).__name__)
            
            # Show traceback if verbose/debug mode
            if config.get("logging.verbose") or config.get("logging.debug"):
                logger.error("Traceback:")
                for line in traceback.format_exc().splitlines():
                    logger.error("  %s", line)
            
            logger.error("=== END ERROR DETAILS ===")
            
        else:
            logger.error(error_msg, exc_info=True)
        
        # Provide helpful suggestions
        logger.error("Troubleshooting suggestions:")
        logger.error("1. Check that all dependencies are installed: uv sync")
        logger.error("2. Verify database permissions and connectivity")
        logger.error("3. Enable debug mode: edit ~/.mcptools/config.json")
        logger.error("4. Check for port conflicts or permission issues")
        
        sys.exit(1)

if __name__ == "__main__":
    main()
