import { EventEmitter } from 'events';
import { ClaudeSpawner } from './ClaudeSpawner.js';

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