// This file has been removed - over-engineered alternative coordination service
// Core coordination is handled by simpler CommunicationService

// Keeping only the exported types for backwards compatibility
export type CoordinationEvent = {
  id?: string;
  repositoryPath: string;
  eventType: 'agent_spawn' | 'agent_death' | 'task_created' | 'task_completed' | 'error_occurred' | 'recovery_triggered';
  eventData?: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  triggeredBy?: string;
  timestamp: Date;
  handled: boolean;
  handledBy?: string;
  handledAt?: Date;
  notes?: string;
};

export type CoordinationStatus = {
  repositoryPath: string;
  status: 'healthy' | 'degraded' | 'failing' | 'critical';
  lastUpdateTime: Date;
  activeAgents: number;
  activeTasks: number;
  activeRooms: number;
  systemHealth: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    networkLatency: number;
  };
  coordinationMetrics: {
    avgResponseTime: number;
    taskCompletionRate: number;
    errorRate: number;
    agentEfficiency: number;
  };
  alerts: string[];
  recommendations: string[];
};

// Placeholder class for backwards compatibility
export class AlternativeCoordinationService {
  constructor() {
    throw new Error('AlternativeCoordinationService has been removed - use CommunicationService instead');
  }
}