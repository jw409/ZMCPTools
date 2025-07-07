#!/usr/bin/env node

/**
 * Claude MCP Tools - TypeScript Implementation
 * 
 * Main entry point for the MCP server that provides agent orchestration
 * capabilities for Claude Code environments.
 */

import { McpServer } from './server/McpServer.js';
import path from 'path';
import os from 'os';

// Default configuration
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.mcptools', 'data');

async function main() {
  try {
    // Get data directory from environment or use default
    const dataDir = process.env.MCPTOOLS_DATA_DIR || DEFAULT_DATA_DIR;
    const databasePath = path.join(dataDir, 'claude_mcp_tools.db');

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
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error);
      shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
      shutdown();
    });

    // Start the server
    await server.start();

  } catch (error) {
    console.error('❌ Failed to start Claude MCP Tools server:', error);
    process.exit(1);
  }
}

// Only run main if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}