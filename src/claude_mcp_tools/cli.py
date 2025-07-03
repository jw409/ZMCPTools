"""Modern CLI for ClaudeMcpTools using Typer + Rich."""

import os
import subprocess
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn
from rich.table import Table

# Initialize console and app
console = Console()
app = typer.Typer(
    name="claude-mcp-tools",
    help="🚀 ClaudeMcpTools - Enhanced MCP Tools for Claude Code",
    rich_markup_mode="rich",
    add_completion=False,
)

# Constants
INSTALL_DIR = Path.home() / ".claude" / "mcptools"
DATA_DIR = Path.home() / ".claude" / "zmcptools"
BIN_DIR = Path.home() / ".local" / "bin"


def check_prerequisites() -> bool:
    """Check if required tools are installed."""
    missing = []

    if not subprocess.run(["which", "uv"], capture_output=True).returncode == 0:
        missing.append("uv (https://astral.sh/uv/)")

    if not subprocess.run(["which", "claude"], capture_output=True).returncode == 0:
        missing.append("claude CLI (https://docs.anthropic.com/en/docs/claude-code)")

    if missing:
        console.print("❌ [red]Missing prerequisites:[/red]")
        for tool in missing:
            console.print(f"   • {tool}")
        return False

    return True


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
- `detect_dead_code(project_path=".")` - Find unused code

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
- `store_memory_entry(repository_path=".", agent_id, entry_type="insight", title, content)` - Store insights for other agents
- `query_shared_memory(repository_path=".", query_text="authentication")` - Search previous agent work
- `store_agent_insight(repository_path=".", agent_id, insight_type="pattern", category="architecture", title, description)` - Share discoveries
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

Data stored locally at `~/.claude/zmcptools/` with intelligent caching and cross-agent memory sharing.
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
    auto: bool = typer.Option(True, "--auto/--no-auto", help="Auto-configure MCP servers and permissions (default: True)"),
    global_install: bool = typer.Option(True, "--global", help="Install globally"),
    project_setup: bool = typer.Option(True, "--project", help="Set up current project"),
):
    """
    🚀 Install ClaudeMcpTools globally with optional auto-configuration.
    
    This command will:
    • Install ClaudeMcpTools in a global location
    • Set up MCP server launchers
    • Optionally configure Claude Code integration
    • Set up project-specific permissions
    """
    console.print(Panel.fit(
        "🚀 [bold blue]ClaudeMcpTools Installation[/bold blue]",
        subtitle="Enhanced MCP Tools for Claude Code",
    ))

    # Check prerequisites
    if not check_prerequisites():
        raise typer.Exit(1)

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

        # Step 4: Auto-configuration (if requested)
        if auto:
            task4 = progress.add_task("⚙️ Auto-configuring...", total=3)

            # Configure MCP servers
            try:
                progress.update(task4, description="⚙️ Adding MCP servers...")
                subprocess.run([
                    "claude", "mcp", "add", "claude-mcp-orchestration", str(orch_launcher),
                ], check=True, capture_output=True)
                progress.update(task4, advance=1)
            except subprocess.CalledProcessError:
                progress.update(task4, description="⚠️ MCP server config failed (manual setup needed)")
                progress.update(task4, advance=1)

            # Set up project permissions and Claude Commands
            if project_setup:
                progress.update(task4, description="🔒 Setting up permissions and commands...")
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

                # Create basic permissions file
                settings_file = project_claude_dir / "settings.local.json"
                settings_content = """{
  "mcpServers": {
    "claude-mcp-orchestration": {
      "allowed": true,
      "allowedTools": ["*"]
    }
  },
  "tools": {
    "computer_20241022": { "allowed": false },
    "str_replace_editor": { "allowed": true },
    "bash": { "allowed": true }
  }
}"""
                settings_file.write_text(settings_content)

                # Create or update CLAUDE.md with ClaudeMcpTools integration
                progress.update(task4, description="📝 Setting up CLAUDE.md integration...")
                _create_or_update_claude_md(Path.cwd())

                progress.update(task4, advance=1)
            else:
                progress.update(task4, advance=1)

            progress.update(task4, advance=1, description="⚙️ Auto-configuration complete ✓")

    # Success message
    success_panel = Panel.fit(
        """[green]✅ Installation Complete![/green]

📋 [bold]What was installed:[/bold]
• Global installation: [blue]~/.claude/mcptools/[/blue]
• Data storage: [blue]~/.claude/zmcptools/[/blue]
• MCP servers configured in Claude Code
• Project permissions: [blue]./.claude/settings.local.json[/blue]
• Claude Commands: [blue]./.claude/commands/[/blue]
• Project integration: [blue]./CLAUDE.md[/blue]

🚀 [bold]Next steps:[/bold]
1. Restart Claude Code
2. Use /mcp to see available tools
3. Try: [blue]orchestrate_objective()[/blue] for multi-agent workflows
4. Check: [blue]./CLAUDE.md[/blue] for architect-led examples""",
        title="🎉 Success",
    )
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
• [blue]Project Analysis[/blue] (6 tools)  
  - analyze_project_structure, detect_dead_code
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
def orchestration():
    """🎛️ Start the full orchestration server (recommended)."""
    console.print("🎛️ [bold blue]Starting ClaudeMcpTools Orchestration Server...[/bold blue]")

    if not INSTALL_DIR.exists():
        console.print("❌ [red]ClaudeMcpTools not installed[/red]")
        console.print("   Run: [blue]claude-mcp-tools install[/blue]")
        raise typer.Exit(1)

    # Change to install directory and run orchestration server
    os.chdir(INSTALL_DIR)
    os.execvp("uv", ["uv", "run", "python", "-m", "claude_mcp_tools.orchestration_server"])


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
      "allowedTools": ["*"]
    },
    "claude-mcp-tools": {
      "allowed": true,
      "allowedTools": ["*"]
    }
  },
  "tools": {
    "computer_20241022": { "allowed": false },
    "str_replace_editor": { "allowed": true },
    "bash": { "allowed": true },
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
      "allowedTools": ["*"]
    },
    "claude-mcp-tools": {
      "allowed": true,
      "allowedTools": ["*"]
    }
  },
  "tools": {
    "computer_20241022": { "allowed": false },
    "str_replace_editor": { "allowed": true },
    "bash": { "allowed": true },
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
