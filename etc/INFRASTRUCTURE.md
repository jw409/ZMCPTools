# Infrastructure Registry

**Generated:** 2025-10-11
**Purpose:** Authoritative documentation for database locations, partitions, venvs, and service endpoints
**Status:** 🟢 Production (qwen3_4b migration complete)

---

## Vector Databases (LanceDB)

### Storage Locations

**Project-local pattern (actual):**
```
{project_root}/var/storage/lancedb/
  ├── symbol_graph_embeddings.lance/  # Symbol graph (2560D)
  ├── default.lance/                  # Default collection
  ├── documentation.lance/            # Documentation embeddings
  ├── whiteboard_search.lance/        # Whiteboard async search
  └── {custom_collection}.lance/      # User-defined collections
```

**Example:**
- `/home/jw/dev/game1/var/storage/lancedb/` - Game1 project
- `ZMCPTools/var/storage/lancedb/` - ZMCPTools (relative)

**Storage philosophy:** Project-local (not global ~/.mcptools/), easier to back up with git

### Active Collections

| Collection | Dimensions | Model | Purpose | Status |
|------------|-----------|-------|---------|--------|
| `symbol_graph_embeddings` | 2560D | qwen3_4b | Symbol embeddings for semantic code search | ✅ Production |
| `default` | 2560D | qwen3_4b | Default collection for general use | ✅ Production |
| `documentation` | Various | Mixed | Documentation embeddings | 🟡 Legacy |
| `whiteboard_search` | Various | Mixed | Async search results | 🟡 Legacy |
| `zmcptools_benchmark` | 2560D | qwen3_4b | MTEB benchmark collection | ✅ Active |

### Embedding Models

**Current (Oct 11, 2025):**
- **Primary:** qwen3_4b (2560D) - +86% quality vs gemma_embed
- **Fallback:** Xenova/all-MiniLM-L6-v2 (384D) - CPU-only mode

**Migration status:**
- ✅ SymbolGraphIndexer (1,870 files indexed)
- ✅ LanceDBService (all hardcodes fixed)
- ✅ VectorSearchService (fixed Oct 11)
- ✅ Knowledge graph collections deleted (old gemma_embed 768D removed)

**Performance:**
- nDCG@10: 0.3227 (qwen3_4b) vs 0.1733 (gemma_embed)
- Latency: 42-214ms
- Throughput: See EMBEDDING_PERFORMANCE_REPORT.md

---

## Knowledge Graph Partitions

**Source:** `ZMCPTools/src/schemas/knowledge-graph.ts:11`

### Partition Schema

| Partition | Valid Entity Types | Use Case |
|-----------|-------------------|----------|
| `dom0` | file, concept, agent, tool, task, requirement, insight | Core/universal entities |
| `project` | All core + repository, dependency, feature, bug, test, documentation, function, class, error, solution, pattern, configuration | Code-specific entities |
| `talent` | All core + skill, experience, goal | Agent/talent capabilities |
| `session` | All core + progress, decision | Session-specific state |
| `whiteboard` | search_result, query, insight | Async search results |

### Entity Type Details

**Core (all partitions):**
- `file`, `concept`, `agent`, `tool`, `task`, `requirement`, `insight`

**Project-specific:**
- Code: `function`, `class`, `repository`, `dependency`
- Quality: `test`, `documentation`, `bug`, `feature`
- Knowledge: `error`, `solution`, `pattern`, `configuration`

**Talent-specific:**
- `skill`, `experience`, `goal`

**Session-specific:**
- `progress`, `decision`

**Whiteboard-only:**
- `search_result`, `query`, `insight`

### Relationship Types

**43 types defined** (src/schemas/knowledge-graph.ts:89-140):

**Agent:** `agent_created`, `agent_discovered`, `agent_used`, `agent_solved`, `agent_worked_on`, `agent_collaborated_with`

**Task:** `task_depends_on`, `task_contains`, `task_implements`, `task_tests`, `task_documents`, `task_fixes`

**Code:** `imports`, `extends`, `implements`, `calls`, `references`, `defines`, `exports`, `inherits_from`, `overrides`

**Error:** `error_caused_by`, `error_resolved_by`, `solution_applies_to`

**Pattern:** `pattern_found_in`, `pattern_similar_to`

**Knowledge:** `relates_to`, `similar_to`, `depends_on`, `conflicts_with`, `enhances`, `replaces`, `derived_from`, `validates`

**Discovery:** `discovered_during`, `learned_from`, `applied_to`, `generalized_from`, `specialized_to`

---

## SQLite Databases

**Registry:** `var/db/INDEX.json` (updated Oct 9, needs refresh for 2560D)

### Active Databases

| Path | Purpose | Owner | Schema Source |
|------|---------|-------|---------------|
| `var/db/zmcp_local.db` | ZMCPTools Drizzle ORM | ZMCPTools | Drizzle schema (code) |
| `var/storage/sqlite/symbol_graph.db` | Symbol relationships | SymbolGraphIndexer | SymbolGraphIndexer.ts |
| `var/storage/sqlite/bm25_index.db` | BM25 search (1000 q/s) | BM25Service.ts | BM25Service.ts |
| `var/storage/sqlite/ast_cache.db` | AST parsing cache | AST parser | Unknown |
| `var/storage/sqlite/git_evolution.db` | Git evolution tracking | Git analyzer | Unknown |
| `var/db/scavenger.db` | Scavenger observations | Scavenger | Python schema |
| `var/db/harvest_index.db` | Scavenger/Teacher coordination | init_harvest_index.py | Python schema |
| `var/db/task_verification.db` | Task verification | task_verifier.py | Python schema |
| `var/db/talent_states.db` | Talent state persistence | talent_runner | Python schema |

### Deprecated/Duplicate

**Flagged for consolidation:**
- `var/db/zmcp.db`, `var/storage/zmcp-tools.db` - Duplicates of zmcp_local.db
- `var/embeddings/codebase_index.db` - Duplicate of LanceDB
- `var/db/message_routing.db` - Filesystem hypercalls work better

---

## Python Virtual Environments

### TalentOS (Primary)

**Location:** `talent-os/.venv/`
**Created by:** `uv venv` (uses `uv.lock`)
**Activation:** `source talent-os/.venv/bin/activate`

**Key packages:**
- `lancedb` - Vector database
- `sentence-transformers` - Embeddings (CPU fallback)
- GPU service dependencies (see SERVICE_PORTS.md)

**Critical rule:** ALWAYS use `uv run python` (not `python` or `python3`)

### Other Venvs

| Project | Location | Purpose |
|---------|----------|---------|
| Scavenger | `.venv/` (root) | Legacy, prefer TalentOS venv |

---

## Service Ports

**Authoritative:** `etc/generated/SERVICE_PORTS.md`

### GPU Embedding Service

**Port:** 8765
**Service:** TalentOS GPU embedding service
**Models:** qwen3_4b (2560D primary), gemma3 (768D legacy), minilm (384D CPU)
**Health:** `curl http://localhost:8765/health`
**Status:** `curl http://localhost:8765/status`

**Performance:**
- qwen3_4b: 36.0 q/s, 50.7ms latency, 0% error (production ready)
- See EMBEDDING_PERFORMANCE_REPORT.md for benchmarks

### Other Services

| Port | Service | Status |
|------|---------|--------|
| 3000 | Web UI (if running) | Optional |
| 5432 | PostgreSQL (if used) | Not in use |

---

## Storage Philosophy

**From var/db/INDEX.json:**

1. **FILESYSTEM first** - JSON/JSONL files for durability
2. **SQLite for queries** - Indexing only, schema-on-read
3. **LanceDB for vectors only** - Tie back to source files

**Drizzle ORM pattern:**
- Schema lives in code
- Database recreated on startup
- No migrations needed

**TalentOS pattern:**
- Schema-on-read
- JSON files primary
- SQLite for fast queries

---

## Verification Commands

```bash
# Check LanceDB collections
ls -lah ~/.mcptools/lancedb/game1/

# Check SQLite databases
cat var/db/INDEX.json | jq '.databases[] | {path, purpose}'

# Check GPU service
curl http://localhost:8765/health

# Check Python venv
uv run python --version

# Check service ports
cat etc/generated/SERVICE_PORTS.md
```

---

## Migration Status (Oct 11, 2025)

**Completed:**
- ✅ Symbol graph: gemma_embed (768D) → qwen3_4b (2560D)
- ✅ All hardcoded model references fixed (3 files)
- ✅ 1,870 files reindexed with 2560D embeddings
- ✅ Search validation (72% similarity on perfect match)
- ✅ Old knowledge_graph collections deleted (gemma_embed 768D removed)
- ✅ Infrastructure documentation created (etc/INFRASTRUCTURE.md)

**Pending:**
- 🟡 Update var/db/INDEX.json with 2560D dimensions
- 🟡 Rebuild + restart MCP server to load new VectorSearchService

---

**Last updated:** 2025-10-11 (qwen3_4b migration)
**Maintainer:** jw
**Related docs:** TOOL_LIST.md, RESOURCE_REGISTRY.md, EMBEDDING_PERFORMANCE_REPORT.md
