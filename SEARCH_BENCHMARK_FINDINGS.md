# Search Benchmark Findings

**Date**: 2025-10-10 (Updated with complete results)
**Objective**: Measure search effectiveness across different retrieval methods
**Test Set**: 15 queries (5 code, 5 conceptual, 5 mixed) against ZMCPTools codebase (287 files)

## Results Summary

### Leaderboard (R@10)

| Method | Recall@10 | MRR | nDCG@10 | Latency | Status |
|--------|-----------|-----|---------|---------|--------|
| **Symbol-BM25** | **60%** 👑 | **0.84** | **0.63** | 10ms | ✅ **Winner** (best for code) |
| **Naive BM25** | 55% | 0.63 | 0.51 | 8ms | ✅ Baseline |
| **Hybrid** | 55% | 0.63 | 0.51 | 8ms | ⚠️ Same as BM25 (semantic failed) |
| **Semantic (GPU)** | 0% | 0.00 | 0.00 | 27ms | ❌ **Broken** (LanceDB dimension mismatch) |
| FTS5 | - | - | - | - | ⏳ TODO |
| Reranked | - | - | - | - | ⏳ TODO |

### Performance by Query Type

**Symbol-BM25** (✅ Winner):
- **Code queries: 80%** recall ← **+33% improvement over baseline!**
- Conceptual queries: 46.7% recall
- Mixed queries: 53.0% recall

**Naive BM25** (baseline):
- Code queries: 60% recall
- **Conceptual queries: 48.3%** recall ← Better than symbol on concepts
- **Mixed queries: 58.0%** recall ← Better than symbol on mixed

## Key Findings

### 1. Naive BM25 is Mediocre (60% recall)

**Why it fails**:
```typescript
// Query: "ResourceManager readResource"
// Problem: These score equally:
import { ResourceManager } from './managers/ResourceManager.js'  // ❌ Import (usage)
export class ResourceManager { readResource() {...} }           // ✅ Definition
```

**Missing 40% of relevant docs** because:
- No distinction between DEFINING vs USING symbols
- Entire file treated as one blob (no chunking)
- No TF-IDF or document length normalization
- Simple substring matching (not proper tokenization)

### 2. Semantic Search (CPU) is WORSE than BM25 (42% recall)

**Shocking result**: Embeddings underperformed keyword matching!

**Why semantic failed**:
1. **Wrong embeddings**: Used CPU fallback (384D MiniLM) instead of GPU gemma3 (768D)
2. **Wrong granularity**: Embedded entire files, not symbol-level chunks
3. **Wrong for code**: Semantic similarity doesn't help with exact symbol lookup
   - Query: "VectorSearchService searchSimilar"
   - Needs: Exact class/method match
   - Got: Semantically similar but wrong files

**Worst performance**: Mixed queries (22.3% recall) - catastrophic failure

### 3. Symbol-Aware BM25: ✅ Complete, Fast, Effective for Code

**Algorithm** (ZMCPTools/bin/benchmark-search.ts:283-363):
```typescript
function symbolAwareBM25Score(query, filePath, content, symbolInfo) {
  let score = bm25Score(query, content) * 0.3;  // Base content matching

  // File path boost: "ResourceManager" query → "ResourceManager.ts"
  if (fileName.includes(term)) score += 2.0;

  // Exported symbols (strongest signal - file DEFINES the symbol)
  if (exportedSymbols.includes(term)) score += 3.0;

  // Class/function definitions
  if (definedSymbols.includes(term)) score += 1.5;

  // Import penalty (file only USES the symbol)
  if (hasImport && !hasDefinition) score *= 0.3;  // -70% penalty

  return score;
}
```

**Results**:
- ✅ **80% recall on CODE queries** (60%→80% = +33% improvement)
- ✅ **<1 second indexing** for 287 files (fixed memory leak)
- ⚠️ **46.7% recall on CONCEPTUAL** (worse than naive 48.3%)
- 📊 **60% overall recall** (not 85-90% target)

**Critical fix** (SimpleASTTool.ts:87-103):
- ❌ **Before**: `ts.createProgram()` per file → OOM crash at 150/287 files
- ✅ **After**: `ts.createSourceFile()` → lightweight parsing → success

### 4. Semantic Search (GPU gemma3): ❌ BROKEN

**Error**: LanceDB vector dimension mismatch
```
No vector column found to match with the query vector dimension: 768
```

**Root cause**: Collection schema mismatch with embedding model
- Expected: 768D vectors (gemma_embed)
- Got: Schema doesn't have vector column

**Impact**:
- Semantic search: 0% recall (all queries failed)
- Hybrid fusion: Degraded to naive BM25 (no semantic component)

**Fix needed**: Rebuild LanceDB collection with proper schema

## Critical Learnings

### 1. Symbol-Awareness: Effective but Not Sufficient

**What worked**:
- ✅ 60%→80% on code queries (+33% relative improvement)
- ✅ Export prioritization > definition > import penalty
- ✅ File name matching is strong signal

**What didn't**:
- ❌ Hurt conceptual queries (48.3%→46.7%)
- ❌ Didn't reach 85-90% target (only 80% on code)
- ❌ Overall still 60% recall (same as naive on all queries)

**Why 80% ≠ 90%**:
- Symbol matching alone isn't enough
- Need semantic understanding for conceptual queries
- Need hybrid approach: symbol for code, semantic for concepts

### 2. Semantic Search Prerequisite: Fix LanceDB Schema

**Current blocker**: Can't test hybrid without working semantic search

**Fix required**:
1. Rebuild collection with proper vector column schema
2. Re-index 287 files with gemma3 embeddings (768D)
3. Test semantic search alone (expect 70-80% on conceptual)
4. Test true hybrid fusion (expect 85-90% overall)

### 3. Why "60% Recall SUCKS"

**Test query example** (code-001):
```json
{
  "query": "ResourceManager readResource",
  "relevant_docs": [
    {"file": "src/managers/ResourceManager.ts", "relevance": 3},
    {"file": "src/server/McpServer.ts", "relevance": 2},
    {"file": "etc/RESOURCE_REGISTRY.md", "relevance": 1}
  ]
}
```

With naive BM25:
- ✅ Finds ResourceManager.ts (3.0 relevance)
- ❌ Misses McpServer.ts (ranks below import-only files)
- ❌ Misses RESOURCE_REGISTRY.md (no keyword overlap)

**40% miss rate** = failing to find 1.2 out of 3 relevant docs per query

### Code Search ≠ Document Search

**Traditional IR metrics** (designed for web/document search):
- TF-IDF: Term frequency × inverse document frequency
- BM25: Probabilistic ranking with length normalization
- Semantic: Dense embeddings for conceptual similarity

**Code search needs**:
- Symbol-level granularity (class, function, method)
- Definition vs usage distinction (exports vs imports)
- Exact matching for identifiers
- Structure awareness (AST, not just text)

## Recommendations

### Short-term (Quick Wins)

1. **Pre-compute symbol index**: Cache AST parsing results
   - One-time cost: 10 minutes
   - Query time: <10ms
   - Expected: 85-90% recall

2. **GPU-accelerated semantic**: Use gemma3 (768D) on port 8765
   - Better embeddings than CPU fallback
   - Chunk at function/class level (not entire files)
   - Expected: 70-80% recall on conceptual queries

3. **Hybrid fusion**: Combine symbol-BM25 + semantic
   - Symbol-BM25 for code queries (exact matches)
   - Semantic for conceptual queries (understanding)
   - Expected: 90%+ recall across all query types

### Long-term (Architectural)

1. **Dedicated code search index**:
   - Symbol-level indexing (class, function, method, variable)
   - Metadata enrichment (types, signatures, docs)
   - Multi-field boosting (exports > definitions > usage)

2. **Query understanding**:
   - Detect query type (code vs conceptual vs mixed)
   - Route to appropriate method
   - Adaptive weighting

3. **Reranker integration**:
   - Use qwen3-reranker (4B model on port 8765)
   - Re-score top-K candidates for precision
   - Expected: 95%+ recall with high precision

## Benchmark Implementation

**Location**: `ZMCPTools/bin/benchmark-search.ts`

**Test dataset**: `bin/fixtures/search-test-set.json`
- 15 queries across 3 types
- 48 total relevant documents
- MTEB-style evaluation (Recall@10, MRR, nDCG@10, P@10)

**Methods implemented**:
1. ✅ Naive BM25 (lines 233-246)
2. ✅ Symbol-aware BM25 (lines 252-332)
3. ✅ Semantic search with LanceDB (lines 193-228)
4. ❌ FTS5 (not implemented)
5. ❌ Hybrid (not implemented)
6. ❌ Reranked (not implemented)

**Usage**:
```bash
npm run build
npx tsx bin/benchmark-search.ts
```

**Caching**:
- Symbol index cache: `var/cache/symbol-index.json` (auto-generated)
- LanceDB vectors: `var/storage/lancedb/zmcptools_benchmark.lance` (persistent)

## Next Steps

### Phase 1: Fix Semantic Search (BLOCKING)
1. 🔧 **Debug LanceDB schema issue** (dimension mismatch)
2. 🏗️ **Rebuild collection** with proper vector column
3. 🧪 **Re-run benchmark** with working semantic search
4. 📊 **Validate hybrid fusion** (expect 85-90% overall)

### Phase 2: Production Implementation
1. **SearchIndexRepository** (Drizzle schema):
   ```typescript
   {
     id: serial,
     file_path: varchar(500),
     symbol_name: varchar(200),
     symbol_type: enum('EXPORT_CLASS', 'EXPORT_FUNCTION', 'IMPORT', 'CALL'),
     line_start: integer,
     context_snippet: text,
     file_hash: varchar(64)  // For incremental updates
   }
   ```

2. **SymbolIndexerService** (event-driven):
   - FileChange event → Detect hash change → Parse file → Upsert symbols
   - Persistent index (not query-time parsing)
   - <1s cold start, <10ms incremental updates

3. **HybridSearchService** (query router):
   - Detect query type (code vs conceptual vs mixed)
   - Route: Code → Symbol-BM25, Conceptual → Semantic, Mixed → Hybrid
   - Reciprocal Rank Fusion for hybrid queries

### Phase 3: GitHub Issue Integration
- ✅ **#55**: MTEB leaderboard ← This benchmark
- 🔄 **#53**: FTS5 + dual-indexing ← SearchIndexRepository
- 🔄 **#54**: Hybrid search ← HybridSearchService

---

**Author**: jw
**Last Updated**: 2025-10-10
**Status**: ✅ Symbol-BM25 validated (80% code, 60% overall), ❌ Semantic broken, ⏳ Hybrid blocked
