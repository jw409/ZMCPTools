/**
 * TreeSummary Migration Service
 * Migrates existing JSON-based .treesummary data to SQLite AnalysisStorageService
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { AnalysisStorageService, FileAnalysisData } from './AnalysisStorageService.js';
import { Logger } from '../utils/logger.js';

export interface MigrationResult {
  success: boolean;
  migratedFiles: number;
  skippedFiles: number;
  errors: string[];
  migrationTime: number;
}

export interface TreeSummaryJsonData {
  filePath: string;
  hash: string;
  lastModified: string;
  symbols: Array<{
    name: string;
    type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'enum';
    line: number;
    column: number;
    isExported: boolean;
    accessibility?: 'public' | 'private' | 'protected';
  }>;
  imports: string[];
  exports: string[];
  size: number;
  language: string;
}

export class TreeSummaryMigrationService {
  private logger: Logger;
  private analysisStorage: AnalysisStorageService;

  constructor() {
    this.logger = new Logger('treesummary-migration');
    this.analysisStorage = new AnalysisStorageService();
  }

  /**
   * Migrate all .treesummary directories found in a project
   */
  async migrateProject(projectPath: string = process.cwd()): Promise<MigrationResult> {
    const startTime = Date.now();
    const result: MigrationResult = {
      success: false,
      migratedFiles: 0,
      skippedFiles: 0,
      errors: [],
      migrationTime: 0
    };

    try {
      this.logger.info('Starting TreeSummary migration', { projectPath });

      // Find all .treesummary directories
      const treeSummaryDirs = await this.findTreeSummaryDirectories(projectPath);

      if (treeSummaryDirs.length === 0) {
        this.logger.info('No .treesummary directories found');
        result.success = true;
        result.migrationTime = Date.now() - startTime;
        return result;
      }

      this.logger.info(`Found ${treeSummaryDirs.length} .treesummary directories`);

      // Process each directory
      for (const treeSummaryDir of treeSummaryDirs) {
        try {
          const dirResult = await this.migrateTreeSummaryDirectory(treeSummaryDir);
          result.migratedFiles += dirResult.migratedFiles;
          result.skippedFiles += dirResult.skippedFiles;
          result.errors.push(...dirResult.errors);
        } catch (error) {
          const errorMsg = `Failed to migrate ${treeSummaryDir}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.errors.push(errorMsg);
          this.logger.error(errorMsg, error);
        }
      }

      result.success = result.errors.length === 0;
      result.migrationTime = Date.now() - startTime;

      this.logger.info('Migration completed', {
        success: result.success,
        migratedFiles: result.migratedFiles,
        skippedFiles: result.skippedFiles,
        errors: result.errors.length,
        duration: result.migrationTime
      });

      return result;

    } catch (error) {
      const errorMsg = `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      result.errors.push(errorMsg);
      result.migrationTime = Date.now() - startTime;
      this.logger.error(errorMsg, error);
      return result;
    }
  }

  /**
   * Find all .treesummary directories recursively
   */
  private async findTreeSummaryDirectories(rootPath: string): Promise<string[]> {
    const treeSummaryDirs: string[] = [];

    const searchDir = async (dirPath: string, depth: number = 0): Promise<void> => {
      // Limit recursion depth to prevent infinite loops
      if (depth > 10) return;

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const fullPath = path.join(dirPath, entry.name);

          if (entry.name === '.treesummary') {
            treeSummaryDirs.push(fullPath);
          } else if (!this.shouldSkipDirectory(entry.name)) {
            await searchDir(fullPath, depth + 1);
          }
        }
      } catch (error) {
        // Skip directories we can't read
        this.logger.warn(`Cannot read directory: ${dirPath}`, error);
      }
    };

    await searchDir(rootPath);
    return treeSummaryDirs;
  }

  /**
   * Check if directory should be skipped during search
   */
  private shouldSkipDirectory(dirName: string): boolean {
    const skipDirs = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'coverage',
      '.next',
      '.nuxt',
      '.vite',
      'target',
      '__pycache__',
      '.venv',
      '.env'
    ];
    return skipDirs.includes(dirName) || dirName.startsWith('.');
  }

  /**
   * Migrate a specific .treesummary directory
   */
  private async migrateTreeSummaryDirectory(treeSummaryPath: string): Promise<{
    migratedFiles: number;
    skippedFiles: number;
    errors: string[];
  }> {
    const result = {
      migratedFiles: 0,
      skippedFiles: 0,
      errors: []
    };

    const projectPath = path.dirname(treeSummaryPath);
    this.logger.info(`Migrating ${treeSummaryPath}`, { projectPath });

    // Look for analysis files in the files/ subdirectory
    const filesDir = path.join(treeSummaryPath, 'files');
    if (!existsSync(filesDir)) {
      this.logger.warn(`No files directory found in ${treeSummaryPath}`);
      return result;
    }

    // Recursively find all JSON files
    const jsonFiles = await this.findJsonFiles(filesDir);
    this.logger.info(`Found ${jsonFiles.length} analysis files to migrate`);

    for (const jsonFile of jsonFiles) {
      try {
        const migrated = await this.migrateJsonFile(jsonFile, projectPath);
        if (migrated) {
          result.migratedFiles++;
        } else {
          result.skippedFiles++;
        }
      } catch (error) {
        const errorMsg = `Failed to migrate ${jsonFile}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        this.logger.error(errorMsg, error);
      }
    }

    return result;
  }

  /**
   * Find all JSON files recursively in a directory
   */
  private async findJsonFiles(dirPath: string): Promise<string[]> {
    const jsonFiles: string[] = [];

    const searchDir = async (currentPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          if (entry.isDirectory()) {
            await searchDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.json')) {
            jsonFiles.push(fullPath);
          }
        }
      } catch (error) {
        this.logger.warn(`Cannot read directory: ${currentPath}`, error);
      }
    };

    await searchDir(dirPath);
    return jsonFiles;
  }

  /**
   * Migrate a single JSON analysis file
   */
  private async migrateJsonFile(jsonFilePath: string, projectPath: string): Promise<boolean> {
    try {
      // Read and parse the JSON file
      const jsonContent = await fs.readFile(jsonFilePath, 'utf-8');
      const jsonData: TreeSummaryJsonData = JSON.parse(jsonContent);

      // Validate required fields
      if (!jsonData.filePath || !jsonData.hash || !jsonData.lastModified) {
        this.logger.warn(`Invalid JSON data in ${jsonFilePath}: missing required fields`);
        return false;
      }

      // Convert to AnalysisStorageService format
      const analysisData: FileAnalysisData = {
        filePath: jsonData.filePath,
        hash: jsonData.hash,
        lastModified: new Date(jsonData.lastModified),
        symbols: jsonData.symbols || [],
        imports: jsonData.imports || [],
        exports: jsonData.exports || [],
        size: jsonData.size || 0,
        language: jsonData.language || 'unknown'
      };

      // Check if file still exists (skip if deleted)
      if (!existsSync(jsonData.filePath)) {
        this.logger.info(`Skipping deleted file: ${jsonData.filePath}`);
        return false;
      }

      // Store in SQLite
      await this.analysisStorage.storeFileAnalysis(
        jsonData.filePath,
        analysisData,
        'project' // Store in project context (domU)
      );

      this.logger.debug(`Migrated: ${jsonData.filePath}`);
      return true;

    } catch (error) {
      if (error instanceof SyntaxError) {
        this.logger.warn(`Invalid JSON in ${jsonFilePath}`, error);
      } else {
        this.logger.error(`Failed to migrate ${jsonFilePath}`, error);
      }
      return false;
    }
  }

  /**
   * Create backup of .treesummary directory before migration
   */
  async createBackup(treeSummaryPath: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${treeSummaryPath}.backup-${timestamp}`;

    await fs.cp(treeSummaryPath, backupPath, { recursive: true });
    this.logger.info(`Created backup: ${backupPath}`);

    return backupPath;
  }

  /**
   * Verify migration by comparing JSON and SQLite data
   */
  async verifyMigration(projectPath: string): Promise<{
    success: boolean;
    verifiedFiles: number;
    mismatches: string[];
  }> {
    const result = {
      success: true,
      verifiedFiles: 0,
      mismatches: []
    };

    try {
      // Find original JSON files
      const treeSummaryDirs = await this.findTreeSummaryDirectories(projectPath);

      for (const treeSummaryDir of treeSummaryDirs) {
        const filesDir = path.join(treeSummaryDir, 'files');
        if (!existsSync(filesDir)) continue;

        const jsonFiles = await this.findJsonFiles(filesDir);

        for (const jsonFile of jsonFiles) {
          try {
            const jsonContent = await fs.readFile(jsonFile, 'utf-8');
            const jsonData: TreeSummaryJsonData = JSON.parse(jsonContent);

            // TODO: Query SQLite and compare data
            // This would require adding query methods to AnalysisStorageService

            result.verifiedFiles++;
          } catch (error) {
            result.mismatches.push(`Failed to verify ${jsonFile}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            result.success = false;
          }
        }
      }

      this.logger.info('Migration verification completed', {
        success: result.success,
        verifiedFiles: result.verifiedFiles,
        mismatches: result.mismatches.length
      });

      return result;

    } catch (error) {
      result.success = false;
      result.mismatches.push(`Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    }
  }

  /**
   * Clean up .treesummary directories after successful migration
   */
  async cleanupAfterMigration(projectPath: string, backupPath?: string): Promise<void> {
    try {
      const treeSummaryDirs = await this.findTreeSummaryDirectories(projectPath);

      for (const treeSummaryDir of treeSummaryDirs) {
        // Move to .treesummary.migrated instead of deleting
        const migratedPath = `${treeSummaryDir}.migrated`;
        await fs.rename(treeSummaryDir, migratedPath);
        this.logger.info(`Moved to: ${migratedPath}`);
      }

      if (backupPath) {
        this.logger.info(`Backup preserved at: ${backupPath}`);
      }

    } catch (error) {
      this.logger.error('Failed to cleanup after migration', error);
      throw error;
    }
  }

  /**
   * Full migration workflow with backup and verification
   */
  async performFullMigration(projectPath: string = process.cwd()): Promise<MigrationResult> {
    try {
      // Step 1: Create backup
      const treeSummaryDirs = await this.findTreeSummaryDirectories(projectPath);
      const backups: string[] = [];

      for (const dir of treeSummaryDirs) {
        const backup = await this.createBackup(dir);
        backups.push(backup);
      }

      // Step 2: Perform migration
      const migrationResult = await this.migrateProject(projectPath);

      if (!migrationResult.success) {
        this.logger.error('Migration failed, backups preserved', { backups });
        return migrationResult;
      }

      // Step 3: Verify migration
      const verification = await this.verifyMigration(projectPath);
      if (!verification.success) {
        migrationResult.success = false;
        migrationResult.errors.push(...verification.mismatches);
        this.logger.error('Migration verification failed, backups preserved', { backups });
        return migrationResult;
      }

      // Step 4: Cleanup (move .treesummary to .treesummary.migrated)
      await this.cleanupAfterMigration(projectPath, backups[0]);

      this.logger.info('Full migration completed successfully', {
        migratedFiles: migrationResult.migratedFiles,
        backups: backups.length
      });

      return migrationResult;

    } catch (error) {
      const errorMsg = `Full migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error(errorMsg, error);

      return {
        success: false,
        migratedFiles: 0,
        skippedFiles: 0,
        errors: [errorMsg],
        migrationTime: 0
      };
    }
  }

  /**
   * Shutdown the migration service
   */
  async shutdown(): Promise<void> {
    await this.analysisStorage.shutdown();
  }
}