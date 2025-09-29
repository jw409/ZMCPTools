/**
 * Meeting Protocol Engine for Collaborative Agent Teams
 * Implements Issue #22: Structured collaboration with turn-based coordination
 * Built on Issue #4: Real-World Meeting Simulation Framework
 */

import { Logger } from '../utils/logger.js';
import type { AgentSession } from '../schemas/agents.js';

const logger = new Logger('meeting-protocol');

export interface CollaborativePhase {
  name: string;
  description: string;
  owner: 'planner' | 'implementer' | 'tester' | 'all';
  maxDurationMs: number;
  requiredDeliverables: string[];
  acceptanceCriteria: string[];
}

export interface MeetingParticipant {
  agentId: string;
  agentType: 'planner_agent' | 'implementer_agent' | 'tester_agent';
  role: 'planner' | 'implementer' | 'tester';
  status: 'active' | 'waiting' | 'speaking' | 'completed' | 'blocked';
  joinedAt: Date;
  lastActivity: Date;
}

export interface TurnContext {
  currentSpeaker: string | null;
  turnStartTime: Date | null;
  turnTimeoutMs: number;
  waitingQueue: string[];
  turnHistory: Array<{
    agentId: string;
    role: string;
    startTime: Date;
    endTime: Date;
    action: string;
    outcome: 'completed' | 'timeout' | 'error';
  }>;
}

export interface DecisionRecord {
  id: string;
  timestamp: Date;
  decisionMaker: string; // Agent ID who made the decision
  decision: string;
  reasoning: string;
  impact: 'phase' | 'objective' | 'process';
  affectedAgents: string[];
  status: 'pending' | 'accepted' | 'disputed' | 'implemented';
}

export interface CollaborationSession {
  sessionId: string;
  objective: string;
  repositoryPath: string;
  participants: Map<string, MeetingParticipant>;
  currentPhase: number;
  phases: CollaborativePhase[];
  turnContext: TurnContext;
  decisions: DecisionRecord[];
  artifacts: {
    created: string[];
    modified: string[];
    tested: string[];
    documented: string[];
  };
  startTime: Date;
  endTime?: Date;
  status: 'planning' | 'implementing' | 'testing' | 'reviewing' | 'completed' | 'failed';
  roomId: string;
}

/**
 * Meeting Protocol Engine for structured three-agent collaboration
 */
export class MeetingProtocolEngine {
  private activeSessions = new Map<string, CollaborationSession>();

  /**
   * Initialize a new collaborative session with three-agent team
   */
  async initializeCollaborativeSession(
    objective: string,
    repositoryPath: string,
    teamMembers: { planner: AgentSession; implementer: AgentSession; tester: AgentSession }
  ): Promise<CollaborationSession> {
    const sessionId = `collab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const roomId = `collaboration-${sessionId}`;

    logger.info('Initializing collaborative session', { sessionId, objective });

    const session: CollaborationSession = {
      sessionId,
      objective,
      repositoryPath,
      participants: new Map([
        [teamMembers.planner.id, {
          agentId: teamMembers.planner.id,
          agentType: 'planner_agent',
          role: 'planner',
          status: 'active',
          joinedAt: new Date(),
          lastActivity: new Date()
        }],
        [teamMembers.implementer.id, {
          agentId: teamMembers.implementer.id,
          agentType: 'implementer_agent',
          role: 'implementer',
          status: 'waiting',
          joinedAt: new Date(),
          lastActivity: new Date()
        }],
        [teamMembers.tester.id, {
          agentId: teamMembers.tester.id,
          agentType: 'tester_agent',
          role: 'tester',
          status: 'waiting',
          joinedAt: new Date(),
          lastActivity: new Date()
        }]
      ]),
      currentPhase: 0,
      phases: this.generateCollaborativePhases(objective),
      turnContext: {
        currentSpeaker: teamMembers.planner.id, // Planner leads first phase
        turnStartTime: new Date(),
        turnTimeoutMs: 15 * 60 * 1000, // 15 minutes per turn
        waitingQueue: [teamMembers.implementer.id, teamMembers.tester.id],
        turnHistory: []
      },
      decisions: [],
      artifacts: {
        created: [],
        modified: [],
        tested: [],
        documented: []
      },
      startTime: new Date(),
      status: 'planning',
      roomId
    };

    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Generate structured phases for collaborative development
   */
  private generateCollaborativePhases(objective: string): CollaborativePhase[] {
    return [
      {
        name: 'Strategic Planning',
        description: 'Analyze objective, break down tasks, define acceptance criteria',
        owner: 'planner',
        maxDurationMs: 20 * 60 * 1000, // 20 minutes
        requiredDeliverables: [
          'Task breakdown document',
          'Acceptance criteria definition',
          'Implementation plan',
          'Risk assessment'
        ],
        acceptanceCriteria: [
          'Clear implementation tasks defined',
          'Acceptance criteria documented',
          'Implementer understands requirements',
          'Tester understands validation needs'
        ]
      },
      {
        name: 'Implementation Execution',
        description: 'Code changes, feature implementation, file modifications',
        owner: 'implementer',
        maxDurationMs: 45 * 60 * 1000, // 45 minutes
        requiredDeliverables: [
          'Code implementation',
          'Modified files list',
          'Implementation documentation',
          'Progress reports'
        ],
        acceptanceCriteria: [
          'All planned tasks implemented',
          'Code follows project conventions',
          'Implementation matches requirements',
          'Ready for testing validation'
        ]
      },
      {
        name: 'Testing & Validation',
        description: 'Test execution, quality verification, issue reporting',
        owner: 'tester',
        maxDurationMs: 30 * 60 * 1000, // 30 minutes
        requiredDeliverables: [
          'Test execution results',
          'Quality validation report',
          'Issue identification',
          'Verification documentation'
        ],
        acceptanceCriteria: [
          'All tests executed successfully',
          'Requirements validated',
          'Issues documented and reported',
          'Quality meets standards'
        ]
      },
      {
        name: 'Review & Completion',
        description: 'Final review, documentation, objective completion',
        owner: 'all',
        maxDurationMs: 15 * 60 * 1000, // 15 minutes
        requiredDeliverables: [
          'Final review summary',
          'Lessons learned',
          'Artifacts documentation',
          'Completion confirmation'
        ],
        acceptanceCriteria: [
          'Objective fully completed',
          'All team members agree',
          'Documentation complete',
          'Artifacts properly organized'
        ]
      }
    ];
  }

  /**
   * Manage turn transitions and speaking order
   */
  async requestTurn(sessionId: string, agentId: string, requestType: 'speak' | 'complete_turn' | 'escalate'): Promise<{
    granted: boolean;
    currentSpeaker: string | null;
    waitTime?: number;
    reason?: string;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const participant = session.participants.get(agentId);
    if (!participant) {
      throw new Error(`Agent ${agentId} not part of session ${sessionId}`);
    }

    const currentPhase = session.phases[session.currentPhase];
    const turnContext = session.turnContext;

    // Update participant activity
    participant.lastActivity = new Date();

    switch (requestType) {
      case 'speak':
        return this.handleSpeakRequest(session, agentId, currentPhase);

      case 'complete_turn':
        return this.handleTurnCompletion(session, agentId);

      case 'escalate':
        return this.handleEscalation(session, agentId);

      default:
        throw new Error(`Unknown request type: ${requestType}`);
    }
  }

  /**
   * Handle agent request to speak
   */
  private async handleSpeakRequest(
    session: CollaborationSession,
    agentId: string,
    currentPhase: CollaborativePhase
  ): Promise<{ granted: boolean; currentSpeaker: string | null; waitTime?: number; reason?: string }> {
    const participant = session.participants.get(agentId)!;
    const turnContext = session.turnContext;

    // Check if agent is appropriate for current phase
    const isPhaseOwner = this.isPhaseOwner(participant.role, currentPhase.owner);

    // If no current speaker, grant immediately if appropriate
    if (!turnContext.currentSpeaker) {
      if (isPhaseOwner || currentPhase.owner === 'all') {
        turnContext.currentSpeaker = agentId;
        turnContext.turnStartTime = new Date();
        participant.status = 'speaking';

        logger.info('Turn granted', { sessionId: session.sessionId, agentId, phase: currentPhase.name });

        return {
          granted: true,
          currentSpeaker: agentId
        };
      } else {
        return {
          granted: false,
          currentSpeaker: null,
          reason: `Phase ${currentPhase.name} is owned by ${currentPhase.owner}, but you are ${participant.role}`
        };
      }
    }

    // If someone else is speaking, add to queue
    if (turnContext.currentSpeaker !== agentId) {
      if (!turnContext.waitingQueue.includes(agentId)) {
        turnContext.waitingQueue.push(agentId);
      }

      const queuePosition = turnContext.waitingQueue.indexOf(agentId);
      const estimatedWaitTime = queuePosition * 5 * 60 * 1000; // 5 minutes per queue position

      return {
        granted: false,
        currentSpeaker: turnContext.currentSpeaker,
        waitTime: estimatedWaitTime,
        reason: `Queue position: ${queuePosition + 1}, estimated wait: ${Math.round(estimatedWaitTime / 60000)} minutes`
      };
    }

    // Already speaking
    return {
      granted: true,
      currentSpeaker: agentId
    };
  }

  /**
   * Handle turn completion and queue management
   */
  private async handleTurnCompletion(
    session: CollaborationSession,
    agentId: string
  ): Promise<{ granted: boolean; currentSpeaker: string | null; reason?: string }> {
    const turnContext = session.turnContext;

    if (turnContext.currentSpeaker !== agentId) {
      return {
        granted: false,
        currentSpeaker: turnContext.currentSpeaker,
        reason: 'You are not the current speaker'
      };
    }

    // Record turn completion
    if (turnContext.turnStartTime) {
      turnContext.turnHistory.push({
        agentId,
        role: session.participants.get(agentId)!.role,
        startTime: turnContext.turnStartTime,
        endTime: new Date(),
        action: 'completed_turn',
        outcome: 'completed'
      });
    }

    // Pass turn to next agent in queue
    const nextSpeaker = turnContext.waitingQueue.shift();
    turnContext.currentSpeaker = nextSpeaker || null;
    turnContext.turnStartTime = nextSpeaker ? new Date() : null;

    // Update participant statuses
    const currentParticipant = session.participants.get(agentId)!;
    currentParticipant.status = 'waiting';

    if (nextSpeaker) {
      const nextParticipant = session.participants.get(nextSpeaker)!;
      nextParticipant.status = 'speaking';
    }

    logger.info('Turn completed', {
      sessionId: session.sessionId,
      completedBy: agentId,
      nextSpeaker: nextSpeaker || 'none'
    });

    return {
      granted: true,
      currentSpeaker: nextSpeaker || null
    };
  }

  /**
   * Handle escalation requests (urgent interventions)
   */
  private async handleEscalation(
    session: CollaborationSession,
    agentId: string
  ): Promise<{ granted: boolean; currentSpeaker: string | null; reason?: string }> {
    const participant = session.participants.get(agentId)!;

    // Escalations are usually granted to the planner (team coordinator)
    if (participant.role === 'planner') {
      const turnContext = session.turnContext;

      // Interrupt current speaker
      if (turnContext.currentSpeaker && turnContext.currentSpeaker !== agentId) {
        const currentSpeaker = session.participants.get(turnContext.currentSpeaker)!;
        currentSpeaker.status = 'waiting';

        // Add interrupted speaker to front of queue
        turnContext.waitingQueue.unshift(turnContext.currentSpeaker);
      }

      turnContext.currentSpeaker = agentId;
      turnContext.turnStartTime = new Date();
      participant.status = 'speaking';

      logger.warn('Escalation granted', { sessionId: session.sessionId, agentId, role: participant.role });

      return {
        granted: true,
        currentSpeaker: agentId,
        reason: 'Escalation granted to planner'
      };
    }

    return {
      granted: false,
      currentSpeaker: session.turnContext.currentSpeaker,
      reason: 'Escalations only granted to planner role'
    };
  }

  /**
   * Record a team decision
   */
  async recordDecision(
    sessionId: string,
    decisionMaker: string,
    decision: string,
    reasoning: string,
    impact: 'phase' | 'objective' | 'process',
    affectedAgents: string[] = []
  ): Promise<DecisionRecord> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const decisionRecord: DecisionRecord = {
      id: `decision-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      decisionMaker,
      decision,
      reasoning,
      impact,
      affectedAgents,
      status: 'pending'
    };

    session.decisions.push(decisionRecord);

    logger.info('Decision recorded', {
      sessionId,
      decisionId: decisionRecord.id,
      decisionMaker,
      impact
    });

    return decisionRecord;
  }

  /**
   * Advance to next phase when current phase is complete
   */
  async advancePhase(sessionId: string, initiatedBy: string): Promise<{
    success: boolean;
    newPhase?: CollaborativePhase;
    reason?: string;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const currentPhase = session.phases[session.currentPhase];
    const participant = session.participants.get(initiatedBy);

    if (!participant) {
      return { success: false, reason: 'Agent not part of session' };
    }

    // Check if current phase is complete
    const phaseComplete = this.validatePhaseCompletion(session, currentPhase);
    if (!phaseComplete.complete) {
      return {
        success: false,
        reason: `Phase incomplete: ${phaseComplete.missingRequirements.join(', ')}`
      };
    }

    // Advance to next phase
    session.currentPhase++;

    if (session.currentPhase >= session.phases.length) {
      // All phases complete
      session.status = 'completed';
      session.endTime = new Date();

      logger.info('Collaboration session completed', { sessionId });

      return { success: true, reason: 'All phases completed successfully' };
    }

    const newPhase = session.phases[session.currentPhase];

    // Update session status and turn management for new phase
    session.status = this.getStatusForPhase(newPhase.name);

    // Reset turn context for new phase
    const newPhaseOwner = this.selectPhaseOwner(session, newPhase.owner);
    session.turnContext.currentSpeaker = newPhaseOwner;
    session.turnContext.turnStartTime = new Date();
    session.turnContext.waitingQueue = Array.from(session.participants.keys())
      .filter(id => id !== newPhaseOwner);

    logger.info('Advanced to new phase', {
      sessionId,
      newPhase: newPhase.name,
      owner: newPhase.owner
    });

    return { success: true, newPhase };
  }

  /**
   * Get session status
   */
  getSession(sessionId: string): CollaborationSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Generate meeting minutes for completed session
   */
  generateMeetingMinutes(sessionId: string): {
    summary: string;
    phases: Array<{ name: string; duration: number; owner: string; outcome: string }>;
    decisions: DecisionRecord[];
    artifacts: { created: string[]; modified: string[]; tested: string[]; documented: string[] };
    participants: Array<{ role: string; contribution: string; activeTime: number }>;
    recommendations: string[];
  } {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const duration = session.endTime
      ? session.endTime.getTime() - session.startTime.getTime()
      : Date.now() - session.startTime.getTime();

    return {
      summary: `Collaborative session for: ${session.objective}. Duration: ${Math.round(duration / 60000)} minutes. Status: ${session.status}`,
      phases: session.phases.map((phase, index) => ({
        name: phase.name,
        duration: phase.maxDurationMs / 60000,
        owner: phase.owner,
        outcome: index <= session.currentPhase ? 'completed' : 'pending'
      })),
      decisions: session.decisions,
      artifacts: session.artifacts,
      participants: Array.from(session.participants.values()).map(p => ({
        role: p.role,
        contribution: this.calculateContribution(session, p.agentId),
        activeTime: this.calculateActiveTime(session, p.agentId)
      })),
      recommendations: this.generateRecommendations(session)
    };
  }

  // Helper methods
  private isPhaseOwner(role: string, phaseOwner: string): boolean {
    return role === phaseOwner || phaseOwner === 'all';
  }

  private getStatusForPhase(phaseName: string): CollaborationSession['status'] {
    switch (phaseName.toLowerCase()) {
      case 'strategic planning': return 'planning';
      case 'implementation execution': return 'implementing';
      case 'testing & validation': return 'testing';
      case 'review & completion': return 'reviewing';
      default: return 'planning';
    }
  }

  private selectPhaseOwner(session: CollaborationSession, owner: string): string {
    if (owner === 'all') {
      return Array.from(session.participants.keys())[0]; // Default to first participant
    }

    for (const [agentId, participant] of session.participants) {
      if (participant.role === owner) {
        return agentId;
      }
    }

    return Array.from(session.participants.keys())[0]; // Fallback
  }

  private validatePhaseCompletion(session: CollaborationSession, phase: CollaborativePhase): {
    complete: boolean;
    missingRequirements: string[];
  } {
    // Simplified validation - in reality would check actual deliverables
    const missingRequirements: string[] = [];

    // Check time constraints
    const phaseStartTime = session.turnContext.turnStartTime;
    if (phaseStartTime) {
      const elapsed = Date.now() - phaseStartTime.getTime();
      if (elapsed > phase.maxDurationMs) {
        missingRequirements.push('Phase exceeded time limit');
      }
    }

    // For now, assume phases are complete when requested
    // Real implementation would validate actual deliverables

    return {
      complete: missingRequirements.length === 0,
      missingRequirements
    };
  }

  private calculateContribution(session: CollaborationSession, agentId: string): string {
    const turns = session.turnContext.turnHistory.filter(t => t.agentId === agentId);
    return `${turns.length} turns, ${turns.filter(t => t.outcome === 'completed').length} completed`;
  }

  private calculateActiveTime(session: CollaborationSession, agentId: string): number {
    const turns = session.turnContext.turnHistory.filter(t => t.agentId === agentId);
    return turns.reduce((total, turn) => total + (turn.endTime.getTime() - turn.startTime.getTime()), 0);
  }

  private generateRecommendations(session: CollaborationSession): string[] {
    const recommendations: string[] = [];

    if (session.decisions.length === 0) {
      recommendations.push('Consider documenting more decisions for future reference');
    }

    if (session.artifacts.created.length === 0) {
      recommendations.push('Ensure implementation creates trackable artifacts');
    }

    return recommendations;
  }
}