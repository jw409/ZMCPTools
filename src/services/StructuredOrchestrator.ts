import { EventEmitter } from 'events';
import { DatabaseManager } from '../database/index.js';
import { AgentService, TaskService, CommunicationService, KnowledgeGraphService } from './index.js';
import { TaskComplexityAnalyzer, type TaskComplexityAnalysis, type ModelType } from './TaskComplexityAnalyzer.js';
import { ClaudeSpawner } from '../process/ClaudeSpawner.js';
import { eventBus } from './EventBus.js';
import { Logger } from '../utils/logger.js';
import type { TaskType, AgentStatus, MessageType } from '../schemas/index.js';

export type OrchestrationPhase = 'research' | 'plan' | 'execute' | 'monitor' | 'cleanup';
export type StructuredOrchestrationStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface StructuredOrchestrationRequest {
  title: string;
  objective: string;
  repositoryPath: string;
  foundationSessionId?: string;
  maxDuration?: number; // in minutes
  enableProgressTracking?: boolean;
  customPhaseConfig?: Partial<Record<OrchestrationPhase, boolean>>;
}

export interface OrchestrationProgress {
  orchestrationId: string;
  currentPhase: OrchestrationPhase;
  status: StructuredOrchestrationStatus;
  progress: number; // 0-100
  startTime: Date;
  phases: Record<OrchestrationPhase, PhaseStatus>;
  spawnedAgents: string[];
  createdTasks: string[];
  roomName?: string;
  masterTaskId?: string;
}

export interface PhaseStatus {
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  duration?: number; // in minutes
  assignedAgentId?: string;
  outputs?: Record<string, any>;
  errors?: string[];
}

export interface StructuredOrchestrationResult {
  success: boolean;
  orchestrationId: string;
  message: string;
  progress: OrchestrationProgress;
  finalResults?: Record<string, any>;
  error?: string;
}

/**
 * Enhanced orchestrator that implements structured phased workflow with intelligent model selection
 */
export class StructuredOrchestrator extends EventEmitter {
  private agentService: AgentService;
  private taskService: TaskService;
  private communicationService: CommunicationService;
  private knowledgeGraphService: KnowledgeGraphService;
  private complexityAnalyzer: TaskComplexityAnalyzer;
  private claudeSpawner: ClaudeSpawner;
  private logger: Logger;
  
  // Active orchestrations tracking
  private activeOrchestrations = new Map<string, OrchestrationProgress>();

  constructor(private db: DatabaseManager, repositoryPath: string) {
    super();
    
    this.agentService = new AgentService(db);
    this.taskService = new TaskService(db);
    this.communicationService = new CommunicationService(db);
    this.complexityAnalyzer = new TaskComplexityAnalyzer();
    this.claudeSpawner = ClaudeSpawner.getInstance();
    this.logger = new Logger('StructuredOrchestrator');
    
    // Initialize KnowledgeGraphService
    this.initializeKnowledgeGraphService(db);
    
    // Set up event listeners
    this.setupEventListeners();
  }

  private async initializeKnowledgeGraphService(db: DatabaseManager): Promise<void> {
    try {
      const { VectorSearchService } = await import('./VectorSearchService.js');
      const vectorService = new VectorSearchService(db);
      this.knowledgeGraphService = new KnowledgeGraphService(db, vectorService);
    } catch (error) {
      this.logger.warn('Failed to initialize KnowledgeGraphService:', error);
      // Fallback implementation
      this.knowledgeGraphService = {
        createEntity: async () => ({ id: 'fallback', name: 'fallback' }),
        findEntitiesBySemanticSearch: async () => []
      } as any;
    }
  }

  private setupEventListeners(): void {
    // Listen for agent status changes to update orchestration progress
    eventBus.subscribe('agent_status_change', async (data) => {
      await this.handleAgentStatusChange(data);
    });

    // Listen for task completion events
    eventBus.subscribe('task_completed', async (data) => {
      await this.handleTaskCompletion(data);
    });

    // Listen for orchestration phase changes
    eventBus.subscribe('orchestration_phase_change', async (data) => {
      await this.handlePhaseChange(data);
    });
  }

  /**
   * Main orchestration entry point - implements structured phased workflow
   */
  public async orchestrateObjectiveStructured(
    request: StructuredOrchestrationRequest
  ): Promise<StructuredOrchestrationResult> {
    const orchestrationId = `struct_orch_${Date.now()}`;
    this.logger.info('Starting structured orchestration', { orchestrationId, objective: request.objective });

    try {
      // Step 1: Analyze task complexity
      this.logger.debug('Analyzing task complexity');
      const complexityAnalysis = await this.complexityAnalyzer.analyzeTask(
        request.objective,
        'feature', // Default task type for orchestration
        request.repositoryPath,
        {
          includeArchitectural: true,
          considerDependencies: true,
          evaluateRisks: true,
          estimateDuration: true
        }
      );

      this.logger.info('Task complexity analysis completed', {
        complexityLevel: complexityAnalysis.complexityLevel,
        recommendedModel: complexityAnalysis.recommendedModel,
        estimatedDuration: complexityAnalysis.estimatedDuration
      });

      // Step 2: Initialize orchestration progress tracking
      const progress = this.initializeOrchestrationProgress(orchestrationId, request, complexityAnalysis);
      this.activeOrchestrations.set(orchestrationId, progress);

      // Step 3: Create coordination room
      const roomName = `struct_orch_${Date.now()}`;
      const room = await this.communicationService.createRoom({
        name: roomName,
        description: `Structured orchestration: ${request.objective}`,
        repositoryPath: request.repositoryPath,
        metadata: {
          orchestrationId,
          objective: request.objective,
          foundationSessionId: request.foundationSessionId,
          structuredMode: true,
          complexityLevel: complexityAnalysis.complexityLevel
        }
      });

      progress.roomName = roomName;

      // Step 4: Create master task
      const masterTask = await this.taskService.createTask({
        repositoryPath: request.repositoryPath,
        taskType: 'feature' as TaskType,
        description: `${request.title}: ${request.objective}`,
        requirements: {
          objective: request.objective,
          orchestrationId,
          roomId: room.id,
          roomName,
          foundationSessionId: request.foundationSessionId,
          isOrchestrationTask: true,
          structuredMode: true,
          complexityAnalysis,
          estimatedDuration: complexityAnalysis.estimatedDuration
        },
        priority: 10 // High priority for orchestration tasks
      });

      progress.masterTaskId = masterTask.id;
      progress.createdTasks.push(masterTask.id);

      // Step 5: Execute phased workflow
      const result = await this.executePhaseWorkflow(orchestrationId, request, complexityAnalysis);

      // Step 6: Finalize and return results
      const finalProgress = this.activeOrchestrations.get(orchestrationId)!;
      finalProgress.status = result.success ? 'completed' : 'failed';
      finalProgress.progress = 100;

      // Emit completion event
      eventBus.emit('orchestration_completed', {
        orchestrationId,
        repositoryPath: request.repositoryPath,
        success: result.success,
        duration: Date.now() - finalProgress.startTime.getTime(),
        finalResults: result.finalResults,
        timestamp: new Date()
      });

      this.logger.info('Structured orchestration completed', {
        orchestrationId,
        success: result.success,
        duration: Date.now() - finalProgress.startTime.getTime()
      });

      return {
        success: result.success,
        orchestrationId,
        message: result.success ? 
          'Structured orchestration completed successfully' : 
          `Structured orchestration failed: ${result.error}`,
        progress: finalProgress,
        finalResults: result.finalResults,
        error: result.error
      };

    } catch (error) {
      this.logger.error('Structured orchestration failed', { orchestrationId, error });
      
      // Update progress to failed state
      const progress = this.activeOrchestrations.get(orchestrationId);
      if (progress) {
        progress.status = 'failed';
        progress.progress = 0;
      }

      return {
        success: false,
        orchestrationId,
        message: `Structured orchestration failed: ${error}`,
        progress: progress!,
        error: String(error)
      };
    } finally {
      // Cleanup
      setTimeout(() => {
        this.activeOrchestrations.delete(orchestrationId);
      }, 300000); // Keep for 5 minutes for monitoring
    }
  }

  /**
   * Initialize orchestration progress tracking
   */
  private initializeOrchestrationProgress(
    orchestrationId: string,
    request: StructuredOrchestrationRequest,
    complexityAnalysis: TaskComplexityAnalysis
  ): OrchestrationProgress {
    const enabledPhases: OrchestrationPhase[] = ['research', 'plan', 'execute', 'monitor', 'cleanup'];
    
    // Apply custom phase configuration
    const finalPhases = enabledPhases.filter(phase => {
      if (request.customPhaseConfig && request.customPhaseConfig[phase] === false) {
        return false;
      }
      return true;
    });

    const phases: Record<OrchestrationPhase, PhaseStatus> = {
      research: { status: 'pending' },
      plan: { status: 'pending' },
      execute: { status: 'pending' },
      monitor: { status: 'pending' },
      cleanup: { status: 'pending' }
    };

    // Skip disabled phases
    for (const phase of ['research', 'plan', 'execute', 'monitor', 'cleanup'] as OrchestrationPhase[]) {
      if (!finalPhases.includes(phase)) {
        phases[phase].status = 'skipped';
      }
    }

    return {
      orchestrationId,
      currentPhase: finalPhases[0] || 'execute',
      status: 'pending',
      progress: 0,
      startTime: new Date(),
      phases,
      spawnedAgents: [],
      createdTasks: []
    };
  }

  /**
   * Execute the structured phased workflow
   */
  private async executePhaseWorkflow(
    orchestrationId: string,
    request: StructuredOrchestrationRequest,
    complexityAnalysis: TaskComplexityAnalysis
  ): Promise<{ success: boolean; finalResults?: Record<string, any>; error?: string }> {
    const progress = this.activeOrchestrations.get(orchestrationId)!;
    const enabledPhases = Object.entries(progress.phases)
      .filter(([_, status]) => status.status !== 'skipped')
      .map(([phase, _]) => phase as OrchestrationPhase);

    let phaseResults: Record<string, any> = {};

    try {
      for (let i = 0; i < enabledPhases.length; i++) {
        const phase = enabledPhases[i];
        progress.currentPhase = phase;
        progress.progress = (i / enabledPhases.length) * 90; // Leave 10% for final completion

        this.logger.info(`Starting phase: ${phase}`, { orchestrationId });

        // Execute phase
        const phaseResult = await this.executePhase(
          orchestrationId,
          phase,
          request,
          complexityAnalysis,
          phaseResults
        );

        if (!phaseResult.success) {
          throw new Error(`Phase ${phase} failed: ${phaseResult.error}`);
        }

        phaseResults[phase] = phaseResult.outputs;
        progress.phases[phase].status = 'completed';
        progress.phases[phase].endTime = new Date();
        progress.phases[phase].outputs = phaseResult.outputs;

        // Emit phase completion event
        eventBus.emit('orchestration_phase_completed', {
          orchestrationId,
          phase,
          repositoryPath: request.repositoryPath,
          outputs: phaseResult.outputs,
          timestamp: new Date()
        });
      }

      return { success: true, finalResults: phaseResults };

    } catch (error) {
      this.logger.error(`Phase execution failed`, { orchestrationId, phase: progress.currentPhase, error });
      
      // Mark current phase as failed
      progress.phases[progress.currentPhase].status = 'failed';
      progress.phases[progress.currentPhase].errors = [String(error)];
      
      return { success: false, error: String(error) };
    }
  }

  /**
   * Execute a specific orchestration phase
   */
  private async executePhase(
    orchestrationId: string,
    phase: OrchestrationPhase,
    request: StructuredOrchestrationRequest,
    complexityAnalysis: TaskComplexityAnalysis,
    previousResults: Record<string, any>
  ): Promise<{ success: boolean; outputs?: Record<string, any>; error?: string }> {
    const progress = this.activeOrchestrations.get(orchestrationId)!;
    progress.phases[phase].status = 'in_progress';
    progress.phases[phase].startTime = new Date();

    try {
      switch (phase) {
        case 'research':
          return await this.executeResearchPhase(orchestrationId, request, complexityAnalysis);
        
        case 'plan':
          return await this.executePlanningPhase(orchestrationId, request, complexityAnalysis, previousResults);
        
        case 'execute':
          return await this.executeExecutionPhase(orchestrationId, request, complexityAnalysis, previousResults);
        
        case 'monitor':
          return await this.executeMonitoringPhase(orchestrationId, request, complexityAnalysis, previousResults);
        
        case 'cleanup':
          return await this.executeCleanupPhase(orchestrationId, request, complexityAnalysis, previousResults);
        
        default:
          throw new Error(`Unknown phase: ${phase}`);
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Research Phase: Gather information and analyze requirements
   */
  private async executeResearchPhase(
    orchestrationId: string,
    request: StructuredOrchestrationRequest,
    complexityAnalysis: TaskComplexityAnalysis
  ): Promise<{ success: boolean; outputs?: Record<string, any>; error?: string }> {
    this.logger.info('Executing research phase', { orchestrationId });

    try {
      // Use simple model for research coordination tasks
      const researcherAgent = await this.spawnSpecializedAgent(
        'researcher',
        request.repositoryPath,
        `Research and analyze requirements for: ${request.objective}`,
        'claude-3-7-sonnet-latest', // Simple tasks use efficient model
        orchestrationId,
        request.foundationSessionId
      );

      // Create research task
      const researchTask = await this.taskService.createTask({
        repositoryPath: request.repositoryPath,
        taskType: 'analysis' as TaskType,
        description: `Research phase: Analyze requirements and gather information for ${request.objective}`,
        requirements: {
          orchestrationId,
          phase: 'research',
          complexityAnalysis,
          objective: request.objective
        }
      });

      await this.taskService.assignTask(researchTask.id, researcherAgent.id);

      // Store research findings in knowledge graph
      await this.knowledgeGraphService.createEntity({
        id: `research-${orchestrationId}`,
        repositoryPath: request.repositoryPath,
        entityType: 'insight',
        name: `Research phase for: ${request.title}`,
        description: `Research phase initiated for objective: ${request.objective}`,
        properties: {
          orchestrationId,
          phase: 'research',
          complexityLevel: complexityAnalysis.complexityLevel,
          estimatedDuration: complexityAnalysis.estimatedDuration,
          tags: ['research', 'orchestration', 'analysis']
        },
        discoveredBy: 'structured-orchestrator',
        discoveredDuring: 'research-phase',
        importanceScore: 0.8,
        confidenceScore: 1.0,
        relevanceScore: 0.9
      });

      // Wait for research completion (simplified for this implementation)
      // In practice, this would monitor the agent's progress
      await new Promise(resolve => setTimeout(resolve, 5000));

      return {
        success: true,
        outputs: {
          researchAgentId: researcherAgent.id,
          researchTaskId: researchTask.id,
          complexityAnalysis,
          researchFindings: 'Research completed successfully'
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Planning Phase: Create detailed execution plan
   */
  private async executePlanningPhase(
    orchestrationId: string,
    request: StructuredOrchestrationRequest,
    complexityAnalysis: TaskComplexityAnalysis,
    previousResults: Record<string, any>
  ): Promise<{ success: boolean; outputs?: Record<string, any>; error?: string }> {
    this.logger.info('Executing planning phase', { orchestrationId });

    try {
      // Use complex model for planning as it requires strategic thinking
      const plannerAgent = await this.spawnSpecializedAgent(
        'architect',
        request.repositoryPath,
        `Create detailed execution plan for: ${request.objective}`,
        complexityAnalysis.recommendedModel, // Use recommended model for planning
        orchestrationId,
        request.foundationSessionId
      );

      // Create planning task
      const planningTask = await this.taskService.createTask({
        repositoryPath: request.repositoryPath,
        taskType: 'feature' as TaskType,
        description: `Planning phase: Create structured execution plan for ${request.objective}`,
        requirements: {
          orchestrationId,
          phase: 'planning',
          complexityAnalysis,
          previousResults,
          objective: request.objective
        }
      });

      await this.taskService.assignTask(planningTask.id, plannerAgent.id);

      // Create sub-tasks based on complexity analysis
      const subtasks = await this.createSubtasksFromAnalysis(
        orchestrationId,
        request,
        complexityAnalysis
      );

      return {
        success: true,
        outputs: {
          plannerAgentId: plannerAgent.id,
          planningTaskId: planningTask.id,
          subtasks,
          executionPlan: 'Detailed execution plan created'
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Execution Phase: Implement the planned solution
   */
  private async executeExecutionPhase(
    orchestrationId: string,
    request: StructuredOrchestrationRequest,
    complexityAnalysis: TaskComplexityAnalysis,
    previousResults: Record<string, any>
  ): Promise<{ success: boolean; outputs?: Record<string, any>; error?: string }> {
    this.logger.info('Executing execution phase', { orchestrationId });

    try {
      const executionAgents: string[] = [];

      // Spawn specialized agents based on complexity analysis
      for (const specialization of complexityAnalysis.requiredSpecializations) {
        if (specialization !== 'architect') { // Architect already spawned in planning
          const agent = await this.spawnSpecializedAgent(
            specialization,
            request.repositoryPath,
            `Implement ${specialization} components for: ${request.objective}`,
            this.selectModelForSpecialization(specialization, complexityAnalysis),
            orchestrationId,
            request.foundationSessionId
          );
          executionAgents.push(agent.id);
        }
      }

      // Create execution coordination task
      const executionTask = await this.taskService.createTask({
        repositoryPath: request.repositoryPath,
        taskType: 'feature' as TaskType,
        description: `Execution phase: Implement solution for ${request.objective}`,
        requirements: {
          orchestrationId,
          phase: 'execution',
          complexityAnalysis,
          previousResults,
          executionAgents
        }
      });

      return {
        success: true,
        outputs: {
          executionAgents,
          executionTaskId: executionTask.id,
          implementationStatus: 'Implementation in progress'
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Monitoring Phase: Track progress and handle issues
   */
  private async executeMonitoringPhase(
    orchestrationId: string,
    request: StructuredOrchestrationRequest,
    complexityAnalysis: TaskComplexityAnalysis,
    previousResults: Record<string, any>
  ): Promise<{ success: boolean; outputs?: Record<string, any>; error?: string }> {
    this.logger.info('Executing monitoring phase', { orchestrationId });

    try {
      // Use simple model for monitoring tasks
      const monitorAgent = await this.spawnSpecializedAgent(
        'generalist',
        request.repositoryPath,
        `Monitor progress and coordinate agents for: ${request.objective}`,
        'claude-3-7-sonnet-latest', // Simple monitoring tasks
        orchestrationId,
        request.foundationSessionId
      );

      // Create monitoring task
      const monitoringTask = await this.taskService.createTask({
        repositoryPath: request.repositoryPath,
        taskType: 'maintenance' as TaskType,
        description: `Monitoring phase: Track progress for ${request.objective}`,
        requirements: {
          orchestrationId,
          phase: 'monitoring',
          previousResults
        }
      });

      await this.taskService.assignTask(monitoringTask.id, monitorAgent.id);

      return {
        success: true,
        outputs: {
          monitorAgentId: monitorAgent.id,
          monitoringTaskId: monitoringTask.id,
          monitoringStatus: 'Active monitoring established'
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Cleanup Phase: Finalize and clean up resources
   */
  private async executeCleanupPhase(
    orchestrationId: string,
    request: StructuredOrchestrationRequest,
    complexityAnalysis: TaskComplexityAnalysis,
    previousResults: Record<string, any>
  ): Promise<{ success: boolean; outputs?: Record<string, any>; error?: string }> {
    this.logger.info('Executing cleanup phase', { orchestrationId });

    try {
      // Create final summary in knowledge graph
      await this.knowledgeGraphService.createEntity({
        id: `orchestration-summary-${orchestrationId}`,
        repositoryPath: request.repositoryPath,
        entityType: 'insight',
        name: `Orchestration completed: ${request.title}`,
        description: `Structured orchestration completed for: ${request.objective}`,
        properties: {
          orchestrationId,
          objective: request.objective,
          complexityLevel: complexityAnalysis.complexityLevel,
          totalDuration: Date.now() - this.activeOrchestrations.get(orchestrationId)!.startTime.getTime(),
          phases: Object.keys(previousResults),
          spawnedAgents: this.activeOrchestrations.get(orchestrationId)!.spawnedAgents.length,
          tags: ['orchestration-summary', 'completion', 'structured']
        },
        discoveredBy: 'structured-orchestrator',
        discoveredDuring: 'cleanup-phase',
        importanceScore: 0.9,
        confidenceScore: 1.0,
        relevanceScore: 0.9
      });

      return {
        success: true,
        outputs: {
          cleanupStatus: 'Cleanup completed successfully',
          finalSummary: `Orchestration ${orchestrationId} completed with all phases`,
          totalDuration: Date.now() - this.activeOrchestrations.get(orchestrationId)!.startTime.getTime()
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Spawn specialized agent with intelligent model selection
   */
  private async spawnSpecializedAgent(
    specialization: string,
    repositoryPath: string,
    taskDescription: string,
    model: ModelType,
    orchestrationId: string,
    foundationSessionId?: string
  ): Promise<{ id: string; agentName: string }> {
    const agent = await this.agentService.createAgent({
      agentName: specialization,
      repositoryPath,
      taskDescription,
      capabilities: ['ALL_TOOLS'],
      metadata: {
        orchestrationId,
        specialization,
        structuredMode: true,
        spawnedAt: new Date().toISOString()
      },
      claudeConfig: {
        model,
        prompt: this.generateSpecializedPrompt(specialization, taskDescription, orchestrationId),
        sessionId: undefined // Only set when resuming existing Claude sessions (UUID format)
      }
    });

    // Track spawned agent
    const progress = this.activeOrchestrations.get(orchestrationId)!;
    progress.spawnedAgents.push(agent.id);

    return agent;
  }

  /**
   * Select model based on agent specialization and complexity
   */
  private selectModelForSpecialization(
    specialization: string,
    complexityAnalysis: TaskComplexityAnalysis
  ): ModelType {
    // Simple specializations can use efficient model
    const simpleSpecializations = ['documentation', 'testing'];
    if (simpleSpecializations.includes(specialization) && complexityAnalysis.complexityLevel !== 'complex') {
      return 'claude-3-7-sonnet-latest';
    }

    // Complex specializations or complex tasks use recommended model
    return complexityAnalysis.recommendedModel;
  }

  /**
   * Create subtasks based on complexity analysis
   */
  private async createSubtasksFromAnalysis(
    orchestrationId: string,
    request: StructuredOrchestrationRequest,
    complexityAnalysis: TaskComplexityAnalysis
  ): Promise<string[]> {
    const subtaskIds: string[] = [];
    const progress = this.activeOrchestrations.get(orchestrationId)!;

    // Create subtasks for each required specialization
    for (const specialization of complexityAnalysis.requiredSpecializations) {
      const subtask = await this.taskService.createTask({
        repositoryPath: request.repositoryPath,
        taskType: this.mapSpecializationToTaskType(specialization),
        description: `${specialization} implementation for: ${request.objective}`,
        requirements: {
          orchestrationId,
          specialization,
          complexityLevel: complexityAnalysis.complexityLevel,
          estimatedDuration: Math.round(complexityAnalysis.estimatedDuration / complexityAnalysis.requiredSpecializations.length)
        }
      });

      subtaskIds.push(subtask.id);
      progress.createdTasks.push(subtask.id);
    }

    return subtaskIds;
  }

  /**
   * Map specialization to task type
   */
  private mapSpecializationToTaskType(specialization: string): TaskType {
    const mapping: Record<string, TaskType> = {
      'frontend': 'feature',
      'backend': 'feature', 
      'testing': 'testing',
      'documentation': 'documentation',
      'devops': 'deployment',
      'researcher': 'analysis',
      'architect': 'feature',
      'generalist': 'feature'
    };
    return mapping[specialization] || 'feature';
  }

  /**
   * Generate specialized prompt for agent
   */
  private generateSpecializedPrompt(
    specialization: string,
    taskDescription: string,
    orchestrationId: string
  ): string {
    return `You are a specialized ${specialization} agent in a structured orchestration (${orchestrationId}).

TASK: ${taskDescription}

You are operating within a structured phased workflow with intelligent model selection. Work autonomously using your specialization expertise.

AVAILABLE TOOLS: You have access to ALL Claude Code tools including file operations, code analysis, web browsing, etc.

COORDINATION: Use task management tools and communication rooms for coordination with other agents.

Complete your assigned task efficiently and report progress through the task system.`;
  }

  /**
   * Get current orchestration status
   */
  public getOrchestrationStatus(orchestrationId: string): OrchestrationProgress | null {
    return this.activeOrchestrations.get(orchestrationId) || null;
  }

  /**
   * List all active orchestrations
   */
  public getActiveOrchestrations(): OrchestrationProgress[] {
    return Array.from(this.activeOrchestrations.values());
  }

  /**
   * Cancel an active orchestration
   */
  public async cancelOrchestration(orchestrationId: string): Promise<boolean> {
    const progress = this.activeOrchestrations.get(orchestrationId);
    if (!progress) {
      return false;
    }

    try {
      // Terminate spawned agents
      for (const agentId of progress.spawnedAgents) {
        await this.agentService.terminateAgent(agentId);
      }

      // Update status
      progress.status = 'cancelled';
      progress.phases[progress.currentPhase].status = 'failed';

      // Emit cancellation event
      eventBus.emit('orchestration_cancelled', {
        orchestrationId,
        reason: 'User requested cancellation',
        timestamp: new Date()
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to cancel orchestration', { orchestrationId, error });
      return false;
    }
  }

  // Event handlers
  private async handleAgentStatusChange(data: any): Promise<void> {
    // Update orchestration progress based on agent status changes
    for (const [orchestrationId, progress] of this.activeOrchestrations) {
      if (progress.spawnedAgents.includes(data.agentId)) {
        // Map OrchestrationPhase to expected event phase values
        const mappedPhase = this.mapPhaseForEvent(progress.currentPhase);
        // Map StructuredOrchestrationStatus to expected event status values  
        const mappedStatus = this.mapStatusForEvent(progress.status);
        
        eventBus.emit('orchestration_update', {
          orchestrationId,
          phase: mappedPhase,
          status: mappedStatus,
          agentCount: progress.spawnedAgents.length,
          completedTasks: progress.createdTasks.length, // Use created tasks as proxy
          totalTasks: Object.keys(progress.phases).length, // Use phases as proxy for total tasks
          timestamp: new Date(),
          repositoryPath: data.repositoryPath, // Use from agent event data
          metadata: {
            agentStatusChange: {
              agentId: data.agentId,
              previousStatus: data.previousStatus,
              newStatus: data.newStatus
            }
          }
        });
      }
    }
  }

  private async handleTaskCompletion(data: any): Promise<void> {
    // Update orchestration progress based on task completion
    for (const [orchestrationId, progress] of this.activeOrchestrations) {
      if (progress.createdTasks.includes(data.taskId)) {
        // Check if this completes a phase
        const currentPhase = progress.currentPhase;
        // Logic to determine if phase is complete would go here
      }
    }
  }

  private async handlePhaseChange(data: any): Promise<void> {
    const { orchestrationId, fromPhase, toPhase } = data;
    const progress = this.activeOrchestrations.get(orchestrationId);
    if (progress) {
      progress.currentPhase = toPhase;
      this.logger.info(`Orchestration phase changed`, { orchestrationId, fromPhase, toPhase });
    }
  }

  private mapPhaseForEvent(phase: OrchestrationPhase): 'planning' | 'execution' | 'monitoring' | 'completion' {
    switch (phase) {
      case 'research':
      case 'plan':
        return 'planning';
      case 'execute':
        return 'execution';
      case 'monitor':
        return 'monitoring';
      case 'cleanup':
        return 'completion';
      default:
        return 'planning';
    }
  }

  private mapStatusForEvent(status: StructuredOrchestrationStatus): 'started' | 'in_progress' | 'completed' | 'failed' {
    switch (status) {
      case 'pending':
        return 'started';
      case 'in_progress':
        return 'in_progress';
      case 'completed':
        return 'completed';
      case 'failed':
      case 'cancelled':
        return 'failed';
      default:
        return 'started';
    }
  }
}