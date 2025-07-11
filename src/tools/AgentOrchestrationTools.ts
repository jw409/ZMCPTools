import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { DatabaseManager } from '../database/index.js';
import { AgentService, TaskService, CommunicationService, KnowledgeGraphService } from '../services/index.js';
import { WebScrapingService } from '../services/WebScrapingService.js';
import { AgentMonitoringService } from '../services/AgentMonitoringService.js';
import { ProgressTracker } from '../services/ProgressTracker.js';
import { ClaudeSpawner } from '../process/ClaudeSpawner.js';
import type { TaskType, AgentStatus, MessageType, EntityType } from '../schemas/index.js';

// Import centralized request schemas
import {
  OrchestrationObjectiveSchema,
  SpawnAgentSchema,
  CreateTaskSchema,
  JoinRoomSchema,
  SendMessageSchema,
  WaitForMessagesSchema,
  StoreMemorySchema,
  SearchMemorySchema,
  ListAgentsSchema,
  TerminateAgentSchema,
  CloseRoomSchema,
  DeleteRoomSchema,
  ListRoomsSchema,
  ListRoomMessagesSchema,
  MonitorAgentsSchema
} from '../schemas/tools/agentOrchestration.js';

// Import centralized response schemas
import {
  AgentOrchestrationResponseSchema,
  createSuccessResponse,
  createErrorResponse,
  type AgentOrchestrationResponse
} from '../schemas/toolResponses.js';

// Import individual response schemas
import {
  OrchestrationObjectiveResponseSchema,
  SpawnAgentResponseSchema,
  CreateTaskResponseSchema,
  JoinRoomResponseSchema,
  SendMessageResponseSchema,
  WaitForMessagesResponseSchema,
  StoreMemoryResponseSchema,
  SearchMemoryResponseSchema,
  ListAgentsResponseSchema,
  TerminateAgentResponseSchema,
  CloseRoomResponseSchema,
  DeleteRoomResponseSchema,
  ListRoomsResponseSchema,
  ListRoomMessagesResponseSchema,
  MonitorAgentsResponseSchema
} from '../schemas/tools/agentOrchestration.js';
import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

// Legacy types for backward compatibility
export const OrchestrationResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.any().optional(),
});

export const SpawnAgentOptionsSchema = z.object({
  agentType: z.string(),
  repositoryPath: z.string(),
  taskDescription: z.string(),
  capabilities: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;
export type SpawnAgentOptions = z.infer<typeof SpawnAgentOptionsSchema>;

export class AgentOrchestrationTools {
  private agentService: AgentService;
  private taskService: TaskService;
  private communicationService: CommunicationService;
  private knowledgeGraphService: KnowledgeGraphService;
  private webScrapingService: WebScrapingService;
  private monitoringService: AgentMonitoringService;
  private progressTracker: ProgressTracker;

  constructor(private db: DatabaseManager, repositoryPath: string) {
    this.agentService = new AgentService(db);
    this.taskService = new TaskService(db);
    this.communicationService = new CommunicationService(db);
    // Initialize KnowledgeGraphService with VectorSearchService
    this.initializeKnowledgeGraphService(db);
    this.webScrapingService = new WebScrapingService(
      db,
      repositoryPath
    );
    this.monitoringService = new AgentMonitoringService(db, repositoryPath);
    this.progressTracker = new ProgressTracker(db);
  }

  private async initializeKnowledgeGraphService(db: DatabaseManager): Promise<void> {
    try {
      const { VectorSearchService } = await import('../services/VectorSearchService.js');
      const vectorService = new VectorSearchService(db);
      this.knowledgeGraphService = new KnowledgeGraphService(db, vectorService);
    } catch (error) {
      console.warn('Failed to initialize KnowledgeGraphService:', error);
      // Fallback to a minimal implementation that doesn't crash
      this.knowledgeGraphService = {
        createEntity: async () => ({ id: 'fallback', name: 'fallback' }),
        findEntitiesBySemanticSearch: async () => []
      } as any;
    }
  }

  /**
   * Get MCP tools for agent orchestration
   * Returns properly structured Tool objects with MCP schema compliance
   */
  getTools() {
    return [
      {
        name: 'orchestrate_objective',
        description: 'Spawn architect agent to coordinate multi-agent objective completion',
        inputSchema: z.toJSONSchema(OrchestrationObjectiveSchema) as any,
        outputSchema: z.toJSONSchema(OrchestrationObjectiveResponseSchema) as any,
      },
      {
        name: 'spawn_agent',
        description: 'Spawn fully autonomous Claude agent with complete tool access',
        inputSchema: z.toJSONSchema(SpawnAgentSchema) as any,
        outputSchema: z.toJSONSchema(SpawnAgentResponseSchema) as any
      },
      {
        name: 'create_task',
        description: 'Create and assign task to agents with enhanced capabilities',
        inputSchema: z.toJSONSchema(CreateTaskSchema) as any,
        outputSchema: z.toJSONSchema(CreateTaskResponseSchema) as any
      },
      {
        name: 'join_room',
        description: 'Join communication room for coordination',
        inputSchema: z.toJSONSchema(JoinRoomSchema) as any,
        outputSchema: z.toJSONSchema(JoinRoomResponseSchema) as any
      },
      {
        name: 'send_message',
        description: 'Send message to coordination room',
        inputSchema: z.toJSONSchema(SendMessageSchema) as any,
        outputSchema: z.toJSONSchema(SendMessageResponseSchema) as any
      },
      {
        name: 'wait_for_messages',
        description: 'Wait for messages in a room',
        inputSchema: z.toJSONSchema(WaitForMessagesSchema) as any,
        outputSchema: z.toJSONSchema(WaitForMessagesResponseSchema) as any
      },
      {
        name: 'store_memory',
        description: 'Store insights and learnings in shared memory',
        inputSchema: z.toJSONSchema(StoreMemorySchema) as any,
        outputSchema: z.toJSONSchema(StoreMemoryResponseSchema) as any
      },
      {
        name: 'search_memory',
        description: 'Search shared memory for insights',
        inputSchema: z.toJSONSchema(SearchMemorySchema) as any,
        outputSchema: z.toJSONSchema(SearchMemoryResponseSchema) as any
      },
      {
        name: 'list_agents',
        description: 'Get list of active agents',
        inputSchema: z.toJSONSchema(ListAgentsSchema) as any,
        outputSchema: z.toJSONSchema(ListAgentsResponseSchema) as any
      },
      {
        name: 'terminate_agent',
        description: 'Terminate one or more agents',
        inputSchema: z.toJSONSchema(TerminateAgentSchema) as any,
        outputSchema: z.toJSONSchema(TerminateAgentResponseSchema) as any
      },
      {
        name: 'close_room',
        description: 'Close a communication room (soft delete - marks as closed but keeps data)',
        inputSchema: z.toJSONSchema(CloseRoomSchema) as any,
        outputSchema: z.toJSONSchema(CloseRoomResponseSchema) as any
      },
      {
        name: 'delete_room',
        description: 'Permanently delete a communication room and all its messages',
        inputSchema: z.toJSONSchema(DeleteRoomSchema) as any,
        outputSchema: z.toJSONSchema(DeleteRoomResponseSchema) as any
      },
      {
        name: 'list_rooms',
        description: 'List communication rooms with filtering and pagination',
        inputSchema: z.toJSONSchema(ListRoomsSchema) as any,
        outputSchema: z.toJSONSchema(ListRoomsResponseSchema) as any
      },
      {
        name: 'list_room_messages',
        description: 'List messages from a specific room with pagination',
        inputSchema: z.toJSONSchema(ListRoomMessagesSchema) as any,
        outputSchema: z.toJSONSchema(ListRoomMessagesResponseSchema) as any
      },
      {
        name: 'monitor_agents',
        description: 'Monitor agents with real-time updates using EventBus system',
        inputSchema: z.toJSONSchema(MonitorAgentsSchema) as any,
        outputSchema: z.toJSONSchema(MonitorAgentsResponseSchema) as any
      }
    ];
  }

  /**
   * Handle MCP tool calls for agent orchestration
   * Routes tool calls to appropriate methods and ensures proper response format
   */
  async handleToolCall(name: string, args: any): Promise<AgentOrchestrationResponse> {
    const startTime = performance.now();
    
    try {
      let result: any;
      
      switch (name) {
        case 'orchestrate_objective':
          const orchestrationArgs = OrchestrationObjectiveSchema.parse(args);
          result = await this.orchestrateObjective(
            orchestrationArgs.title,
            orchestrationArgs.objective,
            orchestrationArgs.repositoryPath,
            orchestrationArgs.foundationSessionId
          );
          break;
          
        case 'spawn_agent':
          const spawnArgs = SpawnAgentSchema.parse(args);
          result = await this.spawnAgent({
            agentType: spawnArgs.agentType,
            repositoryPath: spawnArgs.repositoryPath,
            taskDescription: spawnArgs.taskDescription,
            capabilities: spawnArgs.capabilities,
            dependsOn: spawnArgs.dependsOn,
            metadata: spawnArgs.metadata
          });
          break;
          
        case 'create_task':
          const taskArgs = CreateTaskSchema.parse(args);
          result = await this.createTask(
            taskArgs.repositoryPath,
            taskArgs.taskType,
            taskArgs.title,
            taskArgs.description,
            taskArgs.requirements,
            taskArgs.dependencies
          );
          break;
          
        case 'join_room':
          const joinArgs = JoinRoomSchema.parse(args);
          result = await this.joinRoom(joinArgs.roomName, joinArgs.agentName);
          break;
          
        case 'send_message':
          const messageArgs = SendMessageSchema.parse(args);
          result = await this.sendMessage(
            messageArgs.roomName,
            messageArgs.agentName,
            messageArgs.message,
            messageArgs.mentions
          );
          break;
          
        case 'wait_for_messages':
          const waitArgs = WaitForMessagesSchema.parse(args);
          result = await this.waitForMessages(
            waitArgs.roomName,
            waitArgs.timeout,
            waitArgs.sinceTimestamp ? new Date(waitArgs.sinceTimestamp) : undefined
          );
          break;
          
        case 'store_memory':
          const storeArgs = StoreMemorySchema.parse(args);
          result = await this.storeMemory(
            storeArgs.repositoryPath,
            storeArgs.agentId,
            storeArgs.entryType,
            storeArgs.title,
            storeArgs.content,
            storeArgs.tags
          );
          break;
          
        case 'search_memory':
          const searchArgs = SearchMemorySchema.parse(args);
          result = await this.searchMemory(
            searchArgs.repositoryPath,
            searchArgs.queryText,
            searchArgs.agentId,
            searchArgs.limit
          );
          break;
          
        case 'list_agents':
          const listArgs = ListAgentsSchema.parse(args);
          result = await this.listAgents(
            listArgs.repositoryPath,
            listArgs.status,
            listArgs.limit,
            listArgs.offset
          );
          break;
          
        case 'terminate_agent':
          const terminateArgs = TerminateAgentSchema.parse(args);
          result = await this.terminateAgent(terminateArgs.agentIds);
          break;
          
        case 'close_room':
          const closeArgs = CloseRoomSchema.parse(args);
          result = await this.closeRoom(closeArgs.roomName, closeArgs.terminateAgents);
          break;
          
        case 'delete_room':
          const deleteArgs = DeleteRoomSchema.parse(args);
          result = await this.deleteRoom(deleteArgs.roomName, deleteArgs.forceDelete);
          break;
          
        case 'list_rooms':
          const listRoomsArgs = ListRoomsSchema.parse(args);
          result = await this.listRooms(
            listRoomsArgs.repositoryPath,
            listRoomsArgs.status,
            listRoomsArgs.limit,
            listRoomsArgs.offset
          );
          break;
          
        case 'list_room_messages':
          const listMessagesArgs = ListRoomMessagesSchema.parse(args);
          result = await this.listRoomMessages(
            listMessagesArgs.roomName,
            listMessagesArgs.limit,
            listMessagesArgs.offset,
            listMessagesArgs.sinceTimestamp
          );
          break;
          
        case 'monitor_agents':
          const monitorArgs = MonitorAgentsSchema.parse(args);
          result = await this.monitorAgents(
            monitorArgs.agentId,
            monitorArgs.orchestrationId,
            monitorArgs.roomName,
            monitorArgs.repositoryPath,
            monitorArgs.monitoringMode,
            monitorArgs.updateInterval,
            monitorArgs.maxDuration,
            monitorArgs.detailLevel
          );
          break;
          
        default:
          throw new Error(`Unknown agent orchestration tool: ${name}`);
      }
      
      const executionTime = performance.now() - startTime;
      
      // Transform legacy OrchestrationResult to MCP format
      if (result && typeof result === 'object' && 'success' in result) {
        return createSuccessResponse(
          result.message || `${name} completed successfully`,
          this.transformResultData(result, name),
          executionTime
        ) as AgentOrchestrationResponse;
      } else {
        return createSuccessResponse(
          `${name} completed successfully`,
          this.transformResultData(result, name),
          executionTime
        ) as AgentOrchestrationResponse;
      }
    } catch (error) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        `${name} failed to execute`,
        error instanceof Error ? error.message : 'Unknown error occurred',
        'AGENT_ORCHESTRATION_ERROR'
      ) as AgentOrchestrationResponse;
    }
  }

  /**
   * Transform legacy result data to match AgentOrchestrationResponse schema
   */
  private transformResultData(result: any, toolName: string): any {
    if (!result || typeof result !== 'object') {
      return { monitoring_data: result };
    }
    
    const data: any = {};
    
    // Map common fields based on the result structure
    if (result.data) {
      // Handle nested data structure
      const resultData = result.data;
      
      if (resultData.agentId) data.agent_id = resultData.agentId;
      if (resultData.taskId) data.task_id = resultData.taskId;
      if (resultData.roomName) data.room_name = resultData.roomName;
      if (resultData.orchestrationId) data.orchestration_id = resultData.orchestrationId;
      if (resultData.architectAgentId) data.agent_id = resultData.architectAgentId;
      if (resultData.masterTaskId) data.task_id = resultData.masterTaskId;
      
      // Handle arrays
      if (resultData.agents) data.agents = resultData.agents;
      if (resultData.messages) data.messages = resultData.messages;
      if (resultData.rooms) data.rooms = resultData.rooms;
      if (resultData.insights) data.memory_entries = resultData.insights;
      
      // Handle monitoring data
      if (resultData.monitoringType || resultData.finalStatus) {
        data.monitoring_data = resultData;
      }
      
      // Handle coordination patterns
      if (resultData.patterns || resultData.analytics) {
        data.patterns = resultData;
      }
      
      // Include any additional data
      Object.keys(resultData).forEach(key => {
        const mappedFields = ['agentId', 'taskId', 'roomName', 'orchestrationId', 'architectAgentId', 'masterTaskId', 'agents', 'messages', 'rooms', 'insights'];
        if (!mappedFields.includes(key) && !data.hasOwnProperty(key)) {
          if (!data.patterns) data.patterns = {};
          data.patterns[key] = resultData[key];
        }
      });
    }
    
    return data;
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
      // 1. Create coordination room (orchestration always needs room)
      const roomName = `objective_${Date.now()}`;
      const room = await this.communicationService.createRoom({
        name: roomName,
        description: `Coordination room for: ${objective}`,
        repositoryPath,
        metadata: {
          objective,
          foundationSessionId,
          orchestrationMode: true,
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
          roomId: room.id,
          roomName,
          foundationSessionId,
          isOrchestrationTask: true,
          createdBy: 'orchestrateObjective'
        },
        priority: 10 // High priority for orchestration tasks
      });

      // 3. Store objective in knowledge graph with task reference
      try {
        await this.knowledgeGraphService.createEntity({
          id: `orchestration-${Date.now()}`,
          repositoryPath,
          entityType: 'insight',
          name: title,
          description: `Objective: ${objective}\n\nMulti-agent objective coordination started.\nRoom: ${roomName}\nFoundation Session: ${foundationSessionId || 'none'}\nMaster Task: ${masterTask.id}`,
          properties: { tags: ['objective', 'orchestration', 'coordination', 'task-creation'] },
          discoveredBy: 'system',
          discoveredDuring: 'orchestration',
          importanceScore: 0.9,
          confidenceScore: 1.0,
          relevanceScore: 0.9
        });
      } catch (error) {
        console.warn('Failed to store objective in knowledge graph:', error);
      }

      // 4. Generate architect prompt with task-first approach
      const architectPrompt = this.generateArchitectPrompt(objective, repositoryPath, roomName, foundationSessionId, masterTask.id);

      // 5. Spawn architect agent with full autonomy, task assignment, and room
      const architectAgent = await this.agentService.createAgent({
        agentName: 'architect',
        repositoryPath,
        taskDescription: `Orchestrate objective: ${objective}`,
        capabilities: ['ALL_TOOLS', 'orchestration', 'planning', 'coordination'],
        roomId: room.id, // Explicitly assign room for orchestration
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

      // 4. Store agent spawn in knowledge graph
      try {
        await this.knowledgeGraphService.createEntity({
          id: `agent-spawn-${Date.now()}`,
          repositoryPath,
          entityType: 'task',
          name: `Agent ${agentType} spawned`,
          description: `Successfully spawned ${agentType} agent for task: ${taskDescription}`,
          properties: {
            agentId: agent.id,
            agentType,
            capabilities,
            dependsOn,
            tags: ['agent-spawn', agentType]
          },
          discoveredBy: 'system',
          discoveredDuring: 'agent-spawn',
          importanceScore: 0.7,
          confidenceScore: 1.0,
          relevanceScore: 0.8
        });
      } catch (error) {
        console.warn('Failed to store agent spawn in knowledge graph:', error);
      }

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
   * Create and assign task to agents with enhanced capabilities
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
      // Create the task with enhanced features
      const task = await this.taskService.createTask({
        repositoryPath,
        taskType,
        description: `${title}: ${description}`,
        requirements,
        priority: requirements?.priority || 1,
        estimatedDuration: requirements?.estimatedDuration,
        tags: requirements?.tags || [taskType, 'orchestration']
      });

      // Add dependencies if specified
      if (dependencies && dependencies.length > 0) {
        for (const depId of dependencies) {
          await this.taskService.addTaskDependency(task.id, depId);
        }
      }

      // Auto-assign if agent specified
      if (requirements?.assignedAgentId) {
        await this.taskService.assignTask(task.id, requirements.assignedAgentId);
      }

      // Store task creation in knowledge graph with enhanced metadata
      try {
        await this.knowledgeGraphService.createEntity({
          id: `task-creation-${Date.now()}`,
          repositoryPath,
          entityType: 'task',
          name: `Task created: ${title}`,
          description: `Task ${task.id} created with type ${taskType}.\nDescription: ${description}\nPriority: ${task.priority}\nEstimated Duration: ${requirements?.estimatedDuration || 'N/A'} minutes`,
          properties: {
            taskId: task.id,
            taskType,
            dependencies: dependencies || [],
            priority: task.priority,
            estimatedDuration: requirements?.estimatedDuration,
            tags: ['task-creation', taskType, 'orchestration', ...(requirements?.tags || [])]
          },
          discoveredBy: 'system',
          discoveredDuring: 'task-creation',
          importanceScore: 0.8,
          confidenceScore: 1.0,
          relevanceScore: 0.8
        });
      } catch (error) {
        console.warn('Failed to store task creation in knowledge graph:', error);
      }

      return {
        success: true,
        message: 'Task created successfully with enhanced tracking',
        data: {
          taskId: task.id,
          taskType,
          status: task.status,
          priority: task.priority,
          estimatedDuration: requirements?.estimatedDuration,
          dependencies: dependencies || []
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
      const room = await this.communicationService.getRoom(roomName);
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
          roomId: room.id,
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
    entryType: EntityType,
    title: string,
    content: string,
    tags?: string[]
  ): Promise<OrchestrationResult> {
    try {
      let memory;

      try {
        memory = await this.knowledgeGraphService.createEntity({
          id: `memory-${Date.now()}`,
          repositoryPath,
          entityType: entryType,
          name: title,
          description: content,
          properties: { tags: tags || [] },
          discoveredBy: agentId,
          discoveredDuring: 'agent-work',
          importanceScore: 0.7,
          confidenceScore: 0.8,
          relevanceScore: 0.8
        });
      } catch (error) {
        console.warn('Failed to store memory in knowledge graph:', error);
        throw new Error(`Failed to store ${entryType}: ${error}`);
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
      const insights = await this.knowledgeGraphService.findEntitiesBySemanticSearch(
        repositoryPath,
        queryText,
        undefined, // entityTypes - search all types
        limit,
        0.7 // threshold
      );
      
      // Filter by agent if specified
      const filteredInsights = agentId 
        ? insights.filter(entity => entity.discoveredBy === agentId)
        : insights;

      return {
        success: true,
        message: `Found ${filteredInsights.length} relevant memories`,
        data: {
          insights: filteredInsights,
          count: filteredInsights.length,
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
    return `🏗️ ARCHITECT AGENT - Strategic Orchestration Leader with Sequential Thinking

OBJECTIVE: ${objective}
REPOSITORY: ${repositoryPath}
COORDINATION ROOM: ${roomName}
FOUNDATION SESSION: ${foundationSessionId || 'none'}
MASTER TASK: ${masterTaskId || 'none'}

You are an autonomous architect agent with COMPLETE CLAUDE CODE CAPABILITIES and advanced sequential thinking for complex planning.
You can use ALL tools: file operations, web browsing, code analysis, agent spawning, etc.

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
- search_memory() to learn from previous similar objectives
- Look for patterns in agent coordination, task breakdown, and execution strategies
- Identify reusable components and successful approaches from past work
- Use knowledge graph insights to inform your sequential thinking process

🎯 TASK-FIRST ORCHESTRATION APPROACH:
Your orchestration centers around hierarchical task management. You have been assigned master task ${masterTaskId || 'TBD'}.

ORCHESTRATION PHASES:

1. **STRATEGIC ANALYSIS WITH SEQUENTIAL THINKING**
   REQUIRED: Start with sequential_thinking() to analyze the objective:
   - Thought 1: Initial objective understanding and scope assessment
   - Thought 2: Complexity analysis and decomposition approach
   - Thought 3: Dependencies and execution strategy
   - Thought 4: Agent coordination requirements
   - Thought 5: Risk assessment and mitigation planning
   - Continue iterative refinement as needed
   
2. **KNOWLEDGE GRAPH DISCOVERY**
   - Join coordination room: join_room("${roomName}", "architect")
   - Search shared memory for relevant patterns: search_memory()
   - Query previous orchestration experiences: search_memory("orchestration patterns")
   - Analyze repository structure thoroughly
   - Identify reusable components and successful approaches
   
3. **STRUCTURED TASK BREAKDOWN WITH SEQUENTIAL THINKING**
   REQUIRED: Use sequential_thinking() for task decomposition:
   - Analyze objective components systematically
   - Create hierarchical task structure with dependencies
   - Define agent specialization requirements
   - Plan execution sequencing and coordination
   - Store complete plan in shared memory: store_memory()
   
4. **COORDINATED AGENT EXECUTION**
   - spawn_agent() specialist agents with specific task assignments
   - Create sub-tasks using create_task() for complex work
   - Monitor progress through room messages: wait_for_messages()
   - Handle conflicts and dependencies proactively
   - Ensure quality gates and completion criteria
   
5. **CONTINUOUS MONITORING & ADAPTATION**
   - Monitor agent progress and identify bottlenecks
   - Use sequential_thinking() for problem-solving when issues arise
   - Adapt coordination strategy based on real-time feedback
   - Create additional tasks or agents as needed
   
6. **COMPLETION & KNOWLEDGE CAPTURE**
   - Verify all tasks completed successfully
   - Update master task status
   - Document learnings and patterns in shared memory
   - Provide comprehensive final status report

AVAILABLE ORCHESTRATION TOOLS:
- sequential_thinking() - Step-by-step problem decomposition and planning
- create_task() - Create sub-tasks with dependencies and requirements
- spawn_agent() - Create specialized agents (they'll be prompted to use task tools)
- join_room() - Join coordination rooms
- send_message() - Communicate with agents
- wait_for_messages() - Monitor conversations
- store_memory() - Share insights, decisions, and patterns
- search_memory() - Learn from previous work and knowledge graph
- list_agents() - Check agent status and coordination needs

CRITICAL SEQUENTIAL THINKING USAGE:
- ALWAYS start with sequential_thinking() for initial objective analysis
- Use sequential_thinking() for complex task decomposition
- Apply sequential thinking when encountering problems or roadblocks
- Use iterative thinking to refine and improve your approach
- Consider alternative paths and risk mitigation systematically
- Document your reasoning process in shared memory

CRITICAL KNOWLEDGE GRAPH INTEGRATION:
- Search memory before planning to leverage previous experiences
- Look for patterns in similar objectives and successful approaches
- Use knowledge graph insights to inform your sequential thinking
- Store new insights and patterns for future orchestration
- Build upon successful coordination strategies from past work

CRITICAL TASK MANAGEMENT:
- Always use create_task() to break down work into manageable pieces
- Create hierarchical task structures with clear dependencies
- Assign tasks to agents when spawning them
- Monitor task completion and update statuses regularly
- Use task dependencies to coordinate agent work effectively

ORCHESTRATION BEST PRACTICES:
1. Begin with sequential_thinking() to understand the objective thoroughly
2. Search knowledge graph for relevant patterns and successful approaches
3. Create a structured task breakdown with clear dependencies
4. Spawn specialized agents with specific, well-defined tasks
5. Monitor progress continuously and adapt strategy as needed
6. Document learnings and patterns for future orchestration

CRITICAL: You have COMPLETE autonomy with advanced sequential thinking capabilities.
Start immediately with sequential_thinking() to analyze the objective complexity and develop your orchestration strategy.`;
  }

  private generateAgentPrompt(agentType: string, taskDescription: string, repositoryPath: string): string {
    const basePrompt = `You are a fully autonomous ${agentType} agent with COMPLETE CLAUDE CODE CAPABILITIES and advanced sequential thinking.

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
- Sequential thinking tool (sequential_thinking) for complex problem solving

🧠 SEQUENTIAL THINKING METHODOLOGY:
You have access to the sequential_thinking tool for complex problem decomposition and solution development.
Use this tool systematically for complex challenges:

1. **Problem Analysis**: Use sequential_thinking() to understand the challenge scope
2. **Solution Planning**: Break down the approach into logical steps
3. **Implementation Strategy**: Plan execution with considerations for dependencies
4. **Risk Assessment**: Identify potential issues and mitigation strategies
5. **Quality Assurance**: Plan testing and validation approaches
6. **Iterative Refinement**: Revise and improve your approach as understanding deepens

🎯 KNOWLEDGE GRAPH INTEGRATION:
Before starting work, search for relevant knowledge and patterns:
- search_memory() to learn from previous similar tasks
- Look for patterns in successful implementations
- Identify reusable components and established approaches
- Use knowledge graph insights to inform your sequential thinking process

🎯 TASK-DRIVEN OPERATION:
- You are expected to work in a task-driven manner
- Use sequential_thinking() for complex problem analysis
- Use create_task() to break down complex work into manageable pieces
- Create sub-tasks when your assigned work is complex
- Update task progress regularly and report completion
- Use task dependencies to coordinate with other agents

AUTONOMOUS OPERATION GUIDELINES:
- Work independently to complete your assigned task
- Use sequential_thinking() for complex problem solving
- Use any tools necessary for success
- Search knowledge graph before implementing to leverage previous work
- Coordinate with other agents when beneficial
- Store insights and learnings in shared memory
- Report progress in coordination rooms
- Make decisions and take actions as needed

COORDINATION TOOLS AVAILABLE:
- sequential_thinking() - Step-by-step problem decomposition
- create_task() - Break down complex work into sub-tasks
- join_room() - Join project coordination rooms
- send_message() - Communicate with other agents
- store_memory() - Share knowledge, insights, and patterns
- search_memory() - Learn from previous work and knowledge graph
- spawn_agent() - Create helper agents if needed

CRITICAL SEQUENTIAL THINKING USAGE:
- Use sequential_thinking() for complex implementation challenges
- Break down multi-step processes systematically
- Revise and refine your approach as understanding deepens
- Consider alternative solutions and trade-offs
- Use iterative thinking to improve solution quality
- Document your reasoning process in shared memory

CRITICAL KNOWLEDGE GRAPH INTEGRATION:
- Search memory before implementing to leverage previous experiences
- Look for patterns in similar tasks and successful approaches
- Use knowledge graph insights to inform your sequential thinking
- Store new insights and patterns for future tasks
- Build upon successful implementation strategies from past work

CRITICAL TASK MANAGEMENT:
- Always assess if your work needs to be broken into sub-tasks
- Create sub-tasks for complex implementations
- Report progress and completion status
- Use task dependencies to coordinate sequencing with other agents

IMPLEMENTATION BEST PRACTICES:
1. Begin with sequential_thinking() to understand the task thoroughly
2. Search knowledge graph for relevant patterns and successful approaches
3. Create a structured implementation plan with clear steps
4. Execute systematically with continuous validation
5. Document learnings and patterns for future tasks

CRITICAL: You are fully autonomous with advanced sequential thinking capabilities.
Start with sequential_thinking() to analyze your task and develop your implementation strategy.`;

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
          agent.agentMetadata?.roomId === room.id || 
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
        agent.agentMetadata?.roomId === room.id || 
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
            id: room.id,
            name: room.name,
            description: room.description,
            repositoryPath: room.repositoryPath,
            isGeneral: room.isGeneral,
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
          roomId: room.id,
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

  /**
   * Create a room when agents realize they need coordination
   */
  async createRoomForAgent(
    agentId: string,
    repositoryPath: string,
    reason: string,
    participants: string[] = []
  ): Promise<OrchestrationResult> {
    try {
      const agent = await this.agentService.getAgent(agentId);
      if (!agent) {
        return {
          success: false,
          message: `Agent ${agentId} not found`,
          data: { agentId }
        };
      }

      // Use the CommunicationService's createRoomForAgent method
      const result = await this.communicationService.createRoomForAgent(
        agent.agentName,
        repositoryPath,
        reason,
        participants
      );

      // Update agent with new room ID
      await this.agentService.updateAgentStatus(agentId, {
        status: agent.status,
        metadata: {
          ...agent.agentMetadata,
          roomId: result.roomName,
          roomCreatedAt: new Date().toISOString()
        }
      });

      // Store coordination event in knowledge graph
      try {
        await this.knowledgeGraphService.createEntity({
          id: `coord-room-${Date.now()}`,
          repositoryPath,
          entityType: 'task',
          name: 'On-demand room creation',
          description: `Created coordination room ${result.roomName} for reason: ${reason}`,
          properties: {
            roomName: result.roomName,
            reason,
            participants,
            tags: ['on-demand-coordination', 'room-creation']
          },
          discoveredBy: agentId,
          discoveredDuring: 'room-creation',
          importanceScore: 0.6,
          confidenceScore: 1.0,
          relevanceScore: 0.7
        });
      } catch (error) {
        console.warn('Failed to store coordination event in knowledge graph:', error);
      }

      return {
        success: true,
        message: `Coordination room '${result.roomName}' created successfully`,
        data: {
          roomName: result.roomName,
          agentId,
          reason,
          participants,
          initiatingAgent: agent.agentName
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to create room for agent: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Create a delayed room for coordination when agents realize they need it
   */
  async createDelayedRoom(
    agentId: string,
    repositoryPath: string,
    reason: string,
    participants: string[] = []
  ): Promise<OrchestrationResult> {
    try {
      // Generate room name based on reason and timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const roomName = `coordination-${reason.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${timestamp}`;
      
      // Create the room
      const room = await this.communicationService.createRoom({
        name: roomName,
        description: `Coordination room created by ${agentId} for: ${reason}`,
        repositoryPath,
        metadata: { type: 'coordination', participants: [...participants, agentId] }
      });
      
      // Join the requesting agent to the room
      await this.communicationService.joinRoom(room.name, agentId);
      
      // Join other participants if they exist
      for (const participantId of participants) {
        try {
          await this.communicationService.joinRoom(room.name, participantId);
        } catch (error) {
          // Log warning but don't fail the entire operation
          console.warn(`Failed to add participant ${participantId} to room ${room.name}: ${error}`);
        }
      }
      
      // Send initial coordination message
      await this.communicationService.sendMessage({
        roomName: room.name,
        agentName: agentId,
        message: `Coordination room created. Reason: ${reason}`,
        messageType: 'coordination'
      });
      
      return {
        success: true,
        message: `Delayed coordination room created successfully`,
        data: {
          roomName: room.name,
          reason,
          participants: [...participants, agentId],
          createdAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create delayed room: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Analyze coordination patterns and suggest improvements
   */
  async analyzeCoordinationPatterns(repositoryPath: string): Promise<OrchestrationResult> {
    try {
      // Simple analysis of room usage patterns
      const rooms = await this.communicationService.listRooms(repositoryPath);
      const totalRooms = rooms.length;
      const activeRooms = rooms.filter(room => room.roomMetadata?.status !== 'closed').length;
      
      // Basic recommendations based on room usage
      const recommendations = [
        'Consider using memory-based coordination for simple tasks',
        'Use task status updates for sequential workflows',
        'Reserve rooms for multi-agent collaboration',
        'Clean up unused rooms regularly'
      ];

      return {
        success: true,
        message: `Coordination analysis complete for ${repositoryPath}`,
        data: {
          totalRooms,
          activeRooms,
          recommendations
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to analyze coordination patterns: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get task analytics and insights
   */
  async getTaskAnalytics(repositoryPath: string): Promise<OrchestrationResult> {
    try {
      const analytics = await this.taskService.getTaskAnalytics(repositoryPath);
      
      return {
        success: true,
        message: `Task analytics retrieved for ${repositoryPath}`,
        data: {
          analytics,
          summary: {
            totalTasks: analytics.totalTasks,
            completionRate: `${analytics.completionRate.toFixed(1)}%`,
            averageTime: `${analytics.averageCompletionTime.toFixed(1)} minutes`,
            topBottleneck: 'None identified',
            topRecommendation: 'System performing well'
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to get task analytics: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get task hierarchy and progress
   */
  async getTaskHierarchy(taskId: string): Promise<OrchestrationResult> {
    try {
      const hierarchy = await this.taskService.getTaskHierarchy(taskId);
      
      if (!hierarchy) {
        return {
          success: false,
          message: `Task ${taskId} not found`,
          data: { taskId }
        };
      }
      
      return {
        success: true,
        message: `Task hierarchy retrieved for ${taskId}`,
        data: {
          hierarchy,
          summary: {
            rootTasks: hierarchy.rootTasks.length,
            totalSubtasks: Object.keys(hierarchy.taskTree).length,
            orphanTasks: hierarchy.orphanTasks.length,
            treeDepth: Math.max(...Object.values(hierarchy.taskTree).map(tasks => tasks.length))
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to get task hierarchy: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Update task progress with enhanced tracking
   */
  async updateTaskProgress(
    taskId: string,
    progress: {
      status?: 'pending' | 'in_progress' | 'completed' | 'failed';
      progressPercentage?: number;
      notes?: string;
      results?: Record<string, any>;
    }
  ): Promise<OrchestrationResult> {
    try {
      await this.taskService.updateTask(taskId, {
        status: progress.status,
        progressPercentage: progress.progressPercentage,
        notes: progress.notes,
        results: progress.results
      });
      
      return {
        success: true,
        message: `Task ${taskId} updated successfully`,
        data: {
          taskId,
          progress: {
            status: progress.status,
            progressPercentage: progress.progressPercentage,
            hasNotes: !!progress.notes,
            hasResults: !!progress.results
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to update task progress: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get task execution plan with critical path analysis
   */
  async getTaskExecutionPlan(repositoryPath: string): Promise<OrchestrationResult> {
    try {
      // Get all tasks for this repository
      const allTasks = await this.taskService.getTasksByRepository(repositoryPath);
      const taskIds = allTasks.map(task => task.id);
      
      const plan = await this.taskService.createExecutionPlan(taskIds);
      
      return {
        success: true,
        message: `Execution plan generated for ${repositoryPath}`,
        data: {
          plan,
          summary: {
            totalTasks: plan.tasks.length,
            estimatedDuration: `${plan.estimatedDuration} minutes`,
            criticalPathLength: plan.criticalPath.length,
            riskLevel: plan.riskAssessment.confidenceLevel > 0.8 ? 'Low' : 
                      plan.riskAssessment.confidenceLevel > 0.6 ? 'Medium' : 'High',
            topRisk: plan.riskAssessment.mitigationStrategies[0] || 'No major risks identified'
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to get execution plan: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Break down a complex task into subtasks
   */
  async breakdownTask(
    taskId: string,
    subtasks: Array<{
      title: string;
      description: string;
      taskType: TaskType;
      estimatedDuration?: number;
      priority?: number;
      dependencies?: string[];
    }>
  ): Promise<OrchestrationResult> {
    try {
      const task = await this.taskService.getTask(taskId);
      if (!task) {
        return {
          success: false,
          message: `Task ${taskId} not found`,
          data: { taskId }
        };
      }

      const createdSubtasks = await this.taskService.breakdownTask(
        taskId,
        subtasks.map(subtask => ({
          description: `${subtask.title}: ${subtask.description}`,
          taskType: subtask.taskType,
          requirements: {
            estimatedDuration: subtask.estimatedDuration,
            priority: subtask.priority,
            tags: ['subtask', subtask.taskType]
          },
          dependencies: subtask.dependencies || []
        }))
      );

      // Store task breakdown in knowledge graph with enhanced metadata
      try {
        await this.knowledgeGraphService.createEntity({
          id: `task-breakdown-${Date.now()}`,
          repositoryPath: task.repositoryPath,
          entityType: 'task',
          name: `Task breakdown: ${task.description}`,
          description: `Task ${taskId} broken down into ${createdSubtasks.length} subtasks`,
          properties: {
            parentTaskId: taskId,
            subtaskIds: createdSubtasks.map(t => t.id),
            subtaskCount: createdSubtasks.length,
            tags: ['task-breakdown', 'orchestration']
          },
          discoveredBy: 'system',
          discoveredDuring: 'task-breakdown',
          importanceScore: 0.8,
          confidenceScore: 1.0,
          relevanceScore: 0.8
        });
      } catch (error) {
        console.warn('Failed to store task breakdown in knowledge graph:', error);
      }

      return {
        success: true,
        message: `Task ${taskId} broken down into ${createdSubtasks.length} subtasks`,
        data: {
          parentTaskId: taskId,
          subtasks: createdSubtasks.map(subtask => ({
            id: subtask.id,
            description: subtask.description,
            taskType: subtask.taskType,
            priority: subtask.priority,
            estimatedDuration: subtask.requirements?.estimatedDuration
          }))
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to breakdown task: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Auto-assign tasks to available agents based on capabilities
   */
  async autoAssignTasks(repositoryPath: string): Promise<OrchestrationResult> {
    try {
      // Get available agents first
      const agents = await this.agentService.listAgents(repositoryPath, 'active');
      const availableAgents = agents;
      
      let assignments: any[] = [];
      if (availableAgents.length > 0) {
        // Use the first available agent for simplicity
        assignments = await this.taskService.autoAssignTasks(repositoryPath, availableAgents[0].id);
      }
      
      // Store assignment results in knowledge graph
      try {
        await this.knowledgeGraphService.createEntity({
          id: `auto-assignment-${Date.now()}`,
          repositoryPath,
          entityType: 'task',
          name: 'Auto-assignment completed',
          description: `${assignments.length} tasks automatically assigned to agents`,
          properties: {
            assignmentCount: assignments.length,
            assignments: assignments.map(a => ({ taskId: a.id, agentId: a.assignedAgentId })),
            tags: ['auto-assignment', 'orchestration']
          },
          discoveredBy: 'system',
          discoveredDuring: 'auto-assignment',
          importanceScore: 0.7,
          confidenceScore: 1.0,
          relevanceScore: 0.7
        });
      } catch (error) {
        console.warn('Failed to store auto-assignment in knowledge graph:', error);
      }

      return {
        success: true,
        message: `${assignments.length} tasks auto-assigned successfully`,
        data: {
          assignmentCount: assignments.length,
          assignments: assignments.map(assignment => ({
            taskId: assignment.id,
            agentId: assignment.assignedAgentId
          }))
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to auto-assign tasks: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get comprehensive task insights for better orchestration
   */
  async getTaskInsights(repositoryPath: string): Promise<OrchestrationResult> {
    try {
      const [analytics, pendingTasks, inProgressTasks] = await Promise.all([
        this.taskService.getTaskAnalytics(repositoryPath),
        this.taskService.getPendingTasks(repositoryPath),
        this.taskService.listTasks(repositoryPath, { status: 'in_progress' })
      ]);

      const insights = {
        analytics,
        currentState: {
          pendingTasks: pendingTasks.length,
          inProgressTasks: inProgressTasks.length,
          unassignedTasks: pendingTasks.filter(t => !t.assignedAgentId).length,
          blockedTasks: 0 // TODO: Calculate blocked tasks
        },
        recommendations: [
          pendingTasks.length > 5 ? 'Consider spawning additional agents for pending tasks' : null,
          inProgressTasks.length > 10 ? 'Monitor in-progress tasks for potential bottlenecks' : null
        ].filter(Boolean) as string[]
      };

      return {
        success: true,
        message: `Task insights generated for ${repositoryPath}`,
        data: insights
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to get task insights: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Monitor agents with real-time updates using EventBus system
   */
  async monitorAgents(
    agentId?: string,
    orchestrationId?: string,
    roomName?: string,
    repositoryPath?: string,
    monitoringMode: 'status' | 'activity' | 'communication' | 'full' = 'status',
    updateInterval: number = 2000,
    maxDuration: number = 50000,
    detailLevel: 'summary' | 'detailed' | 'verbose' = 'summary',
    progressContext?: {
      progressToken: string | number;
      sendNotification: (notification: any) => Promise<void>;
    }
  ): Promise<OrchestrationResult> {
    try {
      const resolvedPath = repositoryPath || process.cwd();
      const startTime = Date.now();
      const errors: string[] = [];
      const eventSubscriptions: string[] = [];
      
      // Import EventBus
      const { eventBus } = await import('../services/EventBus.js');
      
      // Setup MCP-compliant progress tracking
      const progressContextConfig = {
        contextId: agentId || orchestrationId || roomName || 'monitoring',
        contextType: agentId ? 'agent' as const : orchestrationId ? 'orchestration' as const : roomName ? 'monitoring' as const : 'monitoring' as const,
        repositoryPath: resolvedPath,
        metadata: {
          monitoringMode,
          detailLevel,
          startTime: startTime,
          maxDuration
        }
      };
      
      // Create MCP progress updater using ProgressTracker
      const sendProgressUpdate = progressContext ? 
        this.progressTracker.createMcpProgressUpdater(
          progressContextConfig,
          progressContext.progressToken,
          progressContext.sendNotification
        ) : 
        async (progress: number, message?: string) => {
          // No-op if no progress context
        };
      
      // Helper function to calculate current progress
      const calculateProgress = () => Math.min(20 + (Date.now() - startTime) / maxDuration * 70, 90);
      
      // Add opening message
      await sendProgressUpdate(0, `🔍 Starting real-time agent monitoring (${monitoringMode} mode, ${detailLevel} detail)`);
      await sendProgressUpdate(1, `⏱️ Monitoring for up to ${maxDuration/1000} seconds using EventBus`);

      // Initial status snapshot
      await sendProgressUpdate(5, '📊 INITIAL STATUS:');
      let initialStatus;
      try {
        if (agentId) {
          initialStatus = await this.monitoringService.getAgentStatus(agentId);
          await sendProgressUpdate(10, `Agent ${agentId}: ${initialStatus.status}`);
          if (initialStatus.currentTask) {
            await sendProgressUpdate(12, `  Current task: ${initialStatus.currentTask.description}`);
          }
          await sendProgressUpdate(15, `  Uptime: ${Math.floor(initialStatus.uptime/60)}m ${Math.floor(initialStatus.uptime%60)}s`);
        } else if (orchestrationId) {
          initialStatus = await this.monitoringService.getOrchestrationStatus(orchestrationId);
          await sendProgressUpdate(10, `Orchestration ${orchestrationId}: ${initialStatus.status}`);
          await sendProgressUpdate(12, `  Progress: ${initialStatus.progress.toFixed(1)}%`);
          await sendProgressUpdate(13, `  Active agents: ${initialStatus.activeAgents.length}`);
          await sendProgressUpdate(15, `  Completed tasks: ${initialStatus.completedTasks.length}/${initialStatus.totalTasks}`);
        } else if (roomName) {
          initialStatus = await this.monitoringService.getRoomActivity(roomName);
          await sendProgressUpdate(10, `Room ${roomName}: ${initialStatus.coordinationStatus}`);
          await sendProgressUpdate(12, `  Active members: ${initialStatus.activeMembers.length}`);
          await sendProgressUpdate(15, `  Messages: ${initialStatus.messageCount}`);
        } else {
          initialStatus = await this.monitoringService.getActiveAgents(resolvedPath);
          await sendProgressUpdate(10, `Repository ${resolvedPath}: ${initialStatus.length} active agents`);
          for (const agent of initialStatus) {
            await sendProgressUpdate(15, `  Agent ${agent.agentId}: ${agent.status}`);
          }
        }
      } catch (error) {
        errors.push(`Failed to get initial status: ${error}`);
      }

      await sendProgressUpdate(20, '🔄 SUBSCRIBING TO REAL-TIME EVENTS:');

      // Set up event listeners based on monitoring scope
      const setupEventListeners = async () => {
        if (monitoringMode === 'status' || monitoringMode === 'activity' || monitoringMode === 'full') {
          // Subscribe to agent status changes
          const agentStatusSub = eventBus.subscribe('agent_status_change', async (data) => {
            if (agentId && data.agentId !== agentId) return;
            if (data.repositoryPath !== resolvedPath) return;
            
            const timestamp = new Date().toLocaleTimeString();
            const currentProgress = calculateProgress();
            await sendProgressUpdate(currentProgress, `[${timestamp}] 🔄 Agent ${data.agentId} status: ${data.previousStatus} → ${data.newStatus}`);
            
            if (detailLevel === 'detailed' || detailLevel === 'verbose') {
              if (data.metadata) {
                await sendProgressUpdate(currentProgress, `  Metadata: ${JSON.stringify(data.metadata)}`);
              }
            }
          }, { repositoryPath: resolvedPath });
          eventSubscriptions.push(agentStatusSub);

          // Subscribe to agent spawn events
          const agentSpawnSub = eventBus.subscribe('agent_spawned', async (data) => {
            if (data.repositoryPath !== resolvedPath) return;
            
            const timestamp = new Date().toLocaleTimeString();
            const currentProgress = calculateProgress();
            await sendProgressUpdate(currentProgress, `[${timestamp}] 🆕 Agent spawned: ${data.agent.id} (${data.agent.agentName})`);
          }, { repositoryPath: resolvedPath });
          eventSubscriptions.push(agentSpawnSub);

          // Subscribe to agent termination events
          const agentTermSub = eventBus.subscribe('agent_terminated', async (data) => {
            if (agentId && data.agentId !== agentId) return;
            if (data.repositoryPath !== resolvedPath) return;
            
            const timestamp = new Date().toLocaleTimeString();
            const currentProgress = calculateProgress();
            await sendProgressUpdate(currentProgress, `[${timestamp}] 🔚 Agent ${data.agentId} terminated (${data.finalStatus})`);
            
            if (data.reason && (detailLevel === 'detailed' || detailLevel === 'verbose')) {
              await sendProgressUpdate(currentProgress, `  Reason: ${data.reason}`);
            }
          }, { repositoryPath: resolvedPath });
          eventSubscriptions.push(agentTermSub);
        }

        if (monitoringMode === 'activity' || monitoringMode === 'full') {
          // Subscribe to task updates
          const taskUpdateSub = eventBus.subscribe('task_update', async (data) => {
            if (data.repositoryPath !== resolvedPath) return;
            
            const timestamp = new Date().toLocaleTimeString();
            const currentProgress = calculateProgress();
            await sendProgressUpdate(currentProgress, `[${timestamp}] 📋 Task ${data.taskId} update: ${data.previousStatus || 'new'} → ${data.newStatus}`);
            
            if (data.assignedAgentId && (detailLevel === 'detailed' || detailLevel === 'verbose')) {
              await sendProgressUpdate(currentProgress, `  Assigned to: ${data.assignedAgentId}`);
            }
            
            if (data.progressPercentage !== undefined && (detailLevel === 'detailed' || detailLevel === 'verbose')) {
              await sendProgressUpdate(currentProgress, `  Progress: ${data.progressPercentage}%`);
            }
          }, { repositoryPath: resolvedPath });
          eventSubscriptions.push(taskUpdateSub);

          // Subscribe to task completion events
          const taskCompleteSub = eventBus.subscribe('task_completed', async (data) => {
            if (data.repositoryPath !== resolvedPath) return;
            
            const timestamp = new Date().toLocaleTimeString();
            const currentProgress = calculateProgress();
            await sendProgressUpdate(currentProgress, `[${timestamp}] ✅ Task ${data.taskId} completed${data.completedBy ? ` by ${data.completedBy}` : ''}`);
          }, { repositoryPath: resolvedPath });
          eventSubscriptions.push(taskCompleteSub);
        }

        if (monitoringMode === 'communication' || monitoringMode === 'full') {
          // Subscribe to room messages
          const roomMessageSub = eventBus.subscribe('room_message', async (data) => {
            if (roomName && data.roomName !== roomName) return;
            if (data.repositoryPath !== resolvedPath) return;
            
            const timestamp = new Date().toLocaleTimeString();
            const currentProgress = calculateProgress();
            await sendProgressUpdate(currentProgress, `[${timestamp}] 💬 ${data.roomName}: ${data.message.agentName} sent message`);
            
            if (detailLevel === 'detailed' || detailLevel === 'verbose') {
              const preview = data.message.message.substring(0, 50) + (data.message.message.length > 50 ? '...' : '');
              await sendProgressUpdate(currentProgress, `  Message: "${preview}"`);
            }
          }, { repositoryPath: resolvedPath });
          eventSubscriptions.push(roomMessageSub);

          // Subscribe to room creation events
          const roomCreateSub = eventBus.subscribe('room_created', async (data) => {
            if (data.repositoryPath !== resolvedPath) return;
            
            const timestamp = new Date().toLocaleTimeString();
            const currentProgress = calculateProgress();
            await sendProgressUpdate(currentProgress, `[${timestamp}] 🏠 Room created: ${data.room.name}`);
          }, { repositoryPath: resolvedPath });
          eventSubscriptions.push(roomCreateSub);

          // Subscribe to room closure events
          const roomCloseSub = eventBus.subscribe('room_closed', async (data) => {
            if (roomName && data.roomName !== roomName) return;
            if (data.repositoryPath !== resolvedPath) return;
            
            const timestamp = new Date().toLocaleTimeString();
            const currentProgress = calculateProgress();
            await sendProgressUpdate(currentProgress, `[${timestamp}] 🏠 Room closed: ${data.roomName}`);
          }, { repositoryPath: resolvedPath });
          eventSubscriptions.push(roomCloseSub);
        }

        if (orchestrationId) {
          // Subscribe to orchestration updates
          const orchestrationSub = eventBus.subscribe('orchestration_update', async (data) => {
            if (data.orchestrationId !== orchestrationId) return;
            if (data.repositoryPath !== resolvedPath) return;
            
            const timestamp = new Date().toLocaleTimeString();
            const currentProgress = calculateProgress();
            await sendProgressUpdate(currentProgress, `[${timestamp}] 🏗️ Orchestration ${data.orchestrationId}: ${data.phase} (${data.status})`);
            
            if (detailLevel === 'detailed' || detailLevel === 'verbose') {
              await sendProgressUpdate(currentProgress, `  Agents: ${data.agentCount}, Tasks: ${data.completedTasks}/${data.totalTasks}`);
            }
          }, { repositoryPath: resolvedPath });
          eventSubscriptions.push(orchestrationSub);
        }

        // Subscribe to system errors
        const errorSub = eventBus.subscribe('system_error', async (data) => {
          if (data.repositoryPath && data.repositoryPath !== resolvedPath) return;
          
          const timestamp = new Date().toLocaleTimeString();
          const currentProgress = calculateProgress();
          await sendProgressUpdate(currentProgress, `[${timestamp}] ❌ System error in ${data.context}: ${data.error.message}`);
          
          errors.push(`${data.context}: ${data.error.message}`);
        }, { repositoryPath: resolvedPath });
        eventSubscriptions.push(errorSub);

        await sendProgressUpdate(25, `📡 Subscribed to ${eventSubscriptions.length} event types`);
      };

      await setupEventListeners();

      // Real-time monitoring with EventBus
      await sendProgressUpdate(30, '🔄 REAL-TIME MONITORING ACTIVE:');
      
      // Keep alive monitoring loop (much lighter than before)
      const keepAliveInterval = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        const remaining = maxDuration - elapsed;
        
        if (remaining <= 0) {
          clearInterval(keepAliveInterval);
          return;
        }
        
        const timestamp = new Date().toLocaleTimeString();
        const progressPercent = Math.min(30 + (elapsed / maxDuration) * 60, 90);
        
        // Just send heartbeat every 10 seconds
        if (elapsed % 10000 < 1000) {
          await sendProgressUpdate(progressPercent, `[${timestamp}] ⏱️ Monitoring active... ${progressPercent.toFixed(0)}% (${Math.floor(remaining/1000)}s remaining)`);
        }
      }, 1000);

      // Wait for monitoring duration
      await new Promise(resolve => setTimeout(resolve, maxDuration));
      clearInterval(keepAliveInterval);

      // Clean up event subscriptions
      await sendProgressUpdate(95, '🧹 CLEANING UP EVENT SUBSCRIPTIONS:');
      for (const subscriptionId of eventSubscriptions) {
        eventBus.unsubscribe(subscriptionId);
      }
      await sendProgressUpdate(96, `Unsubscribed from ${eventSubscriptions.length} event listeners`);

      // Final status
      await sendProgressUpdate(98, '📋 FINAL STATUS:');
      try {
        let finalStatus;
        if (agentId) {
          finalStatus = await this.monitoringService.getAgentStatus(agentId);
          await sendProgressUpdate(99, `Agent ${agentId}: ${finalStatus.status}`);
          if (finalStatus.currentTask) {
            await sendProgressUpdate(99, `  Current task: ${finalStatus.currentTask.description}`);
          }
          await sendProgressUpdate(99, `  Performance: ${finalStatus.performance.tasksCompleted} tasks completed`);
        } else if (orchestrationId) {
          finalStatus = await this.monitoringService.getOrchestrationStatus(orchestrationId);
          await sendProgressUpdate(99, `Orchestration ${orchestrationId}: ${finalStatus.status}`);
          await sendProgressUpdate(99, `  Final progress: ${finalStatus.progress.toFixed(1)}%`);
          await sendProgressUpdate(99, `  Total agents: ${finalStatus.spawnedAgents.length}`);
        } else if (roomName) {
          finalStatus = await this.monitoringService.getRoomActivity(roomName);
          await sendProgressUpdate(99, `Room ${roomName}: ${finalStatus.coordinationStatus}`);
          await sendProgressUpdate(99, `  Final message count: ${finalStatus.messageCount}`);
        } else {
          finalStatus = await this.monitoringService.getActiveAgents(resolvedPath);
          await sendProgressUpdate(99, `Repository ${resolvedPath}: ${finalStatus.length} active agents`);
        }
      } catch (error) {
        errors.push(`Failed to get final status: ${error}`);
      }

      // Summary
      const totalDuration = Date.now() - startTime;
      await sendProgressUpdate(100, '📊 MONITORING SUMMARY:');
      await sendProgressUpdate(100, `  Duration: ${Math.floor(totalDuration/1000)}s`);
      await sendProgressUpdate(100, `  Event subscriptions: ${eventSubscriptions.length}`);
      await sendProgressUpdate(100, `  Errors: ${errors.length}`);
      await sendProgressUpdate(100, `  Mode: ${monitoringMode} (${detailLevel})`);

      return {
        success: true,
        message: `Real-time agent monitoring completed successfully`,
        data: {
          monitoringMode,
          detailLevel,
          duration: totalDuration,
          eventSubscriptions: eventSubscriptions.length,
          errors: errors.length > 0 ? errors.join('\n') : null,
          monitoringType: 'real-time-eventbus',
          finalStatus: agentId ? 'Agent monitored' : 
                       orchestrationId ? 'Orchestration monitored' : 
                       roomName ? 'Room monitored' : 'Repository monitored'
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to monitor agents: ${error}`,
        data: { error: String(error) }
      };
    }
  }
}