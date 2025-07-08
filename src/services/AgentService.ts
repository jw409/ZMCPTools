import { DatabaseManager } from '../database/index.js';
import { AgentRepository } from '../repositories/AgentRepository.js';
import { CommunicationRepository } from '../repositories/CommunicationRepository.js';
import type { AgentSession, NewAgentSession, AgentSessionUpdate, AgentStatus, AgentType, ToolPermissions } from '../schemas/index.js';
import { ClaudeSpawner } from '../process/ClaudeSpawner.js';
import type { ClaudeSpawnConfig } from '../process/ClaudeSpawner.js';
import { Logger } from '../utils/logger.js';
import { AgentPermissionManager } from '../utils/agentPermissions.js';
import { PathUtils } from '../utils/pathUtils.js';
import { FoundationCacheService } from './FoundationCacheService.js';
import { eq, and } from 'drizzle-orm';
import { agentSessions } from '../schemas/index.js';
import { resolve } from 'path';

export interface CreateAgentRequest {
  agentName: string;
  agentType?: AgentType;
  repositoryPath: string;
  taskDescription?: string;
  capabilities?: string[];
  dependsOn?: string[];
  metadata?: Record<string, any>;
  claudeConfig?: Partial<ClaudeSpawnConfig>;
  toolPermissions?: Partial<ToolPermissions>;
  autoCreateRoom?: boolean;
  roomId?: string;
}

export interface AgentStatusUpdate {
  status: AgentStatus;
  metadata?: Record<string, any>;
}

export class AgentService {
  private agentRepo: AgentRepository;
  private communicationRepo: CommunicationRepository;
  private spawner: ClaudeSpawner;
  private logger: Logger;

  constructor(private db: DatabaseManager) {
    this.agentRepo = new AgentRepository(db);
    this.communicationRepo = new CommunicationRepository(db);
    this.spawner = ClaudeSpawner.getInstance();
    this.logger = new Logger('AgentService');
    
    // Set up event listeners for automatic agent status updates
    this.setupProcessEventListeners();
  }

  /**
   * Set up event listeners to automatically update agent status when processes exit
   */
  private setupProcessEventListeners(): void {
    this.logger.info('Setting up process event listeners for automatic agent status updates');

    // Listen for process exit events from ClaudeSpawner
    this.spawner.on('process-exit', async ({ pid, code, signal }) => {
      await this.handleProcessExit(pid, code, signal);
    });

    // Listen for process reaper events
    this.spawner.on('process-reaped', async ({ pid, exitCode }) => {
      await this.handleProcessReaped(pid, exitCode);
    });

    this.logger.info('Process event listeners configured successfully');
  }

  /**
   * Handle process exit events and update agent status
   */
  private async handleProcessExit(pid: number, code: number | null, signal: string | null): Promise<void> {
    try {
      this.logger.info(`Handling process exit for PID ${pid}`, { pid, code, signal });

      // Find the agent by PID
      const agent = await this.agentRepo.findByPid(pid);
      if (!agent) {
        this.logger.warn(`No agent found for PID ${pid} on process exit`);
        return;
      }

      this.logger.info(`Found agent for process exit`, {
        agentId: agent.id,
        agentName: agent.agentName,
        pid,
        currentStatus: agent.status,
        exitCode: code,
        signal
      });

      // Determine new status based on exit code and signal
      let newStatus: AgentStatus;
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        newStatus = 'terminated';
      } else if (code === 0) {
        newStatus = 'completed';
      } else {
        newStatus = 'failed';
      }

      // Update agent status in database
      await this.agentRepo.updateStatus(agent.id, newStatus);

      this.logger.info(`Agent status updated automatically`, {
        agentId: agent.id,
        agentName: agent.agentName,
        pid,
        oldStatus: agent.status,
        newStatus,
        exitCode: code,
        signal
      });

    } catch (error) {
      this.logger.error(`Error handling process exit for PID ${pid}`, {
        pid,
        code,
        signal,
        error: error,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle process reaper events for additional cleanup
   */
  private async handleProcessReaped(pid: number, exitCode: number | null): Promise<void> {
    try {
      this.logger.debug(`Process reaped for PID ${pid}`, { pid, exitCode });

      // The main status update should have been handled by handleProcessExit
      // This is primarily for additional cleanup or logging
      const agent = await this.agentRepo.findByPid(pid);
      if (agent) {
        this.logger.debug(`Agent cleanup confirmed for reaped process`, {
          agentId: agent.id,
          agentName: agent.agentName,
          pid,
          status: agent.status,
          exitCode
        });
      }

    } catch (error) {
      this.logger.error(`Error handling process reaper for PID ${pid}`, {
        pid,
        exitCode,
        error: error,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async createAgent(request: CreateAgentRequest): Promise<AgentSession> {
    const agentId = this.generateAgentId();
    const agentType = request.agentType || 'general_agent';
    
    this.logger.info(`Creating agent ${agentId}`, {
      agentName: request.agentName,
      agentType: agentType,
      repositoryPath: request.repositoryPath,
      repositoryPathType: typeof request.repositoryPath,
      repositoryPathValue: request.repositoryPath,
      hasTaskDescription: !!request.taskDescription,
      taskDescriptionType: typeof request.taskDescription,
      taskDescriptionLength: request.taskDescription?.length,
      capabilities: request.capabilities,
      capabilitiesType: typeof request.capabilities,
      capabilitiesIsArray: Array.isArray(request.capabilities),
      dependsOn: request.dependsOn,
      dependsOnType: typeof request.dependsOn,
      dependsOnIsArray: Array.isArray(request.dependsOn),
      metadata: request.metadata,
      metadataType: typeof request.metadata,
      fullRequestStringified: JSON.stringify(request, null, 2)
    });
    
    // Resolve repository path to absolute path for storage and agent context
    const resolvedRepositoryPath = PathUtils.resolveRepositoryPath(request.repositoryPath, `agent creation (${agentId})`);

    // Generate tool permissions for the agent type
    const toolPermissions = AgentPermissionManager.generateToolPermissions(agentType, request.toolPermissions);
    
    // Validate permissions
    const validation = AgentPermissionManager.validatePermissions(toolPermissions);
    if (!validation.valid) {
      this.logger.error(`Invalid tool permissions for agent ${agentId}`, {
        agentType,
        errors: validation.errors
      });
      throw new Error(`Invalid tool permissions: ${validation.errors.join(', ')}`);
    }

    // Handle room creation/assignment
    let roomId = request.roomId;
    const shouldAutoCreate = request.autoCreateRoom !== false && AgentPermissionManager.shouldAutoCreateRoom(agentType);
    
    if (!roomId && shouldAutoCreate) {
      roomId = AgentPermissionManager.generateRoomName(agentType, agentId);
      
      // Create the room in the communication system
      try {
        await this.communicationRepo.createRoom({
          name: roomId,
          repositoryPath: resolvedRepositoryPath,
          roomMetadata: {
            agentType,
            agentId,
            autoCreated: true,
            createdAt: new Date().toISOString()
          }
        });
        
        this.logger.info(`Auto-created room for agent ${agentId}`, {
          roomId,
          agentType
        });
      } catch (error) {
        this.logger.warn(`Failed to create room for agent ${agentId}`, {
          roomId,
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue without room - not critical for agent creation
        roomId = undefined;
      }
    }
    
    // Create agent record first
    // Log the exact data being inserted before validation
    const agentData = {
      id: agentId,
      agentName: request.agentName,
      agentType: agentType,
      repositoryPath: resolvedRepositoryPath,
      status: 'active' as AgentStatus,
      capabilities: request.capabilities || [],
      toolPermissions: toolPermissions,
      roomId: roomId,
      agentMetadata: {
        taskDescription: request.taskDescription,
        dependsOn: request.dependsOn || [],
        ...request.metadata
      }
    };

    this.logger.info(`About to create agent record with data`, {
      agentId,
      agentDataStringified: JSON.stringify(agentData, null, 2),
      agentMetadataKeys: Object.keys(agentData.agentMetadata),
      capabilitiesLength: agentData.capabilities.length,
      toolPermissionsKeys: Object.keys(agentData.toolPermissions || {})
    });

    try {
      const agent = await this.agentRepo.create(agentData);
      this.logger.info(`Agent record created successfully`, { agentId });
    } catch (createError) {
      this.logger.error(`Failed to create agent record`, {
        agentId,
        error: createError,
        errorMessage: createError instanceof Error ? createError.message : String(createError),
        agentDataStringified: JSON.stringify(agentData, null, 2)
      });
      throw createError;
    }

    const agent = await this.agentRepo.findById(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} was not found after creation`);
    }
    
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
    let workingDirectory = PathUtils.resolveWorkingDirectory(
      agent.repositoryPath, 
      process.cwd(), 
      `agent spawn (${agent.id})`
    );
    
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
    
    // Generate allowed tools for Claude Code
    let allowedTools: string[] | undefined;
    let disallowedTools: string[] | undefined;
    
    if (agent.toolPermissions) {
      const allowedToolsFlag = AgentPermissionManager.generateAllowedToolsFlag(agent.toolPermissions);
      if (allowedToolsFlag) {
        allowedTools = allowedToolsFlag.split(',');
      }
      
      // Also get disallowed tools for additional safety
      disallowedTools = agent.toolPermissions.disallowedTools;
    }

    // 🚀 AUTOMATIC FOUNDATION CACHING INTEGRATION
    // Get or create foundation session for 85-90% token cost reduction
    let foundationSessionId: string | undefined;
    
    if (this.shouldUseFoundationCaching(agent)) {
      try {
        const cacheService = new FoundationCacheService(this.db);
        foundationSessionId = await cacheService.getOrCreateFoundationSession(
          workingDirectory,
          this.generateAgentContext(agent, taskDescription)
        );
        
        this.logger.info('Foundation session auto-created for agent', {
          agentId: agent.id,
          foundationSessionId,
          repositoryPath: workingDirectory,
          tokenSavings: '85-90% expected'
        });
      } catch (error) {
        this.logger.warn('Failed to create foundation session, continuing without caching', {
          agentId: agent.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const config: ClaudeSpawnConfig = {
      workingDirectory,
      prompt,
      sessionId: foundationSessionId || `agent_${agent.id}`, // Use foundation session if available
      capabilities: agent.capabilities,
      allowedTools: allowedTools,
      disallowedTools: disallowedTools,
      environmentVars: {
        AGENT_ID: agent.id,
        AGENT_NAME: agent.agentName,
        AGENT_TYPE: agent.agentType || 'general_agent',
        TASK_DESCRIPTION: taskDescription,
        REPOSITORY_PATH: workingDirectory,
        ROOM_ID: agent.roomId || '',
        FOUNDATION_SESSION_ID: foundationSessionId || ''
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
    const agentType = agent.agentType || 'general_agent';
    const hasRoom = !!agent.roomId;
    
    let prompt = `You are a specialized ${agentType.replace('_', ' ')} agent (${agent.agentName}) with focused capabilities.

AGENT DETAILS:
- Agent ID: ${agent.id}
- Agent Type: ${agentType}
- Task: ${taskDescription}
- Repository: ${agent.repositoryPath}`;

    if (hasRoom) {
      prompt += `
- Communication Room: ${agent.roomId}`;
    }

    prompt += `

SPECIALIZED CAPABILITIES:
You are a ${agentType.replace('_', ' ')} with specific tool permissions designed for your role.
Your capabilities include: ${agent.capabilities?.join(', ') || 'general development tasks'}

AUTONOMOUS OPERATION GUIDELINES:
- Work independently within your specialized domain
- Focus on tasks suited to your agent type (${agentType})
- Use your permitted tools effectively
- Coordinate with other agents when beneficial
- Store insights and learnings in shared memory
- Make decisions and take actions within your expertise

COMMUNICATION PROTOCOL:`;

    if (hasRoom) {
      prompt += `
- Your assigned room: ${agent.roomId}
- Use join_room("${agent.roomId}") to join your coordination room
- Use send_message() to communicate with other agents in your room`;
    } else {
      prompt += `
- Use join_room() to join coordination rooms as needed
- Use send_message() to communicate with other agents`;
    }

    prompt += `
- Use store_memory() to share knowledge and insights
- Use search_memory() to learn from previous work
- Report progress and significant findings to coordinating agents

TERMINATION PROTOCOL:
- When your task is complete, report to your room if you're not alone
- Store final insights and learnings in shared memory
- If you're the only agent in your room, you may terminate gracefully

CRITICAL: You are an autonomous specialist. Work within your domain expertise.
Focus on successfully completing your assigned task using your specialized capabilities.`;

    return prompt;
  }

  async getAgent(agentId: string): Promise<AgentSession | null> {
    return await this.agentRepo.findById(agentId);
  }

  async listAgents(repositoryPath?: string, status?: string, limit: number = 5, offset: number = 0): Promise<AgentSession[]> {
    if (repositoryPath) {
      return await this.agentRepo.findByRepositoryPath(repositoryPath, status as AgentStatus, limit, offset);
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
      agentType: agent.agentType,
      repositoryPath: agent.repositoryPath,
      status: agent.status,
      claudePid: agent.claudePid,
      roomId: agent.roomId
    });

    // Handle room cleanup if agent has a room
    if (agent.roomId) {
      try {
        // Check if this agent is alone in the room
        const roomMembers = await this.communicationRepo.getRoomParticipants(agent.roomId);
        const activeMembers = roomMembers.filter(member => 
          member !== agentId
        );

        if (activeMembers.length === 0) {
          // Agent is alone - safe to remove the room
          this.logger.info(`Agent ${agentId} is alone in room ${agent.roomId}, cleaning up room`);
          await this.communicationRepo.deleteRoom(agent.roomId);
        } else {
          // Send termination message to room
          this.logger.info(`Agent ${agentId} leaving room ${agent.roomId} with ${activeMembers.length} remaining members`);
          await this.communicationRepo.sendMessage({
            id: `msg-${Date.now()}-${Math.random().toString(36).substring(2)}`,
            roomName: agent.roomId,
            agentName: agent.agentName,
            message: `Agent ${agent.agentName} (${agent.agentType}) is terminating. Task status: ${agent.status}`,
            messageType: 'system'
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to handle room cleanup for agent ${agentId}`, {
          roomId: agent.roomId,
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue with termination - room cleanup is not critical
      }
    }

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
      process.stderr.write(`Cleaning up stale agent ${agent.id} (${agent.agentName})\n`);
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
        process.stderr.write(`Failed to create agent ${request.agentName}: ${error}\n`);
        // Continue with other agents
      }
    }

    return results;
  }

  // Convenience method for spawning agents with prompt-based interface
  async spawnAgent(config: {
    agentName: string;
    agentType?: AgentType;
    repositoryPath: string;
    prompt: string;
    capabilities?: string[];
    agentMetadata?: Record<string, any>;
    claudeConfig?: Partial<ClaudeSpawnConfig>;
    toolPermissions?: Partial<ToolPermissions>;
    autoCreateRoom?: boolean;
    roomId?: string;
  }): Promise<{
    agentId: string;
    agent: AgentSession;
  }> {
    this.logger.info(`spawnAgent called with config`, {
      agentName: config.agentName,
      agentType: config.agentType,
      repositoryPath: config.repositoryPath,
      repositoryPathType: typeof config.repositoryPath,
      prompt: config.prompt,
      capabilities: config.capabilities,
      hasAgentMetadata: !!config.agentMetadata,
      hasClaudeConfig: !!config.claudeConfig,
      hasToolPermissions: !!config.toolPermissions,
      autoCreateRoom: config.autoCreateRoom,
      roomId: config.roomId
    });
    
    const agent = await this.createAgent({
      agentName: config.agentName,
      agentType: config.agentType,
      repositoryPath: config.repositoryPath,
      taskDescription: config.prompt,
      capabilities: config.capabilities,
      metadata: config.agentMetadata,
      claudeConfig: config.claudeConfig,
      toolPermissions: config.toolPermissions,
      autoCreateRoom: config.autoCreateRoom,
      roomId: config.roomId
    });

    this.logger.info(`spawnAgent completed successfully`, {
      agentId: agent.id,
      agentName: agent.agentName,
      agentType: agent.agentType,
      repositoryPath: agent.repositoryPath,
      status: agent.status,
      claudePid: agent.claudePid,
      roomId: agent.roomId
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

  // 🚀 FOUNDATION CACHING HELPER METHODS
  
  /**
   * Determines if an agent should use foundation caching
   * Enables for all agents by default, with opt-out capability
   */
  private shouldUseFoundationCaching(agent: AgentSession): boolean {
    // Allow opt-out via metadata
    if (agent.agentMetadata?.disableFoundationCaching === true) {
      return false;
    }
    
    // Enable for all agents by default
    return true;
  }
  
  /**
   * Generates context for foundation caching session
   */
  private generateAgentContext(agent: AgentSession, taskDescription: string): any {
    return {
      agentId: agent.id,
      agentName: agent.agentName,
      agentType: agent.agentType,
      taskDescription,
      capabilities: agent.capabilities,
      repositoryPath: agent.repositoryPath,
      timestamp: new Date().toISOString(),
      toolPermissions: agent.toolPermissions
    };
  }
}