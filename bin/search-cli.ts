#!/usr/bin/env tsx
/**
 * CLI wrapper for search functionality
 * Used by TalentOS search benchmark plugin (port 8888)
 *
 * Usage:
 *   search-cli.ts <corpus_path> <query> <method> [limit]
 *
 * Methods: bm25, semantic, hybrid
 * Output: JSON array of file paths with scores
 */

import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';
import { HybridSearchService } from '../src/services/HybridSearchService.js';
import { EmbeddingClient } from '../src/services/EmbeddingClient.js';
import { BM25Service } from '../src/services/BM25Service.js';

interface SearchResult {
  file: string;
  score: number;
  snippet: string;
  method: string;
}

async function searchBM25(indexer: SymbolGraphIndexer, query: string, limit: number): Promise<SearchResult[]> {
  const results = await indexer.searchKeyword(query, limit);
  return results.map(r => ({
    file: r.filePath,
    score: r.score,
    snippet: r.snippet || '',
    method: 'bm25'
  }));
}

async function searchSemantic(indexer: SymbolGraphIndexer, query: string, limit: number): Promise<SearchResult[]> {
  const results = await indexer.searchSemantic(query, limit);
  return results.map(r => ({
    file: r.filePath,
    score: r.score,
    snippet: r.snippet || '',
    method: 'semantic'
  }));
}

async function searchHybrid(corpusPath: string, query: string, limit: number): Promise<SearchResult[]> {
  // Initialize services for hybrid search
  const embeddingClient = new EmbeddingClient();
  const bm25Service = new BM25Service();
  const hybridService = new HybridSearchService(embeddingClient, bm25Service);

  // Index the corpus for hybrid search
  const indexer = new SymbolGraphIndexer();
  await indexer.initialize(corpusPath);

  // Get results from both methods
  const bm25Results = await searchBM25(indexer, query, limit * 2);
  const semanticResults = await searchSemantic(indexer, query, limit * 2);

  // Simple hybrid: combine and deduplicate by file path, using max score
  const fileScores = new Map<string, SearchResult>();

  for (const result of [...bm25Results, ...semanticResults]) {
    const existing = fileScores.get(result.file);
    if (!existing || result.score > existing.score) {
      fileScores.set(result.file, { ...result, method: 'hybrid' });
    }
  }

  // Sort by score and return top results
  return Array.from(fileScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: search-cli.ts <corpus_path> <query> <method> [limit]');
    console.error('Methods: bm25, semantic, hybrid');
    process.exit(1);
  }

  const [corpusPath, query, method, limitStr] = args;
  const limit = limitStr ? parseInt(limitStr, 10) : 10;

  if (!['bm25', 'semantic', 'hybrid'].includes(method)) {
    console.error(`Invalid method: ${method}. Use bm25, semantic, or hybrid`);
    process.exit(1);
  }

  try {
    const indexer = new SymbolGraphIndexer();
    await indexer.initialize(corpusPath);

    let results: SearchResult[];

    switch (method) {
      case 'bm25':
        results = await searchBM25(indexer, query, limit);
        break;
      case 'semantic':
        results = await searchSemantic(indexer, query, limit);
        break;
      case 'hybrid':
        results = await searchHybrid(corpusPath, query, limit);
        await indexer.close();
        process.exit(0);
        return;
    }

    // Output results as JSON
    console.log(JSON.stringify(results, null, 2));

    await indexer.close();
    process.exit(0);

  } catch (error) {
    console.error('Search failed:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
