import { ClaudeDatabase } from '../database/index.js';
import { TaskRepository } from './repositories/TaskRepository.js';
import { AgentRepository } from './repositories/AgentRepository.js';
import { Task, TaskStatus, TaskType, AgentStatus } from '../models/index.js';
import type { TaskData } from '../models/index.js';

export interface CreateTaskRequest {
  repositoryPath: string;
  taskType: TaskType;
  description: string;
  requirements?: Record<string, any>;
  parentTaskId?: string;
  priority?: number;
  assignedAgentId?: string;
}

export interface TaskUpdate {
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

  constructor(private db: ClaudeDatabase) {
    this.taskRepo = new TaskRepository(db);
    this.agentRepo = new AgentRepository(db);
  }

  async createTask(request: CreateTaskRequest): Promise<Task> {
    const taskId = this.generateTaskId();
    
    const taskData: Omit<TaskData, 'created_at' | 'updated_at'> = {
      id: taskId,
      repository_path: request.repositoryPath,
      task_type: request.taskType,
      status: TaskStatus.PENDING,
      assigned_agent_id: request.assignedAgentId,
      parent_task_id: request.parentTaskId,
      priority: request.priority || 1,
      description: request.description,
      requirements: request.requirements || {},
      results: {}
    };

    const task = this.taskRepo.create(taskData);
    
    // If assigned to an agent, update agent status
    if (request.assignedAgentId) {
      this.agentRepo.updateStatus(request.assignedAgentId, AgentStatus.ACTIVE);
    }

    return task;
  }

  getTask(taskId: string): Task | null {
    return this.taskRepo.findById(taskId);
  }

  listTasks(repositoryPath: string, status?: TaskStatus): Task[] {
    return this.taskRepo.findByRepositoryPath(repositoryPath, status);
  }

  getAgentTasks(agentId: string): Task[] {
    return this.taskRepo.findByAgentId(agentId);
  }

  getPendingTasks(repositoryPath: string): Task[] {
    return this.taskRepo.findPendingTasks(repositoryPath);
  }

  getReadyTasks(repositoryPath: string): Task[] {
    return this.taskRepo.findTasksReadyForExecution(repositoryPath);
  }

  updateTask(taskId: string, update: TaskUpdate): void {
    if (update.status) {
      this.taskRepo.updateStatus(taskId, update.status, update.results);
    }
    
    if (update.requirements) {
      this.taskRepo.updateRequirements(taskId, update.requirements);
    }
  }

  assignTask(taskId: string, agentId: string): void {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const agent = this.agentRepo.findById(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Assign task and update statuses
    this.taskRepo.assignToAgent(taskId, agentId);
    this.agentRepo.updateStatus(agentId, AgentStatus.ACTIVE);
  }

  completeTask(taskId: string, results?: Record<string, any>): void {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    this.taskRepo.updateStatus(taskId, TaskStatus.COMPLETED, results);
    
    // If task was assigned to an agent, update agent status
    if (task.assigned_agent_id) {
      // Check if agent has other pending tasks
      const agentTasks = this.taskRepo.findByAgentId(task.assigned_agent_id);
      const hasActiveTasks = agentTasks.some(t => 
        t.id !== taskId && (t.status === TaskStatus.PENDING || t.status === TaskStatus.IN_PROGRESS)
      );
      
      if (!hasActiveTasks) {
        this.agentRepo.updateStatus(task.assigned_agent_id, AgentStatus.IDLE);
      }
    }
  }

  failTask(taskId: string, error: string, results?: Record<string, any>): void {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const failureResults = {
      error,
      failedAt: new Date().toISOString(),
      ...results
    };

    this.taskRepo.updateStatus(taskId, TaskStatus.FAILED, failureResults);
    
    // Update agent status if assigned
    if (task.assigned_agent_id) {
      this.agentRepo.updateStatus(task.assigned_agent_id, AgentStatus.IDLE);
    }
  }

  addTaskDependency(taskId: string, dependsOnTaskId: string, dependencyType = 'completion'): void {
    // Validate both tasks exist
    const task = this.taskRepo.findById(taskId);
    const dependsOnTask = this.taskRepo.findById(dependsOnTaskId);
    
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    if (!dependsOnTask) {
      throw new Error(`Dependency task ${dependsOnTaskId} not found`);
    }

    // Check for circular dependencies
    if (this.wouldCreateCircularDependency(taskId, dependsOnTaskId)) {
      throw new Error('Adding dependency would create circular dependency');
    }

    this.taskRepo.addDependency(taskId, dependsOnTaskId, dependencyType);
  }

  removeTaskDependency(taskId: string, dependsOnTaskId: string): void {
    this.taskRepo.removeDependency(taskId, dependsOnTaskId);
  }

  getTaskDependencies(taskId: string): string[] {
    return this.taskRepo.getDependencies(taskId);
  }

  createExecutionPlan(repositoryPath: string): TaskExecutionPlan {
    const tasksWithDeps = this.taskRepo.findTasksWithDependencies(repositoryPath);
    const dependencies = new Map<string, string[]>();
    
    // Build dependency map
    for (const task of tasksWithDeps) {
      dependencies.set(task.id, task.dependencies);
    }

    // Topological sort for execution order
    const executionOrder = this.topologicalSort(tasksWithDeps.map(t => t.id), dependencies);
    
    return {
      tasks: tasksWithDeps,
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
    const parentTask = this.taskRepo.findById(parentTaskId);
    if (!parentTask) {
      throw new Error(`Parent task ${parentTaskId} not found`);
    }

    const createdTasks: Task[] = [];

    for (const subtaskData of subtasks) {
      const subtask = await this.createTask({
        repositoryPath: parentTask.repository_path,
        taskType: subtaskData.taskType,
        description: subtaskData.description,
        requirements: subtaskData.requirements,
        parentTaskId: parentTaskId,
        priority: parentTask.priority
      });

      // Add dependencies if specified
      if (subtaskData.dependencies) {
        for (const depId of subtaskData.dependencies) {
          this.addTaskDependency(subtask.id, depId);
        }
      }

      createdTasks.push(subtask);
    }

    return createdTasks;
  }

  getSubtasks(parentTaskId: string): Task[] {
    return this.taskRepo.findSubtasks(parentTaskId);
  }

  // Auto-assign tasks to available agents
  async autoAssignTasks(repositoryPath: string): Promise<Array<{taskId: string, agentId: string}>> {
    const readyTasks = this.getReadyTasks(repositoryPath);
    const availableAgents = this.agentRepo.findByRepositoryPath(repositoryPath, AgentStatus.IDLE);
    
    const assignments: Array<{taskId: string, agentId: string}> = [];

    // Simple round-robin assignment
    let agentIndex = 0;
    for (const task of readyTasks) {
      if (availableAgents.length === 0) break;
      
      const agent = availableAgents[agentIndex % availableAgents.length];
      this.assignTask(task.id, agent.id);
      
      assignments.push({
        taskId: task.id,
        agentId: agent.id
      });
      
      agentIndex++;
    }

    return assignments;
  }

  // Task progress and analytics
  getTaskProgress(repositoryPath: string): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    completionRate: number;
  } {
    const total = this.taskRepo.count(repositoryPath);
    const pending = this.taskRepo.count(repositoryPath, TaskStatus.PENDING);
    const inProgress = this.taskRepo.count(repositoryPath, TaskStatus.IN_PROGRESS);
    const completed = this.taskRepo.count(repositoryPath, TaskStatus.COMPLETED);
    const failed = this.taskRepo.count(repositoryPath, TaskStatus.FAILED);
    
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

  deleteTask(taskId: string): void {
    // Check if task has subtasks
    const subtasks = this.getSubtasks(taskId);
    if (subtasks.length > 0) {
      throw new Error('Cannot delete task with subtasks. Delete subtasks first.');
    }

    this.taskRepo.delete(taskId);
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private wouldCreateCircularDependency(taskId: string, dependsOnTaskId: string): boolean {
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
      const deps = this.taskRepo.getDependencies(currentId);
      stack.push(...deps);
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
    for (const [taskId, degree] of inDegree) {
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