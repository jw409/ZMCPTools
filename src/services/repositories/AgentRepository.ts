import { ClaudeDatabase } from '../../database/index.js';
import { AgentSession, AgentStatus } from '../../models/index.js';
import type { AgentSessionData } from '../../models/index.js';

export class AgentRepository {
  constructor(private db: ClaudeDatabase) {}

  create(data: Omit<AgentSessionData, 'created_at' | 'last_heartbeat'>): AgentSession {
    const stmt = this.db.database.prepare(`
      INSERT INTO agent_sessions (
        id, agent_name, repository_path, status, claude_pid, 
        capabilities, created_at, last_heartbeat, agent_metadata
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
    `);

    return this.db.transaction(() => {
      stmt.run(
        data.id,
        data.agent_name,
        data.repository_path,
        data.status,
        data.claude_pid,
        data.capabilities ? JSON.stringify(data.capabilities) : null,
        data.agent_metadata ? JSON.stringify(data.agent_metadata) : null
      );
      
      return this.findById(data.id)!;
    });
  }

  findById(id: string): AgentSession | null {
    const stmt = this.db.database.prepare('SELECT * FROM agent_sessions WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    
    return new AgentSession({
      ...row,
      capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
      agent_metadata: row.agent_metadata ? JSON.parse(row.agent_metadata) : {},
      created_at: new Date(row.created_at),
      last_heartbeat: new Date(row.last_heartbeat)
    });
  }

  findByRepositoryPath(repositoryPath: string, status?: AgentStatus): AgentSession[] {
    let sql = 'SELECT * FROM agent_sessions WHERE repository_path = ?';
    const params: any[] = [repositoryPath];
    
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    
    sql += ' ORDER BY last_heartbeat DESC';
    
    const stmt = this.db.database.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return this.mapRows(rows);
  }

  findByPid(pid: number): AgentSession | null {
    const stmt = this.db.database.prepare('SELECT * FROM agent_sessions WHERE claude_pid = ?');
    const row = stmt.get(pid) as any;
    
    if (!row) return null;
    
    return this.mapRow(row);
  }

  updateStatus(id: string, status: AgentStatus): void {
    const stmt = this.db.database.prepare(`
      UPDATE agent_sessions 
      SET status = ?, last_heartbeat = datetime('now') 
      WHERE id = ?
    `);
    stmt.run(status, id);
  }

  updateHeartbeat(id: string): void {
    const stmt = this.db.database.prepare(`
      UPDATE agent_sessions 
      SET last_heartbeat = datetime('now') 
      WHERE id = ?
    `);
    stmt.run(id);
  }

  updateMetadata(id: string, metadata: Record<string, any>): void {
    const stmt = this.db.database.prepare(`
      UPDATE agent_sessions 
      SET agent_metadata = ?, last_heartbeat = datetime('now')
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(metadata), id);
  }

  findStaleAgents(staleMinutes = 30): AgentSession[] {
    const stmt = this.db.database.prepare(`
      SELECT * FROM agent_sessions 
      WHERE status IN ('active', 'idle') 
        AND datetime(last_heartbeat, '+' || ? || ' minutes') < datetime('now')
      ORDER BY last_heartbeat ASC
    `);
    
    const rows = stmt.all(staleMinutes) as any[];
    return this.mapRows(rows);
  }

  delete(id: string): void {
    const stmt = this.db.database.prepare('DELETE FROM agent_sessions WHERE id = ?');
    stmt.run(id);
  }

  count(repositoryPath?: string, status?: AgentStatus): number {
    let sql = 'SELECT COUNT(*) as count FROM agent_sessions';
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

  private mapRows(rows: any[]): AgentSession[] {
    return rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): AgentSession {
    return new AgentSession({
      ...row,
      capabilities: row.capabilities ? JSON.parse(row.capabilities) : [],
      agent_metadata: row.agent_metadata ? JSON.parse(row.agent_metadata) : {},
      created_at: new Date(row.created_at),
      last_heartbeat: new Date(row.last_heartbeat)
    });
  }
}