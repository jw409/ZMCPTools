#!/usr/bin/env tsx
/**
 * MTEB-style Search Effectiveness Benchmark
 *
 * Evaluates search quality across 5 retrieval methods:
 * - BM25 (code symbols)
 * - FTS5 (full-text)
 * - Semantic (gemma3 embeddings)
 * - Hybrid (BM25 + semantic)
 * - Reranked (+ qwen3 reranker)
 *
 * Usage:
 *   tsx bin/benchmark-search.ts [--method METHOD] [--k K] [--output FILE]
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  calculateAllMetrics,
  aggregateMetrics,
  formatMetrics,
  type RelevantDoc,
  type SearchResult,
  type MetricsResult
} from './benchmark-metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test query from dataset
interface TestQuery {
  id: string;
  type: 'code' | 'conceptual' | 'mixed';
  query: string;
  description: string;
  relevant_docs: RelevantDoc[];
}

// Test dataset structure
interface TestDataset {
  description: string;
  version: string;
  corpus: string;
  queries: TestQuery[];
  metadata: {
    total_queries: number;
    by_type: Record<string, number>;
    average_relevant_docs: number;
    created_at: string;
  };
}

// Benchmark result for one method
interface MethodBenchmarkResult {
  method: 'bm25' | 'fts5' | 'semantic' | 'hybrid' | 'reranked';
  overall: MetricsResult;
  by_query_type: {
    code: MetricsResult;
    conceptual: MetricsResult;
    mixed: MetricsResult;
  };
  latency_ms: {
    mean: number;
    p50: number;
    p95: number;
    p99: number;
  };
  per_query: Array<{
    query_id: string;
    metrics: MetricsResult;
    latency_ms: number;
  }>;
}

/**
 * Load test dataset from fixtures
 */
async function loadTestDataset(): Promise<TestDataset> {
  const datasetPath = join(__dirname, 'fixtures', 'search-test-set.json');
  const content = await readFile(datasetPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Mock search function - placeholder for actual retrieval methods
 * TODO: Integrate with actual search services
 */
async function searchWithMethod(
  method: string,
  query: string,
  k: number = 20
): Promise<{ results: SearchResult[]; latency_ms: number }> {
  const startTime = performance.now();

  // Placeholder: Return mock results
  // TODO: Replace with actual search implementation
  const mockResults: SearchResult[] = [];

  const latency_ms = performance.now() - startTime;

  return { results: mockResults, latency_ms };
}

/**
 * Run benchmark for a single method across all queries
 */
async function benchmarkMethod(
  method: 'bm25' | 'fts5' | 'semantic' | 'hybrid' | 'reranked',
  dataset: TestDataset,
  k: number = 10
): Promise<MethodBenchmarkResult> {
  console.log(`\n🔍 Benchmarking ${method.toUpperCase()}...`);

  const perQueryResults: Array<{
    query_id: string;
    metrics: MetricsResult;
    latency_ms: number;
    type: string;
  }> = [];

  for (const testQuery of dataset.queries) {
    const { results, latency_ms } = await searchWithMethod(method, testQuery.query, k);

    const metrics = calculateAllMetrics(results, testQuery.relevant_docs, k);

    perQueryResults.push({
      query_id: testQuery.id,
      metrics,
      latency_ms,
      type: testQuery.type
    });

    console.log(`  ✓ ${testQuery.id}: R@${k}=${(metrics.recall_at_k * 100).toFixed(0)}% (${latency_ms.toFixed(0)}ms)`);
  }

  // Aggregate overall metrics
  const overall = aggregateMetrics(perQueryResults.map(r => r.metrics));

  // Aggregate by query type
  const byType = {
    code: aggregateMetrics(
      perQueryResults.filter(r => r.type === 'code').map(r => r.metrics)
    ),
    conceptual: aggregateMetrics(
      perQueryResults.filter(r => r.type === 'conceptual').map(r => r.metrics)
    ),
    mixed: aggregateMetrics(
      perQueryResults.filter(r => r.type === 'mixed').map(r => r.metrics)
    )
  };

  // Calculate latency percentiles
  const latencies = perQueryResults.map(r => r.latency_ms).sort((a, b) => a - b);
  const latency_ms = {
    mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p50: latencies[Math.floor(latencies.length * 0.5)],
    p95: latencies[Math.floor(latencies.length * 0.95)],
    p99: latencies[Math.floor(latencies.length * 0.99)]
  };

  return {
    method,
    overall,
    by_query_type: byType,
    latency_ms,
    per_query: perQueryResults.map(r => ({
      query_id: r.query_id,
      metrics: r.metrics,
      latency_ms: r.latency_ms
    }))
  };
}

/**
 * Format leaderboard table
 */
function formatLeaderboard(results: MethodBenchmarkResult[], k: number = 10): string {
  const header = [
    '╔═══════════════════════════════════════════════════════════════════╗',
    '║          MTEB-like Search Benchmark - ZMCPTools                  ║',
    '╠═══════════════════════════════════════════════════════════════════╣',
    `║ Method      │ R@${k}  │ MRR   │ nDCG@${k} │ P@${k}  │ Latency    ║`,
    '╠═══════════════════════════════════════════════════════════════════╣'
  ];

  // Sort by overall nDCG (best first)
  const sorted = [...results].sort((a, b) => b.overall.ndcg_at_k - a.overall.ndcg_at_k);

  const rows = sorted.map(r => {
    const m = r.overall;
    const name = r.method.padEnd(11);
    const recall = `${(m.recall_at_k * 100).toFixed(0)}%`.padStart(5);
    const mrr = m.mrr.toFixed(2).padStart(5);
    const ndcg = m.ndcg_at_k.toFixed(2).padStart(7);
    const precision = `${(m.precision_at_k * 100).toFixed(0)}%`.padStart(5);
    const latency = `${r.latency_ms.p50.toFixed(0)}ms`.padStart(10);

    return `║ ${name} │ ${recall} │ ${mrr} │ ${ndcg} │ ${precision} │ ${latency} ║`;
  });

  const footer = [
    '╚═══════════════════════════════════════════════════════════════════╝'
  ];

  return [...header, ...rows, ...footer].join('\n');
}

/**
 * Format by-query-type breakdown
 */
function formatByQueryType(results: MethodBenchmarkResult[], k: number = 10): string {
  const lines = [
    '\nPerformance by Query Type:',
    '─'.repeat(70)
  ];

  for (const queryType of ['code', 'conceptual', 'mixed'] as const) {
    lines.push(`\n${queryType.toUpperCase()} queries:`);

    const methodResults = results.map(r => ({
      method: r.method,
      recall: r.by_query_type[queryType].recall_at_k
    })).sort((a, b) => b.recall - a.recall);

    for (const { method, recall } of methodResults) {
      const bar = '█'.repeat(Math.floor(recall * 50));
      lines.push(`  ${method.padEnd(12)} ${(recall * 100).toFixed(1)}% ${bar}`);
    }
  }

  return lines.join('\n');
}

/**
 * Main benchmark runner
 */
async function main() {
  console.log('🚀 Starting MTEB-style Search Benchmark\n');

  // Load test dataset
  const dataset = await loadTestDataset();
  console.log(`📚 Loaded ${dataset.queries.length} test queries`);
  console.log(`   - ${dataset.metadata.by_type.code} code queries`);
  console.log(`   - ${dataset.metadata.by_type.conceptual} conceptual queries`);
  console.log(`   - ${dataset.metadata.by_type.mixed} mixed queries`);

  const k = 10; // Evaluate at K=10

  // Run benchmarks for each method
  const methods: Array<'bm25' | 'fts5' | 'semantic' | 'hybrid' | 'reranked'> = [
    'bm25',
    'fts5',
    'semantic',
    'hybrid',
    'reranked'
  ];

  const results: MethodBenchmarkResult[] = [];

  for (const method of methods) {
    const result = await benchmarkMethod(method, dataset, k);
    results.push(result);
  }

  // Display leaderboard
  console.log('\n' + formatLeaderboard(results, k));
  console.log(formatByQueryType(results, k));

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('📊 Summary:');
  console.log(`   - Best overall: ${results.sort((a, b) => b.overall.ndcg_at_k - a.overall.ndcg_at_k)[0].method.toUpperCase()}`);
  console.log(`   - Fastest: ${results.sort((a, b) => a.latency_ms.p50 - b.latency_ms.p50)[0].method.toUpperCase()}`);
  console.log('═'.repeat(70));
}

// Run benchmark
main().catch(console.error);
