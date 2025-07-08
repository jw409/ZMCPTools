import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Logger } from './logger.js';

const logger = new Logger('CrashHandler');

export class CrashHandler {
  private static instance: CrashHandler | null = null;
  private crashLogDir: string;
  private isSetup = false;

  constructor() {
    this.crashLogDir = join(homedir(), '.mcptools', 'logs', 'crashes');
    this.ensureCrashLogDir();
  }

  static getInstance(): CrashHandler {
    if (!CrashHandler.instance) {
      CrashHandler.instance = new CrashHandler();
    }
    return CrashHandler.instance;
  }

  private ensureCrashLogDir(): void {
    try {
      if (!existsSync(this.crashLogDir)) {
        mkdirSync(this.crashLogDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create crash log directory:', error);
    }
  }

  /**
   * Set up global crash handlers for the application
   */
  setupGlobalHandlers(): void {
    if (this.isSetup) {
      return;
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.logCrash('uncaughtException', error, {
        type: 'UncaughtException',
        fatal: true
      });
      
      // Give time for the crash log to be written, then exit
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.logCrash('unhandledRejection', error, {
        type: 'UnhandledRejection',
        fatal: false,
        promise: promise.toString()
      });
    });

    // Handle SIGTERM gracefully
    process.on('SIGTERM', () => {
      this.logShutdown('SIGTERM', 'Graceful shutdown requested');
      process.exit(0);
    });

    // Handle SIGINT gracefully
    process.on('SIGINT', () => {
      this.logShutdown('SIGINT', 'Interrupt signal received');
      process.exit(0);
    });

    // Handle warning events
    process.on('warning', (warning: Error) => {
      this.logWarning(warning);
    });

    this.isSetup = true;
    logger.info('Global crash handlers initialized', {
      crashLogDir: this.crashLogDir
    });
  }

  /**
   * Log a crash with full context information
   */
  logCrash(eventType: string, error: Error, context: Record<string, any> = {}): void {
    const timestamp = new Date().toISOString();
    const crashId = `crash_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const crashData = {
      crashId,
      timestamp,
      eventType,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause
      },
      process: {
        pid: process.pid,
        ppid: process.ppid,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        execPath: process.execPath,
        cwd: process.cwd(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      },
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        MCPTOOLS_DATA_DIR: process.env.MCPTOOLS_DATA_DIR,
        MCP_AGENT_ID: process.env.MCP_AGENT_ID,
        AGENT_ID: process.env.AGENT_ID,
        AGENT_TYPE: process.env.AGENT_TYPE
      },
      context
    };

    try {
      const filename = `${crashId}_${timestamp.replace(/[:.]/g, '-')}.json`;
      const filepath = join(this.crashLogDir, filename);
      
      writeFileSync(filepath, JSON.stringify(crashData, null, 2), 'utf8');
      
      // Also log to console and logger
      console.error(`CRASH LOGGED: ${crashId}`, {
        eventType,
        error: error.message,
        logFile: filepath
      });
      
      logger.error(`Application crash detected`, {
        crashId,
        eventType,
        error: error.message,
        stack: error.stack,
        logFile: filepath
      });
      
    } catch (logError) {
      // Fallback logging if file writing fails
      console.error('Failed to write crash log:', logError);
      console.error('Original crash:', error);
    }
  }

  /**
   * Log graceful shutdowns
   */
  logShutdown(signal: string, reason: string): void {
    const timestamp = new Date().toISOString();
    const shutdownId = `shutdown_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const shutdownData = {
      shutdownId,
      timestamp,
      signal,
      reason,
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      }
    };

    try {
      const filename = `${shutdownId}_${timestamp.replace(/[:.]/g, '-')}.json`;
      const filepath = join(this.crashLogDir, filename);
      
      writeFileSync(filepath, JSON.stringify(shutdownData, null, 2), 'utf8');
      
      logger.info(`Graceful shutdown logged`, {
        shutdownId,
        signal,
        reason,
        logFile: filepath
      });
      
    } catch (error) {
      console.error('Failed to write shutdown log:', error);
    }
  }

  /**
   * Log warnings
   */
  logWarning(warning: Error): void {
    const timestamp = new Date().toISOString();
    
    const warningData = {
      timestamp,
      type: 'warning',
      name: warning.name,
      message: warning.message,
      stack: warning.stack
    };

    try {
      const filename = `warning_${timestamp.replace(/[:.]/g, '-')}.json`;
      const filepath = join(this.crashLogDir, filename);
      
      writeFileSync(filepath, JSON.stringify(warningData, null, 2), 'utf8');
      
      logger.warn(`Process warning logged`, {
        warning: warning.message,
        logFile: filepath
      });
      
    } catch (error) {
      console.error('Failed to write warning log:', error);
    }
  }

  /**
   * Manually log an error with context
   */
  logError(error: Error, context: Record<string, any> = {}): void {
    this.logCrash('manualError', error, {
      ...context,
      manual: true
    });
  }

  /**
   * Get crash log directory path
   */
  getCrashLogDir(): string {
    return this.crashLogDir;
  }
}

/**
 * Utility function to wrap async functions with crash handling
 */
export function withCrashHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context: Record<string, any> = {}
): T {
  return ((...args: any[]) => {
    return fn(...args).catch((error: Error) => {
      const crashHandler = CrashHandler.getInstance();
      crashHandler.logError(error, {
        ...context,
        functionName: fn.name,
        arguments: args.map((arg, index) => ({
          index,
          type: typeof arg,
          value: typeof arg === 'object' ? JSON.stringify(arg).substring(0, 200) : String(arg).substring(0, 200)
        }))
      });
      throw error; // Re-throw to maintain normal error handling
    });
  }) as T;
}

/**
 * Utility function to wrap the main server entrypoint
 */
export function wrapMainServer<T extends (...args: any[]) => Promise<any>>(
  serverFunction: T,
  serverName: string = 'MCPServer'
): T {
  return withCrashHandling(serverFunction, {
    serverName,
    isMainServer: true
  });
}