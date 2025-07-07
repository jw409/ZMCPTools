import { ClaudeDatabase } from '../../database/index.js';
import { ChatRoom, ChatMessage } from '../../models/index.js';
import type { ChatRoomData, ChatMessageData } from '../../models/index.js';

export class CommunicationRepository {
  constructor(private db: ClaudeDatabase) {}

  // Room operations
  createRoom(data: Omit<ChatRoomData, 'created_at'>): ChatRoom {
    const stmt = this.db.database.prepare(`
      INSERT INTO chat_rooms (name, description, repository_path, created_at, room_metadata)
      VALUES (?, ?, ?, datetime('now'), ?)
    `);

    return this.db.transaction(() => {
      stmt.run(
        data.name,
        data.description,
        data.repository_path,
        data.room_metadata ? JSON.stringify(data.room_metadata) : null
      );
      
      return this.findRoomByName(data.name)!;
    });
  }

  findRoomByName(name: string): ChatRoom | null {
    const stmt = this.db.database.prepare('SELECT * FROM chat_rooms WHERE name = ?');
    const row = stmt.get(name) as any;
    
    if (!row) return null;
    
    return new ChatRoom({
      ...row,
      room_metadata: row.room_metadata ? JSON.parse(row.room_metadata) : {},
      created_at: new Date(row.created_at)
    });
  }

  findRoomsByRepository(repositoryPath: string): ChatRoom[] {
    const stmt = this.db.database.prepare(`
      SELECT * FROM chat_rooms 
      WHERE repository_path = ? 
      ORDER BY created_at DESC
    `);
    
    const rows = stmt.all(repositoryPath) as any[];
    return rows.map(row => new ChatRoom({
      ...row,
      room_metadata: row.room_metadata ? JSON.parse(row.room_metadata) : {},
      created_at: new Date(row.created_at)
    }));
  }

  updateRoomMetadata(name: string, metadata: Record<string, any>): void {
    const stmt = this.db.database.prepare(`
      UPDATE chat_rooms 
      SET room_metadata = ?
      WHERE name = ?
    `);
    stmt.run(JSON.stringify(metadata), name);
  }

  deleteRoom(name: string): void {
    this.db.transaction(() => {
      // Delete all messages in the room first
      const deleteMessagesStmt = this.db.database.prepare('DELETE FROM chat_messages WHERE room_name = ?');
      deleteMessagesStmt.run(name);
      
      // Delete the room
      const deleteRoomStmt = this.db.database.prepare('DELETE FROM chat_rooms WHERE name = ?');
      deleteRoomStmt.run(name);
    });
  }

  // Message operations
  sendMessage(data: Omit<ChatMessageData, 'timestamp'>): ChatMessage {
    const stmt = this.db.database.prepare(`
      INSERT INTO chat_messages (id, room_name, agent_name, message, timestamp, mentions, message_type)
      VALUES (?, ?, ?, ?, datetime('now'), ?, ?)
    `);

    return this.db.transaction(() => {
      stmt.run(
        data.id,
        data.room_name,
        data.agent_name,
        data.message,
        data.mentions ? JSON.stringify(data.mentions) : null,
        data.message_type
      );
      
      return this.findMessageById(data.id)!;
    });
  }

  findMessageById(id: string): ChatMessage | null {
    const stmt = this.db.database.prepare('SELECT * FROM chat_messages WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) return null;
    
    return this.mapMessageRow(row);
  }

  getMessages(roomName: string, limit = 100, sinceTimestamp?: Date): ChatMessage[] {
    let sql = 'SELECT * FROM chat_messages WHERE room_name = ?';
    const params: any[] = [roomName];
    
    if (sinceTimestamp) {
      sql += ' AND timestamp > ?';
      params.push(sinceTimestamp.toISOString());
    }
    
    sql += ' ORDER BY timestamp ASC LIMIT ?';
    params.push(limit);
    
    const stmt = this.db.database.prepare(sql);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => this.mapMessageRow(row));
  }

  getRecentMessages(roomName: string, limit = 50): ChatMessage[] {
    const stmt = this.db.database.prepare(`
      SELECT * FROM chat_messages 
      WHERE room_name = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    
    const rows = stmt.all(roomName, limit) as any[];
    // Reverse to get chronological order
    return rows.reverse().map(row => this.mapMessageRow(row));
  }

  findMessagesByAgent(agentName: string, limit = 100): ChatMessage[] {
    const stmt = this.db.database.prepare(`
      SELECT * FROM chat_messages 
      WHERE agent_name = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    
    const rows = stmt.all(agentName, limit) as any[];
    return rows.map(row => this.mapMessageRow(row));
  }

  findMessagesByMention(agentName: string, limit = 50): ChatMessage[] {
    const stmt = this.db.database.prepare(`
      SELECT * FROM chat_messages 
      WHERE mentions LIKE ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    
    const rows = stmt.all(`%"${agentName}"%`, limit) as any[];
    return rows.map(row => this.mapMessageRow(row));
  }

  searchMessages(roomName: string, query: string, limit = 50): ChatMessage[] {
    const stmt = this.db.database.prepare(`
      SELECT * FROM chat_messages 
      WHERE room_name = ? AND message LIKE ?
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    
    const rows = stmt.all(roomName, `%${query}%`, limit) as any[];
    return rows.map(row => this.mapMessageRow(row));
  }

  deleteMessage(id: string): void {
    const stmt = this.db.database.prepare('DELETE FROM chat_messages WHERE id = ?');
    stmt.run(id);
  }

  deleteOldMessages(roomName: string, olderThanDays: number): number {
    const stmt = this.db.database.prepare(`
      DELETE FROM chat_messages 
      WHERE room_name = ? 
        AND datetime(timestamp, '+' || ? || ' days') < datetime('now')
    `);
    
    const result = stmt.run(roomName, olderThanDays);
    return result.changes;
  }

  // Utility methods
  getRoomParticipants(roomName: string): string[] {
    const stmt = this.db.database.prepare(`
      SELECT DISTINCT agent_name 
      FROM chat_messages 
      WHERE room_name = ?
      ORDER BY agent_name
    `);
    
    const rows = stmt.all(roomName) as any[];
    return rows.map(row => row.agent_name);
  }

  getMessageCount(roomName: string): number {
    const stmt = this.db.database.prepare(`
      SELECT COUNT(*) as count 
      FROM chat_messages 
      WHERE room_name = ?
    `);
    
    const result = stmt.get(roomName) as any;
    return result.count;
  }

  // Wait for new messages (polling-based)
  async waitForMessages(
    roomName: string,
    sinceTimestamp?: Date,
    timeout = 30000
  ): Promise<ChatMessage[]> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkMessages = () => {
        const messages = this.getMessages(roomName, 10, sinceTimestamp);
        
        if (messages.length > 0) {
          resolve(messages);
          return;
        }

        if (Date.now() - startTime > timeout) {
          resolve([]);
          return;
        }

        // Poll again in 1 second
        setTimeout(checkMessages, 1000);
      };

      checkMessages();
    });
  }

  private mapMessageRow(row: any): ChatMessage {
    return new ChatMessage({
      ...row,
      mentions: row.mentions ? JSON.parse(row.mentions) : [],
      timestamp: new Date(row.timestamp)
    });
  }
}