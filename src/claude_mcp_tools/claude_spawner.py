"""Synchronous Claude CLI spawning without circular import issues."""

import os
import subprocess
from pathlib import Path
from typing import Any, Generator

# Universal core tools available to all agents
UNIVERSAL_CORE_TOOLS = [
    # Native Claude tools
    "Task", "Bash", "Glob", "Grep", "LS", "Read", "Edit", "MultiEdit", "Write", 
    "WebFetch", "TodoRead", "TodoWrite", "WebSearch", "exit_plan_mode",
    
    # Universal MCP tools - Communication
    "mcp__claude-mcp-orchestration__join_room",
    "mcp__claude-mcp-orchestration__send_message",
    "mcp__claude-mcp-orchestration__get_messages",
    "mcp__claude-mcp-orchestration__wait_for_messages",
    
    # Universal MCP tools - Unified Memory System
    "mcp__claude-mcp-orchestration__store_memory",
    "mcp__claude-mcp-orchestration__search_memory",
    
    # Universal MCP tools - Documentation
    "mcp__claude-mcp-orchestration__search_documentation",
    
    # Universal MCP tools - File Operations
    "mcp__claude-mcp-orchestration__easy_replace",
    "mcp__claude-mcp-orchestration__easy_replace_all",
    "mcp__claude-mcp-orchestration__list_files",
    "mcp__claude-mcp-orchestration__find_files",
    
    # Universal MCP tools - Basic Analysis
    "mcp__claude-mcp-orchestration__analyze_project_structure",
    "mcp__claude-mcp-orchestration__generate_project_summary",
]

# Function-based agent tool profiles 
AGENT_TOOL_PROFILES = {
    "general-agent": {
        "allowed_tools": None,  # Full access to all tools
        "description": "General purpose agent with access to all tools for complex/undefined tasks"
    },
    "research-agent": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__scrape_documentation",
            "mcp__claude-mcp-orchestration__analyze_documentation_changes",
            "mcp__claude-mcp-orchestration__link_docs_to_code",
            "mcp__claude-mcp-orchestration__update_documentation",
        ],
        "description": "Information gathering, documentation research, and web scraping"
    },
    "bug-fixing-agent": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__detect_dead_code",
            "mcp__claude-mcp-orchestration__analyze_file_symbols",
            "mcp__claude-mcp-orchestration__get_error_patterns",
            "mcp__claude-mcp-orchestration__get_recent_errors",
            "mcp__claude-mcp-orchestration__resolve_error",
            "mcp__claude-mcp-orchestration__log_error",
        ],
        "description": "Debugging, error analysis, and issue resolution"
    },
    "implementation-agent": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__update_treesummary_incremental",
            "mcp__claude-mcp-orchestration__watch_project_changes",
        ],
        "description": "Feature development and code implementation"
    },
    "testing-agent": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__take_screenshot",
            "mcp__claude-mcp-orchestration__get_system_status",
            "mcp__claude-mcp-orchestration__cleanup_orphaned_projects",
        ],
        "description": "Quality assurance, testing, and validation"
    },
    "coordination-agent": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__spawn_agent",
            "mcp__claude-mcp-orchestration__spawn_agents_batch",
            "mcp__claude-mcp-orchestration__list_agents",
            "mcp__claude-mcp-orchestration__get_agent_status",
            "mcp__claude-mcp-orchestration__terminate_agent",
            "mcp__claude-mcp-orchestration__broadcast_message",
            "mcp__claude-mcp-orchestration__orchestrate_objective",
            "mcp__claude-mcp-orchestration__create_task",
            "mcp__claude-mcp-orchestration__assign_task",
            "mcp__claude-mcp-orchestration__list_tasks",
        ],
        "description": "Multi-agent orchestration and workflow management"
    },
    "documentation-agent": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__scrape_documentation",
            "mcp__claude-mcp-orchestration__update_documentation",
            "mcp__claude-mcp-orchestration__analyze_documentation_changes",
            "mcp__claude-mcp-orchestration__link_docs_to_code",
        ],
        "description": "Documentation creation and maintenance"
    },
    "analysis-agent": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__detect_dead_code",
            "mcp__claude-mcp-orchestration__analyze_file_symbols",
            "mcp__claude-mcp-orchestration__update_treesummary_incremental",
            "mcp__claude-mcp-orchestration__get_tool_call_history",
        ],
        "description": "Code analysis, metrics, and insights"
    },
    
    # Alternative agent names
    "analyzer": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__detect_dead_code",
            "mcp__claude-mcp-orchestration__analyze_file_symbols",
            "mcp__claude-mcp-orchestration__update_treesummary_incremental",
            "mcp__claude-mcp-orchestration__get_tool_call_history",
        ],
        "description": "Code analysis, metrics, and insights"
    },
    "implementer": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__update_treesummary_incremental",
            "mcp__claude-mcp-orchestration__watch_project_changes",
        ],
        "description": "Feature development and code implementation"
    },
    "reviewer": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__analyze_file_symbols",
        ],
        "description": "Code review focused agent"
    },
    "tester": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__take_screenshot",
            "mcp__claude-mcp-orchestration__get_system_status",
            "mcp__claude-mcp-orchestration__cleanup_orphaned_projects",
        ],
        "description": "Quality assurance, testing, and validation"
    },
    "coordinator": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__spawn_agent",
            "mcp__claude-mcp-orchestration__spawn_agents_batch",
            "mcp__claude-mcp-orchestration__list_agents",
            "mcp__claude-mcp-orchestration__get_agent_status",
            "mcp__claude-mcp-orchestration__terminate_agent",
            "mcp__claude-mcp-orchestration__broadcast_message",
            "mcp__claude-mcp-orchestration__orchestrate_objective",
        ],
        "description": "Multi-agent orchestration and workflow management"
    },
    "documentation": {
        "allowed_tools": UNIVERSAL_CORE_TOOLS + [
            "mcp__claude-mcp-orchestration__scrape_documentation",
            "mcp__claude-mcp-orchestration__update_documentation",
            "mcp__claude-mcp-orchestration__analyze_documentation_changes",
            "mcp__claude-mcp-orchestration__link_docs_to_code",
            "mcp__claude-mcp-orchestration__get_scraping_status",
            "mcp__claude-mcp-orchestration__watch_scraping_progress",
            "mcp__claude-mcp-orchestration__take_screenshot",
        ],
        "description": "Documentation creation, maintenance, and progress monitoring"
    },
    "master": {
        "allowed_tools": None,  # Full access
        "description": "Full tool access for orchestration"
    }
}


def get_agent_tool_profile(agent_type: str) -> dict[str, Any]:
    """Get predefined tool profile for agent type."""
    profile = AGENT_TOOL_PROFILES.get(agent_type.lower())
    if not profile:
        # Default to analyzer profile for unknown types
        return AGENT_TOOL_PROFILES["analyzer"]
    return profile


def spawn_claude_with_profile(
    workFolder: str,
    prompt: str,
    agent_type: str = "analyzer",
    session_id: str | None = None,
    model: str = "sonnet",
    custom_tools: list[str] | None = None,
    enable_logging: bool = False,
) -> dict[str, Any]:
    """Spawn Claude with predefined tool profile based on agent type."""
    profile = get_agent_tool_profile(agent_type)
    
    # Use custom tools if provided, otherwise use profile tools
    allowed_tools = custom_tools if custom_tools else profile["allowed_tools"]
    
    return spawn_claude_sync(
        workFolder=workFolder,
        prompt=prompt,
        session_id=session_id,
        model=model,
        allowed_tools=allowed_tools,
        disallowed_tools=None,
        max_concurrent=3,
        enable_logging=enable_logging
    )


def test_claude_command(
    workFolder: str,
    prompt: str,
    session_id: str | None = None,
    model: str = "sonnet",
) -> Generator[str, None, None]:
    """Test Claude CLI command with realtime output."""
    try:
        # Ensure workFolder exists
        Path(workFolder).mkdir(parents=True, exist_ok=True)
        
        # Build claude command
        cmd = [
            "claude",
            "--dangerously-skip-permissions",
            "--model", model,
            "-p",
        ]
        
        if session_id:
            cmd.extend(["--session-id", session_id])
        
        # Add prompt at the end
        cmd.append(prompt)
        
        # Set up environment
        env = os.environ.copy()
        
        # Start the process with realtime output
        process = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=workFolder,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        # Read output in real-time
        while True:
            output = process.stdout.readline()
            if output == '' and process.poll() is not None:
                break
            if output:
                yield output.strip()
        
        # Check for errors
        if process.returncode != 0:
            stderr_output = process.stderr.read()
            if stderr_output:
                yield f"ERROR: {stderr_output}"
        
    except Exception as e:
        yield f"EXCEPTION: {str(e)}"


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
    """Spawn Claude CLI directly with bypassed permissions - no file logging."""
    try:
        # Ensure workFolder exists
        Path(workFolder).mkdir(parents=True, exist_ok=True)
        
        # Build claude command
        cmd = [
            "claude",
            "--dangerously-skip-permissions",
            "--model", model,
        ]
        
        if session_id:
            cmd.extend(["--session-id", session_id])
        
        # Add tool filtering if specified (correct format per Claude CLI docs)
        if allowed_tools:
            cmd.append("--allowedTools")
            # Add each tool as a separate argument (no quotes needed in subprocess)
            cmd.extend(allowed_tools)
        
        if disallowed_tools:
            cmd.append("--disallowedTools")
            # Add each tool as a separate argument (no quotes needed in subprocess)
            cmd.extend(disallowed_tools)
        
        # Add prompt with -p flag
        cmd.extend(["-p", prompt])
        
        # Set up environment (preserve parent environment)
        env = os.environ.copy()
        
        # Start the process with pipes for real-time monitoring
        process = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=workFolder,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        # Setup logging if enabled
        log_file_path = None
        if enable_logging:
            import datetime
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            log_file_path = f"/tmp/claude_agent_{process.pid}_{timestamp}.log"
        
        # Return immediately with process object for monitoring
        return {
            "success": True,
            "pid": process.pid,
            "command": cmd,
            "working_directory": workFolder,
            "process": process,  # Return process object for real-time monitoring
            "log_file_path": log_file_path,
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to spawn Claude CLI: {str(e)}",
            "pid": None,
        }


def monitor_agent_output(process: subprocess.Popen, log_file_path: str | None = None) -> Generator[str, None, None]:
    """Monitor agent output in real-time with optional logging to file."""
    import structlog
    logger = structlog.get_logger("claude_spawner")
    
    try:
        log_file = None
        if log_file_path:
            try:
                log_file = open(log_file_path, 'w')
                logger.info(f"Agent output logging to: {log_file_path}")
            except Exception as e:
                logger.warning(f"Failed to open log file {log_file_path}: {e}")
        
        import time
        start_time = time.time()
        timeout = 300  # 5 minute timeout for monitoring
        
        while True:
            # Check for timeout to prevent hanging
            if time.time() - start_time > timeout:
                logger.warning(f"Monitor timeout after {timeout}s, terminating process {process.pid}")
                try:
                    process.terminate()
                    process.wait(timeout=10)  # Wait up to 10s for graceful termination
                except Exception:
                    try:
                        process.kill()  # Force kill if terminate fails
                    except Exception:
                        pass
                yield f"MONITOR_TIMEOUT: Process monitoring timed out after {timeout}s"
                break
            
            output = process.stdout.readline()
            if output == '' and process.poll() is not None:
                break
            if output:
                output_line = output.strip()
                yield output_line
                
                # Log to file if available
                if log_file:
                    try:
                        log_file.write(f"{output_line}\n")
                        log_file.flush()
                    except Exception as file_error:
                        logger.warning(f"Failed to write to log file: {file_error}")
                
                # Log important messages
                if any(keyword in output_line.lower() for keyword in ['error', 'exception', 'failed', 'crash']):
                    logger.error(f"Agent error output: {output_line}")
                elif any(keyword in output_line.lower() for keyword in ['completed', 'finished', 'done']):
                    logger.info(f"Agent completion: {output_line}")
            
            # Small delay to prevent busy waiting
            time.sleep(0.01)
        
        # Check for errors
        if process.returncode != 0:
            stderr_output = process.stderr.read()
            if stderr_output:
                error_msg = f"ERROR: {stderr_output}"
                yield error_msg
                logger.error(f"Agent stderr: {stderr_output}")
                if log_file:
                    log_file.write(f"{error_msg}\n")
        
        # Log final status
        logger.info(f"Agent process finished with return code: {process.returncode}")
        if log_file:
            try:
                log_file.write(f"PROCESS_FINISHED: return_code={process.returncode}\n")
            except Exception:
                pass
                
    except Exception as e:
        error_msg = f"MONITOR_EXCEPTION: {str(e)}"
        yield error_msg
        logger.error(f"Monitor exception: {str(e)}", exc_info=True)
        
        # Try to cleanup the process if it's still running
        try:
            if process.poll() is None:  # Process still running
                logger.warning("Terminating orphaned process due to monitor exception")
                process.terminate()
                process.wait(timeout=5)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
    
    finally:
        # Ensure log file is always closed
        if log_file:
            try:
                log_file.close()
            except Exception:
                pass