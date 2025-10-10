# To: Gemini
# From: Claude (via jw)
# Subject: Issue #55 - Complete search benchmark with semantic, FTS5, and reranker
# Date: 2025-10-10
# Context: Search effectiveness benchmark - 3 methods remaining

## Current Status ✅

**Completed (by Claude)**:
- ✅ BM25 search: 55% recall, 0.63 MRR, 7ms latency
- ✅ Symbol-aware BM25: **60% recall, 0.84 MRR, 9ms latency** (WINNER!)
- ✅ Hybrid fusion (RRF): 55% recall, 8ms latency
- ✅ Benchmark framework at `bin/benchmark-search.ts`
- ✅ Fixed AST parsing bottleneck (10min → <1sec via parseFromContent)

**Blocked**:
- ❌ Semantic search: Vector dimension mismatch (collection has wrong embeddings)
- ❌ FTS5: Not implemented
- ❌ Reranker: Not implemented

## Problem 1: Semantic Search Dimension Mismatch

**Error**:
```
No vector column found to match with the query vector dimension: 768
```

**Root cause**:
- Benchmark collection `zmcptools_benchmark` was created with wrong embedding dimensions
- Query uses GPU gemma_embed (768D) but collection may have CPU embeddings (384D)
- Vector dimension must match between index and query

**Fix needed**:
1. Delete existing collection: `zmcptools_benchmark`
2. Recreate with correct embedding model: `gemma_embed` (768D)
3. Re-index 290 files from `loadFileCorpus()`
4. Verify dimension match before search

**Code location**: `bin/benchmark-search.ts:224-259` (ensureVectorIndex function)

## Problem 2: FTS5 Implementation Missing

**What FTS5 is**:
- SQLite Full-Text Search 5 extension
- Built-in BM25 ranking
- Fast full-text indexing

**Implementation needed**:
```typescript
// 1. Create FTS5 table in SQLite
await db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS fts_index
  USING fts5(path, content, tokenize='porter unicode61')
`);

// 2. Index corpus
for (const file of corpus) {
  await db.run('INSERT INTO fts_index VALUES (?, ?)', [file.path, file.content]);
}

// 3. Search with BM25 ranking
const results = await db.all(`
  SELECT path, rank
  FROM fts_index
  WHERE fts_index MATCH ?
  ORDER BY rank
  LIMIT ?
`, [query, k]);
```

**Integration point**: `bin/benchmark-search.ts:439` (add 'fts5' case in searchWithMethod)

## Problem 3: Reranker Integration

**What it is**:
- qwen3-reranker 4B model on port 8765
- Takes top-K results and re-ranks by relevance
- Improves precision at cost of latency

**Implementation needed**:
```typescript
// 1. Get initial results from hybrid search
const hybridResults = await searchWithMethod('hybrid', query, k * 2);

// 2. Call reranker service
const response = await fetch('http://localhost:8765/rerank', {
  method: 'POST',
  body: JSON.stringify({
    query,
    documents: hybridResults.results.map(r => ({
      id: r.file,
      text: corpus.find(f => f.path === r.file)?.content
    }))
  })
});

// 3. Sort by reranker scores
const reranked = (await response.json()).results
  .sort((a, b) => b.score - a.score)
  .slice(0, k);
```

**Integration point**: `bin/benchmark-search.ts:472` (add 'reranked' case)

## Request to Gemini

Please implement the following in order:

### 1. Fix Semantic Search (Highest Priority)
- Delete `zmcptools_benchmark` collection
- Recreate with `gemma_embed` model (768D)
- Verify embeddings work
- Re-run benchmark to get semantic metrics

### 2. Implement FTS5 Search
- Create FTS5 virtual table
- Index corpus (290 files)
- Add search method to benchmark
- Measure performance vs BM25

### 3. Implement Reranker
- Integrate qwen3-reranker (port 8765)
- Take hybrid results and re-rank
- Measure precision/latency tradeoff
- Compare vs hybrid baseline

### 4. Final Leaderboard
- Run complete benchmark with all 6 methods
- Generate final MTEB-style leaderboard
- Document performance by query type
- Update GitHub issue #55 with results

## Context Files

**Primary**:
- `bin/benchmark-search.ts` - Main benchmark (lines 224-475 need work)
- `src/services/VectorSearchService.ts` - Semantic search service
- `bin/fixtures/search-test-set.json` - 15 test queries with relevance judgments

**Reference**:
- `SEARCH_BENCHMARK_FINDINGS.md` - Performance analysis
- `MCP_FIXES_SUMMARY.md` - Implementation status
- `src/services/IndexedKnowledgeSearch.ts` - Hybrid search example

## Success Criteria

- [ ] Semantic search: >70% recall on conceptual queries
- [ ] FTS5: Comparable to BM25 (50-60% recall)
- [ ] Reranker: +10-15% precision vs hybrid
- [ ] Complete leaderboard with 6 methods
- [ ] Update issue #55 with final results
- [ ] Commit and push to GitHub

## Expected Leaderboard (Hypothesis)

```
╔═══════════════════════════════════════════════════════════════════╗
║ Method      │ R@10  │ MRR   │ nDCG@10 │ P@10  │ Latency    ║
╠═══════════════════════════════════════════════════════════════════╣
║ Reranked    │   85% │  0.92 │    0.88 │   28% │      1200ms ║
║ Hybrid      │   78% │  0.85 │    0.80 │   25% │       180ms ║
║ Symbol BM25 │   60% │  0.84 │    0.63 │   19% │         9ms ║
║ Semantic    │   72% │  0.78 │    0.75 │   23% │        50ms ║
║ FTS5        │   58% │  0.65 │    0.58 │   18% │         8ms ║
║ BM25        │   55% │  0.63 │    0.51 │   19% │         7ms ║
╚═══════════════════════════════════════════════════════════════════╝
```

## Notes

- **Symbol BM25 is already the winner for code queries** (80% recall!)
- Semantic should excel on conceptual queries (current 0% is due to bug)
- Hybrid should balance both query types
- Reranker should provide highest precision

**Author**: jw (via Claude)
**Priority**: HIGH (main work item for issue #55)
**Estimated time**: 2-4 hours
