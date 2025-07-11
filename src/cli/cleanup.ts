#!/usr/bin/env node

/**
 * CLI tool for running cleanup operations on stale agents and rooms
 * 
 * Usage:
 *   npx tsx src/cli/cleanup.ts --help
 *   npx tsx src/cli/cleanup.ts --dry-run
 *   npx tsx src/cli/cleanup.ts --agents --stale-minutes 60
 *   npx tsx src/cli/cleanup.ts --rooms --inactive-minutes 120
 *   npx tsx src/cli/cleanup.ts --comprehensive --dry-run
 */

import { Command } from 'commander';
import { DatabaseManager } from '../database/index.js';
import { AgentService } from '../services/AgentService.js';
import { getCleanupConfig, validateCleanupConfig } from '../config/cleanup.js';

const program = new Command();

program
  .name('cleanup')
  .description('Automated cleanup tool for stale agents and rooms')
  .version('1.0.0');

program
  .option('-d, --dry-run', 'Perform a dry run without actually cleaning up', false)
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--config <environment>', 'Use configuration for environment (development, production)', 'development');

program
  .command('agents')
  .description('Clean up stale agents')
  .option('-s, --stale-minutes <minutes>', 'Minutes after which agents are considered stale', '30')
  .option('--no-room-cleanup', 'Skip room cleanup when cleaning agents')
  .option('--no-notify', 'Skip participant notifications')
  .option('--max-batch <size>', 'Maximum number of agents to clean up', '50')
  .action(async (options) => {
    await runAgentCleanup({
      staleMinutes: parseInt(options.staleMinutes),
      includeRoomCleanup: options.roomCleanup !== false,
      notifyParticipants: options.notify !== false,
      dryRun: program.opts().dryRun,
      verbose: program.opts().verbose
    });
  });

program
  .command('rooms')
  .description('Clean up stale rooms')
  .option('-i, --inactive-minutes <minutes>', 'Minutes after which rooms are considered inactive', '60')
  .option('--no-empty', 'Skip empty room cleanup')
  .option('--no-inactive-participants', 'Skip rooms with no active participants')
  .option('--no-recent-messages', 'Skip rooms with no recent messages')
  .option('--no-notify', 'Skip participant notifications')
  .option('--max-batch <size>', 'Maximum number of rooms to clean up', '25')
  .action(async (options) => {
    await runRoomCleanup({
      inactiveMinutes: parseInt(options.inactiveMinutes),
      deleteEmptyRooms: options.empty !== false,
      deleteNoActiveParticipants: options.inactiveParticipants !== false,
      deleteNoRecentMessages: options.recentMessages !== false,
      notifyParticipants: options.notify !== false,
      dryRun: program.opts().dryRun,
      verbose: program.opts().verbose
    });
  });

program
  .command('comprehensive')
  .description('Run comprehensive cleanup for both agents and rooms')
  .option('-a, --agent-stale-minutes <minutes>', 'Minutes after which agents are considered stale', '30')
  .option('-r, --room-inactive-minutes <minutes>', 'Minutes after which rooms are considered inactive', '60')
  .option('--no-notify', 'Skip participant notifications')
  .action(async (options) => {
    await runComprehensiveCleanup({
      agentStaleMinutes: parseInt(options.agentStaleMinutes),
      roomInactiveMinutes: parseInt(options.roomInactiveMinutes),
      notifyParticipants: options.notify !== false,
      dryRun: program.opts().dryRun,
      verbose: program.opts().verbose
    });
  });

program
  .command('status')
  .description('Show cleanup status and configuration')
  .action(async () => {
    await showCleanupStatus({
      verbose: program.opts().verbose
    });
  });

program
  .command('validate-config')
  .description('Validate cleanup configuration')
  .action(async () => {
    await validateConfiguration({
      environment: program.opts().config
    });
  });

async function runAgentCleanup(options: {
  staleMinutes: number;
  includeRoomCleanup: boolean;
  notifyParticipants: boolean;
  dryRun: boolean;
  verbose: boolean;
}) {
  console.log('🤖 Starting agent cleanup...');
  console.log(`Configuration: ${JSON.stringify(options, null, 2)}`);

  const db = new DatabaseManager();
  try {
    await db.initialize();
    const agentService = new AgentService(db);

    const startTime = Date.now();
    const results = await agentService.cleanupStaleAgents({
      staleMinutes: options.staleMinutes,
      dryRun: options.dryRun,
      includeRoomCleanup: options.includeRoomCleanup,
      notifyParticipants: options.notifyParticipants
    });
    const duration = Date.now() - startTime;

    console.log('\\n📊 Agent Cleanup Results:');
    console.log(`   Execution time: ${duration}ms`);
    console.log(`   Dry run: ${results.dryRun ? '✅ Yes' : '❌ No'}`);
    console.log(`   Stale agents found: ${results.totalStaleAgents}`);
    console.log(`   Agents terminated: ${results.terminatedAgents}`);
    console.log(`   Failed terminations: ${results.failedTerminations}`);
    console.log(`   Rooms processed: ${results.roomsProcessed}`);
    console.log(`   Rooms cleaned: ${results.roomsCleaned}`);
    console.log(`   Errors: ${results.errors.length}`);

    if (options.verbose && results.staleAgentDetails.length > 0) {
      console.log('\\n🔍 Stale Agent Details:');
      results.staleAgentDetails.forEach((agent, index) => {
        console.log(`   ${index + 1}. ${agent.agentName} (${agent.agentId})`);
        console.log(`      Type: ${agent.agentType}`);
        console.log(`      Repository: ${agent.repositoryPath}`);
        console.log(`      Room: ${agent.roomId || 'None'}`);
        console.log(`      Last heartbeat: ${agent.lastHeartbeat || 'Never'}`);
        console.log(`      Stale duration: ${agent.staleDuration}`);
      });
    }

    if (results.errors.length > 0) {
      console.log('\\n❌ Errors:');
      results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. Agent ${error.agentId}: ${error.error}`);
      });
    }

    if (results.dryRun) {
      console.log('\\n💡 This was a dry run. Use --no-dry-run to actually perform cleanup.');
    }

  } catch (error) {
    console.error('❌ Agent cleanup failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

async function runRoomCleanup(options: {
  inactiveMinutes: number;
  deleteEmptyRooms: boolean;
  deleteNoActiveParticipants: boolean;
  deleteNoRecentMessages: boolean;
  notifyParticipants: boolean;
  dryRun: boolean;
  verbose: boolean;
}) {
  console.log('🏠 Starting room cleanup...');
  console.log(`Configuration: ${JSON.stringify(options, null, 2)}`);

  const db = new DatabaseManager();
  try {
    await db.initialize();
    const agentService = new AgentService(db);

    const startTime = Date.now();
    const results = await agentService.cleanupStaleRooms({
      inactiveMinutes: options.inactiveMinutes,
      dryRun: options.dryRun,
      notifyParticipants: options.notifyParticipants,
      deleteEmptyRooms: options.deleteEmptyRooms,
      deleteNoActiveParticipants: options.deleteNoActiveParticipants,
      deleteNoRecentMessages: options.deleteNoRecentMessages
    });
    const duration = Date.now() - startTime;

    console.log('\\n📊 Room Cleanup Results:');
    console.log(`   Execution time: ${duration}ms`);
    console.log(`   Dry run: ${results.dryRun ? '✅ Yes' : '❌ No'}`);
    console.log(`   Stale rooms found: ${results.totalStaleRooms}`);
    console.log(`   Rooms deleted: ${results.deletedRooms}`);
    console.log(`   Failed deletions: ${results.failedDeletions}`);
    console.log(`   Participants notified: ${results.notifiedParticipants}`);
    console.log(`   Errors: ${results.errors.length}`);

    if (options.verbose && results.staleRoomDetails.length > 0) {
      console.log('\\n🔍 Stale Room Details:');
      results.staleRoomDetails.forEach((room, index) => {
        console.log(`   ${index + 1}. ${room.roomName} (${room.roomId})`);
        console.log(`      Repository: ${room.repositoryPath}`);
        console.log(`      Active participants: ${room.activeParticipants}`);
        console.log(`      Total participants: ${room.totalParticipants}`);
        console.log(`      Message count: ${room.messageCount}`);
        console.log(`      Last activity: ${room.lastActivity || 'Never'}`);
        console.log(`      Staleness: ${JSON.stringify(room.staleness)}`);
      });
    }

    if (results.errors.length > 0) {
      console.log('\\n❌ Errors:');
      results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. Room ${error.roomName} (${error.roomId}): ${error.error}`);
      });
    }

    if (results.dryRun) {
      console.log('\\n💡 This was a dry run. Use --no-dry-run to actually perform cleanup.');
    }

  } catch (error) {
    console.error('❌ Room cleanup failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

async function runComprehensiveCleanup(options: {
  agentStaleMinutes: number;
  roomInactiveMinutes: number;
  notifyParticipants: boolean;
  dryRun: boolean;
  verbose: boolean;
}) {
  console.log('🔄 Starting comprehensive cleanup...');
  console.log(`Configuration: ${JSON.stringify(options, null, 2)}`);

  const db = new DatabaseManager();
  try {
    await db.initialize();
    const agentService = new AgentService(db);

    const startTime = Date.now();
    const results = await agentService.runComprehensiveCleanup({
      dryRun: options.dryRun,
      agentStaleMinutes: options.agentStaleMinutes,
      roomInactiveMinutes: options.roomInactiveMinutes,
      notifyParticipants: options.notifyParticipants
    });
    const duration = Date.now() - startTime;

    console.log('\\n📊 Comprehensive Cleanup Results:');
    console.log(`   Execution time: ${duration}ms`);
    console.log(`   Dry run: ${results.agentCleanup.dryRun ? '✅ Yes' : '❌ No'}`);
    console.log('\\n   📈 Summary:');
    console.log(`     Total agents processed: ${results.summary.totalAgentsProcessed}`);
    console.log(`     Total rooms processed: ${results.summary.totalRoomsProcessed}`);
    console.log(`     Total agents terminated: ${results.summary.totalAgentsTerminated}`);
    console.log(`     Total rooms deleted: ${results.summary.totalRoomsDeleted}`);
    console.log(`     Total errors: ${results.summary.totalErrors}`);

    if (options.verbose) {
      console.log('\\n   🤖 Agent Cleanup Details:');
      console.log(`     Stale agents found: ${results.agentCleanup.totalStaleAgents}`);
      console.log(`     Agents terminated: ${results.agentCleanup.terminatedAgents}`);
      console.log(`     Failed terminations: ${results.agentCleanup.failedTerminations}`);
      console.log(`     Agent errors: ${results.agentCleanup.errors.length}`);

      console.log('\\n   🏠 Room Cleanup Details:');
      console.log(`     Stale rooms found: ${results.roomCleanup.totalStaleRooms}`);
      console.log(`     Rooms deleted: ${results.roomCleanup.deletedRooms}`);
      console.log(`     Failed deletions: ${results.roomCleanup.failedDeletions}`);
      console.log(`     Participants notified: ${results.roomCleanup.notifiedParticipants}`);
      console.log(`     Room errors: ${results.roomCleanup.errors.length}`);
    }

    if (results.summary.totalErrors > 0) {
      console.log('\\n❌ Errors occurred during cleanup. Use --verbose for details.');
    }

    if (results.agentCleanup.dryRun) {
      console.log('\\n💡 This was a dry run. Remove --dry-run to actually perform cleanup.');
    }

  } catch (error) {
    console.error('❌ Comprehensive cleanup failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

async function showCleanupStatus(options: { verbose: boolean }) {
  console.log('📋 Cleanup Status and Configuration');

  const db = new DatabaseManager();
  try {
    await db.initialize();
    const agentService = new AgentService(db);

    // Get current configuration
    const config = agentService.getCleanupConfiguration();
    console.log('\\n⚙️  Current Configuration:');
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('\\n   🤖 Agent Settings:');
    console.log(`     Stale threshold: ${config.agents.staleMinutes} minutes`);
    console.log(`     Include room cleanup: ${config.agents.includeRoomCleanup}`);
    console.log(`     Notify participants: ${config.agents.notifyParticipants}`);
    console.log(`     Max batch size: ${config.agents.maxBatchSize}`);
    console.log(`     Grace period: ${config.agents.gracePeriodMinutes} minutes`);
    console.log('\\n   🏠 Room Settings:');
    console.log(`     Inactive threshold: ${config.rooms.inactiveMinutes} minutes`);
    console.log(`     Delete empty rooms: ${config.rooms.deleteEmptyRooms}`);
    console.log(`     Delete no active participants: ${config.rooms.deleteNoActiveParticipants}`);
    console.log(`     Delete no recent messages: ${config.rooms.deleteNoRecentMessages}`);
    console.log(`     Notify participants: ${config.rooms.notifyParticipants}`);
    console.log(`     Max batch size: ${config.rooms.maxBatchSize}`);
    console.log(`     Grace period: ${config.rooms.gracePeriodMinutes} minutes`);
    console.log(`     Preserve general rooms: ${config.rooms.preserveGeneralRooms}`);
    console.log('\\n   🔧 General Settings:');
    console.log(`     Default dry run: ${config.general.defaultDryRun}`);
    console.log(`     Log level: ${config.general.logLevel}`);
    console.log(`     Detailed logging: ${config.general.enableDetailedLogging}`);
    console.log(`     Timeout: ${config.general.timeoutMs}ms`);

    if (options.verbose) {
      // Show current statistics
      console.log('\\n📊 Current Database Statistics:');
      
      try {
        const totalAgents = await agentService.getAgentCount();
        const activeAgents = await agentService.getAgentCount(undefined, 'active');
        const staleAgents = await agentService.findStaleAgents(config.agents.staleMinutes);
        
        console.log(`   Total agents: ${totalAgents}`);
        console.log(`   Active agents: ${activeAgents}`);
        console.log(`   Stale agents (${config.agents.staleMinutes}min): ${staleAgents.length}`);
        
        // Room statistics would require additional repository methods
        console.log('   Room statistics: Available via room cleanup dry-run');
      } catch (error) {
        console.log('   Statistics temporarily unavailable');
      }
    }

  } catch (error) {
    console.error('❌ Failed to show cleanup status:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

async function validateConfiguration(options: { environment: string }) {
  console.log(`🔍 Validating cleanup configuration for environment: ${options.environment}`);

  try {
    const config = getCleanupConfig(options.environment);
    const validation = validateCleanupConfig(config);

    console.log('\\n📋 Configuration Validation Results:');
    console.log(`   Valid: ${validation.valid ? '✅ Yes' : '❌ No'}`);
    console.log(`   Errors: ${validation.errors.length}`);
    console.log(`   Warnings: ${validation.warnings.length}`);

    if (validation.errors.length > 0) {
      console.log('\\n❌ Errors:');
      validation.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    if (validation.warnings.length > 0) {
      console.log('\\n⚠️  Warnings:');
      validation.warnings.forEach((warning, index) => {
        console.log(`   ${index + 1}. ${warning}`);
      });
    }

    if (validation.valid) {
      console.log('\\n✅ Configuration is valid and ready to use.');
    } else {
      console.log('\\n❌ Configuration has errors and needs to be fixed.');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Configuration validation failed:', error);
    process.exit(1);
  }
}

// Parse command line arguments and run
program.parse();