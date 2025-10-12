# ZMCPTools - Complete Tool Reference

This document provides a comprehensive reference for all MCP tools and resources available in ZMCPTools.

⚠️  **AUTO-GENERATED** from source code by `npm run generate:docs`
Last generated: 2025-10-12T08:12:15.160Z

## ⚡ Token Optimization Notice

**ZMCPTools now uses MCP Resources for read-only operations** - saving ~13,000+ tokens in system prompts!

- **Resources** (~30 tokens): URI-based read operations (file analysis, searches, status)
- **Tools** (~200 tokens): Action-based mutations and complex workflows

See [GitHub Issue #35](https://github.com/jw409/ZMCPTools/issues/35) for migration details.

## Table of Contents

- [🔍 MCP Resources (Token-Optimized)](#mcp-resources-token-optimized)
- [Other (80 tools)](#other)
- [Progress Reporting (1 tools)](#progress-reporting)
- [Knowledge Graph (1 tools)](#knowledge-graph)
- [Agent Communication (11 tools)](#agent-communication)
- [Browser Automation (10 tools)](#browser-automation)

**Total Active Tools**: 103

---

## 🔍 MCP Resources (Token-Optimized)

**New in v0.5.0**: Read-only operations are now available as **MCP Resources** instead of Tools, providing 97% token reduction.

### File Analysis Resources

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `file://*/ast` | Parse source file to Abstract Syntax Tree with token optimization (use file://{path}/ast?compact=true&use_symbol_table=true&max_depth=3&include_semantic_hash=false&omit_redundant_text=true) | - |
| `file://*/symbols` | Extract symbols (functions, classes, methods, interfaces) from source file (use file://{path}/symbols?include_positions=true) | - |
| `file://*/imports` | Extract all import statements from source file (use file://{path}/imports) | - |
| `file://*/exports` | Extract all export statements from source file (use file://{path}/exports) | - |
| `file://*/structure` | Get Markdown-formatted code structure outline (use file://{path}/structure) | - |
| `file://*/diagnostics` | Get syntax errors and parse diagnostics (use file://{path}/diagnostics) | - |

### Project Analysis Resources

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `project://*/structure` | Get project directory tree. TWO MODES: 1) flat=true (RECOMMENDED): Instant paginated file list from Symbol Graph SQLite cache (3,891 files in <50ms). COMPACT by default (just file paths, 70-80% token savings). Use ?verbose=true for metadata. Use ?dir=src/ for hierarchical navigation. 2) flat=false (default): Live filesystem scan with async batching + limits (slower). Example: project://{path}/structure?flat=true&limit=100&cursor=<token> | - |
| `project://*/dependencies` | Get direct dependencies (imports) for a source file from symbol graph cache (use project://{file_path}/dependencies). Fast SQLite lookup using indexed import tracking. | - |
| `project://*/dependents` | Get reverse dependencies (files that import this file) from symbol graph cache (use project://{file_path}/dependents). Fast SQLite lookup for impact analysis. | - |
| `project://*/circular-deps` | Detect circular dependency chains in the project using DFS graph traversal (use project://./circular-deps). Helps identify problematic import cycles. | - |
| `project://*/impact-analysis` | Analyze impact of changes to a file via recursive dependency traversal (use project://{file_path}/impact-analysis?max_depth=5). Shows all files affected by modifications. | - |

### Other Resources

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `symbols://list` | 📂 LIST INDEXED FILES (PAGINATED): Get all files currently indexed in symbol graph cache (SQLite). Use to compare cached files vs actual project structure before indexing. Returns file paths, last indexed time, symbol counts. Instant SQLite query. **Params**: `?limit=100&cursor=<token>`. Default limit: 100, sorted by indexed time (newest first). Returns: nextCursor for pagination. | - |
| `symbols://search` | 🔍 FIND SYMBOLS BY NAME/TYPE (PAGINATED): Search cached symbols by name and type (function, class, method, interface). Use `?name=foo&type=function&limit=50&cursor=<token>` to find specific symbols. Returns symbol definitions with file locations. Fast SQLite lookup. **Pagination**: Default limit 50, use nextCursor for more results. | - |
| `symbols://file/*` | 📄 GET SYMBOLS FROM CACHE: Get all symbols for a specific file from cache (use symbols://file/{path}). Returns cached symbol definitions without reparsing. Instant SQLite lookup. Compare with file://{path}/symbols (live parse) to verify freshness. | - |
| `symbols://stats` | 📊 INDEX HEALTH CHECK: Get symbol graph cache statistics - total files indexed, symbols extracted, cache hit rate, embedding coverage, last update times. Use to verify indexing completed and check what | - |

### Knowledge Graph Resources

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `knowledge://search` | 🔍 SEARCH BEFORE IMPLEMENTING (PAGINATED): Search GitHub issues, architecture docs, implementation patterns, and prior solutions. Contains: ZMCPTools issues, TalentOS architecture (CLAUDE.md, etc/*.md, docs/*.md), design decisions, and known solutions. Use for: finding prior work, understanding architecture, discovering existing solutions, checking if feature exists. GPU-accelerated semantic + BM25 hybrid search. **Pagination**: Default limit 10, use cursor for more results. Example: knowledge://search?query=resource+migration+MCP&limit=10&cursor=<token> | - |
| `knowledge://entity/*/related` | 📊 DISCOVER CONNECTIONS: Find entities related to a specific entity via graph traversal. Use after finding an entity via search to discover: related issues, connected docs, dependency chains, implementation patterns, similar solutions. Example: knowledge://entity/issue-35/related?limit=5&min_strength=0.6 finds docs/issues related to issue #35 | - |
| `knowledge://status` | 📈 KNOWLEDGE GRAPH HEALTH: Get statistics about indexed content - total entities, relationships, quality metrics, entity types, index freshness. Use to: verify indexing completed, check what | - |

### Vector Search Resources

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `vector://collections` | 📚 BROWSE VECTOR COLLECTIONS: List all LanceDB collections with statistics (doc count, embedding dimensions, storage size). Use `?search=text` to find specific collections. Useful for discovering available knowledge bases before semantic search. | - |
| `vector://search` | 🔍 SEMANTIC SEARCH: Find documents by meaning, not keywords. Query across vector collections using embeddings for similarity matching. Returns top-N most relevant results with cosine similarity scores. Use `?collection=name` to target specific knowledge bases. | - |
| `vector://status` | 📊 VECTOR DATABASE HEALTH: Check LanceDB connection status, TalentOS GPU integration info, active embedding models (Stock vs Enhanced mode), and available vector collections. Use to verify GPU acceleration and model configuration before operations. | - |

### Logging Resources

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `logs://list` | 📂 BROWSE LOG DIRECTORIES: List all log directories in ~/.mcptools/logs/ organized by agent, session, or service type. Use to discover available logs before drilling down to specific files. Returns directory names and file counts. | - |
| `logs://*/files` | 📄 LIST LOG FILES (PAGINATED): Get log files with pagination. **Params**: `?limit=100&offset=0`. Default limit: 100, sorted by modified time (newest first). Returns: files array, total, hasMore, nextOffset. Example: `logs://crashes/files?limit=50&offset=0` | - |
| `logs://*/content` | 📖 GREP LOG CONTENT (PAGINATED): Search/filter log content with regex + pagination. **Required**: `?file=error.log`. **Optional**: `pattern=CUDA` (regex), `case_insensitive=true`, `line_numbers=true`, `A=3` (after), `B=3` (before), `C=3` (context), `limit=1000`, `offset=0`. Example: `logs://crashes/content?file=agent.log&pattern=error&case_insensitive=true&line_numbers=true&C=2&limit=100` | - |

## Other

<a name="other"></a>

### `acquire_repository`

No description

### `ast_analyze`

🔍 Analyze source code using tree-sitter AST parsing within project context.\n\nUSE FOR: Building project-local call graphs, import analysis, symbol search\nNOT FOR: API testing, Swagger validation, cross-project contracts\n\nOperations: parse (full AST with optimizations), query (S-expression patterns), extract_symbols (functions/classes), extract_imports, extract_exports, find_pattern (code search), get_structure (readable outline), get_diagnostics (syntax errors).\n\nSymbols are scoped to this repository and its import graph. Use extract_imports to understand cross-file relationships.

### `ast_extract_exports`

Extract all symbols (functions, classes, methods, interfaces) from TypeScript/JavaScript code.

### `ast_extract_imports`

Return compact tree only (default: true)

### `ast_extract_symbols`

Path to the source code file

### `ast_get_structure`

Path to the source code file

### `ast_parse`

Parse source code into an Abstract Syntax Tree. Returns compact structure for TypeScript/JavaScript.

### `benchmark_search_performance`

Python file - exact match

### `broadcast_progress`

Broadcast task progress to all agents in the repository

### `cancel_scrape_job`

Cancel an active or pending scraping job

### `check_inbox`

Sender talent ID (e.g., 

### `compact_knowledge_memory`

Remove duplicates and merge similar entities. See TOOL_LIST.md

### `compare_search_modes`

Function/service name

### `create_execution_plan`

Create a high-level execution plan that generates coordinated Tasks for implementation

### `create_knowledge_relationship`

Create relationship between entities. See TOOL_LIST.md

### `delete_all_website_pages`

Delete all pages for a website (useful for clean slate before re-scraping)

### `delete_execution_plan`

Delete an execution plan by ID

### `delete_pages_by_ids`

Delete specific pages by their IDs

### `delete_pages_by_pattern`

Delete website pages matching URL patterns (useful for cleaning up version URLs, static assets)

### `ensure_coordination_directories`

Email subject (should reflect sender personality)

### `execute_with_plan`

Execute a plan by creating Tasks and spawning coordinated agents

### `export_knowledge_graph`

Export knowledge graph to file or return data. See TOOL_LIST.md

### `force_unlock_job`

Force unlock a stuck scraping job - useful for debugging and recovery

### `force_unlock_stuck_jobs`

Force unlock all stuck scraping jobs (jobs that haven\

### `get_agent_results`

Retrieve results from a completed or failed agent by ID. This tool searches for agent result files both in the local project directory and parent directories (bubbling up). Can wait for results if they are not immediately available.

### `get_collection_stats`

Get statistics for a specific collection. Use for: monitoring collection size, checking index health.

### `get_email`

Carbon copy recipient talent IDs (optional)

### `get_embedding_status`

GPU service diagnostics and LanceDB status. See TOOL_LIST.md

### `get_execution_plan`

Get an execution plan with progress derived from linked Tasks

### `get_file_diagnostics`

Get syntax errors and parse diagnostics for source file.

### `get_file_exports`

Extract all export statements from source file. Shows public API surface.

### `get_file_imports`

Extract all import statements from source file. Useful for dependency analysis.

### `get_file_structure`

Get Markdown-formatted code outline. High-level file organization without full content.

### `get_file_symbols`

Extract symbols (functions, classes, methods, interfaces) from source file. Fast AST-based parsing.

### `get_knowledge_search`

Search knowledge graph using GPU semantic search + BM25. Searches GitHub issues, docs, architecture, prior solutions.

### `get_knowledge_status`

Get knowledge graph health statistics - entities, relationships, quality metrics, index freshness.

### `get_meeting_status`

Speak in a meeting (add a minute). Talent must have joined the meeting first. Messages are logged with timestamp.

### `get_project_dependencies`

Get direct dependencies (imports) for a source file from symbol graph cache. Fast SQLite lookup.

### `get_project_dependents`

Get reverse dependencies (files that import this file) from cache. For impact analysis.

### `get_project_structure`

Get project directory tree with smart ignore patterns. Fast paginated mode recommended.

### `get_scraping_status`

Get status of active and recent scraping jobs (worker runs automatically)

### `get_search_stats`

No description

### `get_symbols_list`

List all files indexed in symbol graph cache. Use to discover what\

### `get_symbols_search`

Search cached symbols by name/type (function, class, method, interface). Fast SQLite lookup.

### `get_symbols_stats`

Get symbol graph cache statistics - total files indexed, symbols extracted, cache health.

### `get_vector_collections`

List all LanceDB vector collections with statistics (doc count, dimensions, storage size).

### `get_vector_search`

Semantic search across vector collections using embeddings. Find documents by meaning, not keywords.

### `get_vector_status`

Check LanceDB connection status, GPU integration, embedding models, available collections.

### `index_document`

Index a document into GPU vector store for semantic search. Use for: storing agent observations, indexing new docs, adding context to knowledge base.

### `index_symbol_graph`

Index code for symbol graph search. Supports incremental updates, corruption recovery, and scoped indexing.

### `join_meeting`

Join a meeting as a talent. Creates meeting if it doesn\

### `leave_meeting`

Talent ID joining the meeting

### `list_acquisitions`

No description

### `list_collections`

List all available knowledge collections. Use for: discovering what knowledge is available, checking collection status.

### `list_documentation_sources`

List all configured documentation sources

### `list_execution_plans`

List execution plans for discovery and monitoring

### `orchestrate_collaborative_team`

No description

### `process_email`

Array of recipient talent IDs

### `prune_knowledge_memory`

Remove low-authority entities and pollution. See TOOL_LIST.md

### `read_file`

Reads the content of a file at a given absolute path.

### `read_mcp_resource`

Reads an MCP resource by its URI. Acts as a meta-tool to access the resource API.

### `register_artifact`

Register created artifacts for discovery by other agents

### `reindex_knowledge_base`

No description

### `remove_acquisition`

No description

### `scrape_documentation`

Scrape documentation from a website using intelligent sub-agents. Jobs are queued and processed automatically by the background worker. Supports plain string selectors for content extraction.

### `search_knowledge`

Search knowledge base using GPU-accelerated embeddings. Searches across code, docs, issues, learnings. Use for: finding relevant context, discovering similar patterns, semantic code search.

### `search_knowledge_graph_gpu`

GPU semantic search with auto-fallback. See TOOL_LIST.md

### `search_knowledge_graph_hybrid`

No description

### `search_knowledge_graph_unified`

No description

### `send_email`

Send an email from one talent to others. This is NOT real email - it\

### `speak_in_meeting`

Meeting ID (e.g., 

### `store_knowledge_memory`

Store knowledge entity with embedding. See TOOL_LIST.md

### `switch_embedding_mode`

Switch embedding models (qwen3/gemma3/minilm) for A/B testing. See TOOL_LIST.md

### `talentos_semantic_search`

No description

### `todo_read`

Read shared todos with optional filtering

### `todo_write`

Write or update shared todos that all agents can see

### `update_execution_plan`

Update an execution plan\

### `update_knowledge_entity`

Update entity metadata with optional re-embedding. See TOOL_LIST.md

### `wipe_knowledge_graph`

DESTRUCTIVE: Wipe all knowledge graph data. See TOOL_LIST.md

### `write_file`

Writes content to a file at a given absolute path. Creates the file if it doesn\

## Progress Reporting

<a name="progress-reporting"></a>

### `report_progress`

Report progress updates for agent tasks and status changes

## Knowledge Graph

<a name="knowledge-graph"></a>

### `index_knowledge`

No description

## Agent Communication

<a name="agent-communication"></a>

### `analyze_coordination_patterns`

Broadcast a message to multiple agents with auto-resume functionality

### `broadcast_message_to_agents`

No description

### `close_room`

Permanently delete a communication room and all its messages

### `create_delayed_room`

Analyze coordination patterns and suggest improvements

### `delete_room`

List communication rooms with filtering and pagination

### `fallback`

Join communication room for coordination

### `join_room`

Send message to coordination room

### `list_room_messages`

Create a delayed room for coordination when agents realize they need it

### `list_rooms`

List messages from a specific room with pagination

### `send_message`

Wait for messages in a room

### `wait_for_messages`

Close a communication room (soft delete - marks as closed but keeps data)

## Browser Automation

<a name="browser-automation"></a>

### `analyze_dom_structure`

AI-guided exploration and analysis of DOM structure using goal-oriented patterns. Analyzes stored DOM JSON to identify interactive elements, content areas, and navigation patterns.

### `analyze_screenshot`

AI-powered analysis of page screenshots with custom prompts. Can focus on specific regions and provide contextual insights.

### `create_browser_session`

Create a new browser session with intelligent auto-close and session management

### `get_page_screenshot`

Retrieve stored screenshot for a page. Always saves to file and returns file path to avoid token limits. Use Read tool to access the image.

### `interact_with_page`

Perform multiple interactions with a page: click, type, hover, select, screenshot, wait, scroll

### `manage_browser_sessions`

Manage browser sessions: list, close, cleanup idle sessions, get status

### `navigate_and_scrape`

Navigate to a URL and optionally scrape content in one operation. Auto-creates session if needed.

### `navigate_dom_path`

Navigate to specific elements in DOM JSON using dot notation paths (e.g., 

### `perform_dynamic_interaction`

Perform intelligent, goal-oriented interactions with dynamic web pages using state-aware execution loop. Handles modern SPAs, React, Vue, Angular applications with automatic waiting, verification, and retry logic.

### `search_dom_elements`

Search for DOM elements by type, content, keywords, or attributes. Returns matching elements with their paths for further navigation.

---

**Token optimization**: Resources use ~30 tokens vs ~200 tokens for equivalent tools
**Total savings**: ~13,000+ tokens in system prompts vs tool-based approach
