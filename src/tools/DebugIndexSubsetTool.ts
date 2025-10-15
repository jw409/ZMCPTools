/**
 * @file DebugIndexSubsetTool.ts
 * 
 * A debug tool to index a small subset of files.
 * This is to be used for debugging the indexing and embedding process without having to do a full re-index.
 */

import { SymbolGraphIndexer, IndexStats } from '../services/SymbolGraphIndexer.js';
import { z } from 'zod';
import type { McpTool } from '../schemas/tools/index.js';

const DebugIndexSubsetSchema = z.object({
  files: z.array(z.string()).describe('An array of absolute file paths to index.'),
});

export const debugIndexSubsetTool: McpTool = {
  name: 'debug_index_subset',
  description: 'Indexes a small subset of files for debugging purposes.',
  inputSchema: DebugIndexSubsetSchema,
  handler: async (params: z.infer<typeof DebugIndexSubsetSchema>) => {
    const indexer = new SymbolGraphIndexer();
    const projectPath = process.cwd();

    await indexer.initialize(projectPath);

    const stats: IndexStats = {
      totalFiles: params.files.length,
      indexedFiles: 0,
      alreadyIndexed: 0,
      needsIndexing: 0,
      skipped: 0,
      errors: []
    };

    for (const filePath of params.files) {
      // @ts-ignore - private method access for debugging
      await indexer.indexFile(filePath, stats);
    }

    // @ts-ignore - private method access for debugging
    await indexer.generatePendingEmbeddings();

    const finalStats = await indexer.getStats();

    await indexer.close();

    return finalStats;
  }
};
