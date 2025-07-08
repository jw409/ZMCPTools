import { DatabaseManager } from '../database/index.js';
import { AgentRepository } from '../repositories/AgentRepository.js';
import type { AgentSession, NewAgentSession, AgentSessionUpdate, AgentStatus } from '../schemas/index.js';
import { ClaudeSpawner } from '../process/ClaudeSpawner.js';
import type { ClaudeSpawnConfig } from '../process/ClaudeSpawner.js';
import { Logger } from '../utils/logger.js';
import { eq, and } from 'drizzle-orm';
import { agentSessions } from '../schemas/index.js';
import { resolve } from 'path';

export interface CreateAgentRequest {
  agentName: string;
  repositoryPath: string;
  taskDescription?: string;
  capabilities?: string[];
  dependsOn?: string[];
  metadata?: Record<string, any>;
  claudeConfig?: Partial<ClaudeSpawnConfig>;
}

export interface AgentStatusUpdate {
  status: AgentStatus;
  metadata?: Record<string, any>;
}

export class AgentService {
  private agentRepo: AgentRepository;
  private spawner: ClaudeSpawner;
  private logger: Logger;

  constructor(private db: DatabaseManager) {
    this.agentRepo = new AgentRepository(db);
    this.spawner = ClaudeSpawner.getInstance();
    this.logger = new Logger('AgentService');
  }

  async createAgent(request: CreateAgentRequest): Promise<AgentSession> {
    const agentId = this.generateAgentId();
    
    this.logger.info(`Creating agent ${agentId}`, {
      agentName: request.agentName,
      repositoryPath: request.repositoryPath,
      repositoryPathType: typeof request.repositoryPath,
      repositoryPathValue: request.repositoryPath,
      hasTaskDescription: !!request.taskDescription,
      capabilities: request.capabilities,
      dependsOn: request.dependsOn
    });
    
    // Validate repository path before creating agent
    if (!request.repositoryPath) {
      this.logger.error(`Invalid repository path for agent ${agentId}`, {
        repositoryPath: request.repositoryPath,
        repositoryPathType: typeof request.repositoryPath,
        request: request
      });
      throw new Error(`Repository path is required and cannot be empty or undefined`);
    }
    
    if (typeof request.repositoryPath !== 'string') {
      this.logger.error(`Repository path must be a string for agent ${agentId}`, {
        repositoryPath: request.repositoryPath,
        repositoryPathType: typeof request.repositoryPath,
        request: request
      });
      throw new Error(`Repository path must be a string, got ${typeof request.repositoryPath}`);
    }
    
    // Resolve repository path to absolute path for storage and agent context
    const resolvedRepositoryPath = resolve(request.repositoryPath);
    
    this.logger.info(`Resolved repository path for agent ${agentId}`, {
      originalPath: request.repositoryPath,
      resolvedPath: resolvedRepositoryPath
    });
    
    // Create agent record first
    const agent = await this.agentRepo.create({
      id: agentId,
      agentName: request.agentName,
      repositoryPath: resolvedRepositoryPath,
      status: 'active' as AgentStatus,
      capabilities: request.capabilities || [],
      agentMetadata: {
        taskDescription: request.taskDescription,
        dependsOn: request.dependsOn || [],
        ...request.metadata
      }
    });
    
    this.logger.info(`Agent record created successfully`, {
      agentId: agentId,
      agentName: agent.agentName,
      repositoryPath: agent.repositoryPath,
      repositoryPathType: typeof agent.repositoryPath
    });

    // If we have a task description, spawn the actual Claude process
    if (request.taskDescription) {
      this.logger.info(`Spawning Claude process for agent ${agentId}`, {
        agentId: agentId,
        agentName: agent.agentName,
        repositoryPath: agent.repositoryPath,
        taskDescription: request.taskDescription
      });
      
      try {
        const claudeProcess = await this.spawnClaudeProcess(agent, request.taskDescription, request.claudeConfig);
        
        this.logger.info(`Claude process spawned successfully for agent ${agentId}`, {
          agentId: agentId,
          claudePid: claudeProcess.pid,
          repositoryPath: agent.repositoryPath
        });
        
        // Update agent with the PID
        this.db.transaction(() => {
          const updateStmt = this.db.database.prepare(`
            UPDATE agent_sessions 
            SET claudePid = ?, lastHeartbeat = datetime('now')
            WHERE id = ?
          `);
          updateStmt.run(claudeProcess.pid, agentId);
        });

        agent.claudePid = claudeProcess.pid;
      } catch (error) {
        this.logger.error(`Failed to spawn Claude process for agent ${agentId}`, {
          agentId: agentId,
          agentName: agent.agentName,
          repositoryPath: agent.repositoryPath,
          error: error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        });
        
        // Update agent status to indicate failure
        await this.agentRepo.updateStatus(agentId, 'terminated' as AgentStatus);
        throw new Error(`Failed to spawn Claude process: ${error}`);
      }
    }

    return agent;
  }

  private async spawnClaudeProcess(
    agent: AgentSession, 
    taskDescription: string, 
    claudeConfig?: Partial<ClaudeSpawnConfig>
  ) {
    this.logger.info(`Starting Claude process spawn for agent ${agent.id}`, {
      agentId: agent.id,
      agentName: agent.agentName,
      repositoryPath: agent.repositoryPath,
      repositoryPathType: typeof agent.repositoryPath,
      taskDescription: taskDescription
    });
    
    const prompt = this.generateAgentPrompt(agent, taskDescription);
    
    // Validate and resolve working directory to absolute path
    let workingDirectory = agent.repositoryPath;
    
    this.logger.info(`Initial working directory validation`, {
      agentId: agent.id,
      originalWorkingDirectory: workingDirectory,
      workingDirectoryType: typeof workingDirectory,
      isValid: !!(workingDirectory && typeof workingDirectory === 'string')
    });
    
    if (!workingDirectory || typeof workingDirectory !== 'string') {
      this.logger.warn(`Agent ${agent.id} has invalid repository_path, using process.cwd() as fallback`, {
        agentId: agent.id,
        originalRepositoryPath: workingDirectory,
        repositoryPathType: typeof workingDirectory,
        fallbackPath: process.cwd()
      });
      workingDirectory = process.cwd();
    }
    
    // Resolve to absolute path so agent gets full context
    workingDirectory = resolve(workingDirectory);
    
    this.logger.info(`Resolved working directory to absolute path`, {
      agentId: agent.id,
      resolvedWorkingDirectory: workingDirectory
    });
    
    // Verify the directory exists
    try {
      const fs = await import('fs');
      if (!fs.existsSync(workingDirectory)) {
        this.logger.warn(`Working directory does not exist, using process.cwd() as fallback`, {
          agentId: agent.id,
          nonExistentDirectory: workingDirectory,
          fallbackPath: process.cwd()
        });
        workingDirectory = process.cwd();
      } else {
        this.logger.info(`Working directory exists and is valid`, {
          agentId: agent.id,
          workingDirectory: workingDirectory
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to verify working directory, using process.cwd() as fallback`, {
        agentId: agent.id,
        workingDirectory: workingDirectory,
        error: error,
        errorMessage: error instanceof Error ? error.message : String(error),
        fallbackPath: process.cwd()
      });
      workingDirectory = process.cwd();
    }
    
    const config: ClaudeSpawnConfig = {
      workingDirectory,
      prompt,
      sessionId: `agent_${agent.id}`,
      capabilities: agent.capabilities,
      environmentVars: {
        AGENT_ID: agent.id,
        AGENT_NAME: agent.agentName,
        AGENT_TYPE: agent.agentName,
        TASK_DESCRIPTION: taskDescription,
        REPOSITORY_PATH: workingDirectory
      },
      ...claudeConfig
    };

    this.logger.info(`Final configuration for Claude process spawn`, {
      agentId: agent.id,
      agentName: agent.agentName,
      workingDirectory: workingDirectory,
      sessionId: config.sessionId,
      capabilities: config.capabilities,
      environmentVars: config.environmentVars,
      hasCustomConfig: !!claudeConfig,
      customConfig: claudeConfig
    });

    this.logger.info(`Spawning Claude process for agent ${agent.id} (${agent.agentName})`);
    
    try {
      const result = await this.spawner.spawnClaudeAgent(config);
      
      this.logger.info(`Claude process spawned successfully`, {
        agentId: agent.id,
        agentName: agent.agentName,
        claudePid: result.pid,
        workingDirectory: workingDirectory
      });
      
      return result;
    } catch (error) {
      this.logger.error(`Failed to spawn Claude process in spawner`, {
        agentId: agent.id,
        agentName: agent.agentName,
        workingDirectory: workingDirectory,
        config: config,
        error: error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  private generateAgentPrompt(agent: AgentSession, taskDescription: string): string {
    return `You are a fully autonomous ${agent.agentName} agent with COMPLETE CLAUDE CODE CAPABILITIES.

AGENT ID: ${agent.id}
TASK: ${taskDescription}
REPOSITORY: ${agent.repositoryPath}

You have access to ALL Claude Code tools:
- File operations (Read, Write, Edit, Search, etc.)
- Code analysis and refactoring
- Web browsing and research
- System commands and build tools
- Git operations
- Database queries
- Agent coordination tools (spawn_agent, join_room, send_message, etc.)
- Shared memory and communication (store_memory, search_memory, etc.)

AUTONOMOUS OPERATION GUIDELINES:
- Work independently to complete your assigned task
- Use any tools necessary for success
- Coordinate with other agents when beneficial
- Store insights and learnings in shared memory
- Report progress in coordination rooms
- Make decisions and take actions as needed

COMMUNICATION:
- Use join_room() to join coordination rooms
- Use send_message() to communicate with other agents
- Use store_memory() to share knowledge and insights
- Use search_memory() to learn from previous work

CRITICAL: You are fully autonomous. Think, plan, and execute independently.
Your goal is to successfully complete the task using all available capabilities.`;
  }

  async getAgent(agentId: string): Promise<AgentSession | null> {
    return await this.agentRepo.findById(agentId);
  }

  async listAgents(repositoryPath?: string, status?: string): Promise<AgentSession[]> {
    if (repositoryPath) {
      return await this.agentRepo.findByRepositoryPath(repositoryPath, status as AgentStatus);
    }
    
    // If no repository specified, we need a different query
    // For now, let's throw an error as it's not implemented
    throw new Error('Listing all agents without repository filter not implemented');
  }

  async updateAgentStatus(agentId: string, update: AgentStatusUpdate): Promise<void> {
    await this.agentRepo.updateStatus(agentId, update.status);
    
    if (update.metadata) {
      await this.agentRepo.updateMetadata(agentId, update.metadata);
    }
  }

  async updateHeartbeat(agentId: string): Promise<void> {
    await this.agentRepo.updateHeartbeat(agentId);
  }

  async terminateAgent(agentId: string): Promise<void> {
    this.logger.info(`Terminating agent ${agentId}`);
    
    const agent = await this.agentRepo.findById(agentId);
    if (!agent) {
      this.logger.error(`Agent ${agentId} not found for termination`);
      throw new Error(`Agent ${agentId} not found`);
    }

    this.logger.info(`Agent found for termination`, {
      agentId: agentId,
      agentName: agent.agentName,
      repositoryPath: agent.repositoryPath,
      status: agent.status,
      claudePid: agent.claudePid
    });

    // Terminate the Claude process if it exists
    if (agent.claudePid) {
      const process = this.spawner.getProcess(agent.claudePid);
      if (process && !process.hasExited()) {
        this.logger.info(`Terminating Claude process ${agent.claudePid} for agent ${agentId}`);
        process.terminate('SIGTERM');
        
        // Force kill after grace period
        setTimeout(() => {
          if (!process.hasExited()) {
            this.logger.warn(`Force killing Claude process ${agent.claudePid} for agent ${agentId}`);
            process.terminate('SIGKILL');
          }
        }, 5000);
      } else {
        this.logger.info(`Claude process ${agent.claudePid} for agent ${agentId} has already exited or not found`);
      }
    } else {
      this.logger.info(`No Claude process to terminate for agent ${agentId}`);
    }

    // Update agent status
    await this.agentRepo.updateStatus(agentId, 'terminated' as AgentStatus);
    this.logger.info(`Agent ${agentId} status updated to TERMINATED`);
  }

  async findStaleAgents(staleMinutes = 30): Promise<AgentSession[]> {
    return await this.agentRepo.findStaleAgents(staleMinutes);
  }

  async cleanupStaleAgents(staleMinutes = 30): Promise<number> {
    const staleAgents = await this.findStaleAgents(staleMinutes);
    
    for (const agent of staleAgents) {
      console.log(`Cleaning up stale agent ${agent.id} (${agent.agentName})`);
      await this.terminateAgent(agent.id);
    }

    return staleAgents.length;
  }

  async getAgentCount(repositoryPath?: string, status?: string): Promise<number> {
    const conditions = [];
    
    if (repositoryPath) {
      conditions.push(eq(agentSessions.repositoryPath, repositoryPath));
    }
    
    if (status) {
      conditions.push(eq(agentSessions.status, status as AgentStatus));
    }
    
    const whereClause = conditions.length > 1 ? and(...conditions) : conditions.length === 1 ? conditions[0] : undefined;
    
    return await this.agentRepo.count(whereClause);
  }

  private generateAgentId(): string {
    return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Batch operations
  async createAgentBatch(requests: CreateAgentRequest[]): Promise<AgentSession[]> {
    const results: AgentSession[] = [];
    
    for (const request of requests) {
      try {
        const agent = await this.createAgent(request);
        results.push(agent);
      } catch (error) {
        console.error(`Failed to create agent ${request.agentName}:`, error);
        // Continue with other agents
      }
    }

    return results;
  }

  // Convenience method for spawning agents with prompt-based interface
  async spawnAgent(config: {
    agentName: string;
    repositoryPath: string;
    prompt: string;
    capabilities?: string[];
    agentMetadata?: Record<string, any>;
    claudeConfig?: Partial<ClaudeSpawnConfig>;
  }): Promise<{
    agentId: string;
    agent: AgentSession;
  }> {
    this.logger.info(`spawnAgent called with config`, {
      agentName: config.agentName,
      repositoryPath: config.repositoryPath,
      repositoryPathType: typeof config.repositoryPath,
      prompt: config.prompt,
      capabilities: config.capabilities,
      hasAgentMetadata: !!config.agentMetadata,
      hasClaudeConfig: !!config.claudeConfig
    });
    
    const agent = await this.createAgent({
      agentName: config.agentName,
      repositoryPath: config.repositoryPath,
      taskDescription: config.prompt,
      capabilities: config.capabilities,
      metadata: config.agentMetadata,
      claudeConfig: config.claudeConfig
    });

    this.logger.info(`spawnAgent completed successfully`, {
      agentId: agent.id,
      agentName: agent.agentName,
      repositoryPath: agent.repositoryPath,
      status: agent.status,
      claudePid: agent.claudePid
    });

    return {
      agentId: agent.id,
      agent
    };
  }

  // Wait for agent completion
  async waitForAgentCompletion(agentId: string, timeout = 300000): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkCompletion = async () => {
        const agent = await this.getAgent(agentId);
        
        if (!agent) {
          resolve(false);
          return;
        }

        if (agent.status === 'completed' || agent.status === 'terminated') {
          resolve(agent.status === 'completed');
          return;
        }

        if (Date.now() - startTime > timeout) {
          resolve(false);
          return;
        }

        // Check again in 5 seconds
        setTimeout(checkCompletion, 5000);
      };

      checkCompletion();
    });
  }
}