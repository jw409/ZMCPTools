import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import express from "express";
import http from "http";
import net from "net";
import { z } from "zod";
import {
  ErrorCode,
  McpError,
  isInitializeRequest,
  CreateMessageRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Generic result schema for all MCP tools
const GenericToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
  data: z.any().optional(),
});

type GenericToolResult = z.infer<typeof GenericToolResultSchema>;
import type {
  Tool,
  CallToolResult,
  TextContent,
  Resource,
  TextResourceContents,
  Prompt,
  GetPromptResult,
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";

import { DatabaseManager } from "../database/index.js";
import {
  AgentOrchestrationTools,
  OrchestrationResultSchema,
  SpawnAgentOptionsSchema,
  type OrchestrationResult,
} from "../tools/AgentOrchestrationTools.js";
import { WebScrapingMcpTools } from "../tools/WebScrapingMcpTools.js";
import { AnalysisMcpTools } from "../tools/AnalysisMcpTools.js";
import {
  ProjectStructureInfoSchema,
  ProjectSummarySchema,
  FileSymbolsSchema,
} from "../schemas/toolResponses.js";
import { TreeSummaryTools } from "../tools/TreeSummaryTools.js";
import { ReportProgressTool } from "../tools/ReportProgressTool.js";
// CacheMcpTools removed - foundation caching now automatic
import {
  BrowserTools,
  SessionConfigSchema,
  SessionMetadataSchema,
} from "../tools/BrowserTools.js";
import { WebScrapingService } from "../services/WebScrapingService.js";
import {
  AgentService,
  KnowledgeGraphService,
  VectorSearchService,
  FileOperationsService,
  TreeSummaryService,
  fileOperationsService,
} from "../services/index.js";
import { ResourceManager } from "../managers/ResourceManager.js";
import { PromptManager } from "../managers/PromptManager.js";
import { PathUtils } from "../utils/pathUtils.js";
import { LanceDBService } from "../services/LanceDBService.js";
import {
  KnowledgeGraphMcpTools,
  StoreKnowledgeMemorySchema,
  CreateRelationshipSchema,
  SearchKnowledgeGraphSchema,
  FindRelatedEntitiesSchema,
} from "../tools/knowledgeGraphTools.js";

export interface McpServerOptions {
  name: string;
  version: string;
  databasePath?: string;
  repositoryPath?: string;
  transport?: "stdio" | "http";
  httpPort?: number;
  httpHost?: string;
}

export class McpToolsServer {
  private server: McpServer;
  private db: DatabaseManager;
  private orchestrationTools: AgentOrchestrationTools;
  private browserTools: BrowserTools;
  private webScrapingMcpTools: WebScrapingMcpTools;
  private webScrapingService: WebScrapingService;
  private analysisMcpTools: AnalysisMcpTools;
  private knowledgeGraphMcpTools: KnowledgeGraphMcpTools;
  private treeSummaryTools: TreeSummaryTools;
  private reportProgressTool: ReportProgressTool;
  // cacheMcpTools removed - foundation caching now automatic
  private fileOperationsService: FileOperationsService;
  private treeSummaryService: TreeSummaryService;
  private resourceManager: ResourceManager;
  private promptManager: PromptManager;
  private lanceDBManager: LanceDBService;
  private repositoryPath: string;
  private httpServer?: http.Server;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } =
    {};
  private lastClientActivity: number = Date.now();
  private inactivityTimer?: NodeJS.Timeout;

  /**
   * Start the inactivity timer that will shutdown the server if no client activity for 10 minutes
   */
  private startInactivityTimer(): void {
    const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds
    
    this.inactivityTimer = setInterval(() => {
      const timeSinceLastActivity = Date.now() - this.lastClientActivity;
      const hasActiveSessions = Object.keys(this.transports).length > 0;
      
      if (timeSinceLastActivity >= INACTIVITY_TIMEOUT && !hasActiveSessions) {
        process.stderr.write(`💀 Server has been inactive for 10 minutes with no active sessions. Shutting down...\n`);
        process.exit(0);
      }
    }, 60000); // Check every minute
  }

  /**
   * Update the last client activity timestamp
   */
  private updateClientActivity(): void {
    this.lastClientActivity = Date.now();
  }

  /**
   * Stop the inactivity timer
   */
  private stopInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = undefined;
    }
  }

  constructor(private options: McpServerOptions) {
    this.repositoryPath = PathUtils.resolveRepositoryPath(
      options.repositoryPath || process.cwd(),
      "McpServer"
    );

    // Mark this as the main MCP process for database initialization
    process.env.MCP_MAIN_PROCESS = "true";

    this.server = new McpServer(
      {
        name: options.name,
        version: options.version,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          sampling: {},
          notifications: {
            progress: true,
          },
        },
      }
    );

    // Initialize database with optimized settings for main process
    this.db = new DatabaseManager({
      path: options.databasePath,
      wal: true,
      busyTimeoutMs: 30000,
      checkpointIntervalMs: 60000,
      verbose: process.env.NODE_ENV === "development",
    });

    // Initialize services
    const agentService = new AgentService(this.db);
    const vectorService = new VectorSearchService(this.db);
    const knowledgeGraphService = new KnowledgeGraphService(
      this.db,
      vectorService
    );
    this.webScrapingService = new WebScrapingService(
      this.db,
      this.repositoryPath
    );

    // Initialize file operations and tree summary services
    this.fileOperationsService = fileOperationsService; // Use singleton instance
    this.treeSummaryService = new TreeSummaryService();

    // Initialize tools
    this.orchestrationTools = new AgentOrchestrationTools(
      this.db,
      this.repositoryPath
    );

    this.browserTools = new BrowserTools(
      knowledgeGraphService,
      this.repositoryPath,
      this.db
    );
    this.webScrapingMcpTools = new WebScrapingMcpTools(
      this.webScrapingService,
      knowledgeGraphService,
      this.repositoryPath,
      this.db
    );
    this.analysisMcpTools = new AnalysisMcpTools(
      knowledgeGraphService,
      this.repositoryPath
    );
    this.knowledgeGraphMcpTools = new KnowledgeGraphMcpTools(this.db);
    this.treeSummaryTools = new TreeSummaryTools();
    this.reportProgressTool = new ReportProgressTool(this.db);
    // Foundation caching is now automatic - no manual tools needed

    // Initialize managers
    this.resourceManager = new ResourceManager(this.db, this.repositoryPath);
    this.promptManager = new PromptManager();
    this.lanceDBManager = new LanceDBService(this.db, {
      // LanceDB is embedded - no server configuration needed
    });

    this.setupMcpHandlers();

    // Setup graceful shutdown handlers
    this.setupShutdownHandlers();

    // Make server instance available for sampling requests
    (globalThis as any).mcpServer = this;
  }

  private setupShutdownHandlers(): void {
    // Handle process termination signals
    const shutdown = async () => {
      await this.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("SIGQUIT", shutdown);
  }

  private setupMcpHandlers(): void {
    // Register all tools using registerTool
    this.registerAllTools();
    this.registerAllResources();
    this.registerAllPrompts();
  }

  private registerAllTools(): void {
    // Get all available tools and register them
    const allTools = this.getAvailableTools();

    allTools.forEach((tool) => {
      this.server.registerTool(
        tool.name,
        {
          title: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema.shape,
          ...(tool.outputSchema && { outputSchema: tool.outputSchema.shape }),
        },
        async (args: any) => {
          try {
            const result = await this.routeToolCall(tool.name, args);

            // Return proper CallToolResult format
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result, null, 2),
                },
              ],
              isError: false,
            };
          } catch (error) {
            // Return error as CallToolResult instead of throwing
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`,
                },
              ],
              isError: true,
            };
          }
        }
      );
    });
  }

  private async routeToolCall(name: string, args: any): Promise<any> {
    // Check browser tools first
    const browserToolNames = this.browserTools.getTools().map((t) => t.name);
    if (browserToolNames.includes(name)) {
      return await this.browserTools.handleToolCall(name, args);
    }

    // Check web scraping tools
    const scrapingToolNames = this.webScrapingMcpTools
      .getTools()
      .map((t) => t.name);
    if (scrapingToolNames.includes(name)) {
      return await this.webScrapingMcpTools.handleToolCall(name, args);
    }

    // Check analysis tools
    const analysisToolNames = this.analysisMcpTools
      .getTools()
      .map((t) => t.name);
    if (analysisToolNames.includes(name)) {
      return await this.analysisMcpTools.handleToolCall(name, args);
    }

    // Check knowledge graph tools
    const knowledgeGraphToolNames = this.knowledgeGraphMcpTools
      .getTools()
      .map((t) => t.name);
    if (knowledgeGraphToolNames.includes(name)) {
      return await this.knowledgeGraphMcpTools.handleToolCall(name, args);
    }

    // Check TreeSummary tools
    const treeSummaryToolNames = this.treeSummaryTools
      .getTools()
      .map((t) => t.name);
    if (treeSummaryToolNames.includes(name)) {
      return await this.treeSummaryTools.handleToolCall(name, args);
    }

    // Handle orchestration and progress tools
    return await this.handleToolCall(name, args);
  }

  private registerAllResources(): void {
    const resources = this.resourceManager.listResources();
    resources.forEach((resource) => {
      this.server.registerResource(
        resource.name,
        resource.uriTemplate,
        {
          description: resource.description,
          mimeType: resource.mimeType,
        },
        async (uri: URL) => {
          try {
            const uriString = uri.toString();
            process.stderr.write(
              `🔍 Reading resource: ${resource.name} with uri: ${uriString}\n`
            );
            const result = await this.resourceManager.readResource(uriString);
            
            // Return the result directly as it already has the correct structure
            // with uri, mimeType, and text fields
            return {
              contents: [result],
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            return {
              contents: [
                {
                  uri: uri.toString(),
                  mimeType: "text/plain",
                  text: `Error: ${errorMessage}`,
                },
              ],
            };
          }
        }
      );
    });
  }

  private registerAllPrompts(): void {
    const prompts = this.promptManager.listPrompts();
    prompts.forEach((prompt) => {
      // Convert arguments to proper Zod schema format
      const argsSchema: Record<string, any> = {};
      if (prompt.arguments) {
        prompt.arguments.forEach(arg => {
          // Create Zod string schema with description
          let schema: z.ZodString | z.ZodOptional<z.ZodString> = z.string().describe(arg.description || '');
          
          // Make it optional if not required
          if (arg.required === false) {
            schema = schema.optional();
          }
          
          argsSchema[arg.name] = schema;
        });
      }

      this.server.registerPrompt(
        prompt.name,
        {
          description: prompt.description,
          argsSchema: Object.keys(argsSchema).length > 0 ? argsSchema : undefined
        },
        async (args: any) => {
          try {
            const result = await this.promptManager.getPrompt(
              prompt.name,
              args
            );
            return result;
          } catch (error) {
            throw new Error(
              error instanceof Error ? error.message : "Unknown error"
            );
          }
        }
      );
    });
  }

  public getAvailableTools() {
    return [
      // Browser automation tools
      ...this.browserTools.getTools(),
      // Web scraping tools
      ...this.webScrapingMcpTools.getTools(),
      // Analysis and file operation tools
      ...this.analysisMcpTools.getTools(),
      // Knowledge graph tools
      ...this.knowledgeGraphMcpTools.getTools(),
      // TreeSummary tools
      ...this.treeSummaryTools.getTools(),
      // Agent orchestration tools
      ...this.orchestrationTools.getTools(),
      // Progress reporting tool
      ...this.reportProgressTool.getTools(),
    ];
  }

  private async handleToolCall(
    name: string,
    args: any,
    progressContext?: {
      progressToken: string | number;
      sendNotification: (notification: any) => Promise<void>;
    }
  ): Promise<any> {
    // Handle orchestration and progress tools only
    switch (name) {
      case "orchestrate_objective":
        return await this.orchestrationTools.orchestrateObjective(
          args.title,
          args.objective,
          args.repository_path,
          args.foundation_session_id
        );

      case "spawn_agent":
        return await this.orchestrationTools.spawnAgent({
          agentType: args.agent_type,
          repositoryPath: args.repository_path,
          taskDescription: args.task_description,
          capabilities: args.capabilities,
          dependsOn: args.depends_on,
          metadata: args.metadata,
        });

      case "create_task":
        return await this.orchestrationTools.createTask(
          args.repository_path,
          args.task_type,
          args.title,
          args.description,
          args.requirements,
          args.dependencies
        );

      case "join_room":
        return await this.orchestrationTools.joinRoom(
          args.room_name,
          args.agent_name
        );

      case "send_message":
        return await this.orchestrationTools.sendMessage(
          args.room_name,
          args.agent_name,
          args.message,
          args.mentions
        );

      case "wait_for_messages":
        return await this.orchestrationTools.waitForMessages(
          args.room_name,
          args.timeout || 30000,
          args.since_timestamp ? new Date(args.since_timestamp) : undefined
        );

      case "store_memory":
        return await this.orchestrationTools.storeMemory(
          args.repository_path,
          args.agent_id,
          args.entry_type,
          args.title,
          args.content,
          args.tags
        );

      case "search_memory":
        return await this.orchestrationTools.searchMemory(
          args.repository_path,
          args.query_text,
          args.agent_id,
          args.limit || 10
        );

      case "list_agents":
        return await this.orchestrationTools.listAgents(
          args.repository_path,
          args.status,
          args.limit || 5,
          args.offset || 0
        );

      case "terminate_agent":
        return await this.orchestrationTools.terminateAgent(args.agent_ids);

      case "close_room":
        return await this.orchestrationTools.closeRoom(
          args.room_name,
          args.terminate_agents ?? true
        );

      case "delete_room":
        return await this.orchestrationTools.deleteRoom(
          args.room_name,
          args.force_delete ?? false
        );

      case "list_rooms":
        return await this.orchestrationTools.listRooms(
          args.repository_path,
          args.status || "all",
          args.limit || 20,
          args.offset || 0
        );

      case "list_room_messages":
        return await this.orchestrationTools.listRoomMessages(
          args.room_name,
          args.limit || 50,
          args.offset || 0,
          args.since_timestamp
        );

      case "create_delayed_room":
        return await this.orchestrationTools.createDelayedRoom(
          args.agent_id,
          args.repository_path,
          args.reason,
          args.participants || []
        );

      case "analyze_coordination_patterns":
        return await this.orchestrationTools.analyzeCoordinationPatterns(
          args.repository_path
        );

      case "monitor_agents":
        return await this.orchestrationTools.monitorAgents(
          args.agent_id,
          args.orchestration_id,
          args.room_name,
          args.repository_path,
          args.monitoring_mode || "status",
          args.update_interval || 2000,
          args.max_duration || 50000,
          args.detail_level || "summary",
          progressContext
        );

      case "report_progress":
        return await this.reportProgressTool.reportProgress({
          agentId: args.agent_id,
          repositoryPath: args.repository_path,
          progressType: args.progress_type,
          message: args.message,
          taskId: args.task_id,
          progressPercentage: args.progress_percentage,
          results: args.results,
          error: args.error,
          roomId: args.room_id,
          broadcastToRoom: args.broadcast_to_room ?? true,
        });

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async start(): Promise<void> {
    // MCP servers must not output to stdout - using stderr for startup messages
    process.stderr.write("🚀 Starting Claude MCP Tools Server...\n");

    // Initialize database
    await this.db.initialize();
    process.stderr.write("✅ Database initialized\n");

    // Initialize LanceDB connection
    process.stderr.write("🔍 Connecting to LanceDB...\n");
    const lanceResult = await this.lanceDBManager.initialize();
    if (lanceResult.success) {
      process.stderr.write("✅ LanceDB connected successfully\n");
    } else {
      process.stderr.write(
        `⚠️ LanceDB failed to connect: ${lanceResult.error}\n`
      );
      process.stderr.write("📝 Vector search features will be unavailable\n");
    }

    // Start the MCP server with appropriate transport
    const transportType = this.options.transport || "http";
    if (transportType === "http") {
      await this.startHttpTransport();
    } else {
      await this.startStdioTransport();
    }

    // Start background scraping worker
    process.stderr.write("🤖 Starting background scraping worker...\n");
    try {
      await this.webScrapingService.startScrapingWorker();
      process.stderr.write("✅ Background scraping worker started\n");
    } catch (error) {
      process.stderr.write(`⚠️ Failed to start scraping worker: ${error}\n`);
    }

    process.stderr.write("✅ MCP Server started successfully\n");
    const transportMsg =
      transportType === "http"
        ? `📡 Listening for MCP requests on HTTP port ${
            this.options.httpPort || 4269
          }...\n`
        : "📡 Listening for MCP requests on stdio...\n";
    process.stderr.write(transportMsg);

    // Start inactivity timer for HTTP transport
    if (transportType === "http") {
      this.startInactivityTimer();
      process.stderr.write("⏰ Inactivity timer started (10 minute timeout)\n");
    }
  }

  /**
   * Start MCP server with stdio transport
   */
  private async startStdioTransport(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Check if MCP server is already running on the specified port
   */
  private async isServerRunning(host: string, port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://${host}:${port}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000), // 2 second timeout
      });

      if (response.ok) {
        const health = await response.json();
        return (
          health.status === "ok" &&
          (health.protocol === "mcp" || health.transport === "http")
        );
      }
      return false;
    } catch (error) {
      return false; // Server not running or not reachable
    }
  }

  /**
   * Common ports to avoid when finding available ports
   */
  private readonly COMMON_PORTS = new Set([
    21,
    22,
    23,
    25,
    53,
    80,
    110,
    143,
    443,
    993,
    995, // Standard protocols
    3000,
    3001,
    8000,
    8080,
    8443,
    8888,
    9000, // Common dev ports
    5432,
    3306,
    1433,
    5984,
    6379,
    27017, // Database ports
    25565,
    19132, // Minecraft
    5000,
    5001, // Flask default
    4200, // Angular CLI
    3030, // Express common
    8081,
    8082,
    8083,
    8084,
    8085, // Common alt HTTP ports
  ]);

  /**
   * Check if a port is available (cross-platform)
   */
  private async isPortAvailable(port: number, host: string): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", () => {
        resolve(false);
      });

      server.once("listening", () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port, host);
    });
  }

  /**
   * Find an available port avoiding common ports
   */
  private async findAvailablePort(
    preferredPort: number,
    host: string
  ): Promise<number> {
    // Try the preferred port first if it's not a common port
    if (
      !this.COMMON_PORTS.has(preferredPort) &&
      (await this.isPortAvailable(preferredPort, host))
    ) {
      return preferredPort;
    }

    if (this.COMMON_PORTS.has(preferredPort)) {
      process.stderr.write(
        `⚠️  Port ${preferredPort} is a common port, finding alternative...\n`
      );
    } else {
      process.stderr.write(
        `⚠️  Port ${preferredPort} is busy, finding alternative...\n`
      );
    }

    // Try a range of uncommon ports starting from 49152 (dynamic/private port range)
    const startPort = Math.max(49152, preferredPort);
    for (let i = 0; i < 100; i++) {
      const port = startPort + i;
      if (
        !this.COMMON_PORTS.has(port) &&
        (await this.isPortAvailable(port, host))
      ) {
        process.stderr.write(`ℹ️  Using port ${port} instead\n`);
        return port;
      }
    }

    // Fallback: get a random available port from the OS
    return new Promise((resolve, reject) => {
      const server = net.createServer();

      server.once("error", (err) => {
        reject(err);
      });

      server.once("listening", () => {
        const address = server.address();
        if (address && typeof address === "object") {
          const randomPort = address.port;
          server.close(() => {
            process.stderr.write(`ℹ️  Using OS-assigned port ${randomPort}\n`);
            resolve(randomPort);
          });
        } else {
          server.close(() => {
            reject(new Error("Failed to get random port"));
          });
        }
      });

      server.listen(0, host);
    });
  }

  /**
   * Set up signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const handleShutdown = async (signal: string) => {
      process.stderr.write(
        `\n🚨 Received ${signal}, shutting down gracefully...\n`
      );
      await this.shutdown();
      process.exit(0);
    };

    // Handle various termination signals
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGHUP", () => handleShutdown("SIGHUP"));

    // Handle uncaught exceptions gracefully
    process.on("uncaughtException", async (error) => {
      process.stderr.write(`❌ Uncaught exception: ${error.message}\n`);
      await this.shutdown();
      process.exit(1);
    });

    process.on("unhandledRejection", async (reason, promise) => {
      process.stderr.write(
        `❌ Unhandled rejection at: ${promise}, reason: ${reason}\n`
      );
      await this.shutdown();
      process.exit(1);
    });
  }

  /**
   * Graceful shutdown
   */
  private async shutdown(): Promise<void> {
    process.stderr.write("🔄 Shutting down MCP server...\n");

    try {
      // Stop inactivity timer
      this.stopInactivityTimer();
      
      // Close HTTP server if running
      if (this.httpServer) {
        await new Promise<void>((resolve, reject) => {
          this.httpServer!.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        process.stderr.write("✅ HTTP server closed\n");
      }

      // Close database connections
      if (this.db) {
        this.db.close();
        process.stderr.write("✅ Database connections closed\n");
      }

      // Stop background services
      if (
        this.webScrapingService &&
        typeof this.webScrapingService.stopScrapingWorker === "function"
      ) {
        await this.webScrapingService.stopScrapingWorker();
        process.stderr.write("✅ Background services stopped\n");
      }
    } catch (error) {
      process.stderr.write(`⚠️  Error during shutdown: ${error}\n`);
    }
  }

  /**
   * Start MCP server with HTTP transport using StreamableHTTPServerTransport
   */
  private async startHttpTransport(): Promise<void> {
    const preferredPort = this.options.httpPort || 4269;
    const host = this.options.httpHost || "127.0.0.1";

    // Find an available port
    const port = await this.findAvailablePort(preferredPort, host);

    // Set up signal handlers for graceful shutdown
    this.setupSignalHandlers();

    // Create raw HTTP server
    this.httpServer = http.createServer(async (req, res) => {
      const requestId = randomUUID().slice(0, 8);
      const timestamp = new Date().toISOString();
      
      // Update client activity timestamp
      this.updateClientActivity();
      
      // Log incoming request
      process.stderr.write(`[${timestamp}] [${requestId}] --> ${req.method} ${req.url}\n`);
      process.stderr.write(`[${timestamp}] [${requestId}] Headers: ${JSON.stringify(req.headers)}\n`);
      
      try {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
        res.setHeader('Vary', 'Origin');

        // Handle OPTIONS requests
        if (req.method === 'OPTIONS') {
          process.stderr.write(`[${timestamp}] [${requestId}] <-- 200 OPTIONS response\n`);
          res.writeHead(200);
          res.end();
          return;
        }

        // Parse URL and method
        const url = new URL(req.url!, `http://${req.headers.host}`);
        
        if (url.pathname === '/health') {
          const healthResponse = { status: "ok", transport: "http", protocol: "mcp" };
          process.stderr.write(`[${timestamp}] [${requestId}] <-- 200 Health check: ${JSON.stringify(healthResponse)}\n`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(healthResponse));
          return;
        }

        // Handle OAuth discovery endpoints (Claude Code expects these)
        if (url.pathname === '/.well-known/oauth-protected-resource') {
          const oauthResponse = {
            resource_registration_endpoint: `http://${req.headers.host}/register`,
            introspection_endpoint: `http://${req.headers.host}/introspect`,
            revocation_endpoint: `http://${req.headers.host}/revoke`
          };
          process.stderr.write(`[${timestamp}] [${requestId}] <-- 200 OAuth protected resource discovery: ${JSON.stringify(oauthResponse)}\n`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(oauthResponse));
          return;
        }

        if (url.pathname === '/.well-known/oauth-authorization-server') {
          const authServerResponse = {
            issuer: `http://${req.headers.host}`,
            authorization_endpoint: `http://${req.headers.host}/authorize`,
            token_endpoint: `http://${req.headers.host}/token`,
            userinfo_endpoint: `http://${req.headers.host}/userinfo`,
            registration_endpoint: `http://${req.headers.host}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
            token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
            scopes_supported: ["mcp"]
          };
          process.stderr.write(`[${timestamp}] [${requestId}] <-- 200 OAuth authorization server discovery: ${JSON.stringify(authServerResponse)}\n`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(authServerResponse));
          return;
        }

        // Handle OAuth registration endpoint
        if (url.pathname === '/register') {
          if (req.method === 'POST') {
            // Claude Code OAuth client registration
            const registrationResponse = {
              client_id: "claude-code-" + randomUUID().slice(0, 8),
              client_secret: randomUUID(),
              registration_access_token: randomUUID(),
              registration_client_uri: `http://${req.headers.host}/register`,
              client_id_issued_at: Math.floor(Date.now() / 1000),
              token_endpoint_auth_method: "none",
              grant_types: ["authorization_code"],
              response_types: ["code"],
              redirect_uris: [`http://${req.headers.host}/callback`],
              scope: "mcp"
            };
            process.stderr.write(`[${timestamp}] [${requestId}] <-- 200 OAuth client registration: ${JSON.stringify(registrationResponse)}\n`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(registrationResponse));
            return;
          } else if (req.method === 'GET') {
            // Return client info or registration form
            const clientInfoResponse = {
              message: "OAuth client registration endpoint",
              supported_methods: ["POST"],
              registration_endpoint: `http://${req.headers.host}/register`
            };
            process.stderr.write(`[${timestamp}] [${requestId}] <-- 200 Registration info: ${JSON.stringify(clientInfoResponse)}\n`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(clientInfoResponse));
            return;
          }
        }

      if (url.pathname === '/mcp' || url.pathname === '/') {
        if (req.method === 'POST') {
          // Parse request body
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              process.stderr.write(`[${timestamp}] [${requestId}] Body: ${body}\n`);
              const requestData = JSON.parse(body);
              process.stderr.write(`[${timestamp}] [${requestId}] Parsed request: ${JSON.stringify(requestData)}\n`);
              const sessionId = (req.headers["mcp-session-id"] || requestData.id) as string | undefined;
              process.stderr.write(`[${timestamp}] [${requestId}] Session ID: ${sessionId || 'none'}\n`);
              let transport: StreamableHTTPServerTransport;

              if (sessionId && this.transports[sessionId]) {
                // Reuse existing transport
                transport = this.transports[sessionId];
              } else if (!sessionId && isInitializeRequest(requestData)) {
                // New initialization request - create transport with session management
                transport = new StreamableHTTPServerTransport({
                  sessionIdGenerator: () => randomUUID(),
                  onsessioninitialized: (sessionId) => {
                    // Store the transport by session ID/compac
                    this.transports[sessionId] = transport;
                  },
                  enableDnsRebindingProtection: false,
                  allowedHosts: ["127.0.0.1", "localhost", "127.0.0.1:4269", "localhost:4269"],
                });

                // Clean up transport when closed
                transport.onclose = () => {
                  if (transport.sessionId) {
                    delete this.transports[transport.sessionId];
                  }
                };

                // Connect the MCP server to this transport
                await this.server.connect(transport);
              } else {
                // Invalid request
                const errorResponse = {
                  jsonrpc: "2.0",
                  error: {
                    code: -32000,
                    message: "Bad Request: No valid session ID provided",
                  },
                  id: requestData.id || null,
                };
                process.stderr.write(`[${timestamp}] [${requestId}] <-- 400 Invalid request: ${JSON.stringify(errorResponse)}\n`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(errorResponse));
                return;
              }

              // Handle the request using StreamableHTTPServerTransport
              process.stderr.write(`[${timestamp}] [${requestId}] Calling transport.handleRequest...\n`);
              await transport.handleRequest(req, res, requestData);
              process.stderr.write(`[${timestamp}] [${requestId}] <-- Transport handled request successfully\n`);
            } catch (error) {
              process.stderr.write(`[${timestamp}] [${requestId}] ERROR: ${error}\n`);
              const errorResponse = {
                jsonrpc: "2.0",
                error: {
                  code: -32603,
                  message: "Internal server error",
                  data: String(error)
                },
                id: null
              };
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(errorResponse));
            }
          });
          return;
        } else if (req.method === 'GET' || req.method === 'DELETE') {
          // Handle GET/DELETE requests for session management
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          process.stderr.write(`[${timestamp}] [${requestId}] ${req.method} request with session: ${sessionId || 'none'}\n`);
          
          if (!sessionId || !this.transports[sessionId]) {
            const errorResponse = {
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Invalid or missing session ID"
              },
              id: null
            };
            process.stderr.write(`[${timestamp}] [${requestId}] <-- 400 Invalid session: ${JSON.stringify(errorResponse)}\n`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errorResponse));
            return;
          }

          const transport = this.transports[sessionId];
          process.stderr.write(`[${timestamp}] [${requestId}] Calling transport.handleRequest for ${req.method}...\n`);
          await transport.handleRequest(req, res);
          process.stderr.write(`[${timestamp}] [${requestId}] <-- ${req.method} handled successfully\n`);
          return;
        }
      }

      // 404 for all other requests
      const notFoundResponse = {
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "Method not found"
        },
        id: null
      };
      process.stderr.write(`[${timestamp}] [${requestId}] <-- 404 Not found: ${JSON.stringify(notFoundResponse)}\n`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(notFoundResponse));
      
      } catch (outerError) {
        // Catch any errors in the outer request handling
        process.stderr.write(`[${timestamp}] [${requestId}] OUTER ERROR: ${outerError}\n`);
        const fatalErrorResponse = {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Fatal server error",
            data: String(outerError)
          },
          id: null
        };
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(fatalErrorResponse));
        } catch (writeError) {
          process.stderr.write(`[${timestamp}] [${requestId}] WRITE ERROR: ${writeError}\n`);
        }
      }
    });

    try {
      // Start the HTTP server
      this.httpServer.listen(port, host, () => {
        process.stderr.write(`🌐 HTTP MCP Server started on ${host}:${port}\n`);
      });
    } catch (error) {
      process.stderr.write(`❌ Failed to start HTTP server: ${error}\n`);
      throw error;
    }
  }

  /**
   * Get database manager for crash handler and other internal use
   */
  getDatabaseManager(): DatabaseManager {
    return this.db;
  }

  async stop(): Promise<void> {
    process.stderr.write("🛑 Stopping MCP Server...\n");

    // Stop inactivity timer
    this.stopInactivityTimer();
    process.stderr.write("⏰ Inactivity timer stopped\n");

    // Stop background scraping worker
    process.stderr.write("🤖 Stopping background scraping worker...\n");
    try {
      await this.webScrapingService.stopScrapingWorker();
      process.stderr.write("✅ Background scraping worker stopped\n");
    } catch (error) {
      process.stderr.write(`⚠️ Error stopping scraping worker: ${error}\n`);
    }

    // Close Express server if running
    if (this.httpServer) {
      process.stderr.write("🌐 Closing HTTP server...\n");
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      process.stderr.write("✅ HTTP server closed\n");
    }

    // Close LanceDB connection
    process.stderr.write("🔍 Closing LanceDB connection...\n");
    await this.lanceDBManager.shutdown();
    process.stderr.write("✅ LanceDB connection closed\n");

    await this.server.close();
    process.stderr.write("✅ MCP Server stopped\n");
  }

  /**
   * Request sampling from the MCP client
   */
  async requestSampling(samplingRequest: any): Promise<CreateMessageResult> {
    try {
      // Make a sampling request to the client
      const response = await this.server.server.request(
        {
          method: "sampling/createMessage",
          params: samplingRequest.params,
        },
        CreateMessageRequestSchema
      );

      return response as CreateMessageResult;
    } catch (error) {
      throw new Error(
        `MCP sampling request failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  // Health check method
  getStatus(): {
    status: string;
    database: string;
    tools: number;
    uptime: number;
    vectorDB: string;
  } {
    return {
      status: "running",
      database: this.db.isInitialized() ? "connected" : "disconnected",
      tools: this.getAvailableTools().length,
      uptime: process.uptime(),
      vectorDB: this.lanceDBManager.isConnected()
        ? "connected"
        : "disconnected",
    };
  }
}
