# ClaudeMcpTools

🚀 **TypeScript MCP Tools for Claude Code** - Complete multi-agent orchestration with enhanced CLI, documentation intelligence, and advanced file operations. Built with TypeScript for type safety and performance.

## ✨ Features

### 🎯 **Architect-Led Multi-Agent Orchestration**
- **Intelligent Coordination**: Architect agents analyze objectives and spawn specialized teams
- **Agent Dependencies**: Backend → Frontend → Testing → Documentation workflows
- **Real-Time Communication**: Agents coordinate through dedicated chat rooms
- **Foundation Sessions**: 85-90% cost reduction through shared context
- **40 Enhanced Tools**: Complete orchestration with seamless Claude Code integration

### 🎨 **TypeScript CLI Experience**
- **Type-Safe Interface**: Built with Commander.js for robust command handling
- **Development Setup**: `pnpm install && pnpm run install:global` and you're ready!
- **Structured Commands**: Organized command hierarchy for agent, task, and memory management
- **Binary Access**: Available via `claude-mcp-tools` and `claude-mcp-server`
- **Development Tools**: Hot-reload development with tsx

### 🎛️ **CLI Management**
- **Agent Operations**: Command-line agent spawning and monitoring
- **Task Management**: CLI-based task creation and tracking
- **Memory Operations**: Search and manage shared agent memory
- **Room Communication**: Join and manage agent communication rooms
- **Status Reporting**: System health and component status

### 📂 Enhanced File Operations (3 tools)
- **Smart File Listing**: Hierarchical ignore patterns with `.claudeignore` and `.gitignore` support
- **Pattern-Based Search**: Advanced glob pattern matching with ignore pattern respect
- **Fuzzy String Replacement**: Whitespace-normalized matching with similarity thresholds

### 🌳 Project Analysis (7 tools)  
- **Project Structure Analysis**: Generate AI-optimized `.treesummary` files with TypeScript parsing
- **File Symbol Extraction**: Advanced code analysis with function, class, and variable detection
- **Tree Summary Generation**: Comprehensive project overviews with metadata tracking
- **File Analysis Management**: Update, remove, and cleanup project analysis data
- **Project Metadata**: Store and retrieve project-specific configuration and insights

### 📚 Documentation Intelligence with LanceDB (9 tools)
- **Browser Automation**: Playwright-powered web scraping with session management
- **LanceDB Vector Storage**: Advanced semantic search with local vector database
- **Multi-Provider Embeddings**: Support for OpenAI, HuggingFace, and local models
- **Advanced Web Scraping**: Multi-page documentation collection with automatic vectorization
- **Content Navigation**: Intelligent page interaction and content extraction
- **Vector Search**: High-performance similarity search with configurable thresholds
- **Scraping Orchestration**: Job management with start/stop worker capabilities
- **Documentation Sources**: Track and manage scraped documentation repositories
- **Local Storage**: All data stored at `~/.mcptools/data/` with LanceDB at `~/.mcptools/lancedb/`

### 🧠 Foundation Cache System (7 tools)
- **Foundation Sessions**: Create shared context sessions for 85-90% cost reduction
- **Session Derivation**: Derive new sessions from existing foundations
- **Analysis Caching**: Cache and retrieve expensive analysis results
- **Cache Statistics**: Monitor cache performance and hit rates
- **Cache Maintenance**: Automated cleanup and invalidation management

### 🤖 Multi-Agent Orchestration (9 tools)
- **Agent Spawning**: Specialized development agents with real-time communication
- **Task Management**: Create, assign, and track complex development tasks
- **Shared Memory**: Cross-agent collaboration and knowledge sharing
- **Error Learning**: Pattern recognition for improved reliability
- **SQLite Coordination**: Persistent state management

## 🚀 Quick Installation

### Prerequisites
- **Node.js 18+**: Required for TypeScript runtime and LanceDB native bindings
- **Package Manager**: npm (included), yarn, pnpm, or bun
- **Claude CLI**: Anthropic's Claude Code CLI

### Installation

```bash
# Clone the repository
git clone https://github.com/zachhandley/ClaudeMcpTools
cd ClaudeMcpTools

# Option 1: Automated (recommended)
./install.sh

# Option 2: Manual steps
pnpm install          # Install dependencies (or npm/yarn/bun)
pnpm build            # Build TypeScript
pnpm link --global    # Make claude-mcp-tools command available
claude-mcp-tools install  # Configure MCP server and project
```

**After installation, you'll have:**
- ✅ `claude-mcp-tools` command available globally
- ✅ MCP server configured in Claude Code
- ✅ Project permissions and CLAUDE.md setup
- ✅ SQLite database initialized for agent coordination
- ✅ LanceDB vector database ready for semantic search

### MCP Server Configuration

```bash
# Add the MCP server to Claude Code
claude mcp add claude-mcp-tools /path/to/ClaudeMcpTools/dist/index.js

# Verify the server is configured
claude mcp list
```

**This provides:**
- ✅ Core MCP server with 42 tools (including LanceDB)
- ✅ Multi-agent orchestration capabilities
- ✅ TypeScript type safety and performance
- ✅ SQLite-based data persistence
- ✅ LanceDB vector database for semantic search
- ✅ Advanced file operations and project analysis
- ✅ Documentation intelligence with vector embeddings
- ✅ Foundation session caching for cost optimization

## 📋 Prerequisites

ClaudeMcpTools TypeScript requires the following:

### Required
- **[Node.js 18+](https://nodejs.org/)** - JavaScript runtime and LanceDB native bindings
- **Package Manager** - npm (included), yarn, pnpm, or bun
- **[Claude CLI](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's Claude Code CLI

### Optional
- **TypeScript**: For development (`npm install -g typescript`)
- **TSX**: For development hot-reload (included in devDependencies)

**Note**: This TypeScript implementation includes native LanceDB vector database with no Python dependencies required.

## 🎯 Architect-Led Orchestration

### Core Workflow

```javascript
// Let the architect coordinate multiple specialized agents
await orchestrate_objective({
    objective: "Implement OAuth login with comprehensive tests and documentation",
    repository_path: ".",
    foundation_session_id: "shared-context-123"  // 85-90% cost reduction
});
```

**The architect will:**
1. **Analyze** the objective and break it into specialized tasks
2. **Spawn** coordinated agents (backend → frontend → testing → documentation)
3. **Coordinate** agent dependencies and communication
4. **Monitor** progress through real-time agent chat

### Example Multi-Agent Workflows

**Full-Stack Feature Development:**
```javascript
// Architect spawns: Backend Agent → Frontend Agent → Testing Agent → Docs Agent
await orchestrate_objective({
    objective: "Add user authentication with JWT, login UI, tests, and API docs",
    repository_path: "."
});
```

**Development Environment Setup:**
```javascript
// Architect spawns: Dev Server Agent + Playwright Testing Agent (parallel)
await orchestrate_objective({
    objective: "Set up development server and end-to-end testing pipeline",
    repository_path: "."
});
```

**Documentation-Driven Development:**
```javascript
// Architect spawns: Docs Scraper → Analyzer → Implementation Agents
await orchestrate_objective({
    objective: "Study React docs and implement component library following best practices",
    repository_path: "."
});
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
claude-mcp-tools agent spawn -t <type> -r <repository> -d <description>
claude-mcp-tools agent terminate -i <agent-id>

# Task management
claude-mcp-tools task list
claude-mcp-tools task create -t <title> -d <description>

# Memory operations
claude-mcp-tools memory search -q <query>
claude-mcp-tools memory store -t <title> -c <content>

# Communication rooms
claude-mcp-tools room list
claude-mcp-tools room join -n <name>
```

### 🛠️ Development Commands

```bash
# Initial setup (one time - using pnpm)
pnpm install                   # Install dependencies first
pnpm run install:global       # Build, link globally, and configure everything

# Alternative package managers
npm install && npm run build && npm link && claude-mcp-tools install
yarn install && yarn build && yarn link && claude-mcp-tools install
bun install && bun run build && bun link && claude-mcp-tools install

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

# Management (available globally after setup)
claude-mcp-tools install    # Install/reinstall
claude-mcp-tools uninstall  # Remove installation
pnpm run uninstall:global   # Remove and unlink in one command
claude-mcp-tools status     # Check system status
claude-mcp-tools help       # Show all commands
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
alias mcp-dev="npm run dev"
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

# Development scripts (works with npm/yarn/pnpm/bun)
npm run dev       # Hot-reload development
npm run build     # Production build
npm test          # Run test suite
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

```javascript
// Complex feature with coordinated agents
await orchestrate_objective({
    objective: "Implement user authentication with tests and comprehensive documentation",
    repository_path: ".",
    foundation_session_id: "auth-implementation-2024"
});

// Development workflow with parallel agents
await orchestrate_objective({
    objective: "Set up dev server on port 3000 and run Playwright tests against it",
    repository_path: "."
});

// Documentation-driven development
await orchestrate_objective({
    objective: "Scrape Next.js docs and implement app following official patterns",
    repository_path: "."
});
```

### Enhanced File Operations

```javascript
// Smart file listing with ignore patterns
await list_files({ directory: ".", show_hidden: true, max_depth: 3 });

// Fuzzy string replacement
await easy_replace({ file_path, search_text, replace_text, similarity_threshold: 0.8 });

// Pattern-based file search
await find_files({ pattern: "*.ts", directory: ".", include_hidden: true });

// Cross-platform screenshots
await take_screenshot({ output_path: "screenshot.png", region: [0, 0, 1920, 1080] });
```

### Project Analysis

```javascript
// Generate project analysis
await analyze_project_structure({ project_path: "/path/to/project", output_format: "treesummary" });

// Extract code symbols
await analyze_file_symbols({ file_path: "src/main.ts", include_dependencies: true });

// Generate AI-optimized summaries
await generate_project_summary({ project_path: "/path/to/project", focus_areas: ["architecture"] });

// Real-time monitoring
await watch_project_changes({ project_path: "/path/to/project", watch_patterns: ["*.ts", "*.js"] });
```

### Documentation Intelligence with LanceDB

```javascript
// Scrape technical documentation with LanceDB vector indexing
await scrape_documentation({
    url: "https://docs.anthropic.com/en/docs/claude-code",
    crawl_depth: 3,
    selectors: { content: "main", title: "h1" },
    embedding_provider: "openai", // or "local" or "huggingface"
    collection_name: "claude-docs"
});

// Semantic search with LanceDB vector embeddings
await search_documentation({
    query: "MCP server configuration",
    limit: 10,
    similarity_threshold: 0.8,
    collection: "claude-docs"
});

// Advanced vector search
await search_vectors({
    collection: "claude-docs",
    query: "authentication setup",
    options: { limit: 5, include_metadata: true }
});

// Cross-reference docs with code using vector similarity
await link_docs_to_code({
    project_path: "/path/to/project",
    confidence_threshold: 0.85,
    use_vector_search: true
});
```

### Manual Agent Coordination

```javascript
// Spawn agents with dependencies (testing waits for implementation)
const backend_agent = await spawn_agent({
    agent_type: "backend", 
    repository_path: ".", 
    task_description: "Implement OAuth API endpoints"
});
const frontend_agent = await spawn_agent({
    agent_type: "frontend", 
    repository_path: ".", 
    task_description: "Create login UI components"
});

// Testing agent waits for both implementation agents
const test_agent = await spawn_agent({
    agent_type: "testing", 
    repository_path: ".", 
    task_description: "Create comprehensive OAuth flow tests",
    depends_on: [backend_agent.agent_id, frontend_agent.agent_id]
});

// Documentation agent waits for everything
const docs_agent = await spawn_agent({
    agent_type: "documentation", 
    repository_path: ".", 
    task_description: "Document the OAuth implementation", 
    depends_on: [backend_agent.agent_id, frontend_agent.agent_id, test_agent.agent_id]
});

// Real-time agent communication
await join_room({ room_name: "dev-team", agent_name: "implementer-1" });
await send_message({ room_name: "dev-team", message: "Feature complete", mentions: ["tester-1"] });
```

## 🛡️ MCP Protocol Compliance

### Full MCP 1.15.0 Compatibility
- **JSON-RPC 2.0**: Complete implementation with proper message handling
- **Stdio Transport**: High-performance local process communication
- **Tool Definitions**: 40 tools with comprehensive input schemas and validation
- **Error Handling**: Standardized MCP error codes and proper error propagation
- **Initialization Protocol**: Full handshake with capability negotiation

### TypeScript MCP Implementation
```typescript
// Server initialization with MCP SDK
const server = new Server({
  name: "claude-mcp-tools",
  version: "0.1.0"
}, {
  capabilities: {
    tools: {}  // Full tool capability support
  }
});

// Tool handler with proper MCP error handling
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await handleToolCall(request.params.name, request.params.arguments);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error.message}`);
  }
});
```

### MCP Best Practices Implemented
- **Input Validation**: Zod schemas for runtime type safety
- **Proper Error Handling**: MCP-compliant error responses with detailed messages
- **Tool Annotations**: Descriptive schemas with security hints where applicable
- **Resource Management**: SQLite database connections with proper cleanup
- **Transport Security**: Stdio transport for secure local communication

## 🏗️ Architecture

### Modern CLI with TypeScript
- **Commander.js Framework**: Type-safe commands with automatic help generation
- **Console Formatting**: Colored output and structured command display
- **CLI Interface**: Comprehensive command structure for all operations
- **Status Reporting**: Real-time feedback for operations and system health

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
- **Vector Storage**: `~/.mcptools/lancedb/` (LanceDB vector database)
- **Main Database**: `~/.mcptools/data/claude_mcp_tools.db`
- **All Data**: Agents, tasks, memory, and documentation in SQLite database
- **Vector Data**: Embeddings and vector indices stored in LanceDB
- **Cache**: Foundation session cache in memory/disk with vector index caching

## 🛠️ Development

```bash
# Clone and setup development environment
git clone https://github.com/zachhandley/ClaudeMcpTools
cd ClaudeMcpTools
pnpm install

# Quick setup
pnpm run install:global && mcp-tools install # Build, link

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
✅ SQLite Database: claude_mcp_tools.db
✅ LanceDB Vector Database: ~/.mcptools/lancedb/
✅ MCP Server: claude-mcp-server binary available
✅ Dependencies: @modelcontextprotocol/sdk, @lancedb/lancedb, better-sqlite3
```

### Development Workflow

```bash
$ npm run dev
```

```
Starting TypeScript development server...
✅ TypeScript compilation successful
✅ MCP server starting on stdio
✅ SQLite databases initialized
✅ LanceDB vector database initialized
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
pnpm --version          # Package manager (or npm/yarn/bun)
claude --version        # Claude CLI required

# Clean installation
rm -rf node_modules dist
pnpm install
pnpm build

# Development installation
git clone https://github.com/zachhandley/ClaudeMcpTools
cd ClaudeMcpTools
pnpm install && pnpm run install:global
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
pnpm dev                            # Hot-reload development

# Database issues
rm -rf ~/.mcptools/data/*.db        # Reset databases
node dist/index.js                   # Reinitialize

# Dependency issues
rm -rf node_modules pnpm-lock.yaml
pnpm install                        # Clean dependency install
```

## 📈 Performance & Optimization

### Current Metrics
- **42 Tools**: Comprehensive MCP tool suite with LanceDB vector capabilities and full type safety
- **Database**: SQLite with WAL mode for optimal performance
- **Vector Storage**: LanceDB with native TypeScript bindings for high-performance similarity search
- **Memory Footprint**: < 75MB baseline with efficient connection pooling and vector index caching
- **Response Time**: < 200ms average for tool execution, < 100ms for vector search queries
- **Foundation Cache**: 85-90% cost reduction for repeated operations

### Optimization Roadmap
Our comprehensive MCP optimization analysis (see `MCP_OPTIMIZATION_ANALYSIS.md`) identifies key areas:

1. **Enhanced Error Handling**: MCP-compliant error taxonomy and better user feedback
2. **Resource Implementation**: MCP resources for project data and agent status
3. **Performance Monitoring**: Tool metrics, response times, and usage analytics
4. **Transport Extensions**: HTTP transport support for remote MCP capabilities

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with tests
4. Test with Claude Code integration
5. Submit a pull request

### Development Guidelines
- Follow TypeScript strict mode requirements
- Add comprehensive error handling with MCP compliance
- Include tool annotations for destructive/read-only operations
- Test all changes with the actual MCP server integration

## 📜 License

MIT License - see LICENSE file for details.

---

**🚀 Supercharge your Claude Code workflows with TypeScript-powered multi-agent orchestration, LanceDB vector search, type-safe development, enhanced performance, and intelligent development assistance!**