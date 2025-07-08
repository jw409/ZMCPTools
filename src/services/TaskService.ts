import { DatabaseManager } from '../database/index.js';
import { TaskRepository } from '../repositories/TaskRepository.js';
import { AgentRepository } from '../repositories/AgentRepository.js';
import type { Task, NewTask, TaskUpdate, TaskStatus, TaskType, AgentStatus } from '../schemas/index.js';

export interface CreateTaskRequest {
  repositoryPath: string;
  taskType: TaskType;
  description: string;
  requirements?: Record<string, any>;
  parentTaskId?: string;
  priority?: number;
  assignedAgentId?: string;
}

export interface TaskServiceUpdate {
  status?: TaskStatus;
  results?: Record<string, any>;
  requirements?: Record<string, any>;
}

export interface TaskExecutionPlan {
  tasks: Task[];
  executionOrder: string[];
  dependencies: Map<string, string[]>;
}

export class TaskService {
  private taskRepo: TaskRepository;
  private agentRepo: AgentRepository;

  constructor(private db: DatabaseManager) {
    this.taskRepo = new TaskRepository(db);
    this.agentRepo = new AgentRepository(db);
  }

  async createTask(request: CreateTaskRequest): Promise<Task> {
    const taskId = this.generateTaskId();
    
    const taskData: NewTask = {
      id: taskId,
      repositoryPath: request.repositoryPath,
      taskType: request.taskType,
      status: 'pending',
      assignedAgentId: request.assignedAgentId,
      parentTaskId: request.parentTaskId,
      priority: request.priority || 1,
      description: request.description,
      requirements: request.requirements || {},
      results: {}
    };

    const task = await this.taskRepo.create(taskData);
    
    // If assigned to an agent, update agent status
    if (request.assignedAgentId) {
      await this.agentRepo.update(request.assignedAgentId, { status: 'active' });
    }

    return task;
  }

  async getTask(taskId: string): Promise<Task | null> {
    return await this.taskRepo.findById(taskId);
  }

  async listTasks(repositoryPath: string, options: any = {}): Promise<Task[]> {
    return await this.taskRepo.findByRepositoryPath(repositoryPath, options);
  }

  async getAgentTasks(agentId: string): Promise<Task[]> {
    return await this.taskRepo.findByRepositoryPath('', { assignedAgentId: agentId });
  }

  async getPendingTasks(repositoryPath: string): Promise<Task[]> {
    return await this.taskRepo.findByRepositoryPath(repositoryPath, { status: 'pending' });
  }

  async getReadyTasks(repositoryPath: string): Promise<Task[]> {
    return await this.taskRepo.findByRepositoryPath(repositoryPath, { status: 'pending' });
  }

  async updateTask(taskId: string, update: TaskServiceUpdate): Promise<void> {
    const updateData: any = {};
    
    if (update.status) {
      updateData.status = update.status;
    }
    
    if (update.requirements) {
      updateData.requirements = update.requirements;
    }
    
    if (update.results) {
      updateData.results = update.results;
    }
    
    await this.taskRepo.update(taskId, updateData);
  }

  async assignTask(taskId: string, agentId: string): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const agent = await this.agentRepo.findById(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Assign task and update statuses
    await this.taskRepo.update(taskId, { assignedAgentId: agentId });
    await this.agentRepo.update(agentId, { status: 'active' });
  }

  async completeTask(taskId: string, results?: Record<string, any>): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    await this.taskRepo.update(taskId, { status: 'completed', results });
    
    // If task was assigned to an agent, update agent status
    if (task.assignedAgentId) {
      // Check if agent has other pending tasks
      const agentTasks = await this.taskRepo.findByRepositoryPath('', { assignedAgentId: task.assignedAgentId });
      const hasActiveTasks = agentTasks.some((t: any) => 
        t.id !== taskId && (t.status === 'pending' || t.status === 'in_progress')
      );
      
      if (!hasActiveTasks) {
        await this.agentRepo.update(task.assignedAgentId, { status: 'idle' });
      }
    }
  }

  async failTask(taskId: string, error: string, results?: Record<string, any>): Promise<void> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const failureResults = {
      error,
      failedAt: new Date().toISOString(),
      ...results
    };

    await this.taskRepo.update(taskId, { status: 'failed', results: failureResults });
    
    // Update agent status if assigned
    if (task.assignedAgentId) {
      await this.agentRepo.update(task.assignedAgentId, { status: 'idle' });
    }
  }

  async addTaskDependency(taskId: string, dependsOnTaskId: string, dependencyType = 'completion'): Promise<void> {
    // Validate both tasks exist
    const task = await this.taskRepo.findById(taskId);
    const dependsOnTask = await this.taskRepo.findById(dependsOnTaskId);
    
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    if (!dependsOnTask) {
      throw new Error(`Dependency task ${dependsOnTaskId} not found`);
    }

    // Check for circular dependencies
    if (await this.wouldCreateCircularDependency(taskId, dependsOnTaskId)) {
      throw new Error('Adding dependency would create circular dependency');
    }

    // Note: dependency management needs to be implemented in repository
    // await this.taskRepo.addDependency({ taskId, dependsOnTaskId, dependencyType });
  }

  async removeTaskDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    // Note: dependency management needs to be implemented in repository
    // await this.taskRepo.removeDependency(taskId, dependsOnTaskId);
  }

  async getTaskDependencies(taskId: string): Promise<string[]> {
    // Note: dependency management needs to be implemented in repository
    // return await this.taskRepo.getDependencies(taskId);
    return [];
  }

  async createExecutionPlan(repositoryPath: string): Promise<TaskExecutionPlan> {
    const tasks = await this.taskRepo.findByRepositoryPath(repositoryPath);
    const dependencies = new Map<string, string[]>();
    
    // Build dependency map (simplified for now)
    for (const task of tasks) {
      dependencies.set(task.id, []);
    }

    // Simple execution order for now
    const executionOrder = tasks.map((t: any) => t.id);
    
    return {
      tasks,
      executionOrder,
      dependencies
    };
  }

  // Break down complex task into subtasks
  async breakdownTask(
    parentTaskId: string,
    subtasks: Array<{
      description: string;
      taskType: TaskType;
      requirements?: Record<string, any>;
      dependencies?: string[];
    }>
  ): Promise<Task[]> {
    const parentTask = await this.taskRepo.findById(parentTaskId);
    if (!parentTask) {
      throw new Error(`Parent task ${parentTaskId} not found`);
    }

    const createdTasks: Task[] = [];

    for (const subtaskData of subtasks) {
      const subtask = await this.createTask({
        repositoryPath: parentTask.repositoryPath,
        taskType: subtaskData.taskType,
        description: subtaskData.description,
        requirements: subtaskData.requirements,
        parentTaskId: parentTaskId,
        priority: parentTask.priority
      });

      // Add dependencies if specified
      if (subtaskData.dependencies) {
        for (const depId of subtaskData.dependencies) {
          await this.addTaskDependency(subtask.id, depId);
        }
      }

      createdTasks.push(subtask);
    }

    return createdTasks;
  }

  async getSubtasks(parentTaskId: string): Promise<Task[]> {
    return await this.taskRepo.findSubtasks(parentTaskId);
  }

  // Auto-assign tasks to available agents
  async autoAssignTasks(repositoryPath: string): Promise<Array<{taskId: string, agentId: string}>> {
    const readyTasks = await this.getReadyTasks(repositoryPath);
    const availableAgents = await this.agentRepo.findByRepositoryPath(repositoryPath, 'idle');
    
    const assignments: Array<{taskId: string, agentId: string}> = [];

    // Simple round-robin assignment
    let agentIndex = 0;
    for (const task of readyTasks) {
      if (availableAgents.length === 0) break;
      
      const agent = availableAgents[agentIndex % availableAgents.length];
      await this.assignTask(task.id, agent.id);
      
      assignments.push({
        taskId: task.id,
        agentId: agent.id
      });
      
      agentIndex++;
    }

    return assignments;
  }

  // Task progress and analytics
  async getTaskProgress(repositoryPath: string): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    completionRate: number;
  }> {
    const total = await this.taskRepo.count();
    const tasks = await this.taskRepo.findByRepositoryPath(repositoryPath);
    const pending = tasks.filter(t => t.status === 'pending').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    
    const completionRate = total > 0 ? (completed / total) * 100 : 0;

    return {
      total,
      pending,
      inProgress,
      completed,
      failed,
      completionRate
    };
  }

  async deleteTask(taskId: string): Promise<void> {
    // Check if task has subtasks
    const subtasks = await this.getSubtasks(taskId);
    if (subtasks.length > 0) {
      throw new Error('Cannot delete task with subtasks. Delete subtasks first.');
    }

    await this.taskRepo.delete(taskId);
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async wouldCreateCircularDependency(taskId: string, dependsOnTaskId: string): Promise<boolean> {
    const visited = new Set<string>();
    const stack = [dependsOnTaskId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      
      if (currentId === taskId) {
        return true; // Found circular dependency
      }
      
      if (visited.has(currentId)) {
        continue;
      }
      
      visited.add(currentId);
      const deps = await this.taskRepo.getDependencies(currentId);
      stack.push(...deps.map(task => task.id));
    }

    return false;
  }

  private topologicalSort(taskIds: string[], dependencies: Map<string, string[]>): string[] {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    // Initialize
    for (const taskId of taskIds) {
      inDegree.set(taskId, 0);
      adjList.set(taskId, []);
    }

    // Build adjacency list and calculate in-degrees
    for (const taskId of taskIds) {
      const deps = dependencies.get(taskId) || [];
      for (const dep of deps) {
        if (adjList.has(dep)) {
          adjList.get(dep)!.push(taskId);
          inDegree.set(taskId, (inDegree.get(taskId) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    const result: string[] = [];

    // Find all nodes with no incoming edges
    for (const [taskId, degree] of Array.from(inDegree.entries())) {
      if (degree === 0) {
        queue.push(taskId);
      }
    }

    while (queue.length > 0) {
      const taskId = queue.shift()!;
      result.push(taskId);

      const neighbors = adjList.get(taskId) || [];
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Check for cycles
    if (result.length !== taskIds.length) {
      throw new Error('Circular dependency detected in task graph');
    }

    return result;
  }
}