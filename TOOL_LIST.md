# ZMCPTools - Complete Tool Reference

This document provides a comprehensive reference for all MCP tools and resources available in ZMCPTools.

## ⚡ Token Optimization Notice

**ZMCPTools now uses MCP Resources for read-only operations** - saving ~13,000+ tokens in system prompts!

- **Resources** (~30 tokens): URI-based read operations (file analysis, searches, status)
- **Tools** (~200 tokens): Action-based mutations and complex workflows

See [GitHub Issue #35](https://github.com/jw409/ZMCPTools/issues/35) for migration details.

## Table of Contents

- [🔍 MCP Resources (Token-Optimized)](#mcp-resources-token-optimized)
- [Multi-Agent Orchestration (13 tools)](#multi-agent-orchestration)
- [Browser Automation (13 tools)](#browser-automation)
- [Browser AI DOM Tools (5 tools)](#browser-ai-dom-tools)
- [Communication & Coordination (10 tools)](#communication--coordination)
- [Documentation & Web Scraping (9 tools)](#documentation--web-scraping)
- [Project Analysis & File Operations (7 tools)](#project-analysis--file-operations)
- [Knowledge Graph & Memory (13 tools)](#knowledge-graph--memory)
- [Tree Summary System (5 tools)](#tree-summary-system)
- [Progress Reporting (1 tool)](#progress-reporting)

---

## 🔍 MCP Resources (Token-Optimized)

**New in v0.5.0**: Read-only operations are now available as **MCP Resources** instead of Tools, providing 97% token reduction.

### File Analysis Resources (Phase 1 ✅)

**6 AST operations now cost 30 tokens instead of 1,200 tokens!**

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `file://{path}/symbols` | Extract functions, classes, methods, interfaces | `include_positions=true` |
| `file://{path}/imports` | Extract all import statements | - |
| `file://{path}/exports` | Extract all export statements | - |
| `file://{path}/structure` | Get file structure outline (Markdown) | - |
| `file://{path}/diagnostics` | Get syntax errors and parse diagnostics | - |
| `file://{path}/ast` | Full Abstract Syntax Tree with optimizations | `compact`, `use_symbol_table`, `max_depth`, `include_semantic_hash` |

**Example Usage:**
```typescript
// Extract symbols from TypeScript file
resource://file/src/services/AuthService.ts/symbols

// Get imports with compact AST
resource://file/src/index.ts/imports

// Full AST with token optimizations (30-50% smaller)
resource://file/src/app.ts/ast?compact=true&use_symbol_table=true&max_depth=3
```

**Query Parameters for AST:**
- `compact=true` - Filter syntactic noise nodes
- `use_symbol_table=true` - Use symbolic representation (30-50% token reduction)
- `max_depth=N` - Limit tree depth for quick overviews
- `include_semantic_hash=true` - Add hash for duplicate detection across files
- `omit_redundant_text=true` - Skip text content from simple nodes

### Deprecated Tools (Transition Period)

⚠️ **AST tools are now deprecated** - use `file://` resources instead:

| Deprecated Tool | Use This Resource Instead |
|----------------|---------------------------|
| `ast_analyze` with `operation: extract_symbols` | `file://{path}/symbols` |
| `ast_analyze` with `operation: extract_imports` | `file://{path}/imports` |
| `ast_analyze` with `operation: extract_exports` | `file://{path}/exports` |
| `ast_analyze` with `operation: get_structure` | `file://{path}/structure` |
| `ast_analyze` with `operation: get_diagnostics` | `file://{path}/diagnostics` |
| `ast_analyze` with `operation: parse` | `file://{path}/ast?compact=true` |

Old tools still work but show deprecation warnings. See [migration timeline](https://github.com/jw409/ZMCPTools/issues/35).

### Project Analysis Resources (Phase 2 ✅)

**2 project operations now cost 30 tokens instead of 400 tokens!**

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `project://{path}/structure` | Project directory tree with smart ignore patterns | `max_depth=5`, `exclude=node_modules,dist` |
| `project://{path}/summary` | AI-optimized project overview with README, package, git | `include_readme=true`, `include_package_info=true`, `include_git_info=true` |

**Example Usage:**
```typescript
// Get project structure
resource://project/./structure?max_depth=3&exclude=node_modules,dist,.git

// Full project summary
resource://project/./summary?include_readme=true&include_git_info=true
```

**Deprecated Tools (use resources or Claude Code built-ins instead):**

| Deprecated Tool | Use This Instead | Reason |
|----------------|------------------|---------|
| `analyze_project_structure` | `project://{path}/structure` | Now a resource (30 tokens vs 200) |
| `generate_project_summary` | `project://{path}/summary` | Now a resource (30 tokens vs 200) |
| `list_files` | Glob tool (Claude Code built-in) | Redundant - Glob is more efficient |
| `analyze_file_symbols` | `file://{path}/symbols` (Phase 1) | Redundant - use file resource |

**Savings**: 400 tokens (2 tools × 200) + eliminated 2 redundant tools

### Phase 3: Knowledge Graph Resources ✅

**3 knowledge operations now use resources instead of tools:**

| Resource URI | Use Case | Query Parameters |
|-------------|----------|------------------|
| `knowledge://search` | Hybrid BM25 + semantic search | `query`, `limit=10`, `threshold=0.7`, `use_bm25=true`, `use_embeddings=true` |
| `knowledge://entity/{id}/related` | Find related entities | `limit=10`, `min_strength=0.5` |
| `knowledge://status` | Graph health & statistics | - |

**Usage Examples:**
```typescript
// Semantic + keyword search
await readResource('knowledge://search?query=authentication&limit=10')

// Find related entities
await readResource('knowledge://entity/auth-123/related?limit=5')

// Check graph health
await readResource('knowledge://status')
```

**Mutation tools (keep using these):**
- `store_knowledge_memory` - Create entities
- `create_knowledge_relationship` - Link entities
- `update_knowledge_entity`, `prune_knowledge_memory`, `compact_knowledge_memory`
- `export_knowledge_graph`, `wipe_knowledge_graph`

**Savings**: 570 tokens (3 search tools eliminated, use resources instead)

### Coming Soon (In Progress)

**Phase 4**: Agent Status Resources (~370 tokens saved)
```typescript
resource://agent/all?status=active   // Active agents
resource://agent/{id}/status         // Specific agent status
```

**Total Savings So Far**: 2,140 tokens (Phase 1: 1,170 + Phase 2: 400 + Phase 3: 570)
**Projected Total**: 13,000+ tokens across all phases

---

## Multi-Agent Orchestration

**13 tools for coordinating and managing AI agent teams**

| Tool Name | Description |
|-----------|-------------|
| `orchestrate_objective` | Spawn architect agent to coordinate multi-agent objective completion |
| `orchestrate_objective_structured` | Execute structured phased orchestration with intelligent model selection (Research → Plan → Execute → Monitor → Cleanup) |
| `spawn_agent` | Spawn fully autonomous Claude agent with complete tool access |
| `create_task` | Create and assign task to agents with enhanced capabilities |
| `list_agents` | Get list of active agents with filtering and status information |
| `terminate_agent` | Terminate one or more agents with cleanup |
| `monitor_agents` | Monitor agents with real-time updates using EventBus system |
| `continue_agent_session` | Continue an agent session using stored conversation session ID with additional instructions |
| `cleanup_stale_agents` | Clean up stale agents with enhanced options and optional room cleanup |
| `cleanup_stale_rooms` | Clean up stale rooms based on activity and participant criteria |
| `run_comprehensive_cleanup` | Run comprehensive cleanup for both agents and rooms with detailed reporting |
| `get_cleanup_configuration` | Get current cleanup configuration and settings for agents and rooms |
| `create_execution_plan` | Create comprehensive execution plan using sequential thinking before spawning agents |

---

## Browser Automation

**13 tools for advanced web automation and interaction**

| Tool Name | Description |
|-----------|-------------|
| `create_browser_session` | Create a new browser session with intelligent auto-close and session management |
| `navigate_and_scrape` | Navigate to a URL and optionally scrape content in one operation. Auto-creates session if needed |
| `interact_with_page` | Perform multiple interactions with a page: click, type, hover, select, screenshot, wait, scroll |
| `perform_dynamic_interaction` | Perform intelligent, goal-oriented interactions with dynamic web pages using state-aware execution loop. Handles modern SPAs, React, Vue, Angular applications with automatic waiting, verification, and retry logic. |
| `manage_browser_sessions` | Manage browser sessions: list, close, cleanup idle sessions, get status |
| `navigate_to_url` | [LEGACY] Navigate to a URL in an existing browser session. Use navigate_and_scrape instead |
| `scrape_content` | [LEGACY] Scrape content from the current page. Use navigate_and_scrape instead |
| `take_screenshot` | [LEGACY] Take a screenshot of the current page. Use interact_with_page instead |
| `execute_browser_script` | [LEGACY] Execute JavaScript in the browser context. Use interact_with_page instead |
| `interact_with_element` | [LEGACY] Interact with a page element. Use interact_with_page instead |
| `close_browser_session` | [LEGACY] Close a browser session. Use manage_browser_sessions instead |
| `list_browser_sessions` | [LEGACY] List all browser sessions. Use manage_browser_sessions instead |
| `execute_with_plan` | Execute an objective using a pre-created execution plan with well-defined agent tasks |

---

## Browser AI DOM Tools

**5 tools for AI-powered DOM analysis and navigation**

| Tool Name | Description |
|-----------|-------------|
| `analyze_dom_structure` | AI-guided exploration and analysis of DOM structure using goal-oriented patterns. Analyzes stored DOM JSON to identify interactive elements, content areas, and navigation patterns |
| `navigate_dom_path` | Navigate to specific elements in DOM JSON using dot notation paths (e.g., 'body.main.article[0].paragraphs[2]'). Extracts content and provides element information |
| `search_dom_elements` | Search for DOM elements by type, content, keywords, or attributes. Returns matching elements with their paths for further navigation |
| `get_page_screenshot` | Retrieve stored screenshot for a page. Returns file path or base64 encoded image data for AI visual analysis |
| `analyze_screenshot` | AI-powered analysis of page screenshots with custom prompts. Can focus on specific regions and provide contextual insights |

---

## Communication & Coordination

**10 tools for agent communication and coordination**

| Tool Name | Description |
|-----------|-------------|
| `join_room` | Join communication room for coordination |
| `send_message` | Send message to coordination room |
| `wait_for_messages` | Wait for messages in a room |
| `close_room` | Close a communication room (soft delete - marks as closed but keeps data) |
| `delete_room` | Permanently delete a communication room and all its messages |
| `list_rooms` | List communication rooms with filtering and pagination |
| `list_room_messages` | List messages from a specific room with pagination |
| `create_delayed_room` | Create a delayed room for coordination when agents realize they need it |
| `analyze_coordination_patterns` | Analyze coordination patterns and suggest improvements |
| `broadcast_message_to_agents` | Broadcast a message to multiple agents with auto-resume functionality |

---

## Documentation & Web Scraping

**9 tools for intelligent documentation collection and management**

| Tool Name | Description |
|-----------|-------------|
| `scrape_documentation` | Scrape documentation from a website using intelligent sub-agents. Jobs are queued and processed automatically by the background worker. Supports plain string selectors for content extraction |
| `get_scraping_status` | Get status of active and recent scraping jobs (worker runs automatically) |
| `cancel_scrape_job` | Cancel an active or pending scraping job |
| `force_unlock_job` | Force unlock a stuck scraping job - useful for debugging and recovery |
| `force_unlock_stuck_jobs` | Force unlock all stuck scraping jobs (jobs that haven't been updated recently) |
| `list_documentation_sources` | List all configured documentation sources |
| `delete_pages_by_pattern` | Delete website pages matching URL patterns (useful for cleaning up version URLs, static assets) |
| `delete_pages_by_ids` | Delete specific pages by their IDs |
| `delete_all_website_pages` | Delete all pages for a website (useful for clean slate before re-scraping) |

---

## Project Analysis & File Operations

**7 tools for code analysis and smart file operations**

| Tool Name | Description |
|-----------|-------------|
| `analyze_project_structure` | Analyze project structure and generate a comprehensive overview |
| `generate_project_summary` | Generate AI-optimized project overview and analysis |
| `analyze_file_symbols` | Extract and analyze symbols (functions, classes, etc.) from code files |
| `list_files` | List files in a directory with smart ignore patterns |
| `find_files` | Search for files by pattern with optional content matching |
| `easy_replace` | Fuzzy string replacement in files with smart matching |
| `cleanup_orphaned_projects` | Clean up orphaned or unused project directories |

---

## Knowledge Graph & Memory

**13 tools for knowledge management and GPU-accelerated semantic search**

### GPU-Accelerated Search (3 tools)

| Tool Name | Description |
|-----------|-------------|
| `search_knowledge_graph_gpu` | GPU semantic search with Gemma3-768D embeddings (~10x faster). Requires embedding-service on port 8765. FAILS if GPU unavailable (no CPU fallback by design) |
| `get_embedding_status` | GPU service diagnostics: health, active model, VRAM usage, project-local and global LanceDB collections |
| `reindex_knowledge_base` | Bulk index files OR rebuild embeddings. Two modes: (1) Entity mode: rebuild from existing entities, (2) File mode: batch-index raw files for GitHub repos. NOT for incremental updates - use store_knowledge_memory for that |

### Core Operations (4 tools)

| Tool Name | Description |
|-----------|-------------|
| `store_knowledge_memory` | Store a knowledge graph memory with entity creation and immediate embedding |
| `create_knowledge_relationship` | Create a relationship between two entities in the knowledge graph |
| `search_knowledge_graph` | CPU semantic search (fallback when GPU unavailable). Prefer search_knowledge_graph_gpu for 10x speedup |
| `find_related_entities` | Find related entities through relationship traversal |

### Management & Cleanup (3 tools)

| Tool Name | Description |
|-----------|-------------|
| `update_knowledge_entity` | Update entity metadata or content with optional re-embedding. Auto re-embeds if description changes. Use for authority adjustment after conflict detection |
| `prune_knowledge_memory` | Remove low-authority entities and flag potential conflicts for review. Returns conflict_candidates[] for LLM review (embeddings can't auto-detect contradictions) |
| `compact_knowledge_memory` | Remove duplicate entities and optionally merge highly similar entities to reduce graph pollution |
| `get_memory_status` | Analyze knowledge graph health: quality metrics, pollution indicators, cleanup recommendations |

### Backup & Maintenance (2 tools)

| Tool Name | Description |
|-----------|-------------|
| `export_knowledge_graph` | Export entire knowledge graph to JSON/JSONL/CSV with optional embeddings. Use before wipe for backup |
| `wipe_knowledge_graph` | DESTRUCTIVE: Completely wipe all knowledge graph data. Requires explicit confirm=true. Auto-creates backup unless disabled |

---

## Tree Summary System

**5 tools for project structure caching and analysis**

| Tool Name | Description |
|-----------|-------------|
| `update_file_analysis` | Update or create analysis data for a specific file in the TreeSummary system |
| `remove_file_analysis` | Remove analysis data for a deleted file from the TreeSummary system |
| `update_project_metadata` | Update project metadata in the TreeSummary system |
| `get_project_overview` | Get comprehensive project overview from TreeSummary analysis |
| `cleanup_stale_analyses` | Clean up stale analysis files older than specified days |

---

## Progress Reporting

**1 tool for agent progress tracking**

| Tool Name | Description |
|-----------|-------------|
| `report_progress` | Report progress updates for agent tasks and status changes |

---

## Tool Categories Summary

- **Multi-Agent Orchestration**: 13 tools for coordinating AI agent teams
- **Browser Automation**: 13 tools for web automation (8 legacy tools for backward compatibility)
- **Browser AI DOM Tools**: 5 tools for intelligent DOM analysis
- **Communication & Coordination**: 10 tools for agent collaboration
- **Documentation & Web Scraping**: 9 tools for intelligent documentation collection
- **Project Analysis & File Operations**: 7 tools for code analysis and file management
- **Knowledge Graph & Memory**: 13 tools for GPU-accelerated semantic knowledge management
- **Tree Summary System**: 5 tools for project structure caching
- **Progress Reporting**: 1 tool for progress tracking

**Total: 71 Professional MCP Tools**

## Usage Notes

### Legacy Tool Support
ZMCPTools maintains backward compatibility by keeping legacy browser tools available while recommending modern alternatives. Legacy tools are clearly marked with `[LEGACY]` in their descriptions.

### Foundation Session Optimization
Many orchestration tools support `foundation_session_id` parameters for 85-90% cost reduction through shared context management.

### Type Safety
All tools are built with TypeScript and Zod schemas for runtime validation, ensuring reliable operation and clear error messages.

### MCP Compliance
Every tool follows MCP 1.15.0 protocol standards with proper JSON-RPC 2.0 implementation, error handling, and schema validation.

---

*For detailed usage examples and implementation guides, see the main [README.md](./README.md) and tool-specific documentation.*