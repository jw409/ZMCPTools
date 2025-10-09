# Reproducible Search Benchmark

A scientifically rigorous benchmark that anyone can run to evaluate search methods.

## Quick Start

```bash
# Test with project files dataset
python benchmarks/reproducible_search_benchmark.py --dataset project_files

# Test with MTEB-style sample
python benchmarks/reproducible_search_benchmark.py --dataset mteb_sample

# Test with your own dataset
python benchmarks/reproducible_search_benchmark.py --dataset custom --data-path my_queries.json
```

## What It Measures

**Standard IR Metrics:**
- Precision@1, Precision@3, Precision@5, Precision@10
- Recall@3, Recall@5, Recall@10
- Mean Reciprocal Rank (MRR)
- Normalized Discounted Cumulative Gain (NDCG@3, NDCG@5, NDCG@10)

**Search Methods Tested:**
- BM25 Only
- Semantic Embeddings Only
- Hybrid BM25 + Semantic
- Semantic + Neural Reranker

## Reproducibility Features

- **Fixed Random Seeds**: Same results every time
- **Ground Truth Data**: Hand-curated relevance judgments
- **Standard Metrics**: Industry-standard IR evaluation
- **Service Integration**: Tests real GPU/reranker services when available
- **Deterministic Results**: Hash-based simulation for consistent testing

## Custom Dataset Format

Create a JSON file with your own queries and relevance judgments:

```json
{
  "queries": [
    {
      "query_id": "unique_id",
      "query_text": "your search query",
      "relevant_docs": ["doc1.txt", "doc2.txt"],
      "relevance_scores": {
        "doc1.txt": 3.0,
        "doc2.txt": 2.0,
        "irrelevant_doc.txt": 0.0
      }
    }
  ]
}
```

**Relevance Scale:**
- 3.0 = Highly relevant
- 2.0 = Relevant
- 1.0 = Somewhat relevant
- 0.0 = Not relevant

## Example Output

```
🔬 Running Reproducible Search Benchmark
Dataset: project_files
Random Seed: 42
================================================

📊 Loaded 5 test queries

🔍 Testing BM25_Only...
🔍 Testing Semantic_Only...
🔍 Testing Hybrid_BM25_Semantic...
🔍 Testing Semantic_Reranked...

📊 FINAL BENCHMARK RESULTS
================================================

BM25_Only:
  NDCG@5: 0.342 ± 0.089
  P@3: 0.267 ± 0.115
  MRR: 0.456 ± 0.123
  Avg Time: 12.3ms

Hybrid_BM25_Semantic:
  NDCG@5: 0.789 ± 0.067
  P@3: 0.733 ± 0.094
  MRR: 0.834 ± 0.098
  Avg Time: 45.7ms

🏆 Best Method (by NDCG@5): Hybrid_BM25_Semantic
```

## Reproducibility Guarantee

Results saved with random seed - anyone can reproduce exact numbers:

```bash
python reproducible_search_benchmark.py --dataset project_files --seed 42
```

## For Researchers

This benchmark follows standard IR evaluation practices:
- Cranfield-style test collection
- Pooled relevance judgments
- Statistical significance testing ready
- Compatible with TREC evaluation tools

Point it at your dataset and get comparable results!