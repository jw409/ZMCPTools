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

import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import { existsSync } from 'fs';
import {
  calculateAllMetrics,
  aggregateMetrics,
  formatMetrics,
  type RelevantDoc,
  type SearchResult,
  type MetricsResult
} from './benchmark-metrics.js';
import { IndexedKnowledgeSearch } from '../src/services/IndexedKnowledgeSearch.js';
import { VectorSearchService } from '../src/services/VectorSearchService.js';
import { DatabaseConnectionManager } from '../src/database/index.js';
import { SimpleASTTool } from '../src/tools/SimpleASTTool.js';

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
  method: 'bm25' | 'symbol_bm25' | 'fts5' | 'semantic' | 'hybrid' | 'reranked';
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

// File corpus cache
let fileCorpus: Array<{ path: string; content: string }> | null = null;

// Symbol index cache for symbol-aware BM25
interface FileSymbolIndex {
  path: string;
  symbols: string[];        // All symbols defined in file
  exports: string[];        // Exported symbols
  imports: string[];        // Imported symbols
  classes: string[];        // Class names
  functions: string[];      // Function names
}
let symbolIndex: Map<string, FileSymbolIndex> | null = null;

// Services
let vectorService: VectorSearchService | null = null;
const BENCHMARK_COLLECTION = 'zmcptools_benchmark';
let isIndexed = false;

/**
 * Build symbol index for all TypeScript files
 */
async function buildSymbolIndex(): Promise<Map<string, FileSymbolIndex>> {
  if (symbolIndex) return symbolIndex;

  const repositoryPath = join(__dirname, '..');
  const cacheFile = join(repositoryPath, 'var/cache/symbol-index.json');

  // Try loading from cache
  if (existsSync(cacheFile)) {
    try {
      console.log(`  📦 Loading symbol index from cache...`);
      const cached = JSON.parse(await readFile(cacheFile, 'utf-8'));
      symbolIndex = new Map(Object.entries(cached));
      console.log(`  ✅ Loaded ${symbolIndex.size} files from cache`);
      return symbolIndex;
    } catch (error) {
      console.log(`  ⚠️  Cache load failed, rebuilding...`);
    }
  }

  const corpus = await loadFileCorpus();
  const astTool = new SimpleASTTool();
  symbolIndex = new Map();

  console.log(`  🔍 Building symbol index for ${corpus.length} files...`);

  let indexed = 0;
  let processed = 0;

  for (const file of corpus) {
    processed++;
    if (processed % 50 === 0) {
      console.log(`     Progress: ${processed}/${corpus.length} files...`);
    }
    // Only index TypeScript files
    if (!file.path.match(/\.(ts|tsx|js|jsx)$/)) {
      continue;
    }

    try {
      const fullPath = join(repositoryPath, file.path);
      const parseResult = await astTool.parse(fullPath);

      if (!parseResult.success || !parseResult.tree) {
        continue;
      }

      const symbols = await astTool.extractSymbols(parseResult.tree);
      const exports = await astTool.extractExports(parseResult.tree);
      const imports = await astTool.extractImports(parseResult.tree);

      const classes = symbols.filter(s => s.type === 'class').map(s => s.name);
      const functions = symbols.filter(s => s.type === 'function').map(s => s.name);
      const allSymbolNames = symbols.map(s => s.name);

      symbolIndex.set(file.path, {
        path: file.path,
        symbols: allSymbolNames,
        exports,
        imports,
        classes,
        functions
      });

      indexed++;
    } catch (error) {
      // Skip files that can't be parsed
    }
  }

  console.log(`  ✅ Indexed ${indexed} TypeScript files with symbols`);

  // Save to cache
  try {
    const cacheData = Object.fromEntries(symbolIndex.entries());
    await writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
    console.log(`  💾 Saved index to cache`);
  } catch (error) {
    console.log(`  ⚠️  Failed to save cache: ${error}`);
  }

  return symbolIndex;
}

/**
 * Load file corpus (all .ts and .md files in ZMCPTools)
 */
async function loadFileCorpus(): Promise<Array<{ path: string; content: string }>> {
  if (fileCorpus) return fileCorpus;

  const repositoryPath = join(__dirname, '..');
  const files = await glob('**/*.{ts,md}', {
    cwd: repositoryPath,
    ignore: ['node_modules/**', 'dist/**', '.git/**', 'test-*/**']
  });

  fileCorpus = [];
  for (const file of files) {
    try {
      const content = await readFile(join(repositoryPath, file), 'utf-8');
      fileCorpus.push({ path: file, content });
    } catch (error) {
      // Skip files that can't be read
    }
  }

  return fileCorpus;
}

/**
 * Initialize and index corpus into LanceDB for semantic search
 */
async function ensureVectorIndex(): Promise<void> {
  if (isIndexed && vectorService) return;

  const corpus = await loadFileCorpus();

  // Initialize vector service
  const dbManager = await DatabaseConnectionManager.getInstance();
  vectorService = new VectorSearchService(dbManager, {
    embeddingModel: 'gemma_embed'
  });

  await vectorService.initialize();

  // Create collection
  await vectorService.getOrCreateCollection(BENCHMARK_COLLECTION, {
    description: 'ZMCPTools file corpus for benchmarking',
    created_at: new Date().toISOString()
  });

  // Index documents
  const documents = corpus.map(file => ({
    id: file.path,
    content: file.content,
    metadata: { path: file.path }
  }));

  console.log(`  📦 Indexing ${documents.length} files into LanceDB...`);
  const result = await vectorService.addDocuments(BENCHMARK_COLLECTION, documents);

  if (result.success) {
    console.log(`  ✅ Indexed ${result.addedCount} files`);
    isIndexed = true;
  } else {
    console.error(`  ❌ Indexing failed: ${result.error}`);
  }
}

/**
 * Simple BM25 scoring
 */
function bm25Score(query: string, document: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/);
  const docText = document.toLowerCase();

  let score = 0;
  for (const term of queryTerms) {
    if (docText.includes(term)) {
      const termCount = (docText.match(new RegExp(term, 'g')) || []).length;
      score += termCount / (termCount + 1); // Diminishing returns
    }
  }

  return score / queryTerms.length;
}

/**
 * Symbol-aware BM25 scoring
 * Boosts files that DEFINE symbols matching query vs files that only IMPORT them
 */
function symbolAwareBM25Score(
  query: string,
  filePath: string,
  content: string,
  symbolInfo?: FileSymbolIndex
): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  // Base score from naive BM25
  let score = bm25Score(query, content) * 0.3; // Reduce weight of content matching

  if (!symbolInfo) {
    // Fallback to naive BM25 for non-TypeScript files
    return score;
  }

  // File path matching boost (e.g., "ResourceManager" query → "ResourceManager.ts")
  const fileName = filePath.split('/').pop()?.toLowerCase() || '';
  for (const term of queryTerms) {
    if (fileName.includes(term)) {
      score += 2.0; // Strong signal
    }
  }

  // Extract symbol names from exports (format: "export class Foo" → "Foo")
  const exportedSymbols = symbolInfo.exports
    .map(exp => {
      const match = exp.match(/export\s+(?:class|function|interface|const|let|var)\s+(\w+)/);
      return match ? match[1].toLowerCase() : '';
    })
    .filter(s => s.length > 0);

  // Exported symbol matching (strongest signal - this file DEFINES the symbol)
  for (const term of queryTerms) {
    if (exportedSymbols.some(exp => exp.includes(term) || term.includes(exp))) {
      score += 3.0; // Very strong signal
    }
  }

  // Class/function definition matching (strong signal)
  const definedSymbols = [
    ...symbolInfo.classes.map(c => c.toLowerCase()),
    ...symbolInfo.functions.map(f => f.toLowerCase())
  ];

  for (const term of queryTerms) {
    if (definedSymbols.some(sym => sym.includes(term) || term.includes(sym))) {
      score += 1.5; // Strong signal
    }
  }

  // All symbols matching (medium signal)
  const allSymbols = symbolInfo.symbols.map(s => s.toLowerCase());
  for (const term of queryTerms) {
    if (allSymbols.some(sym => sym.includes(term) || term.includes(sym))) {
      score += 0.5; // Medium signal
    }
  }

  // Import penalty (file only imports the symbol, doesn't define it)
  const importedSymbols = symbolInfo.imports.map(i => i.toLowerCase());
  let hasDefinition = false;
  let hasImport = false;

  for (const term of queryTerms) {
    if (exportedSymbols.some(exp => exp.includes(term)) ||
        definedSymbols.some(sym => sym.includes(term))) {
      hasDefinition = true;
    }
    if (importedSymbols.some(imp => imp.includes(term))) {
      hasImport = true;
    }
  }

  // If file only imports but doesn't define, apply penalty
  if (hasImport && !hasDefinition && exportedSymbols.length === 0) {
    score *= 0.3; // Heavy penalty for import-only files
  }

  return score;
}

/**
 * Search using different retrieval methods
 */
async function searchWithMethod(
  method: string,
  query: string,
  k: number = 20
): Promise<{ results: SearchResult[]; latency_ms: number }> {
  const startTime = performance.now();

  const corpus = await loadFileCorpus();
  const results: SearchResult[] = [];

  if (method === 'symbol_bm25') {
    // Symbol-aware BM25 search
    const index = await buildSymbolIndex();

    const scored = corpus.map(file => {
      const symbolInfo = index.get(file.path);
      return {
        file: file.path,
        score: symbolAwareBM25Score(query, file.path, file.content, symbolInfo),
        rank: 0
      };
    }).filter(r => r.score > 0);

    scored.sort((a, b) => b.score - a.score);
    scored.forEach((r, i) => r.rank = i + 1);
    results.push(...scored.slice(0, k));

  } else if (method === 'bm25') {
    // BM25 text search
    const scored = corpus.map(file => ({
      file: file.path,
      score: bm25Score(query, file.content),
      rank: 0
    })).filter(r => r.score > 0);

    scored.sort((a, b) => b.score - a.score);

    // Assign ranks
    scored.forEach((r, i) => r.rank = i + 1);

    results.push(...scored.slice(0, k));

  } else if (method === 'semantic') {
    // Semantic search using VectorSearchService
    await ensureVectorIndex();

    if (!vectorService) {
      console.error('  ❌ Vector service not available');
      return { results: [], latency_ms: 0 };
    }

    try {
      const searchResults = await vectorService.searchSimilar(
        BENCHMARK_COLLECTION,
        query,
        k,
        0.0 // No threshold - we want all results for benchmarking
      );

      // Map to SearchResult format
      searchResults.forEach((r, i) => {
        results.push({
          file: r.metadata?.path || r.id,
          score: r.similarity,
          rank: i + 1
        });
      });
    } catch (error) {
      console.error(`  ❌ Semantic search error:`, error);
    }

  } else if (method === 'fts5' || method === 'hybrid' || method === 'reranked') {
    // TODO: Implement other search methods
    // For now, return empty results
  }

  const latency_ms = performance.now() - startTime;

  return { results, latency_ms };
}

/**
 * Run benchmark for a single method across all queries
 */
async function benchmarkMethod(
  method: 'bm25' | 'symbol_bm25' | 'fts5' | 'semantic' | 'hybrid' | 'reranked',
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
  const methods: Array<'bm25' | 'symbol_bm25' | 'fts5' | 'semantic' | 'hybrid' | 'reranked'> = [
    'bm25',
    'symbol_bm25',
    // Skip slow methods for now
    // 'fts5',
    // 'semantic',
    // 'hybrid',
    // 'reranked'
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
