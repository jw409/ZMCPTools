# ZMCPTools - Complete Tool Reference

This document provides a comprehensive reference for all MCP tools and resources available in ZMCPTools.

⚠️  **AUTO-GENERATED** from source code by `npm run generate:docs`
Last generated: 2025-10-09T06:07:23.147Z

## ⚡ Token Optimization Notice

**ZMCPTools now uses MCP Resources for read-only operations** - saving ~13,000+ tokens in system prompts!

- **Resources** (~30 tokens): URI-based read operations (file analysis, searches, status)
- **Tools** (~200 tokens): Action-based mutations and complex workflows

See [GitHub Issue #35](https://github.com/jw409/ZMCPTools/issues/35) for migration details.

## Table of Contents

- [🔍 MCP Resources (Token-Optimized)](#mcp-resources-token-optimized)
- [Other (4 tools)](#other)

**Total Active Tools**: 4

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
| `project://*/structure` | Get project directory tree with smart ignore patterns (use project://{path}/structure?max_depth=5&exclude=node_modules) | - |

### Knowledge Graph Resources

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `knowledge://search` | 🔍 SEARCH BEFORE IMPLEMENTING: Search GitHub issues, architecture docs, implementation patterns, and prior solutions. Contains: ZMCPTools issues, TalentOS architecture (CLAUDE.md, etc/*.md, docs/*.md), design decisions, and known solutions. Use for: finding prior work, understanding architecture, discovering existing solutions, checking if feature exists. GPU-accelerated semantic + BM25 hybrid search. Example: knowledge://search?query=resource+migration+MCP&limit=5 | - |
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
| `logs://*/files` | 📄 LIST LOG FILES: Get all log files in a specific directory (e.g., `logs://agent-123/files`). Returns filenames, sizes, timestamps. Use to identify relevant logs before reading content (recent errors, specific operations). | - |
| `logs://*/content` | 📖 READ LOG CONTENT: Get full content of specific log file (e.g., `logs://agent-123/content?file=errors.log`). Use for debugging, error analysis, or reviewing agent execution history. Supports text/plain logs with timestamps and stack traces. | - |

## Other

<a name="other"></a>

### `broadcast_progress`

Broadcast task progress to all agents in the repository

### `register_artifact`

Register created artifacts for discovery by other agents

### `todo_read`

Read shared todos with optional filtering

### `todo_write`

Write or update shared todos that all agents can see

---

**Token optimization**: Resources use ~30 tokens vs ~200 tokens for equivalent tools
**Total savings**: ~13,000+ tokens in system prompts vs tool-based approach
