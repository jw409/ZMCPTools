import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import type {
  Tool,
  CallToolResult,
  TextContent,
  Resource,
  TextResourceContents,
  Prompt,
  GetPromptResult
} from '@modelcontextprotocol/sdk/types.js';

import { DatabaseManager } from '../database/index.js';
import { AgentOrchestrationTools } from '../tools/AgentOrchestrationTools.js';
import { BrowserMcpTools } from '../tools/BrowserMcpTools.js';
import { WebScrapingMcpTools } from '../tools/WebScrapingMcpTools.js';
import { AnalysisMcpTools } from '../tools/AnalysisMcpTools.js';
import { TreeSummaryTools } from '../tools/TreeSummaryTools.js';
import { CacheMcpTools } from '../tools/CacheMcpTools.js';
import { BrowserTools } from '../tools/BrowserTools.js';
import { WebScrapingService } from '../services/WebScrapingService.js';
import { AgentService, MemoryService, FileOperationsService, TreeSummaryService, fileOperationsService } from '../services/index.js';
import { ResourceManager } from '../managers/ResourceManager.js';
import { PromptManager } from '../managers/PromptManager.js';
import { PathUtils } from '../utils/pathUtils.js';
import { LanceDBManager } from '../services/LanceDBManager.js';
import type { OrchestrationResult } from '../tools/AgentOrchestrationTools.js';

export interface McpServerOptions {
  name: string;
  version: string;
  databasePath?: string;
  repositoryPath?: string;
}

export class McpServer {
  private server: Server;
  private db: DatabaseManager;
  private orchestrationTools: AgentOrchestrationTools;
  private browserMcpTools: BrowserMcpTools;
  private webScrapingMcpTools: WebScrapingMcpTools;
  private analysisMcpTools: AnalysisMcpTools;
  private treeSummaryTools: TreeSummaryTools;
  private cacheMcpTools: CacheMcpTools;
  private fileOperationsService: FileOperationsService;
  private treeSummaryService: TreeSummaryService;
  private resourceManager: ResourceManager;
  private promptManager: PromptManager;
  private lanceDBManager: LanceDBManager;
  private repositoryPath: string;

  constructor(private options: McpServerOptions) {
    this.repositoryPath = PathUtils.resolveRepositoryPath(
      options.repositoryPath || process.cwd(), 
      'McpServer'
    );
    
    // Mark this as the main MCP process for database initialization
    process.env.MCP_MAIN_PROCESS = 'true';
    
    this.server = new Server(
      {
        name: options.name,
        version: options.version,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    // Initialize database with optimized settings for main process
    this.db = new DatabaseManager({ 
      path: options.databasePath,
      wal: true,
      busyTimeoutMs: 30000,
      checkpointIntervalMs: 60000,
      verbose: process.env.NODE_ENV === 'development'
    });
    
    // Initialize services
    const agentService = new AgentService(this.db);
    const memoryService = new MemoryService(this.db);
    const webScrapingService = new WebScrapingService(
      this.db,
      agentService,
      memoryService,
      this.repositoryPath
    );
    
    // Initialize file operations and tree summary services
    this.fileOperationsService = fileOperationsService; // Use singleton instance
    this.treeSummaryService = new TreeSummaryService();
    
    // Initialize tools
    this.orchestrationTools = new AgentOrchestrationTools(this.db, this.repositoryPath);
    
    const browserTools = new BrowserTools(memoryService, this.repositoryPath);
    this.browserMcpTools = new BrowserMcpTools(browserTools, memoryService, this.repositoryPath);
    this.webScrapingMcpTools = new WebScrapingMcpTools(webScrapingService, memoryService, this.repositoryPath);
    this.analysisMcpTools = new AnalysisMcpTools(memoryService, this.repositoryPath);
    this.treeSummaryTools = new TreeSummaryTools();
    this.cacheMcpTools = new CacheMcpTools(this.db);

    // Initialize managers
    this.resourceManager = new ResourceManager(this.db, this.repositoryPath);
    this.promptManager = new PromptManager();
    this.lanceDBManager = new LanceDBManager({
      // LanceDB is embedded - no server configuration needed
    });

    this.setupToolHandlers();

    // Setup graceful shutdown handlers
    this.setupShutdownHandlers();
  }

  private setupShutdownHandlers(): void {
    // Handle process termination signals
    const shutdown = async () => {
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGQUIT', shutdown);
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.getAvailableTools(),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.handleToolCall(name, args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            } as TextContent
          ]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${errorMessage}`
        );
      }
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const resources = await this.resourceManager.listResources();
        return {
          resources: resources,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Resource listing failed: ${errorMessage}`
        );
      }
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      try {
        const content = await this.resourceManager.readResource(uri);
        return {
          contents: [content],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Resource reading failed: ${errorMessage}`
        );
      }
    });

    // List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      try {
        const prompts = await this.promptManager.listPrompts();
        return {
          prompts: prompts,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Prompt listing failed: ${errorMessage}`
        );
      }
    });

    // Get prompt content
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.promptManager.getPrompt(name, args);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Prompt execution failed: ${errorMessage}`
        );
      }
    });
  }

  private getAvailableTools(): Tool[] {
    return [
      // Agent orchestration tools
      ...this.getOrchestrationTools(),
      // Browser automation tools
      ...this.browserMcpTools.getTools(),
      // Web scraping tools
      ...this.webScrapingMcpTools.getTools(),
      // Analysis and file operation tools
      ...this.analysisMcpTools.getTools(),
      // TreeSummary tools
      ...this.treeSummaryTools.getTools(),
      // Foundation Cache tools
      ...this.cacheMcpTools.getTools()
    ];
  }

  private getOrchestrationTools(): Tool[] {
    return [
      {
        name: "orchestrate_objective",
        description: "Spawn architect agent to coordinate multi-agent objective completion",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title for the objective (max 200 chars)"
            },
            objective: {
              type: "string",
              description: "The detailed high-level objective to accomplish"
            },
            repository_path: {
              type: "string",
              description: "Path to the repository where work will be done"
            },
            foundation_session_id: {
              type: "string",
              description: "Optional foundation session ID for shared context"
            }
          },
          required: ["title", "objective", "repository_path"]
        }
      },
      {
        name: "spawn_agent",
        description: "Spawn fully autonomous Claude agent with complete tool access",
        inputSchema: {
          type: "object",
          properties: {
            agent_type: {
              type: "string",
              description: "Type of agent (backend, frontend, testing, documentation, etc.)"
            },
            repository_path: {
              type: "string",
              description: "Path to the repository where agent will work"
            },
            task_description: {
              type: "string",
              description: "Detailed description of the task for the agent"
            },
            capabilities: {
              type: "array",
              items: { type: "string" },
              description: "List of capabilities the agent should have"
            },
            depends_on: {
              type: "array",
              items: { type: "string" },
              description: "List of agent IDs this agent depends on"
            },
            metadata: {
              type: "object",
              description: "Additional metadata for the agent"
            }
          },
          required: ["agent_type", "repository_path", "task_description"]
        }
      },
      {
        name: "create_task",
        description: "Create and assign task to agents",
        inputSchema: {
          type: "object",
          properties: {
            repository_path: {
              type: "string",
              description: "Path to the repository"
            },
            task_type: {
              type: "string",
              enum: ["feature", "bug_fix", "refactor", "documentation", "testing", "deployment"],
              description: "Type of task"
            },
            title: {
              type: "string",
              description: "Short title for the task"
            },
            description: {
              type: "string",
              description: "Detailed description of the task"
            },
            requirements: {
              type: "object",
              description: "Requirements and specifications for the task"
            },
            dependencies: {
              type: "array",
              items: { type: "string" },
              description: "List of task IDs this task depends on"
            }
          },
          required: ["repository_path", "task_type", "title", "description"]
        }
      },
      {
        name: "join_room",
        description: "Join communication room for coordination",
        inputSchema: {
          type: "object",
          properties: {
            room_name: {
              type: "string",
              description: "Name of the room to join"
            },
            agent_name: {
              type: "string",
              description: "Name of the agent joining the room"
            }
          },
          required: ["room_name", "agent_name"]
        }
      },
      {
        name: "send_message",
        description: "Send message to coordination room",
        inputSchema: {
          type: "object",
          properties: {
            room_name: {
              type: "string",
              description: "Name of the room to send message to"
            },
            agent_name: {
              type: "string",
              description: "Name of the agent sending the message"
            },
            message: {
              type: "string",
              description: "Message content to send"
            },
            mentions: {
              type: "array",
              items: { type: "string" },
              description: "List of agent names to mention"
            }
          },
          required: ["room_name", "agent_name", "message"]
        }
      },
      {
        name: "wait_for_messages",
        description: "Wait for new messages in a room",
        inputSchema: {
          type: "object",
          properties: {
            room_name: {
              type: "string",
              description: "Name of the room to monitor"
            },
            timeout: {
              type: "number",
              description: "Timeout in milliseconds (default: 30000)"
            },
            since_timestamp: {
              type: "string",
              description: "ISO timestamp to check for messages since"
            }
          },
          required: ["room_name"]
        }
      },
      {
        name: "store_memory",
        description: "Store insights and learnings in shared memory",
        inputSchema: {
          type: "object",
          properties: {
            repository_path: {
              type: "string",
              description: "Path to the repository"
            },
            agent_id: {
              type: "string",
              description: "ID of the agent storing the memory"
            },
            entry_type: {
              type: "string",
              enum: ["insight", "error", "decision", "progress"],
              description: "Type of memory entry"
            },
            title: {
              type: "string",
              description: "Title of the memory entry"
            },
            content: {
              type: "string",
              description: "Content of the memory entry"
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags for categorizing the memory"
            }
          },
          required: ["repository_path", "agent_id", "entry_type", "title", "content"]
        }
      },
      {
        name: "search_memory",
        description: "Search shared memory for insights",
        inputSchema: {
          type: "object",
          properties: {
            repository_path: {
              type: "string",
              description: "Path to the repository"
            },
            query_text: {
              type: "string",
              description: "Search query text"
            },
            agent_id: {
              type: "string",
              description: "Optional agent ID to filter by"
            },
            limit: {
              type: "number",
              description: "Maximum number of results (default: 10)"
            }
          },
          required: ["repository_path", "query_text"]
        }
      },
      {
        name: "list_agents",
        description: "Get list of active agents",
        inputSchema: {
          type: "object",
          properties: {
            repository_path: {
              type: "string",
              description: "Path to the repository"
            },
            status: {
              type: "string",
              enum: ["active", "idle", "completed", "terminated", "failed"],
              description: "Optional status filter"
            },
            limit: {
              type: "number",
              description: "Maximum number of agents to return (default: 5)",
              minimum: 1,
              maximum: 100
            },
            offset: {
              type: "number",
              description: "Number of agents to skip (default: 0)",
              minimum: 0
            }
          },
          required: ["repository_path"]
        }
      },
      {
        name: "terminate_agent",
        description: "Terminate one or more agents",
        inputSchema: {
          type: "object",
          properties: {
            agent_ids: {
              type: "array",
              items: { type: "string" },
              description: "Array of agent IDs to terminate"
            }
          },
          required: ["agent_ids"]
        }
      },
      {
        name: "close_room",
        description: "Close a communication room (soft delete, keeps data)",
        inputSchema: {
          type: "object",
          properties: {
            room_name: {
              type: "string",
              description: "Name of the room to close"
            },
            terminate_agents: {
              type: "boolean",
              description: "Whether to terminate agents in the room (default: true)"
            }
          },
          required: ["room_name"]
        }
      },
      {
        name: "delete_room",
        description: "Permanently delete a communication room and all messages",
        inputSchema: {
          type: "object",
          properties: {
            room_name: {
              type: "string",
              description: "Name of the room to delete"
            },
            force_delete: {
              type: "boolean",
              description: "Force delete even if room is not closed (default: false)"
            }
          },
          required: ["room_name"]
        }
      },
      {
        name: "list_rooms",
        description: "List communication rooms with filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            repository_path: {
              type: "string",
              description: "Path to the repository"
            },
            status: {
              type: "string",
              enum: ["active", "closed", "all"],
              description: "Filter rooms by status (default: all)"
            },
            limit: {
              type: "number",
              description: "Maximum number of rooms to return (default: 20)",
              minimum: 1,
              maximum: 100
            },
            offset: {
              type: "number",
              description: "Number of rooms to skip (default: 0)",
              minimum: 0
            }
          },
          required: ["repository_path"]
        }
      },
      {
        name: "list_room_messages", 
        description: "List messages from a specific room with pagination",
        inputSchema: {
          type: "object",
          properties: {
            room_name: {
              type: "string",
              description: "Name of the room"
            },
            limit: {
              type: "number", 
              description: "Maximum number of messages to return (default: 50)",
              minimum: 1,
              maximum: 200
            },
            offset: {
              type: "number",
              description: "Number of messages to skip (default: 0)", 
              minimum: 0
            },
            since_timestamp: {
              type: "string",
              description: "ISO timestamp to get messages since (optional)"
            }
          },
          required: ["room_name"]
        }
      }
    ];
  }

  private async handleToolCall(name: string, args: any): Promise<OrchestrationResult> {
    // Check browser tools first
    const browserToolNames = this.browserMcpTools.getTools().map(t => t.name);
    if (browserToolNames.includes(name)) {
      return await this.browserMcpTools.handleToolCall(name, args);
    }

    // Check web scraping tools
    const scrapingToolNames = this.webScrapingMcpTools.getTools().map(t => t.name);
    if (scrapingToolNames.includes(name)) {
      return await this.webScrapingMcpTools.handleToolCall(name, args);
    }

    // Check analysis tools
    const analysisToolNames = this.analysisMcpTools.getTools().map(t => t.name);
    if (analysisToolNames.includes(name)) {
      return await this.analysisMcpTools.handleToolCall(name, args);
    }

    // Check TreeSummary tools
    const treeSummaryToolNames = this.treeSummaryTools.getTools().map(t => t.name);
    if (treeSummaryToolNames.includes(name)) {
      return await this.treeSummaryTools.handleToolCall(name, args);
    }

    // Check Foundation Cache tools
    const cacheToolNames = this.cacheMcpTools.getTools().map(t => t.name);
    if (cacheToolNames.includes(name)) {
      return await this.cacheMcpTools.handleToolCall(name, args);
    }

    // Handle orchestration tools
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
          metadata: args.metadata
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
        return await this.orchestrationTools.terminateAgent(
          args.agent_ids
        );

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
          args.status || 'all',
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async start(): Promise<void> {
    // MCP servers must not output to stdout - using stderr for startup messages
    process.stderr.write('🚀 Starting Claude MCP Tools Server...\n');
    
    // Initialize database
    await this.db.initialize();
    process.stderr.write('✅ Database initialized\n');

    // Initialize LanceDB connection
    process.stderr.write('🔍 Connecting to LanceDB...\n');
    const lanceResult = await this.lanceDBManager.connect();
    if (lanceResult.success) {
      process.stderr.write('✅ LanceDB connected successfully\n');
    } else {
      process.stderr.write(`⚠️ LanceDB failed to connect: ${lanceResult.error}\n`);
      process.stderr.write('📝 Vector search features will be unavailable\n');
    }

    // Start the MCP server
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    process.stderr.write('✅ MCP Server started successfully\n');
    process.stderr.write('📡 Listening for MCP requests on stdio...\n');
  }

  async stop(): Promise<void> {
    process.stderr.write('🛑 Stopping MCP Server...\n');
    
    // Close LanceDB connection
    if (this.lanceDBManager.isConnected()) {
      process.stderr.write('🔍 Closing LanceDB connection...\n');
      await this.lanceDBManager.close();
      process.stderr.write('✅ LanceDB connection closed\n');
    }
    
    await this.server.close();
    process.stderr.write('✅ MCP Server stopped\n');
  }

  // Health check method
  getStatus(): {
    status: string;
    database: string;
    tools: number;
    uptime: number;
    chromaDB: string;
  } {
    return {
      status: 'running',
      database: this.db.isInitialized() ? 'connected' : 'disconnected',
      tools: this.getAvailableTools().length,
      uptime: process.uptime(),
      vectorDB: this.lanceDBManager.isConnected() ? 'connected' : 'disconnected'
    } as any;
  }
}