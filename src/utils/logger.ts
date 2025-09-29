import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { StoragePathResolver } from '../services/StoragePathResolver.js';

export class Logger {
  private logDir: string;
  private category: string;

  constructor(category: string) {
    this.category = category;

    // Use StoragePathResolver for project-local support
    const storageConfig = StoragePathResolver.getStorageConfig({ preferLocal: true });
    const basePath = StoragePathResolver.getBaseStoragePath(storageConfig);
    this.logDir = join(basePath, 'logs', category);

    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getLogFileName(): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit'
    }).replace(/\//g, '-');
    const timeStr = now.toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit'
    }).replace(/[:\s]/g, '').toLowerCase();
    
    return `log_${dateStr}_${timeStr}.txt`;
  }

  private formatLogEntry(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (data) {
      return `${entry}\nData: ${JSON.stringify(data, null, 2)}\n---\n`;
    }
    return `${entry}\n`;
  }

  error(message: string, data?: any): void {
    const logEntry = this.formatLogEntry('ERROR', message, data);
    this.writeLog(logEntry);
    // Use stderr for console output to avoid interfering with MCP stdio transport
    process.stderr.write(`[${this.category}] ERROR: ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`);
  }

  warn(message: string, data?: any): void {
    const logEntry = this.formatLogEntry('WARN', message, data);
    this.writeLog(logEntry);
    // Use stderr for console output to avoid interfering with MCP stdio transport
    process.stderr.write(`[${this.category}] WARN: ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`);
  }

  info(message: string, data?: any): void {
    const logEntry = this.formatLogEntry('INFO', message, data);
    this.writeLog(logEntry);
    // Only output INFO to stderr in debug mode
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG || process.env.VERBOSE_LOGGING) {
      process.stderr.write(`[${this.category}] INFO: ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`);
    }
  }

  debug(message: string, data?: any): void {
    const logEntry = this.formatLogEntry('DEBUG', message, data);
    this.writeLog(logEntry);
    // Only console.log debug in debug mode
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      // Use stderr for console output to avoid interfering with MCP stdio transport
      process.stderr.write(`[${this.category}] DEBUG: ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`);
    }
  }

  private writeLog(entry: string): void {
    try {
      const logFile = join(this.logDir, this.getLogFileName());
      writeFileSync(logFile, entry, { flag: 'a' });
    } catch (error) {
      process.stderr.write(`Failed to write log entry: ${error}\n`);
    }
  }
}