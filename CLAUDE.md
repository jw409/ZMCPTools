---
verify: ZMCP_TOOLS_v3.0_LOADED
type: mcp_integration
storage: ~/.mcptools/data/
vector_db: ~/.mcptools/lancedb/
tools_available: 44
removed: [orchestration, communication, plan_management, web_scraping]
note: Agent tools pending claude-agent-sdk integration
---

# ZMCPTools Integration

MCP tools for browser automation, code analysis, and knowledge management.

## Available Tools (44 total)

**Browser automation** (13 tools):
- `create_browser_session()` - Session management
- `navigate_and_scrape(url)` - Navigate + scrape
- `interact_with_page()` - Click, type, screenshot
- `perform_dynamic_interaction()` - Goal-oriented automation
- `manage_browser_sessions()` - List, close, cleanup

**Browser AI DOM** (5 tools):
- `analyze_dom_structure()` - AI-guided DOM exploration
- `navigate_dom_path(path)` - Element navigation
- `search_dom_elements(query)` - Find elements
- `get_page_screenshot()` - Screenshot retrieval
- `analyze_screenshot(prompt)` - AI screenshot analysis

**Project analysis** (7 tools):
- `analyze_project_structure(path)` - Project overview
- `generate_project_summary(path)` - AI-optimized summary
- `analyze_file_symbols(path)` - Extract functions/classes
- `list_files(directory)` - Smart file listing
- `find_files(pattern)` - Pattern matching
- `easy_replace(file, old, new)` - Fuzzy string replacement

**Knowledge graph** (13 tools):
- `store_knowledge_memory()` - Create entities
- `create_knowledge_relationship()` - Link entities
- `search_knowledge_graph()` - CPU semantic search
- `search_knowledge_graph_gpu()` - GPU semantic search (10x faster)
- `find_related_entities()` - Relationship traversal
- `update_knowledge_entity()` - Update metadata
- `prune_knowledge_memory()` - Remove low-authority entities
- `compact_knowledge_memory()` - Deduplicate
- `get_memory_status()` - Health metrics
- `export_knowledge_graph()` - Export to JSON/CSV
- `wipe_knowledge_graph()` - Full wipe (destructive)
- `get_embedding_status()` - GPU service diagnostics
- `reindex_knowledge_base()` - Bulk reindexing

**Tree summary** (5 tools):
- `update_file_analysis()` - File metadata caching
- `remove_file_analysis()` - Remove cached data
- `update_project_metadata()` - Project metadata
- `get_project_overview()` - Cached overview
- `cleanup_stale_analyses()` - Cleanup old cache

**Progress reporting** (1 tool):
- `report_progress()` - Agent progress updates

## MCP Resources (Token-Optimized)

**File analysis** (file://):
- `file://{path}/symbols` - Functions, classes, methods
- `file://{path}/imports` - Import statements
- `file://{path}/exports` - Export statements
- `file://{path}/structure` - Code outline (Markdown)
- `file://{path}/diagnostics` - Syntax errors
- `file://{path}/ast` - Full AST with optimizations

**Project analysis** (project://):
- `project://{path}/structure` - Directory tree
- `project://{path}/summary` - Project overview

**Knowledge graph** (knowledge://):
- `knowledge://search?query=X` - Hybrid BM25 + semantic
- `knowledge://entity/{id}/related` - Related entities
- `knowledge://status` - Graph health

**Agents** (agents://):
- `agents://list?status=active` - List agents
- `agents://{id}/status` - Agent status

**Vectors** (vector://):
- `vector://collections` - List LanceDB collections
- `vector://search?collection=X` - Semantic search
- `vector://status` - Database health

**Logs** (logs://):
- `logs://list` - Log directories
- `logs://{dir}/files` - Files in directory
- `logs://{dir}/content?file=X` - Log content

## Removed Tools

**Agent orchestration** (23 tools removed):
- `orchestrate_objective()` - Removed
- `spawn_agent()` - Removed
- `create_task()` - Removed
- `join_room()` - Removed
- `send_message()` - Removed
- Communication/coordination tools - Removed
- Plan management tools - Removed

**Web scraping** (9 tools removed):
- `scrape_documentation()` - Removed
- `get_scraping_status()` - Removed
- Documentation indexing tools - Removed

**Reason**: Pending claude-agent-sdk integration

## Usage Patterns

**Analyze project before work**:
```typescript
// Use MCP resource (30 tokens vs 200)
const structure = await readResource('project://./structure')

// Or tool (backwards compatible)
const summary = await callTool('analyze_project_structure', { path: '.' })
```

**Semantic search**:
```typescript
// GPU-accelerated (requires service on 8765)
const results = await callTool('search_knowledge_graph_gpu', {
  query: 'authentication flow',
  repositoryPath: '.'
})

// Or via resource
const results = await readResource('knowledge://search?query=authentication&limit=10')
```

**Browser automation**:
```typescript
const session = await callTool('create_browser_session', {})
await callTool('perform_dynamic_interaction', {
  sessionId: session.sessionId,
  goal: 'Login with test credentials',
  url: 'https://app.example.com'
})
```

## Best Practices

**Always**:
- Use MCP resources when possible (97% token reduction)
- Check knowledge graph before implementing
- Use GPU search for semantic queries (10x faster)
- Store insights with `store_knowledge_memory()`

**Never**:
- Try to use removed orchestration tools (will fail)
- Skip project analysis before starting work
- Use CPU search when GPU available

## Service Dependencies

**Required services**:
- Port 8765: GPU embedding service (for semantic search)
- LanceDB: Vector storage at `~/.mcptools/lancedb/`

**Check health**:
```bash
curl http://localhost:8765/health
```

**Via MCP**:
```typescript
const status = await readResource('knowledge://status')
const embedding = await callTool('get_embedding_status', {})
```

---

**Token optimization**: Resources use ~30 tokens vs ~200 tokens for equivalent tools
**Total savings**: ~13,000+ tokens in system prompts vs tool-based approach
