import { Logger } from '../utils/logger.js';
import { eventBus } from './EventBus.js';

export type AgentWorkState = 'idle' | 'active' | 'blocked' | 'critical' | 'completing';

export interface AgentWorkloadMetrics {
  agentId: string;
  state: AgentWorkState;
  lastActivity: Date;
  progressVelocity: number; // Tasks completed per hour
  blockerCount: number;
  criticalIssues: number;
  messageSentCount: number;
  phaseRole?: 'leader' | 'participant' | 'observer';
}

export interface CommunicationPriority {
  agentId: string;
  priority: number; // 0.0 - 10.0 (higher = more urgent)
  reason: string;
  timestamp: Date;
}

/**
 * Fair Share Communication Scheduler
 *
 * Implements Solaris-inspired fair share scheduling for agent communication.
 * Agents get communication priority based on actual work needs, not round-robin turns.
 *
 * Priority factors:
 * - Work urgency (blocked > active > idle)
 * - Progress velocity (stuck agents get higher priority)
 * - Phase leadership (current phase owner gets boost)
 * - Anti-starvation (recent speakers get decay penalty)
 */
export class FairShareScheduler {
  private logger: Logger;
  private agentMetrics = new Map<string, AgentWorkloadMetrics>();
  private recentActivity = new Map<string, Date>();
  private priorityHistory: CommunicationPriority[] = [];
  private readonly PRIORITY_DECAY_MINUTES = 5;
  private readonly STARVATION_THRESHOLD_MINUTES = 5;
  private readonly MAX_PRIORITY = 10.0;

  constructor() {
    this.logger = new Logger('FairShareScheduler');
    this.setupEventListeners();
  }

  /**
   * Set up event listeners for real-time priority updates
   */
  private setupEventListeners(): void {
    // Agent state changes update workload metrics
    eventBus.subscribe('agent_status_change', async (data) => {
      await this.updateAgentWorkState(data.agentId, this.mapStatusToWorkState(data.newStatus));
    });

    // Task completion affects progress velocity
    eventBus.subscribe('task_completed', async (data) => {
      await this.updateProgressVelocity(data.completedBy || '', 'completed');
    });

    // Error events indicate blockers
    eventBus.subscribe('agent_error', async (data) => {
      await this.updateBlockerCount(data.agentId, 'increment');
    });

    // Room messages track communication activity
    eventBus.subscribe('room_message', async (data) => {
      await this.recordCommunicationActivity(data.message.agentName);
    });
  }

  /**
   * Calculate communication priority for an agent
   */
  calculateCommunicationPriority(agentId: string): CommunicationPriority {
    const metrics = this.agentMetrics.get(agentId);
    if (!metrics) {
      // New agent gets moderate priority
      return {
        agentId,
        priority: 5.0,
        reason: 'New agent - moderate priority',
        timestamp: new Date()
      };
    }

    let priority = 0.0;
    const reasons: string[] = [];

    // 1. Work state urgency (0-4 points)
    const urgencyPoints = this.calculateUrgencyPriority(metrics);
    priority += urgencyPoints.points;
    reasons.push(urgencyPoints.reason);

    // 2. Progress velocity factor (0-3 points)
    const velocityPoints = this.calculateVelocityPriority(metrics);
    priority += velocityPoints.points;
    reasons.push(velocityPoints.reason);

    // 3. Phase leadership bonus (0-2 points)
    const leadershipPoints = this.calculateLeadershipPriority(metrics);
    priority += leadershipPoints.points;
    reasons.push(leadershipPoints.reason);

    // 4. Anti-starvation protection (0-2 points)
    const starvationPoints = this.calculateStarvationProtection(agentId);
    priority += starvationPoints.points;
    reasons.push(starvationPoints.reason);

    // 5. Recent activity decay penalty (-3 to 0 points)
    const decayPenalty = this.calculateDecayPenalty(agentId);
    priority += decayPenalty.points;
    reasons.push(decayPenalty.reason);

    // Cap at maximum priority
    priority = Math.min(priority, this.MAX_PRIORITY);

    const result: CommunicationPriority = {
      agentId,
      priority,
      reason: reasons.join('; '),
      timestamp: new Date()
    };

    // Store priority calculation for debugging
    this.priorityHistory.push(result);
    this.trimPriorityHistory();

    return result;
  }

  /**
   * Get next agent who should speak in a room
   */
  getNextSpeaker(roomId: string, participantIds: string[]): string | null {
    if (participantIds.length === 0) {
      return null;
    }

    // Calculate priority for all participants
    const priorities = participantIds.map(agentId =>
      this.calculateCommunicationPriority(agentId)
    );

    // Sort by priority (highest first)
    priorities.sort((a, b) => b.priority - a.priority);

    const winner = priorities[0];

    this.logger.debug('Communication priority calculation', {
      roomId,
      winner: winner.agentId,
      priority: winner.priority,
      reason: winner.reason,
      allPriorities: priorities
    });

    return winner.agentId;
  }

  /**
   * Update agent work state metrics
   */
  updateAgentWorkState(agentId: string, state: AgentWorkState): void {
    const existing = this.agentMetrics.get(agentId) || this.createDefaultMetrics(agentId);

    existing.state = state;
    existing.lastActivity = new Date();

    // Reset blocker count when moving to active state
    if (state === 'active' && existing.state !== 'active') {
      existing.blockerCount = 0;
    }

    this.agentMetrics.set(agentId, existing);

    this.logger.debug('Updated agent work state', { agentId, state });
  }

  /**
   * Update progress velocity metrics
   */
  updateProgressVelocity(agentId: string, action: 'completed' | 'failed'): void {
    const existing = this.agentMetrics.get(agentId) || this.createDefaultMetrics(agentId);

    // Simple velocity calculation: completions per hour
    const now = new Date();
    const hoursSinceLastUpdate = (now.getTime() - existing.lastActivity.getTime()) / (1000 * 60 * 60);

    if (action === 'completed') {
      existing.progressVelocity = hoursSinceLastUpdate > 0 ? 1 / hoursSinceLastUpdate : 1.0;
    } else {
      existing.progressVelocity = Math.max(0, existing.progressVelocity - 0.1);
    }

    existing.lastActivity = now;
    this.agentMetrics.set(agentId, existing);
  }

  /**
   * Update blocker count
   */
  updateBlockerCount(agentId: string, action: 'increment' | 'decrement' | 'reset'): void {
    const existing = this.agentMetrics.get(agentId) || this.createDefaultMetrics(agentId);

    switch (action) {
      case 'increment':
        existing.blockerCount++;
        break;
      case 'decrement':
        existing.blockerCount = Math.max(0, existing.blockerCount - 1);
        break;
      case 'reset':
        existing.blockerCount = 0;
        break;
    }

    existing.lastActivity = new Date();
    this.agentMetrics.set(agentId, existing);
  }

  /**
   * Record communication activity for decay calculation
   */
  recordCommunicationActivity(agentId: string): void {
    this.recentActivity.set(agentId, new Date());

    const existing = this.agentMetrics.get(agentId) || this.createDefaultMetrics(agentId);
    existing.messageSentCount++;
    existing.lastActivity = new Date();
    this.agentMetrics.set(agentId, existing);
  }

  /**
   * Set phase leadership role
   */
  setPhaseRole(agentId: string, role: 'leader' | 'participant' | 'observer'): void {
    const existing = this.agentMetrics.get(agentId) || this.createDefaultMetrics(agentId);
    existing.phaseRole = role;
    this.agentMetrics.set(agentId, existing);
  }

  /**
   * Get current metrics for debugging
   */
  getAgentMetrics(agentId: string): AgentWorkloadMetrics | null {
    return this.agentMetrics.get(agentId) || null;
  }

  /**
   * Get recent priority history for debugging
   */
  getPriorityHistory(limit = 20): CommunicationPriority[] {
    return this.priorityHistory.slice(-limit);
  }

  // Private helper methods

  private calculateUrgencyPriority(metrics: AgentWorkloadMetrics): { points: number; reason: string } {
    switch (metrics.state) {
      case 'critical':
        return { points: 4.0, reason: 'Critical state (4.0)' };
      case 'blocked':
        return { points: 3.0, reason: 'Blocked state (3.0)' };
      case 'active':
        return { points: 2.0, reason: 'Active state (2.0)' };
      case 'completing':
        return { points: 1.5, reason: 'Completing state (1.5)' };
      case 'idle':
      default:
        return { points: 0.5, reason: 'Idle state (0.5)' };
    }
  }

  private calculateVelocityPriority(metrics: AgentWorkloadMetrics): { points: number; reason: string } {
    if (metrics.progressVelocity < 0.1) {
      return { points: 3.0, reason: 'Very low velocity - needs help (3.0)' };
    } else if (metrics.progressVelocity < 0.5) {
      return { points: 2.0, reason: 'Low velocity (2.0)' };
    } else if (metrics.progressVelocity > 2.0) {
      return { points: 0.5, reason: 'High velocity - less priority (0.5)' };
    } else {
      return { points: 1.0, reason: 'Normal velocity (1.0)' };
    }
  }

  private calculateLeadershipPriority(metrics: AgentWorkloadMetrics): { points: number; reason: string } {
    switch (metrics.phaseRole) {
      case 'leader':
        return { points: 2.0, reason: 'Phase leader (2.0)' };
      case 'participant':
        return { points: 1.0, reason: 'Phase participant (1.0)' };
      case 'observer':
      default:
        return { points: 0.0, reason: 'Observer role (0.0)' };
    }
  }

  private calculateStarvationProtection(agentId: string): { points: number; reason: string } {
    const lastActivity = this.recentActivity.get(agentId);
    if (!lastActivity) {
      return { points: 1.0, reason: 'No recent activity (1.0)' };
    }

    const minutesSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60);

    if (minutesSinceActivity > this.STARVATION_THRESHOLD_MINUTES) {
      const boostPoints = Math.min(2.0, minutesSinceActivity / this.STARVATION_THRESHOLD_MINUTES);
      return { points: boostPoints, reason: `Starvation protection (${boostPoints.toFixed(1)})` };
    }

    return { points: 0.0, reason: 'Recent activity (0.0)' };
  }

  private calculateDecayPenalty(agentId: string): { points: number; reason: string } {
    const lastActivity = this.recentActivity.get(agentId);
    if (!lastActivity) {
      return { points: 0.0, reason: 'No decay penalty (0.0)' };
    }

    const minutesSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60);

    if (minutesSinceActivity < this.PRIORITY_DECAY_MINUTES) {
      const decayPenalty = -3.0 * (1 - minutesSinceActivity / this.PRIORITY_DECAY_MINUTES);
      return { points: decayPenalty, reason: `Recent speaker penalty (${decayPenalty.toFixed(1)})` };
    }

    return { points: 0.0, reason: 'Decay period expired (0.0)' };
  }

  private mapStatusToWorkState(status: string): AgentWorkState {
    switch (status) {
      case 'active':
        return 'active';
      case 'idle':
        return 'idle';
      case 'failed':
        return 'critical';
      case 'completed':
        return 'completing';
      default:
        return 'idle';
    }
  }

  private createDefaultMetrics(agentId: string): AgentWorkloadMetrics {
    return {
      agentId,
      state: 'idle',
      lastActivity: new Date(),
      progressVelocity: 0.0,
      blockerCount: 0,
      criticalIssues: 0,
      messageSentCount: 0,
      phaseRole: 'participant'
    };
  }

  private trimPriorityHistory(): void {
    // Keep only last 1000 entries
    if (this.priorityHistory.length > 1000) {
      this.priorityHistory = this.priorityHistory.slice(-500);
    }
  }
}