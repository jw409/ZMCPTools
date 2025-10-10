#!/usr/bin/env tsx
/**
 * MTEB-style Search Metrics Implementation
 *
 * Implements standard IR evaluation metrics:
 * - Recall@K: Proportion of relevant docs found in top K results
 * - MRR (Mean Reciprocal Rank): 1 / rank of first relevant doc
 * - nDCG@K: Normalized Discounted Cumulative Gain (considers graded relevance)
 * - Precision@K: Proportion of top K results that are relevant
 */

export interface RelevanceJudgment {
  file: string;
  relevance: number;  // 0 = not relevant, 1 = somewhat, 2 = relevant, 3 = highly relevant
}

export interface SearchResult {
  filePath: string;
  score: number;
  rank: number;
}

export interface MetricResult {
  recall_at_10: number;
  mrr: number;
  ndcg_at_10: number;
  precision_at_10: number;
  latency_ms?: number;
}

/**
 * Calculate Recall@K
 * Recall@K = |relevant docs in top K| / |total relevant docs|
 */
export function calculateRecallAtK(
  results: SearchResult[],
  relevance: RelevanceJudgment[],
  k: number = 10
): number {
  const topK = results.slice(0, k);
  const relevantSet = new Set(relevance.filter(r => r.relevance > 0).map(r => normalizePath(r.file)));

  const foundRelevant = topK.filter(r => relevantSet.has(normalizePath(r.filePath))).length;
  const totalRelevant = relevantSet.size;

  return totalRelevant === 0 ? 0 : foundRelevant / totalRelevant;
}

/**
 * Calculate Mean Reciprocal Rank (MRR)
 * MRR = 1 / (rank of first relevant doc)
 * Returns 0 if no relevant docs found
 */
export function calculateMRR(
  results: SearchResult[],
  relevance: RelevanceJudgment[]
): number {
  const relevantSet = new Set(relevance.filter(r => r.relevance > 0).map(r => normalizePath(r.file)));

  for (let i = 0; i < results.length; i++) {
    if (relevantSet.has(normalizePath(results[i].filePath))) {
      return 1 / (i + 1);  // rank is 1-indexed
    }
  }

  return 0;  // No relevant docs found
}

/**
 * Calculate Discounted Cumulative Gain (DCG)
 * DCG@K = Σ (rel_i / log₂(i + 1)) for i=1 to K
 */
function calculateDCG(results: SearchResult[], relevance: RelevanceJudgment[], k: number): number {
  const relevanceMap = new Map(relevance.map(r => [normalizePath(r.file), r.relevance]));
  const topK = results.slice(0, k);

  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const rel = relevanceMap.get(normalizePath(topK[i].filePath)) || 0;
    const discount = Math.log2(i + 2);  // i+2 because i is 0-indexed but formula uses 1-indexed
    dcg += rel / discount;
  }

  return dcg;
}

/**
 * Calculate Normalized Discounted Cumulative Gain (nDCG@K)
 * nDCG@K = DCG@K / IDCG@K
 * IDCG = DCG of ideal ranking (sorted by relevance)
 */
export function calculateNDCGAtK(
  results: SearchResult[],
  relevance: RelevanceJudgment[],
  k: number = 10
): number {
  const dcg = calculateDCG(results, relevance, k);

  // Calculate ideal DCG (IDCG) - sort by relevance descending
  const idealRanking: SearchResult[] = relevance
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, k)
    .map((r, i) => ({ filePath: r.file, score: r.relevance, rank: i + 1 }));

  const idcg = calculateDCG(idealRanking, relevance, k);

  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Calculate Precision@K
 * Precision@K = |relevant docs in top K| / K
 */
export function calculatePrecisionAtK(
  results: SearchResult[],
  relevance: RelevanceJudgment[],
  k: number = 10
): number {
  const topK = results.slice(0, k);
  const relevantSet = new Set(relevance.filter(r => r.relevance > 0).map(r => normalizePath(r.file)));

  const foundRelevant = topK.filter(r => relevantSet.has(normalizePath(r.filePath))).length;

  return topK.length === 0 ? 0 : foundRelevant / topK.length;
}

/**
 * Calculate all metrics for a single query
 */
export function calculateAllMetrics(
  results: SearchResult[],
  relevance: RelevanceJudgment[],
  latency_ms?: number
): MetricResult {
  return {
    recall_at_10: calculateRecallAtK(results, relevance, 10),
    mrr: calculateMRR(results, relevance),
    ndcg_at_10: calculateNDCGAtK(results, relevance, 10),
    precision_at_10: calculatePrecisionAtK(results, relevance, 10),
    latency_ms
  };
}

/**
 * Normalize file path for comparison
 * Handles different path formats (absolute vs relative, with/without extension)
 */
function normalizePath(path: string): string {
  // Remove leading slashes and normalize separators
  const normalized = path.replace(/^\/+/, '').replace(/\\/g, '/');

  // Extract just the file name with extension for more flexible matching
  const parts = normalized.split('/');
  const filename = parts[parts.length - 1];

  return filename.toLowerCase();
}

/**
 * Aggregate metrics across multiple queries
 */
export function aggregateMetrics(metricsList: MetricResult[]): MetricResult {
  if (metricsList.length === 0) {
    return {
      recall_at_10: 0,
      mrr: 0,
      ndcg_at_10: 0,
      precision_at_10: 0,
      latency_ms: 0
    };
  }

  const sum = metricsList.reduce((acc, m) => ({
    recall_at_10: acc.recall_at_10 + m.recall_at_10,
    mrr: acc.mrr + m.mrr,
    ndcg_at_10: acc.ndcg_at_10 + m.ndcg_at_10,
    precision_at_10: acc.precision_at_10 + m.precision_at_10,
    latency_ms: acc.latency_ms! + (m.latency_ms || 0)
  }), {
    recall_at_10: 0,
    mrr: 0,
    ndcg_at_10: 0,
    precision_at_10: 0,
    latency_ms: 0
  });

  const count = metricsList.length;

  return {
    recall_at_10: sum.recall_at_10 / count,
    mrr: sum.mrr / count,
    ndcg_at_10: sum.ndcg_at_10 / count,
    precision_at_10: sum.precision_at_10 / count,
    latency_ms: sum.latency_ms / count
  };
}
