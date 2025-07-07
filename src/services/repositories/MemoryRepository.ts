import { ClaudeDatabase } from '../../database/index.js';
import { Memory, MemoryType } from '../../models/index.js';
import type { MemoryData } from '../../models/index.js';

export class MemoryRepository {
  constructor(private db: ClaudeDatabase) {}

  create(data: Omit<MemoryData, 'created_at'>): Memory {
    const stmt = this.db.database.prepare(`
      INSERT INTO memories (
        id, repository_path, agent_name, memory_type, title, 
        content, metadata, tags, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    return this.db.transaction(() => {
      stmt.run(
        data.id,
        data.repository_path,
        data.agent_name,
        data.memory_type,
        data.title,
        data.content,
        JSON.stringify(data.metadata || {}),
        JSON.stringify(data.tags || [])
      );
      
      return this.findById(data.id)!;
    });
  }

  findById(id: string): Memory | null {
    const stmt = this.db.database.prepare('SELECT * FROM memories WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    
    return this.mapRow(row);
  }

  findByRepositoryPath(repositoryPath: string, memoryType?: MemoryType): Memory[] {
    let sql = 'SELECT * FROM memories WHERE repository_path = ?';
    const params: any[] = [repositoryPath];
    
    if (memoryType) {
      sql += ' AND memory_type = ?';
      params.push(memoryType);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const stmt = this.db.database.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return this.mapRows(rows);
  }

  findByAgent(agentName: string, repositoryPath?: string): Memory[] {
    let sql = 'SELECT * FROM memories WHERE agent_name = ?';
    const params: any[] = [agentName];
    
    if (repositoryPath) {
      sql += ' AND repository_path = ?';
      params.push(repositoryPath);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const stmt = this.db.database.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return this.mapRows(rows);
  }

  findByType(memoryType: MemoryType, repositoryPath?: string): Memory[] {
    let sql = 'SELECT * FROM memories WHERE memory_type = ?';
    const params: any[] = [memoryType];
    
    if (repositoryPath) {
      sql += ' AND repository_path = ?';
      params.push(repositoryPath);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const stmt = this.db.database.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return this.mapRows(rows);
  }

  findByTags(tags: string[], repositoryPath?: string): Memory[] {
    let sql = 'SELECT * FROM memories WHERE ';
    const params: any[] = [];
    
    // Build tag search conditions
    const tagConditions = tags.map(() => 'tags LIKE ?').join(' OR ');
    sql += `(${tagConditions})`;
    
    for (const tag of tags) {
      params.push(`%"${tag}"%`);
    }
    
    if (repositoryPath) {
      sql += ' AND repository_path = ?';
      params.push(repositoryPath);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const stmt = this.db.database.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return this.mapRows(rows);
  }

  searchContent(query: string, repositoryPath?: string, memoryType?: MemoryType): Memory[] {
    let sql = `
      SELECT * FROM memories 
      WHERE (title LIKE ? OR content LIKE ?)
    `;
    const params: any[] = [`%${query}%`, `%${query}%`];
    
    if (repositoryPath) {
      sql += ' AND repository_path = ?';
      params.push(repositoryPath);
    }
    
    if (memoryType) {
      sql += ' AND memory_type = ?';
      params.push(memoryType);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const stmt = this.db.database.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return this.mapRows(rows);
  }

  updateContent(id: string, title: string, content: string): void {
    const stmt = this.db.database.prepare(`
      UPDATE memories 
      SET title = ?, content = ?
      WHERE id = ?
    `);
    stmt.run(title, content, id);
  }

  updateMetadata(id: string, metadata: Record<string, any>): void {
    const stmt = this.db.database.prepare(`
      UPDATE memories 
      SET metadata = ?
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(metadata), id);
  }

  updateTags(id: string, tags: string[]): void {
    const stmt = this.db.database.prepare(`
      UPDATE memories 
      SET tags = ?
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(tags), id);
  }

  addTag(id: string, tag: string): void {
    const memory = this.findById(id);
    if (!memory) {
      throw new Error(`Memory ${id} not found`);
    }

    const currentTags = memory.tags || [];
    if (!currentTags.includes(tag)) {
      const newTags = [...currentTags, tag];
      this.updateTags(id, newTags);
    }
  }

  removeTag(id: string, tag: string): void {
    const memory = this.findById(id);
    if (!memory) {
      throw new Error(`Memory ${id} not found`);
    }

    const currentTags = memory.tags || [];
    const newTags = currentTags.filter(t => t !== tag);
    this.updateTags(id, newTags);
  }

  delete(id: string): void {
    const stmt = this.db.database.prepare('DELETE FROM memories WHERE id = ?');
    stmt.run(id);
  }

  deleteByAgent(agentName: string, repositoryPath?: string): number {
    let sql = 'DELETE FROM memories WHERE agent_name = ?';
    const params: any[] = [agentName];
    
    if (repositoryPath) {
      sql += ' AND repository_path = ?';
      params.push(repositoryPath);
    }
    
    const stmt = this.db.database.prepare(sql);
    const result = stmt.run(...params);
    return result.changes;
  }

  deleteOld(repositoryPath: string, olderThanDays: number): number {
    const stmt = this.db.database.prepare(`
      DELETE FROM memories 
      WHERE repository_path = ? 
        AND datetime(created_at, '+' || ? || ' days') < datetime('now')
    `);
    
    const result = stmt.run(repositoryPath, olderThanDays);
    return result.changes;
  }

  count(repositoryPath?: string, memoryType?: MemoryType): number {
    let sql = 'SELECT COUNT(*) as count FROM memories';
    const params: any[] = [];
    const conditions: string[] = [];
    
    if (repositoryPath) {
      conditions.push('repository_path = ?');
      params.push(repositoryPath);
    }
    
    if (memoryType) {
      conditions.push('memory_type = ?');
      params.push(memoryType);
    }
    
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    const stmt = this.db.database.prepare(sql);
    const result = stmt.get(...params) as any;
    return result.count;
  }

  // Get unique tags for a repository
  getUniqueTags(repositoryPath?: string): string[] {
    let sql = 'SELECT DISTINCT tags FROM memories WHERE tags IS NOT NULL';
    const params: any[] = [];
    
    if (repositoryPath) {
      sql += ' AND repository_path = ?';
      params.push(repositoryPath);
    }
    
    const stmt = this.db.database.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    const allTags = new Set<string>();
    for (const row of rows) {
      if (row.tags) {
        const tags = JSON.parse(row.tags) as string[];
        tags.forEach(tag => allTags.add(tag));
      }
    }
    
    return Array.from(allTags).sort();
  }

  // Get memory statistics
  getStats(repositoryPath?: string): {
    total: number;
    byType: Record<string, number>;
    byAgent: Record<string, number>;
    recentCount: number; // Last 24 hours
  } {
    let baseWhere = '';
    const params: any[] = [];
    
    if (repositoryPath) {
      baseWhere = 'WHERE repository_path = ?';
      params.push(repositoryPath);
    }
    
    // Total count
    const totalStmt = this.db.database.prepare(`SELECT COUNT(*) as count FROM memories ${baseWhere}`);
    const totalResult = totalStmt.get(...params) as any;
    const total = totalResult.count;
    
    // Count by type
    const typeStmt = this.db.database.prepare(`
      SELECT memory_type, COUNT(*) as count 
      FROM memories ${baseWhere}
      GROUP BY memory_type
    `);
    const typeRows = typeStmt.all(...params) as any[];
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.memory_type] = row.count;
    }
    
    // Count by agent
    const agentStmt = this.db.database.prepare(`
      SELECT agent_name, COUNT(*) as count 
      FROM memories ${baseWhere}
      GROUP BY agent_name
    `);
    const agentRows = agentStmt.all(...params) as any[];
    const byAgent: Record<string, number> = {};
    for (const row of agentRows) {
      byAgent[row.agent_name] = row.count;
    }
    
    // Recent count (last 24 hours)
    const recentWhere = baseWhere 
      ? `${baseWhere} AND datetime(created_at) > datetime('now', '-1 day')`
      : `WHERE datetime(created_at) > datetime('now', '-1 day')`;
    
    const recentStmt = this.db.database.prepare(`SELECT COUNT(*) as count FROM memories ${recentWhere}`);
    const recentResult = recentStmt.get(...params) as any;
    const recentCount = recentResult.count;
    
    return {
      total,
      byType,
      byAgent,
      recentCount
    };
  }

  private mapRows(rows: any[]): Memory[] {
    return rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): Memory {
    return new Memory({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      tags: row.tags ? JSON.parse(row.tags) : [],
      created_at: new Date(row.created_at)
    });
  }
}