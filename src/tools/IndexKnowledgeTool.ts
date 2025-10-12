/**
 * IndexKnowledgeTool - Populate indexed_knowledge.json from GitHub issues + markdown docs
 *
 * Reads from:
 * - var/github_issues/github_issues.db (GitHub issues)
 * - Project markdown files (*.md)
 *
 * Writes to:
 * - var/storage/indexed_knowledge.json
 *
 * Generates embeddings via GPU service (port 8765) for semantic search.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { EmbeddingClient } from '../services/EmbeddingClient.js';
import { TreeSitterASTTool } from './TreeSitterASTTool.js';
import { Logger } from '../utils/logger.js';
import type { McpTool } from '../schemas/tools/index.js';

const logger = new Logger('IndexKnowledgeTool');

// Input schema
const IndexKnowledgeInputSchema = z.object({
  repository_path: z.string().describe('Absolute path to repository'),
  sources: z.object({
    github_issues: z.boolean().default(true).describe('Index GitHub issues from var/github_issues/github_issues.db'),
    markdown_docs: z.boolean().default(true).describe('Index markdown files (*.md)'),
    code_symbols: z.boolean().default(true).describe('Index code symbols from TypeScript/JavaScript/Python files using AST parser'),
  }).default({ github_issues: true, markdown_docs: true, code_symbols: true }),
  skip_embeddings: z.boolean().default(false).describe('Skip embedding generation (faster but no semantic search)'),
  output_path: z.string().optional().describe('Custom output path (default: var/storage/indexed_knowledge.json)'),
});

type IndexKnowledgeInput = z.infer<typeof IndexKnowledgeInputSchema>;

interface IndexedDocument {
  id: string;
  type: 'github_issue' | 'markdown_file' | 'code_symbol';
  title?: string;
  content: string;
  embedding?: number[];
  // GitHub issue fields
  repo?: string;
  number?: number;
  state?: string;
  labels?: string[];
  // Markdown file fields
  file_path?: string;
  relative_path?: string;
  size?: number;
  modified?: string;
  // Code symbol fields
  symbol_kind?: string;  // 'class', 'function', 'interface', 'method', etc.
  symbol_name?: string;
  location?: string;     // Compact format: "startLine:startCol-endLine:endCol"
  language?: string;     // 'typescript', 'javascript', 'python'
}

/**
 * Load GitHub issues from SQLite database
 */
async function loadGitHubIssues(repositoryPath: string): Promise<IndexedDocument[]> {
  const dbPath = path.join(repositoryPath, 'var/github_issues/github_issues.db');
  logger.info(`Loading GitHub issues from: ${dbPath}`);

  try {
    const db = new BetterSqlite3(dbPath, { readonly: true });

    const issues = db.prepare(`
      SELECT
        i.id,
        i.number,
        i.title,
        i.body,
        i.state,
        i.html_url,
        r.full_name as repo
      FROM issues i
      JOIN repositories r ON i.repository_id = r.id
      ORDER BY i.created_at DESC
    `).all() as Array<{
      id: number;
      number: number;
      title: string;
      body: string | null;
      state: string;
      html_url: string;
      repo: string;
    }>;

    // Get labels for each issue
    const issueLabels = new Map<number, string[]>();
    const labels = db.prepare(`
      SELECT il.issue_id, l.name
      FROM issue_labels il
      JOIN labels l ON il.label_id = l.id
    `).all() as Array<{ issue_id: number; name: string }>;

    for (const label of labels) {
      if (!issueLabels.has(label.issue_id)) {
        issueLabels.set(label.issue_id, []);
      }
      issueLabels.get(label.issue_id)!.push(label.name);
    }

    db.close();

    logger.info(`Loaded ${issues.length} GitHub issues`);

    return issues.map(issue => ({
      id: `issue-${issue.number}`,
      type: 'github_issue' as const,
      title: issue.title,
      content: issue.body || issue.title, // Fallback to title if no body
      repo: issue.repo,
      number: issue.number,
      state: issue.state,
      labels: issueLabels.get(issue.id) || []
    }));
  } catch (error) {
    logger.error(`Failed to load GitHub issues:`, error);
    return [];
  }
}

/**
 * Load markdown documentation files
 */
async function loadMarkdownDocs(repositoryPath: string): Promise<IndexedDocument[]> {
  logger.info(`Loading markdown documentation...`);

  const files = await glob('**/*.md', {
    cwd: repositoryPath,
    ignore: [
      'node_modules/**',
      'dist/**',
      '.git/**',
      'archive/**',
      '**/node_modules/**'
    ]
  });

  logger.info(`Found ${files.length} markdown files`);

  const docs: IndexedDocument[] = [];

  for (const file of files) {
    try {
      const fullPath = path.join(repositoryPath, file);
      const content = await fs.readFile(fullPath, 'utf-8');
      const stats = await fs.stat(fullPath);

      // Extract title from first # heading or use filename
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : path.basename(file, '.md');

      docs.push({
        id: `doc-${file.replace(/\//g, '-')}`,
        type: 'markdown_file' as const,
        title,
        content,
        file_path: fullPath,
        relative_path: file,
        size: stats.size,
        modified: stats.mtime.toISOString()
      });
    } catch (error) {
      logger.warn(`Failed to read ${file}:`, error);
    }
  }

  logger.info(`Loaded ${docs.length} markdown documents`);
  return docs;
}

/**
 * Load code symbols from TypeScript/JavaScript/Python files
 */
async function loadCodeSymbols(repositoryPath: string): Promise<IndexedDocument[]> {
  logger.info(`Extracting code symbols via AST parser...`);

  const astTool = new TreeSitterASTTool();
  const symbols: IndexedDocument[] = [];

  // Find all code files
  const codeFiles = await glob('**/*.{ts,tsx,js,jsx,py}', {
    cwd: repositoryPath,
    ignore: [
      'node_modules/**',
      'dist/**',
      '.git/**',
      'build/**',
      'archive/**',
      '**/__tests__/**',
      '**/*.test.{ts,js,py}',
      '**/*.spec.{ts,js,py}',
      '**/node_modules/**'
    ]
  });

  logger.info(`Found ${codeFiles.length} code files`);

  let totalSymbols = 0;
  let processedFiles = 0;

  for (const file of codeFiles) {
    try {
      const fullPath = path.join(repositoryPath, file);

      // Extract symbols using AST parser
      const result = await astTool.executeByToolName('ast_extract_symbols', {
        file_path: fullPath,
        operation: 'extract_symbols',
        language: 'auto'
      });

      if (result.success && result.symbols && result.symbols.length > 0) {
        // Convert each symbol to an IndexedDocument
        for (const symbol of result.symbols) {
          const content = [
            `Symbol: ${symbol.name} (${symbol.kind})`,
            `File: ${file}`,
            `Location: ${symbol.location}`,
            `Language: ${result.language}`
          ].join('\n');

          symbols.push({
            id: `symbol-${file.replace(/\//g, '-')}-${symbol.name}-${symbol.kind}`,
            type: 'code_symbol' as const,
            title: `${symbol.kind}: ${symbol.name}`,
            content,
            symbol_kind: symbol.kind,
            symbol_name: symbol.name,
            location: symbol.location,
            language: result.language,
            file_path: fullPath,
            relative_path: file
          });

          totalSymbols++;
        }

        processedFiles++;
      }

      // Log progress every 10 files
      if (processedFiles % 10 === 0) {
        logger.info(`  Processed ${processedFiles}/${codeFiles.length} files, found ${totalSymbols} symbols`);
      }

    } catch (error) {
      logger.warn(`Failed to extract symbols from ${file}:`, error);
    }
  }

  logger.info(`✅ Extracted ${totalSymbols} code symbols from ${processedFiles} files`);
  return symbols;
}

/**
 * Generate embeddings for documents
 */
async function generateEmbeddings(documents: IndexedDocument[]): Promise<number> {
  logger.info(`Generating embeddings for ${documents.length} documents...`);

  const embeddingClient = new EmbeddingClient();

  // Check if GPU service is available
  const gpuAvailable = await embeddingClient.checkGPUService();
  if (!gpuAvailable) {
    logger.warn('GPU embedding service not available - skipping embeddings');
    return 0;
  }

  // Generate embeddings in batches
  const BATCH_SIZE = 10;
  let processed = 0;

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    const texts = batch.map(doc => {
      const searchText = `${doc.title || ''}\n${doc.content}`.slice(0, 8000); // Truncate long docs
      return searchText;
    });

    try {
      // Use default model (qwen3) for embeddings
      const result = await embeddingClient.generateEmbeddings(texts, { model: 'qwen3' });

      if (result.embeddings) {
        for (let j = 0; j < batch.length; j++) {
          batch[j].embedding = result.embeddings[j];
        }
        processed += batch.length;
        logger.info(`  Generated embeddings: ${processed}/${documents.length}`);
      }
    } catch (error) {
      logger.error(`Failed to generate embeddings for batch ${i}:`, error);
    }
  }

  logger.info(`✅ Generated embeddings for ${processed} documents`);
  return processed;
}

/**
 * Handler for index_knowledge tool
 */
async function indexKnowledgeHandler(input: IndexKnowledgeInput): Promise<{
  content: Array<{ type: 'text'; text: string }>;
}> {
  const { repository_path, sources, skip_embeddings, output_path } = input;

  logger.info('Starting knowledge indexing...', { repository_path, sources, skip_embeddings });

  // Load documents
  const loadPromises: Promise<IndexedDocument[]>[] = [];

  if (sources.github_issues) {
    loadPromises.push(loadGitHubIssues(repository_path));
  }

  if (sources.markdown_docs) {
    loadPromises.push(loadMarkdownDocs(repository_path));
  }

  if (sources.code_symbols) {
    loadPromises.push(loadCodeSymbols(repository_path));
  }

  const results = await Promise.all(loadPromises);
  const allDocuments = results.flat();

  logger.info(`Total documents: ${allDocuments.length}`);

  // Generate embeddings
  let embeddingCount = 0;
  if (!skip_embeddings) {
    embeddingCount = await generateEmbeddings(allDocuments);
  } else {
    logger.info('⏭️  Skipping embeddings (skip_embeddings=true)');
  }

  // Write to indexed_knowledge.json
  const finalOutputPath = output_path || path.join(repository_path, 'var/storage/indexed_knowledge.json');
  await fs.mkdir(path.dirname(finalOutputPath), { recursive: true });
  await fs.writeFile(finalOutputPath, JSON.stringify(allDocuments, null, 2));

  const stats = await fs.stat(finalOutputPath);

  const summary = [
    '✅ Knowledge indexing complete!',
    '',
    `📚 Indexed ${allDocuments.length} documents:`,
    sources.github_issues ? `   - ${results[0]?.length || 0} GitHub issues` : null,
    sources.markdown_docs ? `   - ${results[sources.github_issues ? 1 : 0]?.length || 0} markdown files` : null,
    '',
    `💾 Output: ${finalOutputPath}`,
    `📦 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`,
    `🔢 Embeddings: ${embeddingCount}/${allDocuments.length} (${((embeddingCount/allDocuments.length)*100).toFixed(1)}%)`,
  ].filter(Boolean).join('\n');

  return {
    content: [{ type: 'text', text: summary }]
  };
}

/**
 * MCP Tool definition
 */
export const indexKnowledgeTool: McpTool = {
  name: 'index_knowledge',
  description: `Populate indexed_knowledge.json from GitHub issues database + markdown documentation.

**Purpose**: Index project knowledge for semantic search via knowledge://search resource.

**Data Sources**:
- GitHub issues: var/github_issues/github_issues.db (SQLite)
- Markdown docs: **/*.md files in project

**Output**: var/storage/indexed_knowledge.json (used by knowledge://search)

**Embeddings**: Generates via GPU service (port 8765) for semantic search. Use skip_embeddings=true for faster indexing without semantic search capability.

**Use Cases**:
- Initial indexing: Index all sources for first-time setup
- Incremental updates: Re-index after new issues or docs added
- Debugging: Verify knowledge://search data source`,
  inputSchema: zodToJsonSchema(IndexKnowledgeInputSchema) as any,
  handler: indexKnowledgeHandler,
};
