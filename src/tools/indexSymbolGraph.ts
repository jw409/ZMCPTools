/**
 * index_symbol_graph - Unix-composable code indexing tool
 *
 * Flexible code indexing following Unix philosophy:
 * - Composable and reusable
 * - Does one thing well
 * - Supports corruption recovery
 * - Scoped indexing with patterns
 *
 * Issue #53: Phase 1 of search improvements
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SymbolGraphIndexer } from '../services/SymbolGraphIndexer.js';
import { Logger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

// Input schema for the MCP tool
const IndexSymbolGraphSchema = z.object({
  repository_path: z.string().describe('Path to the repository to index'),
  files: z.array(z.string()).optional().describe('Explicit list of files to index'),
  include: z.array(z.string()).optional().describe('Glob patterns to include'),
  exclude: z.array(z.string()).optional().describe('Glob patterns to exclude'),
  force_clean: z.boolean().optional().default(false).describe('Wipe cache and rebuild (corruption recovery)'),
  max_workers: z.number().optional().default(4).describe('CPU parallelism for indexing')
});

type IndexSymbolGraphInput = z.infer<typeof IndexSymbolGraphSchema>;

export class IndexSymbolGraphTool {
  private logger: Logger;
  private indexer: SymbolGraphIndexer;

  constructor() {
    this.logger = new Logger('index-symbol-graph');
    this.indexer = new SymbolGraphIndexer();
  }

  /**
   * Get MCP tool definition
   */
  getToolDefinition(): Tool {
    return {
      name: 'index_symbol_graph',
      description: 'Index code for symbol graph search. Supports incremental updates, corruption recovery, and scoped indexing.',
      inputSchema: IndexSymbolGraphSchema
    };
  }

  /**
   * Execute the indexing operation
   */
  async execute(input: IndexSymbolGraphInput): Promise<any> {
    const startTime = Date.now();

    try {
      // Validate repository path
      const repoPath = path.resolve(input.repository_path);
      const stats = await fs.stat(repoPath);

      if (!stats.isDirectory()) {
        throw new Error(`Repository path is not a directory: ${repoPath}`);
      }

      // Handle force_clean - wipe cache for corruption recovery
      if (input.force_clean) {
        this.logger.info('Force clean requested - wiping symbol cache');
        await this.indexer.clearCache();
      }

      // Determine files to index
      let filesToIndex: string[] = [];

      if (input.files && input.files.length > 0) {
        // Explicit file list provided
        filesToIndex = input.files.map(f => path.resolve(repoPath, f));
      } else {
        // Use glob patterns
        const includePatterns = input.include || ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'];
        const excludePatterns = input.exclude || ['**/node_modules/**', '**/dist/**', '**/.git/**'];

        for (const pattern of includePatterns) {
          const matches = await glob(pattern, {
            cwd: repoPath,
            ignore: excludePatterns,
            absolute: true
          });
          filesToIndex.push(...matches);
        }

        // Remove duplicates
        filesToIndex = [...new Set(filesToIndex)];
      }

      this.logger.info(`Found ${filesToIndex.length} files to index`);

      // Index files with parallelism control
      const results = await this.indexFiles(filesToIndex, input.max_workers);

      const elapsedTime = Date.now() - startTime;

      // Generate summary
      const summary = {
        repository: repoPath,
        indexed_files: results.indexed.length,
        skipped_files: results.skipped.length,
        failed_files: results.failed.length,
        total_symbols: results.totalSymbols,
        elapsed_ms: elapsedTime,
        cache_hit_rate: results.cacheHitRate,
        force_clean: input.force_clean,
        max_workers: input.max_workers
      };

      // Log to file for debugging
      await this.logIndexingResults(repoPath, summary, results);

      this.logger.info('Indexing complete', summary);

      return {
        success: true,
        summary,
        details: {
          indexed: results.indexed,
          skipped: results.skipped,
          failed: results.failed
        }
      };

    } catch (error) {
      this.logger.error('Indexing failed', { error });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        suggestion: input.force_clean
          ? 'Indexing failed even with force_clean. Check file permissions and disk space.'
          : 'Try running with force_clean=true to recover from corruption.'
      };
    }
  }

  /**
   * Index files with parallelism control
   */
  private async indexFiles(files: string[], maxWorkers: number) {
    const indexed: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ file: string; error: string }> = [];
    let totalSymbols = 0;
    let cacheHits = 0;

    // Process files in batches for parallelism
    const batchSize = maxWorkers;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      const batchPromises = batch.map(async (file) => {
        try {
          // Check if file needs reindexing
          const needsIndex = await this.indexer.needsReindex(file);

          if (!needsIndex) {
            skipped.push(file);
            cacheHits++;
            return;
          }

          // Index the file
          const symbols = await this.indexer.indexFile(file);
          indexed.push(file);
          totalSymbols += symbols.length;

        } catch (error) {
          failed.push({
            file,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      });

      await Promise.all(batchPromises);
    }

    const cacheHitRate = files.length > 0 ? cacheHits / files.length : 0;

    return {
      indexed,
      skipped,
      failed,
      totalSymbols,
      cacheHitRate
    };
  }

  /**
   * Log indexing results to file
   */
  private async logIndexingResults(repoPath: string, summary: any, results: any) {
    const logDir = path.join(repoPath, 'var', 'storage', 'logs', 'zmcp', 'index');

    try {
      await fs.mkdir(logDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const logFile = path.join(logDir, `index-${timestamp}.json`);

      await fs.writeFile(logFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        summary,
        results
      }, null, 2));

    } catch (error) {
      this.logger.warn('Failed to write indexing log', { error });
    }
  }
}

/**
 * Create the MCP tool function
 */
export async function createIndexSymbolGraphTool() {
  const tool = new IndexSymbolGraphTool();

  return {
    definition: tool.getToolDefinition(),
    handler: async (input: any) => {
      const validated = IndexSymbolGraphSchema.parse(input);
      return await tool.execute(validated);
    }
  };
}