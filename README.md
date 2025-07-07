# ClaudeMcpTools

🚀 **TypeScript MCP Tools for Claude Code** - Complete multi-agent orchestration with enhanced CLI, documentation intelligence, and advanced file operations. Built with TypeScript for type safety and performance.

## ✨ Features

### 🎯 **Architect-Led Multi-Agent Orchestration**
- **Intelligent Coordination**: Architect agents analyze objectives and spawn specialized teams
- **Agent Dependencies**: Backend → Frontend → Testing → Documentation workflows
- **Real-Time Communication**: Agents coordinate through dedicated chat rooms
- **Foundation Sessions**: 85-90% cost reduction through shared context
- **65+ Enhanced Tools**: Complete orchestration with seamless Claude Code integration

### 🎨 **TypeScript CLI Experience**
- **Type-Safe Interface**: Built with Commander.js for robust command handling
- **Development Setup**: `pnpm install && pnpm build` and you're ready!
- **Structured Commands**: Organized command hierarchy for agent, task, and memory management
- **Binary Access**: Available via `claude-mcp-tools` and `claude-mcp-server`
- **Development Tools**: Hot-reload development with tsx

### 🎛️ **CLI Management**
- **Agent Operations**: Command-line agent spawning and monitoring
- **Task Management**: CLI-based task creation and tracking
- **Memory Operations**: Search and manage shared agent memory
- **Room Communication**: Join and manage agent communication rooms
- **Status Reporting**: System health and component status

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

### Prerequisites
- **Node.js 18+**: Required for TypeScript runtime
- **PNPM**: Package manager (`npm install -g pnpm`)
- **Claude CLI**: Anthropic's Claude Code CLI

### Installation

```bash
# Clone the repository
git clone https://github.com/zachhandley/ClaudeMcpTools
cd ClaudeMcpTools

# Install dependencies
pnpm install

# Build the project
pnpm build

# Link for global access (optional)
npm link
```

### MCP Server Configuration

```bash
# Add the MCP server to Claude Code
claude mcp add claude-mcp-tools /path/to/ClaudeMcpTools/dist/index.js

# Verify the server is configured
claude mcp list
```

**This provides:**
- ✅ Core MCP server with 65+ tools
- ✅ Multi-agent orchestration capabilities
- ✅ TypeScript type safety and performance
- ✅ SQLite-based data persistence
- ✅ Advanced file operations and project analysis
- ✅ Documentation intelligence and web scraping
- ✅ Foundation session caching for cost optimization

## 📋 Prerequisites

ClaudeMcpTools TypeScript requires the following:

### Required
- **[Node.js 18+](https://nodejs.org/)** - JavaScript runtime
- **[PNPM](https://pnpm.io/)** - Package manager: `npm install -g pnpm`
- **[Claude CLI](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's Claude Code CLI

### Optional
- **TypeScript**: For development (`pnpm add -g typescript`)
- **TSX**: For development hot-reload (included in devDependencies)

**Note**: The TypeScript implementation provides better type safety and performance compared to the Python version.

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
# Show help and available commands
claude-mcp-tools --help

# Show system status
claude-mcp-tools status

# Start the MCP server
claude-mcp-server

# Agent management
claude-mcp-tools agent list
claude-mcp-tools agent spawn <type> <task>
claude-mcp-tools agent terminate <id>

# Task management
claude-mcp-tools task list
claude-mcp-tools task create <title> <description>

# Memory operations
claude-mcp-tools memory search <query>
claude-mcp-tools memory store <title> <content>

# Communication rooms
claude-mcp-tools room list
claude-mcp-tools room join <name>
```

### 🛠️ Development Commands

```bash
# Development with hot-reload
pnpm dev          # Start MCP server with tsx
pnpm dev:cli      # Start CLI with tsx

# Building and testing
pnpm build        # Compile TypeScript to dist/
pnpm test         # Run Vitest tests
pnpm test:ui      # Run tests with UI
pnpm test:run     # Run tests once

# Code quality
pnpm lint         # ESLint checking
pnpm typecheck    # TypeScript type checking

# Production
pnpm start        # Start compiled MCP server
pnpm start:cli    # Start compiled CLI
```

**🌟 TypeScript Features:**

- **🎯 Type Safety**
  - Full TypeScript implementation with strict mode
  - Zod schemas for runtime validation
  - Compile-time error checking
  - IntelliSense support in IDEs

- **🚀 Performance**
  - Better-sqlite3 for high-performance database operations
  - ES2022 target with modern optimizations
  - Efficient memory management
  - Fast development with tsx hot-reload

- **🧪 Testing**
  - Vitest for modern testing experience
  - UI mode for interactive test debugging
  - Coverage reports with V8 provider
  - TypeScript test support out of the box

- **📦 Module System**
  - ESNext modules for tree-shaking
  - Clean imports and exports
  - Library mode for programmatic use
  - Dual CLI and server binaries

### Convenient Aliases

The following aliases are available (add to `~/.zshrc`):

```bash
alias mcp-tools="claude-mcp-tools"
alias mcp-server="claude-mcp-server"
alias mcp-status="claude-mcp-tools status"
alias mcp-dev="pnpm dev"
```

## ⚙️ Configuration

### TypeScript Configuration

```bash
# Build configuration in tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "experimentalDecorators": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}

# Package manager configuration
echo 'packageManager="pnpm@10.11.1"' > .npmrc

# Development scripts
pnpm dev          # Hot-reload development
pnpm build        # Production build
pnpm test         # Run test suite
```

**🎯 TypeScript Features:**
- **Strict Type Checking**: Full type safety with strict mode enabled
- **Modern ES Modules**: ESNext target with bundler resolution
- **Development Tools**: tsx for hot-reload, Vitest for testing
- **Code Quality**: ESLint with TypeScript rules
- **Binary Generation**: Dual binaries for CLI and server
- **Library Mode**: Exportable as TypeScript library

### MCP Server Configuration

```bash
# Add the TypeScript MCP server
claude mcp add claude-mcp-tools /path/to/ClaudeMcpTools/dist/index.js

# Alternative: use local binary after npm link
claude mcp add claude-mcp-tools claude-mcp-server

# Verify installation
claude mcp list

# Test server directly
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
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

- **Installation**: Local project directory (`./dist/`)
- **Data Directory**: `~/.mcptools/data/` (SQLite databases)
- **Agent Data**: `~/.mcptools/data/agents.db`
- **Documentation**: `~/.mcptools/data/documentation.db`
- **Cache**: Foundation session cache in memory/disk

## 🛠️ Development

```bash
# Clone and setup development environment
git clone https://github.com/zachhandley/ClaudeMcpTools
cd ClaudeMcpTools
pnpm install

# Development mode
pnpm dev          # Run MCP server with hot-reload
pnpm dev:cli      # Run CLI with hot-reload

# Build and test
pnpm build        # Compile TypeScript
pnpm test         # Run test suite

# Test the binaries
node dist/index.js       # MCP server
node dist/cli/index.js   # CLI interface
```

## 🎨 CLI Examples

### Status Display

```bash
$ claude-mcp-tools status
```

```
ClaudeMcpTools Status:
✅ TypeScript Build: dist/ directory exists
✅ Data Directory: ~/.mcptools/data/
✅ SQLite Databases: agents.db, tasks.db, memory.db
✅ MCP Server: claude-mcp-server binary available
✅ Dependencies: @modelcontextprotocol/sdk, better-sqlite3
```

### Development Workflow

```bash
$ pnpm dev
```

```
Starting TypeScript development server...
✅ TypeScript compilation successful
✅ MCP server starting on stdio
✅ SQLite databases initialized
✅ Agent orchestration ready
✅ Foundation cache system active

Listening for MCP requests...
Press Ctrl+C to stop
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
node --version          # Node.js 18+ required
pnpm --version          # PNPM package manager required
claude --version        # Claude CLI required

# Clean installation
rm -rf node_modules dist
pnpm install
pnpm build

# Development installation
git clone https://github.com/zachhandley/ClaudeMcpTools
cd ClaudeMcpTools
pnpm install
pnpm build
```

### Verification

```bash
# Check build output
ls -la dist/
node dist/index.js --help

# Check data directory
ls -la ~/.mcptools/data/

# Test MCP server
claude mcp list
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

### Server Connection Issues

```bash
# Test TypeScript compilation
pnpm typecheck
pnpm lint

# Test MCP server directly
node dist/index.js

# Debug with development server
pnpm dev

# Check MCP configuration
claude mcp list
claude mcp remove claude-mcp-tools
claude mcp add claude-mcp-tools $(pwd)/dist/index.js
```

### TypeScript Issues

```bash
# Type checking errors
pnpm typecheck                      # Check TypeScript errors
npx tsc --noEmit --pretty           # Detailed type errors

# Runtime errors
node --inspect dist/index.js        # Debug with Node.js inspector
pnpm dev                             # Hot-reload development

# Database issues
rm -rf ~/.mcptools/data/*.db        # Reset databases
node dist/index.js                   # Reinitialize

# Dependency issues
rm -rf node_modules pnpm-lock.yaml
pnpm install                         # Clean dependency install
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

**🚀 Supercharge your Claude Code workflows with TypeScript-powered multi-agent orchestration, type-safe development, enhanced performance, and intelligent development assistance!**