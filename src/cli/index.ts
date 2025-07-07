#!/usr/bin/env node

import { Command } from 'commander';
import path from 'path';
import os from 'os';
import { McpServer } from '../server/McpServer.js';
import { ClaudeDatabase } from '../database/index.js';
import { AgentService, TaskService, CommunicationService, MemoryService } from '../services/index.js';

const program = new Command();

// Default data directory
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.mcptools', 'data');

program
  .name('claude-mcp-tools')
  .description('TypeScript MCP Tools for Claude Agent Orchestration')
  .version('1.0.0');

// MCP Server command
program
  .command('server')
  .description('Start the MCP server for agent orchestration')
  .option('-d, --data-dir <path>', 'Data directory for SQLite database', DEFAULT_DATA_DIR)
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      const databasePath = path.join(options.dataDir, 'claude_mcp_tools.db');
      
      if (options.verbose) {
        console.log(`📂 Using data directory: ${options.dataDir}`);
        console.log(`🗄️  Database path: ${databasePath}`);
      }

      const server = new McpServer({
        name: 'claude-mcp-tools-ts',
        version: '1.0.0',
        databasePath
      });

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n🛑 Received SIGINT, shutting down gracefully...');
        await server.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
        await server.stop();
        process.exit(0);
      });

      await server.start();
      
    } catch (error) {
      console.error('❌ Failed to start MCP server:', error);
      process.exit(1);
    }
  });

// Agent management commands
const agentCmd = program
  .command('agent')
  .description('Agent management commands');

agentCmd
  .command('list')
  .description('List all agents')
  .option('-r, --repository <path>', 'Repository path filter', process.cwd())
  .option('-s, --status <status>', 'Status filter (active, idle, completed, terminated, failed)')
  .option('-d, --data-dir <path>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (options) => {
    try {
      const db = new ClaudeDatabase({ path: path.join(options.dataDir, 'claude_mcp_tools.db') });
      await db.initialize();
      
      const agentService = new AgentService(db);
      const agents = agentService.listAgents(options.repository, options.status);

      console.log(`\n📋 Found ${agents.length} agents:\n`);
      
      if (agents.length === 0) {
        console.log('   No agents found matching criteria');
        return;
      }

      for (const agent of agents) {
        console.log(`🤖 ${agent.agent_name} (${agent.id})`);
        console.log(`   Status: ${agent.status}`);
        console.log(`   Repository: ${agent.repository_path}`);
        console.log(`   Last Heartbeat: ${agent.last_heartbeat}`);
        console.log(`   Capabilities: ${(agent.capabilities || []).join(', ')}`);
        console.log('');
      }
    } catch (error) {
      console.error('❌ Failed to list agents:', error);
      process.exit(1);
    }
  });

agentCmd
  .command('spawn')
  .description('Spawn a new agent')
  .requiredOption('-t, --type <type>', 'Agent type (backend, frontend, testing, documentation, etc.)')
  .requiredOption('-r, --repository <path>', 'Repository path')
  .requiredOption('-d, --description <desc>', 'Task description')
  .option('--data-dir <path>', 'Data directory', DEFAULT_DATA_DIR)
  .option('-c, --capabilities <caps...>', 'Agent capabilities')
  .option('--depends-on <ids...>', 'Agent IDs this agent depends on')
  .action(async (options) => {
    try {
      const db = new ClaudeDatabase({ path: path.join(options.dataDir, 'claude_mcp_tools.db') });
      await db.initialize();
      
      const agentService = new AgentService(db);
      const agent = await agentService.createAgent({
        agentName: options.type,
        repositoryPath: options.repository,
        taskDescription: options.description,
        capabilities: options.capabilities || ['ALL_TOOLS'],
        dependsOn: options.dependsOn || []
      });

      console.log(`✅ Agent spawned successfully:`);
      console.log(`   ID: ${agent.id}`);
      console.log(`   Type: ${agent.agent_name}`);
      console.log(`   Status: ${agent.status}`);
      console.log(`   PID: ${agent.claude_pid || 'Not started'}`);
    } catch (error) {
      console.error('❌ Failed to spawn agent:', error);
      process.exit(1);
    }
  });

// Task management commands
const taskCmd = program
  .command('task')
  .description('Task management commands');

taskCmd
  .command('list')
  .description('List tasks')
  .option('-r, --repository <path>', 'Repository path', process.cwd())
  .option('-s, --status <status>', 'Status filter')
  .option('-d, --data-dir <path>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (options) => {
    try {
      const db = new ClaudeDatabase({ path: path.join(options.dataDir, 'claude_mcp_tools.db') });
      await db.initialize();
      
      const taskService = new TaskService(db);
      const tasks = taskService.listTasks(options.repository, options.status);

      console.log(`\n📋 Found ${tasks.length} tasks:\n`);
      
      for (const task of tasks) {
        console.log(`📝 ${task.description.slice(0, 60)}... (${task.id})`);
        console.log(`   Status: ${task.status}`);
        console.log(`   Type: ${task.task_type}`);
        console.log(`   Priority: ${task.priority}`);
        console.log(`   Assigned to: ${task.assigned_agent_id || 'Unassigned'}`);
        console.log('');
      }
    } catch (error) {
      console.error('❌ Failed to list tasks:', error);
      process.exit(1);
    }
  });

// Memory management commands
const memoryCmd = program
  .command('memory')
  .description('Shared memory management commands');

memoryCmd
  .command('search')
  .description('Search shared memory')
  .requiredOption('-q, --query <text>', 'Search query')
  .option('-r, --repository <path>', 'Repository path', process.cwd())
  .option('-a, --agent <name>', 'Agent name filter')
  .option('-l, --limit <number>', 'Results limit', '10')
  .option('-d, --data-dir <path>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (options) => {
    try {
      const db = new ClaudeDatabase({ path: path.join(options.dataDir, 'claude_mcp_tools.db') });
      await db.initialize();
      
      const memoryService = new MemoryService(db);
      const insights = memoryService.getRelevantMemories(
        options.query,
        options.repository,
        options.agent,
        parseInt(options.limit)
      );

      console.log(`\n🧠 Found ${insights.length} relevant memories:\n`);
      
      for (const insight of insights) {
        console.log(`💡 ${insight.title} (Score: ${insight.relevanceScore})`);
        console.log(`   Agent: ${insight.agentName}`);
        console.log(`   Created: ${insight.createdAt}`);
        console.log(`   Tags: ${insight.tags.join(', ')}`);
        console.log(`   Snippet: ${insight.snippet}`);
        console.log('');
      }
    } catch (error) {
      console.error('❌ Failed to search memory:', error);
      process.exit(1);
    }
  });

// Communication commands
const roomCmd = program
  .command('room')
  .description('Communication room management');

roomCmd
  .command('list')
  .description('List communication rooms')
  .option('-r, --repository <path>', 'Repository path', process.cwd())
  .option('-d, --data-dir <path>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (options) => {
    try {
      const db = new ClaudeDatabase({ path: path.join(options.dataDir, 'claude_mcp_tools.db') });
      await db.initialize();
      
      const commService = new CommunicationService(db);
      const rooms = commService.listRooms(options.repository);

      console.log(`\n💬 Found ${rooms.length} rooms:\n`);
      
      for (const room of rooms) {
        const stats = commService.getRoomStats(room.name);
        console.log(`🏠 ${room.name}`);
        console.log(`   Description: ${room.description}`);
        console.log(`   Participants: ${stats.participantCount}`);
        console.log(`   Messages: ${stats.messageCount}`);
        console.log(`   Last Activity: ${stats.lastActivity || 'Never'}`);
        console.log('');
      }
    } catch (error) {
      console.error('❌ Failed to list rooms:', error);
      process.exit(1);
    }
  });

// Status and health commands
program
  .command('status')
  .description('Show system status')
  .option('-d, --data-dir <path>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (options) => {
    try {
      const db = new ClaudeDatabase({ path: path.join(options.dataDir, 'claude_mcp_tools.db') });
      await db.initialize();
      
      // Get counts from services
      const agentService = new AgentService(db);
      const taskService = new TaskService(db);
      const memoryService = new MemoryService(db);
      
      // This would need the repository path, but for status we'll skip it
      console.log(`\n📊 Claude MCP Tools Status:\n`);
      console.log(`   Database: Connected`);
      console.log(`   Data Directory: ${options.dataDir}`);
      console.log(`   Version: 1.0.0`);
      console.log('');
      console.log(`   For detailed statistics, use specific commands with --repository flag`);
      
    } catch (error) {
      console.error('❌ Failed to get status:', error);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();

// If no command specified, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}