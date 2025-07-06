# ClaudeMcpTools

🚀 **Enhanced MCP Tools for Claude Code** - Complete multi-agent orchestration with beautiful CLI, intuitive web dashboard, documentation intelligence, and advanced file operations.

## ✨ Features

### 🎯 **Architect-Led Multi-Agent Orchestration**
- **Intelligent Coordination**: Architect agents analyze objectives and spawn specialized teams
- **Agent Dependencies**: Backend → Frontend → Testing → Documentation workflows
- **Real-Time Communication**: Agents coordinate through dedicated chat rooms
- **Foundation Sessions**: 85-90% cost reduction through shared context
- **65+ Enhanced Tools**: Complete orchestration with seamless Claude Code integration

### 🎨 **Modern CLI Experience**
- **Beautiful Interface**: Built with Typer + Rich for colored output and progress bars
- **One-Command Setup**: `uv tool install claude-mcp-tools` and you're ready!
- **Interactive Commands**: Guided setup with smart defaults
- **Global Installation**: Available anywhere with `claude-mcp-tools`
- **Project Integration**: Automatic CLAUDE.md creation with architect guidance

### 🎛️ **Web Dashboard**
- **Real-Time Monitoring**: Live system status with WebSocket updates
- **Agent Management**: Visual interface for spawning and monitoring agents
- **Interactive Cleanup**: Storage analysis and database optimization tools
- **Responsive Design**: Mobile-friendly with light/dark theme support
- **Network Access**: Default 0.0.0.0 binding for team collaboration

### 📂 Enhanced File Operations (6 tools)
- **Smart Ignore Patterns**: `.claudeignore` and `.gitignore` support with hierarchical precedence
- **Fuzzy String Replacement**: Whitespace-normalized matching with similarity thresholds  
- **Cross-Platform Screenshots**: Native tools with Python fallbacks
- **Pattern-Based File Search**: Glob patterns with ignore pattern respect
- **Batch Operations**: Multi-file replacements with rollback capability

### 🌳 Project Analysis (6 tools)  
- **Project Structure Analysis**: Generate AI-optimized `.treesummary` files
- **Code Symbol Extraction**: Advanced parsing with tree-sitter integration
- **Dead Code Detection**: Find unused code and dependencies with vulture
- **Incremental Updates**: Smart caching with 85-90% token cost reduction
- **Real-Time Monitoring**: File watching with automatic analysis updates

### 📚 Documentation Intelligence (5 tools)
- **Automated Web Scraping**: Playwright-powered documentation collection
- **Semantic Search**: ChromaDB vector database with AI embeddings
- **Cross-Reference Linking**: Connect documentation to code
- **Change Tracking**: Monitor documentation updates over time
- **Local Storage**: All data stored at `$HOME/.claude/zmcptools/`

### 🤖 Multi-Agent Orchestration (15+ tools)
- **Agent Spawning**: Specialized development agents with real-time communication
- **Task Management**: Create, assign, and track complex development tasks
- **Shared Memory**: Cross-agent collaboration and knowledge sharing
- **Error Learning**: Pattern recognition for improved reliability
- **SQLite Coordination**: Persistent state management

## 🚀 Quick Installation

### Method 1: Global Installation (Recommended)

```bash
# Install globally with uv tool (when published)
uv tool install claude-mcp-tools

# Or install from local development
git clone https://github.com/zachhandley/ClaudeMcpTools
cd ClaudeMcpTools
uv tool install .
```

### Method 2: Enhanced Interactive Installation

**Auto Mode (Default - maintains existing behavior):**
```bash
# Quick auto-setup with sensible defaults
claude-mcp-tools install

# Auto-setup with specific options
claude-mcp-tools install --minimal --global-only
claude-mcp-tools install --allow-all --no-hooks
```

**Interactive Mode (Advanced configuration):**
```bash
# Interactive setup with full configuration options
claude-mcp-tools install --interactive
```

**Available Installation Options:**
- **Installation Location**: `~/.claude/mcptools/` (default) or `~/.mcptools/` or custom path
- **Installation Type**: Full setup, Global-only, Project-only, or Custom components
- **Permission Level**: Allow-all (default), Selective categories, or Minimal tools
- **Hook Installation**: Project hooks, Global hooks, Both, or Skip
- **Tool Categories**: Agents, Analysis, Documentation, Tasks, Communication, Memory, Files

**This will:**
- ✅ Install ClaudeMcpTools globally with configurable location
- ✅ Set up MCP server launchers  
- ✅ Configure Claude Code integration with 64k token limits via settings.json
- ✅ Set up modular permissions based on your choices
- ✅ Create sample hooks for automation (optional)
- ✅ Enhanced CLAUDE.md integration with architect guidance
- ✅ Enable 65+ enhanced tools with architect-led orchestration

## 📋 Prerequisites

ClaudeMcpTools requires the following tools to be installed:

### Required
- **[uv](https://astral.sh/uv/)** - Python package manager: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **[Claude CLI](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's Claude Code CLI

### Optional (for hooks)
- **jq** - JSON processor for hook functionality:
  - **Ubuntu/Debian**: `sudo apt install jq`
  - **macOS**: `brew install jq`
  - **Other systems**: See [jq installation guide](https://stedolan.github.io/jq/download/)

**Note**: The installation process will check for these prerequisites and provide installation instructions if any are missing.

## 🎯 Architect-Led Orchestration

### Core Workflow

```python
# Let the architect coordinate multiple specialized agents
orchestrate_objective(
    objective="Implement OAuth login with comprehensive tests and documentation",
    repository_path=".",
    foundation_session_id="shared-context-123"  # 85-90% cost reduction
)
```

**The architect will:**
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

## 🎯 Usage

### CLI Commands

```bash
# Beautiful help with Rich formatting
claude-mcp-tools --help

# Show installation status and available tools
claude-mcp-tools status

# Configure Claude Code MCP integration
claude-mcp-tools configure

# Manage tool permissions  
claude-mcp-tools permissions

# Start servers
claude-mcp-tools server         # Basic file operations
claude-mcp-tools orchestration  # Full orchestration (recommended)
claude-mcp-tools dashboard      # Web dashboard interface

# Install/setup
claude-mcp-tools install                    # Auto-setup (default)
claude-mcp-tools install --interactive      # Interactive configuration
claude-mcp-tools install --minimal --global-only  # Minimal global-only
claude-mcp-tools uninstall                  # Clean removal
```

### 🎛️ Web Dashboard

ClaudeMcpTools includes a modern web dashboard for visual management and monitoring:

```bash
# Start the dashboard (accessible from any device on your network)
claude-mcp-tools dashboard

# Custom host and port
claude-mcp-tools dashboard --host 127.0.0.1 --port 3000

# Development mode with auto-reload
claude-mcp-tools dashboard --reload

# Start without auto-opening browser
claude-mcp-tools dashboard --no-open
```

**🌟 Dashboard Features:**

- **📊 Real-time System Monitoring**
  - Live agent status and performance metrics
  - Storage usage breakdown with visual charts
  - Database record counts and health indicators
  - WebSocket-powered automatic updates

- **🤖 Agent Management Interface**
  - Spawn new agents with custom configurations
  - Monitor agent lifecycle and task assignments
  - Terminate agents with confirmation dialogs
  - View agent capabilities and status history

- **🧹 Interactive Cleanup Tools**
  - Visual storage analysis with breakdown charts
  - Orphaned project detection and removal
  - Database optimization tools (SQLite VACUUM)
  - Preview mode for safe cleanup operations

- **📚 Documentation Browser** *(Coming Soon)*
  - Search semantic documentation database
  - Browse scraped documentation sources
  - View documentation change history
  - Configure crawl settings and schedules

- **⚙️ Settings & Configuration**
  - Light/dark mode with system preference detection
  - Auto-refresh interval configuration
  - Notification preferences management
  - Export/import dashboard settings

- **📱 Responsive Design**
  - Mobile-friendly interface
  - Adaptive layouts for all screen sizes
  - Touch-optimized controls
  - Cross-platform compatibility

**🔧 Network Access:**
The dashboard defaults to `0.0.0.0:8080`, making it accessible from any device on your network. This enables:
- Management from mobile devices
- Remote monitoring capabilities
- Multi-device development workflows
- Team collaboration features

### Convenient Aliases

The following aliases are available (add to `~/.zshrc`):

```bash
alias mcp-tools="claude-mcp-tools"
alias mcp-status="claude-mcp-tools status" 
alias mcp-server="claude-mcp-tools orchestration"
alias mcp-dashboard="claude-mcp-tools dashboard"
```

## ⚙️ Configuration

### Enhanced Installation Options

```bash
# Auto-setup with sensible defaults (recommended)
claude-mcp-tools install

# Interactive setup with full configuration choices
claude-mcp-tools install --interactive

# Quick setups for specific use cases
claude-mcp-tools install --minimal --global-only     # Minimal global installation
claude-mcp-tools install --allow-all --project-only  # Full project setup only
claude-mcp-tools install --yes --no-hooks           # Silent install without hooks

# Configure MCP servers interactively
claude-mcp-tools configure

# Set up permissions (project or global)
claude-mcp-tools permissions
```

**🎯 Interactive Installation Features:**
- **Smart Location Choice**: `~/.claude/mcptools/` vs `~/.mcptools/` vs custom path
- **Modular Permissions**: Choose specific tool categories (agents, docs, analysis, etc.)
- **Hook Management**: Optional automation hooks for pre-commit, post-save actions
- **Environment Configuration**: Automatic Claude Code 64k token limit setup
- **Installation Summary**: Clear overview before proceeding
- **Non-Interactive Flags**: Full CLI control for automation scripts

### Manual MCP Server Configuration

```bash
# Add orchestration server (recommended)
claude mcp add claude-mcp-orchestration ~/.local/share/uv/tools/claude-mcp-tools/bin/claude-mcp-orchestration

# Or add basic file operations server
claude mcp add claude-mcp-tools ~/.local/share/uv/tools/claude-mcp-tools/bin/claude-mcp-tools-server

# Verify installation
claude mcp list
```

## 📖 Usage Examples

### Architect-Led Multi-Agent Development

```python
# Complex feature with coordinated agents
orchestrate_objective(
    objective="Implement user authentication with tests and comprehensive documentation",
    repository_path=".",
    foundation_session_id="auth-implementation-2024"
)

# Development workflow with parallel agents
orchestrate_objective(
    objective="Set up dev server on port 3000 and run Playwright tests against it",
    repository_path="."
)

# Documentation-driven development
orchestrate_objective(
    objective="Scrape Next.js docs and implement app following official patterns",
    repository_path="."
)
```

### Enhanced File Operations

```python
# Smart file listing with ignore patterns
list_files(directory=".", show_hidden=True, max_depth=3)

# Fuzzy string replacement
easy_replace(file_path, search_text, replace_text, similarity_threshold=0.8)

# Pattern-based file search
find_files(pattern="*.py", directory=".", include_hidden=True)

# Cross-platform screenshots
take_screenshot(output_path="screenshot.png", region=(0, 0, 1920, 1080))
```

### Project Analysis

```python
# Generate project analysis
analyze_project_structure(project_path="/path/to/project", output_format="treesummary")

# Extract code symbols
analyze_file_symbols(file_path="src/main.py", include_dependencies=True)

# Generate AI-optimized summaries
generate_project_summary(project_path="/path/to/project", focus_areas=["architecture"])

# Real-time monitoring
watch_project_changes(project_path="/path/to/project", watch_patterns=["*.py", "*.js"])
```

### Documentation Intelligence

```python
# Scrape technical documentation
scrape_documentation(
    url="https://docs.anthropic.com/en/docs/claude-code",
    crawl_depth=3,
    selectors={"content": "main", "title": "h1"}
)

# Semantic search with AI embeddings
search_documentation(
    query="MCP server configuration",
    limit=10,
    similarity_threshold=0.7
)

# Cross-reference docs with code
link_docs_to_code(
    project_path="/path/to/project",
    confidence_threshold=0.8
)
```

### Manual Agent Coordination

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

# Real-time agent communication
join_room(room_name="dev-team", agent_name="implementer-1")
send_message(room_name="dev-team", message="Feature complete", mentions=["tester-1"])
```

## 🏗️ Architecture

### Modern CLI with Rich UI
- **Typer Framework**: Type-safe commands with automatic help generation
- **Rich Formatting**: Beautiful tables, progress bars, and colored output
- **Interactive Prompts**: Guided configuration with smart defaults
- **Progress Tracking**: Visual feedback for long-running operations

### Dual-Layer Design

**Layer 1: Enhanced File Operations**
- Hierarchical ignore pattern system (.claudeignore > .gitignore > defaults)
- Fuzzy string matching with configurable similarity thresholds
- Cross-platform screenshot capabilities with native tool integration

**Layer 2: Multi-Agent Orchestration**  
- Project analysis integration for intelligent code understanding
- Documentation intelligence with local vector database storage
- SQLite-based coordination with real-time communication
- Foundation Session pattern for 85-90% token cost reduction

### Enhanced Project Integration

**Automatic CLAUDE.md Integration:**
- Unique delimiters: `<!-- zzClaudeMcpToolszz START/END -->`
- Intelligent replacement of existing sections
- Architect-led workflow guidance
- Multi-agent examples with dependencies
- Documentation-driven development patterns

**Per-Project Setup:**
```bash
# Automatic integration during project setup
claude-mcp-tools install --project

# Creates/updates:
# • ./.claude/settings.local.json (permissions)
# • ./.claude/commands/ (Claude commands)  
# • ./CLAUDE.md (integration guide with architect examples)
```

### Data Storage

- **Global Installation**: `~/.local/share/uv/tools/claude-mcp-tools/`
- **Project Data**: `~/.claude/zmcptools/`
- **Analysis Cache**: `~/.claude/zmcptools/.treegraph/`
- **Documentation Database**: `~/.claude/zmcptools/documentation/`
- **Vector Embeddings**: Local ChromaDB with sentence-transformers

## 🛠️ Development

```bash
# Clone and setup development environment
git clone https://github.com/zachhandley/ClaudeMcpTools
cd ClaudeMcpTools
uv sync

# Install in development mode
uv tool install . --force

# Or run servers directly for testing
uv run python -m claude_mcp_tools.server                    # Basic server
uv run python -m claude_mcp_tools.orchestration_server     # Full orchestration

# Test the CLI
claude-mcp-tools --help
claude-mcp-tools status
```

## 🎨 CLI Examples

### Beautiful Status Display

```bash
$ claude-mcp-tools status
```

```
╭──────────────────────────╮
│ 📊 ClaudeMcpTools Status │
╰──────────────────────────╯
                              Installation Status                               
┏━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Component           ┃ Status           ┃ Location                            ┃
┡━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩
│ Global Installation │ ✅ Installed     │ ~/.local/share/uv/tools/claude-...  │
│ Data Storage        │ ✅ Active (388K) │ ~/.claude/zmcptools                 │
│ Project Settings    │ ✅ Configured    │ ./.claude/settings.local.json       │
│ Project Integration │ ✅ Enhanced      │ ./CLAUDE.md                         │
└─────────────────────┴──────────────────┴─────────────────────────────────────┘
```

### Interactive Installation

```bash
$ claude-mcp-tools install --auto
```

```
╭─────────────────────────────────────────╮
│ 🚀 ClaudeMcpTools Installation         │
│ Enhanced MCP Tools for Claude Code      │
╰─────────────────────────────────────────╯

📁 Creating directories... ████████████████████████████████████████ 100%
📦 Installing package... ████████████████████████████████████████ 100%
🔧 Creating MCP launchers... ████████████████████████████████████████ 100%
📝 Setting up CLAUDE.md integration... ████████████████████████████████████████ 100%
⚙️ Auto-configuring... ████████████████████████████████████████ 100%

╭─────────────────── 🎉 Success ───────────────────╮
│ ✅ Installation Complete!                        │
│                                                   │
│ 📋 What was installed:                            │
│ • Global installation: ~/.claude/mcptools/       │
│ • Data storage: ~/.claude/zmcptools/              │
│ • MCP servers configured in Claude Code          │
│ • Project permissions: ./.claude/settings.local.json │
│ • Project integration: ./CLAUDE.md               │
│                                                   │
│ 🚀 Next steps:                                    │
│ 1. Restart Claude Code                            │
│ 2. Use /mcp to see available tools               │
│ 3. Try: orchestrate_objective() for workflows    │
│ 4. Check: ./CLAUDE.md for architect examples     │
╰───────────────────────────────────────────────────╯
```

## 🌊 Example Workflows

### Multi-Agent Bug Investigation
```python
# Architect coordinates investigation team
orchestrate_objective(
    objective="Investigate authentication bug, implement fix, and add comprehensive tests",
    repository_path=".",
    foundation_session_id="auth-bug-investigation"
)

# Architect spawns: Debugger → Implementer → Tester → Documentation agents
# Each agent shares findings through shared memory and real-time chat
```

### Documentation-Driven Development
```python
# 1. Scrape framework documentation
scrape_documentation("https://vuejs.org/guide/", crawl_depth=2)

# 2. Architect coordinates documentation-aware implementation
orchestrate_objective(
    objective="Build Vue.js app following official patterns from scraped documentation",
    repository_path=".",
    foundation_session_id="vue-implementation"
)

# Architect spawns: Docs Analyzer → Component Builder → Tester → Documentation agents
```

### Development Environment Orchestration
```python
# Architect coordinates parallel development and testing
orchestrate_objective(
    objective="Set up Next.js dev server on port 3000 and run Playwright E2E tests",
    repository_path=".",
    foundation_session_id="dev-environment"
)

# Architect spawns: Dev Server Agent (starts server) + Playwright Agent (tests against it)
```


## 🔍 Troubleshooting

### Installation Issues

```bash
# Check prerequisites
uv --version            # UV package manager required
claude --version        # Claude CLI required

# Clean installation
uv tool uninstall claude-mcp-tools
uv tool install claude-mcp-tools

# Development installation
git clone https://github.com/zachhandley/ClaudeMcpTools
cd ClaudeMcpTools
uv tool install . --force
```

### Verification

```bash
# Check global installation
claude-mcp-tools status
uv tool list

# Check project-specific settings
cat ./.claude/settings.local.json
ls -la ~/.claude/zmcptools/

# Test MCP servers
claude mcp list
```

### Server Connection Issues

```bash
# Test servers manually
claude-mcp-tools server              # Test basic server
claude-mcp-tools orchestration       # Test full server
claude-mcp-tools dashboard           # Test dashboard server

# Reconfigure MCP servers
claude-mcp-tools configure

# Reset permissions
claude-mcp-tools permissions
```

### Dashboard Issues

```bash
# Check dashboard accessibility
curl http://localhost:8080          # Test if dashboard is running
netstat -an | grep 8080              # Check if port is in use

# Dashboard won't start
claude-mcp-tools status              # Verify installation
claude-mcp-tools dashboard --reload  # Development mode for debugging

# Network access issues
claude-mcp-tools dashboard --host 127.0.0.1  # Local only
claude-mcp-tools dashboard --port 3000       # Alternative port

# Permission denied errors
sudo ufw allow 8080                  # Open firewall port (if needed)
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with tests
4. Test with Claude Code integration
5. Submit a pull request

## 📜 License

MIT License - see LICENSE file for details.

---

**🚀 Supercharge your Claude Code workflows with architect-led multi-agent orchestration, beautiful CLI, intuitive web dashboard, one-command installation, and intelligent development assistance!**