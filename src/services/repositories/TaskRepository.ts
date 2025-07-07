import { ClaudeDatabase } from '../../database/index.js';
import { Task, TaskStatus } from '../../models/index.js';
import type { TaskData } from '../../models/index.js';

export class TaskRepository {
  constructor(private db: ClaudeDatabase) {}

  create(data: Omit<TaskData, 'created_at' | 'updated_at'>): Task {
    const stmt = this.db.database.prepare(`
      INSERT INTO tasks (
        id, repository_path, task_type, status, assigned_agent_id,
        parent_task_id, priority, description, requirements, results,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    return this.db.transaction(() => {
      stmt.run(
        data.id,
        data.repository_path,
        data.task_type,
        data.status,
        data.assigned_agent_id,
        data.parent_task_id,
        data.priority,
        data.description,
        data.requirements ? JSON.stringify(data.requirements) : null,
        data.results ? JSON.stringify(data.results) : null
      );
      
      return this.findById(data.id)!;
    });
  }

  findById(id: string): Task | null {
    const stmt = this.db.database.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    
    return this.mapRow(row);
  }

  findByRepositoryPath(repositoryPath: string, status?: TaskStatus): Task[] {
    let sql = 'SELECT * FROM tasks WHERE repository_path = ?';
    const params: any[] = [repositoryPath];
    
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    
    sql += ' ORDER BY priority DESC, created_at ASC';
    
    const stmt = this.db.database.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return this.mapRows(rows);
  }

  findByAgentId(agentId: string): Task[] {
    const stmt = this.db.database.prepare(`
      SELECT * FROM tasks 
      WHERE assigned_agent_id = ? 
      ORDER BY priority DESC, created_at ASC
    `);
    
    const rows = stmt.all(agentId) as any[];
    return this.mapRows(rows);
  }

  findPendingTasks(repositoryPath: string): Task[] {
    const stmt = this.db.database.prepare(`
      SELECT * FROM tasks 
      WHERE repository_path = ? AND status = ?
      ORDER BY priority DESC, created_at ASC
    `);
    
    const rows = stmt.all(repositoryPath, TaskStatus.PENDING) as any[];
    return this.mapRows(rows);
  }

  findTasksWithDependencies(repositoryPath: string): Array<Task & { dependencies: string[] }> {
    const stmt = this.db.database.prepare(`
      SELECT 
        t.*,
        GROUP_CONCAT(td.depends_on_task_id) as dependency_ids
      FROM tasks t
      LEFT JOIN task_dependencies td ON t.id = td.task_id
      WHERE t.repository_path = ?
      GROUP BY t.id
      ORDER BY t.priority DESC
    `);
    
    const rows = stmt.all(repositoryPath) as any[];
    
    return rows.map(row => ({
      ...this.mapRow(row),
      dependencies: row.dependency_ids ? row.dependency_ids.split(',') : []
    }));
  }

  findSubtasks(parentTaskId: string): Task[] {
    const stmt = this.db.database.prepare(`
      SELECT * FROM tasks 
      WHERE parent_task_id = ? 
      ORDER BY priority DESC, created_at ASC
    `);
    
    const rows = stmt.all(parentTaskId) as any[];
    return this.mapRows(rows);
  }

  updateStatus(id: string, status: TaskStatus, results?: Record<string, any>): void {
    let sql = 'UPDATE tasks SET status = ?, updated_at = datetime(\'now\')';
    const params: any[] = [status];
    
    if (results) {
      sql += ', results = ?';
      params.push(JSON.stringify(results));
    }
    
    sql += ' WHERE id = ?';
    params.push(id);
    
    const stmt = this.db.database.prepare(sql);
    stmt.run(...params);
  }

  assignToAgent(taskId: string, agentId: string): void {
    const stmt = this.db.database.prepare(`
      UPDATE tasks 
      SET assigned_agent_id = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(agentId, TaskStatus.IN_PROGRESS, taskId);
  }

  updateRequirements(id: string, requirements: Record<string, any>): void {
    const stmt = this.db.database.prepare(`
      UPDATE tasks 
      SET requirements = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(requirements), id);
  }

  addDependency(taskId: string, dependsOnTaskId: string, dependencyType = 'completion'): void {
    const stmt = this.db.database.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id, dependency_type)
      VALUES (?, ?, ?)
    `);
    stmt.run(taskId, dependsOnTaskId, dependencyType);
  }

  removeDependency(taskId: string, dependsOnTaskId: string): void {
    const stmt = this.db.database.prepare(`
      DELETE FROM task_dependencies 
      WHERE task_id = ? AND depends_on_task_id = ?
    `);
    stmt.run(taskId, dependsOnTaskId);
  }

  getDependencies(taskId: string): string[] {
    const stmt = this.db.database.prepare(`
      SELECT depends_on_task_id 
      FROM task_dependencies 
      WHERE task_id = ?
    `);
    
    const rows = stmt.all(taskId) as any[];
    return rows.map(row => row.depends_on_task_id);
  }

  findTasksReadyForExecution(repositoryPath: string): Task[] {
    // Find pending tasks where all dependencies are completed
    const stmt = this.db.database.prepare(`
      SELECT DISTINCT t.*
      FROM tasks t
      LEFT JOIN task_dependencies td ON t.id = td.task_id
      LEFT JOIN tasks dep_task ON td.depends_on_task_id = dep_task.id
      WHERE t.repository_path = ? 
        AND t.status = ?
        AND (td.task_id IS NULL OR dep_task.status = ?)
      GROUP BY t.id
      HAVING COUNT(td.task_id) = COUNT(CASE WHEN dep_task.status = ? THEN 1 END)
      ORDER BY t.priority DESC, t.created_at ASC
    `);
    
    const rows = stmt.all(repositoryPath, TaskStatus.PENDING, TaskStatus.COMPLETED, TaskStatus.COMPLETED) as any[];
    return this.mapRows(rows);
  }

  delete(id: string): void {
    this.db.transaction(() => {
      // Delete dependencies first
      const deleteDepsStmt = this.db.database.prepare(`
        DELETE FROM task_dependencies 
        WHERE task_id = ? OR depends_on_task_id = ?
      `);
      deleteDepsStmt.run(id, id);
      
      // Delete the task
      const deleteTaskStmt = this.db.database.prepare('DELETE FROM tasks WHERE id = ?');
      deleteTaskStmt.run(id);
    });
  }

  count(repositoryPath?: string, status?: TaskStatus): number {
    let sql = 'SELECT COUNT(*) as count FROM tasks';
    const params: any[] = [];
    const conditions: string[] = [];
    
    if (repositoryPath) {
      conditions.push('repository_path = ?');
      params.push(repositoryPath);
    }
    
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    const stmt = this.db.database.prepare(sql);
    const result = stmt.get(...params) as any;
    return result.count;
  }

  private mapRows(rows: any[]): Task[] {
    return rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): Task {
    return new Task({
      ...row,
      requirements: row.requirements ? JSON.parse(row.requirements) : {},
      results: row.results ? JSON.parse(row.results) : {},
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    });
  }
}