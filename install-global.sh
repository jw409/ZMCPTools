#!/bin/bash

# ClaudeMcpTools Global Installation Script
# Installs ClaudeMcpTools globally and sets up project integration capabilities

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.claude/mcptools"
BIN_DIR="$HOME/.local/bin"
SCRIPTS_DIR="$HOME/scripts"

echo "🚀 ClaudeMcpTools Global Installation"
echo "===================================="
echo ""

# Check for auto-configuration mode
if [ "${AUTO_CONFIGURE:-}" = "1" ]; then
    echo "🤖 Auto-configuration mode enabled"
    AUTO_MCP_CONFIG=true
    AUTO_PERMISSIONS=true
    echo "   • MCP servers will be configured automatically"
    echo "   • Project permissions will be set up automatically"
    echo ""
else
    AUTO_MCP_CONFIG=false
    AUTO_PERMISSIONS=false
fi

# Check if we're in the right directory
if [ ! -f "$SCRIPT_DIR/pyproject.toml" ] || [ ! -d "$SCRIPT_DIR/src/claude_mcp_tools" ]; then
    echo "❌ Error: This script must be run from the ClaudeMcpTools project directory"
    echo "   Expected files: pyproject.toml, src/claude_mcp_tools/"
    exit 1
fi

# Check for UV
if ! command -v uv &> /dev/null; then
    echo "❌ UV is required but not installed"
    echo "   Install UV first: curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
    echo "❌ Claude CLI is required but not installed"
    echo "   Install Claude CLI first: https://docs.anthropic.com/en/docs/claude-code"
    exit 1
fi

echo "✅ Prerequisites checked"
echo ""

# Create directories
echo "📁 Setting up directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$SCRIPTS_DIR"
mkdir -p "$HOME/.claude/zmcptools"
echo "   Created: $INSTALL_DIR"
echo "   Created: $BIN_DIR"
echo "   Created: $SCRIPTS_DIR"
echo "   Created: $HOME/.claude/zmcptools"

# Install the package globally using UV
echo ""
echo "📦 Installing ClaudeMcpTools globally with UV..."
cd "$SCRIPT_DIR"

# Create a dedicated virtual environment for global installation
if [ ! -d "$INSTALL_DIR/.venv" ]; then
    echo "   Creating dedicated virtual environment..."
    uv venv "$INSTALL_DIR/.venv"
fi

# Install in the dedicated virtual environment
echo "   Installing in dedicated environment..."
source "$INSTALL_DIR/.venv/bin/activate"
uv pip install -e .

echo "✅ ClaudeMcpTools installed globally"

# Copy project files to global installation directory
echo ""
echo "📋 Setting up global installation..."
rsync -av --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' --exclude='.pytest_cache' \
    "$SCRIPT_DIR/" "$INSTALL_DIR/"

echo "✅ Project files copied to $INSTALL_DIR"

# Create launcher scripts for MCP servers
echo ""
echo "🔧 Creating MCP server launchers..."

cat > "$INSTALL_DIR/start-orchestration.sh" << 'EOFORCH'
#!/bin/bash
# ClaudeMcpTools Orchestration Server Launcher
exec claude-mcp-orchestration "$@"
EOFORCH

cat > "$INSTALL_DIR/start-server.sh" << 'EOFSERVER'
#!/bin/bash
# ClaudeMcpTools Basic Server Launcher
exec claude-mcp-tools-server "$@"
EOFSERVER

chmod +x "$INSTALL_DIR/start-orchestration.sh"
chmod +x "$INSTALL_DIR/start-server.sh"

echo "✅ MCP server launchers created"

# Create global CLI wrapper script
echo ""
echo "🔧 Creating global CLI tools..."

cat > "$BIN_DIR/claude-mcp-tools" << 'EOF'
#!/bin/bash
# ClaudeMcpTools Global CLI

INSTALL_DIR="$HOME/.claude/mcptools"
VENV_PYTHON="$INSTALL_DIR/.venv/bin/python"

# Check if virtual environment exists
if [ ! -f "$VENV_PYTHON" ]; then
    echo "❌ ClaudeMcpTools virtual environment not found"
    echo "   Run the installation script first"
    exit 1
fi

case "$1" in
    "server")
        echo "🚀 Starting ClaudeMcpTools MCP Server..."
        cd "$INSTALL_DIR"
        "$VENV_PYTHON" -m claude_mcp_tools.server
        ;;
    "orchestration")
        echo "🎛️  Starting ClaudeMcpTools Orchestration Server..."
        cd "$INSTALL_DIR"
        "$VENV_PYTHON" -m claude_mcp_tools.orchestration_server
        ;;
    "test")
        echo "🧪 Running ClaudeMcpTools tests..."
        cd "$INSTALL_DIR"
        "$VENV_PYTHON" test_documentation_components.py
        ;;
    "demo")
        echo "🎬 Running ClaudeMcpTools demo..."
        cd "$INSTALL_DIR"
        "$VENV_PYTHON" demo_claude_documentation.py
        ;;
    "status")
        echo "📊 ClaudeMcpTools Status:"
        echo "   Installation: $INSTALL_DIR"
        echo "   Data Storage: $HOME/.claude/zmcptools"
        if [ -d "$HOME/.claude/zmcptools" ]; then
            echo "   Storage Size: $(du -sh "$HOME/.claude/zmcptools" | cut -f1)"
        fi
        echo ""
        echo "🔧 Available MCP Tools:"
        echo "   • Enhanced File Operations (6 tools)"
        echo "   • Project Analysis (6 tools)" 
        echo "   • Documentation Intelligence (5 tools)"
        echo "   • Multi-Agent Orchestration (42 tools)"
        echo "   • Total: 65+ tools available"
        ;;
    "configure")
        echo "⚙️  Configuring Claude Code MCP integration..."
        echo ""
        
        # Ask user what they want to configure
        echo "Choose configuration option:"
        echo "  1. Show commands to run manually"
        echo "  2. Automatically add orchestration server (recommended)"
        echo "  3. Automatically add basic file operations server"
        echo ""
        read -p "Choose option (1-3): " -n 1 -r
        echo
        
        case $REPLY in
            1)
                echo ""
                echo "Run these commands to add ClaudeMcpTools to Claude Code:"
                echo ""
                echo "# Basic file operations server:"
                echo "claude mcp add claude-mcp-tools '$INSTALL_DIR/start-server.sh'"
                echo ""
                echo "# Full orchestration server (recommended):"
                echo "claude mcp add claude-mcp-orchestration '$INSTALL_DIR/start-orchestration.sh'"
                echo ""
                echo "# Verify installation:"
                echo "claude mcp list"
                ;;
            2)
                echo "🚀 Adding orchestration server..."
                claude mcp add claude-mcp-orchestration "$INSTALL_DIR/start-orchestration.sh"
                echo "✅ Orchestration server added!"
                echo "📋 Restart Claude Code to use the tools"
                ;;
            3)
                echo "📁 Adding basic file operations server..."
                claude mcp add claude-mcp-tools "$INSTALL_DIR/start-server.sh"
                echo "✅ Basic server added!"
                echo "📋 Restart Claude Code to use the tools"
                ;;
            *)
                echo "❌ Invalid option"
                ;;
        esac
        ;;
    "update")
        echo "🔄 Updating ClaudeMcpTools..."
        cd "$INSTALL_DIR"
        git pull origin main
        source "$INSTALL_DIR/.venv/bin/activate"
        uv pip install -e .
        echo "✅ ClaudeMcpTools updated"
        ;;
    "permissions")
        echo "🔒 Claude Code Permission Management"
        echo ""
        
        # Ask user what they want to do
        echo "Choose permission action:"
        echo "  1. Configure permissions for current directory"
        echo "  2. Configure global permissions"
        echo "  3. List recommended permissions"
        echo "  4. Reset permissions to ClaudeMcpTools defaults"
        echo ""
        read -p "Choose option (1-4): " -n 1 -r
        echo
        
        case $REPLY in
            1)
                echo ""
                echo "🔧 Configuring permissions for current directory..."
                if [ -f "$BIN_DIR/claude-mcp-tools" ]; then
                    echo "1" | "$BIN_DIR/claude-mcp-tools" permissions
                else
                    echo "❌ CLI tool not found"
                fi
                ;;
            2)
                echo ""
                echo "🔧 Configuring global permissions..."
                if [ -f "$BIN_DIR/claude-mcp-tools" ]; then
                    echo "2" | "$BIN_DIR/claude-mcp-tools" permissions
                else
                    echo "❌ CLI tool not found"
                fi
                ;;
            3)
                echo ""
                echo "📋 Listing recommended permissions..."
                if [ -f "$BIN_DIR/claude-mcp-tools" ]; then
                    echo "3" | "$BIN_DIR/claude-mcp-tools" permissions
                else
                    echo "❌ CLI tool not found"
                fi
                ;;
            4)
                echo ""
                echo "🔄 Resetting to ClaudeMcpTools defaults..."
                echo "This will overwrite existing permission settings."
                read -p "Continue? (y/N): " -n 1 -r
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    if [ -f "$BIN_DIR/claude-mcp-tools" ]; then
                        echo "2" | "$BIN_DIR/claude-mcp-tools" permissions
                    else
                        echo "❌ CLI tool not found"
                    fi
                else
                    echo "❌ Reset cancelled"
                fi
                ;;
            *)
                echo "❌ Invalid option"
                ;;
        esac
        ;;
    "uninstall")
        echo "🗑️  Uninstalling ClaudeMcpTools..."
        read -p "Are you sure? This will remove all ClaudeMcpTools files (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$INSTALL_DIR"
            rm -f "$BIN_DIR/claude-mcp-tools"
            rm -f "$BIN_DIR/claude-mcp-setup"
            echo "✅ ClaudeMcpTools uninstalled"
            echo "   Note: Data in $HOME/.claude/zmcptools preserved"
        else
            echo "❌ Uninstall cancelled"
        fi
        ;;
    *)
        echo "ClaudeMcpTools - Enhanced MCP Tools for Claude Code"
        echo ""
        echo "Usage: claude-mcp-tools <command>"
        echo ""
        echo "Commands:"
        echo "  server        Start basic MCP server (file operations)"
        echo "  orchestration Start full orchestration server (recommended)"
        echo "  test          Run component tests"
        echo "  demo          Run documentation demo"
        echo "  status        Show installation status and info"
        echo "  configure     Show Claude Code MCP configuration commands"
        echo "  permissions   Manage Claude Code tool permissions"
        echo "  update        Update to latest version"
        echo "  uninstall     Remove ClaudeMcpTools"
        echo ""
        echo "Examples:"
        echo "  claude-mcp-tools orchestration  # Start full server"
        echo "  claude-mcp-tools configure      # Show setup commands"
        echo "  claude-mcp-tools permissions    # Configure tool permissions"
        echo "  claude-mcp-tools status         # Check installation"
        ;;
esac
EOF

chmod +x "$BIN_DIR/claude-mcp-tools"

# Create project setup script
cat > "$BIN_DIR/claude-mcp-setup" << 'EOF'
#!/bin/bash

# ClaudeMcpTools Project Setup Script
# Sets up ClaudeMcpTools integration in the current project directory

INSTALL_DIR="$HOME/.claude/mcptools"
CURRENT_DIR=$(pwd)

echo "🚀 ClaudeMcpTools Project Setup"
echo "==============================="

# Check if we're in a valid project directory
if [ ! -d .git ] && [ ! -f package.json ] && [ ! -f pyproject.toml ] && [ ! -f Cargo.toml ]; then
    echo "⚠️  Warning: This doesn't appear to be a project directory"
    echo "   (no .git, package.json, pyproject.toml, or Cargo.toml found)"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if ClaudeMcpTools is installed globally
if [ ! -d "$INSTALL_DIR" ]; then
    echo "❌ ClaudeMcpTools not found globally"
    echo "   Run the global installation first:"
    echo "   cd /path/to/ClaudeMcpTools && ./install-global.sh"
    exit 1
fi

# Check if mcptools symlink already exists
if [ -L "mcptools" ]; then
    echo "✅ ClaudeMcpTools symlink already exists"
elif [ -e "mcptools" ]; then
    echo "❌ A file or directory named 'mcptools' already exists"
    echo "   Please remove it first: rm -rf mcptools"
    exit 1
else
    echo "🔗 Creating mcptools symlink..."
    ln -s "$INSTALL_DIR" mcptools
    echo "✅ ClaudeMcpTools symlink created"
fi

# Create local configuration
echo "⚙️  Creating local configuration..."

# Create .claudemcp directory for local configs
mkdir -p .claudemcp

# Create local MCP configuration
cat > .claudemcp/mcp-config.sh << 'EOFCONFIG'
#!/bin/bash
# Local ClaudeMcpTools MCP Configuration

PROJECT_DIR=$(pwd)
MCPTOOLS_DIR="$PROJECT_DIR/mcptools"

echo "🔧 Setting up ClaudeMcpTools MCP for this project..."
echo "   Project: $PROJECT_DIR"
echo "   McpTools: $MCPTOOLS_DIR"
echo ""

echo "Add these MCP servers to Claude Code:"
echo ""
echo "# Basic file operations:"
echo "claude mcp add $(basename "$PROJECT_DIR")-mcp-tools '$MCPTOOLS_DIR/start-server.sh'"
echo ""
echo "# Full orchestration (recommended):"
echo "claude mcp add $(basename "$PROJECT_DIR")-mcp-orchestration '$MCPTOOLS_DIR/start-orchestration.sh'"
echo ""
echo "# Then restart Claude Code and use the tools!"
EOFCONFIG

chmod +x .claudemcp/mcp-config.sh

# Create or update CLAUDE.md with ClaudeMcpTools instructions using unique delimiters
CLAUDE_SECTION='
<!-- zzClaudeMcpToolszz START -->
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
<!-- zzClaudeMcpToolszz END -->
'

if [ ! -f "CLAUDE.md" ]; then
    echo "📝 Creating CLAUDE.md with ClaudeMcpTools integration..."
    echo "$CLAUDE_SECTION" > CLAUDE.md
    echo "✅ CLAUDE.md created with ClaudeMcpTools integration"
else
    echo "📝 Updating ClaudeMcpTools section in existing CLAUDE.md..."
    
    # Check if ClaudeMcpTools section exists using unique delimiters
    if grep -q "<!-- zzClaudeMcpToolszz START -->" CLAUDE.md; then
        echo "   Found existing ClaudeMcpTools section, replacing..."
        
        # Create temporary file for replacement
        TMP_FILE=$(mktemp)
        
        # Replace the section between the delimiters
        awk '
        /<!-- zzClaudeMcpToolszz START -->/ { skip=1; next }
        /<!-- zzClaudeMcpToolszz END -->/ { skip=0; next }
        !skip { print }
        ' CLAUDE.md > "$TMP_FILE"
        
        # Add the new section
        echo "" >> "$TMP_FILE"
        echo "$CLAUDE_SECTION" >> "$TMP_FILE"
        
        # Replace the original file
        mv "$TMP_FILE" CLAUDE.md
        echo "✅ ClaudeMcpTools section updated in CLAUDE.md"
    else
        echo "   No existing ClaudeMcpTools section found, adding new section..."
        echo "" >> CLAUDE.md
        echo "$CLAUDE_SECTION" >> CLAUDE.md
        echo "✅ ClaudeMcpTools section added to CLAUDE.md"
    fi
fi

# Add to .gitignore if it exists
if [ -f ".gitignore" ]; then
    if ! grep -q "mcptools" .gitignore; then
        echo "" >> .gitignore
        echo "# ClaudeMcpTools local symlink" >> .gitignore
        echo "mcptools" >> .gitignore
        echo "✅ Added mcptools to .gitignore"
    else
        echo "✅ mcptools already in .gitignore"
    fi
fi

# Configure Claude Code permissions for this project
echo ""
echo "🔒 Configuring Claude Code permissions for this project..."

LOCAL_CLAUDE_SETTINGS=".claude/settings.local.json"
if [ -f "$BIN_DIR/claude-mcp-tools" ]; then
    mkdir -p .claude
    cd "$PROJECT_DIR"
    if echo "1" | "$BIN_DIR/claude-mcp-tools" permissions > /dev/null 2>&1; then
        echo "✅ Claude permissions configured for this project"
        echo "   • All ClaudeMcpTools compatible tools enabled"
        echo "   • Problematic tools (NotebookRead/Edit) disabled"
        echo "   • Settings saved to: $LOCAL_CLAUDE_SETTINGS"
    else
        echo "⚠️  Could not configure project permissions automatically"
    fi
else
    echo "⚠️  CLI tool not found"
    echo "   Run: claude-mcp-tools permissions (when available)"
fi

echo ""
echo "🎉 ClaudeMcpTools project setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Run MCP configuration: ./.claudemcp/mcp-config.sh"
echo "2. Copy the output commands and run them"
echo "3. Restart Claude Code"
echo "4. Start using ClaudeMcpTools with Claude!"
echo ""
echo "📚 Documentation: ./CLAUDE.md"
echo "🔍 Verify tools: Ask Claude to 'list available MCP tools'"
EOF

chmod +x "$BIN_DIR/claude-mcp-setup"

echo "✅ Global CLI tools created:"
echo "   • claude-mcp-tools (main CLI)"
echo "   • claude-mcp-setup (project setup)"

# Configure Claude Code permissions
echo ""
if [ "$AUTO_PERMISSIONS" = "true" ]; then
    echo "🔒 Configuring Claude Code permissions automatically..."
    
    # Configure for current working directory (project-specific)
    CURRENT_DIR=$(pwd)
    PROJECT_CLAUDE_DIR="$CURRENT_DIR/.claude"
    PROJECT_SETTINGS="$PROJECT_CLAUDE_DIR/settings.local.json"
    
    echo "   Setting up project-specific permissions for: $(basename "$CURRENT_DIR")"
    mkdir -p "$PROJECT_CLAUDE_DIR"
    
    # Run the CLI permission configuration for project
    if [ -f "$BIN_DIR/claude-mcp-tools" ]; then
        cd "$CURRENT_DIR"
        if echo "1" | "$BIN_DIR/claude-mcp-tools" permissions > /dev/null 2>&1; then
            echo "✅ Project permissions configured: $PROJECT_SETTINGS"
            echo "   • All ClaudeMcpTools compatible tools enabled"
            echo "   • Problematic tools (NotebookRead/Edit) disabled"
        else
            echo "⚠️  Could not configure project permissions automatically"
        fi
        cd "$SCRIPT_DIR"
    else
        echo "⚠️  CLI tool not found"
    fi
else
    echo "🔒 Skipping automatic permission configuration"
    echo "   You can configure them later with: claude-mcp-tools permissions"
fi

# Test the installation
echo ""
echo "🧪 Testing installation..."
if command -v claude-mcp-tools &> /dev/null; then
    echo "✅ claude-mcp-tools command available"
else
    echo "⚠️  claude-mcp-tools not in PATH - you may need to restart your shell"
fi

if command -v claude-mcp-setup &> /dev/null; then
    echo "✅ claude-mcp-setup command available"
else
    echo "⚠️  claude-mcp-setup not in PATH - you may need to restart your shell"
fi

# Auto-configure MCP servers if requested
echo ""
if [ "$AUTO_MCP_CONFIG" = "true" ]; then
    echo "🔧 Auto-configuring MCP servers..."
    
    # Add orchestration server to Claude Code
    if claude mcp add claude-mcp-orchestration "$INSTALL_DIR/start-orchestration.sh" 2>/dev/null; then
        echo "✅ Orchestration server added to Claude Code"
    else
        echo "⚠️  Could not auto-configure MCP server (Claude CLI might not be ready)"
        echo "   You can configure manually with: claude-mcp-tools configure"
    fi
else
    echo "🔧 Skipping automatic MCP server configuration"
    echo "   Run: claude-mcp-tools configure (to set up MCP servers)"
fi

echo ""
echo "🎉 ClaudeMcpTools Global Installation Complete!"
echo ""
echo "📋 What was installed:"
echo "   • ClaudeMcpTools package (globally with UV)"
echo "   • Global installation at: $INSTALL_DIR"
echo "   • CLI tools: claude-mcp-tools, claude-mcp-setup"
echo "   • Data storage: $HOME/.claude/zmcptools"
if [ "$AUTO_CONFIGURE" = "1" ]; then
    echo "   • Project settings: $(pwd)/.claude/settings.local.json"
    echo "   • MCP server configured in Claude Code"
fi
echo ""
echo "🚀 Quick start:"
if [ "$AUTO_CONFIGURE" = "1" ]; then
    echo "   1. Restart Claude Code to use the new tools"
    echo "   2. Use /mcp to see 120+ available tools"
    echo "   3. Try: spawn_agents_batch() for parallel agents"
else
    echo "   1. claude-mcp-tools configure    # Get MCP setup commands"
    echo "   2. claude-mcp-tools orchestration # Start the server"
    echo "   3. cd /your/project && claude-mcp-setup  # Add to projects"
fi
echo ""
echo "📚 Get help: claude-mcp-tools (no arguments)"