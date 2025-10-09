# MCP Resource Registry

**AUTO-GENERATED** from source code by `npm run generate:docs`
Last generated: 2025-10-09T18:51:03.272Z

## Available MCP Resources

MCP Resources provide 97% token reduction compared to tools for read-only operations.

### File Analysis

| URI Template | Description |
|--------------|-------------|
| `file://*/ast` | Parse source file to Abstract Syntax Tree with token optimization (use file://{path}/ast?compact=true&use_symbol_table=true&max_depth=3&include_semantic_hash=false&omit_redundant_text=true) |
| `file://*/symbols` | Extract symbols (functions, classes, methods, interfaces) from source file (use file://{path}/symbols?include_positions=true) |
| `file://*/imports` | Extract all import statements from source file (use file://{path}/imports) |
| `file://*/exports` | Extract all export statements from source file (use file://{path}/exports) |
| `file://*/structure` | Get Markdown-formatted code structure outline (use file://{path}/structure) |
| `file://*/diagnostics` | Get syntax errors and parse diagnostics (use file://{path}/diagnostics) |

### Project Analysis

| URI Template | Description |
|--------------|-------------|
| `project://*/structure` | Get project directory tree with smart ignore patterns (use project://{path}/structure?max_depth=5&exclude=node_modules) |
| `project://*/dependencies` | Get direct dependencies (imports) for a source file from symbol graph cache (use project://{file_path}/dependencies). Fast SQLite lookup using indexed import tracking. |
| `project://*/dependents` | Get reverse dependencies (files that import this file) from symbol graph cache (use project://{file_path}/dependents). Fast SQLite lookup for impact analysis. |
| `project://*/circular-deps` | Detect circular dependency chains in the project using DFS graph traversal (use project://./circular-deps). Helps identify problematic import cycles. |
| `project://*/impact-analysis` | Analyze impact of changes to a file via recursive dependency traversal (use project://{file_path}/impact-analysis?max_depth=5). Shows all files affected by modifications. |

### Knowledge Graph

| URI Template | Description |
|--------------|-------------|
| `knowledge://search` | 🔍 SEARCH BEFORE IMPLEMENTING: Search GitHub issues, architecture docs, implementation patterns, and prior solutions. Contains: ZMCPTools issues, TalentOS architecture (CLAUDE.md, etc/*.md, docs/*.md), design decisions, and known solutions. Use for: finding prior work, understanding architecture, discovering existing solutions, checking if feature exists. GPU-accelerated semantic + BM25 hybrid search. Example: knowledge://search?query=resource+migration+MCP&limit=5 |
| `knowledge://entity/*/related` | 📊 DISCOVER CONNECTIONS: Find entities related to a specific entity via graph traversal. Use after finding an entity via search to discover: related issues, connected docs, dependency chains, implementation patterns, similar solutions. Example: knowledge://entity/issue-35/related?limit=5&min_strength=0.6 finds docs/issues related to issue #35 |
| `knowledge://status` | 📈 KNOWLEDGE GRAPH HEALTH: Get statistics about indexed content - total entities, relationships, quality metrics, entity types, index freshness. Use to: verify indexing completed, check what |

### Vector Search

| URI Template | Description |
|--------------|-------------|
| `vector://collections` | 📚 BROWSE VECTOR COLLECTIONS: List all LanceDB collections with statistics (doc count, embedding dimensions, storage size). Use `?search=text` to find specific collections. Useful for discovering available knowledge bases before semantic search. |
| `vector://search` | 🔍 SEMANTIC SEARCH: Find documents by meaning, not keywords. Query across vector collections using embeddings for similarity matching. Returns top-N most relevant results with cosine similarity scores. Use `?collection=name` to target specific knowledge bases. |
| `vector://status` | 📊 VECTOR DATABASE HEALTH: Check LanceDB connection status, TalentOS GPU integration info, active embedding models (Stock vs Enhanced mode), and available vector collections. Use to verify GPU acceleration and model configuration before operations. |

### Logging

| URI Template | Description |
|--------------|-------------|
| `logs://list` | 📂 BROWSE LOG DIRECTORIES: List all log directories in ~/.mcptools/logs/ organized by agent, session, or service type. Use to discover available logs before drilling down to specific files. Returns directory names and file counts. |
| `logs://*/files` | 📄 LIST LOG FILES (PAGINATED): Get log files with pagination. **Params**: `?limit=100&offset=0`. Default limit: 100, sorted by modified time (newest first). Returns: files array, total, hasMore, nextOffset. Example: `logs://crashes/files?limit=50&offset=0` |
| `logs://*/content` | 📖 GREP LOG CONTENT (PAGINATED): Search/filter log content with regex + pagination. **Required**: `?file=error.log`. **Optional**: `pattern=CUDA` (regex), `case_insensitive=true`, `line_numbers=true`, `A=3` (after), `B=3` (before), `C=3` (context), `limit=1000`, `offset=0`. Example: `logs://crashes/content?file=agent.log&pattern=error&case_insensitive=true&line_numbers=true&C=2&limit=100` |

---

**Total Resources**: 20

### Log Rotation

**Automatic archiving**: Run `npm run logs:rotate` or `npm run logs:rotate:dry-run`
- Archives logs older than 7 days to `var/harvest/archived_logs/`
- Purges archived logs older than 90 days
- Configure: `--days=N --keep-archives-days=N`
- Safe for scavenger/teacher talent modules (archives preserved)
