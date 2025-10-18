/**
 * Symbols Repository
 * Manages persistent storage of individual code symbols (functions, classes, etc.)
 * using Drizzle ORM with the analysis.ts schema
 */

import { eq, and, inArray } from 'drizzle-orm';
import { Logger } from '../utils/logger.js';
import { symbols, type Symbol, type NewSymbol } from '../schemas/analysis.js';

const logger = new Logger('symbols-repository');

export interface SymbolData {
  filePath: string;
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'enum';
  line?: number;
  column?: number;
  isExported?: boolean;
  accessibility?: 'public' | 'private' | 'protected';
  signature?: string;    // For SymbolGraphIndexer compatibility
  location?: string;     // For SymbolGraphIndexer compatibility (e.g., "0:0-10:5")
  parentSymbol?: string; // For SymbolGraphIndexer compatibility
}

export class SymbolsRepository {
  constructor(private db: any) {}

  /**
   * Insert symbols for a file (replaces existing symbols for that file)
   */
  async upsertSymbolsForFile(filePath: string, symbolsData: SymbolData[]): Promise<void> {
    if (symbolsData.length === 0) {
      logger.debug('No symbols to upsert', { filePath });
      return;
    }

    this.db.transaction((tx: any) => {
      // Delete existing symbols for this file
      tx.delete(symbols).where(eq(symbols.filePath, filePath)).run();

      // Insert new symbols
      const symbolRecords: NewSymbol[] = symbolsData.map(s => ({
        filePath: s.filePath,
        name: s.name,
        type: s.type,
        line: s.line ?? 0,
        column: s.column ?? 0,
        isExported: s.isExported ?? false,
        accessibility: s.accessibility,
        contextId: null, // SymbolGraphIndexer doesn't use context
      }));

      if (symbolRecords.length > 0) {
        tx.insert(symbols).values(symbolRecords).run();
      }

      logger.debug('Symbols upserted', {
        filePath,
        count: symbolRecords.length
      });
    });
  }

  /**
   * Get all symbols for a file
   */
  async getSymbolsForFile(filePath: string): Promise<SymbolData[]> {
    const results = await this.db
      .select()
      .from(symbols)
      .where(eq(symbols.filePath, filePath));

    return results.map(r => ({
      filePath: r.filePath,
      name: r.name,
      type: r.type as any,
      line: r.line,
      column: r.column,
      isExported: r.isExported,
      accessibility: r.accessibility as any,
    }));
  }

  /**
   * Delete symbols for a file
   */
  async deleteSymbolsForFile(filePath: string): Promise<void> {
    await this.db.delete(symbols).where(eq(symbols.filePath, filePath));
    logger.debug('Symbols deleted', { filePath });
  }

  /**
   * Find symbols by name across all files
   */
  async findSymbolsByName(name: string): Promise<SymbolData[]> {
    const results = await this.db
      .select()
      .from(symbols)
      .where(eq(symbols.name, name));

    return results.map(r => ({
      filePath: r.filePath,
      name: r.name,
      type: r.type as any,
      line: r.line,
      column: r.column,
      isExported: r.isExported,
      accessibility: r.accessibility as any,
    }));
  }

  /**
   * Get all symbols of a specific type
   */
  async getSymbolsByType(type: SymbolData['type']): Promise<SymbolData[]> {
    const results = await this.db
      .select()
      .from(symbols)
      .where(eq(symbols.type, type));

    return results.map(r => ({
      filePath: r.filePath,
      name: r.name,
      type: r.type as any,
      line: r.line,
      column: r.column,
      isExported: r.isExported,
      accessibility: r.accessibility as any,
    }));
  }

  /**
   * Count total symbols in the database
   */
  async countSymbols(): Promise<number> {
    const result = await this.db
      .select({ count: symbols.id })
      .from(symbols);

    return result.length;
  }
}
