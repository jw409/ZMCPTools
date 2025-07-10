/**
 * Claude MCP Tools - TypeScript Implementation
 * 
 * Main entry point for the MCP server that provides agent orchestration
 * capabilities for Claude Code environments.
 */

import { McpServer } from './server/McpServer.js';
import { CrashHandler, wrapMainServer } from './utils/crashHandler.js';
import path from 'path';
import os from 'os';

// Default configuration
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.mcptools', 'data');

async function mainServer() {
  // Get data directory from environment or use default
  const dataDir = process.env.MCPTOOLS_DATA_DIR || DEFAULT_DATA_DIR;
  const databasePath = path.join(dataDir, 'claude_mcp_tools.db');

  // MCP servers must not output to stdout - using stderr for startup messages
  process.stderr.write('🚀 Starting Claude MCP Tools TypeScript Server...\n');
  process.stderr.write(`📁 Data directory: ${dataDir}\n`);
  process.stderr.write(`🗃️ Database path: ${databasePath}\n`);

  // Create the MCP server
  const server = new McpServer({
    name: 'claude-mcp-tools',
    version: '1.0.0',
    databasePath
  });

  // Set up crash handler with database manager for handling active jobs
  const crashHandler = CrashHandler.getInstance();
  crashHandler.setDatabaseManager(server.getDatabaseManager());

  // Handle graceful shutdown
  const shutdown = async () => {
    process.stderr.write('\n🛑 Shutting down gracefully...\n');
    try {
      await server.stop();
      process.stderr.write('✅ Server stopped successfully\n');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      const crashHandler = CrashHandler.getInstance();
      crashHandler.logError(error instanceof Error ? error : new Error(String(error)), {
        phase: 'shutdown',
        serverName: 'claude-mcp-tools-ts'
      });
      process.exit(1);
    }
  };

  // Set up shutdown handlers (these will be overridden by CrashHandler but good for redundancy)
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start the server
  process.stderr.write('🔌 Connecting to MCP transport...\n');
  await server.start();
  process.stderr.write('✅ Claude MCP Tools server started successfully\n');
  process.stderr.write('📡 Ready to receive MCP requests\n');
}

async function main() {
  try {
    // Initialize crash handler FIRST
    const crashHandler = CrashHandler.getInstance();
    crashHandler.setupGlobalHandlers();
    
    process.stderr.write(`💾 Crash logs will be stored in: ${crashHandler.getCrashLogDir()}\n`);

    // Wrap the main server function with crash handling
    const wrappedMainServer = wrapMainServer(mainServer, 'claude-mcp-tools-ts');
    
    // Start the server with crash handling
    await wrappedMainServer();

  } catch (error) {
    process.stderr.write(`❌ Failed to start Claude MCP Tools server: ${error}\n`);
    
    // Log the startup error
    const crashHandler = CrashHandler.getInstance();
    crashHandler.logError(error instanceof Error ? error : new Error(String(error)), {
      phase: 'startup',
      serverName: 'claude-mcp-tools-ts'
    });
    
    process.exit(1);
  }
}

// Only run main if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}