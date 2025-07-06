"""Modern CLI for ClaudeMcpTools using Typer + Rich."""

import os
import subprocess
from enum import Enum
from pathlib import Path
from typing import Any

import typer
from rich.console import Console
from rich.panel import Panel
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn
from rich.prompt import Confirm, IntPrompt, Prompt
from rich.table import Table

# Initialize console and app
console = Console()
app = typer.Typer(
    name="claude-mcp-tools",
    help="🚀 ClaudeMcpTools - Enhanced MCP Tools for Claude Code",
    rich_markup_mode="rich",
    add_completion=False,
)

# Installation configuration
class InstallLocation(str, Enum):
    DEDICATED = "dedicated"   # ~/.mcptools/ (new default)
    CLAUDE_SUBDIR = "claude"  # ~/.claude/mcptools/ (legacy)
    CUSTOM = "custom"        # User-specified path

class InstallType(str, Enum):
    FULL = "full"            # Global + project setup
    GLOBAL_ONLY = "global"   # Global installation only
    PROJECT_ONLY = "project" # Project permissions only
    CUSTOM = "custom"        # User chooses components

class PermissionLevel(str, Enum):
    ALLOW_ALL = "allow_all"    # All tools enabled
    SELECTIVE = "selective"    # User chooses categories
    MINIMAL = "minimal"       # Basic tools only

class HookScope(str, Enum):
    PROJECT = "project"      # ./.claude/hooks/
    GLOBAL = "global"        # ~/.claude/hooks/
    BOTH = "both"           # Both project and global
    SKIP = "skip"           # No hooks

# Default paths
def get_install_dir(location: InstallLocation = InstallLocation.DEDICATED, custom_path: Path | None = None) -> Path:
    """Get installation directory based on location choice."""
    if location == InstallLocation.DEDICATED:
        return Path.home() / ".mcptools"
    elif location == InstallLocation.CLAUDE_SUBDIR:
        return Path.home() / ".claude" / "mcptools"
    elif location == InstallLocation.CUSTOM and custom_path:
        return custom_path
    else:
        return Path.home() / ".mcptools"  # fallback to new default


def find_package_hooks_dir(verbose: bool = False) -> Path | None:
    """Find the hooks directory in the UV tool installation for claude-mcp-tools.
    
    Args:
        verbose: If True, print debugging information about the search
    
    Returns:
        Path to the hooks directory in the UV tool installation, or None if not found.
    """
    if verbose:
        console.print("🔍 [blue]Searching for ClaudeMcpTools hooks...[/blue]")
    
    # Multiple possible locations to check
    search_locations = []
    
    try:
        # Method 1: Check UV tool directory
        uv_tools_dir = subprocess.run(
            ["uv", "tool", "dir"], 
            capture_output=True, 
            text=True, 
            check=True
        ).stdout.strip()
        
        if verbose:
            console.print(f"   UV tools directory: {uv_tools_dir}")
        
        # Check various possible locations within UV tools directory
        claude_tool_dir = Path(uv_tools_dir) / "claude-mcp-tools"
        search_locations.extend([
            claude_tool_dir / "hooks",
            claude_tool_dir / "src" / "claude_mcp_tools" / "hooks",
            claude_tool_dir / "lib" / "python3.12" / "site-packages" / "claude_mcp_tools" / "hooks",
            claude_tool_dir / "pyvenv.cfg" / ".." / "hooks",  # Sometimes relative to venv
        ])
        
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        if verbose:
            console.print(f"   ⚠️ UV tool dir command failed: {e}")
    
    # Method 2: Check current source directory (if we're in development)
    current_dir = Path.cwd()
    search_locations.extend([
        current_dir / "hooks",
        current_dir / "src" / "claude_mcp_tools" / "hooks",
    ])
    
    # Method 3: Check common system locations
    search_locations.extend([
        Path.home() / ".local" / "share" / "claude-mcp-tools" / "hooks",
        Path("/opt/claude-mcp-tools/hooks"),
        Path("/usr/local/share/claude-mcp-tools/hooks"),
    ])
    
    # Search all locations
    for location in search_locations:
        try:
            resolved_location = location.resolve()
            if verbose:
                console.print(f"   Checking: {resolved_location}")
            
            if resolved_location.exists() and resolved_location.is_dir():
                # Check if it contains hook files
                hook_files = list(resolved_location.glob("*.sh"))
                if hook_files:
                    if verbose:
                        console.print(f"   ✅ Found hooks at: {resolved_location}")
                        console.print(f"      Hook files: {[f.name for f in hook_files]}")
                    return resolved_location
                elif verbose:
                    console.print(f"   📁 Directory exists but no .sh files found")
            elif verbose:
                console.print(f"   ❌ Not found or not a directory")
                
        except Exception as e:
            if verbose:
                console.print(f"   ⚠️ Error checking {location}: {e}")
    
    if verbose:
        console.print("   ❌ No hooks directory found in any search location")
    
    return None

# Default constants (can be overridden)
INSTALL_DIR = get_install_dir()
DATA_DIR = Path.home() / ".mcptools" / "data"  # Move data out of .claude
BIN_DIR = Path.home() / ".local" / "bin"


# Permission categories for modular selection
PERMISSION_CATEGORIES = {
    "agents": {
        "name": "🤖 Agent Orchestration",
        "description": "Spawn and manage AI agents",
        "tools": [
            "mcp__claude-mcp-orchestration__spawn_agent",
            "mcp__claude-mcp-orchestration__spawn_agents_batch",
            "mcp__claude-mcp-orchestration__list_agents",
            "mcp__claude-mcp-orchestration__get_agent_status",
            "mcp__claude-mcp-orchestration__terminate_agent",
            "mcp__claude-mcp-orchestration__orchestrate_objective",
        ]
    },
    "analysis": {
        "name": "📊 Project Analysis",
        "description": "Analyze project structure and code",
        "tools": [
            "mcp__claude-mcp-orchestration__analyze_project_structure",
            "mcp__claude-mcp-orchestration__generate_project_summary",
            "mcp__claude-mcp-orchestration__analyze_file_symbols",
        ]
    },
    "documentation": {
        "name": "📚 Documentation Tools",
        "description": "Scrape and search documentation",
        "tools": [
            "mcp__claude-mcp-orchestration__scrape_documentation",
            "mcp__claude-mcp-orchestration__search_documentation",
            "mcp__claude-mcp-orchestration__update_documentation",
            "mcp__claude-mcp-orchestration__analyze_documentation_changes",
            "mcp__claude-mcp-orchestration__link_docs_to_code",
            "mcp__claude-mcp-orchestration__get_scraping_status",
            "mcp__claude-mcp-orchestration__watch_scraping_progress",
        ]
    },
    "tasks": {
        "name": "📋 Task Management",
        "description": "Create and manage development tasks",
        "tools": [
            "mcp__claude-mcp-orchestration__create_task",
            "mcp__claude-mcp-orchestration__assign_task",
            "mcp__claude-mcp-orchestration__get_task_status",
            "mcp__claude-mcp-orchestration__list_tasks",
            "mcp__claude-mcp-orchestration__create_task_batch",
            "mcp__claude-mcp-orchestration__create_workflow",
            "mcp__claude-mcp-orchestration__split_task",
            "mcp__claude-mcp-orchestration__assign_tasks_bulk",
            "mcp__claude-mcp-orchestration__auto_assign_tasks",
            "mcp__claude-mcp-orchestration__auto_assign_tasks_parallel",
            "mcp__claude-mcp-orchestration__balance_workload",
        ]
    },
    "communication": {
        "name": "💬 Agent Communication",
        "description": "Agent-to-agent messaging and coordination",
        "tools": [
            "mcp__claude-mcp-orchestration__join_room",
            "mcp__claude-mcp-orchestration__leave_room",
            "mcp__claude-mcp-orchestration__send_message",
            "mcp__claude-mcp-orchestration__broadcast_message",
            "mcp__claude-mcp-orchestration__get_messages",
            "mcp__claude-mcp-orchestration__wait_for_messages",
        ]
    },
    "memory": {
        "name": "🧠 Shared Memory & Learning",
        "description": "Cross-agent memory and insights",
        "tools": [
            "mcp__claude-mcp-orchestration__store_memory",
            "mcp__claude-mcp-orchestration__search_memory",
            "mcp__claude-mcp-orchestration__log_tool_call",
            "mcp__claude-mcp-orchestration__get_tool_call_history",
            "mcp__claude-mcp-orchestration__log_error",
            "mcp__claude-mcp-orchestration__get_recent_errors",
            "mcp__claude-mcp-orchestration__resolve_error",
            "mcp__claude-mcp-orchestration__get_error_patterns",
        ]
    },
    "files": {
        "name": "📁 File Operations",
        "description": "Enhanced file and system operations",
        "tools": [
            "mcp__claude-mcp-orchestration__list_files",
            "mcp__claude-mcp-orchestration__find_files",
            "mcp__claude-mcp-orchestration__easy_replace",
            "mcp__claude-mcp-orchestration__cleanup_orphaned_projects",
            "mcp__claude-mcp-orchestration__update_treesummary_incremental",
            "mcp__claude-mcp-orchestration__watch_project_changes",
            "mcp__claude-mcp-orchestration__get_system_status",
        ]
    }
}

# Minimal tools (always included)
MINIMAL_TOOLS = [
    "mcp__claude-mcp-orchestration__list_files",
    "mcp__claude-mcp-orchestration__find_files",
    "mcp__claude-mcp-orchestration__easy_replace",
    "mcp__claude-mcp-orchestration__get_system_status",
]

def check_prerequisites() -> bool:
    """Check if required tools are installed."""
    missing = []

    if not subprocess.run(["which", "uv"], capture_output=True).returncode == 0:
        missing.append("uv (https://astral.sh/uv/)")

    if not subprocess.run(["which", "claude"], capture_output=True).returncode == 0:
        missing.append("claude CLI (https://docs.anthropic.com/en/docs/claude-code)")

    if not subprocess.run(["which", "jq"], capture_output=True).returncode == 0:
        missing.append("jq (sudo apt install jq / brew install jq) - Required for hooks")

    if missing:
        console.print("❌ [red]Missing prerequisites:[/red]")
        for tool in missing:
            console.print(f"   • {tool}")
        return False

    return True


def prompt_install_location(non_interactive: bool = False) -> tuple[InstallLocation, Path | None]:
    """Prompt user for installation location choice."""
    if non_interactive:
        return InstallLocation.DEDICATED, None
    
    console.print("\n📍 [bold]Choose Installation Location:[/bold]")
    
    table = Table()
    table.add_column("Option", style="cyan")
    table.add_column("Location", style="blue")
    table.add_column("Description", style="white")
    
    table.add_row("1", "~/.mcptools/", "Dedicated directory, fully separated (recommended)")
    table.add_row("2", "~/.claude/mcptools/", "Within Claude ecosystem (legacy)")
    table.add_row("3", "[custom path]", "Specify your own installation directory")
    
    console.print(table)
    
    choice = IntPrompt.ask(
        "\nEnter your choice",
        choices=["1", "2", "3"],
        default=1
    )
    
    if choice == 1:
        return InstallLocation.DEDICATED, None
    elif choice == 2:
        return InstallLocation.CLAUDE_SUBDIR, None
    else:
        custom_path = Prompt.ask("Enter custom installation path", default=str(Path.home() / ".mcptools"))
        return InstallLocation.CUSTOM, Path(custom_path).expanduser()


def prompt_install_type(non_interactive: bool = False) -> InstallType:
    """Prompt user for installation type."""
    if non_interactive:
        return InstallType.FULL
    
    console.print("\n🚀 [bold]Choose Installation Type:[/bold]")
    
    table = Table()
    table.add_column("Option", style="cyan")
    table.add_column("Type", style="green")
    table.add_column("Description", style="white")
    
    table.add_row("1", "Full Setup", "Global installation + current project setup (recommended)")
    table.add_row("2", "Global Only", "Install globally, skip project-specific setup")
    table.add_row("3", "Project Only", "Setup current project permissions only")
    table.add_row("4", "Custom", "Choose individual components to install")
    
    console.print(table)
    
    choice = IntPrompt.ask(
        "\nEnter your choice",
        choices=["1", "2", "3", "4"],
        default=1
    )
    
    return [InstallType.FULL, InstallType.GLOBAL_ONLY, InstallType.PROJECT_ONLY, InstallType.CUSTOM][choice - 1]


def prompt_permission_level(non_interactive: bool = False, allow_all: bool = False, minimal: bool = False) -> PermissionLevel:
    """Prompt user for permission level."""
    if non_interactive or allow_all:
        return PermissionLevel.ALLOW_ALL
    if minimal:
        return PermissionLevel.MINIMAL
    
    console.print("\n🔒 [bold]Choose Permission Level:[/bold]")
    
    table = Table()
    table.add_column("Option", style="cyan")
    table.add_column("Level", style="yellow")
    table.add_column("Description", style="white")
    
    table.add_row("1", "Allow All", "Enable all ClaudeMcpTools (recommended for development)")
    table.add_row("2", "Selective", "Choose which tool categories to enable")
    table.add_row("3", "Minimal", "Only basic file operations and system tools")
    
    console.print(table)
    
    choice = IntPrompt.ask(
        "\nEnter your choice",
        choices=["1", "2", "3"],
        default=1
    )
    
    return [PermissionLevel.ALLOW_ALL, PermissionLevel.SELECTIVE, PermissionLevel.MINIMAL][choice - 1]


def prompt_permission_categories() -> list[str]:
    """Prompt user to select which permission categories to enable."""
    console.print("\n📊 [bold]Select Tool Categories:[/bold]")
    console.print("[dim]Choose which categories of tools to enable (space-separated numbers, or 'all')[/dim]\n")
    
    table = Table()
    table.add_column("#", style="cyan")
    table.add_column("Category", style="green")
    table.add_column("Description", style="white")
    table.add_column("Tools", style="blue")
    
    categories = list(PERMISSION_CATEGORIES.keys())
    for i, (key, info) in enumerate(PERMISSION_CATEGORIES.items(), 1):
        table.add_row(str(i), info["name"], info["description"], str(len(info["tools"])))
    
    console.print(table)
    
    choice = Prompt.ask(
        "\nEnter category numbers (e.g., '1 3 5' or 'all')",
        default="all"
    )
    
    if choice.lower() == "all":
        return categories
    
    try:
        selected_nums = [int(x.strip()) for x in choice.split()]
        selected_categories = []
        for num in selected_nums:
            if 1 <= num <= len(categories):
                selected_categories.append(categories[num - 1])
        return selected_categories
    except ValueError:
        console.print("[red]Invalid input, using all categories[/red]")
        return categories


def prompt_hook_scope(non_interactive: bool = False, no_hooks: bool = False) -> HookScope:
    """Prompt user for hook installation scope."""
    if no_hooks:
        return HookScope.SKIP
    if non_interactive:
        return HookScope.PROJECT
    
    console.print("\n🪝 [bold]Choose Hook Installation:[/bold]")
    console.print("[dim]Hooks allow automatic tool execution on certain events[/dim]\n")
    
    table = Table()
    table.add_column("Option", style="cyan")
    table.add_column("Scope", style="magenta")
    table.add_column("Description", style="white")
    
    table.add_row("1", "Project Only", "Install hooks for this project (./.claude/hooks/)")
    table.add_row("2", "Global", "Install hooks for all Claude projects (~/.claude/hooks/)")
    table.add_row("3", "Both", "Install hooks both globally and for this project")
    table.add_row("4", "Skip", "Don't install any hooks")
    
    console.print(table)
    
    choice = IntPrompt.ask(
        "\nEnter your choice",
        choices=["1", "2", "3", "4"],
        default=1
    )
    
    return [HookScope.PROJECT, HookScope.GLOBAL, HookScope.BOTH, HookScope.SKIP][choice - 1]


def safely_merge_claude_settings(existing_settings: dict[str, Any], new_settings: dict[str, Any]) -> dict[str, Any]:
    """Safely merge settings, only adding new tools without overwriting existing configuration.
    
    Args:
        existing_settings: Current Claude Code settings
        new_settings: ClaudeMcpTools settings to add
    
    Returns:
        Merged settings that preserve existing configuration
    """
    import copy
    result = copy.deepcopy(existing_settings)
    
    # Merge mcpServers - add our servers but preserve existing ones
    if "mcpServers" in new_settings:
        if "mcpServers" not in result:
            result["mcpServers"] = {}
        
        for server_name, server_config in new_settings["mcpServers"].items():
            if server_name not in result["mcpServers"]:
                # Server doesn't exist, add it completely
                result["mcpServers"][server_name] = server_config
            else:
                # Server exists, merge allowedTools without overwriting other settings
                existing_server = result["mcpServers"][server_name]
                if "allowedTools" in server_config:
                    if "allowedTools" not in existing_server:
                        existing_server["allowedTools"] = []
                    
                    # Add our tools to existing tools (union)
                    existing_tools = set(existing_server["allowedTools"])
                    new_tools = set(server_config["allowedTools"])
                    existing_server["allowedTools"] = list(existing_tools | new_tools)
                
                # Add other server properties if they don't exist
                for key, value in server_config.items():
                    if key != "allowedTools" and key not in existing_server:
                        existing_server[key] = value
    
    # Merge tools - only add missing tools, don't override existing tool settings
    if "tools" in new_settings:
        if "tools" not in result:
            result["tools"] = {}
        
        for tool_name, tool_config in new_settings["tools"].items():
            if tool_name not in result["tools"]:
                result["tools"][tool_name] = tool_config
    
    # Special handling for hooks - merge arrays without duplicating
    if "hooks" in new_settings:
        if "hooks" not in result:
            result["hooks"] = {}
        
        for hook_type, hook_configs in new_settings["hooks"].items():
            if hook_type not in result["hooks"]:
                result["hooks"][hook_type] = hook_configs.copy()
            else:
                # Merge hook configurations, avoiding duplicates
                existing_hooks = result["hooks"][hook_type]
                for hook_config in hook_configs:
                    # Check if this hook already exists (by matcher and command)
                    hook_exists = any(
                        existing.get("matcher") == hook_config.get("matcher") and
                        any(h.get("command") == hc.get("command") 
                            for h in existing.get("hooks", [])
                            for hc in hook_config.get("hooks", []))
                        for existing in existing_hooks
                    )
                    if not hook_exists:
                        existing_hooks.append(hook_config)
    
    # Merge permissions - handle both permissions.allow array and other permission settings
    if "permissions" in new_settings:
        if "permissions" not in result:
            result["permissions"] = {}
        
        for perm_key, perm_value in new_settings["permissions"].items():
            if perm_key == "allow" and isinstance(perm_value, list):
                # Merge permission arrays using sets for deduplication
                if "allow" not in result["permissions"]:
                    result["permissions"]["allow"] = []
                
                existing_perms = set(result["permissions"]["allow"])
                new_perms = set(perm_value)
                result["permissions"]["allow"] = list(existing_perms | new_perms)
            elif perm_key not in result["permissions"]:
                # Add other permission settings if they don't exist
                result["permissions"][perm_key] = perm_value
    
    # For other sections, only add if they don't exist
    for section_name, section_config in new_settings.items():
        if section_name not in ["mcpServers", "tools", "hooks", "permissions"] and section_name not in result:
            result[section_name] = section_config
    
    return result


def build_permission_settings(permission_level: PermissionLevel, selected_categories: list[str] | None = None) -> dict[str, Any]:
    """Build permission settings based on user choices."""
    if permission_level == PermissionLevel.MINIMAL:
        allowed_tools = MINIMAL_TOOLS.copy()
    elif permission_level == PermissionLevel.ALLOW_ALL:
        allowed_tools = []
        for category_info in PERMISSION_CATEGORIES.values():
            allowed_tools.extend(category_info["tools"])
    else:  # SELECTIVE
        allowed_tools = MINIMAL_TOOLS.copy()  # Always include minimal tools
        if selected_categories:
            for category in selected_categories:
                if category in PERMISSION_CATEGORIES:
                    allowed_tools.extend(PERMISSION_CATEGORIES[category]["tools"])
    
    # Remove duplicates while preserving order
    allowed_tools = list(dict.fromkeys(allowed_tools))
    
    return {
        "env": {
            "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000",
            "MAX_MCP_OUTPUT_TOKENS": "64000",
            "MCP_TIMEOUT": "60000"
        },
        "permissions": {
            "allow": allowed_tools
        },
        "mcpServers": {
            "claude-mcp-orchestration": {
                "allowed": True,
                "allowedTools": allowed_tools
            }
        },
        "tools": {
            "computer_20241022": {"allowed": False},
            "str_replace_editor": {"allowed": True},
            "bash": {"allowed": True},
            "Bash": {"allowed": True},
            "Edit": {"allowed": True},
            "MultiEdit": {"allowed": True},
            "Read": {"allowed": True},
            "Write": {"allowed": True},
            "Glob": {"allowed": True},
            "Grep": {"allowed": True},
            "LS": {"allowed": True},
            "TodoRead": {"allowed": True},
            "TodoWrite": {"allowed": True},
            "WebFetch": {"allowed": True},
            "WebSearch": {"allowed": True},
            "Task": {"allowed": True},
            "NotebookRead": {"allowed": False},
            "NotebookEdit": {"allowed": False}
        }
    }


def _create_or_update_claude_md(project_dir: Path) -> bool:
    """Create or update CLAUDE.md with ClaudeMcpTools integration."""
    claude_section = """<!-- zzClaudeMcpToolszz START -->
# ClaudeMcpTools Integration

This project uses ClaudeMcpTools with enhanced MCP tools and architect-led multi-agent orchestration.

## 🎯 Architect-Led Orchestration (Recommended)

**Start here for complex tasks requiring multiple agents working together:**

```python
# Let the architect analyze and coordinate multiple specialized agents
orchestrate_objective(
    objective="Implement OAuth login with comprehensive tests and documentation",
    repository_path=".",
    foundation_session_id="shared-context-123"  # 85-90% cost reduction
)
```

The architect will:
1. **Analyze** the objective and break it into specialized tasks
2. **Spawn** coordinated agents (backend → frontend → testing → documentation)
3. **Coordinate** agent dependencies and communication
4. **Monitor** progress through real-time agent chat

### Example Multi-Agent Workflows

**Full-Stack Feature Development:**
```python
# Architect spawns: Backend Agent → Frontend Agent → Testing Agent → Docs Agent
orchestrate_objective(
    objective="Add user authentication with JWT, login UI, tests, and API docs",
    repository_path="."
)
```

**Development Environment Setup:**
```python
# Architect spawns: Dev Server Agent + Playwright Testing Agent (parallel)
orchestrate_objective(
    objective="Set up development server and end-to-end testing pipeline",
    repository_path="."
)
```

**Documentation-Driven Development:**
```python
# Architect spawns: Docs Scraper → Analyzer → Implementation Agents
orchestrate_objective(
    objective="Study React docs and implement component library following best practices",
    repository_path="."
)
```

## 🤖 Individual Agent Commands

### Smart File Operations
- `list_files(directory=".")` - List files with smart ignore patterns
- `find_files(pattern="*.py")` - Search files by pattern  
- `easy_replace(file_path, old_text, new_text)` - Fuzzy string replacement
- `take_screenshot()` - Cross-platform screenshots

### Project Analysis (Use Before Implementation)
- `analyze_project_structure(project_path=".")` - Generate .treesummary files
- `generate_project_summary(project_path=".")` - AI-optimized project overview
# Dead code detection removed - was unimplemented

### Documentation Intelligence (For Context-Aware Development)
- `scrape_documentation(url="https://docs.example.com")` - Scrape and index docs
- `search_documentation(query="API usage")` - Semantic search with AI
- `link_docs_to_code(project_path=".")` - Connect docs to code

### Manual Agent Spawning
- `spawn_agent(agent_type="implementer", repository_path=".", task_description="specific task")` - Create specialized agents
- `create_task(repository_path=".", task_type="feature", title="User Auth", dependencies=[])` - Coordinate development tasks
- `join_room(room_name="dev-team")` - Real-time agent communication

### Agent Coordination & Dependencies
```python
# Spawn agents with dependencies (testing waits for implementation)
backend_agent = await spawn_agent("backend", ".", "Implement OAuth API endpoints")
frontend_agent = await spawn_agent("frontend", ".", "Create login UI components")

# Testing agent waits for both implementation agents
test_agent = await spawn_agent(
    "testing", ".", 
    "Create comprehensive OAuth flow tests",
    depends_on=[backend_agent["agent_id"], frontend_agent["agent_id"]]
)

# Documentation agent waits for everything
docs_agent = await spawn_agent(
    "documentation", ".", 
    "Document the OAuth implementation", 
    depends_on=[backend_agent["agent_id"], frontend_agent["agent_id"], test_agent["agent_id"]]
)
```

### Shared Memory & Cross-Agent Learning
- `store_memory(repository_path=".", agent_id, entry_type="insight", title, content)` - Store insights for other agents
- `search_memory(repository_path=".", query_text="authentication")` - Search previous agent work
- `log_error(repository_path=".", error_type="runtime", error_category="mcp_tool", error_message)` - Enhanced error logging
- `get_error_patterns(repository_path=".")` - Learn from previous failures
- `get_recent_errors(repository_path=".")` - Debug current issues

## 📋 Best Practices

### Documentation-First Development
```python
# 1. Scrape relevant docs first
scrape_documentation("https://nextjs.org/docs", crawl_depth=2)

# 2. Use architect to coordinate documentation-aware implementation
orchestrate_objective(
    objective="Build Next.js app following official patterns from scraped docs",
    repository_path="."
)
```

### Development Server + Testing Workflow
```python
# Architect can coordinate parallel development and testing
orchestrate_objective(
    objective="Start dev server on port 3000 and run Playwright tests against it",
    repository_path="."
)
```

### Foundation Sessions (Cost Optimization)
```python
# All agents share context for 85-90% token cost reduction
shared_session = "project-oauth-implementation-2024"

orchestrate_objective(
    objective="Complete OAuth implementation",
    repository_path=".",
    foundation_session_id=shared_session  # Agents share context
)
```

## 🚀 Quick Start Examples

**Complex Feature**: "Use orchestrate_objective to implement user authentication with tests and docs"
**Documentation Setup**: "Scrape the React docs and implement components following best practices"
**Development Workflow**: "Set up dev environment with server and testing pipeline"
**Error Analysis**: "Check recent errors and patterns, then implement fixes"
**Team Coordination**: "Spawn specialized agents for backend, frontend, testing, and documentation"

🎯 **Recommended**: Always start with `orchestrate_objective()` for multi-step tasks. The architect will intelligently break down work and coordinate specialized agents with proper dependencies and shared context.

Data stored locally at `~/.mcptools/data/` with intelligent caching and cross-agent memory sharing.
<!-- zzClaudeMcpToolszz END -->"""

    try:
        claude_md_path = project_dir / "CLAUDE.md"

        if not claude_md_path.exists():
            # Create new CLAUDE.md file
            claude_md_path.write_text(claude_section + "\n")
            console.print("✅ [green]Created CLAUDE.md with ClaudeMcpTools integration[/green]")
            return True

        # Check if our section already exists
        content = claude_md_path.read_text()
        if "<!-- zzClaudeMcpToolszz START -->" in content:
            # Replace existing section

            # Split content on our delimiters
            parts = content.split("<!-- zzClaudeMcpToolszz START -->")
            if len(parts) >= 2:
                before = parts[0]
                after_parts = parts[1].split("<!-- zzClaudeMcpToolszz END -->")
                if len(after_parts) >= 2:
                    after = after_parts[1]
                    # Reconstruct with new section
                    new_content = before + claude_section + after
                    claude_md_path.write_text(new_content)
                    console.print("✅ [green]Updated ClaudeMcpTools section in CLAUDE.md[/green]")
                    return True

        # Append new section to existing file
        claude_md_path.write_text(content + "\n\n" + claude_section + "\n")
        console.print("✅ [green]Added ClaudeMcpTools section to CLAUDE.md[/green]")
        return True

    except Exception as e:
        console.print(f"⚠️ [yellow]Could not update CLAUDE.md: {e}[/yellow]")
        return False


@app.command()
def install(
    # Existing options (maintained for compatibility)
    auto: bool = typer.Option(True, "--auto/--no-auto", help="Auto-configure MCP servers (default: True)"),
    global_install: bool = typer.Option(True, "--global", help="Install globally"),
    project_setup: bool = typer.Option(True, "--project/--no-project", help="Set up current project permissions (default: True)"),
    
    # New interactive options
    yes: bool = typer.Option(False, "--yes", "-y", help="Accept all defaults, skip all prompts"),
    allow_all: bool = typer.Option(False, "--allow-all", help="Enable all tools and permissions"),
    minimal: bool = typer.Option(False, "--minimal", help="Install with minimal permissions only"),
    install_dir: str = typer.Option("", "--install-dir", help="Custom installation directory"),
    global_only: bool = typer.Option(False, "--global-only", help="Global installation only, skip project setup"),
    project_only: bool = typer.Option(False, "--project-only", help="Project setup only, skip global installation"),
    no_hooks: bool = typer.Option(False, "--no-hooks", help="Skip hook installation"),
    interactive: bool = typer.Option(False, "--interactive", help="Enable interactive prompts for advanced configuration"),
):
    """
    🚀 Install ClaudeMcpTools with automatic or interactive configuration.
    
    By default, runs in automatic mode with sensible defaults (maintains existing behavior).
    Use --interactive for advanced configuration options.
    
    Examples:
      claude-mcp-tools install                    # Auto setup with all permissions (default)
      claude-mcp-tools install --interactive      # Interactive setup with choices
      claude-mcp-tools install --yes --minimal    # Quick minimal install
      claude-mcp-tools install --global-only      # Global installation only
    """
    # Determine if we should use interactive mode or auto mode
    # Interactive mode is opt-in, auto mode is default (maintains existing behavior)
    use_interactive = interactive and not yes
    
    # Handle conflicting flags
    if global_only and project_only:
        console.print("❌ [red]Cannot specify both --global-only and --project-only[/red]")
        raise typer.Exit(1)
    
    if allow_all and minimal:
        console.print("❌ [red]Cannot specify both --allow-all and --minimal[/red]")
        raise typer.Exit(1)
    
    console.print(Panel.fit(
        "🚀 [bold blue]ClaudeMcpTools Installation[/bold blue]",
        subtitle="Enhanced MCP Tools for Claude Code",
    ))

    # Check prerequisites
    if not check_prerequisites():
        raise typer.Exit(1)
    
    # Set defaults based on mode (auto vs interactive)
    if use_interactive:
        # Interactive mode: prompt for everything
        if global_only:
            install_type = InstallType.GLOBAL_ONLY
        elif project_only:
            install_type = InstallType.PROJECT_ONLY
        else:
            install_type = prompt_install_type(False)
        
        # Determine installation location
        if install_dir:
            location = InstallLocation.CUSTOM
            custom_path = Path(install_dir).expanduser()
        else:
            location, custom_path = prompt_install_location(False)
        
        # Get the actual install directory
        actual_install_dir = get_install_dir(location, custom_path)
        
        # Determine permission level
        permission_level = prompt_permission_level(False, allow_all, minimal)
        
        # If selective permissions, prompt for categories
        selected_categories = None
        if permission_level == PermissionLevel.SELECTIVE:
            selected_categories = prompt_permission_categories()
        
        # Determine hook scope
        hook_scope = prompt_hook_scope(False, no_hooks)
        
        # Show configuration summary
        console.print("\n📋 [bold]Installation Summary:[/bold]")
        console.print(f"   Location: [blue]{actual_install_dir}[/blue]")
        console.print(f"   Type: [green]{install_type.value}[/green]")
        console.print(f"   Permissions: [yellow]{permission_level.value}[/yellow]")
        console.print(f"   Hooks: [magenta]{hook_scope.value}[/magenta]")
        
        if not Confirm.ask("\nContinue with installation?", default=True):
            console.print("❌ Installation cancelled")
            raise typer.Exit(0)
    else:
        # Auto mode: use sensible defaults (maintains existing behavior)
        if global_only:
            install_type = InstallType.GLOBAL_ONLY
        elif project_only:
            install_type = InstallType.PROJECT_ONLY
        else:
            install_type = InstallType.FULL  # Default: full setup
        
        # Use default location unless custom specified
        if install_dir:
            location = InstallLocation.CUSTOM
            custom_path = Path(install_dir).expanduser()
            actual_install_dir = custom_path
        else:
            actual_install_dir = get_install_dir()  # Default: ~/.mcptools/
        
        # Set permission level based on flags
        if minimal:
            permission_level = PermissionLevel.MINIMAL
        else:
            permission_level = PermissionLevel.ALLOW_ALL  # Default: allow all (existing behavior)
        
        selected_categories = None
        
        # Hook scope
        hook_scope = HookScope.SKIP if no_hooks else HookScope.PROJECT  # Default: project hooks
    
    # Update global constants for the rest of the function
    global INSTALL_DIR
    INSTALL_DIR = actual_install_dir

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:

        # Step 1: Create directories
        task1 = progress.add_task("📁 Creating directories...", total=4)
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        progress.update(task1, advance=1)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        progress.update(task1, advance=1)
        BIN_DIR.mkdir(parents=True, exist_ok=True)
        progress.update(task1, advance=1)

        # Create venv directory if needed
        venv_dir = INSTALL_DIR / ".venv"
        if not venv_dir.exists():
            progress.update(task1, description="📁 Creating virtual environment...")
            subprocess.run(["uv", "venv", str(venv_dir)], check=True, capture_output=True)
        progress.update(task1, advance=1, description="📁 Directories created ✓")

        # Step 2: Check/Install package globally
        task2 = progress.add_task("📦 Checking global installation...", total=2)

        # Check if already installed globally
        if INSTALL_DIR.exists() and (INSTALL_DIR / ".venv").exists():
            progress.update(task2, description="📦 Found existing global installation...")
            progress.update(task2, advance=2, description="📦 Using existing global installation ✓")
        else:
            # Check if we're in ClaudeMcpTools source directory
            current_dir = Path.cwd()
            if (current_dir / "pyproject.toml").exists():
                # We're in source - install globally
                progress.update(task2, description="📦 Installing from source globally...")

                # Create dedicated virtual environment
                venv_dir = INSTALL_DIR / ".venv"
                if not venv_dir.exists():
                    subprocess.run(["uv", "venv", str(venv_dir)], check=True, capture_output=True)

                # Install package in the global venv
                subprocess.run([
                    "uv", "pip", "install", "-e", str(current_dir),
                ], env={**os.environ, "VIRTUAL_ENV": str(venv_dir)}, check=True, capture_output=True)
                progress.update(task2, advance=1)

                # Copy project files (exclude launcher scripts to prevent overwriting)
                subprocess.run([
                    "rsync", "-av",
                    "--exclude=.git", "--exclude=__pycache__", "--exclude=*.pyc", "--exclude=.pytest_cache",
                    "--exclude=start-orchestration.sh", "--exclude=start-server.sh",
                    f"{current_dir}/", str(INSTALL_DIR),
                ], check=True, capture_output=True)
                progress.update(task2, advance=1, description="📦 Global installation complete ✓")
            else:
                # Not in source and no global install found
                console.print("❌ [red]ClaudeMcpTools not found globally[/red]")
                console.print("💡 [yellow]Please install globally first:[/yellow]")
                console.print("   1. [blue]cd /path/to/ClaudeMcpTools[/blue]")
                console.print("   2. [blue]uv tool install .[/blue]")
                console.print("   3. Then run [blue]claude-mcp-tools install[/blue] from any project")
                raise typer.Exit(1)

        # Step 3: Create launchers (ALWAYS overwrite with correct format)
        task3 = progress.add_task("🔧 Creating MCP launchers...", total=2)

        # Always create correct launcher scripts regardless of installation state
        # This ensures we overwrite any old format scripts

        # Create orchestration launcher
        orch_launcher = INSTALL_DIR / "start-orchestration.sh"
        orch_launcher.write_text("""#!/bin/bash
# ClaudeMcpTools Orchestration Server Launcher
exec claude-mcp-orchestration "$@"
""")
        orch_launcher.chmod(0o755)
        progress.update(task3, advance=1)

        # Create basic server launcher
        server_launcher = INSTALL_DIR / "start-server.sh"
        server_launcher.write_text("""#!/bin/bash
# ClaudeMcpTools Basic Server Launcher
exec claude-mcp-tools-server "$@"
""")
        server_launcher.chmod(0o755)
        progress.update(task3, advance=1, description="🔧 MCP launchers created ✓")

        # Step 4: Install browser dependencies for web scraping
        task4 = progress.add_task("🌐 Installing browser dependencies...", total=2)
        
        try:
            progress.update(task4, description="🌐 Installing Chromium browser for documentation scraping...")
            
            # Install patchright browser (Chromium) for web scraping
            venv_python = venv_dir / "bin" / "python"
            subprocess.run([
                str(venv_python), "-m", "patchright", "install", "chromium"
            ], check=True, capture_output=True, timeout=300)  # 5 minute timeout
            
            progress.update(task4, advance=1, description="✅ Chromium browser installed")
        except subprocess.TimeoutExpired:
            progress.update(task4, description="⚠️ Browser install timeout (will retry on first use)")
            progress.update(task4, advance=1)
        except subprocess.CalledProcessError as e:
            progress.update(task4, description="⚠️ Browser install failed (will retry on first use)")
            progress.update(task4, advance=1)
        except Exception as e:
            progress.update(task4, description="⚠️ Browser install skipped")
            progress.update(task4, advance=1)
        
        progress.update(task4, advance=1, description="🌐 Browser dependencies ready ✓")

        # Step 5: Project setup
        should_setup_project = (
            install_type in [InstallType.FULL, InstallType.PROJECT_ONLY] or 
            (project_setup and install_type != InstallType.GLOBAL_ONLY)
        )
        
        if should_setup_project:
            task5 = progress.add_task("🔒 Setting up project configuration...", total=2)
            
            progress.update(task5, description="🔒 Setting up permissions and commands...")
            project_claude_dir = Path.cwd() / ".claude"
            project_claude_dir.mkdir(exist_ok=True)

            # Create commands directory and copy command files
            commands_dir = project_claude_dir / "commands"
            commands_dir.mkdir(exist_ok=True)

            # Copy command files from installation
            command_files = [
                "documentation.md", "analyze.md", "cleanup.md", "status.md", "agents.md",
            ]
            source_commands_dir = INSTALL_DIR / ".claude" / "commands"

            for cmd_file in command_files:
                source_file = source_commands_dir / cmd_file
                dest_file = commands_dir / cmd_file
                if source_file.exists():
                    dest_file.write_text(source_file.read_text())

            # Create or update permissions file (merge with existing)
            settings_file = project_claude_dir / "settings.local.json"
            
            # Load existing settings if they exist
            existing_settings = {}
            if settings_file.exists():
                try:
                    import json
                    existing_settings = json.loads(settings_file.read_text())
                except (json.JSONDecodeError, FileNotFoundError):
                    existing_settings = {}
                
            # Build permission settings based on user choices
            default_settings = build_permission_settings(permission_level, selected_categories)
                
            # Safely merge settings - only add our tools, never overwrite existing
            merged_settings = safely_merge_claude_settings(existing_settings, default_settings)
            
            # Write merged settings
            import json
            settings_file.write_text(json.dumps(merged_settings, indent=2))

            # Create or update CLAUDE.md with ClaudeMcpTools integration
            progress.update(task5, description="📝 Setting up CLAUDE.md integration...")
            _create_or_update_claude_md(Path.cwd())

            progress.update(task5, advance=1, description="🔒 Project setup complete ✓")

        # Step 5.5: Hook installation (if not skipped)
        if hook_scope != HookScope.SKIP:
            task_hooks = progress.add_task("🪝 Setting up hooks...", total=3)
            
            hooks_installed = False
            hooks_status = "pending"
            
            try:
                # Determine hook directories based on scope
                hook_dirs = []
                if hook_scope in [HookScope.PROJECT, HookScope.BOTH]:
                    hook_dirs.append(Path.cwd() / ".claude" / "hooks")
                if hook_scope in [HookScope.GLOBAL, HookScope.BOTH]:
                    hook_dirs.append(Path.home() / ".claude" / "hooks")
                
                progress.update(task_hooks, advance=1, description="🪝 Creating hook directories...")
                
                # Create hook directories first
                for hook_dir in hook_dirs:
                    hook_dir.mkdir(parents=True, exist_ok=True)
                
                # Try to find and copy ClaudeMcpTools hooks
                progress.update(task_hooks, description="🔍 Searching for ClaudeMcpTools hooks...")
                source_hooks_dir = find_package_hooks_dir(verbose=use_interactive)
                
                if source_hooks_dir:
                    progress.update(task_hooks, description="📋 Installing ClaudeMcpTools hooks...")
                    
                    # Create hook directories and install ClaudeMcpTools hooks
                    for hook_dir in hook_dirs:
                        hook_files = [
                            "memory-monitor.sh",
                            "agent-monitor.sh", 
                            "compact-replan.sh",
                            "docs-monitor.sh",
                            "mcp-monitor.sh"
                        ]
                        
                        installed_count = 0
                        for hook_file in hook_files:
                            source_hook = source_hooks_dir / hook_file
                            dest_hook = hook_dir / hook_file
                            if source_hook.exists():
                                try:
                                    # Update hook content to use correct installation paths
                                    hook_content = source_hook.read_text()
                                    # Replace any hardcoded paths with the actual installation directory
                                    hook_content = hook_content.replace("~/.claude/mcptools", str(INSTALL_DIR))
                                    hook_content = hook_content.replace("~/.claude/zmcptools", str(DATA_DIR))
                                    dest_hook.write_text(hook_content)
                                    dest_hook.chmod(0o755)
                                    installed_count += 1
                                except Exception as e:
                                    if use_interactive:
                                        console.print(f"   ⚠️ Failed to install {hook_file}: {e}")
                        
                        if installed_count > 0:
                            hooks_installed = True
                            if use_interactive:
                                console.print(f"   ✅ Installed {installed_count} hooks to {hook_dir}")
                    
                    hooks_status = "installed" if hooks_installed else "failed"
                else:
                    # Hooks not found - create placeholder message
                    progress.update(task_hooks, description="⚠️ ClaudeMcpTools hooks not found...")
                    
                    if use_interactive:
                        console.print("   ⚠️ ClaudeMcpTools hooks not found in installation")
                        console.print("   📝 Hook functionality will be limited")
                        console.print("   💡 Hooks may be available after reinstalling with: uv tool install --force .")
                    
                    # Still create minimal hook structure for potential manual setup
                    for hook_dir in hook_dirs:
                        readme_file = hook_dir / "README.md"
                        if not readme_file.exists():
                            readme_content = """# ClaudeMcpTools Hooks Directory

This directory is intended for ClaudeMcpTools hook scripts but they were not found during installation.

## Manual Hook Installation

If you have access to the ClaudeMcpTools source code, you can manually copy hook files here:
- memory-monitor.sh
- agent-monitor.sh  
- compact-replan.sh
- docs-monitor.sh
- mcp-monitor.sh

Make sure to make them executable: `chmod +x *.sh`
"""
                            readme_file.write_text(readme_content)
                    
                    hooks_status = "not_found"
                
                # Set up hook configurations in Claude settings (only if hooks were installed or if we want placeholders)
                progress.update(task_hooks, description="⚙️ Configuring hook settings...")
                
                # Always configure hook settings, even if hooks weren't found (placeholders for future manual install)
                for hook_dir in hook_dirs:
                    if hook_scope in [HookScope.PROJECT, HookScope.BOTH] and hook_dir == Path.cwd() / ".claude" / "hooks":
                        # Project-specific hooks - merge with settings.local.json
                        project_settings_file = Path.cwd() / ".claude" / "settings.local.json"
                        if project_settings_file.exists():
                            try:
                                import json
                                existing_settings = json.loads(project_settings_file.read_text())
                            except (json.JSONDecodeError, FileNotFoundError):
                                existing_settings = {}
                        else:
                            existing_settings = {}
                        
                        # Add hooks configuration
                        hooks_config = {
                            "hooks": {
                                "PostToolUse": [
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__store_memory",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/memory-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__search_memory", 
                                        "hooks": [{"type": "command", "command": ".claude/hooks/memory-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__spawn_agent",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__spawn_agents_batch",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__orchestrate_objective",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__terminate_agent",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__list_agents",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__get_agent_status",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__scrape_documentation",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__search_documentation",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__update_documentation",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__analyze_documentation_changes",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__link_docs_to_code",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__*",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/mcp-monitor.sh"}]
                                    }
                                ],
                                "SubagentStop": [
                                    {
                                        "matcher": "*",
                                        "hooks": [{"type": "command", "command": ".claude/hooks/compact-replan.sh"}]
                                    }
                                ]
                            }
                        }
                        
                        # Safely merge hooks configuration with existing settings
                        merged_settings = safely_merge_claude_settings(existing_settings, hooks_config)
                        
                        # Write updated settings
                        project_settings_file.write_text(json.dumps(merged_settings, indent=2))
                    
                    elif hook_scope in [HookScope.GLOBAL, HookScope.BOTH] and hook_dir == Path.home() / ".claude" / "hooks":
                        # Global hooks - create settings.json in user's .claude directory
                        global_settings_file = Path.home() / ".claude" / "settings.json"
                        if global_settings_file.exists():
                            try:
                                import json
                                existing_settings = json.loads(global_settings_file.read_text())
                            except (json.JSONDecodeError, FileNotFoundError):
                                existing_settings = {}
                        else:
                            existing_settings = {}
                        
                        # Add global hooks configuration (using absolute paths)
                        hooks_config = {
                            "hooks": {
                                "PostToolUse": [
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__store_memory",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/memory-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__search_memory",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/memory-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__spawn_agent",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__spawn_agents_batch",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__orchestrate_objective",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__terminate_agent",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__list_agents",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__get_agent_status",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/agent-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__scrape_documentation",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__search_documentation",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__update_documentation",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__analyze_documentation_changes",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__link_docs_to_code",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/docs-monitor.sh"}]
                                    },
                                    {
                                        "matcher": "mcp__claude-mcp-orchestration__*",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/mcp-monitor.sh"}]
                                    }
                                ],
                                "SubagentStop": [
                                    {
                                        "matcher": "*",
                                        "hooks": [{"type": "command", "command": f"{Path.home()}/.claude/hooks/compact-replan.sh"}]
                                    }
                                ]
                            }
                        }
                        
                        # Safely merge hooks configuration with existing settings
                        merged_settings = safely_merge_claude_settings(existing_settings, hooks_config)
                        
                        # Write updated settings
                        global_settings_file.write_text(json.dumps(merged_settings, indent=2))
                
                progress.update(task_hooks, advance=1, description="📝 Hook configuration complete")
                
                # Update final hook status message
                scope_desc = {
                    HookScope.PROJECT: "project",
                    HookScope.GLOBAL: "global", 
                    HookScope.BOTH: "project and global"
                }[hook_scope]
                
                if hooks_status == "installed":
                    progress.update(task_hooks, advance=1, description=f"🪝 Hooks successfully installed ({scope_desc}) ✓")
                elif hooks_status == "not_found":
                    progress.update(task_hooks, advance=1, description=f"🪝 Hook directories created, files not found ({scope_desc}) ⚠️")
                else:
                    progress.update(task_hooks, advance=1, description=f"🪝 Hook setup completed with issues ({scope_desc}) ⚠️")
                
            except Exception as e:
                progress.update(task_hooks, advance=2, description=f"⚠️ Hook setup failed: {e}")

        # Step 6: Database migration setup
        task6 = progress.add_task("🗄️ Setting up database migrations...", total=2)
        progress.update(task6, description="🗄️ Initializing database schema management...")
        
        # Run database migrations during installation
        try:
            from .database import init_database
            import asyncio
            
            progress.update(task6, description="🗄️ Running database migrations...")
            
            # Run database initialization with migrations
            asyncio.run(init_database())
            
            progress.update(task6, advance=1, description="✅ Database migrations completed")
        except Exception as e:
            progress.update(task6, advance=1, description=f"⚠️ Migration failed: {e}")
            console.print(f"   [yellow]Warning: Database migration failed during install: {e}[/yellow]")
            console.print("   [dim]Migrations will be retried when the server starts[/dim]")
        
        progress.update(task6, advance=1, description="🗄️ Database setup complete ✓")

        # Step 6.5: Set session environment variables (no longer modifying Claude's files)
        task_env = progress.add_task("⚙️ Setting session environment...", total=1)
        
        try:
            # Set for current session only - don't modify Claude Code's files
            os.environ["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = "64000"
            os.environ["MAX_MCP_OUTPUT_TOKENS"] = "64000"
            os.environ["MCP_TIMEOUT"] = "60000"
            progress.update(task_env, advance=1, description="⚙️ Session environment configured ✓")
            
        except Exception as e:
            progress.update(task_env, advance=1, description=f"⚠️ Environment setup failed: {e}")

        # Step 7: Auto-configuration of MCP servers (if requested)
        if auto:
            task7 = progress.add_task("⚙️ Auto-configuring MCP servers...", total=1)

            # Configure MCP servers
            try:
                progress.update(task7, description="⚙️ Adding MCP servers...")
                subprocess.run([
                    "claude", "mcp", "add", "claude-mcp-orchestration", str(orch_launcher),
                ], check=True, capture_output=True)
                progress.update(task7, advance=1, description="⚙️ MCP server configuration complete ✓")
            except subprocess.CalledProcessError:
                progress.update(task7, advance=1, description="⚠️ MCP server config failed (manual setup needed)")

    # Success message with hook status
    hook_status_msg = ""
    if hook_scope != HookScope.SKIP:
        if 'hooks_status' in locals():
            if hooks_status == "installed":
                hook_status_msg = f"• Smart hooks: [green]✅ Successfully installed[/green] ([blue]{hook_scope.value} scope[/blue])"
            elif hooks_status == "not_found":
                hook_status_msg = f"• Smart hooks: [yellow]⚠️ Directories created, files not found[/yellow] ([blue]{hook_scope.value} scope[/blue])\n  [dim]💡 Hook files may be available after: uv tool install --force .[/dim]"
            else:
                hook_status_msg = f"• Smart hooks: [yellow]⚠️ Setup completed with issues[/yellow] ([blue]{hook_scope.value} scope[/blue])"
        else:
            hook_status_msg = f"• Smart hooks: [yellow]⚠️ Installation attempted[/yellow] ([blue]{hook_scope.value} scope[/blue])"
    else:
        hook_status_msg = "• Smart hooks: [dim]Skipped (--no-hooks)[/dim]"

    success_panel = Panel.fit(
        f"""[green]✅ Installation Complete![/green]

📋 [bold]What was installed:[/bold]
• Global installation: [blue]{INSTALL_DIR}[/blue]
• Data storage: [blue]{DATA_DIR}[/blue]
• Chromium browser for documentation scraping
• MCP servers configured in Claude Code
• Project permissions: [blue]./.claude/settings.local.json[/blue]
• Claude Commands: [blue]./.claude/commands/[/blue]
• Project integration: [blue]./CLAUDE.md[/blue]
• Session environment: CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000, MAX_MCP_OUTPUT_TOKENS=64000
{hook_status_msg}

🚀 [bold]Next steps:[/bold]
1. Use /mcp to see available tools
2. Try: [blue]scrape_documentation()[/blue] for web scraping
3. Try: [blue]orchestrate_objective()[/blue] for multi-agent workflows
4. Check: [blue]./CLAUDE.md[/blue] for architect-led examples
5. Environment variables configured automatically via settings.json for larger responses""",
        title="🎉 Success",
    )
    
    # Create default configuration file
    try:
        from .config import config
        console.print("📋 [green]Creating default configuration...[/green]")
        console.print(f"   Config file: {config.config_path}")
        console.print("   Edit to customize logging and server settings")
    except Exception as e:
        console.print(f"⚠️  [yellow]Warning: Could not create config file: {e}[/yellow]")
    
    console.print(success_panel)


@app.command()
def status():
    """📊 Show installation status and available tools."""
    console.print(Panel.fit("📊 [bold blue]ClaudeMcpTools Status[/bold blue]"))

    # Installation status
    table = Table(title="Installation Status")
    table.add_column("Component", style="cyan")
    table.add_column("Status", style="green")
    table.add_column("Location", style="blue")

    # Check global installation
    if INSTALL_DIR.exists():
        table.add_row("Global Installation", "✅ Installed", str(INSTALL_DIR))
    else:
        table.add_row("Global Installation", "❌ Not Found", str(INSTALL_DIR))

    # Check data directory
    if DATA_DIR.exists():
        try:
            size = subprocess.run(["du", "-sh", str(DATA_DIR)],
                                capture_output=True, text=True).stdout.split()[0]
            table.add_row("Data Storage", f"✅ Active ({size})", str(DATA_DIR))
        except:
            table.add_row("Data Storage", "✅ Active", str(DATA_DIR))
    else:
        table.add_row("Data Storage", "📁 Empty", str(DATA_DIR))

    # Check project settings
    project_settings = Path.cwd() / ".claude" / "settings.local.json"
    if project_settings.exists():
        table.add_row("Project Settings", "✅ Configured", str(project_settings))
    else:
        table.add_row("Project Settings", "⚠️ Not Configured", "Run: claude-mcp-tools install --project")

    # Check Claude Commands
    commands_dir = Path.cwd() / ".claude" / "commands"
    if commands_dir.exists():
        cmd_count = len(list(commands_dir.glob("*.md")))
        table.add_row("Claude Commands", f"✅ {cmd_count} commands", str(commands_dir))
    else:
        table.add_row("Claude Commands", "⚠️ Not Configured", "Run: claude-mcp-tools install --project")

    console.print(table)

    # Available tools
    tools_panel = Panel.fit(
        """🔧 [bold]Available MCP Tools:[/bold]

• [blue]Enhanced File Operations[/blue] (6 tools)
  - list_files, find_files, easy_replace, take_screenshot
• [blue]Project Analysis[/blue] (5 tools)  
  - analyze_project_structure, generate_project_summary
• [blue]Documentation Intelligence[/blue] (5 tools)
  - scrape_documentation, search_documentation
• [blue]Multi-Agent Orchestration[/blue] (42 tools)
  - spawn_agent, spawn_agents_batch, orchestrate_objective
• [blue]Total Available[/blue]: 65+ tools (59 orchestration + 6 basic)""",
        title="🛠️ Tools",
    )
    console.print(tools_panel)


@app.command()
def configure():
    """⚙️ Configure Claude Code MCP integration."""
    console.print(Panel.fit("⚙️ [bold blue]Claude Code MCP Configuration[/bold blue]"))

    if not INSTALL_DIR.exists():
        console.print("❌ [red]ClaudeMcpTools not installed globally[/red]")
        console.print("   Run: [blue]claude-mcp-tools install[/blue]")
        raise typer.Exit(1)

    # Show configuration options
    console.print("🔧 [bold]Configuration Options:[/bold]\n")

    choice = typer.prompt(
        "Choose option:\n"
        "  1. Show manual commands\n"
        "  2. Auto-add orchestration server (recommended)\n"
        "  3. Auto-add basic server\n"
        "Enter choice (1-3)",
        type=int,
    )

    orch_launcher = INSTALL_DIR / "start-orchestration.sh"
    server_launcher = INSTALL_DIR / "start-server.sh"

    if choice == 1:
        commands_panel = Panel.fit(
            f"""[bold]Run these commands:[/bold]

# Full orchestration server (recommended):
[blue]claude mcp add claude-mcp-orchestration '{orch_launcher}'[/blue]

# Basic file operations server:
[blue]claude mcp add claude-mcp-tools '{server_launcher}'[/blue]

# Verify installation:
[blue]claude mcp list[/blue]""",
            title="📋 Manual Configuration",
        )
        console.print(commands_panel)

    elif choice == 2:
        with console.status("🚀 Adding orchestration server..."):
            try:
                subprocess.run([
                    "claude", "mcp", "add", "claude-mcp-orchestration", str(orch_launcher),
                ], check=True, capture_output=True)
                console.print("✅ [green]Orchestration server added![/green]")
                console.print("📋 Restart Claude Code to use the tools")
            except subprocess.CalledProcessError as e:
                console.print(f"❌ [red]Failed to add server: {e}[/red]")

    elif choice == 3:
        with console.status("📁 Adding basic server..."):
            try:
                subprocess.run([
                    "claude", "mcp", "add", "claude-mcp-tools", str(server_launcher),
                ], check=True, capture_output=True)
                console.print("✅ [green]Basic server added![/green]")
                console.print("📋 Restart Claude Code to use the tools")
            except subprocess.CalledProcessError as e:
                console.print(f"❌ [red]Failed to add server: {e}[/red]")

    else:
        console.print("❌ [red]Invalid option[/red]")


@app.command()
def server():
    """🚀 Start the basic MCP server (file operations)."""
    console.print("🚀 [bold blue]Starting ClaudeMcpTools MCP Server...[/bold blue]")

    if not INSTALL_DIR.exists():
        console.print("❌ [red]ClaudeMcpTools not installed[/red]")
        console.print("   Run: [blue]claude-mcp-tools install[/blue]")
        raise typer.Exit(1)

    # Change to install directory and run server
    os.chdir(INSTALL_DIR)
    os.execvp("uv", ["uv", "run", "python", "-m", "claude_mcp_tools.server"])


@app.command()
def orchestration(
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose logging"),
    debug: bool = typer.Option(False, "--debug", "-d", help="Enable debug logging"),
):
    """🎛️ Start the full orchestration server with auto-managed scraper worker (recommended)."""
    console.print("🎛️ [bold blue]Starting ClaudeMcpTools Orchestration Server...[/bold blue]")

    if not INSTALL_DIR.exists():
        console.print("❌ [red]ClaudeMcpTools not installed[/red]")
        console.print("   Run: [blue]claude-mcp-tools install[/blue]")
        raise typer.Exit(1)

    # Update configuration if flags provided
    if verbose or debug:
        try:
            from .config import config
            
            updates = {}
            if debug:
                updates["logging.debug"] = True
                updates["logging.verbose"] = True  # Debug implies verbose
                console.print("🔍 [yellow]Debug mode enabled[/yellow]")
            elif verbose:
                updates["logging.verbose"] = True
                console.print("📝 [yellow]Verbose mode enabled[/yellow]")
            
            config.update_config(**updates)
            console.print(f"📋 Configuration updated: {config.config_path}")
            
        except Exception as e:
            console.print(f"⚠️  [yellow]Warning: Could not update config: {e}[/yellow]")

    # Change to install directory and run orchestration server
    os.chdir(INSTALL_DIR)
    os.execvp("uv", ["uv", "run", "python", "-m", "claude_mcp_tools.orchestration_server"])


@app.command()
def worker(
    queue_db: str = typer.Option(
        None, 
        "--queue-db", 
        "-q", 
        help="Path to SQLite database for job queue (defaults to main database)"
    ),
):
    """🔧 Start the scraper worker process (typically auto-started by orchestration server)."""
    console.print("🔧 [bold blue]Starting ClaudeMcpTools Scraper Worker...[/bold blue]")
    console.print("💡 [yellow]Note: Worker is typically auto-started by the orchestration server.[/yellow]")
    console.print("   [dim]Manual startup is useful for debugging or when running worker separately.[/dim]")

    if not INSTALL_DIR.exists():
        console.print("❌ [red]ClaudeMcpTools not installed[/red]")
        console.print("   Run: [blue]claude-mcp-tools install[/blue]")
        raise typer.Exit(1)

    # Use default queue database if not specified
    if not queue_db:
        queue_db = str(INSTALL_DIR / "data" / "orchestration.db")
    
    console.print(f"📋 Using queue database: {queue_db}")

    # Change to install directory and run worker
    os.chdir(INSTALL_DIR)
    os.execvp("uv", ["uv", "run", "python", "-m", "claude_mcp_tools.workers.scraper_worker", queue_db])


@app.command()
def permissions():
    """🔒 Manage Claude Code tool permissions."""
    console.print(Panel.fit("🔒 [bold blue]Claude Code Permission Management[/bold blue]"))

    choice = typer.prompt(
        "Choose permission action:\n"
        "  1. Configure for current directory\n"
        "  2. Configure globally\n"
        "  3. Show recommended settings\n"
        "Enter choice (1-3)",
        type=int,
    )

    if choice == 1:
        project_dir = Path.cwd()
        claude_dir = project_dir / ".claude"
        claude_dir.mkdir(exist_ok=True)
        settings_file = claude_dir / "settings.local.json"

        # Create project-specific permissions
        settings_content = """{
  "mcpServers": {
    "claude-mcp-orchestration": {
      "allowed": true,
      "allowedTools": [
        "mcp__claude-mcp-orchestration__spawn_agent",
        "mcp__claude-mcp-orchestration__spawn_agents_batch",
        "mcp__claude-mcp-orchestration__list_agents",
        "mcp__claude-mcp-orchestration__get_agent_status",
        "mcp__claude-mcp-orchestration__terminate_agent",
        "mcp__claude-mcp-orchestration__orchestrate_objective",
        "mcp__claude-mcp-orchestration__analyze_project_structure",
        "mcp__claude-mcp-orchestration__generate_project_summary",
        "mcp__claude-mcp-orchestration__analyze_file_symbols",
        "mcp__claude-mcp-orchestration__scrape_documentation",
        "mcp__claude-mcp-orchestration__search_documentation",
        "mcp__claude-mcp-orchestration__update_documentation",
        "mcp__claude-mcp-orchestration__analyze_documentation_changes",
        "mcp__claude-mcp-orchestration__link_docs_to_code",
        "mcp__claude-mcp-orchestration__get_scraping_status",
        "mcp__claude-mcp-orchestration__watch_scraping_progress",
        "mcp__claude-mcp-orchestration__create_task",
        "mcp__claude-mcp-orchestration__assign_task",
        "mcp__claude-mcp-orchestration__get_task_status",
        "mcp__claude-mcp-orchestration__list_tasks",
        "mcp__claude-mcp-orchestration__create_task_batch",
        "mcp__claude-mcp-orchestration__create_workflow",
        "mcp__claude-mcp-orchestration__split_task",
        "mcp__claude-mcp-orchestration__assign_tasks_bulk",
        "mcp__claude-mcp-orchestration__auto_assign_tasks",
        "mcp__claude-mcp-orchestration__auto_assign_tasks_parallel",
        "mcp__claude-mcp-orchestration__balance_workload",
        "mcp__claude-mcp-orchestration__get_agent_workload",
        "mcp__claude-mcp-orchestration__join_room",
        "mcp__claude-mcp-orchestration__leave_room",
        "mcp__claude-mcp-orchestration__send_message",
        "mcp__claude-mcp-orchestration__broadcast_message",
        "mcp__claude-mcp-orchestration__get_messages",
        "mcp__claude-mcp-orchestration__wait_for_messages",
        "mcp__claude-mcp-orchestration__store_memory",
        "mcp__claude-mcp-orchestration__search_memory",
        "mcp__claude-mcp-orchestration__log_tool_call",
        "mcp__claude-mcp-orchestration__get_tool_call_history",
        "mcp__claude-mcp-orchestration__log_error",
        "mcp__claude-mcp-orchestration__get_recent_errors",
        "mcp__claude-mcp-orchestration__resolve_error",
        "mcp__claude-mcp-orchestration__get_error_patterns",
        "mcp__claude-mcp-orchestration__list_files",
        "mcp__claude-mcp-orchestration__find_files",
        "mcp__claude-mcp-orchestration__easy_replace",
        "mcp__claude-mcp-orchestration__cleanup_orphaned_projects",
        "mcp__claude-mcp-orchestration__update_treesummary_incremental",
        "mcp__claude-mcp-orchestration__watch_project_changes",
        "mcp__claude-mcp-orchestration__get_system_status"
      ]
    },
    "claude-mcp-tools": {
      "allowed": true,
      "allowedTools": [
        "mcp__claude-mcp-tools__list_files",
        "mcp__claude-mcp-tools__find_files",
        "mcp__claude-mcp-tools__easy_replace",
        "mcp__claude-mcp-tools__take_screenshot",
        "mcp__claude-mcp-tools__create_claudeignore"
      ]
    }
  },
  "tools": {
    "computer_20241022": { "allowed": false },
    "str_replace_editor": { "allowed": true },
    "bash": { "allowed": true },
    "Bash": { "allowed": true },
    "Edit": { "allowed": true },
    "MultiEdit": { "allowed": true },
    "Read": { "allowed": true },
    "Write": { "allowed": true },
    "Glob": { "allowed": true },
    "Grep": { "allowed": true },
    "LS": { "allowed": true },
    "TodoRead": { "allowed": true },
    "TodoWrite": { "allowed": true },
    "WebFetch": { "allowed": true },
    "WebSearch": { "allowed": true },
    "Task": { "allowed": true },
    "NotebookRead": { "allowed": false },
    "NotebookEdit": { "allowed": false }
  }
}"""

        settings_file.write_text(settings_content)
        console.print(f"✅ [green]Project permissions configured: {settings_file}[/green]")

    elif choice == 2:
        global_settings = Path.home() / ".claude" / "settings.local.json"
        global_settings.parent.mkdir(exist_ok=True)

        # Create global permissions
        settings_content = """{
  "mcpServers": {
    "claude-mcp-orchestration": {
      "allowed": true,
      "allowedTools": [
        "mcp__claude-mcp-orchestration__spawn_agent",
        "mcp__claude-mcp-orchestration__spawn_agents_batch",
        "mcp__claude-mcp-orchestration__list_agents",
        "mcp__claude-mcp-orchestration__get_agent_status",
        "mcp__claude-mcp-orchestration__terminate_agent",
        "mcp__claude-mcp-orchestration__orchestrate_objective",
        "mcp__claude-mcp-orchestration__analyze_project_structure",
        "mcp__claude-mcp-orchestration__generate_project_summary",
        "mcp__claude-mcp-orchestration__analyze_file_symbols",
        "mcp__claude-mcp-orchestration__scrape_documentation",
        "mcp__claude-mcp-orchestration__search_documentation",
        "mcp__claude-mcp-orchestration__update_documentation",
        "mcp__claude-mcp-orchestration__analyze_documentation_changes",
        "mcp__claude-mcp-orchestration__link_docs_to_code",
        "mcp__claude-mcp-orchestration__get_scraping_status",
        "mcp__claude-mcp-orchestration__watch_scraping_progress",
        "mcp__claude-mcp-orchestration__create_task",
        "mcp__claude-mcp-orchestration__assign_task",
        "mcp__claude-mcp-orchestration__get_task_status",
        "mcp__claude-mcp-orchestration__list_tasks",
        "mcp__claude-mcp-orchestration__create_task_batch",
        "mcp__claude-mcp-orchestration__create_workflow",
        "mcp__claude-mcp-orchestration__split_task",
        "mcp__claude-mcp-orchestration__assign_tasks_bulk",
        "mcp__claude-mcp-orchestration__auto_assign_tasks",
        "mcp__claude-mcp-orchestration__auto_assign_tasks_parallel",
        "mcp__claude-mcp-orchestration__balance_workload",
        "mcp__claude-mcp-orchestration__get_agent_workload",
        "mcp__claude-mcp-orchestration__join_room",
        "mcp__claude-mcp-orchestration__leave_room",
        "mcp__claude-mcp-orchestration__send_message",
        "mcp__claude-mcp-orchestration__broadcast_message",
        "mcp__claude-mcp-orchestration__get_messages",
        "mcp__claude-mcp-orchestration__wait_for_messages",
        "mcp__claude-mcp-orchestration__store_memory",
        "mcp__claude-mcp-orchestration__search_memory",
        "mcp__claude-mcp-orchestration__log_tool_call",
        "mcp__claude-mcp-orchestration__get_tool_call_history",
        "mcp__claude-mcp-orchestration__log_error",
        "mcp__claude-mcp-orchestration__get_recent_errors",
        "mcp__claude-mcp-orchestration__resolve_error",
        "mcp__claude-mcp-orchestration__get_error_patterns",
        "mcp__claude-mcp-orchestration__list_files",
        "mcp__claude-mcp-orchestration__find_files",
        "mcp__claude-mcp-orchestration__easy_replace",
        "mcp__claude-mcp-orchestration__cleanup_orphaned_projects",
        "mcp__claude-mcp-orchestration__update_treesummary_incremental",
        "mcp__claude-mcp-orchestration__watch_project_changes",
        "mcp__claude-mcp-orchestration__get_system_status"
      ]
    },
    "claude-mcp-tools": {
      "allowed": true,
      "allowedTools": [
        "mcp__claude-mcp-tools__list_files",
        "mcp__claude-mcp-tools__find_files",
        "mcp__claude-mcp-tools__easy_replace",
        "mcp__claude-mcp-tools__take_screenshot",
        "mcp__claude-mcp-tools__create_claudeignore"
      ]
    }
  },
  "tools": {
    "computer_20241022": { "allowed": false },
    "str_replace_editor": { "allowed": true },
    "bash": { "allowed": true },
    "Bash": { "allowed": true },
    "Edit": { "allowed": true },
    "MultiEdit": { "allowed": true },
    "Read": { "allowed": true },
    "Write": { "allowed": true },
    "Glob": { "allowed": true },
    "Grep": { "allowed": true },
    "LS": { "allowed": true },
    "TodoRead": { "allowed": true },
    "TodoWrite": { "allowed": true },
    "WebFetch": { "allowed": true },
    "WebSearch": { "allowed": true },
    "Task": { "allowed": true },
    "NotebookRead": { "allowed": false },
    "NotebookEdit": { "allowed": false }
  }
}"""

        global_settings.write_text(settings_content)
        console.print(f"✅ [green]Global permissions configured: {global_settings}[/green]")

    elif choice == 3:
        recommendations_panel = Panel.fit(
            """[bold]Recommended Permission Settings:[/bold]

✅ [green]Allowed Tools:[/green]
• All ClaudeMcpTools MCP servers
• str_replace_editor (file editing)  
• bash (command execution)

❌ [red]Disabled Tools:[/red]
• computer_20241022 (screen control)
• NotebookRead/Edit (conflicts with MCP tools)

[blue]These settings optimize compatibility with ClaudeMcpTools.[/blue]""",
            title="📋 Recommendations",
        )
        console.print(recommendations_panel)

    else:
        console.print("❌ [red]Invalid option[/red]")


@app.command()
def cleanup(
    dry_run: bool = typer.Option(True, "--dry-run/--execute", help="Preview changes without executing"),
    older_than: int = typer.Option(30, "--older-than", help="Remove data older than N days"),
    interactive: bool = typer.Option(True, "--interactive/--automatic", help="Interactive cleanup"),
):
    """🧹 Clean up orphaned projects and stale data."""
    console.print(Panel.fit("🧹 [bold blue]ClaudeMcpTools Cleanup[/bold blue]"))

    if not INSTALL_DIR.exists():
        console.print("❌ [red]ClaudeMcpTools not installed[/red]")
        console.print("   Run: [blue]claude-mcp-tools install[/blue]")
        raise typer.Exit(1)

    console.print("🧹 [bold]Cleanup functionality available via:[/bold]")
    console.print("   • Dashboard: [blue]claude-mcp-tools dashboard[/blue]")
    console.print("   • Direct Claude interaction with orchestration server")
    console.print("   • Cleanup tools: analyze_storage_usage, cleanup_orphaned_projects, etc.")
    console.print("\n💡 [yellow]Use the dashboard for interactive cleanup management[/yellow]")


@app.command()
def dashboard(
    port: int = typer.Option(8080, "--port", help="Port for dashboard server"),
    host: str = typer.Option("0.0.0.0", "--host", help="Host for dashboard server"),
    open_browser: bool = typer.Option(True, "--open/--no-open", help="Open browser automatically"),
    reload: bool = typer.Option(False, "--reload", help="Enable auto-reload for development"),
):
    """🎛️ Start web dashboard for documentation and system management."""
    console.print(Panel.fit("🎛️ [bold blue]ClaudeMcpTools Web Dashboard[/bold blue]"))

    if not INSTALL_DIR.exists():
        console.print("❌ [red]ClaudeMcpTools not installed[/red]")
        console.print("   Run: [blue]claude-mcp-tools install[/blue]")
        raise typer.Exit(1)

    # Start dashboard server
    console.print(f"🚀 Starting dashboard server on [blue]http://{host}:{port}[/blue]")

    if host == "0.0.0.0":
        console.print("📡 [bold]Network Access Enabled[/bold] - Dashboard accessible from:")
        console.print(f"   • Local: [blue]http://localhost:{port}[/blue]")
        console.print(f"   • Network: [blue]http://[your-ip]:{port}[/blue]")
    else:
        console.print(f"🔒 [bold]Local Access Only[/bold] - Dashboard at [blue]http://{host}:{port}[/blue]")

    console.print("\n📊 [bold]Dashboard features:[/bold]")
    console.print("   • 📈 Real-time system monitoring")
    console.print("   • 🤖 Agent management and spawning")
    console.print("   • 🧹 Interactive cleanup tools")
    console.print("   • 📚 Documentation browsing")
    console.print("   • 🎨 Light/dark mode support")
    console.print("\n🛑 Press Ctrl+C to stop the server")

    if open_browser:
        import threading
        import webbrowser
        def open_browser_delayed():
            import time
            time.sleep(2)  # Wait for server to start
            url = f"http://localhost:{port}" if host == "0.0.0.0" else f"http://{host}:{port}"
            webbrowser.open(url)
        threading.Thread(target=open_browser_delayed, daemon=True).start()
        console.print("🌐 Opening browser...")

    try:
        # Change to install directory and start dashboard
        os.chdir(INSTALL_DIR)

        # Run the dashboard directly using the app module
        import sys
        sys.path.insert(0, str(INSTALL_DIR / "src"))

        # Start the dashboard server
        dashboard_args = ["--host", host, "--port", str(port)]
        if reload:
            dashboard_args.append("--reload")

        os.execvp("uv", ["uv", "run", "python", "-m", "claude_mcp_tools.dashboard.app"] + dashboard_args)
    except KeyboardInterrupt:
        console.print("\n🛑 Dashboard server stopped")
    except Exception as e:
        console.print(f"❌ [red]Failed to start dashboard: {e}[/red]")
        raise typer.Exit(1)


@app.command()
def uninstall():
    """🗑️ Remove ClaudeMcpTools installation."""
    console.print("🗑️ [bold red]ClaudeMcpTools Uninstallation[/bold red]")

    if not typer.confirm("Are you sure? This will remove all ClaudeMcpTools files."):
        console.print("❌ Uninstall cancelled")
        raise typer.Exit(0)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:

        task = progress.add_task("🗑️ Removing ClaudeMcpTools...", total=None)

        # Remove installation directory
        if INSTALL_DIR.exists():
            import shutil
            shutil.rmtree(INSTALL_DIR)
            progress.update(task, description="🗑️ Removed global installation")

        # Remove CLI tools
        cli_tool = BIN_DIR / "claude-mcp-tools"
        if cli_tool.exists():
            cli_tool.unlink()
            progress.update(task, description="🗑️ Removed CLI tools")

        progress.update(task, description="🗑️ Uninstallation complete ✓")

    console.print("✅ [green]ClaudeMcpTools uninstalled[/green]")
    console.print(f"   Note: Data in {DATA_DIR} preserved")


def main():
    """Main entry point for the CLI."""
    app()


if __name__ == "__main__":
    main()
