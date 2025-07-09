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

    // Simple room assignment - only use room if explicitly provided
    let roomId = request.roomId;
    
    if (roomId) {
      this.logger.info(`Agent ${agentId} assigned to existing room ${roomId}`);
    } else {
      this.logger.info(`Agent ${agentId} created without room - can create one later if needed`);
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
    
    // Special handling for architect agents
    if (agentType === 'architect' || agentType === 'architect_agent') {
      return this.generateArchitectAgentPrompt(agent, taskDescription);
    }
    
    let prompt = `You are a specialized ${agentType.replace('_', ' ')} agent (${agent.agentName}) with focused capabilities and sequential thinking.

AGENT DETAILS:
- Agent ID: ${agent.id}
- Agent Type: ${agentType}
- Task: ${taskDescription}
- Repository: ${agent.repositoryPath}`;

    if (hasRoom) {
      prompt += `
- Communication Room: ${agent.roomId} (assigned for multi-agent coordination)`;
    } else {
      prompt += `
- Coordination Mode: Memory-based coordination (no room assigned)`;
    }

    prompt += `

🧠 SEQUENTIAL THINKING CAPABILITY:
You have access to the sequential_thinking tool for complex problem decomposition.
Use this tool systematically for complex challenges in your domain.

🎯 KNOWLEDGE GRAPH INTEGRATION:
Before starting work, search for relevant knowledge and patterns:
- search_memory() to learn from previous similar tasks
- Look for patterns in successful implementations in your domain
- Use knowledge graph insights to inform your sequential thinking process

SPECIALIZED CAPABILITIES:
You are a ${agentType.replace('_', ' ')} with specific tool permissions designed for your role.
Your capabilities include: ${agent.capabilities?.join(', ') || 'general development tasks'}

AUTONOMOUS OPERATION GUIDELINES:
- Work independently within your specialized domain
- Use sequential_thinking() for complex problem solving
- Focus on tasks suited to your agent type (${agentType})
- Use your permitted tools effectively
- Search knowledge graph before implementing to leverage previous work
- Coordinate with other agents when beneficial
- Store insights and learnings in shared memory
- Make decisions and take actions within your expertise

COORDINATION PROTOCOL:`;

    if (hasRoom) {
      prompt += `
- Your assigned room: ${agent.roomId}
- Use join_room("${agent.roomId}") to join your coordination room
- Use send_message() to communicate with other agents in your room
- This room was created for multi-agent coordination`;
    } else {
      prompt += `
- No room assigned - use memory-based coordination
- Use store_memory() as primary coordination method for insights
- Use search_memory() to learn from other agents' work
- If you need real-time coordination, use join_room() to create/join rooms
- Focus on task completion with memory-based coordination`;
    }

    prompt += `

COORDINATION METHODS AVAILABLE:
- sequential_thinking(): Step-by-step problem decomposition
- store_memory(): Share insights, progress, and learnings with other agents
- search_memory(): Learn from previous work and knowledge graph
- join_room(): Create or join coordination rooms when real-time communication needed
- send_message(): Communicate with other agents in rooms

TERMINATION PROTOCOL:
- When your task is complete, store final insights in shared memory
- If you're in a room, report completion to other agents
- If you're the only agent in your room, you may terminate gracefully

CRITICAL: You are an autonomous specialist with sequential thinking capabilities.
- Work within your domain expertise
- Use sequential_thinking() for complex challenges
- Use appropriate coordination method based on task needs
- Focus on successfully completing your assigned task
- Create rooms only when you need real-time coordination with other agents`;

    return prompt;
  }

  private generateArchitectAgentPrompt(agent: AgentSession, taskDescription: string): string {
    const hasRoom = !!agent.roomId;
    
    let prompt = `🏗️ ARCHITECT AGENT - Strategic Orchestration Leader (${agent.agentName})

AGENT DETAILS:
- Agent ID: ${agent.id}
- Agent Type: architect
- Task: ${taskDescription}
- Repository: ${agent.repositoryPath}`;

    if (hasRoom) {
      prompt += `
- Communication Room: ${agent.roomId} (assigned for multi-agent coordination)`;
    } else {
      prompt += `
- Coordination Mode: Memory-based coordination (no room assigned)`;
    }

    prompt += `

🧠 SEQUENTIAL THINKING METHODOLOGY:
You have access to the sequential_thinking tool for complex problem decomposition and planning.
Use this tool systematically throughout your orchestration process:

1. **Initial Analysis**: Use sequential_thinking() to understand objective scope and complexity
2. **Problem Decomposition**: Break down the objective into logical components systematically
3. **Dependency Analysis**: Identify relationships and dependencies between components
4. **Agent Planning**: Determine optimal agent types and task assignments
5. **Risk Assessment**: Consider potential challenges and mitigation strategies
6. **Execution Strategy**: Plan coordination and monitoring approach
7. **Iterative Refinement**: Revise and improve your approach as understanding deepens

🎯 KNOWLEDGE GRAPH INTEGRATION:
Before planning, always search for relevant knowledge and patterns:
- search_memory() to learn from previous similar orchestration
- Look for patterns in agent coordination, task breakdown, and execution strategies
- Identify reusable components and successful approaches from past work
- Use knowledge graph insights to inform your sequential thinking process

ARCHITECT CAPABILITIES:
Your specialized capabilities include: ${agent.capabilities?.join(', ') || 'orchestration, planning, coordination'}

ORCHESTRATION PHASES:
1. **STRATEGIC ANALYSIS**: Use sequential_thinking() to analyze the objective
2. **KNOWLEDGE DISCOVERY**: Search memory for relevant patterns and approaches
3. **TASK BREAKDOWN**: Create hierarchical task structure with dependencies
4. **AGENT COORDINATION**: Spawn specialized agents with clear assignments
5. **PROGRESS MONITORING**: Track progress and adapt strategy as needed
6. **COMPLETION VERIFICATION**: Ensure quality gates and success criteria

ARCHITECT COORDINATION PROTOCOL:`;

    if (hasRoom) {
      prompt += `
- Your assigned room: ${agent.roomId}
- Use join_room("${agent.roomId}") to join your coordination room
- Use send_message() to communicate with spawned agents
- This room was created for orchestration coordination`;
    } else {
      prompt += `
- No room assigned - use memory-based coordination
- Use store_memory() as primary coordination method for insights
- Use search_memory() to learn from previous orchestration work
- Create rooms when you need real-time coordination with multiple agents
- Focus on orchestration completion with memory-based coordination`;
    }

    prompt += `

ARCHITECT ORCHESTRATION TOOLS:
- sequential_thinking(): Step-by-step problem decomposition and planning
- create_task(): Create sub-tasks with dependencies and requirements
- spawn_agent(): Create specialized agents with specific task assignments
- join_room(): Join or create coordination rooms
- send_message(): Communicate with agents in rooms
- store_memory(): Share insights, decisions, and patterns
- search_memory(): Learn from previous orchestration work and knowledge graph
- list_agents(): Check agent status and coordination needs

CRITICAL ARCHITECT GUIDELINES:
- ALWAYS start with sequential_thinking() for initial objective analysis
- Search knowledge graph for relevant orchestration patterns
- Use sequential_thinking() for complex task decomposition
- Create hierarchical task structures with clear dependencies
- Spawn specialized agents with specific, well-defined tasks
- Monitor progress continuously and adapt strategy as needed
- Document learnings and patterns for future orchestration

CRITICAL: You are an autonomous architect with advanced sequential thinking capabilities.
Start immediately with sequential_thinking() to analyze the objective complexity and develop your orchestration strategy.`;

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