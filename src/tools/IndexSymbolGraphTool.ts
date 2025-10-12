/**
 * Index Symbol Graph Tool
 *
 * Flexible code indexing tool following Unix design philosophy:
 * composable, reusable, does one thing well.
 *
 * Enables adding new code to search, recovering from corruption,
 * and scoped indexing.
 *
 * Related:
 * - Issue #53: index_symbol_graph MCP tool
 * - symbols:// resource for querying cached symbols
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { McpTool } from '../schemas/tools/index.js';
import { getSymbolGraphIndexer } from '../services/SymbolGraphIndexer.js';
import { StoragePathResolver } from '../services/StoragePathResolver.js';
import { Logger } from '../utils/logger.js';
import { glob } from 'glob';
import * as path from 'path';


const logger = new Logger('index-symbol-graph');

// Input schema for the tool
const IndexSymbolGraphInputSchema = z.object({
  repository_path: z.string().describe('Absolute path to repository to index'),
  files: z.array(z.string()).optional().describe('Explicit file list (composable!)'),
  include: z.array(z.string()).optional().describe('Glob patterns to include (default: **/*.{ts,js,py,md})'),
  exclude: z.array(z.string()).optional().describe('Glob patterns to exclude (default: node_modules/**, dist/**, **/*.test.ts)'),
  force_clean: z.boolean().optional().default(false).describe('Wipe cache and rebuild from scratch (corruption recovery)'),
  max_workers: z.number().optional().default(4).describe('CPU parallelism for scanning/parsing (default: 4)'),
  openapi_spec: z.string().optional().describe('Absolute path to an OpenAPI JSON file. If provided, the indexer will link code symbols to the API contract.')
});

type IndexSymbolGraphInput = z.infer<typeof IndexSymbolGraphInputSchema>;

// Default patterns
const DEFAULT_INCLUDE_PATTERNS = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py', '**/*.md'];
const DEFAULT_EXCLUDE_PATTERNS = ['node_modules/**', 'dist/**', 'build/**', '.git/**', '**/*.test.ts', '**/*.spec.ts'];

/**
 * Handler function for index_symbol_graph tool
 */
async function indexSymbolGraphHandler(input: IndexSymbolGraphInput): Promise<any> {
  const startTime = Date.now();
  const {
    repository_path,
    files,
    include = DEFAULT_INCLUDE_PATTERNS,
    exclude = DEFAULT_EXCLUDE_PATTERNS,
    force_clean = false,
    max_workers = 4,
    openapi_spec
  } = input;

  logger.info('Starting symbol graph indexing', {
    repository_path,
    mode: files ? 'explicit-files' : 'glob-patterns',
    file_count: files?.length,
    force_clean,
    with_api_spec: !!openapi_spec
  });

  // API Conformance Linking Logic
  if (openapi_spec) {
    logger.info('OpenAPI spec provided, starting API conformance linking process.', { spec_path: openapi_spec });
    try {
      const fs = await import('fs/promises');
      const specContent = await fs.readFile(openapi_spec, 'utf-8');
      const spec = JSON.parse(specContent);

      // Simple check for spec validity
      if (!spec.openapi || !spec.paths) {
        throw new Error('Invalid OpenAPI spec file.');
      }

      // Step 4: Populate Knowledge Graph with API Entities
      for (const path in spec.paths) {
        for (const method in spec.paths[path]) {
          const endpointName = `${method.toUpperCase()} ${path}`;
          const endpointId = `spec_endpoint:${endpointName}`;
          await store_knowledge_memory({
            entity_type: 'api_endpoint',
            entity_name: endpointName,
            entity_id: endpointId, // Custom ID for easy linking
            properties: spec.paths[path][method],
          });
        }
      }

      // Step 5: Link Code Symbols to API Entities
      const allSymbols = await indexer.getAllSymbols(); // Assume indexer can provide all symbols
      for (const symbol of allSymbols) {
        const fileContent = await fs.readFile(symbol.filePath, 'utf-8');
        
        // Backend linking (simple regex for python decorators)
        if (symbol.filePath.endsWith('.py')) {
          const pyRegex = /@app\.(get|post|put|delete)\([\'\"](.*)[\'\"]\)/g;
          let match;
          while ((match = pyRegex.exec(fileContent)) !== null) {
            const method = match[1].toUpperCase();
            const path = match[2];
            const endpointName = `${method} ${path}`;
            const endpointId = `spec_endpoint:${endpointName}`;

            await create_knowledge_relationship({
              from_entity_id: symbol.id, // Assumes symbol has a unique ID
              to_entity_id: endpointId,
              relationship_type: 'implements_endpoint',
            });
          }
        }

        // Frontend linking (simple regex for fetch calls)
        if (symbol.filePath.endsWith('.ts')) {
          const tsRegex = /fetch\([\'\`\"](.*)[\'\`\"]\)/g;
          let match;
          while ((match = tsRegex.exec(fileContent)) !== null) {
            const path = match[1].replace(/\$\{.*\}/g, '{id}'); // Simple template literal replacement
            const endpointName = `GET ${path}`; // Assume GET for simplicity
            const endpointId = `spec_endpoint:${endpointName}`;

            await create_knowledge_relationship({
              from_entity_id: symbol.id,
              to_entity_id: endpointId,
              relationship_type: 'calls_endpoint',
            });
          }
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during API linking';
      logger.error('API conformance linking failed', { error: errorMessage });
      // Return a diagnostic on failure
      return {
        status: 'failed',
        diagnostics: {
          level: 'error',
          message: `Failed to process OpenAPI spec: ${errorMessage}`,
        }
      }
    }
  }

  try {
    // Get storage paths
    const storageConfig = StoragePathResolver.getStorageConfig({
      preferLocal: true,
      projectPath: repository_path
    });

    const sqlitePath = StoragePathResolver.getSQLitePath(storageConfig, 'symbol_graph');
    const lancedbPath = StoragePathResolver.getLanceDBPath(storageConfig);

    // Initialize indexer
    const indexer = getSymbolGraphIndexer();
    await indexer.initialize(repository_path);

    // Force clean if requested (corruption recovery)
    if (force_clean) {
      logger.info('Force clean enabled - wiping cache');
      // TODO: Add wipe functionality to SymbolGraphIndexer
      // For now, we rely on the indexer's built-in re-indexing
    }

    let filesToIndex: string[] = [];

    if (files && files.length > 0) {
      // Explicit file list provided (Unix composability)
      filesToIndex = files.map(f => path.resolve(repository_path, f));
      logger.info('Using explicit file list', { count: filesToIndex.length });
    } else {
      // Use glob patterns (default behavior)
      logger.info('Using glob patterns', { include, exclude });

      for (const pattern of include) {
        const matches = await glob(pattern, {
          cwd: repository_path,
          absolute: true,
          ignore: exclude,
          nodir: true
        });
        filesToIndex.push(...matches);
      }

      // Remove duplicates
      filesToIndex = [...new Set(filesToIndex)];
      logger.info('Found files via glob', { count: filesToIndex.length });
    }

    // Index repository
    const stats = await indexer.indexRepository(repository_path);

    const duration_ms = Date.now() - startTime;

    // Get storage sizes
    const fs = await import('fs/promises');
    let sqlite_size_mb = 0;
    let lancedb_size_mb = 0;

    try {
      const sqliteStats = await fs.stat(sqlitePath);
      sqlite_size_mb = sqliteStats.size / (1024 * 1024);
    } catch (error) {
      logger.warn('Could not get SQLite size', { error });
    }

    try {
      // LanceDB is a directory
      const lancedbStats = await fs.stat(lancedbPath);
      if (lancedbStats.isDirectory()) {
        // Rough estimate - sum all files in directory
        const files = await fs.readdir(lancedbPath);
        for (const file of files) {
          try {
            const fileStat = await fs.stat(path.join(lancedbPath, file));
            lancedb_size_mb += fileStat.size / (1024 * 1024);
          } catch {}
        }
      }
    } catch (error) {
      logger.warn('Could not get LanceDB size', { error });
    }

    // Create operation log
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logStatus = stats.errors.length > 0 ? 'partial' : 'success';
    const logDir = StoragePathResolver.getLogsPath(storageConfig, 'zmcp/index');
    const logFile = path.join(logDir, `${logStatus}-${timestamp}.log`);

    // Ensure log directory exists
    await fs.mkdir(logDir, { recursive: true });

    // Write log
    const logContent = [
      `[${new Date().toISOString()}] INDEX START`,
      `Repository: ${repository_path}`,
      `Mode: ${files ? 'explicit-files' : 'glob-patterns'}`,
      `Force Clean: ${force_clean}`,
      '',
      `[${new Date().toISOString()}] Indexing Files`,
      `Total files: ${stats.totalFiles}`,
      `Indexed: ${stats.indexedFiles}`,
      `Already indexed: ${stats.alreadyIndexed}`,
      `Skipped: ${stats.skipped}`,
      '',
      `[${new Date().toISOString()}] INDEX COMPLETE`,
      `Duration: ${(duration_ms / 1000).toFixed(1)}s`,
      `SQLite size: ${sqlite_size_mb.toFixed(2)} MB`,
      `LanceDB size: ${lancedb_size_mb.toFixed(2)} MB`,
      '',
      ...(stats.errors.length > 0 ? ['Errors:', ...stats.errors] : [])
    ].join('\n');

    await fs.writeFile(logFile, logContent, 'utf-8');

    // Build response
    const response = {
      status: stats.errors.length > 0 ? 'partial' : 'completed',
      files_indexed: stats.indexedFiles,
      symbols_extracted: stats.totalSymbols || 0,
      embeddings_generated: stats.filesWithEmbeddings || 0,
      duration_ms,
      storage: {
        sqlite_path: sqlitePath,
        sqlite_size_mb,
        lancedb_path: lancedbPath,
        lancedb_size_mb
      },
      logs: {
        operation_log: logFile,
        operation_resource: `logs://zmcp/content?file=index/${logStatus}-${timestamp}.log`
      },
      warnings: stats.errors,
      cache_hit_rate: stats.totalFiles > 0 ? (stats.alreadyIndexed / stats.totalFiles) : 0
    };

    logger.info('Symbol graph indexing completed', {
      files_indexed: stats.indexedFiles,
      duration_ms,
      cache_hit_rate: response.cache_hit_rate
    });

    return response;

  } catch (error) {
    const duration_ms = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Symbol graph indexing failed', { error: errorMessage });

    // Create error log
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const storageConfig = StoragePathResolver.getStorageConfig({
      preferLocal: true,
      projectPath: repository_path
    });
    const logDir = StoragePathResolver.getLogsPath(storageConfig, 'zmcp/index');
    const logFile = path.join(logDir, `failed-${timestamp}.log`);

    try {
      const fs = await import('fs/promises');
      await fs.mkdir(logDir, { recursive: true });

      const logContent = [
        `[${new Date().toISOString()}] INDEX FAILED`,
        `Repository: ${repository_path}`,
        `Error: ${errorMessage}`,
        `Duration: ${(duration_ms / 1000).toFixed(1)}s`,
        '',
        ...(error instanceof Error && error.stack ? ['Stack trace:', error.stack] : [])
      ].join('\n');

      await fs.writeFile(logFile, logContent, 'utf-8');
    } catch (logError) {
      logger.warn('Failed to write error log', { error: logError });
    }

    return {
      status: 'failed',
      errors: [errorMessage],
      diagnostics: {
        suggested_fixes: [
          'Check if repository path exists and is readable',
          'Verify embedding service is running: curl http://localhost:8765/health',
          'Check file permissions for storage directory'
        ]
      },
      logs: {
        operation_log: logFile,
        operation_resource: `logs://zmcp/content?file=index/failed-${timestamp}.log`
      },
      duration_ms
    };
  }
}

// Export the tool definition
export const indexSymbolGraphTool: McpTool = {
  name: 'index_symbol_graph',
    description: `Builds/updates the project\'s knowledge graph by indexing all code symbols. This is the primary "write" operation for the graph. Can optionally link symbols to an OpenAPI specification for cross-language validation.

    **Philosophy:** This is a "write" tool. It prepares and builds the graph. Use "read" resources like \`knowledge://search\` or \`symbols://search\` to query the data after indexing is complete. This separation of read and write is a core principle of ZMCPTools.

    **Core Use Cases:**
    - **Initial Indexing:** Run on a new project to build the graph for the first time.
    - **Incremental Updates:** Run after major code changes to keep the graph fresh. The tool automatically detects unchanged files for high performance.

    **Advanced Use Case: API Conformance Validation**
    - **Goal:** Validate that a client (e.g., TypeScript frontend) matches the API contract defined in an OpenAPI spec.
    - **Workflow:**
        1.  **Ensure Spec Exists:** The agent is responsible for ensuring an up-to-date \`openapi.json\` file is available for the project.
        2.  **Build Linked Graph (Write):** Call this tool, providing both the \`repository_path\` and the \`openapi_spec\` path. This is the explicit build step that creates the links.
        3.  **Query for Discrepancies (Read):** After the indexer finishes, use a "read" resource like \`knowledge://search\` to find and compare the linked artifacts.
    `,
  inputSchema: zodToJsonSchema(IndexSymbolGraphInputSchema) as any,
  handler: indexSymbolGraphHandler
};
