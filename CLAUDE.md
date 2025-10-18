---
verify: ZMCP_TOOLS_v3.1_LOADED
verify_repos: ZMCP_REPOS_v1.0_LOADED
version: 3.1
type: mcp_integration
storage: ~/.mcptools/data/
vector_db: ~/.mcptools/lancedb/
database: var/db/zmcp_local.db
orm: Drizzle
authoritative:
  docs: etc/META_DOCUMENTATION_MAP.md
  github: etc/GITHUB_ISSUES.md
  tools: etc/TOOL_LIST.md
  agent_tools: etc/AGENT_TOOL_LIST.md
  resources: etc/RESOURCE_REGISTRY.md
  repositories: REPOSITORY_HOOKPOINTS.json
  infrastructure: etc/INFRASTRUCTURE.md
rules:
  prefer_resources: MCP resources over tools (97% token reduction)
  gpu_search: Port 8765 dual-pool workers (2 embedding + 1 reranking)
  no_new_databases: Use REPOSITORY_HOOKPOINTS.json repositories (not var/db/*.db)
habits:
  before_grep: "file://*/symbols (30 tokens vs grep 200 tokens)"
  before_find: "project://./structure (instant vs find slow)"
  before_cat: "file://*/structure (outline vs full read)"
patterns:
  explore_project: "project://./structure (not find/ls)"
  discover_symbols: "file://*/symbols (not grep class/function)"
  analyze_imports: "file://*/imports (not grep import)"
opportunity_cost:
  grep_class: "200 tokens, slow → file://*/symbols?type=class 30 tokens, instant"
  find_files: "150 tokens, slow → project://./structure 30 tokens, cached"
  cat_outline: "5000+ tokens → file://*/structure 50 tokens, formatted"
discovery:
  mcp: ListMcpResourcesTool → ReadMcpResourceTool
  tools: cat ZMCPTools/etc/TOOL_LIST.md
  removed: [orchestration, communication, plan_management, web_scraping]
active_work:
  hook: GitHub issues (gh issue list)
  priority_1: "#55 MTEB leaderboard - benchmark search effectiveness"
  priority_2: "#53 Phase 1 - FTS5 + dual-indexing (code + markdown)"
  priority_3: "#54 Phase 2 - Hybrid search (BM25+FTS5+semantic+reranker)"
  context: "Search architecture: FTS5=SQLite tokenizer, BM25=pre-parsed ranking, semantic=qwen3-embedding-4B (2 workers), reranker=qwen3-reranker-4B (1 worker) port 8765"
diagnostics:
  pattern: "diagnostics object in tool response"
  flag: "diagnostics.level (warn, error, info)"
  pointer: "diagnostics.logId (e.g., req-a7b3f9c2)"
  action: "read_resource('logs://search?query=' + logId)"
  purpose: "on-demand logs, no token spam"
---

# ZMCPTools MCP Integration v3.0

## 🔥 Active Work (Check Issues First)

**Primary hook**: `gh issue list --limit 10`

**Current priorities**:
1. **#55** - MTEB leaderboard (main priority - benchmark search)
2. **#53** - Phase 1: Flexible indexing (FTS5 + dual-indexing)
3. **#54** - Phase 2: Hybrid search layer

**Architecture context**:
- FTS5: SQLite extension using BM25 for ranking (full-text docs)
- BM25 direct: Pre-parsed symbols/imports (skip tokenization)
- Semantic: qwen3-embedding 4B (2560D, 28 embed/s, 2 workers port 8765)
- Reranker: qwen3-reranker 4B (1 worker port 8765, ~700ms/100-pairs)

**Related**: TalentOS #82 (Phase 3 adaptive search)

---

# ZMCPTools MCP Integration v3.0

## 🔥 CRITICAL: Repository Hookpoints (READ FIRST)

**Before creating ANY database or task tracker**:
```bash
cat ZMCPTools/REPOSITORY_HOOKPOINTS.json
```

**Repositories available** (Drizzle ORM, single database):
- `ToolCallLogRepository` - Log ALL tool calls (not scavenger.db)
- `ErrorLogRepository` - Log ALL errors (not separate error DB)
- `TaskRepository` - Track ALL tasks (not task_verification.db)
- `PlanRepository` - Store ALL plans (not harvest_index.db)
- `CommunicationRepository` - Agent messages (not message_routing.db)
- `DocumentationRepository` - Index docs (not grep)
- `KnowledgeGraphRepository` - Entities/relationships/insights
- `AgentRepository` - Agent sessions (not talent_states.db)

**Anti-pattern**: Creating `var/db/my_new_database.db`
**Correct**: Use existing repository or extend Drizzle schema

**Verification token**: `ZMCP_REPOS_v1.0_LOADED`

## Discovery Protocol

**Progressive discovery** (load on demand, not upfront):
1. **Check repositories FIRST**: `cat REPOSITORY_HOOKPOINTS.json`
2. Read `etc/TOOL_LIST.md` to see available tools
3. Call specific tools when needed
4. Full documentation in etc/TOOL_LIST.md (not in tool registration)

**MCP Resources** (primary):
- `ListMcpResourcesTool` - See available resources
- `ReadMcpResourceTool` - Read specific resources

## 🎯 Muscle Memory: Resources Over Tools

**Before reaching for grep/find, try AST resources**:

| Old Habit (Tools) | New Reflex (Resources) | Savings |
|------------------|----------------------|---------|
| `grep -r "class SymbolGraph"` | `file://*/symbols?type=class` | 200→30 tokens, instant |
| `find . -name "*.ts"` | `project://./structure` | 150→30 tokens, cached |
| `cat file.ts \| head -50` | `file://*/structure` | 5000→50 tokens, outline |
| `grep "import.*LanceDB"` | `file://*/imports` | 200→30 tokens, parsed |

**Examples**:

```typescript
// ❌ OLD: Search for method
Bash: grep -n "async.*search" src/services/*.ts

// ✅ NEW: Use AST resource
file://src/services/HybridSearchService.ts/symbols?type=method&name=search*

// Returns: Structured list with exact locations, signatures, types
```

```typescript
// ❌ OLD: Explore project structure
Bash: find src -type f -name "*.ts" | grep -v test

// ✅ NEW: Use project resource
project://./structure?max_depth=3

// Returns: Tree view, smart ignores, instant
```

**Why this matters**:
- Resources = 30 tokens, Tools = 200 tokens (85% savings)
- Resources = instant (cached AST), Tools = slow (re-parse)
- Resources = structured data, Tools = raw text

**Documentation & References** (authoritative):
- `cat etc/TOOL_LIST.md` - MCP tool catalog (READ FIRST for tool discovery)
- `cat etc/AGENT_TOOL_LIST.md` - Agent tool catalog
- `cat etc/RESOURCE_REGISTRY.md` - MCP resource registry
- `cat etc/META_DOCUMENTATION_MAP.md` - Documentation index
- `cat etc/GITHUB_ISSUES.md` - GitHub labels & issue protocol
- `cat etc/decisions/` - Design decision rationale
- `cat etc/test-plans/` - Test criteria & validation

**Knowledge Graph Usage** (CRITICAL - read before implementing):
- `knowledge://search` - Search GitHub issues, docs, architecture patterns, prior solutions
- `knowledge://status` - Check what's indexed (entities, relationships, quality metrics)
- `knowledge://entity/{id}/related` - Discover connections after finding an entity
- **Use case**: Always search before implementing to avoid duplicate work
- **Example**: `knowledge://search?query=resource+migration+MCP` finds Issue #35 with full context

## Core Patterns

**Resources vs Tools**:
- Resources: Read-only (30 tokens) - `file://`, `project://`, `knowledge://`
- Tools: Mutations (200 tokens) - Create, update, delete

**Token optimization**: 97% reduction via resources

## Essential Services

**GPU embedding** (port 8765):
- Semantic search (10x faster)
- Check: `curl http://localhost:8765/health`
- Status: `knowledge://status`

**LanceDB**: Vector storage at `~/.mcptools/lancedb/`

## Quick Reference

**Analyze project**:
```
resource://project://./structure
```

**Search knowledge graph** (GitHub issues, docs, architecture):
```
resource://knowledge://search?query=embedding+service&limit=10
```

**Vector search** (LanceDB collections):
```
resource://vector://search?query=semantic+search&collection=documentation&limit=10
resource://vector://collections  (list all collections)
resource://vector://status        (check GPU status)
```

**Browser automation**:
```
create_browser_session() → perform_dynamic_interaction()
```

## Removed Tools

Orchestration (23), web scraping (9) - pending claude-agent-sdk

---

**Progressive discovery**: Load full docs via `cat ZMCPTools/etc/TOOL_LIST.md`
**Token reduction**: 87% vs v2.0 (182 vs 1,402 words)
