/**
 * Embedding Status Tool
 * Provides comprehensive visibility into embedding system health and configuration
 * Prevents silent failures and configuration mismatches
 */

import { EmbeddingClient } from '../services/EmbeddingClient.js';
import type { HealthStatus } from '../services/EmbeddingClient.js';
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
      const config = this.embeddingClient.getConfig();
      const modelInfo = this.embeddingClient.getModelInfo(config.default_model);

      // Build available modes info from MODEL_SPECS (both qwen3 and gemma3)
      const availableModes = ['qwen3', 'gemma3'].map(mode => {
        const info = this.embeddingClient.getModelInfo(mode as 'qwen3' | 'gemma3');
        const collectionName = this.embeddingClient.getCollectionName('knowledge_graph', mode as 'qwen3' | 'gemma3');
        const collection = healthStatus.collections[collectionName];

        return {
          mode,
          active: mode === config.default_model,
          info,
          collection_exists: collection?.exists || false,
          vector_count: collection?.vectors || 0
        };
      });

      if (options.format === 'json') {
        return JSON.stringify({
          health: healthStatus,
          default_model: config.default_model,
          model_info: modelInfo,
          modes: availableModes
        }, null, 2);
      }

      return this.formatTextStatus(healthStatus, config.default_model, modelInfo, availableModes, options.verbose || false);
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
    defaultModel: string,
    modelInfo: any,
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
    lines.push(`Default Model: ${defaultModel} (${modelInfo.dimensions} dimensions)`);
    lines.push(`GPU Service: ${health.gpu_available ? '✅ Available' : '❌ Unavailable'} (${this.embeddingClient.getConfig().gpu_endpoint})`);
    lines.push('');

    // Current model info
    lines.push('DEFAULT MODEL');
    lines.push('=============');
    lines.push(`Model: ${modelInfo.name}`);
    lines.push(`Dimensions: ${modelInfo.dimensions}`);
    lines.push(`Requires GPU: ${modelInfo.requires_gpu ? 'Yes' : 'No'}`);
    lines.push(`API Name: ${modelInfo.api_model_name}`);
    lines.push('');

    lines.push('Note: Both qwen3 and gemma3 are loaded simultaneously in GPU service.');
    lines.push('Default model is used when no explicit model is specified in requests.');
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
    lines.push('  - Switch default model: zmcp-tools switch-embeddings --mode <gemma3|qwen3>');
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
      const config = this.embeddingClient.getConfig();

      // Check for critical issues
      if (health.status === 'unhealthy') {
        issues.push('Embedding system is unhealthy');
      }

      // Check GPU dependency (both qwen3 and gemma3 require GPU)
      if (!health.gpu_available) {
        issues.push('GPU service unavailable but both qwen3 and gemma3 require GPU');
        recommendations.push('Start GPU service on port 8765 for embedding functionality');
      }

      // Check for unused collections
      const activeCollections = Object.entries(health.collections)
        .filter(([_, info]) => info.exists && info.vectors > 0);

      const inactiveCollections = activeCollections
        .filter(([_, info]) => !info.compatible);

      if (inactiveCollections.length > 0) {
        recommendations.push(`${inactiveCollections.length} inactive collection(s) with vectors - consider cleanup`);
      }

      // Check for stale indexes by looking at collection timestamps
      for (const [collectionName, collectionInfo] of Object.entries(health.collections)) {
        if (collectionInfo.exists && collectionInfo.last_indexed) {
          const daysSinceIndex = (Date.now() - new Date(collectionInfo.last_indexed).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceIndex > 30) {
            recommendations.push(`Collection ${collectionName} is over 30 days old - consider refreshing`);
          }
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
   * Switch default embedding model (does not re-index, just changes preference)
   */
  async switchMode(mode: 'gemma3' | 'qwen3', force: boolean = false): Promise<string> {
    try {
      // Validate GPU availability
      const health = await this.embeddingClient.getHealthStatus();
      if (!health.gpu_available) {
        return `❌ Cannot switch to ${mode}: GPU service unavailable\\n\\n` +
               `Both qwen3 and gemma3 require GPU. Solutions:\\n` +
               `  1. Start GPU service: systemctl --user start inference-service\\n` +
               `  2. Check GPU health: curl http://localhost:8765/health\\n`;
      }

      // Update default model preference
      this.embeddingClient.setDefaultModel(mode);

      return `✅ Successfully updated default model preference to ${mode}.\\n\\n` +
             `Note: Both models remain available simultaneously.\\n` +
             `This only changes which model is used by default when not specified explicitly.\\n` +
             `Existing collections are not affected - they maintain their original embeddings.`;

    } catch (error) {
      this.logger.error('Failed to switch embedding mode', { mode, force, error });
      return `❌ Failed to switch to ${mode}: ${error.message}`;
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

export async function switchEmbeddingMode(mode: 'gemma3' | 'qwen3', force: boolean = false): Promise<string> {
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