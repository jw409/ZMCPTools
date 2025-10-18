/**
 * Imports/Exports Repository
 * Manages persistent storage of import and export relationships
 * using Drizzle ORM with the analysis.ts schema
 */

import { eq, and } from 'drizzle-orm';
import { Logger } from '../utils/logger.js';
import { importsExports, type ImportsExport, type NewImportsExport } from '../schemas/analysis.js';

const logger = new Logger('imports-exports-repository');

export interface ImportData {
  filePath: string;        // Maps to source_file in raw SQL
  modulePath: string;      // Maps to import_path in raw SQL
  symbolName?: string;     // Maps to imported_name in raw SQL
  isDefault: boolean;
}

export interface ExportData {
  filePath: string;
  symbolName: string;
  isDefault: boolean;
}

export class ImportsExportsRepository {
  constructor(private db: any) {}

  /**
   * Insert imports for a file (replaces existing imports for that file)
   */
  async upsertImportsForFile(filePath: string, imports: ImportData[]): Promise<void> {
    if (imports.length === 0) {
      logger.debug('No imports to upsert', { filePath });
      return;
    }

    this.db.transaction((tx: any) => {
      // Delete existing imports for this file
      tx
        .delete(importsExports)
        .where(
          and(
            eq(importsExports.filePath, filePath),
            eq(importsExports.type, 'import')
          )
        )
        .run();

      // Insert new imports
      const importRecords: NewImportsExport[] = imports.map(i => ({
        filePath: i.filePath,
        type: 'import' as const,
        symbolName: i.symbolName ?? null,
        modulePath: i.modulePath,
        isDefault: i.isDefault,
        contextId: null,
      }));

      if (importRecords.length > 0) {
        tx.insert(importsExports).values(importRecords).run();
      }

      logger.debug('Imports upserted', {
        filePath,
        count: importRecords.length
      });
    });
  }

  /**
   * Insert exports for a file (replaces existing exports for that file)
   */
  async upsertExportsForFile(filePath: string, exports: ExportData[]): Promise<void> {
    if (exports.length === 0) {
      logger.debug('No exports to upsert', { filePath });
      return;
    }

    this.db.transaction((tx: any) => {
      // Delete existing exports for this file
      tx
        .delete(importsExports)
        .where(
          and(
            eq(importsExports.filePath, filePath),
            eq(importsExports.type, 'export')
          )
        )
        .run();

      // Insert new exports
      const exportRecords: NewImportsExport[] = exports.map(e => ({
        filePath: e.filePath,
        type: 'export' as const,
        symbolName: e.symbolName,
        modulePath: null,
        isDefault: e.isDefault,
        contextId: null,
      }));

      if (exportRecords.length > 0) {
        tx.insert(importsExports).values(exportRecords).run();
      }

      logger.debug('Exports upserted', {
        filePath,
        count: exportRecords.length
      });
    });
  }

  /**
   * Get all imports for a file
   */
  async getImportsForFile(filePath: string): Promise<ImportData[]> {
    const results = await this.db
      .select()
      .from(importsExports)
      .where(
        and(
          eq(importsExports.filePath, filePath),
          eq(importsExports.type, 'import')
        )
      );

    return results.map(r => ({
      filePath: r.filePath,
      modulePath: r.modulePath!,
      symbolName: r.symbolName ?? undefined,
      isDefault: r.isDefault,
    }));
  }

  /**
   * Get all exports for a file
   */
  async getExportsForFile(filePath: string): Promise<ExportData[]> {
    const results = await this.db
      .select()
      .from(importsExports)
      .where(
        and(
          eq(importsExports.filePath, filePath),
          eq(importsExports.type, 'export')
        )
      );

    return results.map(r => ({
      filePath: r.filePath,
      symbolName: r.symbolName!,
      isDefault: r.isDefault,
    }));
  }

  /**
   * Delete all imports/exports for a file
   */
  async deleteForFile(filePath: string): Promise<void> {
    await this.db.delete(importsExports).where(eq(importsExports.filePath, filePath));
    logger.debug('Imports/exports deleted', { filePath });
  }

  /**
   * Find all files that import a specific module
   */
  async findFilesImporting(modulePath: string): Promise<string[]> {
    const results = await this.db
      .select({ filePath: importsExports.filePath })
      .from(importsExports)
      .where(
        and(
          eq(importsExports.type, 'import'),
          eq(importsExports.modulePath, modulePath)
        )
      );

    return [...new Set(results.map(r => r.filePath))];
  }

  /**
   * Count total imports in the database
   */
  async countImports(): Promise<number> {
    const result = await this.db
      .select({ count: importsExports.id })
      .from(importsExports)
      .where(eq(importsExports.type, 'import'));

    return result.length;
  }
}
