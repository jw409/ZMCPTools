<!-- zzZMCPToolszz START -->
# ZMCPTools Integration

This project uses ZMCPTools with enhanced MCP tools and architect-led multi-agent orchestration.

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
<!-- zzZMCPToolszz END -->


<!-- zzZMCPToolsTypescriptzz START -->
# ZMCPTools Agent Operations Guide

This guide provides actionable workflows for Claude agents using the ZMCPTools MCP toolset for autonomous development.

## 🧠 Agent Decision Framework

### When to Use Multi-Agent Orchestration
**ALWAYS use `orchestrate_objective()` for:**
- Tasks requiring 3+ sequential steps
- Full-stack implementations (backend + frontend + tests)
- Complex features requiring multiple specializations
- Documentation scraping + implementation workflows
- Development environment setup + testing

**Use single-agent tools for:**
- Simple file operations
- Quick analysis or investigation
- Single-purpose tasks under 30 minutes

### Foundation Caching Strategy
**Critical for cost optimization:**
```typescript
// Use shared foundation sessions for 85-90% cost reduction
orchestrate_objective(
  "your complex objective",
  ".",
  { foundation_session_id: "project-feature-name-2024" }
)
```

## 🎯 Multi-Agent Coordination Patterns

### 1. Full-Stack Development Pattern
```typescript
// Architect coordinates: Backend → Frontend → Testing → Documentation
orchestrate_objective(
  "Implement user authentication with JWT tokens, React login UI, comprehensive tests, and API documentation",
  "."
)
```

### 2. Documentation-First Pattern
```typescript
// Phase 1: Research and documentation scraping
scrape_documentation("https://docs.framework.com", { max_pages: 50 })
search_knowledge_graph(".", "authentication best practices")

// Phase 2: Implementation following documentation patterns
orchestrate_objective(
  "Build authentication system following scraped framework documentation patterns",
  "."
)
```

### 3. Analysis → Implementation Pattern
```typescript
// Phase 1: Project analysis
analyze_project_structure(".")
generate_project_summary(".")

// Phase 2: Coordinated implementation
orchestrate_objective(
  "Refactor codebase based on analysis findings and implement missing features",
  "."
)
```

## 🔄 Sequential Task Management

### Complex Task Breakdown
1. **Start with `create_task()`** - Define the high-level goal
2. **Use `orchestrate_objective()`** - Let architect break down subtasks
3. **Monitor with `list_agents()`** - Track progress
4. **Coordinate via `join_room()`** - Real-time communication
5. **Store insights with `store_knowledge_memory()`** - Cross-agent learning

### Agent Specialization Types
- **`backend`** - API development, database design, server logic
- **`frontend`** - UI components, state management, user experience
- **`testing`** - Unit tests, integration tests, E2E testing
- **`documentation`** - Technical writing, API docs, README files
- **`devops`** - CI/CD, deployment, infrastructure
- **`analysis`** - Code review, performance analysis, architecture

## 💾 Knowledge Management Workflows

### Before Implementation - Always Research
```typescript
// 1. Search existing knowledge
const insights = await search_knowledge_graph(".", "similar feature implementation")

// 2. Scrape relevant documentation if needed
await scrape_documentation("https://relevant-docs.com")

// 3. Analyze current project structure
await analyze_project_structure(".")
```

### During Implementation - Store Learnings
```typescript
// Store insights for other agents
await store_knowledge_memory(".", agent_id, "technical_decision", 
  "Database Schema Design",
  "Chose PostgreSQL with JSONB for user preferences due to flexible schema needs"
)

// Store error patterns
await store_knowledge_memory(".", agent_id, "error_pattern",
  "React State Management",
  "useState hooks caused re-render issues, switched to useReducer for complex state"
)
```

### After Implementation - Document Outcomes
```typescript
// Store implementation patterns for future use
await store_knowledge_memory(".", agent_id, "implementation_pattern",
  "JWT Authentication Flow",
  "Successful pattern: JWT in httpOnly cookies + CSRF tokens for security"
)
```

## 🚨 Error Recovery Patterns

### When Tasks Fail
1. **Check agent status**: `list_agents(".", "failed")`
2. **Review error logs**: Check shared memory for error patterns
3. **Restart with lessons learned**: Use previous insights in new objective
4. **Isolate problems**: Use single-agent tools for debugging

### Common Recovery Actions
```typescript
// If orchestration fails, break down manually
const task1 = await create_task(".", "research", "Investigate failed component")
const agent1 = await spawn_agent("analysis", ".", "Debug the failing authentication flow")

// Use room coordination for complex debugging
await join_room("debug-session-" + Date.now())
await send_message("debug-session", "Agent investigating auth flow failure", ["analysis-agent"])
```

## 🎨 Agent-Type-Specific Workflows

### Backend Agent Actions
1. Design database schema first
2. Implement core business logic
3. Create API endpoints with proper validation
4. Store API patterns in knowledge graph
5. Coordinate with frontend agent via shared memory

### Frontend Agent Actions  
1. Review backend API specifications from shared memory
2. Create reusable components following project patterns
3. Implement state management
4. Store UI patterns for consistency
5. Coordinate with testing agent for component tests

### Testing Agent Actions
1. Wait for implementation completion (use agent dependencies)
2. Create comprehensive test suites
3. Run tests and store failure patterns
4. Provide feedback to implementation agents
5. Document testing strategies in knowledge graph

### Documentation Agent Actions
1. Wait for feature completion
2. Generate API documentation from code
3. Create user guides and examples
4. Store documentation patterns
5. Ensure consistency across project docs

## 🔧 Tool Usage Priorities

### Phase 1: Analysis (Always First)
1. `analyze_project_structure(".")` - Understand codebase
2. `search_knowledge_graph(".", "relevant query")` - Check existing knowledge
3. `scrape_documentation()` - Get external context if needed

### Phase 2: Planning
1. `create_task()` - Define objectives
2. `orchestrate_objective()` - Break down complex work
3. `join_room()` - Set up coordination

### Phase 3: Implementation
1. Agent-specific tools (`spawn_agent()`, specialized workflows)
2. `store_knowledge_memory()` - Continuous learning
3. `send_message()` - Cross-agent coordination

### Phase 4: Validation
1. `list_agents()` - Check completion status
2. Review stored insights and learnings
3. Run tests and validate implementation

## 💡 Best Practices

### Always Do This
- Start complex tasks with `orchestrate_objective()`
- Use foundation sessions for cost optimization
- Store insights immediately when discovered
- Check existing knowledge before implementing
- Coordinate agents via shared rooms

### Never Do This
- Implement without analysis phase
- Skip documentation scraping for new frameworks
- Ignore shared memory from other agents
- Start multiple agents without coordination
- Forget to store learnings for future agents

### Foundation Session Optimization
- Use descriptive session IDs: "auth-system-v2-2024"
- Share sessions across related agents (85-90% cost reduction)
- Include version numbers for iterative development
- Name sessions after major features or epics

## 🚀 Quick Start Checklist

For any new complex task:
1. ✅ `analyze_project_structure(".")` - Understand the codebase
2. ✅ `search_knowledge_graph(".", "task-related-query")` - Check existing work
3. ✅ `orchestrate_objective("clear objective", ".", {foundation_session_id: "descriptive-name"})` - Coordinate implementation
4. ✅ `join_room("task-coordination")` - Monitor progress
5. ✅ `store_knowledge_memory()` - Document learnings throughout

**Data Location**: `~/.mcptools/data/` (SQLite databases with agent coordination, shared memory, and knowledge graphs)

🎯 **Core Principle**: Always use multi-agent orchestration for complex tasks. Single agents are for investigation and simple operations only.
<!-- zzZMCPToolsTypescriptzz END -->