# ZMCPTools vs ck (Semantic Code Search) - Comparative Analysis

**Date**: 2025-10-18
**Session**: Post-Drizzle ORM migration
**Reference**: `/home/jw/dev/game1/references/ck` (ck v0.4.x)

---

## Executive Summary

### Overall Assessment: **Strong Foundation, Missing Key Features**

**ZMCPTools Status**: ✅ Working BM25 + semantic search with Drizzle ORM, MCP integration
**ck Status**: 🎯 Production-grade semantic grep with TUI, hybrid search, grep compatibility

**Verdict**: ZMCPTools has solid infrastructure but lacks ck's user-facing polish, hybrid search implementation, and grep compatibility. Strong MCP integration advantage.

---

## Feature Comparison Matrix

| Feature | ZMCPTools | ck | Gap Analysis |
|---------|-----------|----|--------------|
| **Search Capabilities** |
| BM25 keyword search | ✅ FTS5 implementation | ✅ Tantivy (BM25) | **Parity** - Both have keyword search |
| Semantic search | ✅ GPU embeddings (Qwen3/Gemma3) | ✅ fastembed (BGE-small, MiniLM) | **Slight edge ck** - More model options |
| Hybrid search | ⚠️ **Fusion not implemented** | ✅ Reciprocal Rank Fusion (RRF) | **Critical gap** - We lack RRF |
| Reranker | ✅ Qwen3-reranker 4B (port 8765) | ❌ Not mentioned | **ZMCPTools advantage** |
| **Indexing** |
| Incremental indexing | ✅ Hash-based (>95% cache hit) | ✅ Hash-based (blake3) | **Parity** |
| Symbol extraction | ✅ Tree-sitter AST | ✅ Tree-sitter chunking | **Parity** |
| Code-aware chunking | ✅ SemanticChunker | ✅ Language-aware (Python, TS) | **Parity** |
| Import/export tracking | ✅ Drizzle ORM repos | ❌ Not mentioned | **ZMCPTools advantage** |
| **Storage** |
| Database | ✅ SQLite (Drizzle ORM) | ✅ Sidecar `.ck/` files | **Different approaches** |
| Vector DB | ✅ LanceDB | ✅ HNSW (pure Rust) | **Different backends** |
| BM25 storage | ✅ FTS5 virtual table | ✅ Tantivy | **Different engines** |
| **Integration** |
| MCP server | ✅ Full MCP integration (101 tools) | ✅ MCP server mode (`--serve`) | **ZMCPTools richer** |
| CLI interface | ⚠️ Via MCP only | ✅ Standalone `ck` binary | **Critical gap** |
| grep compatibility | ❌ None | ✅ Full (`-n`, `-C`, `-A`, `-B`, etc.) | **Critical gap** |
| TUI | ❌ None | ✅ Interactive TUI (`--tui`) | **Major gap** |
| JSON output | ✅ Structured responses | ✅ `--json-v1` with schema | **Parity** |
| **Performance** |
| Indexing speed | ⚠️ Unknown (need benchmarks) | ✅ Rust-optimized, parallel | **Likely ck faster** |
| Search speed | ✅ <50ms for 2200 docs | ⚠️ Unknown (need benchmarks) | **Need comparison** |
| Memory usage | ⚠️ Node.js overhead | ✅ Minimal Rust footprint | **ck advantage** |
| **Architecture** |
| Language | TypeScript (Node.js) | Rust | **Trade-offs** |
| Dependencies | Heavy (Drizzle, better-sqlite3, etc.) | Minimal (Rust std lib focus) | **ck cleaner** |
| Modularity | ✅ Repository pattern, services | ✅ Trait-based (Embedder, AnnIndex) | **Both good** |
| **User Experience** |
| Installation | npm install (MCP context) | `cargo install ck-search` | **ck simpler** |
| Discoverability | MCP tools in Claude | CLI `--help` | **Different contexts** |
| Error messages | ⚠️ Improving (recent fixes) | ✅ Rust Result types | **ck likely better** |

---

## Critical Gaps

### 1. **No Hybrid Search Implementation** 🔴 HIGH PRIORITY

**ck approach**: Reciprocal Rank Fusion (RRF) combining BM25 + semantic scores

**ZMCPTools current**:
- ✅ Retrieves BM25 results separately
- ✅ Retrieves semantic results separately
- ⚠️ Naive weighted combination: `bm25_score * 0.3 + semantic_score * 0.7`
- ❌ No proper fusion algorithm (RRF)

**Impact**: Search quality degraded vs ck's principled ranking

**Fix**: Implement RRF in `unifiedSearchTool.ts:313-348`

```typescript
// Current (naive):
combined_score = bm25_score * bm25_weight + semantic_score * semantic_weight

// Need (RRF):
rrf_score = sum(1 / (k + rank_i)) for all ranking sources
```

**File**: `src/tools/unifiedSearchTool.ts:313-348`
**Estimated effort**: 4-6 hours (RRF algorithm + testing)

---

### 2. **No Standalone CLI** 🔴 HIGH PRIORITY

**ck**: Standalone binary `ck --sem "query" src/`
**ZMCPTools**: Only accessible via MCP (Claude Code, etc.)

**Impact**:
- Can't use ZMCPTools from terminal directly
- No integration with scripts, CI/CD, shell workflows
- Limited to Claude Code users

**Fix**: Create CLI wrapper similar to `ck-cli` crate

**Estimated effort**: 8-12 hours (CLI parser + grep compat layer)

---

### 3. **No grep Compatibility** 🟡 MEDIUM PRIORITY

**ck flags**: `-n`, `-C`, `-A`, `-B`, `-R`, `-i`, `-F`, `-w`, `-h`, `-H`, `-l`, `-L`
**ZMCPTools**: None

**Impact**: Developers can't drop-in replace `grep` calls

**Fix**: Add grep-compatible flag parsing to CLI (if created)

**Estimated effort**: Included in CLI work above

---

### 4. **No Interactive TUI** 🟢 LOW PRIORITY (Nice-to-have)

**ck**: Full TUI with heatmap preview, syntax highlighting, multi-select
**ZMCPTools**: None

**Impact**: Power users prefer TUI for exploration

**Fix**: Create TUI wrapper (separate effort, not critical for MCP use case)

**Estimated effort**: 20-30 hours (full TUI implementation)

---

## ZMCPTools Advantages

### 1. **Neural Reranker** ✅

**ZMCPTools**: Qwen3-reranker 4B (port 8765) for final ranking precision
**ck**: No reranker mentioned

**Benefit**: Two-stage retrieval (candidate retrieval → reranking) for higher quality results

---

### 2. **Richer MCP Integration** ✅

**ZMCPTools**: 101 tools across knowledge graph, browser automation, orchestration
**ck**: 6 MCP tools focused on search only

**Benefit**: Comprehensive agent toolkit beyond just search

---

### 3. **Import/Export Graph** ✅

**ZMCPTools**: Full import/export tracking via `ImportsExportsRepository`
**ck**: Not explicitly mentioned

**Benefit**: Dependency analysis, impact analysis, circular dependency detection

---

### 4. **Drizzle ORM Integration** ✅

**ZMCPTools**: Type-safe database access, migrations, schema validation
**ck**: Direct file I/O with sidecar `.ck/` files

**Benefit**: Easier schema evolution, better tooling integration

---

## Architecture Comparison

### ck Architecture (Rust)

```
ck-cli
├── ck-core (traits, config)
├── ck-index (file hashing, chunking)
├── ck-chunk (tree-sitter parsers)
├── ck-embed (fastembed, API backends)
├── ck-ann (HNSW, FAISS optional)
├── ck-engine (search, RRF fusion)
├── ck-models (embedding model registry)
└── ck-tui (interactive interface)
```

**Strengths**:
- Modular crates with clear boundaries
- Trait-based extensibility (Embedder, AnnIndex)
- Single binary output
- Minimal dependencies

**Weaknesses**:
- Rust learning curve
- Less ecosystem integration (vs Node.js)

---

### ZMCPTools Architecture (TypeScript)

```
ZMCPTools
├── services/
│   ├── SymbolGraphIndexer (orchestration)
│   ├── BM25Service (FTS5)
│   ├── EmbeddingClient (GPU service)
│   ├── LanceDBService (vector DB)
│   └── SemanticChunker
├── repositories/ (Drizzle ORM)
│   ├── SymbolsRepository
│   ├── ImportsExportsRepository
│   └── SymbolIndexRepository
├── schemas/ (Drizzle schemas)
└── tools/ (MCP tool definitions)
```

**Strengths**:
- Rich TypeScript ecosystem
- Drizzle ORM for type safety
- Easy MCP integration
- Familiar to web developers

**Weaknesses**:
- Node.js overhead
- More dependencies
- No standalone CLI

---

## Performance Analysis

### Indexing Performance

| Metric | ZMCPTools | ck | Notes |
|--------|-----------|----|----|
| 50 files | 1.2-1.3s | ⚠️ Need benchmark | ZMCPTools measured this session |
| Cache hit rate | 95%+ | ⚠️ Likely similar | Hash-based in both |
| Parallel processing | ✅ 4 workers default | ✅ Rayon parallelism | Similar |

**Hypothesis**: ck likely 2-5x faster due to Rust

---

### Search Performance

| Metric | ZMCPTools | ck | Notes |
|--------|-----------|----|----|
| BM25 search | <50ms (2200 docs) | ⚠️ Need benchmark | FTS5 vs Tantivy |
| Semantic search | ⚠️ Need benchmark | ⚠️ Need benchmark | GPU vs CPU embeddings |
| Hybrid search | N/A (not implemented) | ⚠️ Need benchmark | - |

**Need**: Benchmarking suite to compare apples-to-apples

---

## Recommendations

### Immediate (Next Session)

1. **✅ DONE: Fix FK constraints** - Completed this session
2. **✅ DONE: Fix null location handling** - Completed this session
3. **🔴 NEXT: Implement RRF fusion** - Critical for search quality
   - File: `src/tools/unifiedSearchTool.ts:313-348`
   - Reference: ck `ck-engine` crate RRF implementation
   - Estimated: 4-6 hours

### Short-term (1-2 weeks)

4. **Create standalone CLI** (`src/cli/ck-compat.ts`)
   - Minimal grep-compatible flags: `-n`, `-C`, `-R`
   - Semantic search: `--sem "query"`
   - Hybrid: `--hybrid "query"`
   - Estimated: 8-12 hours

5. **Benchmark suite** (`benchmarks/compare-ck.ts`)
   - Index same repo with both tools
   - Compare search quality (precision/recall)
   - Compare speed (indexing + search)
   - Estimated: 6-8 hours

### Medium-term (1-2 months)

6. **Symbol-aware BM25 boosting** (already designed, not implemented)
   - Boost files that DEFINE symbols vs only USE them
   - Target: 80% recall (vs 60% naive BM25)
   - Reference: `src/schemas/symbol-index.ts:61-82` (boost config table)

7. **Multi-model embedding support**
   - Currently: Qwen3, Gemma3, MiniLM via GPU service
   - Add: OpenAI/HF API backends (ck-compatible)
   - Benefit: Cloud embeddings for non-GPU users

8. **TUI (optional)** - Low priority for MCP use case

---

## Test Plan

### ✅ Completed This Session

1. Search for single file (`test` query) → ✅ Returns 2 results
2. Index 50 files with FK fix → ✅ No errors
3. Search across 50 files (`MemoryService`) → ✅ Returns 1 result with 28 symbols
4. Search broader term (`Repository`) → ✅ Returns 3 ranked results

### 🔴 Required Next

1. **RRF fusion accuracy test**
   - Query: "error handling"
   - Expected: try/catch blocks, error returns ranked by relevance
   - Compare: naive fusion vs RRF vs ck results

2. **Large repo test**
   - Index 1000+ files
   - Measure: indexing time, cache hit rate, search latency
   - Compare: ZMCPTools vs ck

3. **Grep compatibility test** (if CLI built)
   - Run identical queries: `ck -n "pattern"` vs `grep -n "pattern"`
   - Verify: same results, same format

---

## Conclusion

### What We Have ✅

- Solid BM25 + semantic search foundation
- Drizzle ORM integration (type-safe, schema evolution)
- Neural reranker (unique advantage)
- Import/export graph tracking
- MCP integration (101 tools)

### What We Need 🔴

- **Critical**: RRF hybrid fusion algorithm
- **Critical**: Standalone CLI for terminal use
- **Important**: grep compatibility layer
- **Nice-to-have**: TUI for interactive exploration

### Strategic Position

**ZMCPTools**: Agent-first, MCP-native, comprehensive toolkit
**ck**: Developer-first, grep-compatible, semantic grep

**Synergy opportunity**: Use ck's RRF algorithm + grep UX patterns, keep ZMCPTools' MCP richness + reranker + import graph.

**Next milestone**: Implement RRF fusion, benchmark against ck on same queries.

---

**Generated**: 2025-10-18 by Claude Code (Sonnet 4.5)
**Reference implementation**: ck v0.4.x (Rust)
**ZMCPTools version**: 0.4.1 (TypeScript)
