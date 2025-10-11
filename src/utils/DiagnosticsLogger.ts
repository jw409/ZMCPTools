/**
 * Persistent file-based diagnostics logger for MCP tools
 * Implements diagnostics object pattern from CLAUDE.md
 */

import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

export type DiagnosticsLevel = 'info' | 'warn' | 'error';

export interface DiagnosticsEntry {
  timestamp: string;
  level: DiagnosticsLevel;
  message: string;
  logId: string;
  summary: Array<{
    step: string;
    status: string;
    [key: string]: any;
  }>;
  fullDetails?: any;
}

export interface DiagnosticsResponse {
  level: DiagnosticsLevel;
  message: string;
  logId: string;
  summary: Array<{
    step: string;
    status: string;
    [key: string]: any;
  }>;
}

export class DiagnosticsLogger {
  private logDir: string;
  private currentLogId: string | null = null;
  private currentSummary: Array<any> = [];

  constructor(logDir: string = 'var/logs/diagnostics') {
    this.logDir = logDir;
    this.ensureLogDir();
  }

  private ensureLogDir() {
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create diagnostics log directory:', error);
    }
  }

  /**
   * Start a new diagnostic session for a tool call
   */
  startRequest(toolName: string, args: any): string {
    this.currentLogId = `${toolName}-${Date.now()}-${randomBytes(4).toString('hex')}`;
    this.currentSummary = [];

    this.log('info', 'Request started', {
      tool: toolName,
      args: args
    });

    return this.currentLogId;
  }

  /**
   * Add a step to the current request's summary
   */
  addStep(step: string, status: string, metadata?: any) {
    const entry = {
      step,
      status,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    this.currentSummary.push(entry);
    this.log('info', `Step: ${step}`, entry);
  }

  /**
   * Log detailed information without adding to summary (verbose logging)
   */
  log(level: DiagnosticsLevel, message: string, details?: any) {
    if (!this.currentLogId) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      logId: this.currentLogId,
      details
    };

    const logFile = join(this.logDir, `${this.currentLogId}.json`);

    try {
      // Append to log file (read existing, append, write back)
      let existingLogs: any[] = [];
      try {
        const existing = readFileSync(logFile, 'utf-8');
        existingLogs = JSON.parse(existing);
      } catch {
        // File doesn't exist yet, start fresh
      }

      existingLogs.push(logEntry);
      writeFileSync(logFile, JSON.stringify(existingLogs, null, 2));
    } catch (error) {
      console.error(`Failed to write diagnostic log ${logFile}:`, error);
    }
  }

  /**
   * End the current request and generate diagnostics response
   */
  endRequest(level: DiagnosticsLevel, message: string, fullDetails?: any): DiagnosticsResponse | null {
    if (!this.currentLogId) return null;

    this.log(level, message, fullDetails);

    const response: DiagnosticsResponse = {
      level,
      message,
      logId: this.currentLogId,
      summary: this.currentSummary
    };

    // Reset state
    this.currentLogId = null;
    this.currentSummary = [];

    return response;
  }

  /**
   * Search logs by logId
   */
  static searchLogs(logDir: string, query: string): any[] {
    try {
      const files = readdirSync(logDir);
      const matchingFiles = files.filter(f => f.includes(query));

      const results = [];
      for (const file of matchingFiles) {
        try {
          const content = readFileSync(join(logDir, file), 'utf-8');
          results.push({
            logId: file.replace('.json', ''),
            entries: JSON.parse(content)
          });
        } catch (error) {
          console.error(`Failed to read log file ${file}:`, error);
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to search logs:', error);
      return [];
    }
  }

  /**
   * Get recent logs (last N files by timestamp)
   */
  static getRecentLogs(logDir: string, limit: number = 50): any[] {
    try {
      const files = readdirSync(logDir);
      const sortedFiles = files
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, limit);

      const results = [];
      for (const file of sortedFiles) {
        try {
          const content = readFileSync(join(logDir, file), 'utf-8');
          const entries = JSON.parse(content);
          results.push({
            logId: file.replace('.json', ''),
            entries: entries
          });
        } catch (error) {
          console.error(`Failed to read log file ${file}:`, error);
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to get recent logs:', error);
      return [];
    }
  }
}
