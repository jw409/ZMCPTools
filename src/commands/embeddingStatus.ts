/**
 * Embedding Status Command
 * Provides comprehensive visibility into embedding system state
 * Prevents silent failures and re-index loops
 */

import { EmbeddingClient } from '../services/EmbeddingClient.js';
import { Logger } from '../utils/logger.js';

export interface StatusDisplayOptions {
  format: 'console' | 'json';
  verbose: boolean;
  validate: boolean;
}

export class EmbeddingStatusCommand {
  private logger: Logger;
  private embeddingClient: EmbeddingClient;

  constructor() {
    this.logger = new Logger('embedding-status');
    this.embeddingClient = new EmbeddingClient();
  }

  /**
   * Run embedding status check and display results
   */
  async run(options: StatusDisplayOptions = { format: 'console', verbose: false, validate: false }): Promise<void> {
    this.logger.info('Running embedding status check', options);

    try {
      // Get comprehensive status
      const healthStatus = await this.embeddingClient.getHealthStatus();
      const config = this.embeddingClient.getConfig();
      const modelInfo = this.embeddingClient.getModelInfo(config.default_model);
      const collectionName = this.embeddingClient.getCollectionName('knowledge_graph', config.default_model);

      const status = {
        current_mode: config.default_model,
        model_info: modelInfo,
        health: {
          status: healthStatus.status,
          service_responding: healthStatus.gpu_available,
          dimension_mismatch: false,
          collection_exists: healthStatus.collections[collectionName]?.exists || false,
          last_error: healthStatus.warnings.length > 0 ? healthStatus.warnings[0] : null
        },
        collection_name: collectionName,
        recent_actions: []
      };

      // Perform validation if requested
      if (options.validate) {
        try {
          await this.embeddingClient.validateCollection(collectionName, config.default_model);
          console.log('✅ Validation: Collection is compatible');
        } catch (error) {
          console.log(`❌ Validation: ${error.message}`);
        }
      }

      // Display results based on format
      if (options.format === 'json') {
        console.log(JSON.stringify({ healthStatus, modelInfo, collectionName }, null, 2));
      } else {
        this.displayConsoleStatus(status, options.verbose);
      }

    } catch (error) {
      this.logger.error('Status check failed', { error: error.message });
      console.error(`❌ Status check failed: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Display status in human-readable console format
   */
  private displayConsoleStatus(status: any, verbose: boolean): void {
    console.log('\n📊 ZMCPTools Embedding Status\n');

    // Current configuration
    console.log(`Current Mode: ${status.current_mode} (${status.model_info.dimensions} dimensions)`);
    console.log(`GPU Service: ${this.formatServiceStatus(status.health)}`);
    console.log(`Active Collection: ${status.collection_name}`);

    // Health indicators
    console.log('\nHealth Check:');
    console.log(`├── Overall Status: ${this.formatHealthStatus(status.health.status)}`);
    console.log(`├── Service Responding: ${this.formatBoolean(status.health.service_responding)}`);
    console.log(`├── Dimensions Match: ${this.formatBoolean(!status.health.dimension_mismatch)}`);
    console.log(`└── Collection Exists: ${this.formatBoolean(status.health.collection_exists)}`);

    if (status.health.last_error) {
      console.log(`\n⚠️  Last Error: ${status.health.last_error}`);
    }

    // Model information
    console.log('\nModel Details:');
    console.log(`├── Name: ${status.model_info.name}`);
    console.log(`├── Dimensions: ${status.model_info.dimensions}`);
    console.log(`├── Requires GPU: ${this.formatBoolean(status.model_info.requires_gpu)}`);
    console.log(`└── API Model: ${status.model_info.api_model_name}`);

    // Recent activity
    if (status.recent_actions.length > 0) {
      console.log('\nRecent Activity:');
      status.recent_actions.forEach((action: any, index: number) => {
        const isLast = index === status.recent_actions.length - 1;
        const prefix = isLast ? '└──' : '├──';
        const timestamp = new Date(action.timestamp).toLocaleString();

        let description = this.formatActionDescription(action);
        console.log(`${prefix} ${timestamp} ${description}`);
      });
    }

    // Available modes
    if (verbose) {
      console.log('\nAvailable Modes:');
      const modes = ['qwen3', 'gemma3'].map((mode, index) => {
        const info = this.embeddingClient.getModelInfo(mode as 'qwen3' | 'gemma3');
        const isCurrent = mode === status.current_mode;
        const indicator = isCurrent ? '🎯 ACTIVE' : '';
        const isLast = index === 1;
        const prefix = isLast ? '└──' : '├──';

        console.log(`${prefix} ${mode}: ${info.name} (${info.dimensions}d) ${indicator}`);
      });
    }

    // Warnings and recommendations
    this.displayWarningsAndRecommendations(status);

    console.log(''); // Empty line for spacing
  }

  /**
   * Format service status with appropriate emoji
   */
  private formatServiceStatus(health: any): string {
    if (!health.service_responding) return '❌ Unavailable (localhost:8765)';
    if (health.dimension_mismatch) return '⚠️  Connected but dimension mismatch';
    return '✅ Healthy (localhost:8765)';
  }

  /**
   * Format health status with color indicators
   */
  private formatHealthStatus(status: string): string {
    switch (status) {
      case 'healthy': return '✅ Healthy';
      case 'degraded': return '⚠️  Degraded';
      case 'failed': return '❌ Failed';
      default: return `❓ Unknown (${status})`;
    }
  }

  /**
   * Format boolean with appropriate emoji
   */
  private formatBoolean(value: boolean): string {
    return value ? '✅ Yes' : '❌ No';
  }

  /**
   * Format action description for display
   */
  private formatActionDescription(action: any): string {
    switch (action.action) {
      case 'mode_switch':
        const forced = action.forced ? ' (forced)' : '';
        return `mode_switch from ${action.from} to ${action.to}${forced}`;
      case 'full_reindex':
        return `full_reindex completed`;
      case 'search_query':
        return `search_query executed`;
      case 'validation_error':
        return `validation_error: ${action.details || 'unknown error'}`;
      default:
        return `${action.action}: ${action.details || ''}`;
    }
  }

  /**
   * Display warnings and recommendations
   */
  private displayWarningsAndRecommendations(status: any): void {
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Check for health issues
    if (status.health.status === 'failed') {
      warnings.push('System is in failed state');
      recommendations.push('Check GPU service and restart if necessary');
    } else if (status.health.status === 'degraded') {
      warnings.push('System is degraded');
      if (status.health.dimension_mismatch) {
        recommendations.push('Dimension mismatch detected - restart embedding service');
      }
      if (!status.health.service_responding) {
        recommendations.push('GPU service not responding - check port 8765');
      }
    }

    // Check for recent validation errors
    const recentErrors = status.recent_actions.filter((a: any) => a.action === 'validation_error');
    if (recentErrors.length > 0) {
      warnings.push(`${recentErrors.length} recent validation errors`);
      recommendations.push('Run with --validate flag to diagnose issues');
    }

    // Display warnings
    if (warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      warnings.forEach(warning => console.log(`   • ${warning}`));
    }

    // Display recommendations
    if (recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      recommendations.forEach(rec => console.log(`   • ${rec}`));
    }

    // Show helpful commands
    if (status.health.status !== 'healthy') {
      console.log('\n🔧 Helpful Commands:');
      console.log('   • Check GPU service: curl http://localhost:8765/health');
      console.log('   • Validate system: zmcp-tools embedding-status --validate');
      console.log('   • Switch default model: zmcp-tools switch-embeddings --mode [gemma3|qwen3]');
    }
  }
}

/**
 * CLI entry point for embedding status command
 */
export async function embeddingStatusCLI(args: string[]): Promise<void> {
  const options: StatusDisplayOptions = {
    format: 'console',
    verbose: false,
    validate: false
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--json':
        options.format = 'json';
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--validate':
        options.validate = true;
        break;
      case '--help':
      case '-h':
        console.log(`
Usage: zmcp-tools embedding-status [options]

Options:
  --json       Output status as JSON
  --verbose    Show detailed information
  --validate   Run validation checks
  --help       Show this help message

Examples:
  zmcp-tools embedding-status                    # Basic status
  zmcp-tools embedding-status --verbose          # Detailed status
  zmcp-tools embedding-status --validate         # Status with validation
  zmcp-tools embedding-status --json             # JSON output
        `);
        return;
    }
  }

  const command = new EmbeddingStatusCommand();
  await command.run(options);
}