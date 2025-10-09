#!/usr/bin/env node
/**
 * Log Rotation and Archiving Utility
 *
 * Archives logs older than 7 days to var/harvest/archived_logs/
 * Purges old logs from active directory after archiving
 *
 * Usage:
 *   npm run rotate-logs [--dry-run] [--days=7] [--keep-archives-days=90]
 */

import { readdir, stat, mkdir, copyFile, unlink } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { StoragePathResolver } from '../services/StoragePathResolver.js';

interface RotationStats {
  scanned: number;
  archived: number;
  deleted: number;
  errors: number;
  totalSize: number;
}

async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

async function getFileAge(filePath: string): Promise<number> {
  const stats = await stat(filePath);
  const ageMs = Date.now() - stats.mtime.getTime();
  return Math.floor(ageMs / (1000 * 60 * 60 * 24)); // days
}

async function archiveLog(
  sourcePath: string,
  archiveDir: string,
  dryRun: boolean
): Promise<boolean> {
  try {
    const fileName = basename(sourcePath);
    const targetPath = join(archiveDir, fileName);

    if (!dryRun) {
      await copyFile(sourcePath, targetPath);
      console.log(`  ✓ Archived: ${fileName}`);
    } else {
      console.log(`  [DRY-RUN] Would archive: ${fileName}`);
    }
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to archive ${basename(sourcePath)}:`, error);
    return false;
  }
}

async function deleteLog(filePath: string, dryRun: boolean): Promise<boolean> {
  try {
    const fileName = basename(filePath);
    if (!dryRun) {
      await unlink(filePath);
      console.log(`  ✓ Deleted: ${fileName}`);
    } else {
      console.log(`  [DRY-RUN] Would delete: ${fileName}`);
    }
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to delete ${basename(filePath)}:`, error);
    return false;
  }
}

async function rotateLogs(options: {
  dryRun?: boolean;
  rotationDays?: number;
  archiveRetentionDays?: number;
}): Promise<RotationStats> {
  const dryRun = options.dryRun ?? false;
  const rotationDays = options.rotationDays ?? 7;
  const archiveRetentionDays = options.archiveRetentionDays ?? 90;

  const stats: RotationStats = {
    scanned: 0,
    archived: 0,
    deleted: 0,
    errors: 0,
    totalSize: 0
  };

  console.log('\n=== Log Rotation Started ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'ACTIVE'}`);
  console.log(`Rotation threshold: ${rotationDays} days`);
  console.log(`Archive retention: ${archiveRetentionDays} days\n`);

  // Get paths
  const storageConfig = StoragePathResolver.getStorageConfig({ preferLocal: true });
  const logsBasePath = StoragePathResolver.getLogsPath(storageConfig);
  const archiveBasePath = join(process.cwd(), 'var', 'harvest', 'archived_logs');

  await ensureDirectory(archiveBasePath);

  // Process each log directory
  const logDirs = await readdir(logsBasePath, { withFileTypes: true });

  for (const dir of logDirs) {
    if (!dir.isDirectory()) continue;

    const dirPath = join(logsBasePath, dir.name);
    const archiveDir = join(archiveBasePath, dir.name);

    console.log(`\nProcessing: ${dir.name}/`);
    await ensureDirectory(archiveDir);

    try {
      const files = await readdir(dirPath, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile()) continue;

        const filePath = join(dirPath, file.name);
        stats.scanned++;

        try {
          const fileStat = await stat(filePath);
          const age = await getFileAge(filePath);

          if (age >= rotationDays) {
            stats.totalSize += fileStat.size;

            // Archive the log
            const archived = await archiveLog(filePath, archiveDir, dryRun);
            if (archived) {
              stats.archived++;

              // Delete from active logs
              const deleted = await deleteLog(filePath, dryRun);
              if (deleted) {
                stats.deleted++;
              } else {
                stats.errors++;
              }
            } else {
              stats.errors++;
            }
          }
        } catch (error) {
          console.error(`  ✗ Error processing ${file.name}:`, error);
          stats.errors++;
        }
      }
    } catch (error) {
      console.error(`Failed to process directory ${dir.name}:`, error);
      stats.errors++;
    }
  }

  // Cleanup old archives (optional)
  console.log(`\n\nCleaning up archives older than ${archiveRetentionDays} days...`);
  const archiveDirs = await readdir(archiveBasePath, { withFileTypes: true });

  for (const dir of archiveDirs) {
    if (!dir.isDirectory()) continue;

    const dirPath = join(archiveBasePath, dir.name);
    const files = await readdir(dirPath, { withFileTypes: true });

    for (const file of files) {
      if (!file.isFile()) continue;

      const filePath = join(dirPath, file.name);
      const age = await getFileAge(filePath);

      if (age >= archiveRetentionDays) {
        await deleteLog(filePath, dryRun);
      }
    }
  }

  console.log('\n=== Log Rotation Complete ===');
  console.log(`Scanned: ${stats.scanned} files`);
  console.log(`Archived: ${stats.archived} files`);
  console.log(`Deleted: ${stats.deleted} files`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Total size processed: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\nArchive location: ${archiveBasePath}\n`);

  return stats;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const daysArg = args.find(arg => arg.startsWith('--days='));
  const archiveDaysArg = args.find(arg => arg.startsWith('--keep-archives-days='));

  const rotationDays = daysArg ? parseInt(daysArg.split('=')[1]) : 7;
  const archiveRetentionDays = archiveDaysArg ? parseInt(archiveDaysArg.split('=')[1]) : 90;

  rotateLogs({ dryRun, rotationDays, archiveRetentionDays })
    .then((stats) => {
      process.exit(stats.errors > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Fatal error during log rotation:', error);
      process.exit(1);
    });
}

export { rotateLogs };
