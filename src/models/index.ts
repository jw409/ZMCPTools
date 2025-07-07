// Enum definitions with case-insensitive matching
export enum AgentStatus {
  ACTIVE = 'active',
  IDLE = 'idle', 
  COMPLETED = 'completed',
  TERMINATED = 'terminated'
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum TaskType {
  FEATURE = 'feature',
  BUG_FIX = 'bug_fix',
  REFACTOR = 'refactor',
  DOCUMENTATION = 'documentation',
  TESTING = 'testing',
  DEPLOYMENT = 'deployment'
}

export enum MemoryType {
  INSIGHT = 'insight',
  ERROR_LOG = 'error_log',
  DECISION = 'decision',
  PROGRESS = 'progress',
  SHARED = 'shared'
}

export enum MessageType {
  STANDARD = 'standard',
  SYSTEM = 'system',
  STATUS = 'status',
  BROADCAST = 'broadcast'
}

export enum DocumentationStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS', 
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  PAUSED = 'PAUSED',
  STALE = 'STALE'
}

// Case-insensitive enum parser
export function parseEnum<T extends Record<string, string>>(
  enumObject: T, 
  value: string
): T[keyof T] | null {
  const normalizedValue = value.toLowerCase().replace(/[-_\s]/g, '_');
  
  for (const [key, enumValue] of Object.entries(enumObject)) {
    if (enumValue.toLowerCase().replace(/[-_\s]/g, '_') === normalizedValue) {
      return enumValue as T[keyof T];
    }
  }
  return null;
}

// Base model class
export abstract class BaseModel {
  static tableName: string;
  
  constructor(data: any = {}) {
    Object.assign(this, data);
  }

  static create<T extends BaseModel>(this: new(data?: any) => T, data: any): T {
    return new this(data);
  }
}

// Agent Session Model
export interface AgentSessionData {
  id: string;
  agent_name: string;
  repository_path: string;
  status: AgentStatus;
  claude_pid?: number;
  capabilities?: string[];
  created_at: Date;
  last_heartbeat: Date;
  agent_metadata?: Record<string, any>;
}

export class AgentSession extends BaseModel implements AgentSessionData {
  static tableName = 'agent_sessions';
  
  id!: string;
  agent_name!: string;
  repository_path!: string;
  status!: AgentStatus;
  claude_pid?: number;
  capabilities?: string[];
  created_at!: Date;
  last_heartbeat!: Date;
  agent_metadata?: Record<string, any>;
}

// Task Model
export interface TaskData {
  id: string;
  repository_path: string;
  task_type: string;
  status: TaskStatus;
  assigned_agent_id?: string;
  parent_task_id?: string;
  priority: number;
  description: string;
  requirements?: Record<string, any>;
  results?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export class Task extends BaseModel implements TaskData {
  static tableName = 'tasks';
  
  id!: string;
  repository_path!: string;
  task_type!: string;
  status!: TaskStatus;
  assigned_agent_id?: string;
  parent_task_id?: string;
  priority!: number;
  description!: string;
  requirements?: Record<string, any>;
  results?: Record<string, any>;
  created_at!: Date;
  updated_at!: Date;
}

// Memory Model
export interface MemoryData {
  id: string;
  repository_path: string;
  agent_name: string;
  memory_type: MemoryType;
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, any>;
  created_at: Date;
}

export class Memory extends BaseModel implements MemoryData {
  static tableName = 'memories';
  
  id!: string;
  repository_path!: string;
  agent_name!: string;
  memory_type!: MemoryType;
  title!: string;
  content!: string;
  tags!: string[];
  metadata!: Record<string, any>;
  created_at!: Date;
}

// Chat Room Model
export interface ChatRoomData {
  name: string;
  description?: string;
  repository_path?: string;
  created_at: Date;
  room_metadata?: Record<string, any>;
}

export class ChatRoom extends BaseModel implements ChatRoomData {
  static tableName = 'chat_rooms';
  
  name!: string;
  description?: string;
  repository_path?: string;
  created_at!: Date;
  room_metadata?: Record<string, any>;
}

// Chat Message Model
export interface ChatMessageData {
  id: string;
  room_name: string;
  agent_name: string;
  message: string;
  timestamp: Date;
  mentions: string[];
  message_type: MessageType;
}

export class ChatMessage extends BaseModel implements ChatMessageData {
  static tableName = 'chat_messages';
  
  id!: string;
  room_name!: string;
  agent_name!: string;
  message!: string;
  timestamp!: Date;
  mentions!: string[];
  message_type!: MessageType;
}

// Documentation Source Model
export interface DocumentationSourceData {
  id: string;
  name: string;
  url: string;
  source_type: string;
  crawl_depth: number;
  update_frequency: string;
  selectors?: Record<string, string>;
  allow_patterns?: string[];
  ignore_patterns?: string[];
  include_subdomains?: boolean;
  last_scraped?: Date;
  status: DocumentationStatus;
  created_at: Date;
  updated_at: Date;
  source_metadata?: Record<string, any>;
}

export class DocumentationSource extends BaseModel implements DocumentationSourceData {
  static tableName = 'documentation_sources';
  
  id!: string;
  name!: string;
  url!: string;
  source_type!: string;
  crawl_depth!: number;
  update_frequency!: string;
  selectors?: Record<string, string>;
  allow_patterns?: string[];
  ignore_patterns?: string[];
  include_subdomains?: boolean;
  last_scraped?: Date;
  status!: DocumentationStatus;
  created_at!: Date;
  updated_at!: Date;
  source_metadata?: Record<string, any>;
}

// Scrape Job Model
export interface ScrapeJobData {
  id: string;
  source_id: string;
  job_data: Record<string, any>;
  status: string;
  locked_by?: string;
  locked_at?: Date;
  lock_timeout: number;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error_message?: string;
  pages_scraped?: number;
  result_data?: Record<string, any>;
}

export class ScrapeJob extends BaseModel implements ScrapeJobData {
  static tableName = 'scrape_jobs';
  
  id!: string;
  source_id!: string;
  job_data!: Record<string, any>;
  status!: string;
  locked_by?: string;
  locked_at?: Date;
  lock_timeout!: number;
  created_at!: Date;
  started_at?: Date;
  completed_at?: Date;
  error_message?: string;
  pages_scraped?: number;
  result_data?: Record<string, any>;

  isLocked(): boolean {
    if (!this.locked_at || !this.locked_by) return false;
    
    const lockExpiry = new Date(this.locked_at.getTime() + this.lock_timeout * 1000);
    return new Date() < lockExpiry;
  }

  canAcquireLock(workerId: string): boolean {
    return !this.isLocked() || this.locked_by === workerId;
  }
}

// Error Log Model
export interface ErrorLogData {
  id: string;
  repository_path: string;
  agent_id?: string;
  task_id?: string;
  error_type: string;
  error_category: string;
  error_message: string;
  error_details?: string;
  context?: Record<string, any>;
  environment?: Record<string, any>;
  attempted_solution?: string;
  resolution_status: string;
  resolution_details?: string;
  pattern_id?: string;
  severity: string;
  created_at: Date;
  resolved_at?: Date;
}

export class ErrorLog extends BaseModel implements ErrorLogData {
  static tableName = 'error_logs';
  
  id!: string;
  repository_path!: string;
  agent_id?: string;
  task_id?: string;
  error_type!: string;
  error_category!: string;
  error_message!: string;
  error_details?: string;
  context?: Record<string, any>;
  environment?: Record<string, any>;
  attempted_solution?: string;
  resolution_status!: string;
  resolution_details?: string;
  pattern_id?: string;
  severity!: string;
  created_at!: Date;
  resolved_at?: Date;
}

// Tool Call Log Model
export interface ToolCallLogData {
  id: string;
  repository_path: string;
  agent_id: string;
  task_id?: string;
  tool_name: string;
  parameters?: Record<string, any>;
  result?: Record<string, any>;
  status: string;
  execution_time?: number;
  error_message?: string;
  created_at: Date;
}

export class ToolCallLog extends BaseModel implements ToolCallLogData {
  static tableName = 'tool_call_logs';
  
  id!: string;
  repository_path!: string;
  agent_id!: string;
  task_id?: string;
  tool_name!: string;
  parameters?: Record<string, any>;
  result?: Record<string, any>;
  status!: string;
  execution_time?: number;
  error_message?: string;
  created_at!: Date;
}