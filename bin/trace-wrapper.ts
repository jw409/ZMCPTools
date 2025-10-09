#!/usr/bin/env node
/**
 * Call Tracer for TypeScript/Node.js
 *
 * File-based function call tracing that works in MCP server context.
 * MCP uses stdio for protocol, so stdout/stderr cannot be used for logging.
 *
 * Usage:
 *   import { CallTracer } from './bin/trace-wrapper';
 *   const tracer = new CallTracer('/tmp/trace.jsonl');
 *   const tracedFn = tracer.wrap(myFunction, 'myFunction');
 *
 * Or programmatically:
 *   TRACE_ENABLED=1 npm start
 */

import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

export interface TraceEntry {
  timestamp: number;
  relativeTime: number;
  event: 'enter' | 'return' | 'throw';
  function: string;
  callId: string;
  data?: any;
  stack?: string[];
  asyncContext?: string;
}

export class CallTracer {
  private traceFile: string;
  private startTime: number;
  private enabled: boolean;
  private maxDataSize: number = 1000; // Truncate large objects

  constructor(
    outputPath: string = process.env.TRACE_FILE || '/tmp/zmcp-trace.jsonl',
    enabled: boolean = process.env.TRACE_ENABLED === '1'
  ) {
    this.traceFile = outputPath;
    this.startTime = performance.now();
    this.enabled = enabled;

    if (this.enabled) {
      // Ensure directory exists
      const dir = path.dirname(this.traceFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Initialize trace file with metadata
      const metadata = {
        event: 'trace_start',
        timestamp: Date.now(),
        pid: process.pid,
        cwd: process.cwd(),
        node_version: process.version
      };
      fs.writeFileSync(this.traceFile, JSON.stringify(metadata) + '\n');
    }
  }

  /**
   * Wrap a function with tracing instrumentation.
   * Handles both sync and async functions correctly.
   */
  wrap<T extends (...args: any[]) => any>(fn: T, name?: string): T {
    if (!this.enabled) {
      return fn;
    }

    const functionName = name || fn.name || '<anonymous>';
    const tracer = this;

    return function wrappedFunction(this: any, ...args: any[]): any {
      const callId = tracer.generateCallId();
      const stack = tracer.captureStack();

      tracer.log({
        timestamp: Date.now(),
        relativeTime: performance.now() - tracer.startTime,
        event: 'enter',
        function: functionName,
        callId,
        data: tracer.serializeArgs(args),
        stack
      });

      try {
        const result = fn.apply(this, args);

        // Handle async functions/promises
        if (result && typeof result.then === 'function') {
          return result.then(
            (value: any) => {
              tracer.log({
                timestamp: Date.now(),
                relativeTime: performance.now() - tracer.startTime,
                event: 'return',
                function: functionName,
                callId,
                data: tracer.serialize(value)
              });
              return value;
            },
            (error: any) => {
              tracer.log({
                timestamp: Date.now(),
                relativeTime: performance.now() - tracer.startTime,
                event: 'throw',
                function: functionName,
                callId,
                data: tracer.serializeError(error)
              });
              throw error;
            }
          );
        }

        // Sync function
        tracer.log({
          timestamp: Date.now(),
          relativeTime: performance.now() - tracer.startTime,
          event: 'return',
          function: functionName,
          callId,
          data: tracer.serialize(result)
        });

        return result;
      } catch (error) {
        tracer.log({
          timestamp: Date.now(),
          relativeTime: performance.now() - tracer.startTime,
          event: 'throw',
          function: functionName,
          callId,
          data: tracer.serializeError(error)
        });
        throw error;
      }
    } as T;
  }

  /**
   * Wrap an entire class with tracing on all methods.
   */
  wrapClass<T extends { new (...args: any[]): any }>(
    constructor: T,
    className?: string
  ): T {
    if (!this.enabled) {
      return constructor;
    }

    const name = className || constructor.name;
    const tracer = this;

    return new Proxy(constructor, {
      construct(target, args) {
        const instance = new target(...args);

        // Wrap all methods
        const prototype = Object.getPrototypeOf(instance);
        Object.getOwnPropertyNames(prototype).forEach((methodName) => {
          if (
            methodName !== 'constructor' &&
            typeof instance[methodName] === 'function'
          ) {
            instance[methodName] = tracer.wrap(
              instance[methodName].bind(instance),
              `${name}.${methodName}`
            );
          }
        });

        return instance;
      }
    });
  }

  /**
   * Manually log a trace event (for custom instrumentation).
   */
  logEvent(event: string, data: any) {
    if (!this.enabled) return;

    this.log({
      timestamp: Date.now(),
      relativeTime: performance.now() - this.startTime,
      event: 'custom' as any,
      function: event,
      callId: this.generateCallId(),
      data: this.serialize(data)
    });
  }

  private log(entry: TraceEntry) {
    try {
      fs.appendFileSync(this.traceFile, JSON.stringify(entry) + '\n');
    } catch (error) {
      // Fail silently - don't break execution if tracing fails
      console.error('Trace logging error:', error);
    }
  }

  private generateCallId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  private captureStack(): string[] {
    const stack = new Error().stack?.split('\n').slice(3) || [];
    return stack.map((line) => line.trim()).slice(0, 5);
  }

  private serializeArgs(args: any[]): any {
    return args.map((arg) => this.serialize(arg));
  }

  private serialize(value: any): any {
    if (value === undefined) return { __type: 'undefined' };
    if (value === null) return null;
    if (typeof value === 'function') return { __type: 'function', name: value.name };
    if (value instanceof Error) return this.serializeError(value);

    try {
      const json = JSON.stringify(value);
      if (json.length > this.maxDataSize) {
        return { __truncated: json.substring(0, this.maxDataSize) + '...' };
      }
      return JSON.parse(json);
    } catch (error) {
      return { __type: typeof value, __serialization_error: String(error) };
    }
  }

  private serializeError(error: any): any {
    return {
      __type: 'error',
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 10)
    };
  }

  /**
   * Flush and close trace file.
   */
  close() {
    if (!this.enabled) return;

    this.log({
      timestamp: Date.now(),
      relativeTime: performance.now() - this.startTime,
      event: 'return' as any,
      function: 'trace_end',
      callId: 'end',
      data: {
        total_time_ms: performance.now() - this.startTime
      }
    });
  }
}

// Global tracer instance
let globalTracer: CallTracer | null = null;

export function getGlobalTracer(): CallTracer {
  if (!globalTracer) {
    globalTracer = new CallTracer();
  }
  return globalTracer;
}

export function trace<T extends (...args: any[]) => any>(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const originalMethod = descriptor.value;
  const tracer = getGlobalTracer();

  descriptor.value = tracer.wrap(originalMethod, propertyKey);
  return descriptor;
}

// CLI interface for analyzing trace files
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const args = process.argv.slice(2);
  const command = args[0];
  const traceFile = args[1] || '/tmp/zmcp-trace.jsonl';

  if (command === 'analyze') {
    analyzeTrace(traceFile);
  } else if (command === 'stats') {
    showStats(traceFile);
  } else {
    console.log(`
Usage: trace-wrapper.ts <command> [trace-file]

Commands:
  analyze  - Show call tree and timing
  stats    - Show statistics

Environment:
  TRACE_ENABLED=1  - Enable tracing
  TRACE_FILE=path  - Output file (default: /tmp/zmcp-trace.jsonl)

Example:
  TRACE_ENABLED=1 TRACE_FILE=/tmp/debug.jsonl npm start
  npx tsx bin/trace-wrapper.ts analyze /tmp/debug.jsonl
    `);
  }
}

function analyzeTrace(file: string) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const entries: TraceEntry[] = lines.slice(1).map((line) => JSON.parse(line));

  console.log('\n=== Call Trace Analysis ===\n');

  const callStack: Array<{ name: string; callId: string; startTime: number }> = [];

  entries.forEach((entry) => {
    const indent = '  '.repeat(callStack.length);

    if (entry.event === 'enter') {
      console.log(`${indent}→ ${entry.function} (${entry.callId})`);
      if (entry.data && entry.data.length > 0) {
        console.log(`${indent}  args: ${JSON.stringify(entry.data).substring(0, 100)}`);
      }
      callStack.push({
        name: entry.function,
        callId: entry.callId,
        startTime: entry.relativeTime
      });
    } else if (entry.event === 'return') {
      const call = callStack.pop();
      const duration = call ? (entry.relativeTime - call.startTime).toFixed(2) : '?';
      console.log(`${indent}← ${entry.function} [${duration}ms]`);
      if (entry.data) {
        const result = JSON.stringify(entry.data).substring(0, 100);
        if (result !== '{}') {
          console.log(`${indent}  result: ${result}`);
        }
      }
    } else if (entry.event === 'throw') {
      const call = callStack.pop();
      console.log(`${indent}✗ ${entry.function} threw error`);
      if (entry.data) {
        console.log(`${indent}  error: ${entry.data.message}`);
      }
    }
  });

  console.log();
}

function showStats(file: string) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const entries: TraceEntry[] = lines.slice(1).map((line) => JSON.parse(line));

  const stats = new Map<string, { count: number; totalTime: number; errors: number }>();
  const pending = new Map<string, number>();

  entries.forEach((entry) => {
    const fn = entry.function;
    if (!stats.has(fn)) {
      stats.set(fn, { count: 0, totalTime: 0, errors: 0 });
    }

    const stat = stats.get(fn)!;

    if (entry.event === 'enter') {
      stat.count++;
      pending.set(entry.callId, entry.relativeTime);
    } else if (entry.event === 'return') {
      const startTime = pending.get(entry.callId);
      if (startTime !== undefined) {
        stat.totalTime += entry.relativeTime - startTime;
        pending.delete(entry.callId);
      }
    } else if (entry.event === 'throw') {
      stat.errors++;
      pending.delete(entry.callId);
    }
  });

  console.log('\n=== Trace Statistics ===\n');
  console.log('Function                          Calls    Errors   Avg Time (ms)');
  console.log('----------------------------------------------------------------');

  const sorted = Array.from(stats.entries()).sort((a, b) => b[1].totalTime - a[1].totalTime);

  sorted.forEach(([fn, stat]) => {
    const avgTime = stat.count > 0 ? (stat.totalTime / stat.count).toFixed(2) : '0.00';
    console.log(
      `${fn.padEnd(35)} ${String(stat.count).padStart(5)}    ${String(stat.errors).padStart(5)}    ${avgTime.padStart(10)}`
    );
  });

  console.log();
}
