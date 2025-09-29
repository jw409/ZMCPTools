/**
 * Embedding Status Tool
 * Provides comprehensive visibility into embedding system health and configuration
 * Prevents silent failures and configuration mismatches
 */

import { EmbeddingClient, HealthStatus } from '../services/EmbeddingClient.js';
import { Logger } from '../utils/logger.js';

export interface EmbeddingStatusOptions {
  verbose?: boolean;
  format?: 'text' | 'json';
}

export class EmbeddingStatusTool {
  private logger: Logger;
  private embeddingClient: EmbeddingClient;

  constructor() {
    this.logger = new Logger('embedding-status');
    this.embeddingClient = new EmbeddingClient();
  }

  /**
   * Get comprehensive embedding system status
   */
  async getStatus(options: EmbeddingStatusOptions = {}): Promise<string> {
    try {
      const healthStatus = await this.embeddingClient.getHealthStatus();
      const embeddingStats = this.embeddingClient.getEmbeddingStats();
      const availableModes = this.embeddingClient.getAvailableModes();

      if (options.format === 'json') {
        return JSON.stringify({
          health: healthStatus,
          stats: embeddingStats,
          modes: availableModes
        }, null, 2);
      }

      return this.formatTextStatus(healthStatus, embeddingStats, availableModes, options.verbose || false);
    } catch (error) {
      this.logger.error('Failed to get embedding status', { error });
      throw error;
    }
  }

  /**
   * Format status as human-readable text
   */
  private formatTextStatus(
    health: HealthStatus,
    stats: any,
    modes: any[],
    verbose: boolean
  ): string {
    const lines: string[] = [];

    // Header
    lines.push('EMBEDDING SERVICE STATUS');
    lines.push('========================');
    lines.push('');

    // Overall health
    const statusEmoji = health.status === 'healthy' ? '✅' :
                       health.status === 'degraded' ? '⚠️' : '❌';
    lines.push(`Overall Status: ${statusEmoji} ${health.status.toUpperCase()}`);
    lines.push(`Active Model: ${health.active_model} (${health.dimensions} dimensions)`);
    lines.push(`GPU Service: ${health.gpu_available ? '✅ Available' : '❌ Unavailable'} (${this.embeddingClient.getConfig().gpu_endpoint})`);
    lines.push('');

    // Current model stats
    lines.push('CURRENT MODEL STATISTICS');
    lines.push('========================');
    lines.push(`Model: ${stats.model}`);
    lines.push(`Dimensions: ${stats.dimensions}`);
    lines.push(`Requires GPU: ${stats.requires_gpu ? 'Yes' : 'No'}`);
    lines.push(`Last Indexed: ${stats.last_indexed || 'Never'}`);
    lines.push(`Reindex Count: ${stats.reindex_count}`);

    if (stats.cooldown_remaining_hours > 0) {
      lines.push(`⏳ Cooldown Remaining: ${stats.cooldown_remaining_hours.toFixed(1)} hours`);
    } else {
      lines.push('✅ Ready for re-index');
    }
    lines.push('');

    // Collections status
    lines.push('COLLECTIONS');
    lines.push('===========');

    const collectionEntries = Object.entries(health.collections);
    if (collectionEntries.length === 0) {
      lines.push('No collections found');
    } else {
      for (const [collectionName, collectionInfo] of collectionEntries) {
        const statusIcon = collectionInfo.compatible ? '✅ ACTIVE' :
                          collectionInfo.exists ? '⚠️ INACTIVE' : '📁 EMPTY';

        lines.push(`${collectionName}:`);
        lines.push(`  - Vectors: ${collectionInfo.vectors.toLocaleString()}`);
        lines.push(`  - Last indexed: ${collectionInfo.last_indexed || 'Never'}`);
        lines.push(`  - Status: ${statusIcon} ${this.getCollectionStatusDescription(collectionInfo)}`);
        lines.push('');
      }
    }

    // Available modes
    if (verbose) {
      lines.push('AVAILABLE MODES');
      lines.push('===============');

      for (const mode of modes) {
        const activeIndicator = mode.active ? '🎯 ' : '   ';
        const gpuIndicator = mode.info.requires_gpu ? '🔥' : '💻';

        lines.push(`${activeIndicator}${mode.mode}:`);
        lines.push(`  - Model: ${mode.info.name} ${gpuIndicator}`);
        lines.push(`  - Dimensions: ${mode.info.dimensions}`);
        lines.push(`  - Collection exists: ${mode.collection_exists ? 'Yes' : 'No'}`);
        lines.push(`  - Vectors: ${mode.vector_count.toLocaleString()}`);
        lines.push('');
      }
    }

    // Available modes
    if (verbose) {
      lines.push('AVAILABLE MODES');
      lines.push('===============');

      for (const mode of modes) {
        const activeIndicator = mode.active ? '🎯 ' : '   ';
        const gpuIndicator = mode.info.requires_gpu ? '🔥' : '💻';

        lines.push(`${activeIndicator}${mode.mode}:`);
        lines.push(`  - Model: ${mode.info.name} ${gpuIndicator}`);
        lines.push(`  - Dimensions: ${mode.info.dimensions}`);
        lines.push(`  - Collection exists: ${mode.collection_exists ? 'Yes' : 'No'}`);
        lines.push(`  - Vectors: ${mode.vector_count.toLocaleString()}`);
        lines.push('');
      }
    }

    // Warnings
    if (health.warnings.length > 0) {
      lines.push('WARNINGS');
      lines.push('========');
      for (const warning of health.warnings) {
        lines.push(`⚠️  ${warning}`);
      }
      lines.push('');
    }

    // Quick actions
    lines.push('QUICK ACTIONS');
    lines.push('=============');

    if (health.status === 'unhealthy') {
      lines.push('🚨 System is unhealthy. Check GPU service and model configuration.');
    } else if (health.warnings.length > 0) {
      lines.push('⚠️  System has warnings. Review above for details.');
    } else {
      lines.push('✅ System is healthy and ready for use.');
    }

    lines.push('');
    lines.push('Commands:');
    lines.push('  - Switch model: zmcp-tools switch-embeddings --mode <gemma3|qwen3|minilm>');
    lines.push('  - Force re-index: zmcp-tools reindex --force');
    lines.push('  - Detailed status: zmcp-tools embedding-status --verbose');

    return lines.join('\\n');
  }

  /**
   * Get human-readable collection status description
   */
  private getCollectionStatusDescription(collectionInfo: any): string {
    if (!collectionInfo.exists) {
      return '(no vectors indexed)';
    }

    if (collectionInfo.compatible) {
      return '(matches current model)';
    }

    return '(different model, requires switch or re-index)';
  }

  /**
   * Check if there are any configuration issues
   */
  async validateConfiguration(): Promise<{
    valid: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      const health = await this.embeddingClient.getHealthStatus();
      const stats = this.embeddingClient.getEmbeddingStats();

      // Check for critical issues
      if (health.status === 'unhealthy') {
        issues.push('Embedding system is unhealthy');
      }

      // Check GPU dependency
      if (!health.gpu_available && health.active_model !== 'minilm') {
        issues.push(`Active model '${health.active_model}' requires GPU but GPU service is unavailable`);
        recommendations.push('Either fix GPU service or switch to MiniLM mode');
      }

      // Check for unused collections
      const activeCollections = Object.entries(health.collections)
        .filter(([_, info]) => info.exists && info.vectors > 0);

      const inactiveCollections = activeCollections
        .filter(([_, info]) => !info.compatible);

      if (inactiveCollections.length > 0) {
        recommendations.push(`${inactiveCollections.length} inactive collection(s) with vectors - consider cleanup`);
      }

      // Check reindex frequency
      if (stats.reindex_count > 5) {
        recommendations.push('High reindex count detected - consider stabilizing on one model');
      }

      // Check for stale indexes
      if (stats.last_indexed) {
        const daysSinceIndex = (Date.now() - new Date(stats.last_indexed).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceIndex > 30) {
          recommendations.push('Index is over 30 days old - consider refreshing');
        }
      }

    } catch (error) {
      issues.push(`Configuration validation failed: ${error.message}`);
    }

    return {
      valid: issues.length === 0,
      issues,
      recommendations
    };
  }

  /**
   * Switch embedding mode with safety checks
   */
  async switchMode(mode: 'gemma3' | 'qwen3' | 'minilm', force: boolean = false): Promise<string> {
    try {
      await this.embeddingClient.switchMode(mode, { force });

      return `✅ Successfully switched to ${mode} mode.\\n` +
             `Note: You may need to re-index your collections to use the new model.`;

    } catch (error) {
      this.logger.error('Failed to switch embedding mode', { mode, force, error });

      // Provide helpful error context
      let errorMessage = `❌ Failed to switch to ${mode}: ${error.message}\\n\\n`;

      if (error.message.includes('vectors')) {
        errorMessage += 'Solutions:\\n';
        errorMessage += `  1. Use --force to switch anyway: zmcp-tools switch-embeddings --mode ${mode} --force\\n`;
        errorMessage += '  2. Clear current collection first\\n';
        errorMessage += '  3. Create parallel collection\\n';
      }

      if (error.message.includes('GPU')) {
        errorMessage += 'Solutions:\\n';
        errorMessage += '  1. Start GPU service: systemctl --user start inference-service\\n';
        errorMessage += '  2. Check GPU health: curl http://localhost:8765/health\\n';
        errorMessage += '  3. Switch to CPU mode: zmcp-tools switch-embeddings --mode minilm\\n';
      }

      return errorMessage;
    }
  }
}

/**
 * Export utility functions for CLI usage
 */
export async function getEmbeddingStatus(options: EmbeddingStatusOptions = {}): Promise<string> {
  const tool = new EmbeddingStatusTool();
  return tool.getStatus(options);
}

export async function switchEmbeddingMode(mode: 'gemma3' | 'qwen3' | 'minilm', force: boolean = false): Promise<string> {
  const tool = new EmbeddingStatusTool();
  return tool.switchMode(mode, force);
}

export async function validateEmbeddingConfig(): Promise<{
  valid: boolean;
  issues: string[];
  recommendations: string[];
}> {
  const tool = new EmbeddingStatusTool();
  return tool.validateConfiguration();
}