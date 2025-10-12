import type { Tool } from '../schemas/tools/index.js';
import { z } from 'zod';
import { DatabaseManager } from '../database/index.js';
import { CommunicationService } from '../services/CommunicationService.js';
import { eventBus } from '../services/EventBus.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { eq, and, like } from 'drizzle-orm';
import {
  sharedTodos,
  agentProgress,
  artifactRegistry,
  chatRooms,
  roomParticipants,
  type InsertSharedTodo,
  type InsertAgentProgress,
  type InsertArtifactRegistry
} from '../schemas/index.js';

// Schemas for shared state tools
const TodoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
  priority: z.enum(['low', 'medium', 'high']),
  assignedAgent: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional()
});

const TodoWriteSchema = z.object({
  repositoryPath: z.string(),
  todos: z.array(TodoItemSchema)
});

const TodoReadSchema = z.object({
  repositoryPath: z.string(),
  filter: z.object({
    status: z.string().optional(),
    assignedAgent: z.string().optional(),
    includeCompleted: z.boolean().optional()
  }).optional()
});

const BroadcastProgressSchema = z.object({
  agentId: z.string(),
  taskId: z.string(),
  status: z.enum(['started', 'progress', 'completed', 'blocked', 'failed']),
  message: z.string(),
  progress: z.number().min(0).max(100).optional(),
  artifacts: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional()
});

const RegisterArtifactSchema = z.object({
  agentId: z.string(),
  artifactPath: z.string(),
  artifactType: z.enum(['document', 'code', 'config', 'data']),
  description: z.string(),
  relatedTasks: z.array(z.string()).optional()
});

export class SharedStateTools {
  private dbManager: DatabaseManager;
  private commService: CommunicationService;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
    this.commService = new CommunicationService(dbManager);
    // No need to manually initialize - Drizzle handles table creation via schema
  }

  getTools(): Tool[] {
    return [
      {
        name: 'todo_write',
        description: 'Write or update shared todos that all agents can see',
        inputSchema: zodToJsonSchema(TodoWriteSchema) as any,
        handler: this.todoWrite.bind(this)
      },
      {
        name: 'todo_read',
        description: 'Read shared todos with optional filtering',
        inputSchema: zodToJsonSchema(TodoReadSchema) as any,
        handler: this.todoRead.bind(this)
      },
      {
        name: 'broadcast_progress',
        description: 'Broadcast task progress to all agents in the repository',
        inputSchema: zodToJsonSchema(BroadcastProgressSchema) as any,
        handler: this.broadcastProgress.bind(this)
      },
      {
        name: 'register_artifact',
        description: 'Register created artifacts for discovery by other agents',
        inputSchema: zodToJsonSchema(RegisterArtifactSchema) as any,
        handler: this.registerArtifact.bind(this)
      }
    ];
  }

  private async todoWrite(input: z.infer<typeof TodoWriteSchema>) {
    const drizzle = this.dbManager.drizzle;
    const { repositoryPath, todos } = input;

    try {
      for (const todo of todos) {
        // Check if todo exists
        const existing = await drizzle
          .select()
          .from(sharedTodos)
          .where(eq(sharedTodos.id, todo.id))
          .get();

        if (existing) {
          // Update existing todo
          await drizzle
            .update(sharedTodos)
            .set({
              content: todo.content,
              status: todo.status,
              priority: todo.priority,
              assignedAgent: todo.assignedAgent || null,
              dependencies: JSON.stringify(todo.dependencies || []),
              artifacts: JSON.stringify(todo.artifacts || []),
              updatedAt: new Date().toISOString()
            })
            .where(eq(sharedTodos.id, todo.id))
            .run();
        } else {
          // Insert new todo
          const insertData: InsertSharedTodo = {
            id: todo.id,
            repositoryPath,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            assignedAgent: todo.assignedAgent || null,
            dependencies: JSON.stringify(todo.dependencies || []),
            artifacts: JSON.stringify(todo.artifacts || [])
          };
          await drizzle.insert(sharedTodos).values(insertData).run();
        }

        // Broadcast todo update to relevant rooms
        await this.broadcastTodoUpdate(repositoryPath, todo);
      }

      return {
        success: true,
        message: `Updated ${todos.length} todos`,
        data: { todos }
      };

    } catch (error) {
      throw error;
    }
  }

  private async todoRead(input: z.infer<typeof TodoReadSchema>) {
    const drizzle = this.dbManager.drizzle;
    const { repositoryPath, filter = {} } = input;

    // Build where conditions
    const conditions = [eq(sharedTodos.repositoryPath, repositoryPath)];

    if (filter.status) {
      conditions.push(eq(sharedTodos.status, filter.status));
    }

    if (filter.assignedAgent) {
      conditions.push(eq(sharedTodos.assignedAgent, filter.assignedAgent));
    }

    let query = drizzle
      .select()
      .from(sharedTodos)
      .where(and(...conditions));

    const rows = await query.all();

    const todos = rows
      .filter(row => filter.includeCompleted || row.status !== 'completed')
      .map(row => ({
        id: row.id,
        content: row.content,
        status: row.status,
        priority: row.priority,
        assignedAgent: row.assignedAgent,
        dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
        artifacts: row.artifacts ? JSON.parse(row.artifacts) : [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
      .sort((a, b) => {
        // Sort by priority DESC, then created_at ASC
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority as keyof typeof priorityOrder] - priorityOrder[a.priority as keyof typeof priorityOrder];
        return priorityDiff || (a.createdAt || '').localeCompare(b.createdAt || '');
      });

    return {
      success: true,
      data: { todos }
    };
  }

  private async broadcastProgress(input: z.infer<typeof BroadcastProgressSchema>) {
    const drizzle = this.dbManager.drizzle;
    const progressId = `prog_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Save progress to database
    const insertData: InsertAgentProgress = {
      id: progressId,
      agentId: input.agentId,
      taskId: input.taskId,
      status: input.status,
      message: input.message,
      progress: input.progress || null,
      artifacts: JSON.stringify(input.artifacts || []),
      blockers: JSON.stringify(input.blockers || []),
      nextSteps: JSON.stringify(input.nextSteps || [])
    };
    await drizzle.insert(agentProgress).values(insertData).run();

    // Get agent's rooms and broadcast
    const rooms = await this.getAgentRooms(input.agentId);
    
    for (const room of rooms) {
      await this.commService.sendMessage({
        roomName: room.name,
        agentName: input.agentId,
        message: `[PROGRESS] ${input.status.toUpperCase()}: ${input.message}${input.progress ? ` (${input.progress}%)` : ''}`,
        messageType: 'progress'
      });
    }

    // Emit event for monitoring
    eventBus.emit('progress_update', {
      contextId: input.taskId,
      contextType: 'task',
      agentId: input.agentId,
      actualProgress: input.progress || 0,
      reportedProgress: input.progress || 0,
      message: input.message,
      timestamp: new Date(),
      repositoryPath: ''  // Will be filled by the event handler
    });

    // If completed, check for dependent tasks
    if (input.status === 'completed') {
      await this.notifyDependentTasks(input.taskId);
    }

    return {
      success: true,
      message: 'Progress broadcast successfully',
      data: { progressId }
    };
  }

  private async registerArtifact(input: z.infer<typeof RegisterArtifactSchema>) {
    const drizzle = this.dbManager.drizzle;
    const artifactId = `art_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const insertData: InsertArtifactRegistry = {
      id: artifactId,
      agentId: input.agentId,
      artifactPath: input.artifactPath,
      artifactType: input.artifactType,
      description: input.description,
      relatedTasks: JSON.stringify(input.relatedTasks || [])
    };
    await drizzle.insert(artifactRegistry).values(insertData).run();

    // Broadcast artifact creation
    const rooms = await this.getAgentRooms(input.agentId);
    
    for (const room of rooms) {
      await this.commService.sendMessage({
        roomName: room.name,
        agentName: input.agentId,
        message: `[ARTIFACT] Created ${input.artifactType}: ${input.artifactPath} - ${input.description}`,
        messageType: 'artifact'
      });
    }

    return {
      success: true,
      message: 'Artifact registered successfully',
      data: { artifactId, artifactPath: input.artifactPath }
    };
  }

  private async broadcastTodoUpdate(repositoryPath: string, todo: any) {
    // Find all rooms for this repository
    const drizzle = this.dbManager.drizzle;
    const rooms = await drizzle
      .selectDistinct({ name: chatRooms.name })
      .from(chatRooms)
      .where(eq(chatRooms.repositoryPath, repositoryPath))
      .all();

    for (const room of rooms) {
      if (room.name.includes('coordination')) {
        await this.commService.sendMessage({
          roomName: room.name,
          agentName: 'SYSTEM',
          message: `[TODO UPDATE] ${todo.content} - Status: ${todo.status}${todo.assignedAgent ? ` (Assigned: ${todo.assignedAgent})` : ''}`,
          messageType: 'system'
        });
      }
    }
  }

  private async getAgentRooms(agentId: string): Promise<any[]> {
    const drizzle = this.dbManager.drizzle;
    const results = await drizzle
      .selectDistinct()
      .from(chatRooms)
      .innerJoin(roomParticipants, eq(chatRooms.id, roomParticipants.roomId))
      .where(eq(roomParticipants.agentId, agentId))
      .all();

    // Extract just the chatRooms data from the joined results
    return results.map(row => row.chat_rooms);
  }

  private async notifyDependentTasks(completedTaskId: string) {
    const drizzle = this.dbManager.drizzle;

    // Find todos that depend on this task
    const dependentTodos = await drizzle
      .select()
      .from(sharedTodos)
      .where(
        and(
          like(sharedTodos.dependencies, `%"${completedTaskId}"%`),
          eq(sharedTodos.status, 'pending')
        )
      )
      .all();

    for (const todo of dependentTodos) {
      const deps = todo.dependencies ? JSON.parse(todo.dependencies) : [];

      // Check if all dependencies are complete
      const allDepsComplete = await this.checkAllDependenciesComplete(deps);

      if (allDepsComplete && todo.assignedAgent) {
        // Notify the assigned agent
        const rooms = await this.getAgentRooms(todo.assignedAgent);
        for (const room of rooms) {
          await this.commService.sendMessage({
            roomName: room.name,
            agentName: 'SYSTEM',
            message: `[READY] Task "${todo.content}" is now ready - all dependencies complete!`,
            messageType: 'system'
          });
        }
      }
    }
  }

  private async checkAllDependenciesComplete(dependencies: string[]): Promise<boolean> {
    const drizzle = this.dbManager.drizzle;

    for (const dep of dependencies) {
      const todo = await drizzle
        .select({ status: sharedTodos.status })
        .from(sharedTodos)
        .where(eq(sharedTodos.id, dep))
        .get();

      if (!todo || todo.status !== 'completed') {
        return false;
      }
    }

    return true;
  }
}