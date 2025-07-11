/**
 * Cleanup configuration with sensible defaults for stale agents and rooms
 */

export interface CleanupConfig {
  agents: {
    // Time in minutes after which an agent is considered stale
    staleMinutes: number;
    // Whether to include room cleanup when cleaning up agents
    includeRoomCleanup: boolean;
    // Whether to notify room participants before agent cleanup
    notifyParticipants: boolean;
    // Maximum number of agents to clean up in a single batch
    maxBatchSize: number;
    // Grace period in minutes for recently created agents
    gracePeriodMinutes: number;
  };
  rooms: {
    // Time in minutes after which a room is considered inactive
    inactiveMinutes: number;
    // Whether to delete rooms with no active participants
    deleteNoActiveParticipants: boolean;
    // Whether to delete rooms with no recent messages
    deleteNoRecentMessages: boolean;
    // Whether to delete completely empty rooms (no messages, no participants)
    deleteEmptyRooms: boolean;
    // Whether to notify participants before room deletion
    notifyParticipants: boolean;
    // Maximum number of rooms to clean up in a single batch
    maxBatchSize: number;
    // Grace period in minutes for recently created rooms
    gracePeriodMinutes: number;
    // Whether to preserve general rooms (isGeneral = true)
    preserveGeneralRooms: boolean;
  };
  general: {
    // Default dry run mode for safety
    defaultDryRun: boolean;
    // Log level for cleanup operations
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    // Enable comprehensive logging
    enableDetailedLogging: boolean;
    // Cleanup operation timeout in milliseconds
    timeoutMs: number;
  };
}

/**
 * Default cleanup configuration
 */
export const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  agents: {
    staleMinutes: 30,
    includeRoomCleanup: true,
    notifyParticipants: true,
    maxBatchSize: 50,
    gracePeriodMinutes: 5
  },
  rooms: {
    inactiveMinutes: 60,
    deleteNoActiveParticipants: true,
    deleteNoRecentMessages: true,
    deleteEmptyRooms: true,
    notifyParticipants: true,
    maxBatchSize: 25,
    gracePeriodMinutes: 10,
    preserveGeneralRooms: false
  },
  general: {
    defaultDryRun: true,
    logLevel: 'info',
    enableDetailedLogging: true,
    timeoutMs: 300000 // 5 minutes
  }
};

/**
 * Production cleanup configuration (more conservative)
 */
export const PRODUCTION_CLEANUP_CONFIG: CleanupConfig = {
  agents: {
    staleMinutes: 60, // Longer grace period in production
    includeRoomCleanup: true,
    notifyParticipants: true,
    maxBatchSize: 25, // Smaller batches
    gracePeriodMinutes: 15
  },
  rooms: {
    inactiveMinutes: 120, // 2 hours
    deleteNoActiveParticipants: true,
    deleteNoRecentMessages: false, // More conservative
    deleteEmptyRooms: true,
    notifyParticipants: true,
    maxBatchSize: 10, // Very small batches
    gracePeriodMinutes: 30,
    preserveGeneralRooms: true // Preserve general rooms in production
  },
  general: {
    defaultDryRun: true, // Always default to dry run in production
    logLevel: 'info',
    enableDetailedLogging: true,
    timeoutMs: 600000 // 10 minutes
  }
};

/**
 * Development cleanup configuration (more aggressive for testing)
 */
export const DEVELOPMENT_CLEANUP_CONFIG: CleanupConfig = {
  agents: {
    staleMinutes: 15,
    includeRoomCleanup: true,
    notifyParticipants: false, // Skip notifications in development
    maxBatchSize: 100,
    gracePeriodMinutes: 2
  },
  rooms: {
    inactiveMinutes: 30,
    deleteNoActiveParticipants: true,
    deleteNoRecentMessages: true,
    deleteEmptyRooms: true,
    notifyParticipants: false, // Skip notifications in development
    maxBatchSize: 50,
    gracePeriodMinutes: 5,
    preserveGeneralRooms: false
  },
  general: {
    defaultDryRun: false, // Allow real cleanup in development
    logLevel: 'debug',
    enableDetailedLogging: true,
    timeoutMs: 120000 // 2 minutes
  }
};

/**
 * Get cleanup configuration based on environment
 */
export function getCleanupConfig(environment?: string): CleanupConfig {
  const env = environment || process.env.NODE_ENV || 'development';
  
  switch (env.toLowerCase()) {
    case 'production':
    case 'prod':
      return PRODUCTION_CLEANUP_CONFIG;
    case 'development':
    case 'dev':
      return DEVELOPMENT_CLEANUP_CONFIG;
    default:
      return DEFAULT_CLEANUP_CONFIG;
  }
}

/**
 * Merge user configuration with defaults
 */
export function mergeCleanupConfig(
  userConfig: Partial<CleanupConfig>,
  baseConfig: CleanupConfig = DEFAULT_CLEANUP_CONFIG
): CleanupConfig {
  return {
    agents: {
      ...baseConfig.agents,
      ...userConfig.agents
    },
    rooms: {
      ...baseConfig.rooms,
      ...userConfig.rooms
    },
    general: {
      ...baseConfig.general,
      ...userConfig.general
    }
  };
}

/**
 * Validate cleanup configuration
 */
export function validateCleanupConfig(config: CleanupConfig): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate agent configuration
  if (config.agents.staleMinutes < 1) {
    errors.push('Agent staleMinutes must be at least 1 minute');
  }
  if (config.agents.staleMinutes < 5) {
    warnings.push('Agent staleMinutes less than 5 minutes may be too aggressive');
  }
  if (config.agents.maxBatchSize < 1) {
    errors.push('Agent maxBatchSize must be at least 1');
  }
  if (config.agents.maxBatchSize > 200) {
    warnings.push('Agent maxBatchSize over 200 may cause performance issues');
  }
  if (config.agents.gracePeriodMinutes < 0) {
    errors.push('Agent gracePeriodMinutes cannot be negative');
  }

  // Validate room configuration
  if (config.rooms.inactiveMinutes < 1) {
    errors.push('Room inactiveMinutes must be at least 1 minute');
  }
  if (config.rooms.inactiveMinutes < 10) {
    warnings.push('Room inactiveMinutes less than 10 minutes may be too aggressive');
  }
  if (config.rooms.maxBatchSize < 1) {
    errors.push('Room maxBatchSize must be at least 1');
  }
  if (config.rooms.maxBatchSize > 100) {
    warnings.push('Room maxBatchSize over 100 may cause performance issues');
  }
  if (config.rooms.gracePeriodMinutes < 0) {
    errors.push('Room gracePeriodMinutes cannot be negative');
  }

  // Validate general configuration
  if (config.general.timeoutMs < 10000) {
    errors.push('General timeoutMs must be at least 10 seconds');
  }
  if (config.general.timeoutMs > 3600000) {
    warnings.push('General timeoutMs over 1 hour may be too long');
  }

  // Check logical consistency
  if (config.agents.staleMinutes >= config.rooms.inactiveMinutes) {
    warnings.push('Agent staleMinutes should typically be less than room inactiveMinutes');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}