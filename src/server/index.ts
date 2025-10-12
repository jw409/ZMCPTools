#!/usr/bin/env node
/**
 * ZMCPTools MCP Server Entry Point
 *
 * This file serves as the main executable entry point for the MCP server.
 * It can be invoked directly to start the server with stdio transport,
 * or imported as a module to use the McpToolsServer class programmatically.
 */

import { McpToolsServer, type McpServerOptions } from "./McpServer.js";
import { pathResolver } from "../utils/pathResolver.js";

// Re-export for programmatic use
export { McpToolsServer, type McpServerOptions };

// Only run server if this file is executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const databasePath = pathResolver.getDatabasePath();

  const server = new McpToolsServer({
    name: "zmcp-tools",
    version: "0.4.1",
    databasePath,
    repositoryPath: process.cwd(),
    transport: "stdio", // Default to stdio for MCP standard compliance
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      process.stderr.write(`Error during shutdown: ${error}\n`);
      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start the server
  server.start().catch((error) => {
    process.stderr.write(`Failed to start MCP server: ${error}\n`);
    process.exit(1);
  });
}
