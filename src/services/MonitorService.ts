import { DatabaseManager } from '../database/index.js';
import { AgentMonitoringService } from './AgentMonitoringService.js';
import { MonitorFormatter } from './MonitorFormatter.js';
import { ChildProcess, spawn } from 'child_process';
import { createServer, Server } from 'http';
import { writeFileSync } from 'fs';
import { Logger } from '../utils/logger.js';

export interface MonitorConfig {
  outputFormat: 'terminal' | 'html' | 'json';
  watchMode: boolean;
  port?: number;
  repositoryPath: string;
  agentId?: string;
  updateInterval: number;
  outputFile?: string;
}

export interface AgentProcess {
  pid: number;
  title: string;
  command: string;
  agentType: string;
  projectContext: string;
  agentId: string;
  status: 'running' | 'zombie' | 'not_found';
  memory: string;
  cpu: string;
  startTime: string;
}

export interface MonitorData {
  timestamp: string;
  systemOverview: {
    totalAgents: number;
    activeAgents: number;
    idleAgents: number;
    totalTasks: number;
    activeTasks: number;
    pendingTasks: number;
    totalRooms: number;
    activeRooms: number;
  };
  agents: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    pid: number | null;
    processTitle: string;
    roomId?: string;
    lastActivity: string;
    uptime: string;
    performance: {
      cpu: string;
      memory: string;
      restarts: number;
      crashes: number;
    };
    health: number;
  }>;
  processes: AgentProcess[];
  rooms: Array<{
    name: string;
    members: number;
    lastMessage: string;
    messageCount: number;
  }>;
  errors: string[];
}

export class MonitorService {
  private db: DatabaseManager;
  private monitoringService: AgentMonitoringService;
  private formatter: MonitorFormatter;
  private logger: Logger;
  private httpServer?: Server;
  private watchInterval?: NodeJS.Timeout;

  constructor(databasePath: string) {
    // For monitor operations, only use a basic database connection without heavy services
    this.db = new DatabaseManager({
      path: databasePath,
      verbose: false,
      enableConnectionPooling: false  // Disable pooling for simple monitoring
    });
    // Don't initialize AgentMonitoringService to avoid vector services
    this.monitoringService = null as any; // We'll handle agent data directly
    this.formatter = new MonitorFormatter();
    this.logger = new Logger('MonitorService');
  }

  async start(config: MonitorConfig): Promise<void> {
    this.logger.info('Starting monitor service', config);

    try {
      if (config.watchMode) {
        await this.startWatchMode(config);
      } else {
        await this.generateSingleReport(config);
      }
    } catch (error) {
      this.logger.error('Monitor service failed', { error });
      throw error;
    }
  }

  private async startWatchMode(config: MonitorConfig): Promise<void> {
    this.logger.info('Starting watch mode');

    if (config.outputFormat === 'terminal') {
      // Clear screen and start terminal watch
      console.clear();
      console.log('🔍 ZMCP Agent Monitor - Watch Mode (Press Ctrl+C to exit)\n');

      this.watchInterval = setInterval(async () => {
        const data = await this.collectMonitorData(config);
        console.clear();
        console.log('🔍 ZMCP Agent Monitor - Watch Mode (Press Ctrl+C to exit)\n');
        console.log(await this.formatter.formatTerminal(data));
      }, config.updateInterval);

      // Initial display
      const data = await this.collectMonitorData(config);
      console.log(await this.formatter.formatTerminal(data));

    } else if (config.outputFormat === 'html' && config.port) {
      // Start HTTP server for live HTML dashboard
      await this.startHttpServer(config);
    } else {
      throw new Error('Watch mode requires either terminal output or HTML with port specified');
    }

    // Setup graceful shutdown
    process.on('SIGINT', () => {
      this.logger.info('Shutting down monitor service');
      this.stop();
      process.exit(0);
    });
  }

  private async startHttpServer(config: MonitorConfig): Promise<void> {
    this.httpServer = createServer(async (req, res) => {
      try {
        const data = await this.collectMonitorData(config);

        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        });

        const html = await this.formatter.formatHtml(data, {
          refreshInterval: config.updateInterval,
          title: 'ZMCP Agent Monitor'
        });

        res.end(html);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    const port = config.port!;
    this.httpServer.listen(port, () => {
      console.log(`🔍 ZMCP Monitor Dashboard running at http://localhost:${port}`);
      console.log('Press Ctrl+C to stop');
    });
  }

  private async generateSingleReport(config: MonitorConfig): Promise<void> {
    const data = await this.collectMonitorData(config);

    switch (config.outputFormat) {
      case 'terminal':
        console.log(await this.formatter.formatTerminal(data));
        break;

      case 'html':
        const html = await this.formatter.formatHtml(data, {
          title: 'ZMCP Agent Monitor Report'
        });

        if (config.outputFile) {
          writeFileSync(config.outputFile, html);
          console.log(`📄 HTML report saved to: ${config.outputFile}`);
        } else {
          console.log(html);
        }
        break;

      case 'json':
        const json = await this.formatter.formatJson(data);

        if (config.outputFile) {
          writeFileSync(config.outputFile, json);
          console.log(`📄 JSON report saved to: ${config.outputFile}`);
        } else {
          console.log(json);
        }
        break;

      default:
        throw new Error(`Unsupported output format: ${config.outputFormat}`);
    }
  }

  private async collectMonitorData(config: MonitorConfig): Promise<MonitorData> {
    const timestamp = new Date().toISOString();
    const errors: string[] = [];

    try {
      // Get process information
      const processes = await this.getZmcpProcesses();

      // Get database information directly (lightweight approach)
      const dbAgents = await this.getAgentsFromDatabase(config.agentId, config.repositoryPath);

      // Get room information
      const rooms = await this.getRoomActivity(config.repositoryPath);

      // Combine process and database information
      const agents = dbAgents.map(dbAgent => {
        const process = processes.find(p => p.agentId === dbAgent.id || p.title.includes(dbAgent.id));

        return {
          id: dbAgent.id,
          name: dbAgent.agentName || 'Unknown',
          type: dbAgent.agentType || 'general',
          status: dbAgent.status,
          pid: process?.pid || null,
          processTitle: process?.title || 'Not running',
          roomId: dbAgent.roomId,
          lastActivity: dbAgent.lastActivity || 'Unknown',
          uptime: this.calculateUptime(dbAgent.createdAt),
          performance: {
            cpu: process?.cpu || '0%',
            memory: process?.memory || '0MB',
            restarts: dbAgent.restartCount || 0,
            crashes: dbAgent.crashCount || 0
          },
          health: this.calculateHealthScore(dbAgent, process)
        };
      });

      // Calculate system overview
      const systemOverview = {
        totalAgents: agents.length,
        activeAgents: agents.filter(a => a.status === 'active').length,
        idleAgents: agents.filter(a => a.status === 'idle').length,
        totalTasks: 0, // TODO: Get from task service
        activeTasks: 0, // TODO: Get from task service
        pendingTasks: 0, // TODO: Get from task service
        totalRooms: rooms.length,
        activeRooms: rooms.filter(r => r.messageCount > 0).length
      };

      return {
        timestamp,
        systemOverview,
        agents,
        processes,
        rooms,
        errors
      };

    } catch (error) {
      errors.push(`Data collection failed: ${error instanceof Error ? error.message : String(error)}`);

      // Return minimal data structure even on error
      return {
        timestamp,
        systemOverview: {
          totalAgents: 0,
          activeAgents: 0,
          idleAgents: 0,
          totalTasks: 0,
          activeTasks: 0,
          pendingTasks: 0,
          totalRooms: 0,
          activeRooms: 0
        },
        agents: [],
        processes: [],
        rooms: [],
        errors
      };
    }
  }

  private async getZmcpProcesses(): Promise<AgentProcess[]> {
    return new Promise((resolve) => {
      // Use ps to find ZMCP processes
      const ps = spawn('ps', ['aux'], { stdio: 'pipe' });
      let output = '';

      ps.stdout.on('data', (data) => {
        output += data.toString();
      });

      ps.on('close', () => {
        const processes: AgentProcess[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
          if (line.includes('zmcp-') && !line.includes('grep')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 11) {
              const pid = parseInt(parts[1]);
              const cpu = parts[2];
              const memory = parts[3];
              const startTime = parts[8];

              // Extract process title (command field may contain the full title)
              const commandIndex = line.indexOf(parts[10]);
              const fullCommand = line.substring(commandIndex);

              // Parse ZMCP process title format: zmcp-<type>-<project>-<id>
              const titleMatch = fullCommand.match(/zmcp-(\w+)-([^-\s]+)-(\w+)/);

              if (titleMatch) {
                const [, typeAbbr, projectContext, agentId] = titleMatch;

                // Expand type abbreviation
                const typeMap: Record<string, string> = {
                  'be': 'backend',
                  'fe': 'frontend',
                  'ts': 'testing',
                  'dc': 'documentation',
                  'ar': 'architect',
                  'dv': 'devops',
                  'an': 'analysis',
                  'rs': 'researcher',
                  'im': 'implementer',
                  'rv': 'reviewer'
                };

                processes.push({
                  pid,
                  title: fullCommand,
                  command: fullCommand,
                  agentType: typeMap[typeAbbr] || typeAbbr,
                  projectContext,
                  agentId,
                  status: 'running',
                  memory: `${memory}MB`,
                  cpu: `${cpu}%`,
                  startTime
                });
              }
            }
          }
        }

        resolve(processes);
      });

      ps.on('error', () => {
        // If ps command fails, return empty array
        resolve([]);
      });
    });
  }

  private async getAgentsFromDatabase(agentId?: string, repositoryPath?: string): Promise<Array<{
    id: string;
    agentName?: string;
    agentType?: string;
    status: string;
    roomId?: string;
    lastActivity?: string;
    createdAt: string;
    restartCount?: number;
    crashCount?: number;
  }>> {
    try {
      // For now, return empty array to avoid database complexity
      // The monitor will rely on process information for basic monitoring
      return [];
    } catch (error) {
      this.logger.warn('Failed to get agents from database', { error });
      return [];
    }
  }

  private async getRoomActivity(repositoryPath: string): Promise<Array<{
    name: string;
    members: number;
    lastMessage: string;
    messageCount: number;
  }>> {
    try {
      // TODO: Implement room activity collection
      // This would query the chat_rooms and chat_messages tables
      return [];
    } catch (error) {
      this.logger.warn('Failed to get room activity', { error });
      return [];
    }
  }

  private calculateUptime(createdAt: string): string {
    try {
      const created = new Date(createdAt);
      const now = new Date();
      const uptimeMs = now.getTime() - created.getTime();

      const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
      const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      } else {
        return `${minutes}m`;
      }
    } catch {
      return 'Unknown';
    }
  }

  private calculateHealthScore(dbAgent: any, process?: AgentProcess): number {
    let score = 100;

    // Deduct points for crashes
    if (dbAgent.crashCount > 0) {
      score -= Math.min(dbAgent.crashCount * 10, 50);
    }

    // Deduct points for restarts
    if (dbAgent.restartCount > 0) {
      score -= Math.min(dbAgent.restartCount * 5, 30);
    }

    // Deduct points if process not running
    if (!process) {
      score -= 20;
    }

    // Bonus for recent activity
    if (dbAgent.lastActivity) {
      const lastActive = new Date(dbAgent.lastActivity);
      const minutesSinceActivity = (Date.now() - lastActive.getTime()) / 60000;

      if (minutesSinceActivity < 5) {
        score += 5; // Recent activity bonus
      }
    }

    return Math.max(Math.min(score, 100), 0);
  }

  stop(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = undefined;
    }

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = undefined;
    }
  }
}