# MTEB-style Search Effectiveness Benchmark

**Status**: 🟡 Framework Complete - Search Integration Pending

## Overview

MTEB-inspired benchmark for evaluating search quality across 5 retrieval methods:
- **BM25**: Direct scoring on code symbols
- **FTS5**: SQLite full-text search
- **Semantic**: gemma3 embeddings (768D)
- **Hybrid**: Combined BM25 + semantic
- **Reranked**: Hybrid + qwen3 reranker (4B)

## Files

```
bin/
├── fixtures/
│   └── search-test-set.json      # 15 test queries with relevance judgments
├── benchmark-metrics.ts           # Metrics calculations (Recall@K, MRR, nDCG, etc.)
└── benchmark-search.ts            # Main benchmark runner
```

## Test Dataset

**15 queries** across 3 categories:
- **5 code queries**: Specific symbol/function lookups (e.g., "ResourceManager readResource")
- **5 conceptual queries**: Architectural patterns (e.g., "MCP resource token optimization")
- **5 mixed queries**: Both specific and conceptual (e.g., "pagination cursor encoding")

Each query has:
- **Relevance judgments**: Graded 1-3 (1=marginally relevant, 3=highly relevant)
- **Ground truth**: Manually labeled relevant documents
- **Reasoning**: Why each document is relevant

## Metrics

Implements standard IR metrics:

### Recall@K
Coverage of relevant documents in top K results
```
Recall@10 = |relevant docs in top 10| / |total relevant docs|
```

### MRR (Mean Reciprocal Rank)
How high did the first relevant document rank?
```
MRR = 1 / (rank of first relevant doc)
```

### nDCG@K (Normalized Discounted Cumulative Gain)
Quality of ranking with graded relevance
```
nDCG@10 = DCG@10 / IDCG@10
```

### Precision@K
Accuracy of top K results
```
Precision@10 = |relevant docs in top 10| / 10
```

### MAP (Mean Average Precision)
Mean precision at each relevant document position

## Usage

```bash
# Run full benchmark (all 5 methods)
npx tsx bin/benchmark-search.ts

# Run specific method (when implemented)
npx tsx bin/benchmark-search.ts --method semantic

# Evaluate at different K
npx tsx bin/benchmark-search.ts --k 20

# Save results
npx tsx bin/benchmark-search.ts --output results.json
```

## Output Example

```
╔═══════════════════════════════════════════════════════════════════╗
║          MTEB-like Search Benchmark - ZMCPTools                  ║
╠═══════════════════════════════════════════════════════════════════╣
║ Method      │ R@10  │ MRR   │ nDCG@10 │ P@10  │ Latency    ║
╠═══════════════════════════════════════════════════════════════════╣
║ reranked    │   92% │  0.85 │    0.88 │   90% │    1200ms ║
║ hybrid      │   88% │  0.78 │    0.82 │   85% │     180ms ║
║ semantic    │   75% │  0.68 │    0.71 │   72% │     120ms ║
║ bm25        │   62% │  0.55 │    0.58 │   60% │      12ms ║
║ fts5        │   58% │  0.52 │    0.54 │   56% │       8ms ║
╚═══════════════════════════════════════════════════════════════════╝

Performance by Query Type:
──────────────────────────────────────────────────────────────────────

CODE queries:
  bm25         85.0% ██████████████████████████████████████████
  semantic     62.0% ███████████████████████████████

CONCEPTUAL queries:
  semantic     88.0% ████████████████████████████████████████████
  bm25         45.0% ██████████████████████

MIXED queries:
  hybrid       90.0% █████████████████████████████████████████████
  semantic     75.0% █████████████████████████████████████
```

## Current Status

### ✅ Complete
- Test dataset (15 queries, relevance judgments)
- Metrics calculations (Recall@K, MRR, nDCG, Precision, MAP)
- Benchmark runner framework
- Leaderboard formatting
- By-query-type breakdown
- Latency tracking

### 🟡 Pending
- **Search method integration** (currently returns empty mock results)
  - BM25 implementation
  - FTS5 integration
  - Semantic search (use existing VectorSearchService)
  - Hybrid combination logic
  - Reranker service

## Next Steps

### 1. Integrate Semantic Search (Easiest)

```typescript
async function searchWithMethod(method: string, query: string, k: number) {
  if (method === 'semantic') {
    const vectorService = new VectorSearchService(db, config);
    const results = await vectorService.searchSimilar('documentation', query, k);

    return {
      results: results.map((r, i) => ({
        file: r.metadata.file_path,
        score: r.similarity,
        rank: i + 1
      })),
      latency_ms: /* track time */
    };
  }
  // ... other methods
}
```

### 2. Add BM25 (Uses IndexedKnowledgeSearch)

```typescript
if (method === 'bm25') {
  const searchService = new IndexedKnowledgeSearch(repositoryPath);
  const results = await searchService.search(query, {
    limit: k,
    useBm25: true,
    useSemanticSearch: false
  });
  // Convert to SearchResult[]
}
```

### 3. Add Hybrid (Combine BM25 + Semantic)

```typescript
if (method === 'hybrid') {
  const searchService = new IndexedKnowledgeSearch(repositoryPath);
  const results = await searchService.search(query, {
    limit: k,
    useBm25: true,
    useSemanticSearch: true,
    bm25Weight: 0.3,
    semanticWeight: 0.7
  });
}
```

### 4. Add FTS5 (Requires SQLite FTS5 setup)
- Create FTS5 virtual table
- Index documents
- Query with FTS5 match syntax

### 5. Add Reranker (Requires reranker service)
- Set up qwen3-reranker (4B model)
- Re-score hybrid results
- Return reranked top-K

## Adding New Test Queries

Edit `bin/fixtures/search-test-set.json`:

```json
{
  "id": "code-006",
  "type": "code",
  "query": "your search query here",
  "description": "What this query tests",
  "relevant_docs": [
    {
      "file": "path/to/file.ts",
      "relevance": 3,
      "reason": "Primary implementation"
    }
  ]
}
```

**Relevance scale**:
- **3**: Highly relevant (primary implementation/documentation)
- **2**: Relevant (related code/docs)
- **1**: Marginally relevant (tangential reference)

## Tracking Results Over Time

Save benchmark results to compare across versions:

```bash
npx tsx bin/benchmark-search.ts --output var/benchmarks/$(date +%Y%m%d).json
```

Compare improvements:
```bash
diff -u var/benchmarks/20250101.json var/benchmarks/20250110.json
```

## Related Issues

- **#55**: This benchmark (main priority)
- **#53**: Phase 1 - Indexing infrastructure
- **#54**: Phase 2 - Hybrid search implementation
- **TalentOS #82**: Phase 3 - Adaptive search

## Future Enhancements

- [ ] A/B test different models (gemma3 vs qwen3)
- [ ] Per-partition effectiveness (code vs docs vs whiteboard)
- [ ] Regression detection (alert on metric drops)
- [ ] Query expansion experiments
- [ ] Benchmark different reranker models
