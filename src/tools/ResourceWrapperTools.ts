/**
 * Resource Wrapper Tools
 *
 * Wraps MCP resources as explicit tools for compatibility with Gemini/OpenRouter agents.
 * These agents don't understand MCP resources natively, so we expose each resource
 * as a specific, purpose-built tool.
 *
 * Why this exists:
 * - Claude understands resources: file://path/symbols
 * - Gemini/OpenRouter see one confusing tool: read_mcp_resource(uri)
 * - Solution: Specific tools like get_file_symbols(file_path)
 *
 * Token efficiency:
 * - Still better than old approach (8 wrapper tools ~1,600 tokens vs 20+ original tools ~4,000 tokens)
 * - Claude gets resources (~30 tokens), others get wrappers (~200 tokens each)
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { McpTool } from '../schemas/tools/index.js';
import type { ResourceManager } from '../managers/ResourceManager.js';

export function getResourceWrapperTools(resourceManager: ResourceManager): McpTool[] {
  return [
    // File Analysis Resources
    {
      name: 'get_file_symbols',
      description: 'Extract symbols (functions, classes, methods, interfaces) from source file. Fast AST-based parsing.',
      inputSchema: zodToJsonSchema(z.object({
        file_path: z.string().describe('Path to source file (e.g., "src/index.ts")'),
        include_positions: z.boolean().optional().describe('Include line/column positions')
      })),
      handler: async (args) => {
        const { file_path, include_positions } = args;
        const params = include_positions ? '?include_positions=true' : '';
        const uri = `file://${file_path}/symbols${params}`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_file_imports',
      description: 'Extract all import statements from source file. Useful for dependency analysis.',
      inputSchema: zodToJsonSchema(z.object({
        file_path: z.string().describe('Path to source file')
      })),
      handler: async (args) => {
        const uri = `file://${args.file_path}/imports`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_file_exports',
      description: 'Extract all export statements from source file. Shows public API surface.',
      inputSchema: zodToJsonSchema(z.object({
        file_path: z.string().describe('Path to source file')
      })),
      handler: async (args) => {
        const uri = `file://${args.file_path}/exports`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_file_structure',
      description: 'Get Markdown-formatted code outline. High-level file organization without full content.',
      inputSchema: zodToJsonSchema(z.object({
        file_path: z.string().describe('Path to source file')
      })),
      handler: async (args) => {
        const uri = `file://${args.file_path}/structure`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_file_diagnostics',
      description: 'Get syntax errors and parse diagnostics for source file.',
      inputSchema: zodToJsonSchema(z.object({
        file_path: z.string().describe('Path to source file')
      })),
      handler: async (args) => {
        const uri = `file://${args.file_path}/diagnostics`;
        return await resourceManager.readResource(uri);
      }
    },

    // Project Analysis Resources
    {
      name: 'get_project_structure',
      description: 'Get project directory tree with smart ignore patterns. Fast paginated mode recommended.',
      inputSchema: zodToJsonSchema(z.object({
        path: z.string().default('.').describe('Project root path (default: current directory)'),
        flat: z.boolean().optional().default(true).describe('Use flat paginated mode (recommended, faster)'),
        limit: z.number().optional().default(100).describe('Max files per page'),
        cursor: z.string().optional().describe('Pagination cursor from previous response'),
        verbose: z.boolean().optional().describe('Include file metadata (size, modified time)')
      })),
      handler: async (args) => {
        const { path = '.', flat, limit, cursor, verbose } = args;
        const params = new URLSearchParams();
        if (flat !== undefined) params.set('flat', String(flat));
        if (limit) params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        if (verbose) params.set('verbose', 'true');

        const uri = `project://${path}/structure?${params}`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_project_dependencies',
      description: 'Get direct dependencies (imports) for a source file from symbol graph cache. Fast SQLite lookup.',
      inputSchema: zodToJsonSchema(z.object({
        file_path: z.string().describe('Path to source file')
      })),
      handler: async (args) => {
        const uri = `project://${args.file_path}/dependencies`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_project_dependents',
      description: 'Get reverse dependencies (files that import this file) from cache. For impact analysis.',
      inputSchema: zodToJsonSchema(z.object({
        file_path: z.string().describe('Path to source file')
      })),
      handler: async (args) => {
        const uri = `project://${args.file_path}/dependents`;
        return await resourceManager.readResource(uri);
      }
    },

    // Symbol Graph Resources
    {
      name: 'get_symbols_list',
      description: 'List all files indexed in symbol graph cache. Use to discover what\'s available before searching.',
      inputSchema: zodToJsonSchema(z.object({
        limit: z.number().optional().default(100).describe('Max files to return'),
        cursor: z.string().optional().describe('Pagination cursor')
      })),
      handler: async (args) => {
        const { limit = 100, cursor } = args;
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);

        const uri = `symbols://list?${params}`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_symbols_search',
      description: 'Search cached symbols by name/type (function, class, method, interface). Fast SQLite lookup.',
      inputSchema: zodToJsonSchema(z.object({
        name: z.string().optional().describe('Symbol name pattern (supports wildcards)'),
        type: z.enum(['function', 'class', 'method', 'interface']).optional().describe('Filter by symbol type'),
        limit: z.number().optional().default(50).describe('Max results')
      })),
      handler: async (args) => {
        const { name, type, limit = 50 } = args;
        const params = new URLSearchParams();
        if (name) params.set('name', name);
        if (type) params.set('type', type);
        params.set('limit', String(limit));

        const uri = `symbols://search?${params}`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_symbols_stats',
      description: 'Get symbol graph cache statistics - total files indexed, symbols extracted, cache health.',
      inputSchema: zodToJsonSchema(z.object({})),
      handler: async () => {
        const uri = 'symbols://stats';
        return await resourceManager.readResource(uri);
      }
    },

    // Knowledge Graph Resources
    {
      name: 'get_knowledge_search',
      description: 'Search knowledge graph using GPU semantic search + BM25. Searches GitHub issues, docs, architecture, prior solutions.',
      inputSchema: zodToJsonSchema(z.object({
        query: z.string().describe('Search query (natural language or keywords)'),
        limit: z.number().optional().default(10).describe('Max results'),
        threshold: z.number().optional().describe('Min similarity score 0-1 (default: 0.7)'),
        cursor: z.string().optional().describe('Pagination cursor')
      })),
      handler: async (args) => {
        const { query, limit = 10, threshold, cursor } = args;
        const params = new URLSearchParams();
        params.set('query', query);
        params.set('limit', String(limit));
        if (threshold) params.set('threshold', String(threshold));
        if (cursor) params.set('cursor', cursor);

        const uri = `knowledge://search?${params}`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_knowledge_status',
      description: 'Get knowledge graph health statistics - entities, relationships, quality metrics, index freshness.',
      inputSchema: zodToJsonSchema(z.object({})),
      handler: async () => {
        const uri = 'knowledge://status';
        return await resourceManager.readResource(uri);
      }
    },

    // Vector Search Resources
    {
      name: 'get_vector_collections',
      description: 'List all LanceDB vector collections with statistics (doc count, dimensions, storage size).',
      inputSchema: zodToJsonSchema(z.object({
        search: z.string().optional().describe('Filter collections by name pattern')
      })),
      handler: async (args) => {
        const params = args.search ? `?search=${args.search}` : '';
        const uri = `vector://collections${params}`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_vector_search',
      description: 'Semantic search across vector collections using embeddings. Find documents by meaning, not keywords.',
      inputSchema: zodToJsonSchema(z.object({
        query: z.string().describe('Search query (natural language)'),
        collection: z.string().optional().describe('Target collection (omit for all)'),
        limit: z.number().optional().default(10).describe('Max results')
      })),
      handler: async (args) => {
        const { query, collection, limit = 10 } = args;
        const params = new URLSearchParams();
        params.set('query', query);
        if (collection) params.set('collection', collection);
        params.set('limit', String(limit));

        const uri = `vector://search?${params}`;
        return await resourceManager.readResource(uri);
      }
    },

    {
      name: 'get_vector_status',
      description: 'Check LanceDB connection status, GPU integration, embedding models, available collections.',
      inputSchema: zodToJsonSchema(z.object({})),
      handler: async () => {
        const uri = 'vector://status';
        return await resourceManager.readResource(uri);
      }
    }
  ];
}
