import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { DatabaseManager } from '../src/database/index.js';
import { FlexibleCoordinator, type FlexibleCoordinationRequest, type CoordinationMode, type WorkflowPattern } from '../src/services/FlexibleCoordinator.js';
import { FairShareScheduler, type AgentWorkState } from '../src/services/FairShareScheduler.js';
import { StructuredOrchestrator, type StructuredOrchestrationRequest } from '../src/services/StructuredOrchestrator.js';
import { eventBus } from '../src/services/EventBus.js';

// Mock external dependencies
vi.mock('../src/services/AgentService.js');
vi.mock('../src/services/CommunicationService.js');
vi.mock('../src/services/TaskService.js');
vi.mock('../src/database/index.js');

describe('Collaborative Agent Architecture', () => {
  let db: DatabaseManager;
  let fairShareScheduler: FairShareScheduler;
  let flexibleCoordinator: FlexibleCoordinator;
  let structuredOrchestrator: StructuredOrchestrator;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create test database
    db = new DatabaseManager(':memory:');
    await db.initialize();

    // Initialize services
    fairShareScheduler = new FairShareScheduler();
    flexibleCoordinator = new FlexibleCoordinator(db);
    structuredOrchestrator = new StructuredOrchestrator(db, '/test/repo');
  });

  afterEach(async () => {
    await db.close();
  });

  describe('FairShareScheduler', () => {
    it('should calculate priority based on agent work state', () => {
      const agentId = 'test-agent-1';

      // Test blocked state gets high priority
      fairShareScheduler.updateAgentWorkState(agentId, 'blocked');
      const blockedPriority = fairShareScheduler.calculateCommunicationPriority(agentId);
      expect(blockedPriority.priority).toBeGreaterThan(7.0);
      expect(blockedPriority.reason).toContain('Blocked state');

      // Test active state gets moderate priority
      fairShareScheduler.updateAgentWorkState(agentId, 'active');
      const activePriority = fairShareScheduler.calculateCommunicationPriority(agentId);
      expect(activePriority.priority).toBeLessThan(blockedPriority.priority);
      expect(activePriority.reason).toContain('Active state');

      // Test idle state gets lower priority
      fairShareScheduler.updateAgentWorkState(agentId, 'idle');
      const idlePriority = fairShareScheduler.calculateCommunicationPriority(agentId);
      expect(idlePriority.priority).toBeLessThan(activePriority.priority);
      expect(idlePriority.reason).toContain('Idle state');
    });

    it('should prioritize agents with leadership roles', () => {
      const leaderId = 'leader-agent';
      const participantId = 'participant-agent';

      fairShareScheduler.setPhaseRole(leaderId, 'leader');
      fairShareScheduler.setPhaseRole(participantId, 'participant');

      const leaderPriority = fairShareScheduler.calculateCommunicationPriority(leaderId);
      const participantPriority = fairShareScheduler.calculateCommunicationPriority(participantId);

      expect(leaderPriority.priority).toBeGreaterThan(participantPriority.priority);
      expect(leaderPriority.reason).toContain('Phase leader');
    });

    it('should provide anti-starvation protection', () => {
      const agentId = 'starved-agent';

      // Simulate agent hasn't spoken for a while
      const longAgo = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      fairShareScheduler.recordCommunicationActivity(agentId);

      // Fast-forward time simulation
      vi.setSystemTime(Date.now() + 10 * 60 * 1000);

      const priority = fairShareScheduler.calculateCommunicationPriority(agentId);
      expect(priority.reason).toContain('Starvation protection');
      expect(priority.priority).toBeGreaterThan(5.0);

      vi.useRealTimers();
    });

    it('should select highest priority agent as next speaker', () => {
      const agents = ['agent-1', 'agent-2', 'agent-3'];

      // Set different work states
      fairShareScheduler.updateAgentWorkState('agent-1', 'idle');
      fairShareScheduler.updateAgentWorkState('agent-2', 'blocked'); // Should win
      fairShareScheduler.updateAgentWorkState('agent-3', 'active');

      const nextSpeaker = fairShareScheduler.getNextSpeaker('test-room', agents);
      expect(nextSpeaker).toBe('agent-2'); // Blocked agent should have highest priority
    });
  });

  describe('FlexibleCoordinator', () => {
    it('should provide multiple coordination strategies', () => {
      const strategies = flexibleCoordinator.getAvailableStrategies();

      expect(strategies).toHaveLength(4);
      expect(strategies.map(s => s.name)).toEqual(['Waterfall', 'Agile', 'Kanban', 'Freestyle']);

      // Check strategy properties
      const agileStrategy = strategies.find(s => s.name === 'Agile');
      expect(agileStrategy).toBeDefined();
      expect(agileStrategy!.coordinationMode).toBe('agile');
      expect(agileStrategy!.workflowPattern).toBe('adaptive');
      expect(agileStrategy!.decisionMaking).toBe('consensus');
    });

    it('should assemble teams based on coordination mode', async () => {
      const request: FlexibleCoordinationRequest = {
        objective: 'Build user authentication system',
        repositoryPath: '/test/repo',
        coordinationMode: 'agile',
        teamSizeMode: 'optimal'
      };

      // Mock complexity analysis response
      const mockComplexityAnalysis = {
        complexityLevel: 'moderate' as const,
        requiredSpecializations: ['backend', 'frontend', 'testing'],
        recommendedModel: 'claude-3-sonnet' as const,
        estimatedDuration: 120
      };

      vi.spyOn(flexibleCoordinator['complexityAnalyzer'], 'analyzeTask').mockResolvedValue(mockComplexityAnalysis);

      // Mock agent creation
      vi.spyOn(flexibleCoordinator['agentService'], 'createAgent').mockImplementation(async (config) => ({
        id: `agent-${Date.now()}-${Math.random()}`,
        agentName: config.agentName,
        status: 'active' as const,
        repositoryPath: config.repositoryPath,
        taskDescription: config.taskDescription,
        capabilities: config.capabilities,
        metadata: config.metadata
      }));

      const team = await flexibleCoordinator.assembleTeam(request);

      expect(team.coordinationMode).toBe('agile');
      expect(team.workflowPattern).toBe('adaptive');
      expect(team.agents.length).toBeGreaterThanOrEqual(2);
      expect(team.agents.length).toBeLessThanOrEqual(8); // Agile team size range

      // Should have the required specializations
      const specializations = team.agents.map(a => a.specialization);
      expect(specializations).toContain('backend');
      expect(specializations).toContain('frontend');
      expect(specializations).toContain('testing');
    });

    it('should support different workflow patterns via coordination modes', async () => {
      // Test specific coordination modes that map to workflow patterns
      const testCases = [
        { coordinationMode: 'waterfall' as CoordinationMode, expectedPattern: 'sequential' as WorkflowPattern },
        { coordinationMode: 'kanban' as CoordinationMode, expectedPattern: 'parallel' as WorkflowPattern },
        { coordinationMode: 'agile' as CoordinationMode, expectedPattern: 'adaptive' as WorkflowPattern },
        { coordinationMode: 'freestyle' as CoordinationMode, expectedPattern: 'adaptive' as WorkflowPattern }
      ];

      for (const testCase of testCases) {
        const request: FlexibleCoordinationRequest = {
          objective: 'Test workflow pattern',
          repositoryPath: '/test/repo',
          coordinationMode: testCase.coordinationMode,
          teamSizeMode: 'minimal'
        };

        // Mock minimal setup
        vi.spyOn(flexibleCoordinator['complexityAnalyzer'], 'analyzeTask').mockResolvedValue({
          complexityLevel: 'simple' as const,
          requiredSpecializations: ['general'],
          recommendedModel: 'claude-3-haiku' as const,
          estimatedDuration: 30
        });

        vi.spyOn(flexibleCoordinator['agentService'], 'createAgent').mockResolvedValue({
          id: `agent-${testCase.coordinationMode}`,
          agentName: `agent-${testCase.coordinationMode}`,
          status: 'active' as const,
          repositoryPath: '/test/repo',
          taskDescription: 'Test task',
          capabilities: ['ALL_TOOLS'],
          metadata: {}
        });

        const team = await flexibleCoordinator.assembleTeam(request);
        expect(team.coordinationMode).toBe(testCase.coordinationMode);
        expect(team.workflowPattern).toBe(testCase.expectedPattern);
      }
    });

    it('should enable self-organization mode', async () => {
      const teamId = 'test-team-1';

      // Mock team data
      const mockTeam = {
        agents: [
          { id: 'agent-1', agentName: 'backend-1', specialization: 'backend', capabilities: [], role: 'leader' as const },
          { id: 'agent-2', agentName: 'frontend-1', specialization: 'frontend', capabilities: [], role: 'contributor' as const }
        ],
        coordinationRoom: 'test-room',
        workflowPattern: 'adaptive' as const,
        coordinationMode: 'freestyle' as const,
        selfOrganizing: false
      };

      flexibleCoordinator['activeTeams'].set(teamId, mockTeam);

      await flexibleCoordinator.enableSelfOrganization(teamId);

      const updatedTeam = flexibleCoordinator['activeTeams'].get(teamId);
      expect(updatedTeam?.selfOrganizing).toBe(true);
    });
  });

  describe('StructuredOrchestrator Integration', () => {
    it('should integrate FlexibleCoordinator for dynamic team assembly', async () => {
      const request: StructuredOrchestrationRequest = {
        title: 'Test Collaboration',
        objective: 'Build a collaborative feature',
        repositoryPath: '/test/repo',
        coordinationMode: 'kanban',
        teamSizeMode: 'optimal',
        selfOrganizing: true,
        maxTeamSize: 5
      };

      // Mock all required dependencies
      vi.spyOn(structuredOrchestrator['complexityAnalyzer'], 'analyzeTask').mockResolvedValue({
        complexityLevel: 'moderate' as const,
        requiredSpecializations: ['backend', 'frontend'],
        recommendedModel: 'claude-3-sonnet' as const,
        estimatedDuration: 90
      });

      vi.spyOn(structuredOrchestrator['flexibleCoordinator'], 'assembleTeam').mockResolvedValue({
        agents: [
          { id: 'agent-1', agentName: 'backend-1', specialization: 'backend', capabilities: [], role: 'leader' },
          { id: 'agent-2', agentName: 'frontend-1', specialization: 'frontend', capabilities: [], role: 'contributor' }
        ],
        coordinationRoom: 'test-coordination-room',
        workflowPattern: 'parallel',
        coordinationMode: 'kanban',
        selfOrganizing: true
      });

      vi.spyOn(structuredOrchestrator['taskService'], 'createTask').mockResolvedValue({
        id: 'task-1',
        repositoryPath: '/test/repo',
        taskType: 'feature',
        title: 'Test Task',
        description: 'Test task description',
        status: 'pending',
        priority: 10,
        requirements: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Mock monitoring to return success quickly
      vi.spyOn(structuredOrchestrator as any, 'monitorFlexibleTeamExecution').mockResolvedValue({
        success: true,
        finalResults: {
          backend: { status: 'completed', output: 'Backend implementation complete' },
          frontend: { status: 'completed', output: 'Frontend implementation complete' },
          team_summary: {
            size: 2,
            specializations: ['backend', 'frontend'],
            coordinationMode: 'kanban',
            workflowPattern: 'parallel',
            selfOrganizing: true
          }
        }
      });

      const result = await structuredOrchestrator.orchestrateObjectiveStructured(request);

      expect(result.success).toBe(true);
      expect(result.progress.teamComposition).toBeDefined();
      expect(result.progress.coordinationMode).toBe('kanban');
      expect(result.progress.spawnedAgents).toHaveLength(2);
    });

    it('should handle various coordination modes', async () => {
      const modes: CoordinationMode[] = ['waterfall', 'agile', 'kanban', 'freestyle'];

      for (const mode of modes) {
        const request: StructuredOrchestrationRequest = {
          title: `Test ${mode}`,
          objective: `Test ${mode} coordination`,
          repositoryPath: '/test/repo',
          coordinationMode: mode,
          teamSizeMode: 'minimal'
        };

        // Mock dependencies for each mode
        vi.spyOn(structuredOrchestrator['complexityAnalyzer'], 'analyzeTask').mockResolvedValue({
          complexityLevel: 'simple' as const,
          requiredSpecializations: ['general'],
          recommendedModel: 'claude-3-haiku' as const,
          estimatedDuration: 30
        });

        vi.spyOn(structuredOrchestrator['flexibleCoordinator'], 'assembleTeam').mockResolvedValue({
          agents: [{ id: `agent-${mode}`, agentName: `agent-${mode}`, specialization: 'general', capabilities: [] }],
          coordinationRoom: `room-${mode}`,
          workflowPattern: 'adaptive',
          coordinationMode: mode,
          selfOrganizing: mode === 'freestyle'
        });

        vi.spyOn(structuredOrchestrator['taskService'], 'createTask').mockResolvedValue({
          id: `task-${mode}`,
          repositoryPath: '/test/repo',
          taskType: 'feature',
          title: `Test ${mode}`,
          description: `Test ${mode} task`,
          status: 'pending',
          priority: 5,
          requirements: {},
          createdAt: new Date(),
          updatedAt: new Date()
        });

        vi.spyOn(structuredOrchestrator as any, 'monitorFlexibleTeamExecution').mockResolvedValue({
          success: true,
          finalResults: { [`${mode}_result`]: 'success' }
        });

        const result = await structuredOrchestrator.orchestrateObjectiveStructured(request);

        expect(result.success).toBe(true);
        expect(result.progress.coordinationMode).toBe(mode);
      }
    });
  });

  describe('End-to-End Coordination Workflow', () => {
    it('should complete a full collaborative workflow', async () => {
      const request: StructuredOrchestrationRequest = {
        title: 'E2E Collaboration Test',
        objective: 'Build a complete feature with testing and documentation',
        repositoryPath: '/test/repo',
        coordinationMode: 'agile',
        teamSizeMode: 'optimal',
        selfOrganizing: true,
        preferredSpecializations: ['backend', 'frontend', 'testing', 'documentation']
      };

      // Mock complex scenario
      vi.spyOn(structuredOrchestrator['complexityAnalyzer'], 'analyzeTask').mockResolvedValue({
        complexityLevel: 'complex' as const,
        requiredSpecializations: ['backend', 'frontend', 'testing', 'documentation'],
        recommendedModel: 'claude-3-opus' as const,
        estimatedDuration: 240,
        requiresArchitecturalChanges: true,
        estimatedResourceNeeds: {
          computeHours: 10,
          specialistHours: { backend: 4, frontend: 3, testing: 2, documentation: 1 }
        }
      });

      vi.spyOn(structuredOrchestrator['flexibleCoordinator'], 'assembleTeam').mockResolvedValue({
        agents: [
          { id: 'backend-agent', agentName: 'backend-specialist', specialization: 'backend', capabilities: [], role: 'leader' },
          { id: 'frontend-agent', agentName: 'frontend-specialist', specialization: 'frontend', capabilities: [], role: 'contributor' },
          { id: 'testing-agent', agentName: 'testing-specialist', specialization: 'testing', capabilities: [], role: 'contributor' },
          { id: 'docs-agent', agentName: 'docs-specialist', specialization: 'documentation', capabilities: [], role: 'contributor' }
        ],
        coordinationRoom: 'agile-team-room',
        workflowPattern: 'adaptive',
        coordinationMode: 'agile',
        selfOrganizing: true
      });

      vi.spyOn(structuredOrchestrator['taskService'], 'createTask').mockResolvedValue({
        id: 'master-task',
        repositoryPath: '/test/repo',
        taskType: 'feature',
        title: 'E2E Collaboration Test',
        description: 'Master orchestration task',
        status: 'pending',
        priority: 10,
        requirements: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Mock comprehensive results
      vi.spyOn(structuredOrchestrator as any, 'monitorFlexibleTeamExecution').mockResolvedValue({
        success: true,
        finalResults: {
          backend: {
            status: 'completed',
            output: 'API endpoints implemented with authentication',
            artifacts: ['auth.service.ts', 'user.controller.ts']
          },
          frontend: {
            status: 'completed',
            output: 'UI components created with responsive design',
            artifacts: ['LoginForm.tsx', 'UserDashboard.tsx']
          },
          testing: {
            status: 'completed',
            output: 'Comprehensive test suite with 95% coverage',
            artifacts: ['auth.test.ts', 'ui.test.ts']
          },
          documentation: {
            status: 'completed',
            output: 'API documentation and user guides created',
            artifacts: ['API.md', 'UserGuide.md']
          },
          coordination_summary: {
            room: 'agile-team-room',
            messageCount: 47,
            lastActivity: new Date()
          },
          team_summary: {
            size: 4,
            specializations: ['backend', 'frontend', 'testing', 'documentation'],
            coordinationMode: 'agile',
            workflowPattern: 'adaptive',
            selfOrganizing: true
          }
        }
      });

      const result = await structuredOrchestrator.orchestrateObjectiveStructured(request);

      expect(result.success).toBe(true);
      expect(result.progress.spawnedAgents).toHaveLength(4);
      expect(result.progress.teamComposition?.selfOrganizing).toBe(true);
      expect(result.finalResults?.team_summary.coordinationMode).toBe('agile');

      // Verify all specializations were handled
      const specializations = Object.keys(result.finalResults || {}).filter(key =>
        ['backend', 'frontend', 'testing', 'documentation'].includes(key)
      );
      expect(specializations).toHaveLength(4);
    });

    it('should handle team failures gracefully', async () => {
      const request: StructuredOrchestrationRequest = {
        title: 'Failure Test',
        objective: 'Test failure handling',
        repositoryPath: '/test/repo',
        coordinationMode: 'waterfall'
      };

      // Mock basic setup
      vi.spyOn(structuredOrchestrator['complexityAnalyzer'], 'analyzeTask').mockResolvedValue({
        complexityLevel: 'simple' as const,
        requiredSpecializations: ['general'],
        recommendedModel: 'claude-3-haiku' as const,
        estimatedDuration: 30
      });

      vi.spyOn(structuredOrchestrator['flexibleCoordinator'], 'assembleTeam').mockResolvedValue({
        agents: [{ id: 'failing-agent', agentName: 'failing-agent', specialization: 'general', capabilities: [] }],
        coordinationRoom: 'failure-room',
        workflowPattern: 'sequential',
        coordinationMode: 'waterfall',
        selfOrganizing: false
      });

      vi.spyOn(structuredOrchestrator['taskService'], 'createTask').mockResolvedValue({
        id: 'failing-task',
        repositoryPath: '/test/repo',
        taskType: 'feature',
        title: 'Failure Test',
        description: 'Task that will fail',
        status: 'pending',
        priority: 5,
        requirements: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Mock team execution failure
      vi.spyOn(structuredOrchestrator as any, 'monitorFlexibleTeamExecution').mockResolvedValue({
        success: false,
        error: 'Too many agents failed (1/1)'
      });

      const result = await structuredOrchestrator.orchestrateObjectiveStructured(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many agents failed');
      expect(result.progress.status).toBe('failed');
    });
  });

  describe('Fair Share Communication Integration', () => {
    it('should enforce fair share communication in teams', async () => {
      const roomName = 'test-fair-share-room';
      const participants = ['agent-1', 'agent-2', 'agent-3'];

      // Set up different priority scenarios
      fairShareScheduler.updateAgentWorkState('agent-1', 'blocked'); // High priority
      fairShareScheduler.updateAgentWorkState('agent-2', 'active');  // Medium priority
      fairShareScheduler.updateAgentWorkState('agent-3', 'idle');    // Low priority

      // Test next speaker selection
      const nextSpeaker = fairShareScheduler.getNextSpeaker(roomName, participants);
      expect(nextSpeaker).toBe('agent-1'); // Blocked agent should speak first

      // Test priority enforcement
      const priorities = participants.map(id =>
        fairShareScheduler.calculateCommunicationPriority(id)
      );

      const sortedByPriority = priorities.sort((a, b) => b.priority - a.priority);
      expect(sortedByPriority[0].agentId).toBe('agent-1'); // Blocked agent highest
      expect(sortedByPriority[2].agentId).toBe('agent-3'); // Idle agent lowest
    });

    it('should handle communication activity tracking', () => {
      const agentId = 'active-communicator';

      // Record multiple communications
      fairShareScheduler.recordCommunicationActivity(agentId);
      fairShareScheduler.recordCommunicationActivity(agentId);
      fairShareScheduler.recordCommunicationActivity(agentId);

      const metrics = fairShareScheduler.getAgentMetrics(agentId);
      expect(metrics?.messageSentCount).toBe(3);

      // Recent activity should reduce priority due to decay
      const priority = fairShareScheduler.calculateCommunicationPriority(agentId);
      expect(priority.reason).toContain('Recent speaker penalty');
    });
  });
});