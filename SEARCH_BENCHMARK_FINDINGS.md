# Search Benchmark Findings

**Date**: 2025-10-09
**Objective**: Measure search effectiveness across different retrieval methods
**Test Set**: 15 queries (5 code, 5 conceptual, 5 mixed) against ZMCPTools codebase (287 files)

## Results Summary

### Leaderboard

| Method | Recall@10 | MRR | nDCG@10 | Latency | Status |
|--------|-----------|-----|---------|---------|--------|
| **Naive BM25** | **60%** | 0.64 | 0.53 | 8ms | ✅ Baseline |
| **Semantic (CPU)** | 42% | 0.51 | 0.40 | 7ms | ✅ Implemented |
| **Symbol-BM25** | TBD | TBD | TBD | TBD | ⚠️ Slow indexing (10+ min for 287 files) |
| FTS5 | 0% | 0.00 | 0.00 | 0ms | ❌ Not implemented |
| Hybrid | 0% | 0.00 | 0.00 | 0ms | ❌ Not implemented |
| Reranked | 0% | 0.00 | 0.00 | 0ms | ❌ Not implemented |

### Performance by Query Type

**Naive BM25**:
- Code queries: 66.7% recall
- Conceptual queries: 55.0% recall
- Mixed queries: 58.0% recall

**Semantic (CPU embeddings - 384D MiniLM)**:
- Code queries: 60.0% recall
- Conceptual queries: 43.3% recall
- Mixed queries: 22.3% recall ⚠️ **Dramatic failure**

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

### 3. Symbol-Aware BM25: Implementation Complete, Indexing Bottleneck

**Algorithm** (ZMCPTools/bin/benchmark-search.ts:252-332):
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

**Performance**: TypeScript AST parsing bottleneck
- 287 files × ~2 seconds/file = **10+ minutes** indexing time
- Need caching to make practical
- Expected recall: 85-90% (based on algorithm design)

## Learnings

### Why "60% Recall SUCKS"

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

1. ⏳ Wait for symbol-BM25 benchmark to complete (get actual recall numbers)
2. 🚀 Implement GPU semantic search (gemma3 on port 8765)
3. 🔄 Implement hybrid fusion (BM25 + semantic)
4. 📊 Generate final leaderboard comparing all methods
5. 🎯 Deploy winning method to production search

---

**Author**: jw
**Verification**: Compare against production search in `src/services/IndexedKnowledgeSearch.ts` (currently uses same naive BM25)
