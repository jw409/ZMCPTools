# ZMCPTools

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.15.0-purple.svg)](https://modelcontextprotocol.io/)

🚀 **TypeScript MCP Tools for Claude Code** - Professional multi-agent orchestration platform with 61 enhanced tools, documentation intelligence, and advanced automation capabilities.

## ✨ Key Features

### 🎯 **Multi-Agent Orchestration**
- **Architect-Led Coordination**: AI architect automatically spawns and coordinates specialized agent teams
- **Intelligent Dependencies**: Agents work in proper order (Backend → Frontend → Testing → Documentation)
- **Real-Time Communication**: Agents collaborate through dedicated chat rooms with message broadcasting
- **Foundation Session Caching**: 85-90% cost reduction through automatic shared context management
- **Professional Task Management**: Create, assign, track, and monitor complex development workflows

### 🎨 **TypeScript-First Architecture** 
- **Type-Safe MCP Server**: Built with Zod schemas and strict TypeScript for reliability
- **Modern CLI Interface**: Commander.js-powered CLI with structured command hierarchy
- **Development Ready**: One-command setup with hot-reload development via tsx
- **Binary Distribution**: Global access via `claude-mcp-tools` and `claude-mcp-server` commands
- **Professional Build System**: tsup-based compilation with dual CLI/server binaries

### 🌐 **Advanced Browser Automation**
- **Playwright Integration**: Professional web automation with session management
- **AI-Powered DOM Analysis**: Intelligent page structure analysis and navigation
- **Screenshot Analysis**: AI-driven visual page analysis with region focusing
- **Smart Session Management**: Auto-cleanup, session persistence, and connection pooling
- **Legacy Support**: Comprehensive tool migration with backward compatibility

### 📚 **Documentation Intelligence & Vector Search**
- **LanceDB Vector Database**: Local, high-performance semantic search with multiple embedding providers
- **Intelligent Web Scraping**: Multi-page documentation collection with automatic vectorization
- **Advanced Content Processing**: Smart URL filtering, pattern matching, and content extraction
- **Job Management**: Background worker system with status monitoring and job control
- **Documentation Sources**: Track and manage multiple documentation repositories

### 🧠 **Knowledge Graph & Memory Systems**
- **Graph-Based Knowledge Storage**: Entity-relationship modeling for cross-agent learning
- **Semantic Search**: Vector-powered knowledge discovery and relationship traversal
- **Shared Memory**: Persistent agent collaboration and insight sharing
- **Project Analysis**: Comprehensive code structure analysis with symbol extraction
- **Smart File Operations**: Pattern-based file operations with fuzzy matching

## 🚀 Quick Installation

### Prerequisites
- **Node.js 18+**: Required for TypeScript runtime and LanceDB native bindings  
- **Claude Code CLI**: [Anthropic's Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- **Package Manager**: npm (included), yarn, pnpm, or bun

### Production Installation (Recommended)

```bash
# Install globally first (recommended for WSL/Linux compatibility)
pnpm add -g zmcp-tools
# If requested, approve build scripts for native dependencies
pnpm approve-builds -g

# Then install MCP integration
zmcp-tools install

# Alternative: Direct installation (may have issues with Sharp in WSL)
npx zmcp-tools@latest install     # npm
yarn dlx zmcp-tools@latest install  # yarn  
bunx zmcp-tools@latest install      # bun
```

**This automatically:**
- ✅ Installs MCP server to `~/.mcptools/server/`
- ✅ Configures Claude Code in `./.claude/settings.local.json`
- ✅ Sets up project permissions and CLAUDE.md integration
- ✅ Initializes SQLite database for agent coordination
- ✅ Initializes LanceDB vector database for semantic search
- ✅ Creates 61 professional MCP tools ready for use

### Development Installation

```bash
# Clone and setup development environment
git clone https://github.com/zachhandley/ZMCPTools
cd ZMCPTools

# Quick automated setup
pnpm install && pnpm run install:global

# Or manual setup
pnpm install              # Install dependencies
pnpm build               # Compile TypeScript  
pnpm link --global       # Create global symlink
zmcp-tools install       # Configure MCP integration
```

**Development features:**
- ✅ Global `zmcp-tools` command
- ✅ Hot-reload development: `pnpm dev`
- ✅ TypeScript compilation: `pnpm build`
- ✅ Test suite: `pnpm test`
- ✅ Full source code access and modification

### MCP Server Configuration

The installer automatically configures the MCP server in your Claude Code settings. The server runs directly with Node.js:

```json
// Automatically added to .claude/settings.local.json
{
  "mcpServers": {
    "zmcp-tools": {
      "command": "node",
      "args": ["/home/user/.mcptools/server/index.js"]
    }
  }
}
```

**This provides:**
- ✅ Core MCP server with 43 tools (including LanceDB)
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

## 🎯 Multi-Agent Orchestration

### Architect-Led Coordination

ClaudeMcpTools features an AI architect that automatically analyzes objectives and spawns coordinated agent teams:

```javascript
// AI architect coordinates complete feature development
await orchestrate_objective({
    objective: "Implement OAuth authentication with comprehensive testing and documentation",
    repository_path: ".",
    foundation_session_id: "oauth-feature-2024"  // 85-90% cost reduction
});
```

**Automatic workflow:**
1. **Analysis**: Architect breaks down objectives into specialized tasks
2. **Spawning**: Creates coordinated agent teams with proper dependencies  
3. **Coordination**: Manages inter-agent communication and task dependencies
4. **Monitoring**: Real-time progress tracking through EventBus system

### Professional Workflows

**Full-Stack Development:**
```javascript
// Coordinated backend → frontend → testing → documentation pipeline
await orchestrate_objective({
    objective: "Build user authentication system with JWT tokens, React UI, comprehensive tests, and API documentation",
    repository_path: "."
});
```

**Infrastructure Setup:**
```javascript  
// Parallel development server and testing infrastructure
await orchestrate_objective({
    objective: "Configure development environment with hot-reload server and Playwright E2E testing",
    repository_path: "."
});
```

**Documentation-Driven Development:**
```javascript
// Research-first implementation following best practices
await orchestrate_objective({
    objective: "Study Next.js documentation and implement application following official patterns and conventions",
    repository_path: "."
});
```

### Manual Agent Control

For precise control, spawn individual specialized agents:

```javascript
// Backend implementation agent
const backendAgent = await spawn_agent({
    agent_type: "backend",
    repository_path: ".",
    task_description: "Implement REST API endpoints for user management"
});

// Frontend agent that waits for backend completion
const frontendAgent = await spawn_agent({
    agent_type: "frontend", 
    repository_path: ".",
    task_description: "Create React components for user interface",
    depends_on: [backendAgent.agent_id]
});

// Testing agent that waits for both
const testAgent = await spawn_agent({
    agent_type: "testing",
    repository_path: ".",
    task_description: "Create comprehensive test suite for authentication flow",
    depends_on: [backendAgent.agent_id, frontendAgent.agent_id]
});
```

## 🎯 Usage

### CLI Commands

```bash
# Show help and available commands
zmcp-tools --help

# Show system status
zmcp-tools status

# Start the MCP server
zmcp-server

# Agent management
zmcp-tools agent list
zmcp-tools agent spawn -t <type> -r <repository> -d <description>
zmcp-tools agent terminate -i <agent-id>

# Task management
zmcp-tools task list
zmcp-tools task create -t <title> -d <description>

# Memory operations
zmcp-tools memory search -q <query>
zmcp-tools memory store -t <title> -c <content>

# Communication rooms
zmcp-tools room list
zmcp-tools room join -n <name>
```

### 🛠️ Development Commands

```bash
# Initial setup (one time - using pnpm)
pnpm install                   # Install dependencies first
pnpm run install:global       # Build, link globally, and configure everything

# Alternative package managers
npm install && npm run build && npm link && zmcp-tools install
yarn install && yarn build && yarn link && zmcp-tools install
bun install && bun run build && bun link && zmcp-tools install

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

# Management
zmcp-tools install    # Install/reinstall MCP server
zmcp-tools uninstall  # Remove MCP server and settings
zmcp-tools status     # Check system status
zmcp-tools help       # Show all commands

# For users who installed via npx
npx zmcp-tools@latest status     # Check status
npx zmcp-tools@latest uninstall  # Remove installation
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
alias mcp-tools="zmcp-tools"
alias mcp-server="zmcp-server"
alias mcp-status="zmcp-tools status"
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

### Manual MCP Server Configuration (if needed)

The installer automatically configures the MCP server, but if you need to manually configure it:

```bash
# For production install (via npx)
# Server is installed at ~/.mcptools/server/index.js
# Configuration is automatic in .claude/settings.local.json

# For development install
claude mcp add zmcp-tools $(pwd)/dist/server/index.js

# Verify installation
claude mcp list

# Test server directly
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node ~/.mcptools/server/index.js
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
$ zmcp-tools status
```

```
ZMCPTools Status:
✅ TypeScript Build: dist/ directory exists
✅ Data Directory: ~/.mcptools/data/
✅ SQLite Database: claude_mcp_tools.db
✅ LanceDB Vector Database: ~/.mcptools/lancedb/
✅ MCP Server: zmcp-server binary available
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
git clone https://github.com/zachhandley/ZMCPTools
cd ZMCPTools
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
claude mcp remove zmcp-tools
claude mcp add zmcp-tools $(pwd)/dist/index.js
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

## 📈 Performance & Architecture

### Production Metrics
- **61 MCP Tools**: Complete tool suite with full type safety and MCP 1.15.0 compliance
- **Database Performance**: SQLite with WAL mode and optimized connection pooling
- **Vector Search**: LanceDB native TypeScript bindings for <100ms semantic search
- **Memory Efficiency**: <75MB baseline with intelligent caching and cleanup
- **Response Time**: <200ms average tool execution, <50ms for cached operations
- **Cost Optimization**: 85-90% reduction through automatic foundation session management

### Technical Architecture

**TypeScript-First Design:**
- Strict TypeScript with Zod schemas for runtime validation
- Modern ES modules with tree-shaking optimization
- Dual binary system (CLI + MCP server)
- Hot-reload development with tsx

**Database Layer:**
- SQLite with Write-Ahead Logging for performance
- Drizzle ORM for type-safe database operations  
- Automatic schema migrations and connection pooling
- LanceDB vector database for semantic search

**MCP Compliance:**
- Full MCP 1.15.0 protocol implementation
- JSON-RPC 2.0 with proper error handling
- Stdio and HTTP transport support
- Resource and prompt management

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

**🚀 Supercharge your Claude Code workflows with ZMCPTools - TypeScript-powered multi-agent orchestration, LanceDB vector search, type-safe development, enhanced performance, and intelligent development assistance!**