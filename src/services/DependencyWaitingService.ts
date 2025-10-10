import { DatabaseManager } from '../database/index.js';
import { TaskService } from './index.js';
import { eventBus } from './EventBus.js';
import { Logger } from '../utils/logger.js';
import type { AgentStatus } from '../schemas/index.js';

export interface DependencyWaitResult {
  success: boolean;
  completedAgents: string[];
  failedAgents: string[];
  timeoutAgents: string[];
  message: string;
  waitDuration: number;
}

export interface TaskDependencyWaitResult {
  success: boolean;
  completedTasks: string[];
  failedTasks: string[];
  timeoutTasks: string[];
  message: string;
  waitDuration: number;
}

export interface CompletionEvent {
  id: string;
  status: 'completed' | 'failed' | 'terminated' | 'timeout';
  source: 'process_exit' | 'progress_report' | 'timeout' | 'status_change';
  metadata?: Record<string, any>;
}

/**
 * Service for handling agent and task dependency waiting using EventBus
 */
export class DependencyWaitingService {
  private taskService: TaskService;
  private logger: Logger;

  constructor(private db: DatabaseManager) {
    this.taskService = new TaskService(db);
    this.logger = new Logger('DependencyWaitingService');
  }

  /**
   * Wait for agent dependencies to complete before proceeding
   */
  async waitForAgentDependencies(
    dependsOn: string[],
    repositoryPath: string,
    options: {
      timeout?: number;
      checkInterval?: number;
      waitForAnyFailure?: boolean;
    } = {}
  ): Promise<DependencyWaitResult> {
    const {
      timeout = 600000, // 10 minutes default
      checkInterval = 5000, // 5 seconds
      waitForAnyFailure = true
    } = options;

    const startTime = Date.now();
    this.logger.info('Starting dependency wait', {
      dependsOn,
      repositoryPath,
      timeout,
      waitForAnyFailure
    });

    try {
      // 1. Check current status of dependencies
      const currentStatus = await this.checkCurrentDependencyStatus(dependsOn);
      const pending = currentStatus.filter(dep => !['completed', 'failed', 'terminated'].includes(dep.status));
      
      if (pending.length === 0) {
        const completed = currentStatus.filter(dep => dep.status === 'completed').map(dep => dep.agentId);
        const failed = currentStatus.filter(dep => ['failed', 'terminated'].includes(dep.status)).map(dep => dep.agentId);
        
        return {
          success: failed.length === 0,
          completedAgents: completed,
          failedAgents: failed,
          timeoutAgents: [],
          message: failed.length === 0 ? 'All dependencies already completed' : `Some dependencies failed: ${failed.join(', ')}`,
          waitDuration: 0
        };
      }

      this.logger.info('Waiting for pending dependencies', {
        pendingCount: pending.length,
        pendingAgents: pending.map(p => p.agentId)
      });

      // 2. Set up event listeners for each pending dependency
      const completionPromises = pending.map(dep =>
        this.waitForAgentCompletion(dep.agentId, repositoryPath, timeout)
      );

      // 3. Wait for all dependencies to complete or timeout
      const results = await Promise.allSettled(completionPromises);
      
      // 4. Analyze results and return completion status
      return this.analyzeAgentCompletionResults(results, dependsOn, Date.now() - startTime);

    } catch (error) {
      this.logger.error('Error in dependency waiting', { error, dependsOn });
      return {
        success: false,
        completedAgents: [],
        failedAgents: [],
        timeoutAgents: dependsOn,
        message: `Dependency waiting error: ${error}`,
        waitDuration: Date.now() - startTime
      };
    }
  }

  /**
   * Wait for task dependencies to complete
   */
  async waitForTaskDependencies(
    taskId: string,
    repositoryPath: string,
    options: {
      timeout?: number;
      waitForAnyFailure?: boolean;
    } = {}
  ): Promise<TaskDependencyWaitResult> {
    const { timeout = 600000, waitForAnyFailure = true } = options;
    const startTime = Date.now();

    try {
      // Get task dependencies
      const task = await this.taskService.getTask(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      const dependencies = (task.requirements?.dependencies as string[]) || [];
      if (dependencies.length === 0) {
        return {
          success: true,
          completedTasks: [],
          failedTasks: [],
          timeoutTasks: [],
          message: 'No task dependencies to wait for',
          waitDuration: 0
        };
      }

      this.logger.info('Waiting for task dependencies', {
        taskId,
        dependencies,
        repositoryPath
      });

      // Wait for task completion events
      const completionPromises = dependencies.map(depTaskId =>
        this.waitForTaskCompletion(depTaskId, repositoryPath, timeout)
      );

      const results = await Promise.allSettled(completionPromises);
      return this.analyzeTaskCompletionResults(results, dependencies, Date.now() - startTime);

    } catch (error) {
      this.logger.error('Error in task dependency waiting', { error, taskId });
      return {
        success: false,
        completedTasks: [],
        failedTasks: [],
        timeoutTasks: [],
        message: `Task dependency waiting error: ${error}`,
        waitDuration: Date.now() - startTime
      };
    }
  }

  /**
   * Wait for a single agent to complete
   */
  private async waitForAgentCompletion(
    agentId: string,
    repositoryPath: string,
    timeout: number
  ): Promise<CompletionEvent> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        eventBus.unsubscribe(statusSubscriptionId);
        eventBus.unsubscribe(terminationSubscriptionId);
        eventBus.unsubscribe(progressSubscriptionId);
        resolve({
          id: agentId,
          status: 'timeout',
          source: 'timeout',
          metadata: { timeoutDuration: timeout }
        });
      }, timeout);

      // Listen for agent status changes (primary completion signal)
      const statusSubscriptionId = eventBus.subscribe('agent_status_change', (data) => {
        if (data.agentId === agentId && data.repositoryPath === repositoryPath) {
          if (['completed', 'failed', 'terminated'].includes(data.newStatus)) {
            clearTimeout(timeoutId);
            eventBus.unsubscribe(statusSubscriptionId);
            eventBus.unsubscribe(terminationSubscriptionId);
            eventBus.unsubscribe(progressSubscriptionId);
            
            resolve({
              id: agentId,
              status: data.newStatus as any,
              source: 'status_change',
              metadata: { 
                previousStatus: data.previousStatus,
                timestamp: data.timestamp 
              }
            });
          }
        }
      }, { repositoryPath });

      // Listen for explicit termination events (backup signal)
      const terminationSubscriptionId = eventBus.subscribe('agent_terminated', (data) => {
        if (data.agentId === agentId && data.repositoryPath === repositoryPath) {
          clearTimeout(timeoutId);
          eventBus.unsubscribe(statusSubscriptionId);
          eventBus.unsubscribe(terminationSubscriptionId);
          eventBus.unsubscribe(progressSubscriptionId);
          
          resolve({
            id: agentId,
            status: 'terminated',
            source: 'process_exit',
            metadata: {
              finalStatus: data.finalStatus,
              reason: data.reason
            }
          });
        }
      }, { repositoryPath });

      // Listen for task completion reports (secondary signal)
      const progressSubscriptionId = eventBus.subscribe('task_completed', (data: any) => {
        if (data.completedBy === agentId && data.repositoryPath === repositoryPath) {
          clearTimeout(timeoutId);
          eventBus.unsubscribe(statusSubscriptionId);
          eventBus.unsubscribe(terminationSubscriptionId);
          eventBus.unsubscribe(progressSubscriptionId);
          
          resolve({
            id: agentId,
            status: 'completed',
            source: 'progress_report',
            metadata: {
              results: data.results,
              taskId: data.taskId
            }
          });
        }
      }, { repositoryPath });
    });
  }

  /**
   * Wait for a single task to complete
   */
  private async waitForTaskCompletion(
    taskId: string,
    repositoryPath: string,
    timeout: number
  ): Promise<CompletionEvent> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        eventBus.unsubscribe(taskSubscriptionId);
        resolve({
          id: taskId,
          status: 'timeout',
          source: 'timeout',
          metadata: { timeoutDuration: timeout }
        });
      }, timeout);

      const taskSubscriptionId = eventBus.subscribe('task_completed', (data: any) => {
        if (data.taskId === taskId && data.repositoryPath === repositoryPath) {
          clearTimeout(timeoutId);
          eventBus.unsubscribe(taskSubscriptionId);
          
          resolve({
            id: taskId,
            status: 'completed',
            source: 'progress_report',
            metadata: {
              completedBy: data.completedBy,
              results: data.results
            }
          });
        }
      }, { repositoryPath });
    });
  }

  /**
   * Check current status of agent dependencies
   */
  private async checkCurrentDependencyStatus(dependsOn: string[]): Promise<Array<{ agentId: string; status: AgentStatus }>> {
    // Agent spawning removed - returning empty status
    this.logger.warn('Agent spawning removed - dependency checks disabled');
    return dependsOn.map(agentId => ({ agentId, status: 'failed' as AgentStatus }));
  }

  /**
   * Analyze agent completion results from Promise.allSettled
   */
  private analyzeAgentCompletionResults(
    results: PromiseSettledResult<CompletionEvent>[],
    originalAgentIds: string[],
    waitDuration: number
  ): DependencyWaitResult {
    const completed: string[] = [];
    const failed: string[] = [];
    const timeout: string[] = [];

    results.forEach((result, index) => {
      const agentId = originalAgentIds[index];
      
      if (result.status === 'fulfilled') {
        const event = result.value;
        if (event.status === 'completed') {
          completed.push(event.id);
        } else if (event.status === 'timeout') {
          timeout.push(event.id);
        } else {
          failed.push(event.id);
        }
      } else {
        // Promise rejected
        failed.push(agentId);
      }
    });

    const success = failed.length === 0 && timeout.length === 0;
    let message = '';
    
    if (success) {
      message = `All ${completed.length} dependencies completed successfully`;
    } else {
      const issues: string[] = [];
      if (failed.length > 0) issues.push(`${failed.length} failed`);
      if (timeout.length > 0) issues.push(`${timeout.length} timed out`);
      message = `Dependency issues: ${issues.join(', ')}`;
    }

    this.logger.info('Dependency wait completed', {
      success,
      completed: completed.length,
      failed: failed.length,
      timeout: timeout.length,
      waitDuration
    });

    return {
      success,
      completedAgents: completed,
      failedAgents: failed,
      timeoutAgents: timeout,
      message,
      waitDuration
    };
  }

  /**
   * Analyze task completion results from Promise.allSettled
   */
  private analyzeTaskCompletionResults(
    results: PromiseSettledResult<CompletionEvent>[],
    originalTaskIds: string[],
    waitDuration: number
  ): TaskDependencyWaitResult {
    const completed: string[] = [];
    const failed: string[] = [];
    const timeout: string[] = [];

    results.forEach((result, index) => {
      const taskId = originalTaskIds[index];
      
      if (result.status === 'fulfilled') {
        const event = result.value;
        if (event.status === 'completed') {
          completed.push(event.id);
        } else if (event.status === 'timeout') {
          timeout.push(event.id);
        } else {
          failed.push(event.id);
        }
      } else {
        failed.push(taskId);
      }
    });

    const success = failed.length === 0 && timeout.length === 0;
    let message = '';
    
    if (success) {
      message = `All ${completed.length} task dependencies completed successfully`;
    } else {
      const issues: string[] = [];
      if (failed.length > 0) issues.push(`${failed.length} failed`);
      if (timeout.length > 0) issues.push(`${timeout.length} timed out`);
      message = `Task dependency issues: ${issues.join(', ')}`;
    }

    return {
      success,
      completedTasks: completed,
      failedTasks: failed,
      timeoutTasks: timeout,
      message,
      waitDuration
    };
  }

  /**
   * Get detailed status of pending dependencies for monitoring
   */
  async getDependencyStatus(
    dependsOn: string[],
    repositoryPath: string
  ): Promise<Array<{
    agentId: string;
    status: AgentStatus;
    lastHeartbeat?: Date;
    currentTask?: string;
    progress?: number;
  }>> {
    const statusDetails = [];

    // Agent spawning removed - returning failed status for all
    for (const agentId of dependsOn) {
      statusDetails.push({
        agentId,
        status: 'failed' as AgentStatus
      });
    }

    return statusDetails;
  }
}