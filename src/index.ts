/**
 * ZMCPTools - TypeScript Implementation
 * 
 * Main entry point for the MCP server that provides agent orchestration
 * capabilities for Claude Code environments.
 */

import { McpToolsServer } from './server/McpServer.js';
import { CrashHandler, wrapMainServer } from './utils/crashHandler.js';
import path from 'path';
import './TEST_LOCAL_VERSION.js';
import os from 'os';
import { pathResolver } from './utils/pathResolver.js';
import { mkdirSync } from 'fs';

// Export key components for testing and external use
export { ClaudeProcess, ClaudeSpawner, ProcessReaper } from './process/index.js';
export type { ClaudeSpawnConfig } from './process/index.js';

async function mainServer() {
  // Parse command line arguments for transport options
  const args = process.argv.slice(2);
  const transportIndex = args.indexOf('--transport');
  const portIndex = args.indexOf('--port');
  const hostIndex = args.indexOf('--host');

  const transport = (transportIndex !== -1 && args[transportIndex + 1]) ? args[transportIndex + 1] : 'stdio';
  const httpPort = (portIndex !== -1 && args[portIndex + 1]) ? parseInt(args[portIndex + 1]) : 4269;
  const httpHost = (hostIndex !== -1 && args[hostIndex + 1]) ? args[hostIndex + 1] : '127.0.0.1';

  // Use PathResolver for project-local database support
  const databasePath = pathResolver.getDatabasePath();
  const isLocal = pathResolver.isUsingLocalDatabase();

  // Ensure directory exists for project-local databases
  if (isLocal) {
    const dbDir = path.dirname(databasePath);
    mkdirSync(dbDir, { recursive: true });
  }

  // MCP servers must not output to stdout - using stderr for startup messages
  process.stderr.write('🚀 Starting ZMCPTools TypeScript Server...\n');
  process.stderr.write(`🗃️  Database: ${databasePath}\n`);
  process.stderr.write(`📂 Storage mode: ${isLocal ? 'PROJECT-LOCAL' : 'GLOBAL'}\n`);
  if (!isLocal) {
    process.stderr.write(`💡 To use project-local storage: export ZMCP_USE_LOCAL_DB=true\n`);
  }
  process.stderr.write(`🌐 Transport: ${transport.toUpperCase()}\n`);
  if (transport === 'http') {
    process.stderr.write(`🌐 HTTP Host: ${httpHost}:${httpPort}\n`);
  }

  // Create the MCP server
  const server = new McpToolsServer({
    name: 'zmcp-tools',
    version: '1.0.0',
    databasePath,
    transport: transport as 'http' | 'stdio',
    httpPort,
    httpHost
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
        serverName: 'zmcp-tools-ts'
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
  process.stderr.write('✅ ZMCPTools server started successfully\n');
  process.stderr.write('📡 Ready to receive MCP requests\n');
}

async function main() {
  try {
    // Initialize crash handler FIRST
    const crashHandler = CrashHandler.getInstance();
    crashHandler.setupGlobalHandlers();
    
    process.stderr.write(`💾 Crash logs will be stored in: ${crashHandler.getCrashLogDir()}\n`);

    // Wrap the main server function with crash handling
    const wrappedMainServer = wrapMainServer(mainServer, 'zmcp-tools');
    
    // Start the server with crash handling
    await wrappedMainServer();

  } catch (error) {
    process.stderr.write(`❌ Failed to start ZMCPTools server: ${error}\n`);
    
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