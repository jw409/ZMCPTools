import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { ClaudeProcess } from './ClaudeProcess.js';
import type { ClaudeSpawnConfig } from './ClaudeProcess.js';
import { ProcessReaper } from './ProcessReaper.js';

export class ClaudeSpawner extends EventEmitter {
  private static instance: ClaudeSpawner;
  private processRegistry = new Map<number, ClaudeProcess>();
  private reaper: ProcessReaper;

  private constructor() {
    super();
    this.reaper = new ProcessReaper(this);
    // Start reaper only when first agent is spawned
    this.setupGlobalHandlers();
  }

  static getInstance(): ClaudeSpawner {
    if (!ClaudeSpawner.instance) {
      ClaudeSpawner.instance = new ClaudeSpawner();
    }
    return ClaudeSpawner.instance;
  }

  private setupGlobalHandlers(): void {
    // Global process cleanup on exit
    process.on('exit', () => {
      if (ClaudeSpawner.instance) {
        ClaudeSpawner.instance.cleanup();
      }
    });

    process.on('SIGINT', () => {
      process.stderr.write('Received SIGINT, cleaning up Claude processes...\n');
      if (ClaudeSpawner.instance) {
        ClaudeSpawner.instance.cleanup();
      }
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      process.stderr.write('Received SIGTERM, cleaning up Claude processes...\n');
      if (ClaudeSpawner.instance) {
        ClaudeSpawner.instance.cleanup();
      }
      process.exit(0);
    });
  }

  async spawnClaudeAgent(config: ClaudeSpawnConfig): Promise<ClaudeProcess> {
    // Start reaper on first spawn
    if (!this.reaper.isRunning) {
      this.reaper.start();
    }
    
    // Validate working directory before creating process
    const workingDir = config.workingDirectory || process.cwd();
    if (!existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}`);
    }

    // Validate and set default model to one of the supported models
    const supportedModels = ['claude-3-7-sonnet-latest', 'claude-sonnet-4-0', 'claude-opus-4-0'];
    if (config.model && !supportedModels.includes(config.model)) {
      process.stderr.write(`Warning: Model ${config.model} is not in supported list. Using claude-sonnet-4-0 instead.\n`);
      config.model = 'claude-sonnet-4-0';
    } else if (!config.model) {
      config.model = 'claude-sonnet-4-0'; // Default to Sonnet 4
    }

    process.stderr.write(`Creating Claude SDK agent in: ${workingDir}\n`);
    process.stderr.write(`Model: ${config.model}\n`);
    process.stderr.write(`Session ID: ${config.sessionId || 'auto-generated'}\n`);
    process.stderr.write(`Prompt: ${config.prompt.substring(0, 100)}...\n`);

    // Create our SDK-based wrapper
    const claudeProcess = new ClaudeProcess(config);
    
    // Register in our tracking system
    this.processRegistry.set(claudeProcess.pid, claudeProcess);

    // Set up cleanup on process exit
    claudeProcess.on('exit', ({ code, signal, pid }) => {
      process.stderr.write(`Claude process ${pid} exited with code ${code}, signal ${signal}\n`);
      this.processRegistry.delete(pid);
      this.emit('process-exit', { pid, code, signal });
    });

    claudeProcess.on('error', ({ error, pid }) => {
      process.stderr.write(`Claude process ${pid} error: ${error}\n`);
      this.emit('process-error', { pid, error });
    });

    // Set up timeout if specified
    if (config.timeout) {
      setTimeout(() => {
        if (!claudeProcess.hasExited()) {
          process.stderr.write(`Claude process ${claudeProcess.pid} timed out after ${config.timeout}ms\n`);
          claudeProcess.terminate('SIGTERM');
        }
      }, config.timeout);
    }

    // Start the SDK execution asynchronously
    claudeProcess.start().catch((error) => {
      process.stderr.write(`Failed to start Claude SDK process ${claudeProcess.pid}: ${error}\n`);
      claudeProcess.emit('error', { error, pid: claudeProcess.pid });
    });

    process.stderr.write(`Successfully created Claude SDK agent with PID: ${claudeProcess.pid}\n`);
    return claudeProcess;
  }

  getActiveProcesses(): ClaudeProcess[] {
    return Array.from(this.processRegistry.values()).filter(p => !p.hasExited());
  }

  getProcess(pid: number): ClaudeProcess | undefined {
    return this.processRegistry.get(pid);
  }

  terminateAllProcesses(signal: NodeJS.Signals = 'SIGTERM'): void {
    process.stderr.write(`Terminating ${this.processRegistry.size} Claude processes\n`);
    
    const processes = Array.from(this.processRegistry.values());
    for (const process of processes) {
      if (!process.hasExited()) {
        process.terminate(signal);
      }
    }
  }

  cleanup(): void {
    this.reaper.stop();
    this.terminateAllProcesses('SIGKILL');
    this.processRegistry.clear();
  }
}

