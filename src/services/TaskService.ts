import { DatabaseManager } from '../database/index.js';
import { TaskRepository } from '../repositories/TaskRepository.js';
import { AgentRepository } from '../repositories/AgentRepository.js';
import { MemoryRepository } from '../repositories/MemoryRepository.js';
import { PathUtils } from '../utils/pathUtils.js';
import { Logger } from '../utils/logger.js';
import type { Task, NewTask, TaskUpdate, TaskStatus, TaskType, AgentStatus } from '../schemas/index.js';
import { randomUUID } from 'crypto';

export interface CreateTaskRequest {
  repositoryPath: string;
  taskType: TaskType;
  description: string;
  requirements?: Record<string, any>;
  parentTaskId?: string;
  priority?: number;
  assignedAgentId?: string;
  estimatedDuration?: number;
  tags?: string[];
}

export interface TaskServiceUpdate {
  status?: TaskStatus;
  results?: Record<string, any>;
  requirements?: Record<string, any>;
  progressPercentage?: number;
  notes?: string;
}

export interface TaskExecutionPlan {
  tasks: Task[];
  executionOrder: string[];
  dependencies: Map<string, string[]>;
  criticalPath: string[];
  estimatedDuration: number;
  riskAssessment: TaskRiskAssessment;
}

export interface TaskRiskAssessment {
  highRiskTasks: string[];
  potentialBottlenecks: string[];
  mitigationStrategies: string[];
  confidenceLevel: number;
}

/**
 * Simplified TaskService
 * Provides essential task management functionality without over-engineering
 */
export class TaskService {
  private logger: Logger;
  private taskRepo: TaskRepository;
  private agentRepo: AgentRepository;
  private memoryRepo: MemoryRepository;

  constructor(private db: DatabaseManager) {
    this.logger = new Logger('task-service');
    this.taskRepo = new TaskRepository(db);
    this.agentRepo = new AgentRepository(db);
    this.memoryRepo = new MemoryRepository(db);
  }

  /**
   * Create a new task
   */
  async createTask(request: CreateTaskRequest): Promise<Task> {
    try {
      const normalizedPath = request.repositoryPath;
      
      const taskData: NewTask = {
        id: randomUUID(),
        repositoryPath: normalizedPath,
        taskType: request.taskType,
        description: request.description,
        requirements: request.requirements || {},
        parentTaskId: request.parentTaskId,
        priority: request.priority || 1,
        assignedAgentId: request.assignedAgentId,
        status: 'pending'
      };

      const task = await this.taskRepo.create(taskData);
      
      // Create memory entry
      await this.memoryRepo.create({
        id: randomUUID(),
        repositoryPath: task.repositoryPath,
        agentId: 'system',
        memoryType: 'progress',
        title: `Task Created: ${task.description.substring(0, 50)}...`,
        content: `Task created: ${task.description}`,
        tags: ['task-creation', task.taskType, 'system'],
        confidence: 0.9,
        relevanceScore: 1.0,
        miscData: {
          taskId: task.id,
          taskType: task.taskType,
          priority: task.priority,
          action: 'created'
        }
      });

      this.logger.info('Task created successfully', { taskId: task.id, taskType: task.taskType });
      return task;
    } catch (error) {
      this.logger.error('Failed to create task', { error, request });
      throw error;
    }
  }

  /**
   * Update task status and progress
   */
  async updateTask(taskId: string, update: TaskServiceUpdate): Promise<Task> {
    try {
      const task = await this.taskRepo.findById(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const updatedTask = await this.taskRepo.update(taskId, update);
      
      // Create memory entry for update
      await this.memoryRepo.create({
        id: randomUUID(),
        repositoryPath: task.repositoryPath,
        agentId: task.assignedAgentId || 'system',
        memoryType: 'progress',
        title: `Task Updated: ${task.description.substring(0, 50)}...`,
        content: `Task updated: ${JSON.stringify(update)}`,
        tags: ['task-update', task.taskType, task.status],
        confidence: 0.8,
        relevanceScore: 1.0,
        miscData: {
          taskId: task.id,
          statusChange: `${task.status} -> ${update.status || task.status}`,
          progressPercentage: update.progressPercentage || 0,
          action: 'updated'
        }
      });

      this.logger.info('Task updated successfully', { taskId, update });
      return updatedTask;
    } catch (error) {
      this.logger.error('Failed to update task', { error, taskId, update });
      throw error;
    }
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    return await this.taskRepo.findById(taskId);
  }

  /**
   * Get tasks by repository
   */
  async getTasksByRepository(repositoryPath: string, options: {
    status?: TaskStatus;
    taskType?: TaskType;
    assignedAgentId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Task[]> {
    return await this.taskRepo.findByRepositoryPath(repositoryPath, options);
  }

  /**
   * Get tasks by agent
   */
  async getTasksByAgent(agentId: string, options: {
    status?: TaskStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<Task[]> {
    return await this.taskRepo.findByField('assignedAgentId', agentId);
  }

  /**
   * Create a basic execution plan
   */
  async createExecutionPlan(taskIds: string[]): Promise<TaskExecutionPlan> {
    try {
      const tasks = await Promise.all(taskIds.map(id => this.taskRepo.findById(id)));
      const validTasks = tasks.filter(t => t !== null) as Task[];
      
      // Simple execution order (by priority, then creation date)
      const executionOrder = validTasks
        .sort((a, b) => (b.priority || 0) - (a.priority || 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map(t => t.id);

      // Basic dependencies map
      const dependencies = new Map<string, string[]>();
      validTasks.forEach(task => {
        if (task.parentTaskId) {
          dependencies.set(task.id, [task.parentTaskId]);
        }
      });

      return {
        tasks: validTasks,
        executionOrder,
        dependencies,
        criticalPath: executionOrder, // Simplified
        estimatedDuration: validTasks.length * 30, // Simple estimate: 30 minutes per task
        riskAssessment: {
          highRiskTasks: [],
          potentialBottlenecks: [],
          mitigationStrategies: [],
          confidenceLevel: 0.8
        }
      };
    } catch (error) {
      this.logger.error('Failed to create execution plan', { error, taskIds });
      throw error;
    }
  }

  /**
   * Assign task to agent
   */
  async assignTask(taskId: string, agentId: string): Promise<Task> {
    try {
      const task = await this.taskRepo.findById(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const agent = await this.agentRepo.findById(agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      const updatedTask = await this.taskRepo.update(taskId, {
        assignedAgentId: agentId,
        status: 'in_progress'
      });

      this.logger.info('Task assigned successfully', { taskId, agentId });
      return updatedTask;
    } catch (error) {
      this.logger.error('Failed to assign task', { error, taskId, agentId });
      throw error;
    }
  }

  /**
   * Mark task as completed
   */
  async completeTask(taskId: string, results?: Record<string, any>): Promise<Task> {
    try {
      const task = await this.taskRepo.findById(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const updatedTask = await this.taskRepo.update(taskId, {
        status: 'completed',
        results: results || {}
      });

      // Create completion memory
      await this.memoryRepo.create({
        id: randomUUID(),
        repositoryPath: task.repositoryPath,
        agentId: task.assignedAgentId || 'system',
        memoryType: 'insight',
        title: `Task Completed: ${task.description.substring(0, 50)}...`,
        content: `Task completed successfully. Results: ${JSON.stringify(results || {})}`,
        tags: ['task-completion', task.taskType, 'success'],
        confidence: 0.9,
        relevanceScore: 1.0,
        miscData: {
          taskId: task.id,
          completionInsights: results || {},
          action: 'completed'
        }
      });

      this.logger.info('Task completed successfully', { taskId });
      return updatedTask;
    } catch (error) {
      this.logger.error('Failed to complete task', { error, taskId });
      throw error;
    }
  }

  /**
   * Get task statistics
   */
  async getTaskStats(repositoryPath: string): Promise<{
    total: number;
    byStatus: Record<TaskStatus, number>;
    byType: Record<TaskType, number>;
    completionRate: number;
  }> {
    try {
      const tasks = await this.taskRepo.findByRepositoryPath(repositoryPath);

      const byStatus = tasks.reduce((acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      }, {} as Record<TaskStatus, number>);

      const byType = tasks.reduce((acc, task) => {
        acc[task.taskType] = (acc[task.taskType] || 0) + 1;
        return acc;
      }, {} as Record<TaskType, number>);

      const completedTasks = tasks.filter(t => t.status === 'completed').length;
      const completionRate = tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0;

      return {
        total: tasks.length,
        byStatus,
        byType,
        completionRate
      };
    } catch (error) {
      this.logger.error('Failed to get task stats', { error, repositoryPath });
      throw error;
    }
  }

  /**
   * Delete task
   */
  async deleteTask(taskId: string): Promise<void> {
    try {
      const task = await this.taskRepo.findById(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      await this.taskRepo.delete(taskId);
      this.logger.info('Task deleted successfully', { taskId });
    } catch (error) {
      this.logger.error('Failed to delete task', { error, taskId });
      throw error;
    }
  }

  /**
   * List tasks (alias for CLI compatibility)
   */
  async listTasks(repositoryPath: string, options: {
    status?: TaskStatus;
    taskType?: TaskType;
    assignedAgentId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Task[]> {
    return await this.getTasksByRepository(repositoryPath, options);
  }

  /**
   * Add task dependency
   */
  async addTaskDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    try {
      const task = await this.taskRepo.findById(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const dependsOnTask = await this.taskRepo.findById(dependsOnTaskId);
      if (!dependsOnTask) {
        throw new Error(`Dependency task not found: ${dependsOnTaskId}`);
      }

      // For now, store dependencies in the requirements field
      const requirements = task.requirements || {};
      const dependencies = (requirements.dependencies as string[]) || [];
      if (!dependencies.includes(dependsOnTaskId)) {
        dependencies.push(dependsOnTaskId);
        requirements.dependencies = dependencies;
        
        await this.taskRepo.update(taskId, { requirements });
      }

      this.logger.info('Task dependency added successfully', { taskId, dependsOnTaskId });
    } catch (error) {
      this.logger.error('Failed to add task dependency', { error, taskId, dependsOnTaskId });
      throw error;
    }
  }

  /**
   * Get task analytics
   */
  async getTaskAnalytics(repositoryPath: string): Promise<{
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    completionRate: number;
    averageCompletionTime: number;
    tasksByType: Record<TaskType, number>;
    tasksByPriority: Record<number, number>;
  }> {
    try {
      const tasks = await this.taskRepo.findByRepositoryPath(repositoryPath);
      
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(t => t.status === 'completed').length;
      const pendingTasks = tasks.filter(t => t.status === 'pending').length;
      const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
      const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      const tasksByType = tasks.reduce((acc, task) => {
        acc[task.taskType] = (acc[task.taskType] || 0) + 1;
        return acc;
      }, {} as Record<TaskType, number>);

      const tasksByPriority = tasks.reduce((acc, task) => {
        const priority = task.priority || 1;
        acc[priority] = (acc[priority] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      // Simple average completion time calculation (mock for now)
      const averageCompletionTime = 45; // minutes

      return {
        totalTasks,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        completionRate,
        averageCompletionTime,
        tasksByType,
        tasksByPriority
      };
    } catch (error) {
      this.logger.error('Failed to get task analytics', { error, repositoryPath });
      throw error;
    }
  }

  /**
   * Get task hierarchy
   */
  async getTaskHierarchy(repositoryPath: string): Promise<{
    rootTasks: Task[];
    taskTree: Record<string, Task[]>;
    orphanTasks: Task[];
  }> {
    try {
      const tasks = await this.taskRepo.findByRepositoryPath(repositoryPath);
      
      const rootTasks = tasks.filter(t => !t.parentTaskId);
      const taskTree: Record<string, Task[]> = {};
      
      // Build task tree
      tasks.forEach(task => {
        if (task.parentTaskId) {
          if (!taskTree[task.parentTaskId]) {
            taskTree[task.parentTaskId] = [];
          }
          taskTree[task.parentTaskId].push(task);
        }
      });

      // Find orphan tasks (tasks with parent that doesn't exist)
      const orphanTasks = tasks.filter(task => {
        if (!task.parentTaskId) return false;
        return !tasks.some(t => t.id === task.parentTaskId);
      });

      return {
        rootTasks,
        taskTree,
        orphanTasks
      };
    } catch (error) {
      this.logger.error('Failed to get task hierarchy', { error, repositoryPath });
      throw error;
    }
  }

  /**
   * Break down task into subtasks
   */
  async breakdownTask(taskId: string, subtasks: Array<{
    description: string;
    taskType: TaskType;
    priority?: number;
    estimatedDuration?: number;
  }>): Promise<Task[]> {
    try {
      const parentTask = await this.taskRepo.findById(taskId);
      if (!parentTask) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const createdSubtasks: Task[] = [];
      for (const subtask of subtasks) {
        const newTask = await this.createTask({
          repositoryPath: parentTask.repositoryPath,
          taskType: subtask.taskType,
          description: subtask.description,
          parentTaskId: taskId,
          priority: subtask.priority || parentTask.priority,
          estimatedDuration: subtask.estimatedDuration
        });
        createdSubtasks.push(newTask);
      }

      this.logger.info('Task broken down successfully', { taskId, subtaskCount: subtasks.length });
      return createdSubtasks;
    } catch (error) {
      this.logger.error('Failed to break down task', { error, taskId });
      throw error;
    }
  }

  /**
   * Auto-assign tasks to agents
   */
  async autoAssignTasks(repositoryPath: string, agentId: string, taskTypes?: TaskType[]): Promise<Task[]> {
    try {
      const filters: any = { status: 'pending' };
      if (taskTypes && taskTypes.length > 0) {
        // For now, just use the first task type
        filters.taskType = taskTypes[0];
      }

      const availableTasks = await this.taskRepo.findByRepositoryPath(repositoryPath, filters);
      
      // Simple auto-assignment: assign up to 3 tasks
      const tasksToAssign = availableTasks.slice(0, 3);
      const assignedTasks: Task[] = [];

      for (const task of tasksToAssign) {
        const assignedTask = await this.assignTask(task.id, agentId);
        assignedTasks.push(assignedTask);
      }

      this.logger.info('Tasks auto-assigned successfully', { 
        agentId, 
        assignedCount: assignedTasks.length,
        taskTypes 
      });
      return assignedTasks;
    } catch (error) {
      this.logger.error('Failed to auto-assign tasks', { error, repositoryPath, agentId });
      throw error;
    }
  }

  /**
   * Get pending tasks
   */
  async getPendingTasks(repositoryPath: string, options: {
    taskType?: TaskType;
    priority?: number;
    limit?: number;
  } = {}): Promise<Task[]> {
    const filters: any = {
      status: 'pending' as TaskStatus,
      taskType: options.taskType
    };
    
    const tasks = await this.taskRepo.findByRepositoryPath(repositoryPath, filters);
    
    // Apply limit manually since the repository doesn't support it
    if (options.limit) {
      return tasks.slice(0, options.limit);
    }
    
    return tasks;
  }
}