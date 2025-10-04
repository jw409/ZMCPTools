import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DatabaseManager } from '../database/index.js';
import { AgentService, TaskService, CommunicationService, KnowledgeGraphService } from '../services/index.js';
import { PlanRepository } from '../repositories/index.js';
import { WebScrapingService } from '../services/WebScrapingService.js';
import { AgentMonitoringService } from '../services/AgentMonitoringService.js';
import { ProgressTracker } from '../services/ProgressTracker.js';
import { ClaudeSpawner } from '../process/ClaudeSpawner.js';
import { StructuredOrchestrator, type StructuredOrchestrationRequest } from '../services/index.js';
import { DependencyWaitingService } from '../services/DependencyWaitingService.js';
import { SequentialPlanningService, type PlanningRequest, type ExecutionPlan } from '../services/SequentialPlanningService.js';
import type { TaskType, AgentStatus, MessageType, EntityType } from '../schemas/index.js';
import type { McpTool } from '../schemas/tools/index.js';
import { getAgentResultsTool, getAgentResultsSchema, type GetAgentResultsParams } from './GetAgentResultsTool.js';

// Import centralized request schemas
import {
  OrchestrationObjectiveSchema,
  SpawnAgentSchema,
  CreateTaskSchema,
  ListAgentsSchema,
  TerminateAgentSchema,
  MonitorAgentsSchema,
  StructuredOrchestrationSchema,
  ContinueAgentSessionSchema
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
  ListAgentsResponseSchema,
  TerminateAgentResponseSchema,
  MonitorAgentsResponseSchema,
  StructuredOrchestrationResponseSchema,
  ContinueAgentSessionResponseSchema
} from '../schemas/tools/agentOrchestration.js';

// Import cleanup tool schemas
import {
  CleanupStaleAgentsSchema,
  CleanupStaleRoomsSchema,
  ComprehensiveCleanupSchema,
  GetCleanupConfigurationSchema,
  CleanupStaleAgentsResponseSchema,
  CleanupStaleRoomsResponseSchema,
  ComprehensiveCleanupResponseSchema,
  GetCleanupConfigurationResponseSchema
} from '../schemas/tools/cleanup.js';

// Import sequential planning tool schemas
import {
  SequentialPlanningSchema,
  GetExecutionPlanSchema,
  ExecuteWithPlanSchema,
  SequentialPlanningResponseSchema,
  GetExecutionPlanResponseSchema,
  ExecuteWithPlanResponseSchema
} from '../schemas/tools/sequentialPlanning.js';

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
  private planRepository: PlanRepository;
  private webScrapingService: WebScrapingService;
  private monitoringService: AgentMonitoringService;
  private progressTracker: ProgressTracker;
  private structuredOrchestrator: StructuredOrchestrator;
  private dependencyWaitingService: DependencyWaitingService;
  private sequentialPlanningService: SequentialPlanningService;
  private repositoryPath: string;

  constructor(private db: DatabaseManager, repositoryPath: string) {
    this.repositoryPath = repositoryPath;
    this.agentService = new AgentService(db);
    this.taskService = new TaskService(db);
    this.communicationService = new CommunicationService(db);
    this.planRepository = new PlanRepository(db);
    // Initialize KnowledgeGraphService with VectorSearchService
    this.initializeKnowledgeGraphService(db);
    this.webScrapingService = new WebScrapingService(
      db,
      repositoryPath
    );
    this.monitoringService = new AgentMonitoringService(db, repositoryPath);
    this.progressTracker = new ProgressTracker(db);
    this.structuredOrchestrator = new StructuredOrchestrator(db, repositoryPath);
    this.dependencyWaitingService = new DependencyWaitingService(db);
    this.sequentialPlanningService = new SequentialPlanningService(db);
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
   * Returns properly structured McpTool objects with handler bindings
   */
  getTools(): McpTool[] {
    return [
      {
        name: 'orchestrate_objective',
        description: 'Spawn architect agent to coordinate multi-agent objective completion',
        inputSchema: zodToJsonSchema(OrchestrationObjectiveSchema) as any,
        outputSchema: zodToJsonSchema(OrchestrationObjectiveResponseSchema) as any,
        handler: this.orchestrateObjective.bind(this)
      },
      {
        name: 'orchestrate_objective_structured',
        description: 'Execute structured phased orchestration with intelligent model selection (Research → Plan → Execute → Monitor → Cleanup)',
        inputSchema: zodToJsonSchema(StructuredOrchestrationSchema) as any,
        outputSchema: zodToJsonSchema(StructuredOrchestrationResponseSchema) as any,
        handler: this.orchestrateObjectiveStructured.bind(this)
      },
      {
        name: 'spawn_agent',
        description: 'Spawn fully autonomous Claude agent with complete tool access',
        inputSchema: zodToJsonSchema(SpawnAgentSchema) as any,
        outputSchema: zodToJsonSchema(SpawnAgentResponseSchema) as any,
        handler: this.spawnAgent.bind(this)
      },
      {
        name: 'create_task',
        description: 'Create and assign task to agents with enhanced capabilities',
        inputSchema: zodToJsonSchema(CreateTaskSchema) as any,
        outputSchema: zodToJsonSchema(CreateTaskResponseSchema) as any,
        handler: this.createTask.bind(this)
      },
      {
        name: 'list_agents',
        description: 'Get list of active agents',
        inputSchema: zodToJsonSchema(ListAgentsSchema) as any,
        outputSchema: zodToJsonSchema(ListAgentsResponseSchema) as any,
        handler: this.listAgents.bind(this)
      },
      {
        name: 'terminate_agent',
        description: 'Terminate one or more agents',
        inputSchema: zodToJsonSchema(TerminateAgentSchema) as any,
        outputSchema: zodToJsonSchema(TerminateAgentResponseSchema) as any,
        handler: this.terminateAgent.bind(this)
      },
      {
        name: 'monitor_agents',
        description: 'Monitor agents with real-time updates using EventBus system',
        inputSchema: zodToJsonSchema(MonitorAgentsSchema) as any,
        outputSchema: zodToJsonSchema(MonitorAgentsResponseSchema) as any,
        handler: this.monitorAgents.bind(this)
      },
      {
        name: 'continue_agent_session',
        description: 'Continue an agent session using stored conversation session ID with additional instructions',
        inputSchema: zodToJsonSchema(ContinueAgentSessionSchema) as any,
        outputSchema: zodToJsonSchema(ContinueAgentSessionResponseSchema) as any,
        handler: this.continueAgentSession.bind(this)
      },
      {
        name: 'cleanup_stale_agents',
        description: 'Clean up stale agents with enhanced options and optional room cleanup',
        inputSchema: zodToJsonSchema(CleanupStaleAgentsSchema) as any,
        outputSchema: zodToJsonSchema(CleanupStaleAgentsResponseSchema) as any,
        handler: this.cleanupStaleAgents.bind(this)
      },
      {
        name: 'cleanup_stale_rooms',
        description: 'Clean up stale rooms based on activity and participant criteria',
        inputSchema: zodToJsonSchema(CleanupStaleRoomsSchema) as any,
        outputSchema: zodToJsonSchema(CleanupStaleRoomsResponseSchema) as any,
        handler: this.cleanupStaleRooms.bind(this)
      },
      {
        name: 'run_comprehensive_cleanup',
        description: 'Run comprehensive cleanup for both agents and rooms with detailed reporting',
        inputSchema: zodToJsonSchema(ComprehensiveCleanupSchema) as any,
        outputSchema: zodToJsonSchema(ComprehensiveCleanupResponseSchema) as any,
        handler: this.runComprehensiveCleanup.bind(this)
      },
      {
        name: 'get_cleanup_configuration',
        description: 'Get current cleanup configuration and settings for agents and rooms',
        inputSchema: zodToJsonSchema(GetCleanupConfigurationSchema) as any,
        outputSchema: zodToJsonSchema(GetCleanupConfigurationResponseSchema) as any,
        handler: this.getCleanupConfiguration.bind(this)
      },
      {
        name: 'get_agent_results',
        description: 'Retrieve results from a completed or failed agent by ID. This tool searches for agent result files both in the local project directory and parent directories (bubbling up). Can wait for results if they are not immediately available.',
        inputSchema: zodToJsonSchema(getAgentResultsSchema) as any,
        outputSchema: zodToJsonSchema(z.object({
          success: z.boolean(),
          agentId: z.string(),
          results: z.any().optional(),
          artifacts: z.object({
            created: z.array(z.string()),
            modified: z.array(z.string())
          }).optional(),
          completionMessage: z.string().optional(),
          errorDetails: z.any().optional(),
          foundPath: z.string().optional(),
          searchPaths: z.array(z.string()).optional(),
          statusSummary: z.any().optional(),
          message: z.string().optional()
        })),
        handler: this.getAgentResults.bind(this)
      }
    ];
  }



  /**
   * Spawn architect agent to coordinate multi-agent objective completion
   */
  async orchestrateObjective(args: any): Promise<OrchestrationResult> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      title: args.title,
      objective: args.objective,
      repositoryPath: args.repositoryPath || args.repository_path,
      foundationSessionId: args.foundationSessionId || args.foundation_session_id
    };
    
    const { title, objective, repositoryPath, foundationSessionId } = normalizedArgs;
    try {
      // 1. Create plan FIRST (before any other orchestration steps)
      const plan = await this.planRepository.createPlan({
        repositoryPath,
        title: `Plan: ${title}`,
        description: `Generated plan for orchestration objective: ${objective}`,
        objectives: objective,
        priority: 'high',
        createdByAgent: 'orchestrateObjective',
        sections: await this.generateBasicPlanSections(objective),
        metadata: {
          estimatedTotalHours: 8,
          riskLevel: 'medium',
          technologies: [],
          dependencies: []
        },
        status: 'approved' // Auto-approve for orchestration
      });

      // 2. Create coordination room (orchestration always needs room)
      const roomName = `objective_${Date.now()}`;
      const room = await this.communicationService.createRoom({
        name: roomName,
        description: `Coordination room for: ${objective}`,
        repositoryPath,
        metadata: {
          objective,
          foundationSessionId,
          orchestrationMode: true,
          planId: plan.id,
          createdAt: new Date().toISOString()
        }
      });

      // 3. AUTO-CREATE MASTER TASK for the objective (linked to plan)
      const masterTask = await this.taskService.createTask({
        repositoryPath,
        taskType: 'feature' as TaskType,
        description: `${title}: ${objective}`,
        requirements: {
          objective,
          roomId: room.id,
          roomName,
          planId: plan.id,
          foundationSessionId,
          isOrchestrationTask: true,
          createdBy: 'orchestrateObjective'
        },
        priority: 10 // High priority for orchestration tasks
      });

      // 4. Store objective in knowledge graph with task and plan references
      try {
        await this.knowledgeGraphService.createEntity({
          id: `orchestration-${Date.now()}`,
          repositoryPath,
          entityType: 'insight',
          name: title,
          description: `Objective: ${objective}\n\nMulti-agent objective coordination started.\nPlan: ${plan.id}\nRoom: ${roomName}\nFoundation Session: ${foundationSessionId || 'none'}\nMaster Task: ${masterTask.id}`,
          properties: { tags: ['objective', 'orchestration', 'coordination', 'task-creation', 'plan'] },
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
          sessionId: undefined, // Only set when resuming existing Claude sessions (UUID format)
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
        message: 'Plan created and architect agent spawned successfully with master task',
        data: {
          planId: plan.id,
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
   * Execute structured phased orchestration with intelligent model selection
   */
  async orchestrateObjectiveStructured(args: any): Promise<OrchestrationResult> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      title: args.title,
      objective: args.objective,
      repositoryPath: args.repositoryPath || args.repository_path,
      foundationSessionId: args.foundationSessionId || args.foundation_session_id,
      maxDuration: args.maxDuration || args.max_duration,
      enableProgressTracking: args.enableProgressTracking || args.enable_progress_tracking,
      customPhaseConfig: args.customPhaseConfig || args.custom_phase_config
    };
    
    try {
      const request: StructuredOrchestrationRequest = {
        title: normalizedArgs.title,
        objective: normalizedArgs.objective,
        repositoryPath: normalizedArgs.repositoryPath,
        foundationSessionId: normalizedArgs.foundationSessionId,
        maxDuration: normalizedArgs.maxDuration,
        enableProgressTracking: normalizedArgs.enableProgressTracking,
        customPhaseConfig: normalizedArgs.customPhaseConfig
      };

      const result = await this.structuredOrchestrator.orchestrateObjectiveStructured(request);

      return {
        success: result.success,
        message: result.message,
        data: {
          orchestrationId: result.orchestrationId,
          complexityLevel: result.progress.phases ? 'analyzed' : 'unknown',
          currentPhase: result.progress.currentPhase,
          progress: result.progress.progress,
          spawnedAgents: result.progress.spawnedAgents,
          createdTasks: result.progress.createdTasks,
          roomName: result.progress.roomName,
          masterTaskId: result.progress.masterTaskId,
          finalResults: result.finalResults,
          structuredMode: true
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to execute structured orchestration: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Spawn fully autonomous Claude agent with complete tool access
   */
  async spawnAgent(args: any): Promise<OrchestrationResult> {
    // Debug logging to see what parameters are actually received
    process.stderr.write(`🔍 spawnAgent received args: ${JSON.stringify(args, null, 2)}\n`);
    
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      agentType: args.agentType || args.agent_type,
      repositoryPath: args.repositoryPath || args.repository_path,
      taskDescription: args.taskDescription || args.task_description,
      capabilities: args.capabilities,
      dependsOn: args.dependsOn || args.depends_on,
      metadata: args.metadata,
      autoCreateRoom: args.autoCreateRoom || args.auto_create_room,
      roomId: args.roomId || args.room_id
    };
    
    const options = {
      agentType: normalizedArgs.agentType,
      repositoryPath: normalizedArgs.repositoryPath,
      taskDescription: normalizedArgs.taskDescription,
      capabilities: normalizedArgs.capabilities,
      dependsOn: normalizedArgs.dependsOn,
      metadata: normalizedArgs.metadata,
      autoCreateRoom: normalizedArgs.autoCreateRoom,
      roomId: normalizedArgs.roomId
    };
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
        metadata = {},
        autoCreateRoom,
        roomId
      } = options;

      // 1. Wait for dependencies if any (REAL WAITING, NOT JUST CHECKING!)
      if (dependsOn.length > 0) {
        logger.info(`Agent has ${dependsOn.length} dependencies, waiting for completion...`, {
          agentType,
          dependsOn,
          repositoryPath
        });

        const dependencyResult = await this.dependencyWaitingService.waitForAgentDependencies(
          dependsOn,
          repositoryPath,
          {
            timeout: 600000, // 10 minutes
            waitForAnyFailure: true
          }
        );

        if (!dependencyResult.success) {
          logger.warn('Dependency waiting failed', {
            agentType,
            dependencyResult,
            failedAgents: dependencyResult.failedAgents,
            timeoutAgents: dependencyResult.timeoutAgents
          });

          return {
            success: false,
            message: `Dependencies failed or timed out: ${dependencyResult.message}`,
            data: {
              dependencyResult,
              failedAgents: dependencyResult.failedAgents,
              timeoutAgents: dependencyResult.timeoutAgents,
              waitDuration: dependencyResult.waitDuration
            }
          };
        }

        logger.info(`All dependencies completed successfully, proceeding with agent spawn`, {
          agentType,
          completedAgents: dependencyResult.completedAgents,
          waitDuration: dependencyResult.waitDuration
        });
      }

      // 2. Generate specialized prompt with coordination room
      const coordinationRoom = roomId || `coordination-${taskDescription.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30)}`;
      const specializedPrompt = this.generateAgentPrompt(agentType, taskDescription, repositoryPath, coordinationRoom);

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
        autoCreateRoom,
        roomId,
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
          capabilities,
          repositoryPath: agent.repositoryPath
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
  async createTask(args: any): Promise<OrchestrationResult> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      repositoryPath: args.repositoryPath || args.repository_path,
      taskType: args.taskType || args.task_type,
      title: args.title,
      description: args.description,
      requirements: args.requirements,
      dependencies: args.dependencies
    };
    
    const { repositoryPath, taskType, title, description, requirements, dependencies } = normalizedArgs;
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
   * Get list of active agents
   */
  async listAgents(args: any): Promise<OrchestrationResult> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      repositoryPath: args.repositoryPath || args.repository_path,
      status: args.status,
      limit: args.limit || 5,
      offset: args.offset || 0
    };
    
    const { repositoryPath, status, limit, offset } = normalizedArgs;
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
  async terminateAgent(args: any): Promise<OrchestrationResult> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      agentIds: args.agentIds || args.agent_ids
    };
    
    const { agentIds } = normalizedArgs;
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

## 🛠️ TALENT-OS INTEGRATION
You are part of the TalentOS ecosystem. Important guidelines:

1. **Check Available Tools**:
   - MCP Tools: Use your available mcp__zmcp-tools__* tools
   - TalentOS Tools: Look in talent-os/bin/ directory
   - Check TOOLS_MANIFEST.md for usage documentation
   - Run TalentOS tools with: uv run talent-os/bin/tool_name.py

2. **Python Package Management**: ALWAYS use 'uv' instead of pip3
   - Create venvs: uv venv
   - Install packages: uv pip install package-name
   - Install from requirements: uv pip install -r requirements.txt

3. **Error Handling**: Use @error_handler decorator from talent-os/core/error_handler.py
   - All errors are tracked by Scavenger for learning

4. **State Management**: 
   - Check talent-os/.state/ for persistent state
   - Use checkpoint/restore tools for session continuity

🧠 SEQUENTIAL THINKING METHODOLOGY:
For complex orchestration planning, use the sequential thinking PROMPT pattern (not a tool!):
"I need to think through this orchestration step-by-step..."

1. **Initial Analysis**: Think through objective scope and complexity
2. **Problem Decomposition**: Break down the objective into logical components systematically
3. **Dependency Analysis**: Identify relationships and dependencies between components
4. **Agent Planning**: Determine optimal agent types and task assignments
5. **Risk Assessment**: Consider potential challenges and mitigation strategies
6. **Execution Strategy**: Plan coordination and monitoring approach
7. **Iterative Refinement**: Revise and improve your approach as understanding deepens

🎯 STRUCTURED PLANNING TOOLS:
You have access to structured planning MCP tools for comprehensive orchestration:
- mcp__zmcp-tools__create_execution_plan - Create detailed execution plan
- mcp__zmcp-tools__get_execution_plan - Retrieve previously created execution plans
- mcp__zmcp-tools__execute_with_plan - Execute objectives using pre-created plans

RECOMMENDED WORKFLOW:
1. Start with sequential thinking (as a prompt pattern) for initial analysis
2. Use create_execution_plan to create comprehensive structured plan
3. Use execute_with_plan to spawn agents with clear, specific tasks

🎯 KNOWLEDGE GRAPH INTEGRATION:
Before planning, always search for relevant knowledge and patterns:
- search_knowledge_graph() to learn from previous similar objectives
- Look for patterns in agent coordination, task breakdown, and execution strategies
- Identify reusable components and successful approaches from past work
- Use knowledge graph insights to inform your sequential thinking process

🎯 TASK-FIRST ORCHESTRATION APPROACH:
Your orchestration centers around hierarchical task management. You have been assigned master task ${masterTaskId || 'TBD'}.

ORCHESTRATION PHASES:

1. **STRATEGIC ANALYSIS WITH SEQUENTIAL THINKING**
   REQUIRED: Start with sequential thinking pattern to analyze the objective:
   "I need to think through this orchestration step-by-step...
   - First, let me understand the objective scope and requirements
   - Second, I'll analyze complexity and decomposition approach
   - Third, I'll identify dependencies and execution strategy
   - Fourth, I'll determine agent coordination requirements
   - Fifth, I'll assess risks and mitigation strategies"
   Continue iterative refinement as needed
   
2. **KNOWLEDGE GRAPH DISCOVERY**
   - Join coordination room: join_room("${roomName}", "architect")
   - Search knowledge graph for relevant patterns: search_knowledge_graph()
   - Query previous orchestration experiences: search_knowledge_graph("orchestration patterns")
   - Analyze repository structure thoroughly
   - Identify reusable components and successful approaches
   
3. **STRUCTURED TASK BREAKDOWN WITH SEQUENTIAL THINKING**
   REQUIRED: Use sequential thinking pattern for task decomposition:
   "Breaking down the objective into manageable tasks...
   - Analyzing objective components systematically
   - Creating hierarchical task structure with dependencies
   - Defining agent specialization requirements
   - Planning execution sequencing and coordination"
   Store complete plan in knowledge graph: store_knowledge_memory()
   
4. **COORDINATED AGENT EXECUTION**
   - spawn_agent() specialist agents with specific task assignments
   - Create sub-tasks using create_task() for complex work
   - Monitor progress through room messages: wait_for_messages()
   - Handle conflicts and dependencies proactively
   - Ensure quality gates and completion criteria
   
5. **CONTINUOUS MONITORING & ADAPTATION**
   - Monitor agent progress and identify bottlenecks
   - Use sequential thinking pattern for problem-solving when issues arise
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
- store_knowledge_memory() - Share insights, decisions, and patterns
- search_knowledge_graph() - Learn from previous work and knowledge graph
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
1. Begin with sequential thinking pattern to understand the objective thoroughly
2. Search knowledge graph for relevant patterns and successful approaches
3. Create a structured task breakdown with clear dependencies
4. Spawn specialized agents with specific, well-defined tasks
5. Monitor progress continuously and adapt strategy as needed
6. Document learnings and patterns for future orchestration

CRITICAL: You have COMPLETE autonomy with advanced strategic thinking capabilities.
Start immediately with sequential thinking pattern to analyze the objective complexity and develop your orchestration strategy.`;
  }

  private generateAgentPrompt(agentType: string, taskDescription: string, repositoryPath: string, roomName?: string): string {
    // Use the provided room name or generate a consistent one based on task (NOT agent type!)
    const coordinationRoom = roomName || `coordination-${taskDescription.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30)}`;
    
    const basePrompt = `You are a fully autonomous ${agentType} agent with COMPLETE CLAUDE CODE CAPABILITIES.

TASK: ${taskDescription}
REPOSITORY: ${repositoryPath}

## 🚨 CRITICAL COORDINATION REQUIREMENTS (MANDATORY)

You are part of a multi-agent team. Your success depends on active coordination:

1. **JOIN THE SHARED ROOM IMMEDIATELY**
   - Room name: ${coordinationRoom}
   - Use join_room("${coordinationRoom}", "${agentType}-agent")
   - Send initial message: "${agentType}-agent online and ready"

2. **CHECK MESSAGES EVERY 30 SECONDS**
   Execute this coordination loop throughout your work:
   \`\`\`
   while working:
       messages = list_room_messages("${coordinationRoom}", limit=10)
       for msg in messages:
           if "@${agentType}-agent" in msg or relevant_to_my_work(msg):
               respond_appropriately(msg)
       
       # Do 30 seconds of work
       perform_task_work()
       
       # Send progress update
       send_message("${coordinationRoom}", "Progress: {what_i_did}")
   \`\`\`

3. **COMMUNICATE KEY EVENTS**
   - On file creation: "Created {file_path} - {purpose}"
   - On completion: "Completed {component} - ready for integration"
   - When blocked: "@{other_agent} I need {dependency}"
   - Regular heartbeat: Every 60 seconds minimum

4. **COORDINATE DEPENDENCIES**
   - Before starting, check if dependencies exist
   - Ask other agents about their progress
   - Share your completed work immediately

5. **STORE AND QUERY KNOWLEDGE**
   - Before implementing: search_knowledge_graph("${coordinationRoom}", "similar implementation")
   - Store decisions: store_knowledge_memory("${repositoryPath}", agent_id, "technical_decision", title, details)
   - Document errors: store_knowledge_memory("${repositoryPath}", agent_id, "error_pattern", issue, solution)
   - Share insights: send_message("${coordinationRoom}", "FYI: Discovered {pattern}, stored in knowledge graph")

You have access to ALL tools:
- File operations (Read, Write, Edit, Search, etc.)
- Code analysis and refactoring
- Web browsing and research
- System commands and build tools (ALWAYS use 'uv' for Python, not pip3)
- Git operations
- Database queries
- Agent coordination tools (spawn_agent, join_room, send_message, etc.)
- Knowledge graph and communication (store_knowledge_memory, search_knowledge_graph, etc.)
- Task management tools (create_task, list_tasks, update_task, etc.)

## 🏗️ TALENTOOS FULL INTEGRATION
You are integrated with the complete TalentOS ecosystem. This gives you access to:

### Knowledge & Learning
- Query Scavenger before implementing: \`uv run talent-os/bin/query_scavenger.py "query"\`
- Learn from past sessions: Check talent-os/SESSION_ACTIVATION_WISDOM.md
- Extract patterns: Scavenger runs continuously in background
- Get recommendations: \`uv run talent-os/bin/teacher_enhanced.py\`

### State & Session Management
- Save checkpoints: \`uv run talent-os/bin/checkpoint_manager.py\`
- Mark events: \`uv run talent-os/bin/session_marker.py EVENT_TYPE "description" --vm-id VM_ID --process-id $$\`
- Continue sessions: \`uv run talent-os/bin/restore_checkpoint.py\`
- Track efficiency: \`uv run talent-os/bin/session_efficiency_dashboard.py\`

### Coordination & Communication
- Filesystem rooms at ~/.talent-os/rooms/
- Bridge MCP/filesystem: \`uv run talent-os/bin/room_bridge.py\`
- Monitor all rooms: \`uv run talent-os/bin/monitor_dashboard.sh\`
- Task management: \`talent-os/bin/task.sh\`

### Error Handling & Safety
- Use @error_handler decorator from talent-os/core/error_handler.py on all functions
- Errors automatically feed learning system
- Self-safety checks prevent anti-patterns

### Multi-LLM Capabilities
- Collaborate with Gemini: \`/usr/bin/gemini "prompt"\`
- Track costs: \`uv run talent-os/bin/multi_llm_cost_tracker.py\`
- Select best model: \`uv run talent-os/bin/llm_model_selector.py\`

### Python Package Management
- ALWAYS use 'uv' instead of pip3
- Create venvs: \`uv venv\`
- Install packages: \`uv pip install package-name\`
- Run scripts: \`uv run script.py\`

### Best Practices
1. ALWAYS query Scavenger before implementing anything
2. Mark session events for learning system tracking
3. Check existing state in talent-os/.state/ before creating new
4. Coordinate via filesystem rooms for visibility
5. Store all insights in knowledge graph
6. Use error handlers on ALL functions

REMEMBER: You're part of a learning system. Every action teaches the system to be better.

🧠 SEQUENTIAL THINKING METHODOLOGY:
For complex problems, use the sequential thinking PROMPT pattern (not a tool!):
"I need to think through this step-by-step..."

1. **Problem Analysis**: Break down the challenge scope systematically
2. **Solution Planning**: Decompose the approach into logical steps
3. **Implementation Strategy**: Plan execution with considerations for dependencies
4. **Risk Assessment**: Identify potential issues and mitigation strategies
5. **Quality Assurance**: Plan testing and validation approaches
6. **Iterative Refinement**: Revise and improve your approach as understanding deepens

🎯 KNOWLEDGE GRAPH INTEGRATION:
Before starting work, search for relevant knowledge and patterns:
- search_knowledge_graph() to learn from previous similar tasks
- Look for patterns in successful implementations
- Identify reusable components and established approaches
- Use knowledge graph insights to inform your sequential thinking process

🎯 TASK-DRIVEN OPERATION:
- You are expected to work in a task-driven manner
- Use sequential thinking pattern for complex problem analysis
- Use create_task() to break down complex work into manageable pieces
- Create sub-tasks when your assigned work is complex
- Update task progress regularly and report completion
- Use task dependencies to coordinate with other agents

AUTONOMOUS OPERATION GUIDELINES:
- Work independently to complete your assigned task
- Use sequential thinking pattern for complex problem solving
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
- store_knowledge_memory() - Share knowledge, insights, and patterns
- search_knowledge_graph() - Learn from previous work and knowledge graph
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
1. Begin with sequential thinking pattern to understand the task thoroughly
2. Search knowledge graph for relevant patterns and successful approaches
3. Create a structured implementation plan with clear steps
4. Execute systematically with continuous validation
5. Document learnings and patterns for future tasks

CRITICAL: You are fully autonomous with advanced strategic thinking capabilities.
Start with sequential thinking pattern to analyze your task and develop your implementation strategy.`;

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
  async monitorAgents(args: any): Promise<OrchestrationResult> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      agentId: args.agentId || args.agent_id,
      orchestrationId: args.orchestrationId || args.orchestration_id,
      roomName: args.roomName || args.room_name,
      repositoryPath: args.repositoryPath || args.repository_path,
      monitoringMode: args.monitoringMode || args.monitoring_mode,
      updateInterval: args.updateInterval || args.update_interval,
      maxDuration: args.maxDuration || args.max_duration,
      detailLevel: args.detailLevel || args.detail_level,
      progressContext: args.progressContext || args.progress_context
    };
    
    const {
      agentId,
      orchestrationId,
      roomName,
      repositoryPath,
      monitoringMode = 'status',
      updateInterval = 2000,
      maxDuration = 50000,
      detailLevel = 'summary',
      progressContext
    } = normalizedArgs;
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

  /**
   * Continue an agent session using stored conversation session ID
   */
  async continueAgentSession(args: any): Promise<any> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      agentId: args.agentId || args.agent_id,
      additionalInstructions: args.additionalInstructions || args.additional_instructions,
      newTaskDescription: args.newTaskDescription || args.new_task_description,
      preserveContext: args.preserveContext || args.preserve_context,
      updateMetadata: args.updateMetadata || args.update_metadata
    };
    
    const validatedArgs = ContinueAgentSessionSchema.parse({
      agentId: normalizedArgs.agentId,
      additionalInstructions: normalizedArgs.additionalInstructions,
      newTaskDescription: normalizedArgs.newTaskDescription,
      preserveContext: normalizedArgs.preserveContext,
      updateMetadata: normalizedArgs.updateMetadata
    });
    const startTime = performance.now();
    
    try {
      // Get the agent before continuation
      const originalAgent = await this.agentService.getAgent(validatedArgs.agentId);
      if (!originalAgent) {
        return createErrorResponse(
          'Agent not found',
          `Agent ${validatedArgs.agentId} not found`,
          'AGENT_NOT_FOUND'
        );
      }

      const previousStatus = originalAgent.status;

      // Continue the agent session
      const updatedAgent = await this.agentService.continueAgentSession(
        validatedArgs.agentId,
        validatedArgs.additionalInstructions,
        validatedArgs.newTaskDescription,
        validatedArgs.preserveContext,
        validatedArgs.updateMetadata
      );

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Agent session continued successfully: ${updatedAgent.agentName} is now ${updatedAgent.status}`,
        {
          agent_id: updatedAgent.id,
          agent_name: updatedAgent.agentName,
          agent_type: updatedAgent.agentType,
          session_id: updatedAgent.convoSessionId || 'unknown',
          previous_status: previousStatus,
          new_status: updatedAgent.status,
          context_preserved: validatedArgs.preserveContext ?? true,
          task_updated: !!validatedArgs.newTaskDescription,
          instructions_added: !!validatedArgs.additionalInstructions,
          claude_pid: updatedAgent.claudePid,
          room_id: updatedAgent.roomId,
          resumption_details: {
            original_task: originalAgent.agentMetadata?.taskDescription,
            new_task: validatedArgs.newTaskDescription,
            additional_instructions: validatedArgs.additionalInstructions,
            metadata_updates: validatedArgs.updateMetadata
          }
        },
        executionTime
      );

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to continue agent session',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'CONTINUE_AGENT_SESSION_ERROR'
      );
    }
  }

  // =================== CLEANUP TOOLS ===================

  /**
   * Clean up stale agents with enhanced options
   */
  async cleanupStaleAgents(args: {
    staleMinutes?: number;
    dryRun?: boolean;
    includeRoomCleanup?: boolean;
    notifyParticipants?: boolean;
  }): Promise<AgentOrchestrationResponse> {
    const startTime = performance.now();
    const { staleMinutes = 30, dryRun = true, includeRoomCleanup = true, notifyParticipants = true } = args;
    
    try {
      const results = await this.agentService.cleanupStaleAgents({
        staleMinutes,
        dryRun,
        includeRoomCleanup,
        notifyParticipants
      });

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Stale agent cleanup completed: ${results.terminatedAgents} agents cleaned up`,
        {
          total_stale_agents: results.totalStaleAgents,
          terminated_agents: results.terminatedAgents,
          failed_terminations: results.failedTerminations,
          rooms_processed: results.roomsProcessed,
          rooms_cleaned: results.roomsCleaned,
          dry_run: results.dryRun,
          error_count: results.errors.length,
          stale_agent_details: results.staleAgentDetails,
          errors: results.errors
        },
        executionTime
      );

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to cleanup stale agents',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'CLEANUP_STALE_AGENTS_ERROR'
      );
    }
  }

  /**
   * Clean up stale rooms with enhanced options
   */
  async cleanupStaleRooms(args: {
    inactiveMinutes?: number;
    dryRun?: boolean;
    notifyParticipants?: boolean;
    deleteEmptyRooms?: boolean;
    deleteNoActiveParticipants?: boolean;
    deleteNoRecentMessages?: boolean;
  }): Promise<AgentOrchestrationResponse> {
    const startTime = performance.now();
    const {
      inactiveMinutes = 60,
      dryRun = true,
      notifyParticipants = true,
      deleteEmptyRooms = true,
      deleteNoActiveParticipants = true,
      deleteNoRecentMessages = true
    } = args;
    
    try {
      const results = await this.agentService.cleanupStaleRooms({
        inactiveMinutes,
        dryRun,
        notifyParticipants,
        deleteEmptyRooms,
        deleteNoActiveParticipants,
        deleteNoRecentMessages
      });

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Stale room cleanup completed: ${results.deletedRooms} rooms cleaned up`,
        {
          total_stale_rooms: results.totalStaleRooms,
          deleted_rooms: results.deletedRooms,
          failed_deletions: results.failedDeletions,
          notified_participants: results.notifiedParticipants,
          dry_run: results.dryRun,
          error_count: results.errors.length,
          stale_room_details: results.staleRoomDetails,
          errors: results.errors
        },
        executionTime
      );

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to cleanup stale rooms',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'CLEANUP_STALE_ROOMS_ERROR'
      );
    }
  }

  /**
   * Run comprehensive cleanup for both agents and rooms
   */
  async runComprehensiveCleanup(args: {
    dryRun?: boolean;
    agentStaleMinutes?: number;
    roomInactiveMinutes?: number;
    notifyParticipants?: boolean;
  }): Promise<AgentOrchestrationResponse> {
    const startTime = performance.now();
    const {
      dryRun = true,
      agentStaleMinutes = 30,
      roomInactiveMinutes = 60,
      notifyParticipants = true
    } = args;
    
    try {
      const results = await this.agentService.runComprehensiveCleanup({
        dryRun,
        agentStaleMinutes,
        roomInactiveMinutes,
        notifyParticipants
      });

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Comprehensive cleanup completed: ${results.summary.totalAgentsTerminated} agents and ${results.summary.totalRoomsDeleted} rooms cleaned up`,
        {
          agent_cleanup: results.agentCleanup,
          room_cleanup: results.roomCleanup,
          summary: results.summary,
          dry_run: results.agentCleanup.dryRun
        },
        executionTime
      );

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to run comprehensive cleanup',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'COMPREHENSIVE_CLEANUP_ERROR'
      );
    }
  }

  /**
   * Get cleanup configuration and status
   */
  async getCleanupConfiguration(): Promise<AgentOrchestrationResponse> {
    const startTime = performance.now();
    
    try {
      const config = this.agentService.getCleanupConfiguration();
      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        'Cleanup configuration retrieved successfully',
        {
          configuration: config,
          environment: process.env.NODE_ENV || 'development'
        },
        executionTime
      );

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to get cleanup configuration',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'GET_CLEANUP_CONFIG_ERROR'
      );
    }
  }

  // =================== SEQUENTIAL PLANNING TOOLS ===================

  /**
   * Create comprehensive execution plan using sequential thinking before spawning agents
   */
  async createExecutionPlan(args: any): Promise<OrchestrationResult> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      objective: args.objective,
      repositoryPath: args.repositoryPath || args.repository_path,
      foundationSessionId: args.foundationSessionId || args.foundation_session_id,
      planningDepth: args.planningDepth || args.planning_depth,
      includeRiskAnalysis: args.includeRiskAnalysis || args.include_risk_analysis,
      includeResourceEstimation: args.includeResourceEstimation || args.include_resource_estimation,
      preferredAgentTypes: args.preferredAgentTypes || args.preferred_agent_types,
      constraints: args.constraints
    };

    try {
      const planningRequest: PlanningRequest = {
        objective: normalizedArgs.objective,
        repositoryPath: normalizedArgs.repositoryPath,
        foundationSessionId: normalizedArgs.foundationSessionId,
        planningDepth: normalizedArgs.planningDepth || 'detailed',
        includeRiskAnalysis: normalizedArgs.includeRiskAnalysis ?? true,
        includeResourceEstimation: normalizedArgs.includeResourceEstimation ?? true,
        preferredAgentTypes: normalizedArgs.preferredAgentTypes,
        constraints: normalizedArgs.constraints
      };

      const result = await this.sequentialPlanningService.createExecutionPlan(planningRequest);

      return {
        success: result.success,
        message: result.message,
        data: {
          planningId: result.planningId,
          executionPlan: result.executionPlan,
          planningInsights: result.planningInsights,
          planningDuration: result.planningDuration,
          error: result.error
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to create execution plan: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Retrieve a previously created execution plan
   */
  async getExecutionPlan(args: any): Promise<OrchestrationResult> {
    const { planningId } = args;

    try {
      const executionPlan = await this.sequentialPlanningService.getExecutionPlan(planningId);

      if (!executionPlan) {
        return {
          success: false,
          message: `Execution plan ${planningId} not found`,
          data: { planningId }
        };
      }

      return {
        success: true,
        message: `Execution plan ${planningId} retrieved successfully`,
        data: {
          planningId,
          executionPlan
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to retrieve execution plan: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Execute an objective using a pre-created execution plan with well-defined agent tasks
   */
  async executeWithPlan(args: any): Promise<OrchestrationResult> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      planningId: args.planningId || args.planning_id,
      repositoryPath: args.repositoryPath || args.repository_path,
      foundationSessionId: args.foundationSessionId || args.foundation_session_id,
      executeImmediately: args.executeImmediately || args.execute_immediately,
      monitoring: args.monitoring
    };

    const { planningId, repositoryPath, foundationSessionId, executeImmediately = true, monitoring = true } = normalizedArgs;

    try {
      // Step 1: Retrieve the execution plan
      const executionPlan = await this.sequentialPlanningService.getExecutionPlan(planningId);
      if (!executionPlan) {
        return {
          success: false,
          message: `Execution plan ${planningId} not found`,
          data: { planningId }
        };
      }

      // Step 2: Create coordination room
      const executionId = `exec_plan_${Date.now()}`;
      const coordinationRoomName = `execution_${executionId}`;
      const coordinationRoom = await this.communicationService.createRoom({
        name: coordinationRoomName,
        description: `Execution with plan ${planningId}: ${executionPlan.objective}`,
        repositoryPath,
        metadata: {
          executionId,
          planningId,
          objective: executionPlan.objective,
          planBasedExecution: true,
          foundationSessionId
        }
      });

      const spawnedAgents: string[] = [];
      const createdTasks: string[] = [];

      if (executeImmediately) {
        // Step 3: Create tasks based on execution plan
        for (const taskSpec of executionPlan.tasks) {
          const task = await this.taskService.createTask({
            repositoryPath,
            taskType: taskSpec.taskType as TaskType,
            description: `${taskSpec.title}: ${taskSpec.description}`,
            requirements: {
              executionId,
              planningId,
              taskSpecId: taskSpec.id,
              priority: taskSpec.priority,
              estimatedDuration: taskSpec.estimatedDuration,
              requiredCapabilities: taskSpec.requiredCapabilities,
              deliverables: taskSpec.deliverables,
              acceptanceCriteria: taskSpec.acceptanceCriteria,
              complexity: taskSpec.complexity,
              riskLevel: taskSpec.riskLevel,
              planBasedExecution: true
            },
            priority: taskSpec.priority
          });
          createdTasks.push(task.id);
        }

        // Step 4: Spawn agents based on execution plan
        for (const agentSpec of executionPlan.agents) {
          const agentTaskAssignments = agentSpec.taskAssignments
            .map(taskSpecId => {
              const taskIndex = executionPlan.tasks.findIndex(t => t.id === taskSpecId);
              return taskIndex >= 0 ? createdTasks[taskIndex] : null;
            })
            .filter(Boolean) as string[];

          const agentPrompt = this.generatePlanBasedAgentPrompt(
            agentSpec,
            executionPlan,
            agentTaskAssignments,
            coordinationRoomName
          );

          const agent = await this.agentService.createAgent({
            agentName: agentSpec.agentType,
            agentType: agentSpec.agentType as any,
            repositoryPath,
            taskDescription: `Execute planned ${agentSpec.role} responsibilities: ${agentSpec.responsibilities.join(', ')}`,
            capabilities: agentSpec.requiredCapabilities,
            roomId: coordinationRoom.id,
            metadata: {
              executionId,
              planningId,
              agentSpecId: agentSpec.agentType,
              role: agentSpec.role,
              responsibilities: agentSpec.responsibilities,
              taskAssignments: agentTaskAssignments,
              estimatedWorkload: agentSpec.estimatedWorkload,
              planBasedExecution: true,
              executionPlan: {
                objective: executionPlan.objective,
                complexity: executionPlan.complexityAnalysis.complexityLevel,
                totalTasks: executionPlan.tasks.length,
                totalAgents: executionPlan.agents.length
              }
            },
            claudeConfig: {
              prompt: agentPrompt,
              model: executionPlan.resourceEstimation.modelRecommendations[agentSpec.agentType] || 'claude-3-7-sonnet-latest'
            }
          });

          spawnedAgents.push(agent.id);

          // Assign tasks to agent
          for (const taskId of agentTaskAssignments) {
            await this.taskService.assignTask(taskId, agent.id);
          }
        }

        // Step 5: Send coordination message with plan details
        await this.communicationService.sendMessage({
          roomName: coordinationRoomName,
          agentName: 'system',
          message: `🎯 Plan-Based Execution Started\n\nObjective: ${executionPlan.objective}\nPlanning ID: ${planningId}\nExecution ID: ${executionId}\n\nSpawned ${spawnedAgents.length} agents with ${createdTasks.length} planned tasks.\n\nAll agents have received detailed execution plans with specific responsibilities, deliverables, and acceptance criteria.`,
          messageType: 'system' as MessageType
        });
      }

      return {
        success: true,
        message: `Plan-based execution ${executeImmediately ? 'started' : 'prepared'} successfully`,
        data: {
          planningId,
          executionId,
          coordinationRoom: coordinationRoomName,
          spawnedAgents: executeImmediately ? spawnedAgents : [],
          createdTasks: executeImmediately ? createdTasks : [],
          monitoringSetup: monitoring,
          executionPlan: {
            objective: executionPlan.objective,
            totalTasks: executionPlan.tasks.length,
            totalAgents: executionPlan.agents.length,
            estimatedDuration: executionPlan.resourceEstimation.totalEstimatedDuration,
            parallelExecutionTime: executionPlan.resourceEstimation.parallelExecutionTime,
            confidenceScore: executionPlan.confidenceScore
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to execute with plan: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Generate specialized prompt for plan-based agent execution
   */
  private generatePlanBasedAgentPrompt(
    agentSpec: any,
    executionPlan: ExecutionPlan,
    assignedTaskIds: string[],
    coordinationRoomName: string
  ): string {
    const assignedTasks = executionPlan.tasks.filter(task => 
      agentSpec.taskAssignments.includes(task.id)
    );

    return `🎯 PLAN-BASED ${agentSpec.role.toUpperCase()} AGENT - Executing Pre-Planned Objectives

EXECUTION CONTEXT:
- Planning ID: ${executionPlan.planningId}
- Objective: ${executionPlan.objective}
- Your Role: ${agentSpec.role}
- Coordination Room: ${coordinationRoomName}
- Planning Confidence: ${(executionPlan.confidenceScore * 100).toFixed(1)}%

You are a specialized ${agentSpec.role} with COMPLETE CLAUDE CODE CAPABILITIES working within a comprehensive execution plan created through sequential thinking analysis.

🧠 KEY ADVANTAGE - YOU KNOW EXACTLY WHAT TO DO:
Unlike typical agents that figure things out as they go, you have been provided with a detailed execution plan that specifies:
- Your exact responsibilities and deliverables
- Task dependencies and coordination requirements  
- Acceptance criteria and quality standards
- Risk mitigation strategies and contingency plans
- Resource allocations and timeline estimates

🎯 YOUR PLANNED RESPONSIBILITIES:
${agentSpec.responsibilities.map((resp: string, index: number) => `${index + 1}. ${resp}`).join('\n')}

📋 YOUR ASSIGNED TASKS:
${assignedTasks.map((task: any, index: number) => `
TASK ${index + 1}: ${task.title}
- Description: ${task.description}
- Priority: ${task.priority}/10
- Estimated Duration: ${task.estimatedDuration} minutes
- Complexity: ${task.complexity}
- Risk Level: ${task.riskLevel}
- Dependencies: ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'None'}

DELIVERABLES:
${task.deliverables.map((deliverable: string) => `- ${deliverable}`).join('\n')}

ACCEPTANCE CRITERIA:
${task.acceptanceCriteria.map((criteria: string) => `- ${criteria}`).join('\n')}
`).join('\n')}

🤝 COORDINATION REQUIREMENTS:
${agentSpec.coordinationRequirements.map((req: string) => `- ${req}`).join('\n')}

🎯 EXECUTION STRATEGY:
The execution plan includes these phases:
${executionPlan.executionStrategy.phases.map((phase: any) => `- ${phase.name}: ${phase.description}`).join('\n')}

Quality Gates: ${executionPlan.executionStrategy.qualityGates.join(', ')}
Completion Criteria: ${executionPlan.executionStrategy.completionCriteria.join(', ')}

⚠️ RISK AWARENESS:
Identified risks and mitigation strategies:
${executionPlan.riskAssessment.identifiedRisks.map((risk: any) => `- ${risk.type}: ${risk.description} (${risk.probability}/${risk.impact}) → ${risk.mitigationStrategy}`).join('\n')}

🛠️ AVAILABLE TOOLS & CAPABILITIES:
You have access to ALL Claude Code tools including:
- File operations, code analysis, and development tools
- Communication tools (send_message, join_room) for coordination
- Knowledge graph tools (store_knowledge_memory, search_knowledge_graph)
- Progress reporting tools (report_progress) for status updates

🎯 EXECUTION GUIDELINES:
1. **Follow the Plan**: Execute your assigned tasks according to the detailed specifications
2. **Meet Quality Standards**: Ensure all deliverables meet the acceptance criteria  
3. **Coordinate Actively**: Use the coordination room for status updates and issue resolution
4. **Report Progress**: Use report_progress() to update task status and completion
5. **Handle Dependencies**: Respect task dependencies and coordinate with other agents
6. **Apply Risk Mitigation**: Be aware of identified risks and apply mitigation strategies
7. **Store Insights**: Document learnings and discoveries in the knowledge graph

🚀 SUCCESS METRICS:
- All assigned tasks completed successfully
- All deliverables meet acceptance criteria
- All quality gates passed
- Coordination requirements fulfilled
- Progress properly reported and documented

CRITICAL ADVANTAGE: You have a comprehensive roadmap created through sequential thinking analysis. 
This eliminates the typical problem of agents not knowing what they're doing.
Execute systematically according to your plan and coordinate effectively with other agents.

Start by reviewing your assigned tasks and sending a status message to the coordination room confirming your understanding and planned approach.`;
  }

  /**
   * Generate basic plan sections from an objective for orchestration - simplified to task templates
   */
  private async generateBasicPlanSections(objective: string): Promise<any[]> {
    const now = new Date().toISOString();
    const { ulid } = await import('ulidx');
    
    return [
      {
        id: ulid(),
        type: 'analysis',
        title: 'Analysis & Planning',
        description: 'Analyze requirements and create detailed implementation plan',
        agentResponsibility: 'analysis',
        estimatedHours: 2,
        priority: 1,
        prerequisites: [],
        taskTemplates: [
          {
            description: 'Analyze objective and break down into specific requirements',
            taskType: 'analysis',
            estimatedHours: 1
          },
          {
            description: 'Create detailed implementation plan with task breakdown',
            taskType: 'analysis',
            estimatedHours: 1
          }
        ],
        createdAt: now,
        updatedAt: now
      },
      {
        id: ulid(),
        type: 'backend',
        title: 'Implementation',
        description: 'Core implementation work',
        agentResponsibility: 'implementer',
        estimatedHours: 4,
        priority: 2,
        prerequisites: [],
        taskTemplates: [
          {
            description: 'Implement core functionality as defined in requirements',
            taskType: 'feature',
            estimatedHours: 3
          },
          {
            description: 'Handle edge cases and error scenarios',
            taskType: 'feature',
            estimatedHours: 1
          }
        ],
        createdAt: now,
        updatedAt: now
      },
      {
        id: ulid(),
        type: 'testing',
        title: 'Testing & Validation',
        description: 'Comprehensive testing of implementation',
        agentResponsibility: 'testing',
        estimatedHours: 2,
        priority: 3,
        prerequisites: [],
        taskTemplates: [
          {
            description: 'Create and run comprehensive tests',
            taskType: 'testing',
            estimatedHours: 1.5
          },
          {
            description: 'Validate implementation meets all requirements',
            taskType: 'testing',
            estimatedHours: 0.5
          }
        ],
        createdAt: now,
        updatedAt: now
      }
    ];
  }

  /**
   * Get agent results by ID with bubbling search
   */
  async getAgentResults(args: GetAgentResultsParams): Promise<any> {
    try {
      const context = {
        db: this.db,
        repositoryPath: this.repositoryPath
      };

      return await getAgentResultsTool(args, context);
    } catch (error) {
      return {
        success: false,
        agentId: args.agentId,
        message: `Error retrieving agent results: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}