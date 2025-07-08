#!/usr/bin/env node

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

  console.log('🚀 Starting Claude MCP Tools TypeScript Server...');
  console.log(`📁 Data directory: ${dataDir}`);
  console.log(`🗃️ Database path: ${databasePath}`);

  // Create the MCP server
  const server = new McpServer({
    name: 'claude-mcp-tools-ts',
    version: '1.0.0',
    databasePath
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Shutting down gracefully...');
    try {
      await server.stop();
      console.log('✅ Server stopped successfully');
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
  console.log('🔌 Connecting to MCP transport...');
  await server.start();
  console.log('✅ Claude MCP Tools server started successfully');
  console.log('📡 Ready to receive MCP requests');
}

async function main() {
  try {
    // Initialize crash handler FIRST
    const crashHandler = CrashHandler.getInstance();
    crashHandler.setupGlobalHandlers();
    
    console.log(`💾 Crash logs will be stored in: ${crashHandler.getCrashLogDir()}`);

    // Wrap the main server function with crash handling
    const wrappedMainServer = wrapMainServer(mainServer, 'claude-mcp-tools-ts');
    
    // Start the server with crash handling
    await wrappedMainServer();

  } catch (error) {
    console.error('❌ Failed to start Claude MCP Tools server:', error);
    
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