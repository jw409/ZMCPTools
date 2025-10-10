/**
 * MTEB-style benchmark metrics for search effectiveness evaluation
 *
 * Implements standard information retrieval metrics:
 * - Recall@K: Coverage of relevant documents
 * - MRR: Mean Reciprocal Rank
 * - nDCG@K: Normalized Discounted Cumulative Gain
 * - Precision@K: Accuracy of top-K results
 */

export interface RelevantDoc {
  file: string;
  relevance: number; // 1-3 scale: 3=highly relevant, 2=relevant, 1=marginally relevant
  reason?: string;
}

export interface SearchResult {
  file: string;
  score: number;
  rank: number;
}

export interface MetricsResult {
  recall_at_k: number;
  mrr: number;
  ndcg_at_k: number;
  precision_at_k: number;
  average_precision: number;
}

/**
 * Calculate Recall@K: proportion of relevant documents in top K results
 *
 * Recall@K = |relevant docs in top K| / |total relevant docs|
 */
export function calculateRecallAtK(
  results: SearchResult[],
  relevantDocs: RelevantDoc[],
  k: number
): number {
  if (relevantDocs.length === 0) return 0;

  const topK = results.slice(0, k);
  const relevantFiles = new Set(relevantDocs.map(d => d.file));
  const foundRelevant = topK.filter(r => relevantFiles.has(r.file));

  return foundRelevant.length / relevantDocs.length;
}

/**
 * Calculate Mean Reciprocal Rank: 1 / (rank of first relevant document)
 *
 * MRR = 1 / (rank of first relevant doc), or 0 if no relevant docs found
 */
export function calculateMRR(
  results: SearchResult[],
  relevantDocs: RelevantDoc[]
): number {
  const relevantFiles = new Set(relevantDocs.map(d => d.file));

  for (let i = 0; i < results.length; i++) {
    if (relevantFiles.has(results[i].file)) {
      return 1.0 / (i + 1); // rank is 1-indexed
    }
  }

  return 0; // No relevant documents found
}

/**
 * Calculate Discounted Cumulative Gain at position K
 *
 * DCG@K = sum(relevance[i] / log2(i + 1)) for i in [0, K)
 */
function calculateDCG(results: SearchResult[], relevantDocs: RelevantDoc[], k: number): number {
  const relevanceMap = new Map(relevantDocs.map(d => [d.file, d.relevance]));
  let dcg = 0;

  for (let i = 0; i < Math.min(k, results.length); i++) {
    const relevance = relevanceMap.get(results[i].file) || 0;
    dcg += relevance / Math.log2(i + 2); // log2(i + 2) because rank is 1-indexed
  }

  return dcg;
}

/**
 * Calculate Normalized Discounted Cumulative Gain at K
 *
 * nDCG@K = DCG@K / IDCG@K
 * where IDCG@K is the ideal DCG (perfect ranking)
 */
export function calculateNDCGAtK(
  results: SearchResult[],
  relevantDocs: RelevantDoc[],
  k: number
): number {
  if (relevantDocs.length === 0) return 0;

  const dcg = calculateDCG(results, relevantDocs, k);

  // Calculate Ideal DCG (perfect ranking by relevance)
  const idealRanking = relevantDocs
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, k)
    .map((doc, i) => ({ file: doc.file, score: 0, rank: i + 1 }));

  const idcg = calculateDCG(idealRanking, relevantDocs, k);

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Calculate Precision@K: proportion of relevant documents in top K
 *
 * Precision@K = |relevant docs in top K| / K
 */
export function calculatePrecisionAtK(
  results: SearchResult[],
  relevantDocs: RelevantDoc[],
  k: number
): number {
  if (k === 0) return 0;

  const topK = results.slice(0, k);
  const relevantFiles = new Set(relevantDocs.map(d => d.file));
  const foundRelevant = topK.filter(r => relevantFiles.has(r.file));

  return foundRelevant.length / k;
}

/**
 * Calculate Average Precision: mean precision at each relevant document position
 *
 * AP = (sum of P@k for each relevant doc at position k) / |relevant docs|
 */
export function calculateAveragePrecision(
  results: SearchResult[],
  relevantDocs: RelevantDoc[]
): number {
  if (relevantDocs.length === 0) return 0;

  const relevantFiles = new Set(relevantDocs.map(d => d.file));
  let sumPrecision = 0;
  let relevantFound = 0;

  for (let i = 0; i < results.length; i++) {
    if (relevantFiles.has(results[i].file)) {
      relevantFound++;
      sumPrecision += relevantFound / (i + 1);
    }
  }

  return sumPrecision / relevantDocs.length;
}

/**
 * Calculate all metrics for a single query
 */
export function calculateAllMetrics(
  results: SearchResult[],
  relevantDocs: RelevantDoc[],
  k: number = 10
): MetricsResult {
  return {
    recall_at_k: calculateRecallAtK(results, relevantDocs, k),
    mrr: calculateMRR(results, relevantDocs),
    ndcg_at_k: calculateNDCGAtK(results, relevantDocs, k),
    precision_at_k: calculatePrecisionAtK(results, relevantDocs, k),
    average_precision: calculateAveragePrecision(results, relevantDocs)
  };
}

/**
 * Aggregate metrics across multiple queries
 */
export function aggregateMetrics(queryMetrics: MetricsResult[]): MetricsResult {
  if (queryMetrics.length === 0) {
    return {
      recall_at_k: 0,
      mrr: 0,
      ndcg_at_k: 0,
      precision_at_k: 0,
      average_precision: 0
    };
  }

  const sum = queryMetrics.reduce(
    (acc, m) => ({
      recall_at_k: acc.recall_at_k + m.recall_at_k,
      mrr: acc.mrr + m.mrr,
      ndcg_at_k: acc.ndcg_at_k + m.ndcg_at_k,
      precision_at_k: acc.precision_at_k + m.precision_at_k,
      average_precision: acc.average_precision + m.average_precision
    }),
    { recall_at_k: 0, mrr: 0, ndcg_at_k: 0, precision_at_k: 0, average_precision: 0 }
  );

  const count = queryMetrics.length;
  return {
    recall_at_k: sum.recall_at_k / count,
    mrr: sum.mrr / count,
    ndcg_at_k: sum.ndcg_at_k / count,
    precision_at_k: sum.precision_at_k / count,
    average_precision: sum.average_precision / count
  };
}

/**
 * Format metrics as a readable string
 */
export function formatMetrics(metrics: MetricsResult, k: number = 10): string {
  return [
    `Recall@${k}:  ${(metrics.recall_at_k * 100).toFixed(1)}%`,
    `MRR:         ${metrics.mrr.toFixed(3)}`,
    `nDCG@${k}:   ${metrics.ndcg_at_k.toFixed(3)}`,
    `Precision@${k}: ${(metrics.precision_at_k * 100).toFixed(1)}%`,
    `MAP:         ${metrics.average_precision.toFixed(3)}`
  ].join('\n');
}
