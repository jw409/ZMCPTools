# ZMCPTools - Complete Tool Reference

This document provides a comprehensive reference for all MCP tools and resources available in ZMCPTools.

## ⚡ Token Optimization Notice

**ZMCPTools now uses MCP Resources for read-only operations** - saving ~13,000+ tokens in system prompts!

- **Resources** (~30 tokens): URI-based read operations (file analysis, searches, status)
- **Tools** (~200 tokens): Action-based mutations and complex workflows

See [GitHub Issue #35](https://github.com/jw409/ZMCPTools/issues/35) for migration details.

## Table of Contents

- [🔍 MCP Resources (Token-Optimized)](#mcp-resources-token-optimized)
- [Browser Automation (5 tools)](#browser-automation)
- [Browser AI DOM Tools (5 tools)](#browser-ai-dom-tools)
- [~~Project Analysis & File Operations (0 tools - ALL DEPRECATED)~~](#project-analysis--file-operations)
- [Knowledge Graph & Memory (7 tools)](#knowledge-graph--memory)
- [Tree Summary System (0 tools - deprecated)](#tree-summary-system)
- [Progress Reporting (1 tool)](#progress-reporting)

**Total Active Tools**: 18 (Browser:5 + AI-DOM:5 + KG:7 + Progress:1)

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

**Deprecated Tools (ALL REMOVED - use resources or Claude Code built-ins instead):**

| Deprecated Tool | Use This Instead | Reason |
|----------------|------------------|---------|
| `analyze_project_structure` | `project://{path}/structure` | Now a resource (30 tokens vs 200) |
| `generate_project_summary` | `project://{path}/summary` | Now a resource (30 tokens vs 200) |
| `analyze_file_symbols` | `file://{path}/symbols` | Now a resource (30 tokens vs 200) |
| `list_files` | Glob tool (Claude Code built-in) | Redundant - Glob is more efficient |
| `find_files` | Glob tool (Claude Code built-in) | Redundant - Glob supports patterns |
| `easy_replace` | Edit tool (Claude Code built-in) | Redundant - Edit has Read context for fuzzy matching |
| `cleanup_orphaned_projects` | Manual bash (rm -rf) | Infrequent operation, not worth MCP overhead |

**Savings**: 1,320 tokens (13 tools eliminated, 0 remain)

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

### Phase 4: Agent Status Resources ✅

**2 agent operations now use resources instead of tools:**

| Resource URI | Use Case | Query Parameters |
|-------------|----------|------------------|
| `agents://list` | List all agents with filtering | `status=active/completed/failed/terminated`, `type=backend/frontend/testing`, `limit=50`, `cursor=token` |
| `agents://{id}/status` | Get detailed agent status | - |

**Usage Examples:**
```typescript
// List active backend agents
await readResource('agents://list?status=active&type=backend&limit=20')

// Get detailed agent status
await readResource('agents://agent-123/status')
```

**Mutation tools (keep using these):**
- `spawn_agent` - Create agents
- `terminate_agent` - Stop agents
- `monitor_agents` - Set up real-time monitoring
- `cleanup_stale_agents`, `cleanup_stale_rooms`, `run_comprehensive_cleanup`

**Savings**: 170 tokens (list_agents tool eliminated)

### Phase 5: Communication Resources (Architectural Cleanup)

Removed communication resources from dom0 (they belong in domU talent server only):
- Removed `communication://rooms` resource template
- Removed `communication://messages` resource template
- Clean separation: orchestration tools in dom0, coordination tools in domU

### Phase 6: Docs/Scraping Resources (Complete Removal)

Removed all documentation/scraping resources from dom0:
- Removed `scraping://jobs`, `docs://sources`, `docs://websites`, `docs://*/pages`, `docs://search`
- ~108 lines of code eliminated
- Cleaner dom0 surface area

### Phases 7-8: Resource Description Improvements

Enhanced all resource descriptions with actionable, emoji-prefixed guidance:
- **Phase 7**: Vector resources (📚 📊 🔍) - collections, search, status
- **Phase 8**: Logs resources (📂 📄 📖) - list, files, content

All descriptions now follow pattern: 🎯 USE CASE + practical examples + when to use

**Total Savings**: 2,310+ tokens (Phase 1: 1,170 + Phase 2: 400 + Phase 3: 570 + Phase 4: 170)
**Quality Improvements**: Phases 5-8 (architectural cleanup + better UX)

---

## Browser Automation

**5 tools for advanced web automation and interaction** (7 legacy tools removed 2025-10-04)

| Tool Name | Description |
|-----------|-------------|
| `create_browser_session` | Create a new browser session with intelligent auto-close and session management |
| `navigate_and_scrape` | Navigate to a URL and optionally scrape content in one operation. Auto-creates session if needed |
| `interact_with_page` | Perform multiple interactions with a page: click, type, hover, select, screenshot, wait, scroll |
| `perform_dynamic_interaction` | Perform intelligent, goal-oriented interactions with dynamic web pages using state-aware execution loop. Handles modern SPAs, React, Vue, Angular applications with automatic waiting, verification, and retry logic. |
| `manage_browser_sessions` | Manage browser sessions: list, close, cleanup idle sessions, get status |
| `execute_with_plan` | Execute an objective using a pre-created execution plan with well-defined agent tasks |

### ~~Legacy Browser Tools~~ (REMOVED ✅)

**7 legacy tools removed 2025-10-04** - zero active usage, modern replacements available

| Removed Tool | Use This Instead | Status |
|--------------|------------------|--------|
| `navigate_to_url` | `navigate_and_scrape` | ✅ Removed (840 token savings) |
| `scrape_content` | `navigate_and_scrape` | ✅ Removed |
| `take_screenshot` | `interact_with_page` | ✅ Removed |
| `execute_browser_script` | `interact_with_page` | ✅ Removed |
| `interact_with_element` | `interact_with_page` | ✅ Removed |
| `close_browser_session` | `manage_browser_sessions` | ✅ Removed |
| `list_browser_sessions` | `manage_browser_sessions` | ✅ Removed |

**Rationale**: Usage analysis found zero external callers. All functionality available in 5 modern tools with better DX.

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

## ~~Project Analysis & File Operations~~ (ALL DEPRECATED ✅)

**0 tools - Use MCP Resources + Native Claude Code tools instead**

All 13 analysis tools have been deprecated in favor of:
- **MCP Resources**: `file://{path}/symbols`, `project://{path}/structure`, `knowledge://search`
- **Native Tools**: Glob (file search), Edit (file modifications), Read (file content)

### Migration Guide

| Old Tool | New Approach |
|----------|-------------|
| `analyze_project_structure` | `project://{path}/structure` resource |
| `generate_project_summary` | `project://{path}/summary` resource |
| `analyze_file_symbols` | `file://{path}/symbols` resource |
| `list_files` | Glob tool (native) |
| `find_files` | Glob tool with patterns (native) |
| `easy_replace` | Edit tool with Read context (native) |
| `cleanup_orphaned_projects` | Manual bash: `rm -rf path/` |

**Rationale**:
- Resources: 97% token reduction (30 vs 200 tokens)
- Native: Zero MCP overhead, better integration
- Architecture: Resources + Native > Custom MCP tools

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

**0 tools - Use MCP Resources instead**

TreeSummary tools are deprecated. Use these MCP Resources for file/project analysis:
- `file://{path}/symbols` - Extract functions, classes, methods
- `file://{path}/ast` - Full AST analysis
- `project://{path}/structure` - Directory tree
- `project://{path}/summary` - Project overview

---

## Progress Reporting

**1 tool for agent progress tracking**

| Tool Name | Description |
|-----------|-------------|
| `report_progress` | Report progress updates for agent tasks and status changes |

---

## Tool Categories Summary

- **Browser Automation**: 5 tools for web automation (7 legacy tools removed 2025-10-04)
- **Browser AI DOM Tools**: 5 tools for intelligent DOM analysis
- **Project Analysis & File Operations**: 0 tools (use MCP resources + native tools)
- **Knowledge Graph & Memory**: 7 tools for semantic knowledge management
- **Tree Summary System**: 0 tools (use MCP resources instead)
- **Progress Reporting**: 1 tool for progress tracking

**Total Active Tools**: 18 (verified via grep count 2025-10-04)

**Cleanup History**:
- 2025-10-04: Removed 7 legacy browser tools (zero usage, modern replacements exist)
- Previous: Removed 7 project analysis tools (now MCP resources or native tools)
- Previous: Removed 5 TreeSummary tools (now MCP resources)
- Previous: Removed 32+ agent orchestration/web scraping tools (in TalentMcpServer only)

## Usage Notes

### Legacy Tool Support
ZMCPTools maintains backward compatibility by keeping legacy browser tools available while recommending modern alternatives. Legacy tools are clearly marked with `[LEGACY]` in their descriptions.


### Type Safety
All tools are built with TypeScript and Zod schemas for runtime validation, ensuring reliable operation and clear error messages.

### MCP Compliance
Every tool follows MCP 1.15.0 protocol standards with proper JSON-RPC 2.0 implementation, error handling, and schema validation.

---

*For detailed usage examples and implementation guides, see the main [README.md](./README.md) and tool-specific documentation.*