/**
 * Semantic Chunker for Large Documents
 *
 * Implements intelligent chunking with:
 * - Target chunk size: 1800 tokens (88% of 2048 limit)
 * - Proportional overlap: 10% of chunk size (~180 tokens)
 * - Content-aware boundaries (functions, classes, sections)
 * - Trust-but-verify token counting protocol
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('semantic-chunker');

export interface ChunkMetadata {
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  level: number;  // 0=document, 1=content chunks, 2=group summaries
  title: string;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
  contentHash: string;
  parentId?: string;
}

export interface Chunk {
  text: string;
  metadata: ChunkMetadata;
}

export interface ChunkerConfig {
  targetTokens: number;      // Target chunk size (default: 1800)
  overlapPercentage: number; // Overlap as % of chunk size (default: 0.10)
  tokenLimit: number;        // Hard limit (default: 2048)
  embeddingServiceUrl: string;
  model: string;
}

export interface SemanticBoundary {
  offset: number;
  type: 'function' | 'class' | 'section' | 'paragraph' | 'sentence';
  score: number;  // Higher = better boundary
}

/**
 * Semantic Chunker with proportional overlap
 */
export class SemanticChunker {
  private config: ChunkerConfig;

  constructor(config?: Partial<ChunkerConfig>) {
    this.config = {
      targetTokens: 1800,
      overlapPercentage: 0.10,
      tokenLimit: 2048,
      embeddingServiceUrl: 'http://localhost:8765',
      model: 'gemma_embed',
      ...config
    };
  }

  /**
   * Count tokens using embedding service (trust-but-verify protocol)
   */
  private async countTokens(text: string): Promise<number> {
    try {
      const response = await fetch(
        `${this.config.embeddingServiceUrl}/count_tokens`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            model: this.config.model
          }),
          signal: AbortSignal.timeout(10000)
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.token_count;
    } catch (error: any) {
      logger.error('Token counting failed:', error.message);
      throw new Error(`Token counting failed: ${error.message}`);
    }
  }

  /**
   * Generate title for an entity
   */
  generateTitle(
    repositoryPath: string,
    entityType: string,
    name: string,
    properties?: Record<string, any>
  ): string {
    const repoName = repositoryPath.split('/').pop() || 'Unknown';

    switch (entityType) {
      case 'file':
        const relativePath = properties?.relativePath || name;
        // Check if path is too long
        if (relativePath.length > 80) {
          const filename = relativePath.split('/').pop();
          return `${repoName}: .../${filename}`;
        }
        return `${repoName}: ${relativePath}`;

      case 'class':
      case 'function':
        return `${repoName}: ${entityType} ${name}`;

      default:
        // For other types, use name directly
        if (name.length > 80) {
          return `${repoName}: ${name.substring(0, 77)}...`;
        }
        return `${repoName}: ${name}`;
    }
  }

  /**
   * Find semantic boundaries in text
   */
  private findSemanticBoundaries(text: string, language?: string): SemanticBoundary[] {
    const boundaries: SemanticBoundary[] = [];

    // Code boundaries (TypeScript, JavaScript, Python, etc.)
    if (language && ['typescript', 'javascript', 'python', 'java', 'cpp', 'rust'].includes(language)) {
      // Function definitions
      const functionPatterns = [
        /\n(export\s+)?(async\s+)?function\s+\w+/g,  // JS/TS functions
        /\n(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/g,  // Arrow functions
        /\n(async\s+)?\w+\s*\([^)]*\)\s*{/g,  // Method definitions
        /\ndef\s+\w+/g,  // Python functions
        /\nclass\s+\w+/g,  // Class definitions
      ];

      for (const pattern of functionPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          boundaries.push({
            offset: match.index,
            type: 'function',
            score: 1.0
          });
        }
      }
    }

    // Markdown boundaries
    if (language === 'markdown' || !language) {
      // Headings
      const headingPattern = /\n#{1,6}\s+.+/g;
      let match;
      while ((match = headingPattern.exec(text)) !== null) {
        const level = (match[0].match(/^#+/) || [''])[0].length;
        boundaries.push({
          offset: match.index,
          type: 'section',
          score: 1.2 - (level * 0.1)  // Higher level headings = better boundaries
        });
      }

      // Paragraph breaks (double newline)
      const paragraphPattern = /\n\n/g;
      while ((match = paragraphPattern.exec(text)) !== null) {
        boundaries.push({
          offset: match.index,
          type: 'paragraph',
          score: 0.5
        });
      }
    }

    // Sentence boundaries (fallback)
    const sentencePattern = /[.!?]\s+/g;
    let match;
    while ((match = sentencePattern.exec(text)) !== null) {
      boundaries.push({
        offset: match.index + match[0].length,
        type: 'sentence',
        score: 0.3
      });
    }

    // Sort by offset
    boundaries.sort((a, b) => a.offset - b.offset);

    return boundaries;
  }

  /**
   * Find best boundary near target offset
   */
  private findBestBoundary(
    boundaries: SemanticBoundary[],
    targetOffset: number,
    searchWindow: number = 200
  ): number {
    // Find boundaries within search window of target
    const candidates = boundaries.filter(b =>
      Math.abs(b.offset - targetOffset) <= searchWindow
    );

    if (candidates.length === 0) {
      return targetOffset;
    }

    // Score candidates based on boundary quality and distance from target
    const scored = candidates.map(b => ({
      offset: b.offset,
      score: b.score - (Math.abs(b.offset - targetOffset) / searchWindow) * 0.5
    }));

    // Return best boundary
    scored.sort((a, b) => b.score - a.score);
    return scored[0].offset;
  }

  /**
   * Chunk large document with proportional overlap
   */
  async chunkDocument(
    documentId: string,
    text: string,
    title: string,
    language?: string
  ): Promise<Chunk[]> {
    logger.info('Starting document chunking', {
      documentId,
      textLength: text.length,
      title,
      targetTokens: this.config.targetTokens,
      overlapPercentage: this.config.overlapPercentage
    });

    // Check if document fits in single chunk
    const totalTokens = await this.countTokens(text);
    if (totalTokens <= this.config.targetTokens) {
      logger.info('Document fits in single chunk', { totalTokens });
      return [{
        text,
        metadata: {
          documentId,
          chunkId: `${documentId}-0`,
          chunkIndex: 0,
          level: 1,
          title,
          startOffset: 0,
          endOffset: text.length,
          tokenCount: totalTokens,
          contentHash: this.hashContent(text)
        }
      }];
    }

    // Find semantic boundaries
    const boundaries = this.findSemanticBoundaries(text, language);
    logger.info('Found semantic boundaries', { count: boundaries.length });

    const chunks: Chunk[] = [];
    let currentOffset = 0;
    let chunkIndex = 0;

    // Calculate overlap tokens (10% of target chunk size)
    const overlapTokens = Math.floor(this.config.targetTokens * this.config.overlapPercentage);

    logger.info('Chunking parameters', {
      targetTokens: this.config.targetTokens,
      overlapTokens,
      overlapPercentage: this.config.overlapPercentage
    });

    while (currentOffset < text.length) {
      // Check if remaining text is small enough to be the final chunk
      const remaining = text.length - currentOffset;
      const minMeaningfulChars = Math.floor(this.config.targetTokens * 4 * 0.5); // At least 50% of target size

      if (chunkIndex > 0 && remaining <= minMeaningfulChars) {
        // Remaining text is small - add to final chunk
        const finalChunkText = text.substring(currentOffset);
        const finalTokens = await this.countTokens(finalChunkText);

        // Only create this chunk if it has meaningful content
        if (finalTokens > 0) {
          chunks.push({
            text: finalChunkText,
            metadata: {
              documentId,
              chunkId: `${documentId}-${chunkIndex}`,
              chunkIndex,
              level: 1,
              title: `${title} (part ${chunkIndex + 1})`,
              startOffset: currentOffset,
              endOffset: text.length,
              tokenCount: finalTokens,
              contentHash: this.hashContent(finalChunkText)
            }
          });
        }
        break;
      }

      // Estimate characters for target tokens (rough: 4 chars per token)
      const estimatedChars = this.config.targetTokens * 4;
      let endOffset = Math.min(currentOffset + estimatedChars, text.length);

      // Find best semantic boundary near estimated end
      if (endOffset < text.length && boundaries.length > 0) {
        endOffset = this.findBestBoundary(boundaries, endOffset);
      }

      // Extract chunk text
      const chunkText = text.substring(currentOffset, endOffset);

      // Verify token count
      const actualTokens = await this.countTokens(chunkText);

      // If too large, binary search for right boundary
      if (actualTokens > this.config.tokenLimit) {
        logger.warn('Chunk exceeded limit, performing binary search', {
          chunkIndex,
          actualTokens,
          limit: this.config.tokenLimit
        });

        let low = currentOffset;
        let high = endOffset;
        let bestEnd = currentOffset;

        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const testText = text.substring(currentOffset, mid);
          const testTokens = await this.countTokens(testText);

          if (testTokens <= this.config.targetTokens) {
            bestEnd = mid;
            low = mid + 1;
          } else {
            high = mid;
          }
        }

        endOffset = bestEnd;
        const finalChunkText = text.substring(currentOffset, endOffset);
        const finalTokens = await this.countTokens(finalChunkText);

        chunks.push({
          text: finalChunkText,
          metadata: {
            documentId,
            chunkId: `${documentId}-${chunkIndex}`,
            chunkIndex,
            level: 1,
            title: chunkIndex === 0 ? title : `${title} (part ${chunkIndex + 1})`,
            startOffset: currentOffset,
            endOffset,
            tokenCount: finalTokens,
            contentHash: this.hashContent(finalChunkText)
          }
        });
      } else {
        // Chunk is within limits
        chunks.push({
          text: chunkText,
          metadata: {
            documentId,
            chunkId: `${documentId}-${chunkIndex}`,
            chunkIndex,
            level: 1,
            title: chunkIndex === 0 ? title : `${title} (part ${chunkIndex + 1})`,
            startOffset: currentOffset,
            endOffset,
            tokenCount: actualTokens,
            contentHash: this.hashContent(chunkText)
          }
        });
      }

      // Move to next chunk with proportional overlap
      // Next chunk starts at: current_end - overlap_tokens_in_chars
      const overlapChars = Math.floor(overlapTokens * 4); // Rough estimate
      currentOffset = Math.max(currentOffset + 1, endOffset - overlapChars);

      chunkIndex++;

      // Safety check
      if (chunkIndex > 1000) {
        throw new Error('Too many chunks generated - possible infinite loop');
      }
    }

    logger.info('Chunking complete', {
      documentId,
      totalChunks: chunks.length,
      avgTokensPerChunk: chunks.reduce((sum, c) => sum + c.metadata.tokenCount, 0) / chunks.length
    });

    return chunks;
  }

  /**
   * Simple content hash for change detection
   */
  private hashContent(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Get chunk statistics
   */
  getChunkStats(chunks: Chunk[]): {
    totalChunks: number;
    avgTokens: number;
    minTokens: number;
    maxTokens: number;
    totalTokens: number;
    avgOverlapTokens: number;
  } {
    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        avgTokens: 0,
        minTokens: 0,
        maxTokens: 0,
        totalTokens: 0,
        avgOverlapTokens: 0
      };
    }

    const tokenCounts = chunks.map(c => c.metadata.tokenCount);
    const totalTokens = tokenCounts.reduce((sum, t) => sum + t, 0);

    // Calculate average overlap (tokens in chunk N that overlap with chunk N-1)
    let totalOverlap = 0;
    for (let i = 1; i < chunks.length; i++) {
      const prevEnd = chunks[i - 1].metadata.endOffset;
      const currentStart = chunks[i].metadata.startOffset;
      if (prevEnd > currentStart) {
        // Estimate overlap tokens (rough)
        const overlapChars = prevEnd - currentStart;
        totalOverlap += Math.floor(overlapChars / 4);
      }
    }

    return {
      totalChunks: chunks.length,
      avgTokens: totalTokens / chunks.length,
      minTokens: Math.min(...tokenCounts),
      maxTokens: Math.max(...tokenCounts),
      totalTokens,
      avgOverlapTokens: chunks.length > 1 ? totalOverlap / (chunks.length - 1) : 0
    };
  }
}
