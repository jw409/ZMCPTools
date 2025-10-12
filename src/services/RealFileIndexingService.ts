/**
 * Real File Indexing Service
 * Indexes actual project files for semantic and keyword search
 * Uses TreeParser for symbol extraction and real content for BM25
 */

import { TreeSitterASTTool } from '../tools/TreeSitterASTTool.js';
import { EmbeddingClient } from './EmbeddingClient.js';
import { BM25Service } from './BM25Service.js';
import { KnowledgeGraphService } from './KnowledgeGraphService.js';
import { Logger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

const logger = new Logger('real-file-indexing');

// Legacy type for backward compatibility with previous LezerParserService
export interface ParsedSymbol {
  name: string;
  type: string;
  startLine: number;
  endLine: number;
  signature?: string;
  isExported?: boolean;
}

export interface IndexedFile {
  filePath: string;
  content: string;
  symbols: ParsedSymbol[];
  language: string;
  size: number;
  lastModified: Date;
  embedding?: number[];
}

export interface SearchResult {
  filePath: string;
  content: string;
  score: number;
  matchType: 'keyword' | 'semantic' | 'symbol' | 'hybrid';
  relevantSymbols?: ParsedSymbol[];
}

export interface IndexingStats {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  languages: Record<string, number>;
  symbols: Record<string, number>;
  errors: string[];
  indexingTimeMs: number;
}

/**
 * Service for indexing and searching real project files
 */
export class RealFileIndexingService {
  private treeParser: TreeSitterASTTool;
  private embeddingClient: EmbeddingClient;
  private bm25Service: BM25Service;
  private indexedFiles: Map<string, IndexedFile> = new Map();

  // File patterns to ignore
  private ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.min.js',
    '**/*.map',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/.env*',
    '**/logs/**',
    '**/*.log'
  ];

  // File extensions to index
  private indexableExtensions = new Set([
    '.js', '.jsx', '.ts', '.tsx',
    '.py', '.pyi',
    '.java',
    '.cpp', '.cc', '.cxx', '.hpp', '.c', '.h',
    '.rs',
    '.php',
    '.html', '.htm',
    '.css', '.scss',
    '.json',
    '.md', '.txt',
    '.yaml', '.yml'
  ]);

  constructor() {
    this.treeParser = new TreeSitterASTTool();
    this.embeddingClient = new EmbeddingClient();
    this.bm25Service = new BM25Service();
  }

  /**
   * Index all files in a repository/directory
   */
  async indexRepository(repositoryPath: string): Promise<IndexingStats> {
    const startTime = Date.now();
    const stats: IndexingStats = {
      totalFiles: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      languages: {},
      symbols: {},
      errors: [],
      indexingTimeMs: 0
    };

    logger.info('Starting repository indexing', { repositoryPath });

    try {
      // Find all files to index
      const allFiles = await this.findIndexableFiles(repositoryPath);
      stats.totalFiles = allFiles.length;

      logger.info(`Found ${allFiles.length} indexable files`);

      // Process files in batches to avoid memory issues
      const batchSize = 50;
      for (let i = 0; i < allFiles.length; i += batchSize) {
        const batch = allFiles.slice(i, i + batchSize);
        await this.processBatch(batch, stats);

        if (i % (batchSize * 4) === 0) {
          logger.info(`Indexing progress: ${i}/${allFiles.length} files`);
        }
      }

      // Build final indices
      await this.buildIndices();

      stats.indexingTimeMs = Date.now() - startTime;
      logger.info('Repository indexing completed', {
        ...stats,
        avgTimePerFile: stats.indexingTimeMs / stats.indexedFiles
      });

      return stats;

    } catch (error) {
      stats.errors.push(`Indexing failed: ${error.message}`);
      stats.indexingTimeMs = Date.now() - startTime;
      throw error;
    }
  }

  /**
   * Find all files that should be indexed
   */
  private async findIndexableFiles(repositoryPath: string): Promise<string[]> {
    const patterns = Array.from(this.indexableExtensions).map(ext => `**/*${ext}`);

    let allFiles: string[] = [];
    for (const pattern of patterns) {
      const files = await glob(pattern, {
        cwd: repositoryPath,
        absolute: true,
        ignore: this.ignorePatterns,
        nodir: true
      });
      allFiles.push(...files);
    }

    // Remove duplicates and filter by size
    const uniqueFiles = [...new Set(allFiles)];
    const validFiles = [];

    for (const filePath of uniqueFiles) {
      try {
        const stats = await fs.stat(filePath);
        // Skip very large files (>1MB) and very small files (<10 bytes)
        if (stats.size > 10 && stats.size < 1024 * 1024) {
          validFiles.push(filePath);
        }
      } catch (error) {
        // Skip files that can't be accessed
      }
    }

    return validFiles;
  }

  /**
   * Process a batch of files
   */
  private async processBatch(filePaths: string[], stats: IndexingStats): Promise<void> {
    const promises = filePaths.map(filePath => this.indexFile(filePath, stats));
    await Promise.allSettled(promises);
  }

  /**
   * Index a single file
   */
  private async indexFile(filePath: string, stats: IndexingStats): Promise<void> {
    try {
      // Read file content
      const content = await fs.readFile(filePath, 'utf-8');
      const fileStats = await fs.stat(filePath);

      const ext = path.extname(filePath).toLowerCase();
      let language = 'unknown';
      let symbols: any[] = [];

      // For markdown, JSON, YAML, TXT files - just index content without symbols
      const textOnlyFormats = ['.md', '.txt', '.json', '.yaml', '.yml'];
      if (textOnlyFormats.includes(ext)) {
        language = ext.substring(1); // Remove leading dot
      } else {
        // For code files, parse to extract symbols using TreeSitterASTTool
        const parseResult = await this.treeParser.executeByToolName('ast_extract_symbols', {
          file_path: filePath,
          language: 'auto'
        });

        if (!parseResult.success) {
          // If parsing fails, still index the content without symbols
          language = ext.substring(1) || 'unknown';
          logger.debug(`Failed to parse ${filePath}, indexing content only`);
        } else {
          language = parseResult.language || 'unknown';
          symbols = parseResult.symbols || [];
        }
      }

      // Track language statistics
      if (!stats.languages[language]) {
        stats.languages[language] = 0;
      }
      stats.languages[language]++;

      // Convert symbols to ParsedSymbol format and track statistics
      const parsedSymbols: ParsedSymbol[] = symbols.map((sym: any) => {
        const symbolType = sym.kind || 'unknown';
        if (!stats.symbols[symbolType]) {
          stats.symbols[symbolType] = 0;
        }
        stats.symbols[symbolType]++;

        return {
          name: sym.name,
          type: symbolType,
          startLine: sym.startPosition?.row || 0,
          endLine: sym.endPosition?.row || 0,
          signature: sym.text,
          isExported: false
        };
      });

      // Create indexed file record
      const indexedFile: IndexedFile = {
        filePath: path.relative(process.cwd(), filePath),
        content,
        symbols: parsedSymbols,
        language,
        size: fileStats.size,
        lastModified: fileStats.mtime
      };

      this.indexedFiles.set(filePath, indexedFile);
      stats.indexedFiles++;

    } catch (error: any) {
      stats.errors.push(`Failed to index ${filePath}: ${error.message}`);
      stats.skippedFiles++;
    }
  }

  /**
   * Build search indices from indexed files
   */
  private async buildIndices(): Promise<void> {
    logger.info('Building search indices');

    // Build BM25 index
    const bm25Promises = Array.from(this.indexedFiles.values()).map(file => {
      const searchableText = this.createSearchableText(file);
      return this.bm25Service.indexDocument({
        id: file.filePath,
        text: searchableText,
        metadata: {
          language: file.language,
          symbolCount: file.symbols.length,
          size: file.size
        }
      });
    });

    await Promise.all(bm25Promises);

    // Generate embeddings for semantic search (if GPU service available)
    if (await this.embeddingClient.checkGPUService()) {
      logger.info('Generating embeddings for semantic search');

      const embeddingPromises = Array.from(this.indexedFiles.values()).map(async file => {
        try {
          const searchableText = this.createSearchableText(file);
          const result = await this.embeddingClient.generateEmbeddings([searchableText], { model: 'qwen3' });
          file.embedding = result.embeddings[0];
        } catch (error: any) {
          logger.warn(`Failed to generate embedding for ${file.filePath}: "${error?.message || error}"`);
        }
      });

      await Promise.allSettled(embeddingPromises);
    }

    logger.info('Search indices built successfully');
  }

  /**
   * Create searchable text from file content and symbols
   */
  private createSearchableText(file: IndexedFile): string {
    const parts = [];

    // Add file path and name (important for search)
    parts.push(file.filePath);
    parts.push(path.basename(file.filePath));

    // Add symbols (function names, class names, etc.)
    for (const symbol of file.symbols) {
      parts.push(symbol.name);
      if (symbol.signature) {
        parts.push(symbol.signature);
      }
    }

    // Add truncated file content (first 2000 characters)
    const contentSample = file.content.substring(0, 2000);
    parts.push(contentSample);

    return parts.join(' ');
  }

  /**
   * Search for files using BM25 keyword search
   */
  async searchKeyword(query: string, limit: number = 10): Promise<SearchResult[]> {
    const bm25Results = await this.bm25Service.search(query, limit);

    return bm25Results.map(doc => {
      const file = this.indexedFiles.get(doc.id);
      return {
        filePath: doc.id,
        content: file?.content || '',
        score: doc.score,
        matchType: 'keyword' as const,
        relevantSymbols: file?.symbols || []
      };
    });
  }

  /**
   * Search for files using semantic similarity
   */
  async searchSemantic(query: string, limit: number = 10): Promise<SearchResult[]> {
    if (!await this.embeddingClient.checkGPUService()) {
      return [];
    }

    try {
      const result = await this.embeddingClient.generateEmbeddings([query], { model: 'qwen3', isQuery: true });
      const queryEmbedding = result.embeddings[0];
      const similarities: Array<{filePath: string, score: number}> = [];

      // Calculate cosine similarity with all file embeddings
      for (const [filePath, file] of this.indexedFiles) {
        if (file.embedding) {
          const similarity = this.cosineSimilarity(queryEmbedding, file.embedding);
          similarities.push({ filePath, score: similarity });
        }
      }

      // Sort by similarity and take top results
      similarities.sort((a, b) => b.score - a.score);
      const topResults = similarities.slice(0, limit);

      return topResults.map(result => {
        const file = this.indexedFiles.get(result.filePath)!;
        return {
          filePath: result.filePath,
          content: file.content,
          score: result.score,
          matchType: 'semantic' as const,
          relevantSymbols: file.symbols
        };
      });

    } catch (error) {
      logger.error('Semantic search failed:', error.message);
      return [];
    }
  }

  /**
   * Search for files by symbol names
   */
  searchSymbols(query: string, limit: number = 10): SearchResult[] {
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const [filePath, file] of this.indexedFiles) {
      const matchingSymbols = file.symbols.filter(symbol =>
        symbol.name.toLowerCase().includes(queryLower) ||
        (symbol.signature && symbol.signature.toLowerCase().includes(queryLower))
      );

      if (matchingSymbols.length > 0) {
        // Score based on exact matches and symbol importance
        let score = 0;
        for (const symbol of matchingSymbols) {
          if (symbol.name.toLowerCase() === queryLower) {
            score += 1.0;
          } else if (symbol.name.toLowerCase().startsWith(queryLower)) {
            score += 0.8;
          } else {
            score += 0.5;
          }

          // Boost exported symbols
          if (symbol.isExported) {
            score += 0.2;
          }
        }

        results.push({
          filePath,
          content: file.content,
          score,
          matchType: 'symbol',
          relevantSymbols: matchingSymbols
        });
      }
    }

    // Sort by score and return top results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Hybrid search combining keyword, semantic, and symbol search
   */
  async searchHybrid(query: string, limit: number = 10): Promise<SearchResult[]> {
    const [keywordResults, semanticResults, symbolResults] = await Promise.all([
      this.searchKeyword(query, limit * 2),
      this.searchSemantic(query, limit * 2),
      Promise.resolve(this.searchSymbols(query, limit * 2))
    ]);

    // Combine results using Reciprocal Rank Fusion (RRF)
    const k = 60;
    const combinedScores = new Map<string, number>();

    // Add keyword scores
    keywordResults.forEach((result, index) => {
      const currentScore = combinedScores.get(result.filePath) || 0;
      combinedScores.set(result.filePath, currentScore + 1 / (k + index + 1));
    });

    // Add semantic scores
    semanticResults.forEach((result, index) => {
      const currentScore = combinedScores.get(result.filePath) || 0;
      combinedScores.set(result.filePath, currentScore + 1 / (k + index + 1));
    });

    // Add symbol scores
    symbolResults.forEach((result, index) => {
      const currentScore = combinedScores.get(result.filePath) || 0;
      combinedScores.set(result.filePath, currentScore + 1 / (k + index + 1));
    });

    // Sort by combined score
    const sortedResults = Array.from(combinedScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    // Create final results
    return sortedResults.map(([filePath, score]) => {
      const file = this.indexedFiles.get(filePath);
      // Get relevant symbols from symbol search results
      const symbolResult = symbolResults.find(r => r.filePath === filePath);

      return {
        filePath,
        content: file?.content || '',
        score,
        matchType: 'hybrid' as const,
        relevantSymbols: symbolResult?.relevantSymbols || file?.symbols || []
      };
    });
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get statistics about indexed files
   */
  getIndexStats(): {
    totalFiles: number;
    languages: Record<string, number>;
    symbols: Record<string, number>;
    hasEmbeddings: boolean;
  } {
    const languages: Record<string, number> = {};
    const symbols: Record<string, number> = {};
    let hasEmbeddings = false;

    for (const file of this.indexedFiles.values()) {
      // Count languages
      languages[file.language] = (languages[file.language] || 0) + 1;

      // Count symbols
      for (const symbol of file.symbols) {
        symbols[symbol.type] = (symbols[symbol.type] || 0) + 1;
      }

      // Check for embeddings
      if (file.embedding) {
        hasEmbeddings = true;
      }
    }

    return {
      totalFiles: this.indexedFiles.size,
      languages,
      symbols,
      hasEmbeddings
    };
  }

  /**
   * Clear all indexed data
   */
  clear(): void {
    this.indexedFiles.clear();
    this.bm25Service.clearIndex();
  }
}