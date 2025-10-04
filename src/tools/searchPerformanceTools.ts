/**
 * Search Performance Testing Tools
 * Provides built-in performance benchmarking for knowledge graph search
 * Tests semantic vs BM25 search effectiveness with detailed metrics
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DatabaseManager } from '../database/index.js';
import { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { VectorSearchService } from '../services/VectorSearchService.js';
import { BM25Service } from '../services/BM25Service.js';
import { HybridSearchService } from '../services/HybridSearchService.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('search-performance');

// Test query categories for different content types
const TEST_QUERIES = {
  code: [
    { query: 'bootstrap_layer1.py', expected_type: 'file', description: 'Python file - exact match' },
    { query: 'start_embedding_service', expected_type: 'function', description: 'Function/service name' },
    { query: 'knowledge_entities', expected_type: 'table', description: 'Database table' },
    { query: 'StateManager', expected_type: 'class', description: 'Class name' },
    { query: 'getDashboard', expected_type: 'method', description: 'Method name' }
  ],
  documentation: [
    { query: 'embedding strategy documentation', expected_type: 'documentation', description: 'Conceptual topic' },
    { query: 'monitoring guide setup', expected_type: 'documentation', description: 'Process description' },
    { query: 'security best practices', expected_type: 'documentation', description: 'Guidelines' },
    { query: 'how to contribute', expected_type: 'documentation', description: 'Instructions' },
    { query: 'installation instructions', expected_type: 'documentation', description: 'Setup guide' }
  ],
  mixed: [
    { query: 'get_memory_status', expected_type: 'mixed', description: 'Function or concept' },
    { query: 'authentication flow', expected_type: 'mixed', description: 'Process or code' },
    { query: 'error handling', expected_type: 'mixed', description: 'Pattern or implementation' },
    { query: 'database connection', expected_type: 'mixed', description: 'Config or code' }
  ]
};

interface SearchPerformanceResult {
  query: string;
  category: string;
  description: string;
  semantic_search: {
    results_count: number;
    time_ms: number;
    top_results: Array<{ name: string; type: string; score: number }>;
    relevance_score: number;
  };
  text_search: {
    results_count: number;
    time_ms: number;
    top_results: Array<{ name: string; type: string; score: number }>;
    relevance_score: number;
  };
  winner: 'semantic' | 'text' | 'tie';
  speed_ratio: number; // semantic_time / text_time
  accuracy_ratio: number; // semantic_relevance / text_relevance
}

interface PerformanceReport {
  test_timestamp: string;
  total_queries: number;
  categories: {
    code: { semantic_wins: number; text_wins: number; avg_speed_ratio: number };
    documentation: { semantic_wins: number; text_wins: number; avg_speed_ratio: number };
    mixed: { semantic_wins: number; text_wins: number; avg_speed_ratio: number };
  };
  overall_metrics: {
    semantic_faster_count: number;
    text_faster_count: number;
    avg_semantic_time_ms: number;
    avg_text_time_ms: number;
    semantic_accuracy: number;
    text_accuracy: number;
  };
  recommendations: string[];
  detailed_results: SearchPerformanceResult[];
}

const BenchmarkSearchSchema = z.object({
  repository_path: z.string().describe("Repository path to test"),
  categories: z.array(z.enum(['code', 'documentation', 'mixed', 'all'])).default(['all']).describe("Query categories to test"),
  iterations: z.number().min(1).max(10).default(1).describe("Number of test iterations"),
  store_results: z.boolean().default(true).describe("Store results in knowledge graph")
});

const CompareSearchModesSchema = z.object({
  repository_path: z.string().describe("Repository path to test"),
  query: z.string().describe("Specific query to test"),
  detailed: z.boolean().default(true).describe("Include detailed result analysis")
});

/**
 * Benchmark search performance across categories
 */
export const benchmarkSearchPerformance: Tool = {
  name: 'benchmark_search_performance',
  description: `Comprehensive benchmark of semantic vs text search performance.

Tests both speed and accuracy across different content types:
- Code queries (files, functions, classes) - should favor exact matching
- Documentation queries (concepts, guides) - should favor semantic search
- Mixed queries - context-dependent

Returns detailed performance metrics and recommendations for hybrid search weighting.`,

  inputSchema: {
    type: 'object',
    properties: {
      repository_path: { type: 'string', description: 'Repository path to test' },
      categories: {
        type: 'array',
        items: { type: 'string', enum: ['code', 'documentation', 'mixed', 'all'] },
        default: ['all'],
        description: 'Query categories to test'
      },
      iterations: { type: 'number', minimum: 1, maximum: 10, default: 1, description: 'Number of test iterations' },
      store_results: { type: 'boolean', default: true, description: 'Store results in knowledge graph' }
    },
    required: ['repository_path']
  },

  async handler({ repository_path, categories = ['all'], iterations = 1, store_results = true }) {
    try {
      logger.info('Starting search performance benchmark', { repository_path, categories, iterations });

      // Initialize services
      const db = new DatabaseManager();
      await db.initialize();

      const vectorService = new VectorSearchService(db);
      await vectorService.initialize();

      const knowledgeGraph = new KnowledgeGraphService(db, vectorService);
      await knowledgeGraph.initialize();

      const report: PerformanceReport = {
        test_timestamp: new Date().toISOString(),
        total_queries: 0,
        categories: {
          code: { semantic_wins: 0, text_wins: 0, avg_speed_ratio: 0 },
          documentation: { semantic_wins: 0, text_wins: 0, avg_speed_ratio: 0 },
          mixed: { semantic_wins: 0, text_wins: 0, avg_speed_ratio: 0 }
        },
        overall_metrics: {
          semantic_faster_count: 0,
          text_faster_count: 0,
          avg_semantic_time_ms: 0,
          avg_text_time_ms: 0,
          semantic_accuracy: 0,
          text_accuracy: 0
        },
        recommendations: [],
        detailed_results: []
      };

      // Determine which categories to test
      const categoriesToTest = categories.includes('all')
        ? ['code', 'documentation', 'mixed']
        : categories;

      // Run tests for each category
      for (const category of categoriesToTest) {
        const queries = TEST_QUERIES[category as keyof typeof TEST_QUERIES];

        for (const testCase of queries) {
          for (let iter = 0; iter < iterations; iter++) {
            const result = await runSearchComparison(
              knowledgeGraph,
              repository_path,
              testCase,
              category
            );

            report.detailed_results.push(result);
            report.total_queries++;

            // Update category stats
            if (result.winner === 'semantic') {
              report.categories[category as keyof typeof report.categories].semantic_wins++;
            } else if (result.winner === 'text') {
              report.categories[category as keyof typeof report.categories].text_wins++;
            }

            // Update speed stats
            if (result.speed_ratio < 1) {
              report.overall_metrics.semantic_faster_count++;
            } else {
              report.overall_metrics.text_faster_count++;
            }
          }
        }
      }

      // Calculate aggregated metrics
      calculateAggregatedMetrics(report);
      generateRecommendations(report);

      // Store results if requested
      if (store_results) {
        await storePerformanceResults(knowledgeGraph, repository_path, report);
      }

      return {
        success: true,
        report,
        summary: {
          total_tests: report.total_queries,
          semantic_wins: Object.values(report.categories).reduce((sum, cat) => sum + cat.semantic_wins, 0),
          text_wins: Object.values(report.categories).reduce((sum, cat) => sum + cat.text_wins, 0),
          avg_semantic_time: report.overall_metrics.avg_semantic_time_ms,
          avg_text_time: report.overall_metrics.avg_text_time_ms,
          key_finding: report.recommendations[0] || 'Test completed'
        }
      };

    } catch (error) {
      logger.error('Benchmark failed', { error: error.message });
      return {
        success: false,
        error: `Benchmark failed: ${error.message}`
      };
    }
  }
};

/**
 * Compare specific query across search modes
 */
export const compareSearchModes: Tool = {
  name: 'compare_search_modes',
  description: `Compare semantic vs text search for a specific query with detailed analysis.

Shows side-by-side results, timing, and relevance scoring to understand
which search mode performs better for different query types.`,

  inputSchema: {
    type: 'object',
    properties: {
      repository_path: { type: 'string', description: 'Repository path to test' },
      query: { type: 'string', description: 'Specific query to test' },
      detailed: { type: 'boolean', default: true, description: 'Include detailed result analysis' }
    },
    required: ['repository_path', 'query']
  },

  async handler({ repository_path, query, detailed = true }) {
    try {
      const db = new DatabaseManager();
      await db.initialize();

      const vectorService = new VectorSearchService(db);
      await vectorService.initialize();

      const knowledgeGraph = new KnowledgeGraphService(db, vectorService);
      await knowledgeGraph.initialize();

      const testCase = {
        query,
        expected_type: 'unknown',
        description: 'User-provided query'
      };

      const result = await runSearchComparison(
        knowledgeGraph,
        repository_path,
        testCase,
        'user'
      );

      return {
        success: true,
        query,
        results: {
          semantic: {
            time_ms: result.semantic_search.time_ms,
            results_count: result.semantic_search.results_count,
            relevance_score: result.semantic_search.relevance_score,
            top_results: result.semantic_search.top_results
          },
          text: {
            time_ms: result.text_search.time_ms,
            results_count: result.text_search.results_count,
            relevance_score: result.text_search.relevance_score,
            top_results: result.text_search.top_results
          }
        },
        analysis: {
          winner: result.winner,
          speed_advantage: result.speed_ratio < 1 ? 'semantic' : 'text',
          speed_ratio: result.speed_ratio,
          accuracy_advantage: result.accuracy_ratio > 1 ? 'semantic' : 'text',
          accuracy_ratio: result.accuracy_ratio,
          recommendation: getQueryRecommendation(result)
        }
      };

    } catch (error) {
      logger.error('Search comparison failed', { error: error.message, query });
      return {
        success: false,
        error: `Search comparison failed: ${error.message}`
      };
    }
  }
};

/**
 * Run search comparison for a single test case
 */
async function runSearchComparison(
  knowledgeGraph: KnowledgeGraphService,
  repositoryPath: string,
  testCase: { query: string; expected_type: string; description: string },
  category: string
): Promise<SearchPerformanceResult> {

  // Test semantic search
  const semanticStart = Date.now();
  const semanticResults = await knowledgeGraph.findEntitiesBySemanticSearch(
    repositoryPath,
    testCase.query,
    undefined,
    10,
    0.3
  );
  const semanticTime = Date.now() - semanticStart;

  // Test text search
  const textStart = Date.now();
  const textResults = await knowledgeGraph.findEntitiesByTextSearch(
    repositoryPath,
    testCase.query,
    undefined,
    10
  );
  const textTime = Date.now() - textStart;

  // Calculate relevance scores
  const semanticRelevance = calculateRelevanceScore(semanticResults, testCase);
  const textRelevance = calculateRelevanceScore(textResults, testCase);

  // Determine winner
  let winner: 'semantic' | 'text' | 'tie' = 'tie';
  if (semanticRelevance > textRelevance) {
    winner = 'semantic';
  } else if (textRelevance > semanticRelevance) {
    winner = 'text';
  }

  return {
    query: testCase.query,
    category,
    description: testCase.description,
    semantic_search: {
      results_count: semanticResults.length,
      time_ms: semanticTime,
      top_results: semanticResults.slice(0, 3).map(r => ({
        name: r.name,
        type: r.entityType,
        score: r.importanceScore
      })),
      relevance_score: semanticRelevance
    },
    text_search: {
      results_count: textResults.length,
      time_ms: textTime,
      top_results: textResults.slice(0, 3).map(r => ({
        name: r.name,
        type: r.entityType,
        score: r.importanceScore
      })),
      relevance_score: textRelevance
    },
    winner,
    speed_ratio: semanticTime / textTime,
    accuracy_ratio: semanticRelevance / (textRelevance || 0.1)
  };
}

/**
 * Calculate relevance score based on result quality
 */
function calculateRelevanceScore(results: any[], testCase: any): number {
  if (results.length === 0) return 0;

  let score = 0;
  const query = testCase.query.toLowerCase();

  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const result = results[i];
    const name = result.name.toLowerCase();
    const description = (result.description || '').toLowerCase();

    // Exact name match bonus
    if (name === query) score += 10;
    else if (name.includes(query)) score += 5;

    // Description relevance
    if (description.includes(query)) score += 3;

    // Position penalty (earlier results worth more)
    score *= (1 - i * 0.1);

    // Type matching bonus
    if (testCase.expected_type !== 'unknown' &&
        testCase.expected_type !== 'mixed' &&
        result.entityType === testCase.expected_type) {
      score += 2;
    }
  }

  return Math.round(score * 100) / 100;
}

/**
 * Calculate aggregated metrics for the report
 */
function calculateAggregatedMetrics(report: PerformanceReport): void {
  const results = report.detailed_results;

  if (results.length === 0) return;

  // Calculate averages
  report.overall_metrics.avg_semantic_time_ms =
    results.reduce((sum, r) => sum + r.semantic_search.time_ms, 0) / results.length;

  report.overall_metrics.avg_text_time_ms =
    results.reduce((sum, r) => sum + r.text_search.time_ms, 0) / results.length;

  report.overall_metrics.semantic_accuracy =
    results.reduce((sum, r) => sum + r.semantic_search.relevance_score, 0) / results.length;

  report.overall_metrics.text_accuracy =
    results.reduce((sum, r) => sum + r.text_search.relevance_score, 0) / results.length;

  // Calculate category speed ratios
  for (const category of ['code', 'documentation', 'mixed'] as const) {
    const categoryResults = results.filter(r => r.category === category);
    if (categoryResults.length > 0) {
      report.categories[category].avg_speed_ratio =
        categoryResults.reduce((sum, r) => sum + r.speed_ratio, 0) / categoryResults.length;
    }
  }
}

/**
 * Generate recommendations based on test results
 */
function generateRecommendations(report: PerformanceReport): void {
  const recommendations: string[] = [];
  const { categories, overall_metrics } = report;

  // Speed recommendations
  if (overall_metrics.text_faster_count > overall_metrics.semantic_faster_count) {
    recommendations.push('Text search is generally faster - consider increasing BM25 weight in hybrid search');
  } else {
    recommendations.push('Semantic search performance is acceptable - current weighting may be appropriate');
  }

  // Accuracy recommendations by category
  if (categories.code.text_wins > categories.code.semantic_wins) {
    recommendations.push('Code queries benefit from text/exact matching - use 70% BM25 weight for code content');
  }

  if (categories.documentation.semantic_wins > categories.documentation.text_wins) {
    recommendations.push('Documentation queries benefit from semantic search - use 70% semantic weight for docs');
  }

  // Overall system recommendation
  const totalSemanticWins = Object.values(categories).reduce((sum, cat) => sum + cat.semantic_wins, 0);
  const totalTextWins = Object.values(categories).reduce((sum, cat) => sum + cat.text_wins, 0);

  if (totalTextWins > totalSemanticWins) {
    recommendations.push('CRITICAL: Current 70% semantic weighting appears suboptimal - implement content-aware hybrid weighting');
  }

  report.recommendations = recommendations;
}

/**
 * Get recommendation for a specific query result
 */
function getQueryRecommendation(result: SearchPerformanceResult): string {
  if (result.winner === 'semantic') {
    return 'This query benefits from semantic search - use higher semantic weight in hybrid mode';
  } else if (result.winner === 'text') {
    return 'This query benefits from exact matching - use higher BM25 weight in hybrid mode';
  } else {
    return 'Results are similar - either search mode works well for this query';
  }
}

/**
 * Store performance results in knowledge graph
 */
async function storePerformanceResults(
  knowledgeGraph: KnowledgeGraphService,
  repositoryPath: string,
  report: PerformanceReport
): Promise<void> {
  try {
    await knowledgeGraph.createEntity({
      repositoryPath,
      entityType: 'test',
      name: `Search Performance Benchmark ${report.test_timestamp}`,
      description: `Automated search performance test comparing semantic vs text search across ${report.total_queries} queries`,
      properties: {
        test_type: 'search_performance',
        timestamp: report.test_timestamp,
        total_queries: report.total_queries,
        semantic_wins: Object.values(report.categories).reduce((sum, cat) => sum + cat.semantic_wins, 0),
        text_wins: Object.values(report.categories).reduce((sum, cat) => sum + cat.text_wins, 0),
        avg_semantic_time: report.overall_metrics.avg_semantic_time_ms,
        avg_text_time: report.overall_metrics.avg_text_time_ms,
        recommendations: report.recommendations,
        detailed_results: JSON.stringify(report.detailed_results)
      },
      importanceScore: 0.8,
      relevanceScore: 0.9,
      confidenceScore: 0.95,
      discoveredBy: 'search-performance-tool',
      discoveredDuring: 'automated_benchmark'
    });

    logger.info('Performance results stored in knowledge graph');
  } catch (error) {
    logger.error('Failed to store performance results', { error });
  }
}

// Export the tools
export const searchPerformanceTools = [
  benchmarkSearchPerformance,
  compareSearchModes
];