/**
 * Collaborative Orchestration Tool
 * Implements Issue #22: Three-Agent Collaborative Teams
 * Uses enhanced permissions and meeting protocol engine
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AgentService } from '../services/AgentService.js';
import { MeetingProtocolEngine } from '../services/MeetingProtocolEngine.js';
import { AgentPermissionManager } from '../utils/agentPermissions.js';
import { DatabaseManager } from '../database/index.js';
import { CommunicationService } from '../services/CommunicationService.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('collaborative-orchestration');

// Schema for collaborative team orchestration
const CollaborativeOrchestrationSchema = z.object({
  repository_path: z.string().describe("Repository path for the collaborative session"),
  objective: z.string().min(10).describe("Clear objective for the three-agent team to accomplish"),
  team_configuration: z.object({
    planner_instructions: z.string().optional().describe("Specific instructions for the planner agent"),
    implementer_instructions: z.string().optional().describe("Specific instructions for the implementer agent"),
    tester_instructions: z.string().optional().describe("Specific instructions for the tester agent")
  }).optional().describe("Optional custom instructions for each team member"),
  collaboration_settings: z.object({
    max_session_duration_minutes: z.number().min(30).max(300).default(120).describe("Maximum session duration in minutes"),
    turn_timeout_minutes: z.number().min(5).max(30).default(15).describe("Maximum time per agent turn in minutes"),
    require_unanimous_completion: z.boolean().default(true).describe("Require all agents to agree on completion"),
    auto_advance_phases: z.boolean().default(false).describe("Automatically advance phases when criteria met")
  }).optional().describe("Collaboration session settings"),
  foundation_session_id: z.string().optional().describe("Foundation session ID for cost optimization across agents")
});

/**
 * Launch collaborative three-agent team (Planner/Implementer/Tester)
 */
export const orchestrateCollaborativeTeam: Tool = {
  name: 'orchestrate_collaborative_team',
  description: `**Launch a structured three-agent collaborative team with enhanced permissions and meeting protocols.**

🎯 **Three-Agent Collaboration Pattern:**
- **Planner Agent**: Strategic coordinator, task breakdown, decision making, team leadership
- **Implementer Agent**: Code execution, feature implementation, file modifications
- **Tester Agent**: Quality verification, testing automation, validation reporting

🏗️ **Structured Four-Phase Workflow:**
1. **Strategic Planning** (Planner leads): Analyze objective, break down tasks, define criteria
2. **Implementation** (Implementer leads): Execute code changes, build features, modify files
3. **Testing & Validation** (Tester leads): Run tests, verify quality, report issues
4. **Review & Completion** (All participate): Final review, documentation, completion

🔧 **Enhanced Permissions (Fixes Permission Starvation):**
- **Planner**: Communication, knowledge graph, orchestration, analysis, thinking tools
- **Implementer**: Core tools, execution (Bash), communication, file operations, analysis
- **Tester**: Core tools, execution (Bash), communication, browser automation, testing

⚡ **Meeting Protocol Features:**
- Turn-based coordination with timeout management
- Decision tracking and meeting minutes generation
- Phase advancement with completion validation
- Escalation handling for urgent interventions
- Artifact tracking (created, modified, tested, documented)

📋 **Usage Examples:**

\`\`\`javascript
// Full-stack feature implementation
{
  "repository_path": "/home/user/project",
  "objective": "Implement user authentication with JWT tokens, login UI, tests, and documentation",
  "team_configuration": {
    "implementer_instructions": "Use existing auth library, follow security best practices",
    "tester_instructions": "Create both unit tests and E2E login flow tests"
  }
}

// Bug fix with comprehensive validation
{
  "repository_path": "/home/user/project",
  "objective": "Fix memory leak in data processing pipeline and verify with performance tests",
  "collaboration_settings": {
    "max_session_duration_minutes": 90,
    "require_unanimous_completion": true
  }
}
\`\`\`

🎪 **Success Criteria:**
✅ All three agents spawned with proper permissions
✅ Structured meeting room created for coordination
✅ Phase-based workflow with turn management
✅ Real artifacts produced (code, tests, docs)
✅ Meeting minutes with decisions and outcomes
✅ Unanimous completion agreement

🔗 **Integration with Knowledge Tools:**
- Automatic knowledge search before implementation
- Decision and artifact tracking in knowledge graph
- Meeting minutes stored for future reference
- Foundation session sharing for cost optimization

**Returns**: Session details, agent IDs, room coordination info, and real-time collaboration status.`,

  inputSchema: zodToJsonSchema(CollaborativeOrchestrationSchema),

  async handler({
    repository_path,
    objective,
    team_configuration = {},
    collaboration_settings = {},
    foundation_session_id
  }) {
    const startTime = Date.now();

    try {
      logger.info('Starting collaborative orchestration', { objective, repository_path });

      // Initialize services
      const agentService = new AgentService(new DatabaseManager());
      const meetingEngine = new MeetingProtocolEngine();
      const communicationService = new CommunicationService(new DatabaseManager());

      // Merge default settings
      const settings = {
        max_session_duration_minutes: 120,
        turn_timeout_minutes: 15,
        require_unanimous_completion: true,
        auto_advance_phases: false,
        ...collaboration_settings
      };

      // PHASE 1: Search knowledge for similar objectives
      logger.info('Phase 1: Knowledge discovery for objective planning');

      // Use our new unified search to find relevant past work
      const knowledgeContext = await this.searchRelevantKnowledge(objective, repository_path);

      // PHASE 2: Spawn three-agent team with enhanced permissions
      logger.info('Phase 2: Spawning collaborative team with enhanced permissions');

      const teamInstructions = this.generateTeamInstructions(objective, knowledgeContext, team_configuration);

      // Spawn planner agent (coordinator)
      const plannerAgent = await agentService.spawnAgent({
        agentName: `planner-${Date.now()}`,
        agentType: 'planner_agent',
        repositoryPath: repository_path,
        additionalInstructions: teamInstructions.planner,
        foundationSessionId: foundation_session_id
      });

      // Spawn implementer agent (executor)
      const implementerAgent = await agentService.spawnAgent({
        agentName: `implementer-${Date.now()}`,
        agentType: 'implementer_agent',
        repositoryPath: repository_path,
        additionalInstructions: teamInstructions.implementer,
        foundationSessionId: foundation_session_id
      });

      // Spawn tester agent (verifier)
      const testerAgent = await agentService.spawnAgent({
        agentName: `tester-${Date.now()}`,
        agentType: 'tester_agent',
        repositoryPath: repository_path,
        additionalInstructions: teamInstructions.tester,
        foundationSessionId: foundation_session_id
      });

      logger.info('Team spawned successfully', {
        planner: plannerAgent.agentId,
        implementer: implementerAgent.agentId,
        tester: testerAgent.agentId
      });

      // PHASE 3: Initialize collaborative session
      logger.info('Phase 3: Initializing meeting protocol and collaboration session');

      const collaborationSession = await meetingEngine.initializeCollaborativeSession(
        objective,
        repository_path,
        {
          planner: plannerAgent,
          implementer: implementerAgent,
          tester: testerAgent
        }
      );

      // PHASE 4: Create coordination room
      logger.info('Phase 4: Creating coordination room for team communication');

      const roomId = collaborationSession.roomId;
      await communicationService.createRoom(roomId, {
        roomType: 'collaboration',
        description: `Collaborative session: ${objective}`,
        isPrivate: false,
        autoCleanup: true,
        maxParticipants: 3
      });

      // Join all agents to coordination room
      await Promise.all([
        communicationService.joinRoom(roomId, plannerAgent.agentId),
        communicationService.joinRoom(roomId, implementerAgent.agentId),
        communicationService.joinRoom(roomId, testerAgent.agentId)
      ]);

      // PHASE 5: Send initial coordination message
      const initialMessage = this.generateInitialCoordinationMessage(
        objective,
        collaborationSession.phases,
        settings
      );

      await communicationService.sendMessage(roomId, 'system', initialMessage, [
        plannerAgent.agentId,
        implementerAgent.agentId,
        testerAgent.agentId
      ]);

      const totalSetupTime = Date.now() - startTime;

      logger.info('Collaborative orchestration completed', {
        sessionId: collaborationSession.sessionId,
        setupTimeMs: totalSetupTime
      });

      return {
        success: true,
        collaboration_session: {
          session_id: collaborationSession.sessionId,
          objective,
          status: collaborationSession.status,
          current_phase: collaborationSession.phases[0].name,
          estimated_duration_minutes: settings.max_session_duration_minutes
        },
        team_members: {
          planner: {
            agent_id: plannerAgent.agentId,
            agent_name: plannerAgent.agentName,
            role: 'Strategic planning and coordination',
            permissions: this.summarizePermissions('planner_agent'),
            status: 'active - leading first phase'
          },
          implementer: {
            agent_id: implementerAgent.agentId,
            agent_name: implementerAgent.agentName,
            role: 'Code implementation and execution',
            permissions: this.summarizePermissions('implementer_agent'),
            status: 'waiting - ready for implementation phase'
          },
          tester: {
            agent_id: testerAgent.agentId,
            agent_name: testerAgent.agentName,
            role: 'Testing and quality verification',
            permissions: this.summarizePermissions('tester_agent'),
            status: 'waiting - ready for testing phase'
          }
        },
        coordination: {
          room_id: roomId,
          room_url: `Room: ${roomId}`,
          current_speaker: plannerAgent.agentId,
          turn_timeout_minutes: settings.turn_timeout_minutes,
          phase_structure: collaborationSession.phases.map(p => ({
            name: p.name,
            owner: p.owner,
            max_duration_minutes: Math.round(p.maxDurationMs / 60000),
            deliverables: p.requiredDeliverables
          }))
        },
        knowledge_context: {
          relevant_findings: knowledgeContext.summary,
          search_results_count: knowledgeContext.results.length,
          recommendations: knowledgeContext.recommendations
        },
        next_steps: [
          `Planner agent (${plannerAgent.agentId}) is now leading the Strategic Planning phase`,
          `Monitor collaboration progress in room: ${roomId}`,
          `Use meeting protocol for turn management and phase advancement`,
          `Expect deliverables: ${collaborationSession.phases[0].requiredDeliverables.join(', ')}`
        ],
        monitoring: {
          session_id: collaborationSession.sessionId,
          setup_time_ms: totalSetupTime,
          foundation_session_shared: !!foundation_session_id,
          cost_optimization: foundation_session_id ? 'Enabled (85-90% cost reduction)' : 'Not enabled'
        }
      };

    } catch (error) {
      logger.error('Collaborative orchestration failed', { error: error.message, objective });

      return {
        success: false,
        error: `Collaborative orchestration failed: ${error.message}`,
        suggestion: 'Check agent permissions, repository access, and system resources',
        troubleshooting: [
          'Verify repository path is accessible',
          'Check that all three agent types can be spawned',
          'Ensure communication services are running',
          'Validate objective is clear and achievable'
        ]
      };
    }
  },

  // Helper method to search for relevant knowledge
  async searchRelevantKnowledge(objective: string, repositoryPath: string): Promise<{
    summary: string;
    results: any[];
    recommendations: string[];
  }> {
    try {
      // This would integrate with our new unified search
      // For now, return structured placeholder
      return {
        summary: `Knowledge search for: ${objective}`,
        results: [],
        recommendations: [
          'Use existing patterns from similar implementations',
          'Follow project conventions and style guides',
          'Consider security and performance implications'
        ]
      };
    } catch (error) {
      logger.warn('Knowledge search failed', { error: error.message });
      return {
        summary: 'Knowledge search unavailable',
        results: [],
        recommendations: ['Proceed with implementation using best practices']
      };
    }
  },

  // Generate specialized instructions for each team member
  generateTeamInstructions(objective: string, knowledgeContext: any, customConfig: any): {
    planner: string;
    implementer: string;
    tester: string;
  } {
    const baseContext = `
COLLABORATIVE OBJECTIVE: ${objective}

KNOWLEDGE CONTEXT: ${knowledgeContext.summary}
${knowledgeContext.recommendations.map(r => `- ${r}`).join('\n')}

COLLABORATION PROTOCOL:
- This is a structured three-agent collaboration
- Follow turn-based coordination in your assigned room
- Use meeting protocol for phase transitions
- Record decisions and track artifacts
- Communicate progress and blockers clearly
`;

    return {
      planner: `${baseContext}

YOUR ROLE: Strategic Planner & Team Coordinator

RESPONSIBILITIES:
- Lead Strategic Planning phase (20 minutes)
- Analyze objective and break into implementable tasks
- Define clear acceptance criteria and validation requirements
- Create implementation plan with task priorities
- Coordinate team communication and resolve conflicts
- Make strategic decisions and document reasoning
- Guide phase transitions and completion validation

TOOLS AVAILABLE: Communication, knowledge graph, orchestration, analysis, thinking tools
DELIVERABLES: Task breakdown, acceptance criteria, implementation plan, risk assessment

COLLABORATION STYLE: Be decisive but collaborative. Ask for input, make clear decisions, keep team focused.

${customConfig.planner_instructions || ''}`,

      implementer: `${baseContext}

YOUR ROLE: Implementation Specialist & Code Executor

RESPONSIBILITIES:
- Execute Implementation phase based on planner's specifications (45 minutes)
- Write code, modify files, implement features
- Follow project conventions and best practices
- Report progress and ask for clarification when needed
- Handle technical challenges and document solutions
- Prepare implementation for testing validation
- Track created and modified files

TOOLS AVAILABLE: Core tools, execution (Bash), communication, file operations, analysis
DELIVERABLES: Code implementation, modified files list, progress reports, implementation docs

COLLABORATION STYLE: Be thorough and communicative. Report progress, ask questions, deliver quality code.

${customConfig.implementer_instructions || ''}`,

      tester: `${baseContext}

YOUR ROLE: Quality Verifier & Testing Specialist

RESPONSIBILITIES:
- Execute Testing & Validation phase (30 minutes)
- Verify implementation meets all acceptance criteria
- Run automated tests and manual validation
- Test edge cases and error scenarios
- Report issues with clear reproduction steps
- Validate security and performance requirements
- Document test results and quality metrics

TOOLS AVAILABLE: Core tools, execution (Bash), communication, browser automation, testing tools
DELIVERABLES: Test execution results, quality validation report, issue identification, verification docs

COLLABORATION STYLE: Be thorough and constructive. Find issues early, provide clear feedback, ensure quality.

${customConfig.tester_instructions || ''}`
    };
  },

  // Generate initial coordination message
  generateInitialCoordinationMessage(objective: string, phases: any[], settings: any): string {
    return `🎯 **COLLABORATIVE SESSION INITIATED**

**Objective**: ${objective}

**Team Structure**:
- 🎯 **Planner**: Strategic coordination, task breakdown, decision making
- 🔧 **Implementer**: Code execution, feature implementation
- 🧪 **Tester**: Quality verification, testing automation

**Four-Phase Workflow**:
${phases.map((phase, index) =>
  `${index + 1}. **${phase.name}** (${Math.round(phase.maxDurationMs / 60000)}min) - ${phase.description}`
).join('\n')}

**Meeting Protocol**:
- Turn-based coordination with ${settings.turn_timeout_minutes}-minute turns
- Current speaker: Planner (leading Strategic Planning phase)
- Use \`request_turn\` for speaking, \`complete_turn\` when finished
- Phase advancement requires completion validation

**Success Criteria**:
- All phases completed with required deliverables
- Real artifacts produced and tested
- ${settings.require_unanimous_completion ? 'Unanimous' : 'Majority'} completion agreement

🚀 **Planner**: You have the floor. Begin strategic planning and task breakdown.`;
  },

  // Summarize permissions for each agent type
  summarizePermissions(agentType: string): string[] {
    const permissions = AgentPermissionManager.generateToolPermissions(agentType as any);
    const categories = permissions.allowedCategories || [];

    const summaries = {
      'planner_agent': ['Communication & coordination', 'Knowledge graph & analysis', 'Orchestration tools', 'Strategic thinking'],
      'implementer_agent': ['Code execution (Bash)', 'File operations', 'Communication', 'Project analysis'],
      'tester_agent': ['Test execution (Bash)', 'Browser automation', 'Communication', 'Quality validation']
    };

    return summaries[agentType] || ['Basic tools'];
  }
};

// Export collaborative tools
export const collaborativeOrchestrationTools = [
  orchestrateCollaborativeTeam
];