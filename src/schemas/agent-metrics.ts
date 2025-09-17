import { z } from 'zod';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';

// Agent metrics table for tracking performance, crashes, and health over time
export const agentMetrics = sqliteTable('agent_metrics', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),

  // Process information
  processTitle: text('process_title'),
  pid: integer('pid'),

  // Performance metrics
  crashCount: integer('crash_count').notNull().default(0),
  restartCount: integer('restart_count').notNull().default(0),
  totalUptime: integer('total_uptime').notNull().default(0), // in seconds
  lastCrashReason: text('last_crash_reason'),
  lastCrashAt: text('last_crash_at'),

  // Health scoring
  performanceScore: real('performance_score').notNull().default(100.0), // 0-100
  healthScore: real('health_score').notNull().default(100.0), // 0-100

  // Task completion metrics
  tasksCompleted: integer('tasks_completed').notNull().default(0),
  tasksAssigned: integer('tasks_assigned').notNull().default(0),
  taskSuccessRate: real('task_success_rate').notNull().default(100.0), // percentage
  averageTaskDuration: integer('average_task_duration').default(0), // in seconds

  // Resource usage (when available)
  lastCpuUsage: real('last_cpu_usage'), // percentage
  lastMemoryUsage: real('last_memory_usage'), // MB
  peakMemoryUsage: real('peak_memory_usage'), // MB

  // Activity tracking
  lastActivityAt: text('last_activity_at'),
  messagesCount: integer('messages_count').notNull().default(0),
  roomsJoined: integer('rooms_joined').notNull().default(0),

  // Rate limiting and errors
  rateLimitHits: integer('rate_limit_hits').notNull().default(0),
  lastRateLimitAt: text('last_rate_limit_at'),
  errorCount: integer('error_count').notNull().default(0),
  lastErrorAt: text('last_error_at'),
  lastErrorMessage: text('last_error_message'),

  // Timestamps
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),

  // Additional metrics as JSON
  additionalMetrics: text('additional_metrics', { mode: 'json' }).$type<Record<string, any>>()
});

// Agent process snapshots for tracking process state over time
export const agentProcessSnapshots = sqliteTable('agent_process_snapshots', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  pid: integer('pid'),
  processTitle: text('process_title'),

  // Resource usage at time of snapshot
  cpuUsage: real('cpu_usage'), // percentage
  memoryUsage: real('memory_usage'), // MB

  // Process status
  status: text('status').notNull(), // running, zombie, not_found
  command: text('command'),
  startTime: text('start_time'),

  // Snapshot metadata
  snapshotAt: text('snapshot_at').notNull().default(sql`(current_timestamp)`),
  sourceSystem: text('source_system').notNull().default('monitor'), // monitor, wrapper, system

  // Additional process data
  processData: text('process_data', { mode: 'json' }).$type<Record<string, any>>()
});

// Health check results for tracking agent health over time
export const agentHealthChecks = sqliteTable('agent_health_checks', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),

  // Health check results
  overallHealth: real('overall_health').notNull(), // 0-100
  responseTime: integer('response_time'), // milliseconds
  processAlive: integer('process_alive').notNull().default(0), // boolean as int
  roomConnected: integer('room_connected').notNull().default(0), // boolean as int
  recentActivity: integer('recent_activity').notNull().default(0), // boolean as int

  // Component health scores
  processHealth: real('process_health').notNull().default(100.0),
  communicationHealth: real('communication_health').notNull().default(100.0),
  taskHealth: real('task_health').notNull().default(100.0),

  // Issues detected
  issues: text('issues', { mode: 'json' }).$type<string[]>().default([]),
  warnings: text('warnings', { mode: 'json' }).$type<string[]>().default([]),

  // Check metadata
  checkedAt: text('checked_at').notNull().default(sql`(current_timestamp)`),
  checkDuration: integer('check_duration'), // milliseconds
  checkSource: text('check_source').notNull().default('monitor'), // monitor, wrapper, manual

  // Additional health data
  healthData: text('health_data', { mode: 'json' }).$type<Record<string, any>>()
});

// Zod schemas for validation
export const agentMetricsSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  processTitle: z.string().optional(),
  pid: z.number().optional(),
  crashCount: z.number().default(0),
  restartCount: z.number().default(0),
  totalUptime: z.number().default(0),
  lastCrashReason: z.string().optional(),
  lastCrashAt: z.string().optional(),
  performanceScore: z.number().min(0).max(100).default(100),
  healthScore: z.number().min(0).max(100).default(100),
  tasksCompleted: z.number().default(0),
  tasksAssigned: z.number().default(0),
  taskSuccessRate: z.number().min(0).max(100).default(100),
  averageTaskDuration: z.number().default(0),
  lastCpuUsage: z.number().optional(),
  lastMemoryUsage: z.number().optional(),
  peakMemoryUsage: z.number().optional(),
  lastActivityAt: z.string().optional(),
  messagesCount: z.number().default(0),
  roomsJoined: z.number().default(0),
  rateLimitHits: z.number().default(0),
  lastRateLimitAt: z.string().optional(),
  errorCount: z.number().default(0),
  lastErrorAt: z.string().optional(),
  lastErrorMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  additionalMetrics: z.record(z.string(), z.any()).optional()
});

export const agentProcessSnapshotSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  pid: z.number().optional(),
  processTitle: z.string().optional(),
  cpuUsage: z.number().optional(),
  memoryUsage: z.number().optional(),
  status: z.string(),
  command: z.string().optional(),
  startTime: z.string().optional(),
  snapshotAt: z.string(),
  sourceSystem: z.string().default('monitor'),
  processData: z.record(z.string(), z.any()).optional()
});

export const agentHealthCheckSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  overallHealth: z.number().min(0).max(100),
  responseTime: z.number().optional(),
  processAlive: z.number().min(0).max(1),
  roomConnected: z.number().min(0).max(1),
  recentActivity: z.number().min(0).max(1),
  processHealth: z.number().min(0).max(100).default(100),
  communicationHealth: z.number().min(0).max(100).default(100),
  taskHealth: z.number().min(0).max(100).default(100),
  issues: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  checkedAt: z.string(),
  checkDuration: z.number().optional(),
  checkSource: z.string().default('monitor'),
  healthData: z.record(z.string(), z.any()).optional()
});

// Generated table validation schemas
export const insertAgentMetricsSchema = createInsertSchema(agentMetrics);
export const selectAgentMetricsSchema = createSelectSchema(agentMetrics);
export const updateAgentMetricsSchema = createUpdateSchema(agentMetrics);

export const insertAgentProcessSnapshotSchema = createInsertSchema(agentProcessSnapshots);
export const selectAgentProcessSnapshotSchema = createSelectSchema(agentProcessSnapshots);

export const insertAgentHealthCheckSchema = createInsertSchema(agentHealthChecks);
export const selectAgentHealthCheckSchema = createSelectSchema(agentHealthChecks);

// TypeScript types
export type AgentMetrics = z.infer<typeof agentMetricsSchema>;
export type AgentProcessSnapshot = z.infer<typeof agentProcessSnapshotSchema>;
export type AgentHealthCheck = z.infer<typeof agentHealthCheckSchema>;

export type NewAgentMetrics = Omit<AgentMetrics, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export type AgentMetricsUpdate = Partial<Omit<AgentMetrics, 'id' | 'agentId' | 'createdAt'>>;

// Utility functions for metrics calculation
export function calculateHealthScore(metrics: Partial<AgentMetrics>): number {
  let score = 100;

  // Deduct for crashes (max 50 points)
  if (metrics.crashCount && metrics.crashCount > 0) {
    score -= Math.min(metrics.crashCount * 10, 50);
  }

  // Deduct for restarts (max 30 points)
  if (metrics.restartCount && metrics.restartCount > 0) {
    score -= Math.min(metrics.restartCount * 5, 30);
  }

  // Deduct for errors (max 20 points)
  if (metrics.errorCount && metrics.errorCount > 0) {
    score -= Math.min(metrics.errorCount * 2, 20);
  }

  // Bonus for high task success rate
  if (metrics.taskSuccessRate && metrics.taskSuccessRate > 95) {
    score += 5;
  }

  // Bonus for no rate limit hits
  if (!metrics.rateLimitHits || metrics.rateLimitHits === 0) {
    score += 5;
  }

  return Math.max(Math.min(score, 100), 0);
}

export function calculatePerformanceScore(metrics: Partial<AgentMetrics>): number {
  let score = 100;

  // Factor in task completion rate
  if (metrics.tasksAssigned && metrics.tasksAssigned > 0) {
    const completionRate = (metrics.tasksCompleted || 0) / metrics.tasksAssigned;
    score = score * 0.7 + completionRate * 100 * 0.3;
  }

  // Factor in task success rate
  if (metrics.taskSuccessRate) {
    score = score * 0.8 + metrics.taskSuccessRate * 0.2;
  }

  // Penalize for excessive average task duration (>30 minutes)
  if (metrics.averageTaskDuration && metrics.averageTaskDuration > 1800) {
    score -= Math.min((metrics.averageTaskDuration - 1800) / 60, 20); // Deduct up to 20 points
  }

  return Math.max(Math.min(score, 100), 0);
}

// Constants for metric thresholds
export const METRIC_THRESHOLDS = {
  HEALTH_EXCELLENT: 90,
  HEALTH_GOOD: 70,
  HEALTH_WARNING: 50,
  HEALTH_CRITICAL: 30,

  PERFORMANCE_EXCELLENT: 90,
  PERFORMANCE_GOOD: 70,
  PERFORMANCE_WARNING: 50,
  PERFORMANCE_CRITICAL: 30,

  MAX_RESTART_COUNT: 10,
  MAX_CRASH_COUNT: 5,
  MAX_ERROR_COUNT: 20,
  MAX_RATE_LIMIT_HITS: 10,

  TASK_DURATION_WARNING: 1800, // 30 minutes
  TASK_DURATION_CRITICAL: 3600, // 1 hour

  CPU_USAGE_WARNING: 80,
  CPU_USAGE_CRITICAL: 95,

  MEMORY_USAGE_WARNING: 1024, // 1GB
  MEMORY_USAGE_CRITICAL: 2048, // 2GB
} as const;