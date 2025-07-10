import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import net from 'net';
import { z } from 'zod';
import { ErrorCode, McpError, isInitializeRequest, CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Generic result schema for all MCP tools
const GenericToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
  data: z.any().optional()
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
  CreateMessageResult
} from '@modelcontextprotocol/sdk/types.js';

import { DatabaseManager } from '../database/index.js';
import { AgentOrchestrationTools, OrchestrationResultSchema, SpawnAgentOptionsSchema, type OrchestrationResult } from '../tools/AgentOrchestrationTools.js';
import { BrowserMcpTools, SessionConfigSchema, SessionMetadataSchema } from '../tools/BrowserMcpTools.js';
import { WebScrapingMcpTools } from '../tools/WebScrapingMcpTools.js';
import { AnalysisMcpTools } from '../tools/AnalysisMcpTools.js';
import { ProjectStructureInfoSchema, ProjectSummarySchema, FileSymbolsSchema } from '../schemas/toolResponses.js';
import { TreeSummaryTools, TreeSummaryResultSchema } from '../tools/TreeSummaryTools.js';
import { ReportProgressTool, ReportProgressOptionsSchema, ProgressReportSchema } from '../tools/ReportProgressTool.js';
// CacheMcpTools removed - foundation caching now automatic
import { BrowserTools, BrowserSessionSchema, ScreenshotOptionsSchema, NavigationOptionsSchema, ScrapeOptionsSchema } from '../tools/BrowserTools.js';
import { WebScrapingService } from '../services/WebScrapingService.js';
import { AgentService, KnowledgeGraphService, VectorSearchService, FileOperationsService, TreeSummaryService, fileOperationsService } from '../services/index.js';
import { ResourceManager } from '../managers/ResourceManager.js';
import { PromptManager } from '../managers/PromptManager.js';
import { PathUtils } from '../utils/pathUtils.js';
import { LanceDBService } from '../services/LanceDBService.js';
import { 
  StoreKnowledgeMemorySchema, 
  CreateRelationshipSchema, 
  SearchKnowledgeGraphSchema, 
  FindRelatedEntitiesSchema 
} from '../tools/knowledgeGraphTools.js';

export interface McpServerOptions {
  name: string;
  version: string;
  databasePath?: string;
  repositoryPath?: string;
  transport?: 'stdio' | 'http';
  httpPort?: number;
  httpHost?: string;
}

// Zod schemas for orchestration tool inputs
const OrchestrateObjectiveInputSchema = z.object({
  title: z.string().max(200).describe("Short title for the objective (max 200 chars)"),
  objective: z.string().describe("The detailed high-level objective to accomplish"),
  repository_path: z.string().describe("Path to the repository where work will be done"),
  foundation_session_id: z.string().optional().describe("Optional foundation session ID for shared context")
});

const SpawnAgentInputSchema = z.object({
  agent_type: z.string().describe("Type of agent (backend, frontend, testing, documentation, etc.)"),
  repository_path: z.string().describe("Path to the repository where agent will work"),
  task_description: z.string().describe("Detailed description of the task for the agent"),
  capabilities: z.array(z.string()).optional().describe("List of capabilities the agent should have"),
  depends_on: z.array(z.string()).optional().describe("List of agent IDs this agent depends on"),
  metadata: z.record(z.string(), z.any()).optional().describe("Additional metadata for the agent")
});

const CreateTaskInputSchema = z.object({
  repository_path: z.string().describe("Path to the repository"),
  task_type: z.enum(["feature", "bug_fix", "refactor", "documentation", "testing", "deployment"]).describe("Type of task"),
  title: z.string().describe("Short title for the task"),
  description: z.string().describe("Detailed description of the task"),
  requirements: z.record(z.string(), z.any()).optional().describe("Requirements and specifications for the task"),
  dependencies: z.array(z.string()).optional().describe("List of task IDs this task depends on")
});

const JoinRoomInputSchema = z.object({
  room_name: z.string().describe("Name of the room to join"),
  agent_name: z.string().describe("Name of the agent joining the room")
});

const SendMessageInputSchema = z.object({
  room_name: z.string().describe("Name of the room to send message to"),
  agent_name: z.string().describe("Name of the agent sending the message"),
  message: z.string().describe("Message content to send"),
  mentions: z.array(z.string()).optional().describe("List of agent names to mention")
});

const WaitForMessagesInputSchema = z.object({
  room_name: z.string().describe("Name of the room to monitor"),
  timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
  since_timestamp: z.string().optional().describe("ISO timestamp to check for messages since")
});

const StoreMemoryInputSchema = z.object({
  repository_path: z.string().describe("Path to the repository"),
  agent_id: z.string().describe("ID of the agent storing the memory"),
  entry_type: z.enum(["insight", "error", "decision", "progress"]).describe("Type of memory entry"),
  title: z.string().describe("Title of the memory entry"),
  content: z.string().describe("Content of the memory entry"),
  tags: z.array(z.string()).optional().describe("Tags for categorizing the memory")
});

const SearchMemoryInputSchema = z.object({
  repository_path: z.string().describe("Path to the repository"),
  query_text: z.string().describe("Search query text"),
  agent_id: z.string().optional().describe("Optional agent ID to filter by"),
  limit: z.number().optional().describe("Maximum number of results (default: 10)")
});

const ListAgentsInputSchema = z.object({
  repository_path: z.string().describe("Path to the repository"),
  status: z.enum(["active", "idle", "completed", "terminated", "failed"]).optional().describe("Optional status filter"),
  limit: z.number().min(1).max(100).optional().describe("Maximum number of agents to return (default: 5)"),
  offset: z.number().min(0).optional().describe("Number of agents to skip (default: 0)")
});

const TerminateAgentInputSchema = z.object({
  agent_ids: z.array(z.string()).describe("Array of agent IDs to terminate")
});

const ReportProgressInputSchema = z.object({
  agent_id: z.string().describe("ID of the agent reporting progress"),
  repository_path: z.string().describe("Path to the repository"),
  progress_type: z.enum(["status", "task", "milestone", "error", "completion"]).describe("Type of progress being reported"),
  message: z.string().describe("Progress message or description"),
  task_id: z.string().optional().describe("Optional task ID if progress is task-related"),
  progress_percentage: z.number().min(0).max(100).optional().describe("Optional progress percentage (0-100)"),
  results: z.record(z.string(), z.any()).optional().describe("Optional results or metadata"),
  error: z.string().optional().describe("Error message if progress_type is 'error'"),
  room_id: z.string().optional().describe("Optional room ID for coordination context"),
  broadcast_to_room: z.boolean().optional().describe("Whether to broadcast progress to assigned room (default: true)")
});

const CloseRoomInputSchema = z.object({
  room_name: z.string().describe("Name of the room to close"),
  terminate_agents: z.boolean().optional().describe("Whether to terminate agents in the room (default: true)")
});

const DeleteRoomInputSchema = z.object({
  room_name: z.string().describe("Name of the room to delete"),
  force_delete: z.boolean().optional().describe("Force delete even if room is not closed (default: false)")
});

const ListRoomsInputSchema = z.object({
  repository_path: z.string().describe("Path to the repository"),
  status: z.enum(["active", "closed", "all"]).optional().describe("Filter rooms by status (default: all)"),
  limit: z.number().min(1).max(100).optional().describe("Maximum number of rooms to return (default: 20)"),
  offset: z.number().min(0).optional().describe("Number of rooms to skip (default: 0)")
});

const ListRoomMessagesInputSchema = z.object({
  room_name: z.string().describe("Name of the room"),
  limit: z.number().min(1).max(200).optional().describe("Maximum number of messages to return (default: 50)"),
  offset: z.number().min(0).optional().describe("Number of messages to skip (default: 0)"),
  since_timestamp: z.string().optional().describe("ISO timestamp to get messages since (optional)")
});

const CreateDelayedRoomInputSchema = z.object({
  agent_id: z.string().describe("ID of the agent requesting room creation"),
  repository_path: z.string().describe("Path to the repository"),
  reason: z.string().describe("Reason for creating the coordination room"),
  participants: z.array(z.string()).optional().describe("List of expected participants (agent IDs)")
});

const AnalyzeCoordinationPatternsInputSchema = z.object({
  repository_path: z.string().describe("Path to the repository to analyze")
});

const MonitorAgentsInputSchema = z.object({
  agent_id: z.string().optional().describe("Monitor specific agent (optional)"),
  orchestration_id: z.string().optional().describe("Monitor orchestration (optional)"),
  room_name: z.string().optional().describe("Monitor room communication (optional)"),
  repository_path: z.string().optional().describe("Monitor all agents in repository (optional)"),
  monitoring_mode: z.enum(["status", "activity", "communication", "full"]).optional().describe("Monitoring mode - status, activity, communication, or full (default: status)"),
  update_interval: z.number().min(1000).max(10000).optional().describe("Update interval in milliseconds (default: 2000)"),
  max_duration: z.number().min(5000).max(55000).optional().describe("Maximum monitoring duration in milliseconds (default: 50000)"),
  detail_level: z.enum(["summary", "detailed", "verbose"]).optional().describe("Detail level - summary, detailed, or verbose (default: summary)")
});

export class McpToolsServer {
  private server: McpServer;
  private db: DatabaseManager;
  private orchestrationTools: AgentOrchestrationTools;
  private browserMcpTools: BrowserMcpTools;
  private webScrapingMcpTools: WebScrapingMcpTools;
  private webScrapingService: WebScrapingService;
  private analysisMcpTools: AnalysisMcpTools;
  private treeSummaryTools: TreeSummaryTools;
  private reportProgressTool: ReportProgressTool;
  // cacheMcpTools removed - foundation caching now automatic
  private fileOperationsService: FileOperationsService;
  private treeSummaryService: TreeSummaryService;
  private resourceManager: ResourceManager;
  private promptManager: PromptManager;
  private lanceDBManager: LanceDBService;
  private repositoryPath: string;
  private fastify?: ReturnType<typeof Fastify>;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  constructor(private options: McpServerOptions) {
    this.repositoryPath = PathUtils.resolveRepositoryPath(
      options.repositoryPath || process.cwd(), 
      'McpServer'
    );
    
    // Mark this as the main MCP process for database initialization
    process.env.MCP_MAIN_PROCESS = 'true';

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
            progress: true
          }
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
    const vectorService = new VectorSearchService(this.db);
    const knowledgeGraphService = new KnowledgeGraphService(this.db, vectorService);
    this.webScrapingService = new WebScrapingService(
      this.db,
      this.repositoryPath
    );
    
    // Initialize file operations and tree summary services
    this.fileOperationsService = fileOperationsService; // Use singleton instance
    this.treeSummaryService = new TreeSummaryService();
    
    // Initialize tools
    this.orchestrationTools = new AgentOrchestrationTools(this.db, this.repositoryPath);
    
    const browserTools = new BrowserTools(knowledgeGraphService, this.repositoryPath);
    this.browserMcpTools = new BrowserMcpTools(browserTools, knowledgeGraphService, this.repositoryPath, this.db);
    this.webScrapingMcpTools = new WebScrapingMcpTools(this.webScrapingService, knowledgeGraphService, this.repositoryPath, this.db);
    this.analysisMcpTools = new AnalysisMcpTools(knowledgeGraphService, this.repositoryPath);
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

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGQUIT', shutdown);
  }

  private setupMcpHandlers(): void {
    // Register all tools using the high-level SDK methods
    this.registerAllTools();
    this.registerAllResources();
    this.registerAllPrompts();
  }

  private registerAllTools(): void {
    // Register orchestration tools
    this.server.registerTool(
      "orchestrate_objective",
      {
        title: "Orchestrate Objective",
        description: "Spawn architect agent to coordinate multi-agent objective completion",
        inputSchema: OrchestrateObjectiveInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ title, objective, repository_path, foundation_session_id }) => {
        const result = await this.orchestrationTools.orchestrateObjective(
          title,
          objective,
          repository_path,
          foundation_session_id
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Continue with other tools...
    this.registerOtherOrchestrationTools();
    this.registerProgressReportingTools();
    this.registerDelegatedTools();
  }

  private registerOtherOrchestrationTools(): void {
    // Spawn Agent tool
    this.server.registerTool(
      "spawn_agent",
      {
        title: "Spawn Agent",
        description: "Spawn fully autonomous Claude agent with complete tool access",
        inputSchema: SpawnAgentInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ agent_type, repository_path, task_description, capabilities, depends_on, metadata }) => {
        const result = await this.orchestrationTools.spawnAgent({
          agentType: agent_type,
          repositoryPath: repository_path,
          taskDescription: task_description,
          capabilities,
          dependsOn: depends_on,
          metadata
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Create Task tool
    this.server.registerTool(
      "create_task",
      {
        title: "Create Task",
        description: "Create and assign task to agents",
        inputSchema: CreateTaskInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ repository_path, task_type, title, description, requirements, dependencies }) => {
        const result = await this.orchestrationTools.createTask(
          repository_path,
          task_type,
          title,
          description,
          requirements,
          dependencies
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Join Room tool
    this.server.registerTool(
      "join_room",
      {
        title: "Join Room",
        description: "Join communication room for coordination",
        inputSchema: JoinRoomInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ room_name, agent_name }) => {
        const result = await this.orchestrationTools.joinRoom(room_name, agent_name);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Send Message tool
    this.server.registerTool(
      "send_message",
      {
        title: "Send Message",
        description: "Send message to coordination room",
        inputSchema: SendMessageInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ room_name, agent_name, message, mentions }) => {
        const result = await this.orchestrationTools.sendMessage(
          room_name,
          agent_name,
          message,
          mentions
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Wait for Messages tool
    this.server.registerTool(
      "wait_for_messages",
      {
        title: "Wait for Messages",
        description: "Wait for new messages in a room",
        inputSchema: WaitForMessagesInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ room_name, timeout, since_timestamp }) => {
        const result = await this.orchestrationTools.waitForMessages(
          room_name,
          timeout || 30000,
          since_timestamp ? new Date(since_timestamp) : undefined
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Store Memory tool
    this.server.registerTool(
      "store_memory",
      {
        title: "Store Memory",
        description: "Store insights and learnings in shared memory",
        inputSchema: StoreMemoryInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ repository_path, agent_id, entry_type, title, content, tags }) => {
        const result = await this.orchestrationTools.storeMemory(
          repository_path,
          agent_id,
          entry_type,
          title,
          content,
          tags
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Search Memory tool
    this.server.registerTool(
      "search_memory",
      {
        title: "Search Memory",
        description: "Search shared memory for insights",
        inputSchema: SearchMemoryInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ repository_path, query_text, agent_id, limit }) => {
        const result = await this.orchestrationTools.searchMemory(
          repository_path,
          query_text,
          agent_id,
          limit || 10
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // List Agents tool
    this.server.registerTool(
      "list_agents",
      {
        title: "List Agents",
        description: "Get list of active agents",
        inputSchema: ListAgentsInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ repository_path, status, limit, offset }) => {
        const result = await this.orchestrationTools.listAgents(
          repository_path,
          status,
          limit || 5,
          offset || 0
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Terminate Agent tool
    this.server.registerTool(
      "terminate_agent",
      {
        title: "Terminate Agent",
        description: "Terminate one or more agents",
        inputSchema: TerminateAgentInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ agent_ids }) => {
        const result = await this.orchestrationTools.terminateAgent(agent_ids);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Close Room tool
    this.server.registerTool(
      "close_room",
      {
        title: "Close Room",
        description: "Close a communication room (soft delete, keeps data)",
        inputSchema: CloseRoomInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ room_name, terminate_agents }) => {
        const result = await this.orchestrationTools.closeRoom(
          room_name,
          terminate_agents ?? true
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Delete Room tool
    this.server.registerTool(
      "delete_room",
      {
        title: "Delete Room",
        description: "Permanently delete a communication room and all messages",
        inputSchema: DeleteRoomInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ room_name, force_delete }) => {
        const result = await this.orchestrationTools.deleteRoom(
          room_name,
          force_delete ?? false
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // List Rooms tool
    this.server.registerTool(
      "list_rooms",
      {
        title: "List Rooms",
        description: "List communication rooms with filtering and pagination",
        inputSchema: ListRoomsInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ repository_path, status, limit, offset }) => {
        const result = await this.orchestrationTools.listRooms(
          repository_path,
          status || 'all',
          limit || 20,
          offset || 0
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // List Room Messages tool
    this.server.registerTool(
      "list_room_messages",
      {
        title: "List Room Messages",
        description: "List messages from a specific room with pagination",
        inputSchema: ListRoomMessagesInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ room_name, limit, offset, since_timestamp }) => {
        const result = await this.orchestrationTools.listRoomMessages(
          room_name,
          limit || 50,
          offset || 0,
          since_timestamp
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Create Delayed Room tool
    this.server.registerTool(
      "create_delayed_room",
      {
        title: "Create Delayed Room",
        description: "Create a communication room when agents realize they need coordination",
        inputSchema: CreateDelayedRoomInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape,
      },
      async ({ agent_id, repository_path, reason, participants }) => {
        const result = await this.orchestrationTools.createDelayedRoom(
          agent_id,
          repository_path,
          reason,
          participants || []
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Analyze Coordination Patterns tool
    this.server.registerTool(
      "analyze_coordination_patterns",
      {
        title: "Analyze Coordination Patterns",
        description: "Analyze coordination patterns and provide efficiency recommendations",
        inputSchema: AnalyzeCoordinationPatternsInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape
      },
      async ({ repository_path }) => {
        const result = await this.orchestrationTools.analyzeCoordinationPatterns(repository_path);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );

    // Monitor Agents tool
    this.server.registerTool(
      "monitor_agents",
      {
        title: "Monitor Agents",
        description: "Monitor agents with real-time updates and immersive timeout-aware reporting",
        inputSchema: MonitorAgentsInputSchema.shape,
        outputSchema: OrchestrationResultSchema.shape
      },
      async ({ agent_id, orchestration_id, room_name, repository_path, monitoring_mode, update_interval, max_duration, detail_level }) => {
        const result = await this.orchestrationTools.monitorAgents(
          agent_id,
          orchestration_id,
          room_name,
          repository_path,
          monitoring_mode || 'status',
          update_interval || 2000,
          max_duration || 50000,
          detail_level || 'summary'
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );
  }

  private registerProgressReportingTools(): void {
    this.server.registerTool(
      "report_progress",
      {
        title: "Report Progress", 
        description: "Report progress and status updates from agents for real-time monitoring",
        inputSchema: ReportProgressInputSchema.shape,
        outputSchema: z.object({
          success: z.boolean(),
          message: z.string(),
          data: z.any().optional()
        }).shape,
      },
      async (args) => {
        const result = await this.reportProgressTool.reportProgress({
          agentId: args.agent_id,
          repositoryPath: args.repository_path,
          progressType: args.progress_type,
          message: args.message,
          taskId: args.task_id,
          progressPercentage: args.progress_percentage,
          results: args.results,
          error: args.error,
          roomId: args.room_id,
          broadcastToRoom: args.broadcast_to_room ?? true
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );
  }

  private registerDelegatedTools(): void {
    // Create mapping from tool names to their Zod input schemas
    const toolSchemaMap: Record<string, z.ZodSchema> = {
      // Browser tools
      'create_browser_session': CreateBrowserSessionSchema.shape,
      'navigate_and_scrape': NavigateAndScrapeSchema.shape,
      'interact_with_page': InteractWithPageSchema.shape,
      'manage_browser_sessions': ManageBrowserSessionsSchema.shape,
      'navigate_to_url': LegacyNavigateSchema.shape,
      'scrape_content': LegacyScrapeSchema.shape,
      'screenshot': ScreenshotSchema.shape,
      'execute_script': ExecuteScriptSchema.shape,
      'interact': InteractSchema.shape,

      // Web scraping tools
      'scrape_documentation': ScrapeDocumentationSchema.shape,
      'get_scraping_status': GetScrapingStatusSchema.shape,
      'cancel_scrape_job': CancelScrapeJobSchema.shape,
      'force_unlock_job': ForceUnlockJobSchema.shape,
      'force_unlock_stuck_jobs': ForceUnlockStuckJobsSchema.shape,
      'list_documentation_sources': z.object({
        include_stats: z.boolean().default(true)
      }),
      'delete_pages_by_pattern': DeletePagesByPatternSchema.shape,
      'delete_pages_by_ids': DeletePagesByIdsSchema.shape,
      'delete_all_website_pages': DeleteAllWebsitePagesSchema.shape,

      // Analysis tools
      'analyze_project_structure': AnalyzeProjectStructureSchema.shape,
      'generate_project_summary': GenerateProjectSummarySchema.shape,
      'analyze_file_symbols': AnalyzeFileSymbolsSchema.shape,
      'list_files': ListFilesSchema.shape,
      'find_files': FindFilesSchema.shape,
      'easy_replace': EasyReplaceSchema.shape,
      'cleanup_orphaned_projects': CleanupOrphanedProjectsSchema.shape,
      
      // Tree summary tools - these use generic schemas since they don't export specific input schemas
      'update_file_analysis': z.object({
        filePath: z.string(),
        analysisData: z.any()
      }),
      'remove_file_analysis': z.object({
        filePath: z.string()
      }),
      'update_project_metadata': z.object({
        projectPath: z.string(),
        metadata: z.any()
      }),
      'get_project_overview': z.object({
        projectPath: z.string()
      }),
      'cleanup_stale_analyses': z.object({
        projectPath: z.string(),
        maxAge: z.number().optional()
      })
    };

    // Register browser tools with proper Zod schemas
    this.browserMcpTools.getTools().forEach(tool => {
      const inputSchema = toolSchemaMap[tool.name];
      if (inputSchema) {
        this.server.registerTool(
          tool.name,
          {
            title: tool.name,
            description: tool.description,
            inputSchema: inputSchema.shape
          },
          async (args) => {
            const result = await this.browserMcpTools.handleToolCall(tool.name, args);
            return {
              content: [{
                type: "text", 
                text: JSON.stringify(result, null, 2)
              }]
            };
          }
        );
      } else {
        // Fallback to original JSON schema if Zod schema not found
        this.server.registerTool(
          tool.name,
          {
            title: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema.shape
          },
          async (args) => {
            const result = await this.browserMcpTools.handleToolCall(tool.name, args);
            return {
              content: [{
                type: "text", 
                text: JSON.stringify(result, null, 2)
              }]
            };
          }
        );
      }
    });

    // Register web scraping tools with proper Zod schemas
    this.webScrapingMcpTools.getTools().forEach(tool => {
      const inputSchema = toolSchemaMap[tool.name];
      if (inputSchema) {
        this.server.registerTool(
          tool.name,
          {
            title: tool.name,
            description: tool.description,
            inputSchema: inputSchema.shape
          },
          async (args) => {
            const result = await this.webScrapingMcpTools.handleToolCall(tool.name, args);
            return {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            };
          }
        );
      } else {
        // Fallback to original JSON schema if Zod schema not found
        this.server.registerTool(
          tool.name,
          {
            title: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema.shape
          },
          async (args) => {
            const result = await this.webScrapingMcpTools.handleToolCall(tool.name, args);
            return {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            };
          }
        );
      }
    });

    // Register analysis tools with proper Zod schemas
    this.analysisMcpTools.getTools().forEach(tool => {
      const inputSchema = toolSchemaMap[tool.name];
      if (inputSchema) {
        this.server.registerTool(
          tool.name,
          {
            title: tool.name,
            description: tool.description,
            inputSchema: inputSchema.shape
          },
          async (args) => {
            const result = await this.analysisMcpTools.handleToolCall(tool.name, args);
            return {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            };
          }
        );
      } else {
        // Fallback to original JSON schema if Zod schema not found
        this.server.registerTool(
          tool.name,
          {
            title: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema.shape
          },
          async (args) => {
            const result = await this.analysisMcpTools.handleToolCall(tool.name, args);
            return {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            };
          }
        );
      }
    });

    // Register tree summary tools with proper Zod schemas
    this.treeSummaryTools.getTools().forEach(tool => {
      const inputSchema = toolSchemaMap[tool.name];
      if (inputSchema) {
        this.server.registerTool(
          tool.name,
          {
            title: tool.name,
            description: tool.description,
            inputSchema: inputSchema
          },
          async (args) => {
            const result = await this.treeSummaryTools.handleToolCall(tool.name, args);
            return {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            };
          }
        );
      } else {
        // Fallback to original JSON schema if Zod schema not found
        this.server.registerTool(
          tool.name,
          {
            title: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          },
          async (args) => {
            const result = await this.treeSummaryTools.handleToolCall(tool.name, args);
            return {
              content: [{
                type: "text",
                text: JSON.stringify(result, null, 2)
              }]
            };
          }
        );
      }
    });
  }

  private registerAllResources(): void {
    // Register resources using SDK methods - delegate to ResourceManager
    // For now, keep the existing resource handling since it's working
  }

  private registerAllPrompts(): void {
    // Register prompts using SDK methods - delegate to PromptManager  
    // For now, keep the existing prompt handling since it's working
  }

  public getAvailableTools(): Tool[] {
    return [
      // Agent orchestration tools
      ...this.getOrchestrationTools(),
      // Progress reporting tool
      ...this.getProgressReportingTools(),
      // Browser automation tools
      ...this.browserMcpTools.getTools(),
      // Web scraping tools
      ...this.webScrapingMcpTools.getTools(),
      // Analysis and file operation tools
      ...this.analysisMcpTools.getTools(),
      // TreeSummary tools
      ...this.treeSummaryTools.getTools()
      // Foundation Cache tools removed - now automatic
    ];
  }

  public getOrchestrationTools(): Tool[] {
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
      },
      {
        name: "create_delayed_room",
        description: "Create a communication room when agents realize they need coordination",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              description: "ID of the agent requesting room creation"
            },
            repository_path: {
              type: "string",
              description: "Path to the repository"
            },
            reason: {
              type: "string",
              description: "Reason for creating the coordination room"
            },
            participants: {
              type: "array",
              items: { type: "string" },
              description: "List of expected participants (agent IDs)"
            }
          },
          required: ["agent_id", "repository_path", "reason"]
        }
      },
      {
        name: "analyze_coordination_patterns",
        description: "Analyze coordination patterns and provide efficiency recommendations",
        inputSchema: {
          type: "object",
          properties: {
            repository_path: {
              type: "string",
              description: "Path to the repository to analyze"
            }
          },
          required: ["repository_path"]
        }
      },
      {
        name: "monitor_agents",
        description: "Monitor agents with real-time updates and immersive timeout-aware reporting",
        inputSchema: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              description: "Monitor specific agent (optional)"
            },
            orchestration_id: {
              type: "string", 
              description: "Monitor orchestration (optional)"
            },
            room_name: {
              type: "string",
              description: "Monitor room communication (optional)"
            },
            repository_path: {
              type: "string",
              description: "Monitor all agents in repository (optional)"
            },
            monitoring_mode: {
              type: "string",
              enum: ["status", "activity", "communication", "full"],
              description: "Monitoring mode - status, activity, communication, or full (default: status)"
            },
            update_interval: {
              type: "number",
              description: "Update interval in milliseconds (default: 2000)",
              minimum: 1000,
              maximum: 10000
            },
            max_duration: {
              type: "number", 
              description: "Maximum monitoring duration in milliseconds (default: 50000)",
              minimum: 5000,
              maximum: 55000
            },
            detail_level: {
              type: "string",
              enum: ["summary", "detailed", "verbose"],
              description: "Detail level - summary, detailed, or verbose (default: summary)"
            }
          },
          required: []
        }
      }
    ];
  }

  public getProgressReportingTools(): Tool[] {
    // Create input schema for the tool - convert from camelCase to snake_case for tool parameters
    const ReportProgressInputSchema = z.object({
      agent_id: z.string().describe("ID of the agent reporting progress"),
      repository_path: z.string().describe("Path to the repository"),
      progress_type: z.enum(['status', 'task', 'milestone', 'error', 'completion']).describe("Type of progress being reported"),
      message: z.string().describe("Progress message or description"),
      task_id: z.string().optional().describe("Optional task ID if progress is task-related"),
      progress_percentage: z.number().min(0).max(100).optional().describe("Optional progress percentage (0-100)"),
      results: z.record(z.any()).optional().describe("Optional results or metadata"),
      error: z.string().optional().describe("Error message if progress_type is 'error'"),
      room_id: z.string().optional().describe("Optional room ID for coordination context"),
      broadcast_to_room: z.boolean().optional().describe("Whether to broadcast progress to assigned room (default: true)")
    });

    return [
      {
        name: "report_progress",
        description: "Report progress and status updates from agents for real-time monitoring",
        inputSchema: ReportProgressInputSchema.shape
      }
    ];
  }

  private async handleToolCall(name: string, args: any, progressContext?: {
    progressToken: string | number;
    sendNotification: (notification: any) => Promise<void>;
  }): Promise<OrchestrationResult> {
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

    // Foundation Cache tools removed - now automatic

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
          args.monitoring_mode || 'status',
          args.update_interval || 2000,
          args.max_duration || 50000,
          args.detail_level || 'summary',
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
          broadcastToRoom: args.broadcast_to_room ?? true
        });

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
    const lanceResult = await this.lanceDBManager.initialize();
    if (lanceResult.success) {
      process.stderr.write('✅ LanceDB connected successfully\n');
    } else {
      process.stderr.write(`⚠️ LanceDB failed to connect: ${lanceResult.error}\n`);
      process.stderr.write('📝 Vector search features will be unavailable\n');
    }

    // Start the MCP server with appropriate transport
    const transportType = this.options.transport || 'stdio';
    if (transportType === 'http') {
      await this.startHttpTransport();
    } else {
      await this.startStdioTransport();
    }
    
    // Start background scraping worker
    process.stderr.write('🤖 Starting background scraping worker...\n');
    try {
      await this.webScrapingService.startScrapingWorker();
      process.stderr.write('✅ Background scraping worker started\n');
    } catch (error) {
      process.stderr.write(`⚠️ Failed to start scraping worker: ${error}\n`);
    }
    
    process.stderr.write('✅ MCP Server started successfully\n');
    const transportMsg = transportType === 'http' 
      ? `📡 Listening for MCP requests on HTTP port ${this.options.httpPort || 4269}...\n`
      : '📡 Listening for MCP requests on stdio...\n';
    process.stderr.write(transportMsg);
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
        method: 'GET',
        signal: AbortSignal.timeout(2000) // 2 second timeout
      });
      
      if (response.ok) {
        const health = await response.json();
        return health.status === 'ok' && (health.protocol === 'mcp' || health.transport === 'http');
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
    21, 22, 23, 25, 53, 80, 110, 143, 443, 993, 995, // Standard protocols
    3000, 3001, 8000, 8080, 8443, 8888, 9000, // Common dev ports
    5432, 3306, 1433, 5984, 6379, 27017, // Database ports
    25565, 19132, // Minecraft
    5000, 5001, // Flask default
    4200, // Angular CLI
    3030, // Express common
    8081, 8082, 8083, 8084, 8085 // Common alt HTTP ports
  ]);

  /**
   * Check if a port is available (cross-platform)
   */
  private async isPortAvailable(port: number, host: string): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', () => {
        resolve(false);
      });
      
      server.once('listening', () => {
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
  private async findAvailablePort(preferredPort: number, host: string): Promise<number> {
    // Try the preferred port first if it's not a common port
    if (!this.COMMON_PORTS.has(preferredPort) && await this.isPortAvailable(preferredPort, host)) {
      return preferredPort;
    }
    
    if (this.COMMON_PORTS.has(preferredPort)) {
      process.stderr.write(`⚠️  Port ${preferredPort} is a common port, finding alternative...\n`);
    } else {
      process.stderr.write(`⚠️  Port ${preferredPort} is busy, finding alternative...\n`);
    }
    
    // Try a range of uncommon ports starting from 49152 (dynamic/private port range)
    const startPort = Math.max(49152, preferredPort);
    for (let i = 0; i < 100; i++) {
      const port = startPort + i;
      if (!this.COMMON_PORTS.has(port) && await this.isPortAvailable(port, host)) {
        process.stderr.write(`ℹ️  Using port ${port} instead\n`);
        return port;
      }
    }
    
    // Fallback: get a random available port from the OS
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      
      server.once('error', (err) => {
        reject(err);
      });
      
      server.once('listening', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const randomPort = address.port;
          server.close(() => {
            process.stderr.write(`ℹ️  Using OS-assigned port ${randomPort}\n`);
            resolve(randomPort);
          });
        } else {
          server.close(() => {
            reject(new Error('Failed to get random port'));
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
      process.stderr.write(`\n🚨 Received ${signal}, shutting down gracefully...\n`);
      await this.shutdown();
      process.exit(0);
    };

    // Handle various termination signals
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGHUP', () => handleShutdown('SIGHUP'));
    
    // Handle uncaught exceptions gracefully
    process.on('uncaughtException', async (error) => {
      process.stderr.write(`❌ Uncaught exception: ${error.message}\n`);
      await this.shutdown();
      process.exit(1);
    });
    
    process.on('unhandledRejection', async (reason, promise) => {
      process.stderr.write(`❌ Unhandled rejection at: ${promise}, reason: ${reason}\n`);
      await this.shutdown();
      process.exit(1);
    });
  }

  /**
   * Graceful shutdown
   */
  private async shutdown(): Promise<void> {
    process.stderr.write('🔄 Shutting down MCP server...\n');
    
    try {
      // Close HTTP server if running
      if (this.fastify) {
        await this.fastify.close();
        process.stderr.write('✅ HTTP server closed\n');
      }
      
      // Close database connections
      if (this.db) {
        await this.db.close();
        process.stderr.write('✅ Database connections closed\n');
      }
      
      // Stop background services
      if (this.webScrapingService && typeof this.webScrapingService.stopScrapingWorker === 'function') {
        await this.webScrapingService.stopScrapingWorker();
        process.stderr.write('✅ Background services stopped\n');
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
    const host = this.options.httpHost || '127.0.0.1';
    
    // Find an available port
    const port = await this.findAvailablePort(preferredPort, host);
    
    // Set up signal handlers for graceful shutdown
    this.setupSignalHandlers();
    
    this.fastify = Fastify({ 
      logger: false,
      bodyLimit: 10485760 // 10MB
    });
    
    // Register CORS plugin with proper MCP headers
    await this.fastify.register(cors, {
      origin: ['http://localhost:*', 'http://127.0.0.1:*'],
      credentials: true,
      exposedHeaders: ['Mcp-Session-Id'],
      allowedHeaders: ['Content-Type', 'mcp-session-id']
    });

    // Handle POST requests for client-to-server communication
    this.fastify.post('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && this.transports[sessionId]) {
        // Reuse existing transport
        transport = this.transports[sessionId];
      } else if (!sessionId && isInitializeRequest(request.body)) {
        // New initialization request - create transport with session management
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            // Store the transport by session ID
            this.transports[sessionId] = transport;
          },
          enableDnsRebindingProtection: true,
          allowedHosts: ['127.0.0.1', 'localhost'],
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
        reply.code(400).send({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      // Handle the request using StreamableHTTPServerTransport
      await transport.handleRequest(request, reply, request.body);
    });

    // Handle GET requests for server-to-client notifications via SSE  
    this.fastify.get('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !this.transports[sessionId]) {
        reply.code(400).send('Invalid or missing session ID');
        return;
      }
      
      const transport = this.transports[sessionId];
      await transport.handleRequest(request, reply);
    });

    // Handle DELETE requests for session termination
    this.fastify.delete('/mcp', async (request, reply) => {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !this.transports[sessionId]) {
        reply.code(400).send('Invalid or missing session ID');
        return;
      }
      
      const transport = this.transports[sessionId];
      await transport.handleRequest(request, reply);
    });

    // Health check endpoint
    this.fastify.get('/health', async (request, reply) => {
      return { status: 'ok', transport: 'http', protocol: 'mcp' };
    });

    try {
      // Start the HTTP server
      await this.fastify.listen({ host, port });
      process.stderr.write(`🌐 HTTP MCP Server started on ${host}:${port}\n`);
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
    process.stderr.write('🛑 Stopping MCP Server...\n');
    
    // Stop background scraping worker
    process.stderr.write('🤖 Stopping background scraping worker...\n');
    try {
      await this.webScrapingService.stopScrapingWorker();
      process.stderr.write('✅ Background scraping worker stopped\n');
    } catch (error) {
      process.stderr.write(`⚠️ Error stopping scraping worker: ${error}\n`);
    }
    
    // Close Fastify server if running
    if (this.fastify) {
      process.stderr.write('🌐 Closing HTTP server...\n');
      await this.fastify.close();
      process.stderr.write('✅ HTTP server closed\n');
    }
    
    // Close LanceDB connection
    process.stderr.write('🔍 Closing LanceDB connection...\n');
    await this.lanceDBManager.shutdown();
    process.stderr.write('✅ LanceDB connection closed\n');
    
    await this.server.close();
    process.stderr.write('✅ MCP Server stopped\n');
  }

  /**
   * Request sampling from the MCP client
   */
  async requestSampling(samplingRequest: any): Promise<CreateMessageResult> {
    try {
      // Make a sampling request to the client
      const response = await this.server.server.request(
        {
          method: 'sampling/createMessage',
          params: samplingRequest.params
        },
        CreateMessageRequestSchema
      );
      
      return response as CreateMessageResult;
    } catch (error) {
      throw new Error(`MCP sampling request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      status: 'running',
      database: this.db.isInitialized() ? 'connected' : 'disconnected',
      tools: this.getAvailableTools().length,
      uptime: process.uptime(),
      vectorDB: this.lanceDBManager.isConnected() ? 'connected' : 'disconnected'
    };
  }
}