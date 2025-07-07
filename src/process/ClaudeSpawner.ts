import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

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
  private process: ChildProcess;
  private _exitCode: number | null = null;
  private _hasExited = false;
  private stdoutPath: string;
  private stderrPath: string;

  constructor(childProcess: ChildProcess, config: ClaudeSpawnConfig) {
    super();
    this.process = childProcess;
    this.pid = childProcess.pid!;
    this.config = config;

    // Set up log files
    const logDir = join(config.workingDirectory, '.claude-logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    this.stdoutPath = join(logDir, `claude-${this.pid}-stdout.log`);
    this.stderrPath = join(logDir, `claude-${this.pid}-stderr.log`);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.process.on('exit', (code, signal) => {
      this._exitCode = code;
      this._hasExited = true;
      this.emit('exit', { code, signal, pid: this.pid });
    });

    this.process.on('error', (error) => {
      this.emit('error', { error, pid: this.pid });
    });

    // Capture stdout/stderr to log files
    if (this.process.stdout) {
      this.process.stdout.on('data', (data) => {
        try {
          writeFileSync(this.stdoutPath, data, { flag: 'a' });
          this.emit('stdout', { data: data.toString(), pid: this.pid });
        } catch (error) {
          console.error(`Failed to write stdout log for process ${this.pid}:`, error);
        }
      });
    }

    if (this.process.stderr) {
      this.process.stderr.on('data', (data) => {
        try {
          writeFileSync(this.stderrPath, data, { flag: 'a' });
          this.emit('stderr', { data: data.toString(), pid: this.pid });
        } catch (error) {
          console.error(`Failed to write stderr log for process ${this.pid}:`, error);
        }
      });
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
      this.process.kill(signal);
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
    this.reaper.start();
  }

  static getInstance(): ClaudeSpawner {
    if (!ClaudeSpawner.instance) {
      ClaudeSpawner.instance = new ClaudeSpawner();
    }
    return ClaudeSpawner.instance;
  }

  async spawnClaudeAgent(config: ClaudeSpawnConfig): Promise<ClaudeProcess> {
    // Build Claude CLI command
    const cmd = [
      'claude',
      '--dangerously-skip-permissions', // CRITICAL: Enables full autonomy
      '--model', config.model || 'sonnet'
    ];

    // Add tool restrictions if specified
    if (config.allowedTools && config.allowedTools.length > 0) {
      cmd.push('--allowedTools', config.allowedTools.join(','));
    }

    if (config.disallowedTools && config.disallowedTools.length > 0) {
      cmd.push('--disallowedTools', config.disallowedTools.join(','));
    }

    // Add prompt
    cmd.push('-p', config.prompt);

    // Set up isolated environment per agent
    const env = {
      ...process.env,
      MCPTOOLS_SERVER_STARTUP_DIAGNOSTICS: 'false',
      MCPTOOLS_DOCUMENTATION_AUTO_BOOTSTRAP: 'false',
      CLAUDE_SESSION_ID: config.sessionId || `session_${Date.now()}`,
      CLAUDE_AGENT_CAPABILITIES: JSON.stringify(config.capabilities || []),
      ...config.environmentVars
    };

    console.log(`Spawning Claude agent with PID context in: ${config.workingDirectory}`);
    console.log(`Command: ${cmd.join(' ')}`);

    // Spawn the Claude process
    const childProcess = spawn(cmd[0], cmd.slice(1), {
      cwd: config.workingDirectory,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      shell: false
    });

    if (!childProcess.pid) {
      throw new Error('Failed to spawn Claude process - no PID assigned');
    }

    // Create our wrapper
    const claudeProcess = new ClaudeProcess(childProcess, config);
    
    // Register in our tracking system
    this.processRegistry.set(claudeProcess.pid, claudeProcess);

    // Set up cleanup on process exit
    claudeProcess.on('exit', ({ code, signal, pid }) => {
      console.log(`Claude process ${pid} exited with code ${code}, signal ${signal}`);
      this.processRegistry.delete(pid);
      this.emit('process-exit', { pid, code, signal });
    });

    claudeProcess.on('error', ({ error, pid }) => {
      console.error(`Claude process ${pid} error:`, error);
      this.emit('process-error', { pid, error });
    });

    // Set up timeout if specified
    if (config.timeout) {
      setTimeout(() => {
        if (!claudeProcess.hasExited()) {
          console.log(`Claude process ${claudeProcess.pid} timed out after ${config.timeout}ms`);
          claudeProcess.terminate('SIGTERM');
          
          // Force kill after grace period
          setTimeout(() => {
            if (!claudeProcess.hasExited()) {
              claudeProcess.terminate('SIGKILL');
            }
          }, 5000);
        }
      }, config.timeout);
    }

    console.log(`Successfully spawned Claude agent with PID: ${claudeProcess.pid}`);
    return claudeProcess;
  }

  getActiveProcesses(): ClaudeProcess[] {
    return Array.from(this.processRegistry.values()).filter(p => !p.hasExited());
  }

  getProcess(pid: number): ClaudeProcess | undefined {
    return this.processRegistry.get(pid);
  }

  terminateAllProcesses(signal: NodeJS.Signals = 'SIGTERM'): void {
    console.log(`Terminating ${this.processRegistry.size} Claude processes`);
    
    for (const process of this.processRegistry.values()) {
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
  private isRunning = false;
  private spawner: ClaudeSpawner;

  constructor(spawner: ClaudeSpawner) {
    super();
    this.spawner = spawner;
  }

  start(): void {
    if (this.isRunning) return;
    
    console.log('Starting Claude process reaper');
    this.isRunning = true;
    this.reapInterval = setInterval(() => {
      this.reapFinishedProcesses();
    }, 5000); // Check every 5 seconds
  }

  stop(): void {
    if (!this.isRunning) return;
    
    console.log('Stopping Claude process reaper');
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
      console.log(`Reaped ${reapedCount} finished Claude processes`);
    }
  }
}

// Global process cleanup on exit
process.on('exit', () => {
  ClaudeSpawner.getInstance().cleanup();
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, cleaning up Claude processes...');
  ClaudeSpawner.getInstance().cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, cleaning up Claude processes...');
  ClaudeSpawner.getInstance().cleanup();
  process.exit(0);
});