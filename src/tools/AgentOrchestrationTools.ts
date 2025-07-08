import { DatabaseManager } from '../database/index.js';
import { AgentService, TaskService, CommunicationService, MemoryService } from '../services/index.js';
import { WebScrapingService } from '../services/WebScrapingService.js';
import { ClaudeSpawner } from '../process/ClaudeSpawner.js';
import type { TaskType, AgentStatus, MessageType } from '../schemas/index.js';

export interface OrchestrationResult {
  success: boolean;
  message: string;
  data?: any;
}

export interface SpawnAgentOptions {
  agentType: string;
  repositoryPath: string;
  taskDescription: string;
  capabilities?: string[];
  dependsOn?: string[];
  metadata?: Record<string, any>;
}

export class AgentOrchestrationTools {
  private agentService: AgentService;
  private taskService: TaskService;
  private communicationService: CommunicationService;
  private memoryService: MemoryService;
  private webScrapingService: WebScrapingService;

  constructor(private db: DatabaseManager, repositoryPath: string) {
    this.agentService = new AgentService(db);
    this.taskService = new TaskService(db);
    this.communicationService = new CommunicationService(db);
    this.memoryService = new MemoryService(db);
    this.webScrapingService = new WebScrapingService(
      db,
      repositoryPath
    );
  }

  /**
   * Spawn architect agent to coordinate multi-agent objective completion
   */
  async orchestrateObjective(
    title: string,
    objective: string,
    repositoryPath: string,
    foundationSessionId?: string
  ): Promise<OrchestrationResult> {
    try {
      // 1. Create coordination room
      const roomName = `objective_${Date.now()}`;
      await this.communicationService.createRoom({
        name: roomName,
        description: `Coordination room for: ${objective}`,
        repositoryPath,
        metadata: {
          objective,
          foundationSessionId,
          createdAt: new Date().toISOString()
        }
      });

      // 2. AUTO-CREATE MASTER TASK for the objective
      const masterTask = await this.taskService.createTask({
        repositoryPath,
        taskType: 'feature' as TaskType,
        description: `${title}: ${objective}`,
        requirements: {
          objective,
          roomName,
          foundationSessionId,
          isOrchestrationTask: true,
          createdBy: 'orchestrateObjective'
        },
        priority: 10 // High priority for orchestration tasks
      });

      // 3. Store objective in shared memory with task reference
      this.memoryService.storeInsight(
        repositoryPath,
        'system',
        title,
        `Objective: ${objective}\n\nMulti-agent objective coordination started.\nRoom: ${roomName}\nFoundation Session: ${foundationSessionId || 'none'}\nMaster Task: ${masterTask.id}`,
        ['objective', 'orchestration', 'coordination', 'task-creation']
      );

      // 4. Generate architect prompt with task-first approach
      const architectPrompt = this.generateArchitectPrompt(objective, repositoryPath, roomName, foundationSessionId, masterTask.id);

      // 5. Spawn architect agent with full autonomy and task assignment
      const architectAgent = await this.agentService.createAgent({
        agentName: 'architect',
        repositoryPath,
        taskDescription: `Orchestrate objective: ${objective}`,
        capabilities: ['ALL_TOOLS', 'orchestration', 'planning', 'coordination'],
        metadata: {
          role: 'architect',
          objective,
          roomName,
          foundationSessionId,
          fullAutonomy: true,
          assignedTaskId: masterTask.id
        },
        claudeConfig: {
          prompt: architectPrompt,
          sessionId: foundationSessionId,
          environmentVars: {
            ORCHESTRATION_MODE: 'architect',
            TARGET_ROOM: roomName,
            OBJECTIVE: objective,
            MASTER_TASK_ID: masterTask.id
          }
        }
      });

      // 6. Assign master task to architect agent
      await this.taskService.assignTask(masterTask.id, architectAgent.id);

      // 7. Send welcome message to room with task info
      this.communicationService.sendMessage({
        roomName,
        agentName: 'system',
        message: `🏗️ Architect agent ${architectAgent.id} has been spawned to coordinate objective: "${objective}"\n📋 Master task ${masterTask.id} created and assigned`,
        messageType: 'system' as MessageType
      });

      return {
        success: true,
        message: 'Architect agent spawned successfully with master task',
        data: {
          architectAgentId: architectAgent.id,
          roomName,
          objective,
          masterTaskId: masterTask.id
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to orchestrate objective: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Spawn fully autonomous Claude agent with complete tool access
   */
  async spawnAgent(options: SpawnAgentOptions): Promise<OrchestrationResult> {
    try {
      // Add detailed logging to track what architects are passing
      const logger = new (await import('../utils/logger.js')).Logger('AgentOrchestration');
      
      logger.info('[SPAWN_AGENT] Called with options', {
        agentType: options.agentType,
        repositoryPath: options.repositoryPath,
        taskDescriptionType: typeof options.taskDescription,
        taskDescriptionLength: options.taskDescription?.length,
        taskDescriptionPreview: options.taskDescription?.substring(0, 100),
        capabilitiesType: typeof options.capabilities,
        capabilitiesIsArray: Array.isArray(options.capabilities),
        capabilitiesValue: options.capabilities,
        dependsOnType: typeof options.dependsOn,
        dependsOnIsArray: Array.isArray(options.dependsOn),
        dependsOnValue: options.dependsOn,
        metadataType: typeof options.metadata,
        metadataKeys: options.metadata ? Object.keys(options.metadata) : [],
        rawOptionsStringified: JSON.stringify(options)
      });

      const {
        agentType,
        repositoryPath,
        taskDescription,
        capabilities = ['ALL_TOOLS'],
        dependsOn = [],
        metadata = {}
      } = options;

      // 1. Check dependencies if any
      if (dependsOn.length > 0) {
        const depCheck = await this.checkDependencies(dependsOn);
        if (!depCheck.success) {
          return {
            success: false,
            message: `Dependencies not met: ${depCheck.message}`,
            data: { missingDependencies: depCheck.data }
          };
        }
      }

      // 2. Generate specialized prompt
      const specializedPrompt = this.generateAgentPrompt(agentType, taskDescription, repositoryPath);

      // 3. Create agent with full capabilities
      const agent = await this.agentService.createAgent({
        agentName: agentType,
        repositoryPath,
        taskDescription,
        capabilities,
        dependsOn,
        metadata: {
          ...metadata,
          spawnedAt: new Date().toISOString(),
          fullAutonomy: true
        },
        claudeConfig: {
          prompt: specializedPrompt
        }
      });

      // 4. Store agent spawn in memory
      this.memoryService.storeProgress(
        repositoryPath,
        'system',
        `Agent ${agentType} spawned`,
        `Successfully spawned ${agentType} agent for task: ${taskDescription}`,
        {
          agentId: agent.id,
          agentType,
          capabilities,
          dependsOn
        },
        ['agent-spawn', agentType]
      );

      return {
        success: true,
        message: `${agentType} agent spawned successfully`,
        data: {
          agentId: agent.id,
          agentType,
          pid: agent.claudePid,
          capabilities
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to spawn ${options.agentType} agent: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Create and assign task to agents
   */
  async createTask(
    repositoryPath: string,
    taskType: TaskType,
    title: string,
    description: string,
    requirements?: Record<string, any>,
    dependencies?: string[]
  ): Promise<OrchestrationResult> {
    try {
      // Create the task
      const task = await this.taskService.createTask({
        repositoryPath,
        taskType,
        description: `${title}: ${description}`,
        requirements,
        priority: 1
      });

      // Add dependencies if specified
      if (dependencies && dependencies.length > 0) {
        for (const depId of dependencies) {
          this.taskService.addTaskDependency(task.id, depId);
        }
      }

      // Store task creation in memory
      this.memoryService.storeProgress(
        repositoryPath,
        'system',
        `Task created: ${title}`,
        `Task ${task.id} created with type ${taskType}.\nDescription: ${description}`,
        {
          taskId: task.id,
          taskType,
          dependencies: dependencies || []
        },
        ['task-creation', taskType]
      );

      return {
        success: true,
        message: 'Task created successfully',
        data: {
          taskId: task.id,
          taskType,
          status: task.status
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to create task: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Join communication room for coordination
   */
  async joinRoom(roomName: string, agentName: string): Promise<OrchestrationResult> {
    try {
      // Check if room exists
      const room = this.communicationService.getRoom(roomName);
      if (!room) {
        return {
          success: false,
          message: `Room ${roomName} not found`,
          data: { roomName }
        };
      }

      // Join the room
      await this.communicationService.joinRoom(roomName, agentName);

      // Get recent messages for context
      const recentMessages = await this.communicationService.getRecentMessages(roomName, 10);
      const participants = await this.communicationService.getRoomParticipants(roomName);

      return {
        success: true,
        message: `Successfully joined room ${roomName}`,
        data: {
          roomName,
          agentName,
          participantCount: participants.length,
          recentMessageCount: recentMessages.length,
          recentMessages: recentMessages.slice(0, 5) // Return last 5 for context
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to join room: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Send message to coordination room
   */
  async sendMessage(
    roomName: string,
    agentName: string,
    message: string,
    mentions?: string[]
  ): Promise<OrchestrationResult> {
    try {
      const sentMessage = await this.communicationService.sendMessage({
        roomName,
        agentName,
        message,
        mentions,
        messageType: 'standard' as MessageType
      });

      return {
        success: true,
        message: 'Message sent successfully',
        data: {
          messageId: sentMessage.id,
          roomName,
          agentName,
          mentions: mentions || []
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to send message: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Wait for messages in a room
   */
  async waitForMessages(
    roomName: string,
    timeout = 30000,
    sinceTimestamp?: Date
  ): Promise<OrchestrationResult> {
    try {
      const messages = await this.communicationService.waitForMessages(
        roomName,
        sinceTimestamp,
        timeout
      );

      return {
        success: true,
        message: `Retrieved ${messages.length} messages`,
        data: {
          messages,
          count: messages.length,
          roomName
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to wait for messages: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Store insights and learnings in shared memory
   */
  async storeMemory(
    repositoryPath: string,
    agentId: string,
    entryType: 'insight' | 'error' | 'decision' | 'progress',
    title: string,
    content: string,
    tags?: string[]
  ): Promise<OrchestrationResult> {
    try {
      let memory;

      switch (entryType) {
        case 'insight':
          memory = this.memoryService.storeInsight(repositoryPath, agentId, title, content, tags);
          break;
        case 'error':
          memory = this.memoryService.storeError(repositoryPath, agentId, content, {}, tags);
          break;
        case 'decision':
          memory = this.memoryService.storeDecision(repositoryPath, agentId, title, content, {}, tags);
          break;
        case 'progress':
          memory = this.memoryService.storeProgress(repositoryPath, agentId, title, content, {}, tags);
          break;
        default:
          throw new Error(`Unknown entry type: ${entryType}`);
      }

      return {
        success: true,
        message: `${entryType} stored successfully`,
        data: {
          memoryId: memory.id,
          entryType,
          title,
          agentId
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to store memory: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Search shared memory for insights
   */
  async searchMemory(
    repositoryPath: string,
    queryText: string,
    agentId?: string,
    limit = 10
  ): Promise<OrchestrationResult> {
    try {
      const insights = await this.memoryService.getRelevantMemories(
        queryText,
        repositoryPath,
        agentId,
        limit
      );

      return {
        success: true,
        message: `Found ${insights.length} relevant memories`,
        data: {
          insights,
          count: insights.length,
          query: queryText
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to search memory: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get list of active agents
   */
  async listAgents(repositoryPath: string, status?: AgentStatus, limit: number = 5, offset: number = 0): Promise<OrchestrationResult> {
    try {
      const agents = await this.agentService.listAgents(repositoryPath, status, limit, offset);

      return {
        success: true,
        message: `Found ${agents.length} agents`,
        data: {
          agents: agents.map(agent => ({
            id: agent.id,
            name: agent.agentName,
            status: agent.status,
            capabilities: agent.capabilities,
            lastHeartbeat: agent.lastHeartbeat,
            metadata: agent.agentMetadata
          })),
          count: agents.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to list agents: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Terminate one or more agents
   */
  async terminateAgent(agentIds: string[]): Promise<OrchestrationResult> {
    try {
      const ids = agentIds;
      const results: Array<{ agentId: string; success: boolean; error?: string }> = [];

      for (const agentId of ids) {
        try {
          // Use the AgentService's built-in terminate method
          await this.agentService.terminateAgent(agentId);
          
          results.push({
            agentId,
            success: true
          });

        } catch (error) {
          results.push({
            agentId,
            success: false,
            error: String(error)
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;

      return {
        success: failureCount === 0,
        message: `Terminated ${successCount}/${results.length} agents${failureCount > 0 ? ` (${failureCount} failed)` : ''}`,
        data: {
          results,
          successCount,
          failureCount,
          totalCount: results.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to terminate agents: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  // Private helper methods
  private generateArchitectPrompt(
    objective: string,
    repositoryPath: string,
    roomName: string,
    foundationSessionId?: string,
    masterTaskId?: string
  ): string {
    return `🏗️ ARCHITECT AGENT - Strategic Orchestration Leader

OBJECTIVE: ${objective}
REPOSITORY: ${repositoryPath}
COORDINATION ROOM: ${roomName}
FOUNDATION SESSION: ${foundationSessionId || 'none'}
MASTER TASK: ${masterTaskId || 'none'}

You are an autonomous architect agent with COMPLETE CLAUDE CODE CAPABILITIES.
You can use ALL tools: file operations, web browsing, code analysis, agent spawning, etc.

🎯 TASK-FIRST APPROACH:
Your orchestration centers around task management. You have been assigned master task ${masterTaskId || 'TBD'}.

PHASES:
1. RESEARCH & DISCOVERY
   - Join coordination room: join_room("${roomName}", "architect")
   - Search shared memory for relevant patterns: search_memory()
   - Analyze repository structure thoroughly
   
2. STRATEGIC PLANNING & TASK BREAKDOWN
   - Break objective into specialized sub-tasks using create_task()
   - Create hierarchical task structure with dependencies
   - Identify required agent types and capabilities for each task
   - Define dependency relationships between tasks
   - Store complete plan in shared memory: store_memory()
   
3. COORDINATED EXECUTION
   - spawn_agent() specialist agents with specific task assignments
   - Monitor progress through room messages: wait_for_messages()
   - Create sub-tasks as needed for complex work
   - Handle conflicts and dependencies
   - Ensure quality gates and completion criteria
   
4. COMPLETION & HANDOFF
   - Verify all tasks completed successfully
   - Update master task status
   - Document learnings in shared memory
   - Provide final status report

AVAILABLE ORCHESTRATION TOOLS:
- create_task() - Create sub-tasks with dependencies and requirements
- spawn_agent() - Create specialized agents (they'll be prompted to use task tools)
- join_room() - Join coordination rooms
- send_message() - Communicate with agents
- wait_for_messages() - Monitor conversations
- store_memory() - Share insights and decisions
- search_memory() - Learn from previous work
- list_agents() - Check agent status

CRITICAL TASK MANAGEMENT:
- Always use create_task() to break down work into manageable pieces
- Create sub-tasks for complex objectives
- Assign tasks to agents when spawning them
- Monitor task completion and update statuses
- Use task dependencies to coordinate agent work

CRITICAL: You have COMPLETE autonomy. Use any tools needed to succeed.
Start by joining the coordination room and creating a task breakdown for the objective.`;
  }

  private generateAgentPrompt(agentType: string, taskDescription: string, repositoryPath: string): string {
    const basePrompt = `You are a fully autonomous ${agentType} agent with COMPLETE CLAUDE CODE CAPABILITIES.

TASK: ${taskDescription}
REPOSITORY: ${repositoryPath}

You have access to ALL tools:
- File operations (Read, Write, Edit, Search, etc.)
- Code analysis and refactoring
- Web browsing and research
- System commands and build tools
- Git operations
- Database queries
- Agent coordination tools (spawn_agent, join_room, send_message, etc.)
- Shared memory and communication (store_memory, search_memory, etc.)
- Task management tools (create_task, list_tasks, update_task, etc.)

🎯 TASK-DRIVEN OPERATION:
- You are expected to work in a task-driven manner
- Use create_task() to break down complex work into manageable pieces
- Create sub-tasks when your assigned work is complex
- Update task progress regularly and report completion
- Use task dependencies to coordinate with other agents

AUTONOMOUS OPERATION GUIDELINES:
- Work independently to complete your assigned task
- Use any tools necessary for success
- Coordinate with other agents when beneficial
- Store insights and learnings in shared memory
- Report progress in coordination rooms
- Make decisions and take actions as needed

COORDINATION TOOLS AVAILABLE:
- create_task() - Break down complex work into sub-tasks
- join_room() - Join project coordination rooms
- send_message() - Communicate with other agents
- store_memory() - Share knowledge and insights
- search_memory() - Learn from previous work
- spawn_agent() - Create helper agents if needed

CRITICAL TASK MANAGEMENT:
- Always assess if your work needs to be broken into sub-tasks
- Create sub-tasks for complex implementations
- Report progress and completion status
- Use task dependencies to coordinate sequencing with other agents

CRITICAL: You are fully autonomous. Think, plan, and execute independently.`;

    // Add role-specific instructions
    const roleInstructions = this.getRoleInstructions(agentType);
    return basePrompt + roleInstructions;
  }

  private getRoleInstructions(agentType: string): string {
    const instructions: Record<string, string> = {
      'backend': `

BACKEND AGENT SPECIALIZATION:
- Focus on server-side implementation
- Database design and API development
- Security and performance optimization
- Integration testing and validation
- Use appropriate frameworks and libraries
- Follow security best practices`,

      'frontend': `

FRONTEND AGENT SPECIALIZATION:
- User interface and user experience
- Component design and state management
- Responsive design and accessibility
- Client-side testing and optimization
- Modern UI frameworks and patterns
- Cross-browser compatibility`,

      'testing': `

TESTING AGENT SPECIALIZATION:
- Comprehensive test strategy and implementation
- Unit, integration, and end-to-end testing
- Test automation and CI/CD integration
- Quality assurance and bug detection
- Performance and load testing
- Coverage analysis and reporting`,

      'documentation': `

DOCUMENTATION AGENT SPECIALIZATION:
- Technical documentation and guides
- API documentation and examples
- User manuals and tutorials
- Knowledge base maintenance
- Code documentation and comments
- Architecture decision records`,

      'devops': `

DEVOPS AGENT SPECIALIZATION:
- Infrastructure as code
- CI/CD pipeline optimization
- Container orchestration
- Monitoring and logging
- Security and compliance
- Performance optimization`,

      'researcher': `

RESEARCH AGENT SPECIALIZATION:
- Technology research and analysis
- Best practices investigation
- Competitive analysis
- Documentation scraping and analysis
- Trend analysis and recommendations
- Knowledge synthesis and reporting`
    };

    return instructions[agentType] || `

SPECIALIST AGENT:
- Apply your expertise to the specific task
- Follow best practices in your domain
- Collaborate effectively with other agents
- Deliver high-quality results
- Document your decisions and learnings`;
  }

  private async checkDependencies(dependsOn: string[]): Promise<{ success: boolean; message: string; data?: any }> {
    const missingDeps: string[] = [];

    for (const depId of dependsOn) {
      const agent = await this.agentService.getAgent(depId);
      if (!agent) {
        missingDeps.push(depId);
      } else if (agent.status !== 'completed' && agent.status !== 'active') {
        missingDeps.push(`${depId} (status: ${agent.status})`);
      }
    }

    if (missingDeps.length > 0) {
      return {
        success: false,
        message: `Missing or incomplete dependencies: ${missingDeps.join(', ')}`,
        data: missingDeps
      };
    }

    return { success: true, message: 'All dependencies satisfied' };
  }

  /**
   * Close a communication room (soft delete - marks as closed but keeps data)
   */
  async closeRoom(roomName: string, terminateAgents: boolean = true): Promise<OrchestrationResult> {
    try {
      // Get room info to find associated agents
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        return {
          success: false,
          message: `Room '${roomName}' not found`,
          data: { roomName }
        };
      }

      let terminatedAgents: string[] = [];
      
      if (terminateAgents) {
        // Find agents in this room and terminate them
        const agents = await this.agentService.listAgents(room.repositoryPath);
        const roomAgents = agents.filter(agent => 
          agent.agentMetadata?.roomName === roomName || 
          agent.status === 'active' // Terminate active agents as safety measure
        );
        
        if (roomAgents.length > 0) {
          const agentIds = roomAgents.map(a => a.id);
          const terminationResult = await this.terminateAgent(agentIds);
          terminatedAgents = agentIds;
        }
      }

      // Mark room as closed by updating metadata
      await this.communicationService.updateRoomMetadata(roomName, {
        ...room.roomMetadata,
        status: 'closed',
        closedAt: new Date().toISOString(),
        terminatedAgents
      });
      
      return {
        success: true,
        message: `Room '${roomName}' closed successfully${terminateAgents ? ` and ${terminatedAgents.length} agents terminated` : ''}`,
        data: { 
          roomName, 
          terminatedAgents,
          agentCount: terminatedAgents.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to close room '${roomName}': ${error}`,
        data: { error: String(error), roomName }
      };
    }
  }

  /**
   * Permanently delete a communication room and all its messages
   */
  async deleteRoom(roomName: string, forceDelete: boolean = false): Promise<OrchestrationResult> {
    try {
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        return {
          success: false,
          message: `Room '${roomName}' not found`,
          data: { roomName }
        };
      }

      // Check if room is closed or force delete
      const isClosed = room.roomMetadata?.status === 'closed';
      if (!isClosed && !forceDelete) {
        return {
          success: false,
          message: `Room '${roomName}' must be closed before deletion. Use force_delete=true to override.`,
          data: { roomName, suggestion: 'close_room_first' }
        };
      }

      // Terminate any remaining agents
      const agents = await this.agentService.listAgents(room.repositoryPath);
      const roomAgents = agents.filter(agent => 
        agent.agentMetadata?.roomName === roomName
      );
      
      if (roomAgents.length > 0) {
        await this.terminateAgent(roomAgents.map(a => a.id));
      }

      // Delete the room
      await this.communicationService.deleteRoom(roomName);
      
      return {
        success: true,
        message: `Room '${roomName}' permanently deleted`,
        data: { 
          roomName,
          messagesDeleted: true,
          agentsTerminated: roomAgents.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to delete room '${roomName}': ${error}`,
        data: { error: String(error), roomName }
      };
    }
  }

  /**
   * List communication rooms with filtering and pagination
   */
  async listRooms(
    repositoryPath: string, 
    status?: 'active' | 'closed' | 'all',
    limit: number = 20,
    offset: number = 0
  ): Promise<OrchestrationResult> {
    try {
      const allRooms = await this.communicationService.listRooms(repositoryPath);
      
      // Filter by status
      let filteredRooms = allRooms;
      if (status && status !== 'all') {
        filteredRooms = allRooms.filter(room => {
          const roomStatus = room.roomMetadata?.status || 'active';
          return roomStatus === status;
        });
      }

      // Apply pagination
      const total = filteredRooms.length;
      const paginatedRooms = filteredRooms.slice(offset, offset + limit);

      return {
        success: true,
        message: `Found ${total} rooms${status ? ` with status '${status}'` : ''}`,
        data: {
          rooms: paginatedRooms.map(room => ({
            name: room.name,
            description: room.description,
            repositoryPath: room.repositoryPath,
            status: room.roomMetadata?.status || 'active',
            createdAt: room.createdAt,
            closedAt: room.roomMetadata?.closedAt,
            metadata: room.roomMetadata
          })),
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to list rooms: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * List messages from a specific room with pagination
   */
  async listRoomMessages(
    roomName: string,
    limit: number = 50,
    offset: number = 0,
    sinceTimestamp?: string
  ): Promise<OrchestrationResult> {
    try {
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        return {
          success: false,
          message: `Room '${roomName}' not found`,
          data: { roomName }
        };
      }

      const since = sinceTimestamp ? new Date(sinceTimestamp) : undefined;
      const messages = await this.communicationService.getMessages(roomName, limit + offset, since);
      
      // Apply offset manually since the service doesn't support it
      const paginatedMessages = messages.slice(offset, offset + limit);

      return {
        success: true,
        message: `Retrieved ${paginatedMessages.length} messages from room '${roomName}'`,
        data: {
          roomName,
          messages: paginatedMessages.map(msg => ({
            id: msg.id,
            agentName: msg.agentName,
            message: msg.message,
            mentions: msg.mentions,
            messageType: msg.messageType,
            timestamp: msg.timestamp
          })),
          pagination: {
            total: messages.length,
            limit,
            offset,
            hasMore: offset + limit < messages.length
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to list messages: ${error}`,
        data: { error: String(error) }
      };
    }
  }
}