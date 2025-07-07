import { ClaudeDatabase } from '../database/index.js';
import { AgentRepository } from './repositories/AgentRepository.js';
import { AgentSession, AgentStatus } from '../models/index.js';
import { ClaudeSpawner } from '../process/ClaudeSpawner.js';
import type { ClaudeSpawnConfig } from '../process/ClaudeSpawner.js';

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

  constructor(private db: ClaudeDatabase) {
    this.agentRepo = new AgentRepository(db);
    this.spawner = ClaudeSpawner.getInstance();
  }

  async createAgent(request: CreateAgentRequest): Promise<AgentSession> {
    const agentId = this.generateAgentId();
    
    // Create agent record first
    const agent = this.agentRepo.create({
      id: agentId,
      agent_name: request.agentName,
      repository_path: request.repositoryPath,
      status: AgentStatus.ACTIVE,
      capabilities: request.capabilities || [],
      agent_metadata: {
        taskDescription: request.taskDescription,
        dependsOn: request.dependsOn || [],
        ...request.metadata
      }
    });

    // If we have a task description, spawn the actual Claude process
    if (request.taskDescription) {
      try {
        const claudeProcess = await this.spawnClaudeProcess(agent, request.taskDescription, request.claudeConfig);
        
        // Update agent with the PID
        this.db.transaction(() => {
          const updateStmt = this.db.database.prepare(`
            UPDATE agent_sessions 
            SET claude_pid = ?, last_heartbeat = datetime('now')
            WHERE id = ?
          `);
          updateStmt.run(claudeProcess.pid, agentId);
        });

        agent.claude_pid = claudeProcess.pid;
      } catch (error) {
        console.error(`Failed to spawn Claude process for agent ${agentId}:`, error);
        // Update agent status to indicate failure
        this.agentRepo.updateStatus(agentId, AgentStatus.TERMINATED);
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
    const prompt = this.generateAgentPrompt(agent, taskDescription);
    
    const config: ClaudeSpawnConfig = {
      workingDirectory: agent.repository_path,
      prompt,
      sessionId: `agent_${agent.id}`,
      capabilities: agent.capabilities,
      environmentVars: {
        AGENT_ID: agent.id,
        AGENT_NAME: agent.agent_name,
        AGENT_TYPE: agent.agent_name,
        TASK_DESCRIPTION: taskDescription,
        REPOSITORY_PATH: agent.repository_path
      },
      ...claudeConfig
    };

    console.log(`Spawning Claude process for agent ${agent.id} (${agent.agent_name})`);
    return await this.spawner.spawnClaudeAgent(config);
  }

  private generateAgentPrompt(agent: AgentSession, taskDescription: string): string {
    return `You are a fully autonomous ${agent.agent_name} agent with COMPLETE CLAUDE CODE CAPABILITIES.

AGENT ID: ${agent.id}
TASK: ${taskDescription}
REPOSITORY: ${agent.repository_path}

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

  getAgent(agentId: string): AgentSession | null {
    return this.agentRepo.findById(agentId);
  }

  listAgents(repositoryPath?: string, status?: AgentStatus): AgentSession[] {
    if (repositoryPath) {
      return this.agentRepo.findByRepositoryPath(repositoryPath, status);
    }
    
    // If no repository specified, we need a different query
    // For now, let's throw an error as it's not implemented
    throw new Error('Listing all agents without repository filter not implemented');
  }

  updateAgentStatus(agentId: string, update: AgentStatusUpdate): void {
    this.agentRepo.updateStatus(agentId, update.status);
    
    if (update.metadata) {
      this.agentRepo.updateMetadata(agentId, update.metadata);
    }
  }

  updateHeartbeat(agentId: string): void {
    this.agentRepo.updateHeartbeat(agentId);
  }

  terminateAgent(agentId: string): void {
    const agent = this.agentRepo.findById(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Terminate the Claude process if it exists
    if (agent.claude_pid) {
      const process = this.spawner.getProcess(agent.claude_pid);
      if (process && !process.hasExited()) {
        console.log(`Terminating Claude process ${agent.claude_pid} for agent ${agentId}`);
        process.terminate('SIGTERM');
        
        // Force kill after grace period
        setTimeout(() => {
          if (!process.hasExited()) {
            process.terminate('SIGKILL');
          }
        }, 5000);
      }
    }

    // Update agent status
    this.agentRepo.updateStatus(agentId, AgentStatus.TERMINATED);
  }

  findStaleAgents(staleMinutes = 30): AgentSession[] {
    return this.agentRepo.findStaleAgents(staleMinutes);
  }

  cleanupStaleAgents(staleMinutes = 30): number {
    const staleAgents = this.findStaleAgents(staleMinutes);
    
    for (const agent of staleAgents) {
      console.log(`Cleaning up stale agent ${agent.id} (${agent.agent_name})`);
      this.terminateAgent(agent.id);
    }

    return staleAgents.length;
  }

  getAgentCount(repositoryPath?: string, status?: AgentStatus): number {
    return this.agentRepo.count(repositoryPath, status);
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
    const agent = await this.createAgent({
      agentName: config.agentName,
      repositoryPath: config.repositoryPath,
      taskDescription: config.prompt,
      capabilities: config.capabilities,
      metadata: config.agentMetadata,
      claudeConfig: config.claudeConfig
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
      
      const checkCompletion = () => {
        const agent = this.getAgent(agentId);
        
        if (!agent) {
          resolve(false);
          return;
        }

        if (agent.status === AgentStatus.COMPLETED || agent.status === AgentStatus.TERMINATED) {
          resolve(agent.status === AgentStatus.COMPLETED);
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