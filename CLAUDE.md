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
# Dead code detection removed - was unimplemented

### Documentation Intelligence & Vector Search (For Context-Aware Development)
- `scrape_documentation(url="https://docs.example.com")` - Scrape and index docs with LanceDB vector storage
- `search_documentation(query="API usage")` - Semantic search with LanceDB embeddings
- `link_docs_to_code(project_path=".")` - Connect docs to code using vector similarity
- `create_vector_collection(name, embedding_provider)` - Create LanceDB collections for custom embeddings
- `search_vectors(collection, query, limit, threshold)` - Advanced vector similarity search
- `manage_embeddings(provider="local|openai|huggingface")` - Configure embedding providers

### LanceDB Vector Database (Native TypeScript)
- **Local Vector Storage**: High-performance vector database stored locally at `~/.mcptools/lancedb/`
- **Embedding Providers**: Support for OpenAI, HuggingFace, and local models
- **Real-time Indexing**: Automatic vector indexing during documentation scraping
- **Similarity Search**: Fast vector similarity search with configurable thresholds
- **Collection Management**: Create, update, and delete vector collections
- **TypeScript Native**: No Python dependencies required - pure TypeScript implementation

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

Data stored locally at `~/.mcptools/data/` with LanceDB vector storage at `~/.mcptools/lancedb/`, intelligent caching and cross-agent memory sharing.
<!-- zzClaudeMcpToolszz END -->


<!-- zzClaudeMcpToolsTypescriptzz START -->
# ClaudeMcpTools TypeScript Integration

This project uses the TypeScript implementation of ClaudeMcpTools for enhanced MCP tools and multi-agent orchestration.

## 🎯 Agent Orchestration Commands

### Core Agent Operations
- `spawn_agent(type, repository_path, task_description)` - Create specialized agents
- `list_agents(repository_path, status_filter)` - View active agents
- `terminate_agent(agent_id)` - Stop specific agents
- `orchestrate_objective(objective, repository_path)` - Coordinate multi-agent workflows

### Task Management
- `create_task(repository_path, task_type, title, description)` - Create development tasks
- `list_tasks(repository_path, status_filter)` - View task status
- `assign_task(task_id, agent_id)` - Assign tasks to agents

### Shared Memory & Communication
- `store_memory(repository_path, agent_id, entry_type, title, content)` - Store insights
- `search_memory(repository_path, query_text)` - Search previous work
- `join_room(room_name, agent_name)` - Real-time agent communication
- `send_message(room_name, message, mentions)` - Coordinate via chat
- `list_rooms(repository_path, status, limit, offset)` - List communication rooms
- `list_room_messages(room_name, limit, offset)` - View room chat history
- `close_room(room_name, terminate_agents)` - Close room and cleanup agents
- `delete_room(room_name, force_delete)` - Permanently delete room

### Enhanced File Operations
- `list_files(directory, show_hidden, max_depth)` - Smart file listing
- `find_files(pattern, directory)` - Pattern-based search
- `easy_replace(file_path, old_text, new_text)` - Fuzzy string replacement
- `take_screenshot(output_path, region)` - Cross-platform screenshots

### Documentation Intelligence
- `scrape_documentation(url, crawl_depth, selectors)` - Web scraping
- `search_documentation(query, limit, similarity_threshold)` - Semantic search
- `analyze_project_structure(project_path, output_format)` - Code analysis

## 🚀 Example Workflows

### Multi-Agent Development
```typescript
// Spawn coordinated agents for full-stack development
const backendAgent = await spawn_agent("backend", ".", "Implement REST API endpoints");
const frontendAgent = await spawn_agent("frontend", ".", "Create React components");
const testAgent = await spawn_agent("testing", ".", "Write comprehensive tests");

// Use shared memory for coordination
await store_memory(".", backendAgent.id, "api_design", "REST Endpoints", 
  "Implemented /users, /auth, /data endpoints with TypeScript types");
```

### Documentation-Driven Development
```typescript
// Scrape framework docs first
await scrape_documentation("https://docs.framework.com", 2);

// Implement following best practices
await orchestrate_objective(
  "Build app following official framework patterns from scraped docs", 
  "."
);
```

### Development Environment Setup
```typescript
// Coordinate development and testing
await orchestrate_objective(
  "Set up dev server and run tests in parallel",
  "."
);
```

## 📋 CLI Commands

```bash
# Agent management
claude-mcp-tools agent list --repository .
claude-mcp-tools agent spawn --type backend --repository . --description "API development"

# Task management  
claude-mcp-tools task list --repository .
claude-mcp-tools task create --type feature --title "User Auth"

# Memory operations
claude-mcp-tools memory search --query "authentication" --repository .

# Communication
claude-mcp-tools room list --repository .

# System status
claude-mcp-tools status
```

## 🏗️ TypeScript Features

- **Type Safety**: Full TypeScript implementation with strict mode
- **Performance**: Better-sqlite3 for high-performance database operations  
- **Modern ES Modules**: Tree-shaking and efficient imports
- **Hot Reload Development**: TSX for development mode
- **Comprehensive Testing**: Vitest with TypeScript support

## 📊 Data Storage

- **Databases**: `~/.mcptools/data/*.db` (SQLite)
- **Configuration**: `./.claude/settings.local.json`
- **Agent Coordination**: Real-time via shared database
- **Memory Sharing**: Cross-agent insights and learning

🎯 **Recommended**: Start with `orchestrate_objective()` for complex multi-step tasks. The system will coordinate specialized agents with proper dependencies and shared context.

Data stored locally with intelligent caching and cross-agent memory sharing.
<!-- zzClaudeMcpToolsTypescriptzz END -->