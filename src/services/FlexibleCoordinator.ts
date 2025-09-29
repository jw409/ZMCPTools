import { Logger } from '../utils/logger.js';
import { DatabaseManager } from '../database/index.js';
import { AgentService } from './AgentService.js';
import { CommunicationService } from './CommunicationService.js';
import { FairShareScheduler } from './FairShareScheduler.js';
import { TaskComplexityAnalyzer, type TaskComplexityAnalysis } from './TaskComplexityAnalyzer.js';
import { eventBus } from './EventBus.js';
import type { AgentConfig } from '../schemas/index.js';

export type WorkflowPattern = 'sequential' | 'parallel' | 'adaptive' | 'custom';
export type CoordinationMode = 'waterfall' | 'agile' | 'kanban' | 'freestyle';
export type TeamSizeMode = 'minimal' | 'optimal' | 'maximum' | 'auto';

export interface TeamComposition {
  agents: TeamAgent[];
  coordinationRoom?: string;
  workflowPattern: WorkflowPattern;
  coordinationMode: CoordinationMode;
  selfOrganizing: boolean;
}

export interface TeamAgent {
  id: string;
  agentName: string;
  specialization: string;
  capabilities: string[];
  role?: 'leader' | 'contributor' | 'specialist';
  priority?: number;
}

export interface FlexibleCoordinationRequest {
  objective: string;
  repositoryPath: string;
  teamSizeMode?: TeamSizeMode;
  workflowPattern?: WorkflowPattern;
  coordinationMode?: CoordinationMode;
  selfOrganizing?: boolean;
  foundationSessionId?: string;
  maxTeamSize?: number;
  preferredSpecializations?: string[];
}

export interface CoordinationStrategy {
  name: string;
  description: string;
  teamSizeRange: [number, number];
  workflowPattern: WorkflowPattern;
  coordinationMode: CoordinationMode;
  agentInteractionStyle: 'hierarchical' | 'peer' | 'dynamic';
  decisionMaking: 'consensus' | 'leader' | 'voting' | 'fair_share';
}

/**
 * FlexibleCoordinator - Workflow-agnostic agent coordination service
 *
 * Supports multiple coordination patterns without enforcing rigid workflows.
 * Uses fair share scheduling for natural coordination and self-organization.
 */
export class FlexibleCoordinator {
  private logger: Logger;
  private agentService: AgentService;
  private communicationService: CommunicationService;
  private complexityAnalyzer: TaskComplexityAnalyzer;
  private fairShareScheduler: FairShareScheduler;

  // Predefined coordination strategies
  private strategies: Map<string, CoordinationStrategy> = new Map();

  // Active coordinated teams
  private activeTeams = new Map<string, TeamComposition>();

  constructor(private db: DatabaseManager) {
    this.logger = new Logger('FlexibleCoordinator');
    this.agentService = new AgentService(db);
    this.communicationService = new CommunicationService(db);
    this.complexityAnalyzer = new TaskComplexityAnalyzer();
    this.fairShareScheduler = new FairShareScheduler();

    this.initializeStrategies();
    this.setupEventListeners();
  }

  /**
   * Initialize predefined coordination strategies
   */
  private initializeStrategies(): void {
    this.strategies.set('waterfall', {
      name: 'Waterfall',
      description: 'Sequential phases with clear handoffs',
      teamSizeRange: [2, 5],
      workflowPattern: 'sequential',
      coordinationMode: 'waterfall',
      agentInteractionStyle: 'hierarchical',
      decisionMaking: 'leader'
    });

    this.strategies.set('agile', {
      name: 'Agile',
      description: 'Iterative development with frequent collaboration',
      teamSizeRange: [3, 8],
      workflowPattern: 'adaptive',
      coordinationMode: 'agile',
      agentInteractionStyle: 'peer',
      decisionMaking: 'consensus'
    });

    this.strategies.set('kanban', {
      name: 'Kanban',
      description: 'Continuous flow with work-in-progress limits',
      teamSizeRange: [2, 6],
      workflowPattern: 'parallel',
      coordinationMode: 'kanban',
      agentInteractionStyle: 'peer',
      decisionMaking: 'fair_share'
    });

    this.strategies.set('freestyle', {
      name: 'Freestyle',
      description: 'Self-organizing team with minimal structure',
      teamSizeRange: [2, 10],
      workflowPattern: 'adaptive',
      coordinationMode: 'freestyle',
      agentInteractionStyle: 'dynamic',
      decisionMaking: 'fair_share'
    });
  }

  /**
   * Set up event listeners for coordination
   */
  private setupEventListeners(): void {
    // Agent status changes affect coordination
    eventBus.subscribe('agent_status_change', async (data) => {
      await this.handleAgentStatusChange(data.agentId, data.status);
    });

    // Task completion may trigger coordination adjustments
    eventBus.subscribe('task_completed', async (data) => {
      await this.handleTaskCompletion(data.agentId, data.taskId);
    });

    // Team coordination events
    eventBus.subscribe('team_coordination_needed', async (data) => {
      await this.handleCoordinationRequest(data);
    });
  }

  /**
   * Assemble a team for the given objective
   */
  async assembleTeam(request: FlexibleCoordinationRequest): Promise<TeamComposition> {
    this.logger.info('Assembling team', { objective: request.objective });

    // Step 1: Analyze task complexity to determine requirements
    const complexityAnalysis = await this.complexityAnalyzer.analyzeTask(
      request.objective,
      'feature',
      request.repositoryPath,
      {
        includeArchitectural: true,
        considerDependencies: true,
        estimateResourceNeeds: true
      }
    );

    // Step 2: Select coordination strategy
    const strategy = this.selectCoordinationStrategy(request, complexityAnalysis);

    // Step 3: Determine optimal team composition
    const teamSize = this.calculateOptimalTeamSize(request, complexityAnalysis, strategy);
    const specializations = this.selectRequiredSpecializations(complexityAnalysis, request.preferredSpecializations);

    // Step 4: Spawn agents
    const agents = await this.spawnTeamAgents(
      specializations,
      teamSize,
      request,
      strategy
    );

    // Step 5: Create coordination room if needed
    const coordinationRoom = await this.createCoordinationRoom(agents, request, strategy);

    // Step 6: Configure team coordination
    const team: TeamComposition = {
      agents,
      coordinationRoom,
      workflowPattern: strategy.workflowPattern,
      coordinationMode: strategy.coordinationMode,
      selfOrganizing: request.selfOrganizing ?? strategy.decisionMaking === 'fair_share'
    };

    const teamId = `team_${Date.now()}`;
    this.activeTeams.set(teamId, team);

    // Step 7: Initialize coordination
    await this.initializeTeamCoordination(team, request, strategy, teamId);

    this.logger.info('Team assembled successfully', {
      teamId,
      agentCount: agents.length,
      strategy: strategy.name,
      coordinationRoom
    });

    return team;
  }

  /**
   * Select appropriate coordination strategy
   */
  private selectCoordinationStrategy(
    request: FlexibleCoordinationRequest,
    complexityAnalysis: TaskComplexityAnalysis
  ): CoordinationStrategy {
    // If explicitly specified, use that mode
    if (request.coordinationMode) {
      const strategy = this.strategies.get(request.coordinationMode);
      if (strategy) {
        return strategy;
      }
    }

    // Auto-select based on complexity
    if (complexityAnalysis.complexityLevel === 'simple') {
      return this.strategies.get('kanban')!; // Simple tasks work well with flow
    } else if (complexityAnalysis.complexityLevel === 'complex') {
      return this.strategies.get('agile')!; // Complex tasks need iteration
    } else if (complexityAnalysis.requiresArchitecturalChanges) {
      return this.strategies.get('waterfall')!; // Architectural changes benefit from phases
    } else {
      return this.strategies.get('freestyle')!; // Default to self-organizing
    }
  }

  /**
   * Calculate optimal team size
   */
  private calculateOptimalTeamSize(
    request: FlexibleCoordinationRequest,
    complexityAnalysis: TaskComplexityAnalysis,
    strategy: CoordinationStrategy
  ): number {
    const [minSize, maxSize] = strategy.teamSizeRange;

    if (request.teamSizeMode === 'minimal') {
      return minSize;
    } else if (request.teamSizeMode === 'maximum') {
      return Math.min(maxSize, request.maxTeamSize ?? maxSize);
    }

    // Calculate based on complexity
    const baseSize = Math.ceil(complexityAnalysis.requiredSpecializations.length * 0.8);
    const complexityMultiplier = complexityAnalysis.complexityLevel === 'simple' ? 0.8 :
                                complexityAnalysis.complexityLevel === 'complex' ? 1.3 : 1.0;

    const optimalSize = Math.round(baseSize * complexityMultiplier);

    return Math.max(minSize, Math.min(maxSize, optimalSize));
  }

  /**
   * Select required specializations based on analysis
   */
  private selectRequiredSpecializations(
    complexityAnalysis: TaskComplexityAnalysis,
    preferredSpecializations?: string[]
  ): string[] {
    const required = [...complexityAnalysis.requiredSpecializations];

    // Add preferred specializations if they make sense
    if (preferredSpecializations) {
      for (const spec of preferredSpecializations) {
        if (!required.includes(spec)) {
          required.push(spec);
        }
      }
    }

    // Ensure we have at least one generalist
    if (!required.includes('general') && !required.includes('backend') && !required.includes('frontend')) {
      required.push('general');
    }

    return required;
  }

  /**
   * Spawn team agents with appropriate configurations
   */
  private async spawnTeamAgents(
    specializations: string[],
    teamSize: number,
    request: FlexibleCoordinationRequest,
    strategy: CoordinationStrategy
  ): Promise<TeamAgent[]> {
    const agents: TeamAgent[] = [];

    // Distribute specializations across team size
    const agentsPerSpec = Math.max(1, Math.floor(teamSize / specializations.length));
    let currentAgent = 0;

    for (const specialization of specializations) {
      const agentsForThisSpec = Math.min(agentsPerSpec, teamSize - currentAgent);

      for (let i = 0; i < agentsForThisSpec; i++) {
        const agentName = `${specialization}_${currentAgent + 1}`;
        const taskDescription = this.generateSpecializedTaskDescription(
          specialization,
          request.objective,
          strategy
        );

        const agentConfig: AgentConfig = {
          agentName,
          repositoryPath: request.repositoryPath,
          taskDescription,
          capabilities: ['ALL_TOOLS'],
          metadata: {
            specialization,
            coordinationMode: strategy.coordinationMode,
            workflowPattern: strategy.workflowPattern,
            selfOrganizing: strategy.decisionMaking === 'fair_share',
            teamRole: i === 0 ? 'leader' : 'contributor', // First agent of each specialization is leader
            spawnedAt: new Date().toISOString()
          }
        };

        const agent = await this.agentService.createAgent(agentConfig);

        agents.push({
          id: agent.id,
          agentName: agent.agentName,
          specialization,
          capabilities: agentConfig.capabilities,
          role: agentConfig.metadata?.teamRole as 'leader' | 'contributor',
          priority: this.calculateAgentPriority(specialization, strategy)
        });

        currentAgent++;
        if (currentAgent >= teamSize) break;
      }

      if (currentAgent >= teamSize) break;
    }

    return agents;
  }

  /**
   * Create coordination room for the team
   */
  private async createCoordinationRoom(
    agents: TeamAgent[],
    request: FlexibleCoordinationRequest,
    strategy: CoordinationStrategy
  ): Promise<string | undefined> {
    if (strategy.agentInteractionStyle === 'hierarchical' && !request.selfOrganizing) {
      // Hierarchical teams might not need a room
      return undefined;
    }

    // Create room with descriptive name
    const roomName = `coord_${strategy.coordinationMode}_${Date.now()}`;

    try {
      // Join all agents to the room
      for (const agent of agents) {
        await this.communicationService.joinRoom(roomName, agent.agentName);
      }

      // Send initial coordination message
      await this.communicationService.sendMessage({
        roomName,
        agentName: 'FlexibleCoordinator',
        message: this.generateInitialCoordinationMessage(request, strategy, agents),
        messageType: 'system'
      });

      return roomName;
    } catch (error) {
      this.logger.warn('Failed to create coordination room', { error, roomName });
      return undefined;
    }
  }

  /**
   * Initialize team coordination based on strategy
   */
  private async initializeTeamCoordination(
    team: TeamComposition,
    request: FlexibleCoordinationRequest,
    strategy: CoordinationStrategy,
    teamId?: string
  ): Promise<void> {
    // Set agent roles in fair share scheduler
    for (const agent of team.agents) {
      if (agent.role === 'leader') {
        this.fairShareScheduler.setPhaseRole(agent.id, 'leader');
      } else {
        this.fairShareScheduler.setPhaseRole(agent.id, 'participant');
      }
    }

    // Configure coordination mode specific settings
    switch (strategy.coordinationMode) {
      case 'agile':
        await this.initializeAgileCoordination(team, request);
        break;
      case 'kanban':
        await this.initializeKanbanCoordination(team, request);
        break;
      case 'waterfall':
        await this.initializeWaterfallCoordination(team, request);
        break;
      case 'freestyle':
        await this.initializeFreestyleCoordination(team, request, teamId);
        break;
    }
  }

  /**
   * Get available coordination strategies
   */
  getAvailableStrategies(): CoordinationStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get active teams
   */
  getActiveTeams(): TeamComposition[] {
    return Array.from(this.activeTeams.values());
  }

  /**
   * Enable self-organization for a team
   */
  async enableSelfOrganization(teamId: string): Promise<void> {
    const team = this.activeTeams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    team.selfOrganizing = true;

    // Update all agents to participant role for fair share scheduling
    for (const agent of team.agents) {
      this.fairShareScheduler.setPhaseRole(agent.id, 'participant');
    }

    this.logger.info('Self-organization enabled', { teamId });
  }

  // Private helper methods

  private generateSpecializedTaskDescription(
    specialization: string,
    objective: string,
    strategy: CoordinationStrategy
  ): string {
    const coordinationStyle = strategy.coordinationMode;
    return `As a ${specialization} specialist in a ${coordinationStyle} team: ${objective}. Coordinate with team members using fair share communication priorities.`;
  }

  private calculateAgentPriority(specialization: string, strategy: CoordinationStrategy): number {
    // Base priority on specialization importance and strategy
    const basePriority = 5.0;

    if (specialization === 'architect' || specialization === 'backend') {
      return basePriority + 1.0; // Higher priority for core specializations
    } else if (specialization === 'testing' || specialization === 'documentation') {
      return basePriority - 1.0; // Lower priority for support specializations
    }

    return basePriority;
  }

  private generateInitialCoordinationMessage(
    request: FlexibleCoordinationRequest,
    strategy: CoordinationStrategy,
    agents: TeamAgent[]
  ): string {
    return `🤝 Team coordination initialized
Objective: ${request.objective}
Strategy: ${strategy.name} (${strategy.description})
Team: ${agents.map(a => `${a.agentName} (${a.specialization})`).join(', ')}
Coordination: ${strategy.decisionMaking === 'fair_share' ? 'Self-organizing via fair share priorities' : strategy.decisionMaking}

Begin collaboration!`;
  }

  // Coordination mode specific initialization
  private async initializeAgileCoordination(team: TeamComposition, request: FlexibleCoordinationRequest): Promise<void> {
    // Agile: Enable frequent coordination, short iterations
    this.logger.debug('Initializing agile coordination', { team: team.agents.length });
  }

  private async initializeKanbanCoordination(team: TeamComposition, request: FlexibleCoordinationRequest): Promise<void> {
    // Kanban: Focus on flow and WIP limits
    this.logger.debug('Initializing kanban coordination', { team: team.agents.length });
  }

  private async initializeWaterfallCoordination(team: TeamComposition, request: FlexibleCoordinationRequest): Promise<void> {
    // Waterfall: Sequential handoffs
    this.logger.debug('Initializing waterfall coordination', { team: team.agents.length });
  }

  private async initializeFreestyleCoordination(team: TeamComposition, request: FlexibleCoordinationRequest, teamId?: string): Promise<void> {
    // Freestyle: Pure self-organization
    if (teamId) {
      await this.enableSelfOrganization(teamId);
    }
    this.logger.debug('Initializing freestyle coordination', { team: team.agents.length });
  }

  // Event handlers
  private async handleAgentStatusChange(agentId: string, status: string): Promise<void> {
    // Update agent work state for fair share scheduling
    const workState = status === 'active' ? 'active' :
                     status === 'failed' ? 'critical' :
                     status === 'completed' ? 'completing' : 'idle';

    this.communicationService.updateAgentWorkState(agentId, workState);
  }

  private async handleTaskCompletion(agentId: string, taskId: string): Promise<void> {
    // Task completion affects agent velocity
    await this.agentService.reportTaskProgress(agentId, 'completed');
  }

  private async handleCoordinationRequest(data: any): Promise<void> {
    this.logger.info('Handling coordination request', { data });
    // Handle dynamic coordination requests
  }
}