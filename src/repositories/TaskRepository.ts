import { eq, and, or, isNull, isNotNull, desc } from 'drizzle-orm';
import { BaseRepository, createRepositoryConfig } from './index.js';
import { DatabaseManager } from '../database/index.js';
import {
  tasks,
  taskDependencies,
  insertTaskSchema,
  selectTaskSchema,
  updateTaskSchema,
  insertTaskDependencySchema,
  selectTaskDependencySchema,
  type Task,
  type NewTask,
  type TaskUpdate,
  type TaskDependency,
  type NewTaskDependency,
  type TaskStatus,
  type TaskType,
  type TaskFilter,
} from '../schemas/index.js';

/**
 * Repository for managing tasks with dependency tracking
 */
export class TaskRepository extends BaseRepository<
  typeof tasks,
  Task,
  NewTask,
  TaskUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      tasks,
      tasks.id,
      insertTaskSchema,
      selectTaskSchema,
      updateTaskSchema,
      'task-repository'
    ));
  }

  /**
   * Find tasks by repository path and optional filters
   */
  async findByRepositoryPath(
    repositoryPath: string, 
    options: {
      status?: TaskStatus;
      taskType?: TaskType;
      assignedAgentId?: string;
      includeSubtasks?: boolean;
    } = {}
  ): Promise<Task[]> {
    const conditions = [eq(tasks.repositoryPath, repositoryPath)];
    
    if (options.status) {
      conditions.push(eq(tasks.status, options.status));
    }
    
    if (options.taskType) {
      conditions.push(eq(tasks.taskType, options.taskType));
    }
    
    if (options.assignedAgentId) {
      conditions.push(eq(tasks.assignedAgentId, options.assignedAgentId));
    }
    
    if (!options.includeSubtasks) {
      conditions.push(isNull(tasks.parentTaskId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(tasks.priority, 'desc')
      .execute();
  }

  /**
   * Find subtasks for a parent task
   */
  async findSubtasks(parentTaskId: string): Promise<Task[]> {
    return this.query()
      .where(eq(tasks.parentTaskId, parentTaskId))
      .orderBy(tasks.priority, 'desc')
      .execute();
  }

  /**
   * Find root tasks (tasks without parent)
   */
  async findRootTasks(repositoryPath: string, status?: TaskStatus): Promise<Task[]> {
    const conditions = [
      eq(tasks.repositoryPath, repositoryPath),
      isNull(tasks.parentTaskId)
    ];
    
    if (status) {
      conditions.push(eq(tasks.status, status));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(tasks.priority, 'desc')
      .execute();
  }

  /**
   * Find tasks assigned to an agent
   */
  async findByAssignedAgent(agentId: string, status?: TaskStatus): Promise<Task[]> {
    const conditions = [eq(tasks.assignedAgentId, agentId)];
    
    if (status) {
      conditions.push(eq(tasks.status, status));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(tasks.priority, 'desc')
      .execute();
  }

  /**
   * Find unassigned tasks that are ready to be executed
   */
  async findAvailableTasks(repositoryPath: string): Promise<Task[]> {
    // Tasks that are pending, unassigned, and have no unfulfilled dependencies
    const pendingTasks = await this.query()
      .where(and(
        eq(tasks.repositoryPath, repositoryPath),
        eq(tasks.status, 'pending'),
        isNull(tasks.assignedAgentId)
      ))
      .execute();

    // Filter out tasks that have unresolved dependencies
    const availableTasks: Task[] = [];
    
    for (const task of pendingTasks) {
      const hasUnresolvedDeps = await this.hasUnresolvedDependencies(task.id);
      if (!hasUnresolvedDeps) {
        availableTasks.push(task);
      }
    }

    return availableTasks.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Check if a task has unresolved dependencies
   */
  async hasUnresolvedDependencies(taskId: string): Promise<boolean> {
    const dependencies = await this.drizzle
      .select({
        dependsOnTaskId: taskDependencies.dependsOnTaskId,
        status: tasks.status,
      })
      .from(taskDependencies)
      .innerJoin(tasks, eq(taskDependencies.dependsOnTaskId, tasks.id))
      .where(eq(taskDependencies.taskId, taskId));

    return dependencies.some(dep => dep.status !== 'completed');
  }

  /**
   * Add dependency between tasks
   */
  async addDependency(dependency: NewTaskDependency): Promise<TaskDependency> {
    try {
      // Validate input
      const validatedDependency = insertTaskDependencySchema.parse(dependency);
      
      // Check for circular dependencies
      const wouldCreateCycle = await this.wouldCreateCircularDependency(
        validatedDependency.taskId, 
        validatedDependency.dependsOnTaskId
      );
      
      if (wouldCreateCycle) {
        throw new Error('Adding this dependency would create a circular dependency');
      }

      this.logger.debug('Adding task dependency', dependency);
      
      return await this.drizzleManager.transaction(async (tx) => {
        const result = await tx
          .insert(taskDependencies)
          .values(validatedDependency as any)
          .returning();
        
        if (!result || result.length === 0) {
          throw new Error('Failed to create task dependency');
        }

        this.logger.info('Task dependency added successfully', dependency);
        return result[0] as TaskDependency;
      });
    } catch (error) {
      this.logger.error('Failed to add task dependency', { dependency, error });
      throw error;
    }
  }

  /**
   * Remove dependency between tasks
   */
  async removeDependency(taskId: string, dependsOnTaskId: string): Promise<boolean> {
    try {
      const result = await this.drizzle
        .delete(taskDependencies)
        .where(and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.dependsOnTaskId, dependsOnTaskId)
        ));

      const removed = result.changes > 0;
      
      if (removed) {
        this.logger.info('Task dependency removed successfully', { taskId, dependsOnTaskId });
      }
      
      return removed;
    } catch (error) {
      this.logger.error('Failed to remove task dependency', { taskId, dependsOnTaskId, error });
      throw error;
    }
  }

  /**
   * Get all dependencies for a task
   */
  async getDependencies(taskId: string): Promise<Task[]> {
    const dependencyTasks = await this.drizzle
      .select()
      .from(tasks)
      .innerJoin(taskDependencies, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(eq(taskDependencies.taskId, taskId));

    return dependencyTasks.map(row => row.tasks) as Task[];
  }

  /**
   * Get all tasks that depend on this task
   */
  async getDependents(taskId: string): Promise<Task[]> {
    const dependentTasks = await this.drizzle
      .select()
      .from(tasks)
      .innerJoin(taskDependencies, eq(tasks.id, taskDependencies.taskId))
      .where(eq(taskDependencies.dependsOnTaskId, taskId));

    return dependentTasks.map(row => row.tasks) as Task[];
  }

  /**
   * Check if adding a dependency would create a circular reference
   */
  private async wouldCreateCircularDependency(taskId: string, dependsOnTaskId: string): Promise<boolean> {
    // If the task depends on itself, that's obviously circular
    if (taskId === dependsOnTaskId) {
      return true;
    }

    // Check if dependsOnTaskId (transitively) depends on taskId
    const visited = new Set<string>();
    const stack = [dependsOnTaskId];

    while (stack.length > 0) {
      const currentTaskId = stack.pop()!;
      
      if (visited.has(currentTaskId)) {
        continue;
      }
      
      visited.add(currentTaskId);
      
      // If we reach the original taskId, we have a cycle
      if (currentTaskId === taskId) {
        return true;
      }

      // Get all tasks that currentTaskId depends on
      const dependencies = await this.drizzle
        .select({ dependsOnTaskId: taskDependencies.dependsOnTaskId })
        .from(taskDependencies)
        .where(eq(taskDependencies.taskId, currentTaskId));

      // Add them to the stack for further exploration
      for (const dep of dependencies) {
        if (!visited.has(dep.dependsOnTaskId)) {
          stack.push(dep.dependsOnTaskId);
        }
      }
    }

    return false;
  }

  /**
   * Update task status and handle dependent tasks
   */
  async updateStatus(taskId: string, status: TaskStatus, results?: Record<string, unknown> | string): Promise<Task | null> {
    return await this.drizzleManager.transaction(async () => {
      // Update the task status
      const updateData: TaskUpdate = {
        status,
        updatedAt: new Date().toISOString(),
      };
      
      if (results) {
        updateData.results = typeof results === 'string' ? { message: results } : results;
      }

      const updatedTask = await this.update(taskId, updateData);

      // If task is completed, check if any dependent tasks can now be started
      if (status === 'completed' && updatedTask) {
        await this.checkAndStartDependentTasks(taskId);
      }

      return updatedTask;
    });
  }

  /**
   * Check if dependent tasks can be started after a task completion
   */
  private async checkAndStartDependentTasks(completedTaskId: string): Promise<void> {
    const dependentTasks = await this.getDependents(completedTaskId);
    
    for (const dependentTask of dependentTasks) {
      if (dependentTask.status === 'pending') {
        const hasUnresolvedDeps = await this.hasUnresolvedDependencies(dependentTask.id);
        
        if (!hasUnresolvedDeps) {
          this.logger.info('Task dependencies resolved, task ready for assignment', {
            taskId: dependentTask.id,
            completedDependency: completedTaskId
          });
          
          // Optionally auto-assign to available agents or notify orchestrator
          // This depends on your specific workflow requirements
        }
      }
    }
  }

  /**
   * Get task hierarchy (task with all its subtasks)
   */
  async getTaskHierarchy(taskId: string): Promise<{
    task: Task;
    subtasks: Task[];
    dependencies: Task[];
    dependents: Task[];
  } | null> {
    const task = await this.findById(taskId);
    if (!task) {
      return null;
    }

    const [subtasks, dependencies, dependents] = await Promise.all([
      this.findSubtasks(taskId),
      this.getDependencies(taskId),
      this.getDependents(taskId)
    ]);

    return {
      task,
      subtasks,
      dependencies,
      dependents,
    };
  }

  /**
   * Advanced filtering with complex conditions
   */
  async findFiltered(filter: TaskFilter): Promise<{
    tasks: Task[];
    total: number;
    hasMore: boolean;
  }> {
    const conditions = [];

    if (filter.repositoryPath) {
      conditions.push(eq(tasks.repositoryPath, filter.repositoryPath));
    }

    if (filter.status) {
      if (Array.isArray(filter.status)) {
        conditions.push(or(...filter.status.map(s => eq(tasks.status, s))));
      } else {
        conditions.push(eq(tasks.status, filter.status));
      }
    }

    if (filter.taskType) {
      conditions.push(eq(tasks.taskType, filter.taskType));
    }

    if (filter.assignedAgentId) {
      conditions.push(eq(tasks.assignedAgentId, filter.assignedAgentId));
    }

    if (filter.unassignedOnly) {
      conditions.push(isNull(tasks.assignedAgentId));
    }

    if (filter.rootTasksOnly) {
      conditions.push(isNull(tasks.parentTaskId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions.length === 1 ? conditions[0] : undefined;

    const result = await this.list({
      where: whereClause,
      orderBy: [desc(tasks.priority), tasks.createdAt],
      limit: filter.limit,
      offset: filter.offset,
    });

    return {
      tasks: result.data,
      total: result.total,
      hasMore: result.hasMore,
    };
  }
}