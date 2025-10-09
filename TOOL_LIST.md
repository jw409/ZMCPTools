# ZMCPTools - Tool Reference

Complete reference for all active MCP tools and resources in ZMCPTools.

## Table of Contents

- [🔍 MCP Resources](#mcp-resources)
- [Browser Automation](#browser-automation)
- [Knowledge Graph & Memory (10 tools)](#knowledge-graph--memory)

**Total Active Tools**: 10 (Knowledge Graph & Memory only)

---

## 🔍 MCP Resources

**MCP Resources provide 97% token reduction** - use URI-based reads instead of tools for queries.

### File Analysis Resources

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `file://{path}/symbols` | Extract functions, classes, methods, interfaces | `include_positions=true` |
| `file://{path}/imports` | Extract all import statements | - |
| `file://{path}/exports` | Extract all export statements | - |
| `file://{path}/structure` | Get file structure outline (Markdown) | - |
| `file://{path}/diagnostics` | Get syntax errors and parse diagnostics | - |
| `file://{path}/ast` | Full Abstract Syntax Tree with optimizations | `compact`, `use_symbol_table`, `max_depth` |

**Example:**
```typescript
// Extract symbols from TypeScript file
resource://file/src/services/AuthService.ts/symbols

// Full AST with token optimizations (30-50% smaller)
resource://file/src/app.ts/ast?compact=true&use_symbol_table=true&max_depth=3
```

### Project Analysis Resources

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `project://{path}/structure` | Project directory tree with smart ignore patterns | `max_depth=5`, `exclude=node_modules,dist` |
| `project://{path}/summary` | AI-optimized project overview with README, package, git | `include_readme`, `include_package_info`, `include_git_info` |

**Example:**
```typescript
// Get project structure
resource://project/./structure?max_depth=3&exclude=node_modules,dist,.git

// Full project summary
resource://project/./summary?include_readme=true&include_git_info=true
```

### Knowledge Graph Resources

| Resource URI | Description | Query Parameters |
|-------------|-------------|------------------|
| `knowledge://search` | Hybrid BM25 + semantic search | `query`, `limit=10`, `threshold=0.7` |
| `knowledge://entity/{id}/related` | Find related entities | `limit=10`, `min_strength=0.5` |
| `knowledge://status` | Graph health & statistics | - |

**Example:**
```typescript
// Semantic + keyword search
await readResource('knowledge://search?query=authentication&limit=10')

// Find related entities
await readResource('knowledge://entity/auth-123/related?limit=5')
```

### Agent Status Resources

| Resource URI | Description | Query Parameters |
|-------------|-------------|------------------|
| `agents://list` | List all agents with filtering | `status`, `type`, `limit=50` |
| `agents://{id}/status` | Get detailed agent status | - |

**Example:**
```typescript
// List active backend agents
await readResource('agents://list?status=active&type=backend&limit=20')
```

---

## Browser Automation

**Browser tools removed from global ZMCPTools server.**

Use the official **Microsoft Playwright MCP Server** instead:
- **Location**: `external/playwright-mcp` (git submodule)
- **Repository**: https://github.com/microsoft/playwright-mcp
- **Reason**: Reduces maintenance burden, uses official Microsoft-maintained implementation

### Quick Setup

```bash
# Playwright MCP server is already a git submodule
cd external/playwright-mcp
npm install
npm run build

# Add to Claude Code MCP settings
# See external/playwright-mcp/README.md for configuration
```

### Migration Notes

ZMCPTools previously included 10 browser-related tools (browser automation + AI DOM navigation). These have been removed in favor of the official Playwright MCP server to:
- Reduce maintenance burden (~2,300 lines of browser-specific code)
- Use Microsoft's official, actively maintained implementation
- Eliminate dependency on Patchright fork
- Reduce bundle size (~200KB savings)

---

## Knowledge Graph & Memory

**10 tools for knowledge management and GPU-accelerated semantic search**

### GPU-Accelerated Search (3 tools)

| Tool Name | Description |
|-----------|-------------|
| `mcp__zmcp-tools__search_knowledge_graph_gpu` | GPU semantic search with Gemma3-768D embeddings (~10x faster). Requires embedding-service on port 8765 |
| `mcp__zmcp-tools__get_embedding_status` | GPU service diagnostics: health, active model, VRAM usage, LanceDB collection status |
| `mcp__zmcp-tools__switch_embedding_mode` | Switch between embedding models (qwen3/gemma3/minilm) for quality/performance trade-offs |

### Core Operations (2 tools)

| Tool Name | Description |
|-----------|-------------|
| `mcp__zmcp-tools__store_knowledge_memory` | Store a knowledge entity with partition-constrained types. **Requires `partition` field** to prevent NxM explosion |
| `mcp__zmcp-tools__create_knowledge_relationship` | Create a directional relationship between two entities |

#### Partition-Constrained Entity Types

**Problem**: 22 entity types × 5 partitions = 110 invalid combinations

**Solution**: Each partition has valid entity types enforced at runtime:

| Partition | Valid Entity Types | Use Case |
|-----------|-------------------|----------|
| **dom0** (core) | `file`, `concept`, `agent`, `tool`, `task`, `requirement`, `insight` | Universal types valid everywhere |
| **project** | Core + `repository`, `dependency`, `feature`, `bug`, `test`, `documentation`, `function`, `class`, `error`, `solution`, `pattern`, `configuration` | Code analysis and software artifacts |
| **talent** | Core + `skill`, `experience`, `goal` | Skills, experience tracking |
| **session** | Core + `progress`, `decision` | Ephemeral session state |
| **whiteboard** | `search_result`, `query`, `insight` only | Async search results (no core types) |

**Example - Valid**:
```typescript
{ partition: 'project', entity_type: 'repository' }     // ✅
{ partition: 'talent', entity_type: 'skill' }           // ✅
{ partition: 'whiteboard', entity_type: 'search_result' } // ✅
```

**Example - Invalid** (runtime error):
```typescript
{ partition: 'whiteboard', entity_type: 'repository' }
// ❌ Error: Invalid entity type "repository" for partition "whiteboard".
//          Valid types: search_result, query, insight
```

### Management & Cleanup (3 tools)

| Tool Name | Description |
|-----------|-------------|
| `mcp__zmcp-tools__update_knowledge_entity` | Update entity metadata or content with optional re-embedding |
| `mcp__zmcp-tools__prune_knowledge_memory` | Remove low-authority entities and flag potential conflicts for review |
| `mcp__zmcp-tools__compact_knowledge_memory` | Remove duplicate entities and merge similar entities to reduce graph pollution |

### Backup & Maintenance (2 tools)

| Tool Name | Description |
|-----------|-------------|
| `mcp__zmcp-tools__export_knowledge_graph` | Export entire knowledge graph to JSON/JSONL/CSV with optional embeddings |
| `mcp__zmcp-tools__wipe_knowledge_graph` | DESTRUCTIVE: Completely wipe all knowledge graph data (requires explicit confirm=true) |

---

## Usage Notes

### MCP Resources vs Tools

- **Resources** (~30 tokens): URI-based read operations for queries and status checks
- **Tools** (~200 tokens): Action-based mutations and complex workflows

Use resources whenever possible for significant token savings.

### Type Safety

All tools use TypeScript and Zod schemas for runtime validation, ensuring reliable operation and clear error messages.

### MCP Compliance

Every tool follows MCP 1.15.0 protocol standards with proper JSON-RPC 2.0 implementation and error handling.

---

*For detailed implementation guides, see [README.md](./README.md)*
