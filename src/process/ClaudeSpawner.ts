import { EventEmitter } from 'events';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { query, type SDKMessage, type Options } from '@anthropic-ai/claude-code';

export interface ClaudeSpawnConfig {
  workingDirectory: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  capabilities?: string[];
  environmentVars?: Record<string, string>;
  allowedTools?: string[];
  disallowedTools?: string[];
  timeout?: number;
}

export class ClaudeProcess extends EventEmitter {
  public readonly pid: number;
  public readonly config: ClaudeSpawnConfig;
  private abortController: AbortController;
  private _exitCode: number | null = null;
  private _hasExited = false;
  private stdoutPath: string;
  private stderrPath: string;
  private runPromise: Promise<void> | null = null;

  constructor(config: ClaudeSpawnConfig) {
    super();
    this.config = config;
    this.pid = Math.floor(Math.random() * 100000) + Date.now(); // Generate unique pseudo-PID
    this.abortController = new AbortController();

    // Set up log files in the dedicated claude_agents directory
    const logDir = join(homedir(), '.mcptools', 'logs', 'claude_agents');
    
    try {
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      this.stdoutPath = join(logDir, `claude-${this.pid}-stdout.log`);
      this.stderrPath = join(logDir, `claude-${this.pid}-stderr.log`);
    } catch (error) {
      process.stderr.write(`Failed to create log directory ${logDir}, using temp directory: ${error}\n`);
      const tempDir = join(tmpdir(), '.claude-logs');
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      this.stdoutPath = join(tempDir, `claude-${this.pid}-stdout.log`);
      this.stderrPath = join(tempDir, `claude-${this.pid}-stderr.log`);
    }
  }

  async start(): Promise<void> {
    if (this.runPromise || this._hasExited) {
      return;
    }

    this.runPromise = this.executeQuery();
    return this.runPromise;
  }

  private async executeQuery(): Promise<void> {
    try {
      // Inject CLAUDE.md content into system prompt for agent context
      const systemPrompt = this.buildSystemPrompt();
      
      // Build Claude SDK options
      const options: Options = {
        abortController: this.abortController,
        cwd: this.config.workingDirectory,
        allowedTools: this.config.allowedTools,
        disallowedTools: this.config.disallowedTools,
        model: this.config.model,
        appendSystemPrompt: systemPrompt,
        permissionMode: 'bypassPermissions', // Equivalent to --dangerously-skip-permissions
        resume: this.config.sessionId,
      };

      // Execute Claude query with SDK
      const response = query({
        prompt: this.config.prompt,
        abortController: this.abortController,
        options
      });

      // Process streaming messages
      for await (const message of response) {
        this.handleSDKMessage(message);
        
        if (this.abortController.signal.aborted) {
          break;
        }
      }

      // Mark as completed successfully
      this._exitCode = 0;
      this._hasExited = true;
      this.emit('exit', { code: 0, signal: null, pid: this.pid });

    } catch (error) {
      // Handle errors
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      try {
        writeFileSync(this.stderrPath, `Error: ${errorMessage}\n`, { flag: 'a' });
      } catch (logError) {
        process.stderr.write(`Failed to write error log for process ${this.pid}: ${logError}\n`);
      }

      this._exitCode = 1;
      this._hasExited = true;
      this.emit('error', { error, pid: this.pid });
      this.emit('exit', { code: 1, signal: null, pid: this.pid });
    }
  }

  private buildSystemPrompt(): string {
    try {
      // Inject CLAUDE.md content for agent context
      const claudeMdPath = join(this.config.workingDirectory, 'CLAUDE.md');
      if (existsSync(claudeMdPath)) {
        const claudeMdContent = readFileSync(claudeMdPath, 'utf-8');
        return `\n\n<system-context>\n${claudeMdContent}\n</system-context>\n\nYou are a specialized Claude agent with access to the ClaudeMcpTools system. Use the context above to understand your capabilities and coordinate with other agents as needed.`;
      }
    } catch (error) {
      process.stderr.write(`Warning: Could not read CLAUDE.md for system prompt injection: ${error}\n`);
    }
    
    return '\n\nYou are a specialized Claude agent running via ClaudeMcpTools. Work autonomously to complete your assigned task.';
  }

  private handleSDKMessage(message: SDKMessage): void {
    try {
      const messageStr = JSON.stringify(message);
      writeFileSync(this.stdoutPath, messageStr + '\n', { flag: 'a' });
      
      // Emit structured message based on type
      switch (message.type) {
        case 'assistant':
        case 'user':
          this.emit('stdout', { 
            data: messageStr, 
            pid: this.pid, 
            isJson: true,
            messageType: message.type 
          });
          break;
          
        case 'system':
          this.emit('stdout', { 
            data: messageStr, 
            pid: this.pid, 
            isJson: true,
            messageType: 'system' 
          });
          break;
          
        case 'result':
          if (message.subtype === 'success') {
            this.emit('stdout', { 
              data: messageStr, 
              pid: this.pid, 
              isJson: true,
              messageType: 'result',
              result: message.result 
            });
          } else {
            this.emit('stderr', { 
              data: messageStr, 
              pid: this.pid,
              messageType: 'error' 
            });
          }
          break;
      }
    } catch (error) {
      process.stderr.write(`Failed to handle SDK message for process ${this.pid}: ${error}\n`);
    }
  }

  hasExited(): boolean {
    return this._hasExited;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  terminate(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (!this._hasExited) {
      this.abortController.abort('Process terminated');
      // For compatibility, we'll set exit code based on signal
      this._exitCode = signal === 'SIGKILL' ? 137 : 143;
      this._hasExited = true;
      this.emit('exit', { code: this._exitCode, signal, pid: this.pid });
    }
  }

  cleanup(): void {
    this.removeAllListeners();
    if (!this._hasExited) {
      this.terminate('SIGKILL');
    }
  }
}

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

export class ProcessReaper extends EventEmitter {
  private reapInterval: NodeJS.Timeout | null = null;
  public isRunning = false;
  private spawner: ClaudeSpawner;

  constructor(spawner: ClaudeSpawner) {
    super();
    this.spawner = spawner;
  }

  start(): void {
    if (this.isRunning) return;
    
    process.stderr.write('Starting Claude process reaper\n');
    this.isRunning = true;
    this.reapInterval = setInterval(() => {
      this.reapFinishedProcesses();
    }, 5000); // Check every 5 seconds
  }

  stop(): void {
    if (!this.isRunning) return;
    
    process.stderr.write('Stopping Claude process reaper\n');
    this.isRunning = false;
    
    if (this.reapInterval) {
      clearInterval(this.reapInterval);
      this.reapInterval = null;
    }
  }

  private reapFinishedProcesses(): void {
    const processes = this.spawner.getActiveProcesses();
    let reapedCount = 0;

    for (const process of processes) {
      if (process.hasExited()) {
        process.cleanup();
        reapedCount++;
        this.emit('process-reaped', { 
          pid: process.pid, 
          exitCode: process.exitCode 
        });
      }
    }

    if (reapedCount > 0) {
      process.stderr.write(`Reaped ${reapedCount} finished Claude processes\n`);
    }
  }
}

// Moved global handlers to setupGlobalHandlers method