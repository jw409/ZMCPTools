/**
 * AgentMonitoringService
 * 
 * Provides real-time agent status tracking and monitoring infrastructure
 * for MCP tools. Designed with 55-second timeout awareness and data prioritization.
 */

import { DatabaseManager } from '../database/index.js';
import { AgentService } from './AgentService.js';
import { CommunicationService } from './CommunicationService.js';
import { TaskService } from './TaskService.js';
import { KnowledgeGraphService } from './KnowledgeGraphService.js';
import { VectorSearchService } from './VectorSearchService.js';
import { ProgressTracker } from './ProgressTracker.js';
import { Logger } from '../utils/logger.js';
import { PathUtils } from '../utils/pathUtils.js';
import { 
  type AgentSession, 
  type AgentStatus, 
  type AgentFilter,
  type Task, 
  type TaskStatus, 
  type TaskFilter,
  type ChatRoom,
  type ChatMessage,
  type KnowledgeEntity
} from '../schemas/index.js';

const logger = new Logger('agent-monitoring-service');

export interface AgentStatusSnapshot {
  agentId: string;
  status: AgentStatus;
  lastHeartbeat: string;
  currentTask?: Task;
  taskProgress?: number;
  roomMemberships: string[];
  recentMessages: ChatMessage[];
  capabilities: string[];
  metadata: Record<string, any>;
  performance: {
    tasksCompleted: number;
    averageTaskDuration: number;
    errorRate: number;
    lastErrorTime?: string;
  };
  uptime: number; // in seconds
  lastActivity: string;
}

export interface OrchestrationStatus {
  orchestrationId: string;
  title: string;
  status: 'active' | 'completed' | 'failed' | 'paused';
  startTime: string;
  endTime?: string;
  duration?: number;
  masterTask?: Task;
  spawnedAgents: AgentStatusSnapshot[];
  activeAgents: AgentStatusSnapshot[];
  completedTasks: Task[];
  failedTasks: Task[];
  totalTasks: number;
  progress: number; // 0-100
  roomName?: string;
  foundationSessionId?: string;
  nextSteps: string[];
  insights: KnowledgeEntity[];
  errors: string[];
}

export interface RoomActivitySnapshot {
  roomId: string;
  roomName: string;
  memberCount: number;
  activeMembers: string[];
  recentMessages: ChatMessage[];
  messageCount: number;
  lastActivity: string;
  topicSummary?: string;
  coordinationStatus: 'active' | 'idle' | 'blocked';
}

export interface MonitoringOptions {
  includeTaskHistory?: boolean;
  includeMessageHistory?: boolean;
  includePerformanceMetrics?: boolean;
  maxRecentMessages?: number;
  maxRecentTasks?: number;
  prioritizeActive?: boolean;
  timeframe?: {
    start: string;
    end: string;
  };
}

export interface AgentActivitySummary {
  timeframe: {
    start: string;
    end: string;
  };
  totalAgents: number;
  activeAgents: number;
  completedTasks: number;
  failedTasks: number;
  totalMessages: number;
  topPerformers: {
    agentId: string;
    tasksCompleted: number;
    averageDuration: number;
  }[];
  coordinationEvents: {
    roomsCreated: number;
    roomsClosed: number;
    messagesExchanged: number;
  };
  insights: KnowledgeEntity[];
  errors: string[];
}

export class AgentMonitoringService {
  private agentService: AgentService;
  private communicationService: CommunicationService;
  private taskService: TaskService;
  private knowledgeGraphService: KnowledgeGraphService;
  private progressTracker: ProgressTracker;

  constructor(
    private db: DatabaseManager,
    private repositoryPath: string = process.cwd()
  ) {
    this.repositoryPath = PathUtils.resolveRepositoryPath(repositoryPath, 'AgentMonitoringService');
    this.agentService = new AgentService(db);
    this.communicationService = new CommunicationService(db);
    this.taskService = new TaskService(db);
    const vectorService = new VectorSearchService(db);
    this.knowledgeGraphService = new KnowledgeGraphService(db, vectorService);
    this.progressTracker = new ProgressTracker(db);
  }

  /**
   * Get comprehensive status of a single agent
   */
  async getAgentStatus(agentId: string, options: MonitoringOptions = {}): Promise<AgentStatusSnapshot> {
    try {
      const agent = await this.agentService.getAgent(agentId);
      if (!agent) {
        throw new Error(`Agent ${agentId} not found`);
      }

      // Get current task
      const currentTask = await this.getCurrentTask(agentId);
      
      // Get room memberships
      const roomMemberships = await this.getAgentRoomMemberships(agentId);
      
      // Get recent messages (prioritize for timeout awareness)
      const recentMessages = await this.getRecentAgentMessages(
        agentId, 
        options.maxRecentMessages || 5
      );

      // Get performance metrics
      const performance = await this.getAgentPerformance(agentId, options.timeframe);

      // Calculate uptime
      const uptime = this.calculateUptime(agent.createdAt);

      return {
        agentId: agent.id,
        status: agent.status,
        lastHeartbeat: agent.lastHeartbeat,
        currentTask,
        taskProgress: currentTask ? await this.getTaskProgress(currentTask.id) : undefined,
        roomMemberships,
        recentMessages,
        capabilities: agent.capabilities || [],
        metadata: agent.agentMetadata || {},
        performance,
        uptime,
        lastActivity: agent.lastHeartbeat
      };
    } catch (error) {
      logger.error('Error getting agent status:', error);
      throw error;
    }
  }

  /**
   * Get status of all active agents with smart prioritization
   */
  async getActiveAgents(
    repositoryPath: string, 
    options: MonitoringOptions = {}
  ): Promise<AgentStatusSnapshot[]> {
    try {
      const resolvedPath = PathUtils.resolveRepositoryPath(repositoryPath, 'getActiveAgents');
      
      const agents = await this.agentService.listAgents(resolvedPath, 'active');
      
      // Sort by priority: agents with current tasks first, then by last activity
      const sortedAgents = agents.sort((a, b) => {
        // Prioritize agents with recent heartbeats
        const aHeartbeat = new Date(a.lastHeartbeat).getTime();
        const bHeartbeat = new Date(b.lastHeartbeat).getTime();
        return bHeartbeat - aHeartbeat;
      });

      // Get status for each agent (with timeout awareness)
      const statusPromises = sortedAgents.map(agent => 
        this.getAgentStatus(agent.id, options)
      );

      return await Promise.all(statusPromises);
    } catch (error) {
      logger.error('Error getting active agents:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive orchestration status
   */
  async getOrchestrationStatus(orchestrationId: string): Promise<OrchestrationStatus> {
    try {
      // Find the master task that represents this orchestration
      const masterTask = await this.findMasterTask(orchestrationId);
      if (!masterTask) {
        throw new Error(`Orchestration ${orchestrationId} not found`);
      }

      // Get all spawned agents for this orchestration
      const spawnedAgents = await this.getOrchestrationAgents(orchestrationId);
      
      // Get active agents
      const activeAgents = spawnedAgents.filter(agent => agent.status === 'active');
      
      // Get all tasks for this orchestration
      const allTasks = await this.getOrchestrationTasks(orchestrationId);
      const completedTasks = allTasks.filter(task => task.status === 'completed');
      const failedTasks = allTasks.filter(task => task.status === 'failed');
      
      // Calculate progress using ProgressTracker for proper aggregation
      let progress = 0;
      try {
        const progressContext = {
          contextId: orchestrationId,
          contextType: 'orchestration' as const,
          repositoryPath: this.repositoryPath,
          metadata: {
            totalTasks: allTasks.length,
            completedTasks: completedTasks.length,
            activeAgents: activeAgents.length
          }
        };
        
        // If we have active agents, aggregate their progress
        if (activeAgents.length > 0) {
          // Get current aggregated progress from all agents
          const aggregatedProgress = await this.progressTracker.getContextProgress(progressContext);
          
          // If we have agent progress data, use it
          if (aggregatedProgress.agentCount > 0) {
            progress = aggregatedProgress.totalProgress;
          } else {
            // Fall back to task-based progress calculation
            progress = allTasks.length > 0 ? 
              (completedTasks.length / allTasks.length) * 100 : 0;
          }
        } else {
          // No active agents, use task-based progress
          progress = allTasks.length > 0 ? 
            (completedTasks.length / allTasks.length) * 100 : 0;
        }
        
        // Ensure progress is valid and monotonic
        const progressReport = await this.progressTracker.reportContextProgress(
          progressContext,
          progress,
          `Orchestration progress: ${completedTasks.length}/${allTasks.length} tasks completed`
        );
        
        progress = progressReport.reportedProgress;
        
      } catch (error) {
        logger.warn('Failed to calculate orchestration progress with ProgressTracker:', error);
        // Fall back to simple task-based calculation
        progress = allTasks.length > 0 ? 
          Math.min((completedTasks.length / allTasks.length) * 100, 100) : 0;
      }

      // Get orchestration insights and errors
      const insights = await this.getOrchestrationInsights(orchestrationId);
      const errors = await this.getOrchestrationErrors(orchestrationId);

      // Determine overall status
      const status = this.determineOrchestrationStatus(masterTask, activeAgents, completedTasks, failedTasks);

      // Get room name if available
      const roomName = await this.getOrchestrationRoom(orchestrationId);

      // Get next steps
      const nextSteps = await this.getOrchestrationNextSteps(orchestrationId);

      return {
        orchestrationId,
        title: masterTask.description,
        status,
        startTime: masterTask.createdAt,
        endTime: masterTask.updatedAt || undefined,
        duration: masterTask.status === 'completed' ? 
          new Date(masterTask.updatedAt).getTime() - new Date(masterTask.createdAt).getTime() : 
          undefined,
        masterTask,
        spawnedAgents,
        activeAgents,
        completedTasks,
        failedTasks,
        totalTasks: allTasks.length,
        progress,
        roomName,
        foundationSessionId: (masterTask.requirements as any)?.foundationSessionId,
        nextSteps,
        insights,
        errors
      };
    } catch (error) {
      logger.error('Error getting orchestration status:', error);
      throw error;
    }
  }

  /**
   * Get recent activity summary with timeout-aware data prioritization
   */
  async getRecentActivity(
    repositoryPath: string, 
    timeframe: { start: string; end: string }
  ): Promise<AgentActivitySummary> {
    try {
      const resolvedPath = PathUtils.resolveRepositoryPath(repositoryPath, 'getRecentActivity');
      
      // Get agent statistics
      const allAgents = await this.agentService.listAgents(resolvedPath);
      const activeAgents = allAgents.filter(agent => agent.status === 'active');

      // Get task statistics
      const allTasks = await this.taskService.getTasksByRepository(resolvedPath, {
        limit: 1000,
        offset: 0
      });
      
      // Filter tasks by timeframe
      const timeframeTasks = allTasks.filter(task => {
        const taskTime = new Date(task.createdAt).getTime();
        return taskTime >= new Date(timeframe.start).getTime() && 
               taskTime <= new Date(timeframe.end).getTime();
      });
      const completedTasks = timeframeTasks.filter(task => task.status === 'completed');
      const failedTasks = timeframeTasks.filter(task => task.status === 'failed');

      // Get communication statistics
      const rooms = await this.communicationService.listRooms(resolvedPath);
      const recentMessages = await this.getRecentMessages(resolvedPath, timeframe);

      // Get top performers
      const topPerformers = await this.getTopPerformers(resolvedPath, timeframe);

      // Get coordination events
      const coordinationEvents = await this.getCoordinationEvents(resolvedPath, timeframe);

      // Get insights and errors
      const insights = await this.getRecentInsights(resolvedPath, timeframe);
      const errors = await this.getRecentErrors(resolvedPath, timeframe);

      return {
        timeframe,
        totalAgents: allAgents.length,
        activeAgents: activeAgents.length,
        completedTasks: completedTasks.length,
        failedTasks: failedTasks.length,
        totalMessages: recentMessages.length,
        topPerformers,
        coordinationEvents,
        insights,
        errors
      };
    } catch (error) {
      logger.error('Error getting recent activity:', error);
      throw error;
    }
  }

  /**
   * Get room activity snapshot
   */
  async getRoomActivity(roomName: string): Promise<RoomActivitySnapshot> {
    try {
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        throw new Error(`Room ${roomName} not found`);
      }

      const messages = await this.communicationService.getMessages(roomName);
      const recentMessages = messages.slice(-10); // Last 10 messages

      const activeMembers = await this.getActiveRoomMembers(roomName);
      const coordinationStatus = await this.assessCoordinationStatus(roomName, messages);

      return {
        roomId: room.id,
        roomName,
        memberCount: 0, // TODO: Calculate actual member count
        activeMembers,
        recentMessages,
        messageCount: messages.length,
        lastActivity: messages.length > 0 ? messages[messages.length - 1].timestamp : room.createdAt,
        coordinationStatus
      };
    } catch (error) {
      logger.error('Error getting room activity:', error);
      throw error;
    }
  }

  /**
   * Stream real-time updates (for future implementation)
   */
  async *streamAgentUpdates(agentId: string): AsyncGenerator<AgentStatusSnapshot, void, unknown> {
    // TODO: Implement real-time streaming when needed
    // For now, return current status
    yield await this.getAgentStatus(agentId);
  }

  /**
   * Private helper methods
   */

  private async getCurrentTask(agentId: string): Promise<Task | undefined> {
    const tasks = await this.taskService.getTasksByAgent(agentId, {
      limit: 1,
      offset: 0
    });
    return tasks.find(task => task.status === 'in_progress');
  }

  private async getAgentRoomMemberships(agentId: string): Promise<string[]> {
    const rooms = await this.communicationService.listRooms(this.repositoryPath);
    const memberships: string[] = [];
    
    for (const room of rooms) {
      const messages = await this.communicationService.getMessages(room.name);
      const hasMessages = messages.some(msg => msg.agentName === agentId);
      if (hasMessages) {
        memberships.push(room.name);
      }
    }
    
    return memberships;
  }

  private async getRecentAgentMessages(agentId: string, limit: number): Promise<ChatMessage[]> {
    const rooms = await this.getAgentRoomMemberships(agentId);
    const allMessages: ChatMessage[] = [];
    
    for (const roomName of rooms) {
      const messages = await this.communicationService.getMessages(roomName);
      const agentMessages = messages.filter(msg => msg.agentName === agentId);
      allMessages.push(...agentMessages);
    }
    
    // Sort by creation time and take the most recent
    return allMessages
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  private async getAgentPerformance(agentId: string, timeframe?: { start: string; end: string }) {
    const tasks = await this.taskService.getTasksByAgent(agentId, {
      limit: 1000,
      offset: 0
    });
    
    // Filter by timeframe if provided
    const filteredTasks = timeframe ? tasks.filter(task => {
      const taskTime = new Date(task.createdAt).getTime();
      return taskTime >= new Date(timeframe.start).getTime() && 
             taskTime <= new Date(timeframe.end).getTime();
    }) : tasks;
    const completedTasks = filteredTasks.filter(task => task.status === 'completed');
    const failedTasks = filteredTasks.filter(task => task.status === 'failed');
    
    const durations = completedTasks
      .filter(task => task.status === 'completed')
      .map(task => 
        new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime()
      );
    
    const averageTaskDuration = durations.length > 0 ? 
      durations.reduce((sum, duration) => sum + duration, 0) / durations.length : 0;
    
    const errorRate = filteredTasks.length > 0 ? failedTasks.length / filteredTasks.length : 0;
    const lastErrorTime = failedTasks.length > 0 ? 
      failedTasks[failedTasks.length - 1].updatedAt : undefined;

    return {
      tasksCompleted: completedTasks.length,
      averageTaskDuration,
      errorRate,
      lastErrorTime
    };
  }

  private calculateUptime(startTime: string): number {
    return (Date.now() - new Date(startTime).getTime()) / 1000;
  }

  private async getTaskProgress(taskId: string): Promise<number | undefined> {
    // TODO: Implement task progress tracking
    // For now, return undefined
    return undefined;
  }

  private async findMasterTask(orchestrationId: string): Promise<Task | undefined> {
    const resolvedPath = PathUtils.resolveRepositoryPath(this.repositoryPath, 'findMasterTask');
    const tasks = await this.taskService.getTasksByRepository(resolvedPath, {
      limit: 1000,
      offset: 0
    });
    
    // First try to find by orchestration ID in requirements
    let masterTask = tasks.find(task => 
      (task.requirements as any)?.orchestrationId === orchestrationId ||
      task.id === orchestrationId
    );
    
    // If not found, try to find by looking for the agent's assigned task
    if (!masterTask) {
      const agents = await this.agentService.listAgents(resolvedPath);
      const orchestrationAgent = agents.find(agent => agent.id === orchestrationId);
      
      if (orchestrationAgent && orchestrationAgent.agentMetadata?.assignedTaskId) {
        masterTask = tasks.find(task => task.id === orchestrationAgent.agentMetadata.assignedTaskId);
      }
    }
    
    return masterTask;
  }

  private async getOrchestrationAgents(orchestrationId: string): Promise<AgentStatusSnapshot[]> {
    // Find agents related to this orchestration
    const agents = await this.agentService.listAgents(this.repositoryPath);
    
    const orchestrationAgents: AgentStatusSnapshot[] = [];
    
    for (const agent of agents) {
      // Check if agent is part of this orchestration
      if ((agent.agentMetadata as any)?.orchestrationId === orchestrationId) {
        const snapshot = await this.getAgentStatus(agent.id);
        orchestrationAgents.push(snapshot);
      }
    }
    
    return orchestrationAgents;
  }

  private async getOrchestrationTasks(orchestrationId: string): Promise<Task[]> {
    const tasks = await this.taskService.getTasksByRepository(this.repositoryPath, {
      limit: 1000,
      offset: 0
    });
    
    return tasks.filter(task => 
      (task.requirements as any)?.orchestrationId === orchestrationId ||
      task.parentTaskId === orchestrationId
    );
  }

  private async getOrchestrationInsights(orchestrationId: string): Promise<KnowledgeEntity[]> {
    const insights = await this.knowledgeGraphService.findEntitiesByType('insight', this.repositoryPath, 10);
    
    return insights.filter(insight => 
      insight.description?.includes(orchestrationId)
    );
  }

  private async getOrchestrationErrors(orchestrationId: string): Promise<string[]> {
    const errors = await this.knowledgeGraphService.findEntitiesByType('error', this.repositoryPath, 10);
    
    return errors
      .filter(error => error.description?.includes(orchestrationId))
      .map(error => error.description || error.name);
  }

  private determineOrchestrationStatus(
    masterTask: Task, 
    activeAgents: AgentStatusSnapshot[], 
    completedTasks: Task[], 
    failedTasks: Task[]
  ): 'active' | 'completed' | 'failed' | 'paused' {
    if (masterTask.status === 'completed') return 'completed';
    if (masterTask.status === 'failed') return 'failed';
    if (activeAgents.length === 0 && completedTasks.length === 0) return 'paused';
    return 'active';
  }

  private async getOrchestrationRoom(orchestrationId: string): Promise<string | undefined> {
    const rooms = await this.communicationService.listRooms(this.repositoryPath);
    return rooms.find(room => 
      (room.roomMetadata as any)?.orchestrationId === orchestrationId
    )?.name;
  }

  private async getOrchestrationNextSteps(orchestrationId: string): Promise<string[]> {
    // TODO: Implement next steps analysis
    return [];
  }

  private async getRecentMessages(repositoryPath: string, timeframe: { start: string; end: string }): Promise<ChatMessage[]> {
    const rooms = await this.communicationService.listRooms(repositoryPath);
    const allMessages: ChatMessage[] = [];
    
    for (const room of rooms) {
      const messages = await this.communicationService.getMessages(room.name);
      const timeframeMessages = messages.filter(msg => {
        const msgTime = new Date(msg.timestamp).getTime();
        return msgTime >= new Date(timeframe.start).getTime() && 
               msgTime <= new Date(timeframe.end).getTime();
      });
      allMessages.push(...timeframeMessages);
    }
    
    return allMessages;
  }

  private async getTopPerformers(repositoryPath: string, timeframe: { start: string; end: string }) {
    const agents = await this.agentService.listAgents(repositoryPath);
    const performers = [];
    
    for (const agent of agents) {
      const performance = await this.getAgentPerformance(agent.id, timeframe);
      if (performance.tasksCompleted > 0) {
        performers.push({
          agentId: agent.id,
          tasksCompleted: performance.tasksCompleted,
          averageDuration: performance.averageTaskDuration
        });
      }
    }
    
    return performers
      .sort((a, b) => b.tasksCompleted - a.tasksCompleted)
      .slice(0, 5);
  }

  private async getCoordinationEvents(repositoryPath: string, timeframe: { start: string; end: string }) {
    const rooms = await this.communicationService.listRooms(repositoryPath);
    const recentMessages = await this.getRecentMessages(repositoryPath, timeframe);
    
    const roomsCreatedInTimeframe = rooms.filter(room => {
      const roomTime = new Date(room.createdAt).getTime();
      return roomTime >= new Date(timeframe.start).getTime() && 
             roomTime <= new Date(timeframe.end).getTime();
    });
    
    return {
      roomsCreated: roomsCreatedInTimeframe.length,
      roomsClosed: 0, // TODO: Track closed rooms
      messagesExchanged: recentMessages.length
    };
  }

  private async getRecentInsights(repositoryPath: string, timeframe: { start: string; end: string }): Promise<KnowledgeEntity[]> {
    return await this.knowledgeGraphService.findEntitiesByType('insight', repositoryPath, 10);
  }

  private async getRecentErrors(repositoryPath: string, timeframe: { start: string; end: string }): Promise<string[]> {
    const errors = await this.knowledgeGraphService.findEntitiesByType('error', repositoryPath, 10);
    
    return errors.map(error => error.description || error.name);
  }

  private async getActiveRoomMembers(roomName: string): Promise<string[]> {
    const messages = await this.communicationService.getMessages(roomName);
    const recentMessages = messages.filter(msg => {
      const msgTime = new Date(msg.timestamp).getTime();
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      return msgTime >= oneHourAgo;
    });
    
    const activeMembers = new Set(recentMessages.map(msg => msg.agentName));
    return Array.from(activeMembers);
  }

  private async assessCoordinationStatus(roomName: string, messages: ChatMessage[]): Promise<'active' | 'idle' | 'blocked'> {
    if (messages.length === 0) return 'idle';
    
    const lastMessage = messages[messages.length - 1];
    const lastMessageTime = new Date(lastMessage.timestamp).getTime();
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    
    if (lastMessageTime < thirtyMinutesAgo) return 'idle';
    
    // Check for blocking patterns
    const recentMessages = messages.slice(-5);
    const hasErrorKeywords = recentMessages.some(msg => 
      msg.message.toLowerCase().includes('error') || 
      msg.message.toLowerCase().includes('failed') ||
      msg.message.toLowerCase().includes('blocked')
    );
    
    return hasErrorKeywords ? 'blocked' : 'active';
  }
}