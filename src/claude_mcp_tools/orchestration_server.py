"""Enhanced MCP server with modular orchestration layer for Claude Code."""

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any

import structlog
from mcp.types import PromptMessage, TextContent

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

# Initialize logger
logger = structlog.get_logger("orchestration")

# Import the shared app instance from tools
from .tools.app import app


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
        logger.error("Failed to setup dependency monitoring", agent_id=agent_id, error=str(e))
        return {"success": False, "error": str(e)}


# Register all tool modules with the FastMCP app
# Tools are now automatically registered when the tools package is imported above
logger.info("MCP tools automatically registered via imports")


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
    name="take_screenshot",
    description="Take a screenshot for debugging UI issues or documenting visual state",
    tags={"debugging", "documentation", "visual", "screenshot"},
)
async def take_screenshot() -> str:
    """Take a screenshot for debugging or documentation."""
    try:
        import platform
        import subprocess
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
        return f"Failed to take screenshot: {result.stderr}"

    except Exception as e:
        return f"Error taking screenshot: {e}"


# Initialize the server on startup
@app.tool(
    name="startup",
    description="Initialize the orchestration server and all subsystems",
    tags={"system", "initialization", "startup"},
)
async def startup() -> str:
    """Initialize the orchestration server."""
    try:
        # Initialize database
        await init_database()

        # Register all tools
        # Tools are already registered via imports

        # Initialize services
        logger.info("Orchestration server initialized successfully")
        return "🚀 ClaudeMcpTools Orchestration Server initialized successfully!"

    except Exception as e:
        logger.error("Failed to initialize orchestration server", error=str(e))
        return f"❌ Failed to initialize server: {e}"


@app.tool(
    name="shutdown",
    description="Gracefully shutdown the orchestration server and clean up resources",
    tags={"system", "shutdown", "cleanup"},
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
        logger.error("Error getting project analysis", repo_path=repo_path, error=str(e))
        return {"error": f"Failed to analyze project: {e}"}


@app.resource("agents://{agent_id}/status",
             name="Agent Status Information",
             description="Real-time status and progress of specific agents")
async def get_agent_status(agent_id: str) -> dict[str, Any]:
    """Expose agent status and progress as a readable resource."""
    try:
        from .services.agent_service import AgentService

        status = await AgentService.get_agent_by_id(agent_id)

        if not status:
            return {
                "agent_id": agent_id,
                "status": "not_found",
                "error": "Agent not found or not active",
            }

        # Enhance with real-time information
        return {
            "agent_id": agent_id,
            "status": status.get("status", "unknown"),
            "agent_type": status.get("agent_type", "unknown"),
            "created_at": status.get("created_at"),
            "last_activity": status.get("last_activity"),
            "current_task": status.get("current_task"),
            "progress": status.get("progress", {}),
            "dependencies": status.get("dependencies", []),
            "communication_room": status.get("room_name"),
            "error_count": status.get("error_count", 0),
            "last_error": status.get("last_error"),
        }

    except Exception as e:
        logger.error("Error getting agent status", agent_id=agent_id, error=str(e))
        return {"error": f"Failed to get agent status: {e}"}


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
        logger.error("Error getting active agents summary", error=str(e))
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
        logger.error("Error searching documentation", source=source_name, query=query, error=str(e))
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
        insights = await SharedMemoryService.get_insights(clean_path, limit=50)
        # Note: get_learning_entries method doesn't exist, using insights instead

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
        logger.error("Error getting memory insights", repo_path=repo_path, error=str(e))
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
        logger.error("Error getting task history", repo_path=repo_path, error=str(e))
        return {"error": f"Failed to get task history: {e}"}


@app.resource("fastmcp://context-logging",
             name="FastMCP Context Logging",
             description="Context and logging information for FastMCP operations")
async def get_context_logging() -> dict[str, Any]:
    """Provide FastMCP context and logging information."""
    try:
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
                "tools_registered": len(app._tools),
                "resources_registered": len(app._resources),
                "prompts_registered": len(app._prompts),
            },
        }
    except Exception as e:
        logger.error("Error getting FastMCP context logging", error=str(e))
        return {"error": f"Failed to get context logging: {e}"}


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
        logger.error("Error getting system health", error=str(e))
        return {"error": f"Failed to get system health: {e}"}


# Register all tools when the module is imported
# Tools are automatically registered via imports at module load time

# Auto-initialize on import
async def _auto_init():
    try:
        await init_database()
        logger.info("Auto-initialized orchestration server")
    except Exception as e:
        logger.error("Auto-initialization failed", error=str(e))

# Auto-initialization will be handled by the server when it starts

def main():
    """Main entry point for the orchestration server."""
    app.run()

if __name__ == "__main__":
    main()
