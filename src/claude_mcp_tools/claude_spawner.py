"""Synchronous Claude CLI spawning without circular import issues."""

import os
import subprocess
from pathlib import Path
from typing import Any


def spawn_claude_sync(
    workFolder: str,
    prompt: str,
    session_id: str | None = None,
    model: str = "sonnet",
) -> dict[str, Any]:
    """Spawn Claude CLI directly with bypassed permissions (inspired by claude-code-mcp)."""
    try:
        # Ensure workFolder exists
        Path(workFolder).mkdir(parents=True, exist_ok=True)
        
        # Build claude command (inspired by claude-code-mcp)
        cmd = [
            "claude",
            "--dangerously-skip-permissions",
            "--model", model,
            "--prompt", prompt,
        ]
        
        if session_id:
            cmd.extend(["--session-id", session_id])
        
        # Set up environment (preserve parent environment)
        env = os.environ.copy()
        
        # Create log files for agent output
        stdout_log = Path(workFolder) / f"agent_stdout_{os.getpid()}.log"
        stderr_log = Path(workFolder) / f"agent_stderr_{os.getpid()}.log"
        
        # Start the process with output redirected to log files
        with open(stdout_log, "w") as stdout_file, open(stderr_log, "w") as stderr_file:
            process = subprocess.Popen(
                cmd,
                env=env,
                stdout=stdout_file,
                stderr=stderr_file,
                cwd=workFolder,
            )
        
        # Return immediately with PID (fire-and-forget)
        return {
            "success": True,
            "pid": process.pid,
            "command": cmd,
            "working_directory": workFolder,
            "stdout_log": str(stdout_log),
            "stderr_log": str(stderr_log),
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to spawn Claude CLI: {str(e)}",
            "pid": None,
        }