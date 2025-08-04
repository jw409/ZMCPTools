import { Tool } from '../schemas/tools.js';
import { z } from 'zod';
import { DatabaseManager } from '../database/index.js';
import { CommunicationService } from '../services/CommunicationService.js';
import { eventBus } from '../services/EventBus.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

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
    this.initializeDatabase();
  }

  private async initializeDatabase() {
    const db = await this.dbManager.getDatabase();
    
    // Create shared todos table
    await db.run(`
      CREATE TABLE IF NOT EXISTS shared_todos (
        id TEXT PRIMARY KEY,
        repository_path TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        assigned_agent TEXT,
        dependencies TEXT,
        artifacts TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create agent progress table
    await db.run(`
      CREATE TABLE IF NOT EXISTS agent_progress (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        progress INTEGER,
        artifacts TEXT,
        blockers TEXT,
        next_steps TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create artifact registry
    await db.run(`
      CREATE TABLE IF NOT EXISTS artifact_registry (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        description TEXT NOT NULL,
        related_tasks TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  getTools(): Tool[] {
    return [
      {
        name: 'mcp__zmcp-tools__todo_write',
        description: 'Write or update shared todos that all agents can see',
        inputSchema: zodToJsonSchema(TodoWriteSchema),
        handler: this.todoWrite.bind(this)
      },
      {
        name: 'mcp__zmcp-tools__todo_read',
        description: 'Read shared todos with optional filtering',
        inputSchema: zodToJsonSchema(TodoReadSchema),
        handler: this.todoRead.bind(this)
      },
      {
        name: 'mcp__zmcp-tools__broadcast_progress',
        description: 'Broadcast task progress to all agents in the repository',
        inputSchema: zodToJsonSchema(BroadcastProgressSchema),
        handler: this.broadcastProgress.bind(this)
      },
      {
        name: 'mcp__zmcp-tools__register_artifact',
        description: 'Register created artifacts for discovery by other agents',
        inputSchema: zodToJsonSchema(RegisterArtifactSchema),
        handler: this.registerArtifact.bind(this)
      }
    ];
  }

  private async todoWrite(input: z.infer<typeof TodoWriteSchema>) {
    const db = await this.dbManager.getDatabase();
    const { repositoryPath, todos } = input;

    try {
      // Start transaction
      await db.run('BEGIN TRANSACTION');

      for (const todo of todos) {
        // Check if todo exists
        const existing = await db.get(
          'SELECT id FROM shared_todos WHERE id = ?',
          todo.id
        );

        if (existing) {
          // Update existing todo
          await db.run(`
            UPDATE shared_todos 
            SET content = ?, status = ?, priority = ?, 
                assigned_agent = ?, dependencies = ?, artifacts = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, 
            todo.content,
            todo.status,
            todo.priority,
            todo.assignedAgent || null,
            JSON.stringify(todo.dependencies || []),
            JSON.stringify(todo.artifacts || []),
            todo.id
          );
        } else {
          // Insert new todo
          await db.run(`
            INSERT INTO shared_todos 
            (id, repository_path, content, status, priority, assigned_agent, dependencies, artifacts)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
            todo.id,
            repositoryPath,
            todo.content,
            todo.status,
            todo.priority,
            todo.assignedAgent || null,
            JSON.stringify(todo.dependencies || []),
            JSON.stringify(todo.artifacts || [])
          );
        }

        // Broadcast todo update to relevant rooms
        await this.broadcastTodoUpdate(repositoryPath, todo);
      }

      await db.run('COMMIT');

      return {
        success: true,
        message: `Updated ${todos.length} todos`,
        data: { todos }
      };

    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }

  private async todoRead(input: z.infer<typeof TodoReadSchema>) {
    const db = await this.dbManager.getDatabase();
    const { repositoryPath, filter = {} } = input;

    let query = 'SELECT * FROM shared_todos WHERE repository_path = ?';
    const params: any[] = [repositoryPath];

    if (filter.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }

    if (filter.assignedAgent) {
      query += ' AND assigned_agent = ?';
      params.push(filter.assignedAgent);
    }

    if (!filter.includeCompleted) {
      query += ' AND status != "completed"';
    }

    query += ' ORDER BY priority DESC, created_at ASC';

    const rows = await db.all(query, ...params);

    const todos = rows.map(row => ({
      id: row.id,
      content: row.content,
      status: row.status,
      priority: row.priority,
      assignedAgent: row.assigned_agent,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      artifacts: row.artifacts ? JSON.parse(row.artifacts) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return {
      success: true,
      data: { todos }
    };
  }

  private async broadcastProgress(input: z.infer<typeof BroadcastProgressSchema>) {
    const db = await this.dbManager.getDatabase();
    const progressId = `prog_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Save progress to database
    await db.run(`
      INSERT INTO agent_progress 
      (id, agent_id, task_id, status, message, progress, artifacts, blockers, next_steps)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      progressId,
      input.agentId,
      input.taskId,
      input.status,
      input.message,
      input.progress || null,
      JSON.stringify(input.artifacts || []),
      JSON.stringify(input.blockers || []),
      JSON.stringify(input.nextSteps || [])
    );

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
    eventBus.emit('agent:progress', {
      agentId: input.agentId,
      taskId: input.taskId,
      status: input.status,
      progress: input.progress
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
    const db = await this.dbManager.getDatabase();
    const artifactId = `art_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.run(`
      INSERT INTO artifact_registry
      (id, agent_id, artifact_path, artifact_type, description, related_tasks)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      artifactId,
      input.agentId,
      input.artifactPath,
      input.artifactType,
      input.description,
      JSON.stringify(input.relatedTasks || [])
    );

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
    const db = await this.dbManager.getDatabase();
    const rooms = await db.all(
      'SELECT DISTINCT name FROM chat_rooms WHERE repositoryPath = ?',
      repositoryPath
    );

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
    const db = await this.dbManager.getDatabase();
    return db.all(`
      SELECT DISTINCT cr.* 
      FROM chat_rooms cr
      JOIN room_participants rp ON cr.id = rp.roomId
      WHERE rp.agentId = ?
    `, agentId);
  }

  private async notifyDependentTasks(completedTaskId: string) {
    const db = await this.dbManager.getDatabase();
    
    // Find todos that depend on this task
    const dependentTodos = await db.all(`
      SELECT * FROM shared_todos 
      WHERE dependencies LIKE ? 
      AND status = 'pending'
    `, `%"${completedTaskId}"%`);

    for (const todo of dependentTodos) {
      const deps = JSON.parse(todo.dependencies);
      
      // Check if all dependencies are complete
      const allDepsComplete = await this.checkAllDependenciesComplete(deps);
      
      if (allDepsComplete && todo.assigned_agent) {
        // Notify the assigned agent
        const rooms = await this.getAgentRooms(todo.assigned_agent);
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
    const db = await this.dbManager.getDatabase();
    
    for (const dep of dependencies) {
      const todo = await db.get(
        'SELECT status FROM shared_todos WHERE id = ?',
        dep
      );
      
      if (!todo || todo.status !== 'completed') {
        return false;
      }
    }
    
    return true;
  }
}