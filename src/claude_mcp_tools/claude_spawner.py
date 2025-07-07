"""Simplified Claude CLI spawning - working version."""

import os
import subprocess
from pathlib import Path
from typing import Any

def spawn_claude_sync(
    workFolder: str, 
    prompt: str, 
    session_id: str | None = None, 
    model: str = "sonnet",
    allowed_tools: list[str] | None = None,
    disallowed_tools: list[str] | None = None,
    max_concurrent: int = 3,
    enable_logging: bool = False,
) -> dict[str, Any]:
    """
    Simple Claude spawning function based on working 6ff2fb4 version.
    Fire-and-forget approach with basic subprocess.Popen and log files.
    
    Args:
        workFolder: Working directory for Claude
        prompt: Prompt to send to Claude
        session_id: Session ID (kept for compatibility, not used)
        model: Model to use (default: sonnet)
        allowed_tools: List of allowed tools to pass to Claude CLI
        disallowed_tools: List of disallowed tools to pass to Claude CLI
        max_concurrent: Max concurrent processes (not used in simple version)
        enable_logging: Whether to enable logging (always enabled in simple version)
    """
    try:
        # Ensure workFolder exists
        Path(workFolder).mkdir(parents=True, exist_ok=True)
        
        # Build basic claude command
        cmd = [
            "claude",
            "--dangerously-skip-permissions",
            "--model", model,
            "-p", prompt
        ]
        
        # Add tool restrictions if specified
        if allowed_tools:
            # Claude CLI expects comma or space-separated list of tool names
            tools_str = " ".join(allowed_tools)
            cmd.extend(["--allowedTools", tools_str])
        
        if disallowed_tools:
            # Claude CLI expects comma or space-separated list of tool names
            tools_str = " ".join(disallowed_tools)
            cmd.extend(["--disallowedTools", tools_str])
        
        # Note: Claude CLI doesn't support --session-id flag in current version
        # if session_id:
        #     cmd.extend(["--session-id", session_id])
        
        # Set up log file paths
        import datetime
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Create log directory
        log_dir = Path.home() / ".mcptools" / "agents" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        
        # Create log file paths
        stdout_log = log_dir / f"claude_stdout_{timestamp}.log"
        stderr_log = log_dir / f"claude_stderr_{timestamp}.log"
        
        # Open log files
        stdout_file = open(stdout_log, 'w')
        stderr_file = open(stderr_log, 'w')
        
        # Set up environment with startup overhead disabled for sub-processes
        env = os.environ.copy()
        env.update({
            # Skip startup diagnostics for sub-processes to prevent hangs
            "MCPTOOLS_SERVER_STARTUP_DIAGNOSTICS": "false",
            # Skip documentation bootstrap for sub-processes
            "MCPTOOLS_DOCUMENTATION_AUTO_BOOTSTRAP": "false",
            "MCPTOOLS_DOCUMENTATION_BOOTSTRAP_ON_STARTUP": "false",
            # Disable health checks for faster startup
            "MCPTOOLS_SERVER_HEALTH_CHECKS": "false",
        })
        
        # Start the process with log file redirection and optimized environment
        process = subprocess.Popen(
            cmd,
            cwd=workFolder,
            stdout=stdout_file,
            stderr=stderr_file,
            env=env,
            text=True
        )
        
        # Return immediately (fire-and-forget)
        return {
            "success": True,
            "pid": process.pid,
            "command": " ".join(cmd),
            "working_directory": workFolder,
            "stdout_log": str(stdout_log),
            "stderr_log": str(stderr_log),
            "session_id": session_id,  # Note: Not actually passed to CLI
            "model": model,
            "process": process,  # Include process for compatibility
            "log_file_path": str(stdout_log),  # For compatibility
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to spawn Claude CLI: {str(e)}",
            "pid": None
        }


def spawn_claude_with_profile(
    workFolder: str,
    prompt: str,
    agent_type: str = "analyzer",
    session_id: str | None = None,
    model: str = "sonnet",
    custom_tools: list[str] | None = None,
    enable_logging: bool = False,
) -> dict[str, Any]:
    """Spawn Claude with predefined tool profile based on agent type.
    
    This is a compatibility function that calls spawn_claude_sync.
    Tool profiles are not implemented in the simplified version.
    """
    return spawn_claude_sync(
        workFolder=workFolder,
        prompt=prompt,
        session_id=session_id,
        model=model,
        allowed_tools=custom_tools,
        enable_logging=enable_logging
    )


def get_agent_tool_profile(agent_type: str) -> dict[str, Any]:
    """Get predefined tool profile for agent type.
    
    Simplified version returns basic profile for all agent types.
    """
    return {
        "allowed_tools": None,  # Full access in simplified version
        "description": f"Simplified agent profile for {agent_type}"
    }


def get_process_status(pid: int) -> dict[str, Any]:
    """Check if a process is still running."""
    try:
        import psutil
        if psutil.pid_exists(pid):
            process = psutil.Process(pid)
            return {
                "running": True,
                "status": process.status(),
                "cpu_percent": process.cpu_percent(),
                "memory_info": process.memory_info()._asdict() if hasattr(process.memory_info(), '_asdict') else None
            }
        else:
            return {"running": False}
    except ImportError:
        # Fallback if psutil not available
        try:
            os.kill(pid, 0)  # Send signal 0 to check if process exists
            return {"running": True, "status": "unknown"}
        except OSError:
            return {"running": False}
    except Exception as e:
        return {"running": False, "error": str(e)}


def read_log_file(log_path: str, lines: int = 50) -> str:
    """Read the last N lines from a log file."""
    try:
        with open(log_path, 'r') as f:
            all_lines = f.readlines()
            return ''.join(all_lines[-lines:])
    except Exception as e:
        return f"Error reading log file: {str(e)}"


def kill_process(pid: int) -> dict[str, Any]:
    """Terminate a process by PID."""
    try:
        import signal
        os.kill(pid, signal.SIGTERM)
        return {"success": True, "message": f"Sent SIGTERM to process {pid}"}
    except Exception as e:
        try:
            os.kill(pid, signal.SIGKILL)
            return {"success": True, "message": f"Sent SIGKILL to process {pid}"}
        except Exception as e2:
            return {"success": False, "error": f"Failed to kill process {pid}: {str(e2)}"}


# Legacy compatibility functions (these existed in the complex version)
def test_claude_command(
    workFolder: str,
    prompt: str,
    session_id: str | None = None,
    model: str = "sonnet",
):
    """Test Claude CLI command - simplified version just calls spawn_claude_sync."""
    result = spawn_claude_sync(workFolder, prompt, session_id, model)
    if result["success"]:
        yield f"Process started with PID: {result['pid']}"
        yield f"Command: {result['command']}"
        yield f"Logs: {result['stdout_log']}"
    else:
        yield f"Error: {result['error']}"


def monitor_agent_output(process: subprocess.Popen, log_file_path: str | None = None):
    """Monitor agent output - simplified version just yields basic info."""
    yield f"Monitoring process {process.pid}"
    if log_file_path:
        yield f"Logs available at: {log_file_path}"
    yield "Monitor completed"


# Example usage
if __name__ == "__main__":
    # Simple test
    result = spawn_claude_sync(
        workFolder="/tmp/test_claude",
        prompt="List files in current directory",
        session_id="test-session",
        model="sonnet"
    )
    
    if result["success"]:
        print(f"✅ Spawned Claude process with PID: {result['pid']}")
        print(f"📁 Working directory: {result['working_directory']}")
        print(f"📄 Stdout log: {result['stdout_log']}")
        print(f"📄 Stderr log: {result['stderr_log']}")
        
        # Check status after a moment
        import time
        time.sleep(2)
        status = get_process_status(result["pid"])
        print(f"🔍 Process status: {status}")
        
    else:
        print(f"❌ Failed to spawn Claude: {result['error']}")