import { Command } from "commander";
import path from "path";
import { fileURLToPath } from "url";
import { McpToolsServer } from "../server/McpServer.js";
import { DatabaseManager } from "../database/index.js";
import {
  TaskService,
  CommunicationService,
  MemoryService,
} from "../services/index.js";
import { pathResolver } from "../utils/pathResolver.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

// Default data directory - uses pathResolver for project-local support (issue #6)
const DEFAULT_DATA_DIR = path.dirname(pathResolver.getDatabasePath());

// Colors for console output
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

program
  .name("zmcp-tools")
  .description("TypeScript MCP Tools for Claude Agent Orchestration")
  .version("1.0.0");

// MCP Server command
program
  .command("server")
  .description("Start the MCP server for agent orchestration")
  .option(
    "-d, --data-dir <path>",
    "Data directory for SQLite database",
    DEFAULT_DATA_DIR
  )
  .option("-p, --port <number>", "HTTP port for the MCP server", "4269")
  .option("-h, --host <address>", "HTTP host for the MCP server", "127.0.0.1")
  .option("-v, --verbose", "Enable verbose logging")
  .action(async (options) => {
    try {
      const databasePath = path.join(options.dataDir, "claude_mcp_tools.db");

      if (options.verbose) {
        console.log(`📂 Using data directory: ${options.dataDir}`);
        console.log(`🗄️  Database path: ${databasePath}`);
      }

      const server = new McpToolsServer({
        name: "zmcp-tools-ts",
        version: "1.0.0",
        databasePath,
        repositoryPath: process.cwd(),
        httpPort: parseInt(options.port),
        httpHost: options.host,
      });

      // Handle graceful shutdown
      process.on("SIGINT", async () => {
        console.log("\n🛑 Received SIGINT, shutting down gracefully...");
        await server.stop();
        process.exit(0);
      });

      process.on("SIGTERM", async () => {
        console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
        await server.stop();
        process.exit(0);
      });

      await server.start();
    } catch (error) {
      console.error("❌ Failed to start MCP server:", error);
      process.exit(1);
    }
  });

program.parse(process.argv);

