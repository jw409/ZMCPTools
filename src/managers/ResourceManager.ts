import type {
  Resource,
  ResourceTemplate,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import { DatabaseManager } from "../database/index.js";
import { AgentService } from "../services/AgentService.js";
import { CommunicationService } from "../services/CommunicationService.js";
import { WebScrapingService } from "../services/WebScrapingService.js";
import { DocumentationService } from "../services/DocumentationService.js";
import { KnowledgeGraphService } from "../services/KnowledgeGraphService.js";
import { VectorSearchService } from "../services/VectorSearchService.js";
import { MemoryService } from "../services/MemoryService.js";
import { WebsiteRepository } from "../repositories/WebsiteRepository.js";
import { WebsitePagesRepository } from "../repositories/WebsitePagesRepository.js";
import { PathUtils } from "../utils/pathUtils.js";
import { TreeSitterASTTool } from "../tools/TreeSitterASTTool.js";
import { TreeSummaryService } from "../services/TreeSummaryService.js";
import { readdir, stat, readFile } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";

export interface ResourceInfo {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// Cursor-based pagination interfaces (MCP compliant)
interface CursorPaginationOptions {
  cursor?: string;
  limit?: number;
}

interface CursorPaginatedResult<T> {
  data: T[];
  nextCursor?: string;
  limit: number;
  total?: number; // Optional for performance
}

// Cursor encoding/decoding utilities for MCP compliance
class CursorManager {
  static encode(position: any): string {
    return Buffer.from(JSON.stringify(position)).toString('base64');
  }
  
  static decode(cursor: string): any {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString());
    } catch {
      throw new Error('Invalid cursor format');
    }
  }

  static createTimestampCursor(timestamp: string, id?: string): string {
    return this.encode({ timestamp, id });
  }

  static createPositionCursor(position: number): string {
    return this.encode({ position });
  }
}

export class ResourceManager {
  private repositoryPath: string;
  private agentService: AgentService;
  private communicationService: CommunicationService;
  private webScrapingService: WebScrapingService;
  private documentationService: DocumentationService;
  private knowledgeGraphService: KnowledgeGraphService;
  private vectorSearchService: VectorSearchService;
  private memoryService: MemoryService;
  private websiteRepository: WebsiteRepository;
  private websitePagesRepository: WebsitePagesRepository;
  private treeSitterASTTool: TreeSitterASTTool;
  private treeSummaryService: TreeSummaryService;

  constructor(private db: DatabaseManager, repositoryPath: string) {
    // Resolve repository path to absolute path
    this.repositoryPath = PathUtils.resolveRepositoryPath(
      repositoryPath,
      "ResourceManager"
    );

    this.agentService = new AgentService(this.db);
    this.communicationService = new CommunicationService(this.db);
    const vectorService = new VectorSearchService(this.db);
    this.knowledgeGraphService = new KnowledgeGraphService(this.db, vectorService);
    this.memoryService = new MemoryService(this.db);
    this.webScrapingService = new WebScrapingService(
      this.db,
      this.repositoryPath
    );
    this.documentationService = new DocumentationService(this.db);
    this.vectorSearchService = new VectorSearchService(this.db);
    this.websiteRepository = new WebsiteRepository(this.db);
    this.websitePagesRepository = new WebsitePagesRepository(this.db);
    this.treeSitterASTTool = new TreeSitterASTTool();
    this.treeSummaryService = new TreeSummaryService();
  }

  /**
   * Get all available resources
   */
  listResources(): ResourceTemplate[] {
    const resources: ResourceTemplate[] = [
      // File Analysis Resources (replaces 6 AST tools - saves 1,170 tokens)
      {
        uriTemplate: "file://*/ast",
        name: "File AST",
        description:
          "Parse source file to Abstract Syntax Tree with token optimization (use file://{path}/ast?compact=true&use_symbol_table=true&max_depth=3&include_semantic_hash=false&omit_redundant_text=true)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "relative path to source file (in URI path)",
            "compact": "return compact tree filtering syntactic noise (default: false)",
            "use_symbol_table": "use symbolic representation for 30-50% token reduction (default: true)",
            "max_depth": "maximum tree depth for quick overview (optional)",
            "include_semantic_hash": "add hash for duplicate detection (default: false)",
            "omit_redundant_text": "omit text from simple nodes to save tokens (default: true)"
          }
        }
      },
      {
        uriTemplate: "file://*/symbols",
        name: "File Symbols",
        description:
          "Extract symbols (functions, classes, methods, interfaces) from source file (use file://{path}/symbols?include_positions=true)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "relative path to source file (in URI path)",
            "include_positions": "include line/column positions (default: true)"
          }
        }
      },
      {
        uriTemplate: "file://*/imports",
        name: "File Imports",
        description:
          "Extract all import statements from source file (use file://{path}/imports)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "relative path to source file (in URI path)"
          }
        }
      },
      {
        uriTemplate: "file://*/exports",
        name: "File Exports",
        description:
          "Extract all export statements from source file (use file://{path}/exports)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "relative path to source file (in URI path)"
          }
        }
      },
      {
        uriTemplate: "file://*/structure",
        name: "File Structure",
        description:
          "Get Markdown-formatted code structure outline (use file://{path}/structure)",
        mimeType: "text/markdown",
        _meta: {
          "params": {
            "path": "relative path to source file (in URI path)"
          }
        }
      },
      {
        uriTemplate: "file://*/diagnostics",
        name: "File Diagnostics",
        description:
          "Get syntax errors and parse diagnostics (use file://{path}/diagnostics)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "relative path to source file (in URI path)"
          }
        }
      },
      // Project Analysis Resources (replaces 2 tools - saves 400 tokens)
      {
        uriTemplate: "project://*/structure",
        name: "Project Structure",
        description:
          "Get project directory tree with smart ignore patterns (use project://{path}/structure?max_depth=5&exclude=node_modules)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "project path (. for current directory)",
            "max_depth": "maximum directory depth (default: 5)",
            "exclude": "comma-separated exclude patterns (default: node_modules,dist,.git)"
          }
        }
      },
      {
        uriTemplate: "project://*/summary",
        name: "Project Summary",
        description:
          "Get AI-optimized project overview with README, package info, git status (use project://{path}/summary?include_readme=true&include_git=true)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "project path (. for current directory)",
            "include_readme": "include README.md content (default: true)",
            "include_package_info": "include package.json/setup.py info (default: true)",
            "include_git_info": "include git branch/status (default: true)"
          }
        }
      },
      {
        uriTemplate: "agents://list",
        name: "Agent List",
        description:
          "List of all active agents with their status and metadata (use ?limit=50&cursor=token&status=active&type=backend)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "cursor": "optional cursor token from previous response",
            "status": "active",
            "type": "agentType"
          }
        }
      },
      {
        uriTemplate: "communication://rooms",
        name: "Communication Rooms",
        description:
          "List of all active communication rooms (use ?limit=50&cursor=token&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "cursor": "optional cursor token from previous response",
            "search": "text to search room names and descriptions, if provided"
          }
        }
      },
      {
        uriTemplate: "communication://messages",
        name: "Room Messages",
        description:
          "Recent messages from communication rooms (use ?room=name&limit=50)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "room": "name of the room to fetch messages from",
            "limit": 50
          }
        }
      },
      {
        uriTemplate: "scraping://jobs",
        name: "Scraper Jobs",
        description:
          "List of web scraping jobs and their status (use ?limit=50&cursor=token&status=active&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "cursor": "optional cursor token from previous response",
            "status": "active",
            "search": "text to search job names and descriptions, if provided"
          }
        }
      },
      {
        uriTemplate: "docs://sources",
        name: "Documentation Sources",
        description:
          "List of scraped documentation sources (use ?limit=50&cursor=token&sourceType=api&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "cursor": "optional cursor token from previous response",
            "sourceType": "api",
            "search": "text to search source names and descriptions, if provided"
          }
        }
      },
      {
        uriTemplate: "docs://websites",
        name: "Documentation Websites",
        description:
          "List of all scraped websites (use ?limit=50&cursor=token&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "cursor": "optional cursor token from previous response",
            "search": "text to search website names and descriptions, if provided"
          }
        }
      },
      {
        uriTemplate: "docs://*/pages",
        name: "Website Pages",
        description:
          "List of pages for a specific website (use docs://{websiteId}/pages?limit=50&cursor=token&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "websiteId": "ID of the website to fetch pages for (in the URI path)",
            "limit": 50,
            "cursor": "optional cursor token from previous response",
            "search": "text to search page titles and content, if provided"
          }
        }
      },
      {
        uriTemplate: "agents://insights",
        name: "Agent Insights",
        description:
          "Aggregated insights and learnings from agents (use ?limit=100&cursor=token&memoryType=insight&agentId=id&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 100,
            "cursor": "optional cursor token from previous response",
            "memoryType": "insight",
            "agentId": "ID of the agent to fetch insights for",
            "search": "text to search insights, if provided"
          }
        }
      },
      {
        uriTemplate: "vector://collections",
        name: "Vector Collections",
        description:
          "List of LanceDB vector collections and their statistics (use ?limit=50&cursor=token&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "cursor": "optional cursor token from previous response",
            "search": "text to search collection names and descriptions, if provided"
          }
        }
      },
      {
        uriTemplate: "vector://search",
        name: "Vector Search",
        description:
          "Semantic search across vector collections (use ?query=text&collection=name&limit=10)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "query": "text to search for",
            "collection": "name of the collection to search in",
            "limit": 10
          }
        }
      },
      {
        uriTemplate: "vector://status",
        name: "Vector Database Status",
        description: "LanceDB connection status, TalentOS GPU integration info, and embedding model details (Stock vs Enhanced mode)",
        mimeType: "application/json",
        _meta: {
          "params": {}
        }
      },
      {
        uriTemplate: "docs://search",
        name: "Documentation Search",
        description: "Search documentation content (use ?query=text&source_id=id&limit=10)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "query": "text to search for in documentation",
            "source_id": "optional source ID to filter by",
            "limit": 10
          }
        }
      },
      {
        uriTemplate: "knowledge://search",
        name: "Knowledge Graph Search",
        description:
          "Search knowledge graph with hybrid BM25 + semantic search (use ?query=text&limit=10&threshold=0.7&use_bm25=true&use_embeddings=true&use_reranker=false)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "query": "text to search for in knowledge graph",
            "limit": 10,
            "threshold": 0.7,
            "use_bm25": "enable BM25 keyword search (default: true)",
            "use_embeddings": "enable semantic embeddings search (default: true)",
            "use_reranker": "apply reranker for final pass (default: false)"
          }
        }
      },
      {
        uriTemplate: "knowledge://entity/*/related",
        name: "Related Entities",
        description:
          "Find entities related to a specific entity (use knowledge://entity/{id}/related?limit=10&min_strength=0.5)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "id": "entity ID to find relations for (in URI path)",
            "limit": 10,
            "min_strength": "minimum relationship strength (default: 0.5)"
          }
        }
      },
      {
        uriTemplate: "knowledge://status",
        name: "Knowledge Graph Status",
        description:
          "Knowledge graph statistics, index freshness, and system health",
        mimeType: "application/json",
        _meta: {
          "params": {}
        }
      },
      {
        uriTemplate: "logs://list",
        name: "Logs Directory",
        description: "List directories and files in ~/.mcptools/logs/",
        mimeType: "application/json",
        _meta: {
          "params": {}
        }
      },
      {
        uriTemplate: "logs://*/files",
        name: "Log Files",
        description:
          "List files in a specific log directory (use logs://{dirname}/files)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "dirname": "name of the log directory to list files from"
          }
        }
      },
      {
        uriTemplate: "logs://*/content",
        name: "Log File Content",
        description:
          "Read content of a specific log file (use logs://{dirname}/content?file=filename)",
        mimeType: "text/plain",
        _meta: {
          "params": {
            "dirname": "name of the log directory",
            "file": "name of the log file to read content from"
          }
        }
      },
    ];

    return resources;
  }

  /**
   * Read a specific resource by URI
   */
  async readResource(uri: string): Promise<TextResourceContents> {
    // Parse custom URI schemes like communication://rooms, agents://list, etc.
    const [scheme, rest] = uri.split("://", 2);
    const [path, queryString] = rest ? rest.split("?", 2) : ["", ""];
    const searchParams = new URLSearchParams(queryString || "");

    // Handle file:// resources with dynamic paths (AST operations)
    if (scheme === "file") {
      return await this.getFileResource(path, searchParams);
    }

    // Handle project:// resources with dynamic paths
    if (scheme === "project") {
      return await this.getProjectResource(path, searchParams);
    }

    const resourceKey = `${scheme}://${path}`;

    switch (resourceKey) {
      case "agents://list":
        return await this.getAgentsList(searchParams);

      case "communication://rooms":
        return await this.getCommunicationRooms(searchParams);

      case "communication://messages":
        return await this.getRoomMessages(searchParams);

      case "scraping://jobs":
        return await this.getScrapingJobs(searchParams);

      case "docs://sources":
        return await this.getDocumentationSources(searchParams);

      case "docs://websites":
        return await this.getWebsites(searchParams);

      case "docs://search":
        return await this.getDocumentationSearch(searchParams);

      // Handle docs://{websiteId}/pages pattern
      case "docs://websites/pages":
        if (!searchParams.has("websiteId")) {
          return {
            uri: "docs://websites/pages",
            mimeType: "application/json",
            text: JSON.stringify({
              error: "websiteId parameter is required",
            }),
          };
        }
        return await this.getWebsitePages(
          searchParams.get("websiteId"),
          searchParams
        );

      case "agents://insights":
        return await this.getAgentInsights(searchParams);

      case "vector://collections":
        return await this.getVectorCollections(searchParams);

      case "vector://search":
        return await this.getVectorSearch(searchParams);

      case "vector://status":
        return await this.getVectorStatus();

      case "knowledge://search":
        return await this.getKnowledgeSearch(searchParams);

      case "knowledge://status":
        return await this.getKnowledgeStatus();

      case "logs://list":
        return await this.getLogsList();

      default:
        // Handle docs://{websiteId}/pages pattern
        if (scheme === "docs" && path.endsWith("/pages")) {
          const websiteId = path.replace("/pages", "");
          if (websiteId) {
            return await this.getWebsitePages(websiteId, searchParams);
          }
        }

        // Handle logs://{dirname}/files pattern
        if (scheme === "logs" && path.endsWith("/files")) {
          const dirname = path.replace("/files", "");
          if (dirname) {
            return await this.getLogFiles(dirname);
          }
        }

        // Handle logs://{dirname}/content pattern
        if (scheme === "logs" && path.endsWith("/content")) {
          const dirname = path.replace("/content", "");
          if (dirname) {
            return await this.getLogContent(dirname, searchParams);
          }
        }

        // Handle knowledge://entity/{id}/related pattern
        if (scheme === "knowledge" && path.includes("/entity/") && path.endsWith("/related")) {
          const entityId = path.replace("/entity/", "").replace("/related", "");
          if (entityId) {
            return await this.getRelatedEntities(entityId, searchParams);
          }
        }

        throw new Error(`Unknown resource: ${uri}`);
    }
  }

  private async getAgentsList(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const limit = parseInt(searchParams.get("limit") || "50");
    const cursor = searchParams.get("cursor");
    const status = searchParams.get("status") || undefined;
    const type = searchParams.get("type") || undefined;

    // Parse cursor for position information
    let startPosition = 0;
    if (cursor) {
      try {
        const cursorData = CursorManager.decode(cursor);
        startPosition = cursorData.position || 0;
      } catch (error) {
        throw new Error('Invalid cursor parameter');
      }
    }

    const agents = await this.agentService.listAgents(this.repositoryPath);

    // Apply filtering
    let filteredAgents = agents;
    if (status) {
      filteredAgents = filteredAgents.filter(
        (agent) => agent.status === status
      );
    }
    if (type) {
      filteredAgents = filteredAgents.filter(
        (agent) => agent.agentType === type
      );
    }

    // Sort by creation time for consistent cursor pagination
    filteredAgents.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Apply cursor-based pagination
    const endPosition = startPosition + limit;
    const paginatedAgents = filteredAgents.slice(startPosition, endPosition);

    // Generate next cursor if more results exist
    let nextCursor: string | undefined;
    if (endPosition < filteredAgents.length) {
      nextCursor = CursorManager.createPositionCursor(endPosition);
    }

    return {
      uri: "agents://list",
      mimeType: "application/json",
      text: JSON.stringify(
        {
          agents: paginatedAgents.map((agent) => ({
            id: agent.id,
            type: agent.agentType,
            status: agent.status,
            repositoryPath: agent.repositoryPath,
            taskDescription:
              agent.agentMetadata?.taskDescription || "No description",
            createdAt: agent.createdAt,
            lastActiveAt: agent.lastHeartbeat,
            capabilities: agent.capabilities,
            metadata: agent.agentMetadata,
          })),
          nextCursor,
          limit,
          total: filteredAgents.length, // Optional for performance
          filters: { status, type },
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }

  private async getCommunicationRooms(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const limit = parseInt(searchParams.get("limit") || "50");
    const cursor = searchParams.get("cursor");
    const search = searchParams.get("search") || undefined;

    // Parse cursor for position information
    let startPosition = 0;
    if (cursor) {
      try {
        const cursorData = CursorManager.decode(cursor);
        startPosition = cursorData.position || 0;
      } catch (error) {
        throw new Error('Invalid cursor parameter');
      }
    }

    const rooms = await this.communicationService.listRooms(
      this.repositoryPath
    );

    // Apply filtering
    let filteredRooms = rooms;
    if (search) {
      filteredRooms = filteredRooms.filter(
        (room) =>
          room.name.toLowerCase().includes(search.toLowerCase()) ||
          (room.description &&
            room.description.toLowerCase().includes(search.toLowerCase()))
      );
    }

    // Sort by creation time for consistent cursor pagination
    filteredRooms.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Apply cursor-based pagination
    const endPosition = startPosition + limit;
    const paginatedRooms = filteredRooms.slice(startPosition, endPosition);

    // Generate next cursor if more results exist
    let nextCursor: string | undefined;
    if (endPosition < filteredRooms.length) {
      nextCursor = CursorManager.createPositionCursor(endPosition);
    }

    return {
      uri: "communication://rooms",
      mimeType: "application/json",
      text: JSON.stringify(
        {
          rooms: paginatedRooms.map((room) => ({
            name: room.name,
            description: room.description,
            repositoryPath: room.repositoryPath,
            metadata: room.roomMetadata,
            createdAt: room.createdAt,
          })),
          nextCursor,
          limit,
          total: filteredRooms.length,
          search,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }

  private async getRoomMessages(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const roomName = searchParams.get("room");
    const limit = parseInt(searchParams.get("limit") || "50");

    if (!roomName) {
      throw new Error("Room parameter is required for messages resource");
    }

    const messages = await this.communicationService.getRecentMessages(
      roomName,
      limit
    );

    return {
      uri: `communication://messages?room=${roomName}&limit=${limit}`,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          roomName,
          messages: messages.map((msg) => ({
            id: msg.id,
            agentName: msg.agentName,
            message: msg.message,
            timestamp: msg.timestamp,
            mentions: msg.mentions,
            messageType: msg.messageType,
          })),
          total: messages.length,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }

  private async getScrapingJobs(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const limit = parseInt(searchParams.get("limit") || "50");
    const cursor = searchParams.get("cursor");
    const statusFilter = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;

    // Parse cursor for position information
    let startPosition = 0;
    if (cursor) {
      try {
        const cursorData = CursorManager.decode(cursor);
        startPosition = cursorData.position || 0;
      } catch (error) {
        throw new Error('Invalid cursor parameter');
      }
    }

    const status = await this.webScrapingService.getScrapingStatus();
    const jobs = [...status.activeJobs, ...status.pendingJobs];

    // Apply filtering
    let filteredJobs = jobs;
    if (statusFilter) {
      filteredJobs = filteredJobs.filter((job) => job.status === statusFilter);
    }
    if (search) {
      filteredJobs = filteredJobs.filter(
        (job) =>
          job.url.toLowerCase().includes(search.toLowerCase()) ||
          job.sourceId.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Sort by startedAt time for consistent cursor pagination
    filteredJobs.sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());

    // Apply cursor-based pagination
    const endPosition = startPosition + limit;
    const paginatedJobs = filteredJobs.slice(startPosition, endPosition);

    // Generate next cursor if more results exist
    let nextCursor: string | undefined;
    if (endPosition < filteredJobs.length) {
      nextCursor = CursorManager.createPositionCursor(endPosition);
    }

    return {
      uri: "scraping://jobs",
      mimeType: "application/json",
      text: JSON.stringify(
        {
          jobs: paginatedJobs.map((job) => ({
            id: job.id,
            sourceId: job.sourceId,
            status: job.status,
            url: job.url,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            progress: job.progress,
            errorMessage: job.errorMessage,
          })),
          nextCursor,
          limit,
          total: filteredJobs.length,
          filters: { status: statusFilter, search },
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }

  private async getDocumentationSources(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const sourceType = searchParams.get("sourceType") || undefined;
    const search = searchParams.get("search") || undefined;

    const sources = await this.documentationService.listDocumentationSources();

    // Apply filtering
    let filteredSources = sources;
    if (sourceType) {
      filteredSources = filteredSources.filter(
        (source) => source.sourceType === sourceType
      );
    }
    if (search) {
      filteredSources = filteredSources.filter(
        (source) =>
          source.name.toLowerCase().includes(search.toLowerCase()) ||
          source.url.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Apply pagination
    const total = filteredSources.length;
    const paginatedSources = filteredSources.slice(offset, offset + limit);

    return {
      uri: "docs://sources",
      mimeType: "application/json",
      text: JSON.stringify(
        {
          sources: paginatedSources.map((source) => ({
            id: source.id,
            name: source.name,
            url: source.url,
            sourceType: source.sourceType,
            entryCount: source.entryCount,
            lastScrapedAt: source.lastScrapedAt,
            createdAt: source.createdAt,
          })),
          total,
          limit,
          offset,
          filters: { sourceType, search },
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }

  private async getWebsites(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const limit = parseInt(searchParams.get("limit") || "50");
    const cursor = searchParams.get("cursor");
    const searchTerm = searchParams.get("search") || undefined;

    // Parse cursor for position information
    let offset = 0;
    if (cursor) {
      try {
        const cursorData = CursorManager.decode(cursor);
        offset = cursorData.position || 0;
      } catch (error) {
        throw new Error('Invalid cursor parameter');
      }
    }

    const websites = await this.websiteRepository.listWebsites({
      limit: limit + 1, // Get one extra to determine if more exist
      offset,
      searchTerm,
    });

    const totalCount = await this.websiteRepository.count(searchTerm);

    // Determine if more results exist
    const hasMore = websites.length > limit;
    const paginatedWebsites = hasMore ? websites.slice(0, limit) : websites;

    // Generate next cursor if more results exist
    let nextCursor: string | undefined;
    if (hasMore) {
      nextCursor = CursorManager.createPositionCursor(offset + limit);
    }

    return {
      uri: "docs://websites",
      mimeType: "application/json",
      text: JSON.stringify(
        {
          websites: paginatedWebsites.map((website) => ({
            id: website.id,
            name: website.name,
            domain: website.domain,
            metaDescription: website.metaDescription,
            createdAt: website.createdAt,
            updatedAt: website.updatedAt,
          })),
          nextCursor,
          limit,
          total: totalCount,
          searchTerm,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }

  private async getWebsitePages(
    websiteId: string,
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const searchTerm = searchParams.get("search") || undefined;

    const pages = await this.websitePagesRepository.listByWebsiteId(websiteId, {
      limit,
      offset,
      searchTerm,
    });

    const totalCount = await this.websitePagesRepository.countByWebsiteId(
      websiteId,
      searchTerm
    );

    return {
      uri: `docs://${websiteId}/pages`,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          websiteId,
          pages: pages.map((page) => ({
            id: page.id,
            url: page.url,
            title: page.title,
            httpStatus: page.httpStatus,
            contentHash: page.contentHash,
            selector: page.selector,
            errorMessage: page.errorMessage,
            createdAt: page.createdAt,
            updatedAt: page.updatedAt,
          })),
          total: totalCount,
          limit,
          offset,
          searchTerm,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }

  private async getAgentInsights(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");
    const memoryTypeParam = searchParams.get("memoryType") || "insight";
    const agentId = searchParams.get("agentId") || undefined;
    const search = searchParams.get("search") || "";

    // Validate memoryType against allowed values
    const validMemoryTypes = [
      "insight",
      "error",
      "decision",
      "progress",
      "learning",
      "pattern",
      "solution",
    ];
    const memoryType = validMemoryTypes.includes(memoryTypeParam)
      ? (memoryTypeParam as
          | "insight"
          | "error"
          | "decision"
          | "progress"
          | "learning"
          | "pattern"
          | "solution")
      : "insight";

    const insights = await this.memoryService.searchMemories(search, {
      repositoryPath: this.repositoryPath,
      memoryType,
      agentId,
      limit: limit + offset, // Get more to handle pagination
    });

    // Apply pagination
    const total = insights.length;
    const paginatedInsights = insights.slice(offset, offset + limit);

    return {
      uri: "agents://insights",
      mimeType: "application/json",
      text: JSON.stringify(
        {
          insights: paginatedInsights.map((insight) => ({
            id: insight.id,
            agentId: insight.agentId,
            entryType: insight.memoryType,
            title: insight.title,
            content: insight.content,
            tags: insight.tags,
            createdAt: insight.createdAt,
          })),
          total,
          limit,
          offset,
          filters: { memoryType, agentId, search },
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
    };
  }

  private async getVectorCollections(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    try {
      const limit = parseInt(searchParams.get("limit") || "50");
      const offset = parseInt(searchParams.get("offset") || "0");
      const search = searchParams.get("search") || undefined;

      const collections = await this.vectorSearchService.listCollections();

      // Apply filtering
      let filteredCollections = collections;
      if (search) {
        filteredCollections = filteredCollections.filter((collection) =>
          collection.name.toLowerCase().includes(search.toLowerCase())
        );
      }

      // Apply pagination
      const total = filteredCollections.length;
      const paginatedCollections = filteredCollections.slice(
        offset,
        offset + limit
      );

      return {
        uri: "vector://collections",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            collections: paginatedCollections.map((collection) => ({
              name: collection.name,
              documentCount: collection.count,
              metadata: collection.metadata,
            })),
            total,
            limit,
            offset,
            search,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    } catch (error) {
      return {
        uri: "vector://collections",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to get vector collections",
            collections: [],
            total: 0,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }
  }

  private async getVectorSearch(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const query = searchParams.get("query");
    const collection = searchParams.get("collection") || "documentation";
    const limit = parseInt(searchParams.get("limit") || "10");
    const threshold = parseFloat(searchParams.get("threshold") || "0.7");

    if (!query) {
      return {
        uri: `vector://search?query=${query}&collection=${collection}&limit=${limit}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error: "Query parameter is required for vector search",
            results: [],
            total: 0,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }

    try {
      const results = await this.vectorSearchService.searchSimilar(
        collection,
        query,
        limit,
        threshold
      );

      return {
        uri: `vector://search?query=${query}&collection=${collection}&limit=${limit}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            query,
            collection,
            results: results.map((result) => ({
              id: result.id,
              content:
                result.content.substring(0, 500) +
                (result.content.length > 500 ? "..." : ""),
              similarity: result.similarity,
              distance: result.distance,
              metadata: result.metadata,
            })),
            total: results.length,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    } catch (error) {
      return {
        uri: `vector://search?query=${query}&collection=${collection}&limit=${limit}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error:
              error instanceof Error ? error.message : "Vector search failed",
            query,
            collection,
            results: [],
            total: 0,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }
  }

  private async getVectorStatus(): Promise<TextResourceContents> {
    try {
      const connectionStatus = await this.vectorSearchService.testConnection();
      const collections = await this.vectorSearchService.listCollections();

      // Check TalentOS GPU service status
      let talentosStatus = null;
      try {
        const response = await fetch('http://localhost:8765/health', {
          signal: AbortSignal.timeout(2000)
        });
        if (response.ok) {
          const health = await response.json();
          talentosStatus = {
            available: true,
            device: health.device,
            status: health.status,
            vram_free_gb: health.vram_free_gb,
            vram_usage_gb: health.vram_usage_gb,
            models_available: health.models_available || [],
            models_loaded: health.models_loaded || {}
          };
        }
      } catch (error) {
        talentosStatus = {
          available: false,
          error: 'TalentOS embedding service (port 8765) unavailable'
        };
      }

      // Determine mode based on TalentOS availability
      const mode = talentosStatus?.available ? 'TalentOS Enhanced' : 'Stock ZMCP';
      const versionInfo = connectionStatus.version || 'LanceDB Vector Store';
      const enhancedVersion = talentosStatus?.available
        ? `${versionInfo} + TalentOS GPU (Qwen3 0.6B)`
        : versionInfo;

      return {
        uri: "vector://status",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            status: connectionStatus.connected ? "connected" : "disconnected",
            mode: mode,
            version: enhancedVersion,
            error: connectionStatus.error,
            collections: {
              total: collections.length,
              totalDocuments: collections.reduce(
                (sum, col) => sum + col.count,
                0
              ),
            },
            talentos_integration: talentosStatus,
            embedding_info: {
              active_model: talentosStatus?.available ? 'qwen3_06b' : 'Xenova/all-MiniLM-L6-v2',
              dimensions: talentosStatus?.available ? 1024 : 384,
              acceleration: talentosStatus?.available ? 'GPU (16x faster)' : 'CPU baseline',
              endpoint: talentosStatus?.available ? 'http://localhost:8765' : 'local'
            },
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    } catch (error) {
      return {
        uri: "vector://status",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            status: "error",
            mode: "Unknown",
            error:
              error instanceof Error
                ? error.message
                : "Failed to get vector status",
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }
  }

  private async getLogsList(): Promise<TextResourceContents> {
    try {
      const logsPath = join(homedir(), ".mcptools", "logs");
      const entries = await readdir(logsPath, { withFileTypes: true });

      const directories = [];
      const files = [];

      for (const entry of entries) {
        const entryPath = join(logsPath, entry.name);
        const stats = await stat(entryPath);

        if (entry.isDirectory()) {
          directories.push({
            name: entry.name,
            type: "directory",
            size: 0,
            modified: stats.mtime.toISOString(),
          });
        } else {
          files.push({
            name: entry.name,
            type: "file",
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        }
      }

      return {
        uri: "logs://list",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            path: logsPath,
            directories: directories.sort((a, b) =>
              a.name.localeCompare(b.name)
            ),
            files: files.sort((a, b) => a.name.localeCompare(b.name)),
            total: directories.length + files.length,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    } catch (error) {
      return {
        uri: "logs://list",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to list logs directory",
            path: join(homedir(), ".mcptools", "logs"),
            directories: [],
            files: [],
            total: 0,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }
  }

  private async getLogFiles(dirname: string): Promise<TextResourceContents> {
    try {
      const dirPath = join(homedir(), ".mcptools", "logs", dirname);
      const entries = await readdir(dirPath, { withFileTypes: true });

      const files = [];

      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = join(dirPath, entry.name);
          const stats = await stat(filePath);

          files.push({
            name: entry.name,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            extension: entry.name.split(".").pop() || "",
          });
        }
      }

      return {
        uri: `logs://${dirname}/files`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            directory: dirname,
            path: dirPath,
            files: files.sort((a, b) => b.modified.localeCompare(a.modified)),
            total: files.length,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    } catch (error) {
      return {
        uri: `logs://${dirname}/files`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to list log files",
            directory: dirname,
            path: join(homedir(), ".mcptools", "logs", dirname),
            files: [],
            total: 0,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }
  }

  private async getLogContent(
    dirname: string,
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const filename = searchParams.get("file");

    if (!filename) {
      return {
        uri: `logs://${dirname}/content`,
        mimeType: "text/plain",
        text: "Error: file parameter is required for log content resource",
      };
    }

    try {
      const filePath = join(homedir(), ".mcptools", "logs", dirname, filename);
      const content = await readFile(filePath, "utf8");

      return {
        uri: `logs://${dirname}/content?file=${filename}`,
        mimeType: "text/plain",
        text: content,
      };
    } catch (error) {
      return {
        uri: `logs://${dirname}/content?file=${filename}`,
        mimeType: "text/plain",
        text: `Error reading log file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  private async getDocumentationSearch(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const query = searchParams.get("query");
    const sourceId = searchParams.get("source_id");
    const limit = parseInt(searchParams.get("limit") || "10");

    if (!query) {
      return {
        uri: "docs://search",
        mimeType: "application/json",
        text: JSON.stringify({
          error: "Query parameter is required for documentation search",
          results: [],
          total: 0,
          timestamp: new Date().toISOString(),
        }),
      };
    }

    try {
      // Use the web scraping service to search documentation
      const response = await this.webScrapingService.searchDocumentation(
        query,
        sourceId ? { collection: sourceId, limit } : { limit }
      );

      // Check if the search was successful
      if (!response.success || !response.results) {
        return {
          uri: `docs://search?query=${encodeURIComponent(query)}${sourceId ? `&source_id=${sourceId}` : ""}&limit=${limit}`,
          mimeType: "application/json",
          text: JSON.stringify({
            error: response.error || "Documentation search failed",
            query,
            sourceId,
            results: [],
            total: 0,
            timestamp: new Date().toISOString(),
          }, null, 2),
        };
      }

      const results = response.results;

      return {
        uri: `docs://search?query=${encodeURIComponent(query)}${sourceId ? `&source_id=${sourceId}` : ""}&limit=${limit}`,
        mimeType: "application/json",
        text: JSON.stringify({
          query,
          sourceId,
          results: results.map((result) => ({
            id: result.id,
            title: result.title,
            content: result.content.substring(0, 500) + (result.content.length > 500 ? "..." : ""),
            url: result.url,
            similarity: result.similarity,
          })),
          total: results.length,
          timestamp: new Date().toISOString(),
        }, null, 2),
      };
    } catch (error) {
      return {
        uri: `docs://search?query=${encodeURIComponent(query)}${sourceId ? `&source_id=${sourceId}` : ""}&limit=${limit}`,
        mimeType: "application/json",
        text: JSON.stringify({
          error: error instanceof Error ? error.message : "Documentation search failed",
          query,
          sourceId,
          results: [],
          total: 0,
          timestamp: new Date().toISOString(),
        }, null, 2),
      };
    }
  }

  private async getKnowledgeSearch(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const query = searchParams.get("query");
    const limit = parseInt(searchParams.get("limit") || "10");
    const threshold = parseFloat(searchParams.get("threshold") || "0.7");
    const useBm25 = searchParams.get("use_bm25") !== "false"; // default true
    const useEmbeddings = searchParams.get("use_embeddings") !== "false"; // default true
    const useReranker = searchParams.get("use_reranker") === "true"; // default false

    if (!query) {
      return {
        uri: "knowledge://search",
        mimeType: "application/json",
        text: JSON.stringify({
          error: "Query parameter is required for knowledge graph search",
          query: "",
          results: [],
          total: 0,
          search_params: { useBm25, useEmbeddings, useReranker, threshold },
          timestamp: new Date().toISOString(),
        }),
      };
    }

    try {
      // Combine semantic and text search
      let entities: any[] = [];

      if (useEmbeddings) {
        // Semantic search
        const semanticResults = await this.knowledgeGraphService.findEntitiesBySemanticSearch(
          this.repositoryPath,
          query,
          undefined, // entityTypes
          limit,
          threshold
        );
        entities = semanticResults;
      }

      if (useBm25 && entities.length < limit) {
        // Text search for additional results
        const textResults = await this.knowledgeGraphService.findEntitiesByTextSearch(
          this.repositoryPath,
          query,
          undefined, // entityTypes
          limit - entities.length
        );

        // Merge results, avoiding duplicates
        const existingIds = new Set(entities.map(e => e.id));
        const uniqueTextResults = textResults.filter(e => !existingIds.has(e.id));
        entities = [...entities, ...uniqueTextResults];
      }

      return {
        uri: `knowledge://search?query=${encodeURIComponent(query)}&limit=${limit}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            query,
            results: entities.slice(0, limit).map((entity: any) => ({
              id: entity.id,
              type: entity.entityType,
              name: entity.name,
              description: entity.description?.substring(0, 200),
              importance: entity.importanceScore,
              confidence: entity.confidenceScore,
            })),
            total: entities.length,
            search_params: { useBm25, useEmbeddings, useReranker, threshold },
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    } catch (error) {
      return {
        uri: `knowledge://search?query=${encodeURIComponent(query)}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error:
              error instanceof Error
                ? error.message
                : "Knowledge graph search failed",
            query,
            results: [],
            total: 0,
            search_params: { useBm25, useEmbeddings, useReranker, threshold },
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }
  }

  private async getRelatedEntities(
    entityId: string,
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const limit = parseInt(searchParams.get("limit") || "10");
    const minStrength = parseFloat(searchParams.get("min_strength") || "0.5");

    try {
      const results = await this.knowledgeGraphService.findRelatedEntities(
        this.repositoryPath,
        entityId,
        {
          max_distance: 2,
          min_strength: minStrength,
          relationship_types: undefined,
        }
      );

      return {
        uri: `knowledge://entity/${entityId}/related?limit=${limit}&min_strength=${minStrength}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            entityId,
            related: results.entities.slice(0, limit).map((entity: any) => ({
              id: entity.id,
              type: entity.entity_type,
              name: entity.name,
              description: entity.description?.substring(0, 200),
              importance: entity.importance_score,
              distance: entity.distance || 1,
              relationshipType: entity.relationship_type,
              strength: entity.strength || 0.7,
            })),
            total: results.entities.length,
            params: { limit, minStrength },
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    } catch (error) {
      return {
        uri: `knowledge://entity/${entityId}/related`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to find related entities",
            entityId,
            related: [],
            total: 0,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }
  }

  private async getKnowledgeStatus(): Promise<TextResourceContents> {
    try {
      const stats = await this.knowledgeGraphService.getStats(
        this.repositoryPath
      );

      // Calculate quality metrics from entities
      const avgImportance = stats.topEntitiesByImportance.length > 0
        ? stats.topEntitiesByImportance.reduce((sum, e) => sum + (e.importanceScore || 0), 0) / stats.topEntitiesByImportance.length
        : 0;

      const avgConfidence = stats.topEntitiesByImportance.length > 0
        ? stats.topEntitiesByImportance.reduce((sum, e) => sum + (e.confidenceScore || 0), 0) / stats.topEntitiesByImportance.length
        : 0;

      return {
        uri: "knowledge://status",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            total_entities: stats.totalEntities,
            total_relationships: stats.totalRelationships,
            entity_types: stats.entitiesByType,
            quality_metrics: {
              avg_importance: avgImportance,
              avg_confidence: avgConfidence,
              low_quality_count: stats.topEntitiesByImportance.filter(e => (e.importanceScore || 0) < 0.3).length,
            },
            storage_info: {
              repository_path: this.repositoryPath,
              database_size: "unknown",
            },
            index_freshness: {
              last_updated: new Date().toISOString(),
              stale_check_method: "mtime-based (~5ms overhead)",
            },
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    } catch (error) {
      return {
        uri: "knowledge://status",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to get knowledge graph status",
            total_entities: 0,
            total_relationships: 0,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        ),
      };
    }
  }

  /**
   * Handle file:// resource URIs for AST operations
   * URI format: file://{path}/{aspect}?params
   * Example: file://src/index.ts/symbols?compact=true
   */
  private async getFileResource(
    path: string,
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    // Extract aspect from path (e.g., "src/index.ts/symbols" → aspect="symbols", filePath="src/index.ts")
    const pathParts = path.split("/");
    const aspect = pathParts[pathParts.length - 1];
    const filePath = pathParts.slice(0, -1).join("/");

    if (!filePath) {
      return {
        uri: `file://${path}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error: "File path is required",
            usage: "file://{path}/{aspect} where aspect is: ast, symbols, imports, exports, structure, diagnostics",
          },
          null,
          2
        ),
      };
    }

    // Map aspect to TreeSitterASTTool operation
    const operationMap: Record<string, string> = {
      ast: "parse",
      symbols: "extract_symbols",
      imports: "extract_imports",
      exports: "extract_exports",
      structure: "get_structure",
      diagnostics: "get_diagnostics",
    };

    const operation = operationMap[aspect];

    if (!operation) {
      return {
        uri: `file://${path}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error: `Unknown file aspect: ${aspect}`,
            valid_aspects: Object.keys(operationMap),
            usage: "file://{path}/{aspect}?params",
          },
          null,
          2
        ),
      };
    }

    // Build args from query parameters with defaults
    const args: any = {
      file_path: filePath,
      operation,
    };

    // Parse query parameters
    if (searchParams.has("compact"))
      args.compact = searchParams.get("compact") === "true";
    if (searchParams.has("use_symbol_table"))
      args.use_symbol_table = searchParams.get("use_symbol_table") === "true";
    if (searchParams.has("max_depth"))
      args.max_depth = parseInt(searchParams.get("max_depth") || "0");
    if (searchParams.has("include_semantic_hash"))
      args.include_semantic_hash =
        searchParams.get("include_semantic_hash") === "true";
    if (searchParams.has("omit_redundant_text"))
      args.omit_redundant_text =
        searchParams.get("omit_redundant_text") === "true";
    if (searchParams.has("query")) args.query = searchParams.get("query");

    try {
      const result = await this.treeSitterASTTool.executeByToolName(
        "ast_analyze",
        args
      );

      // Determine MIME type based on aspect
      const mimeType =
        aspect === "structure" ? "text/markdown" : "application/json";

      return {
        uri: `file://${path}`,
        mimeType,
        text:
          mimeType === "application/json"
            ? JSON.stringify(result, null, 2)
            : typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2),
      };
    } catch (error) {
      return {
        uri: `file://${path}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error:
              error instanceof Error
                ? error.message
                : `Failed to process file resource: ${aspect}`,
            file_path: filePath,
            aspect,
            operation,
          },
          null,
          2
        ),
      };
    }
  }

  /**
   * Handle project:// resource URIs for project analysis
   * URI format: project://{path}/{aspect}?params
   * Example: project://./structure?max_depth=5
   */
  private async getProjectResource(
    path: string,
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    // Extract aspect from path (e.g., "./structure" → aspect="structure", projectPath=".")
    const pathParts = path.split("/");
    const aspect = pathParts[pathParts.length - 1];
    const projectPath = pathParts.slice(0, -1).join("/") || ".";

    const resolvedPath = resolve(this.repositoryPath, projectPath);

    if (aspect === "structure") {
      const maxDepth = parseInt(searchParams.get("max_depth") || "5");
      const excludePatterns = searchParams.get("exclude")?.split(",") || [
        "node_modules",
        "dist",
        ".git",
        ".next",
        "build",
        "coverage"
      ];

      try {
        const structure = await this.treeSummaryService.analyzeDirectory(
          resolvedPath,
          { maxDepth, excludePatterns }
        );

        return {
          uri: `project://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              project_path: resolvedPath,
              max_depth: maxDepth,
              exclude_patterns: excludePatterns,
              structure,
              total_files: this.countFiles(structure),
              total_directories: this.countDirectories(structure),
              timestamp: new Date().toISOString()
            },
            null,
            2
          )
        };
      } catch (error) {
        return {
          uri: `project://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to analyze project structure",
              project_path: resolvedPath,
              aspect
            },
            null,
            2
          )
        };
      }
    } else if (aspect === "summary") {
      const includeReadme = searchParams.get("include_readme") !== "false";
      const includePackageInfo =
        searchParams.get("include_package_info") !== "false";
      const includeGitInfo = searchParams.get("include_git_info") !== "false";

      try {
        const summary = await this.treeSummaryService.generateProjectSummary(
          resolvedPath,
          {
            includeReadme,
            includePackageInfo,
            includeGitInfo
          }
        );

        return {
          uri: `project://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(summary, null, 2)
        };
      } catch (error) {
        return {
          uri: `project://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to generate project summary",
              project_path: resolvedPath,
              aspect
            },
            null,
            2
          )
        };
      }
    } else {
      return {
        uri: `project://${path}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error: `Unknown project aspect: ${aspect}`,
            valid_aspects: ["structure", "summary"],
            usage: "project://{path}/{aspect}?params"
          },
          null,
          2
        )
      };
    }
  }

  private countFiles(node: any): number {
    if (node.type === "file") return 1;
    if (!node.children) return 0;
    return node.children.reduce(
      (sum: number, child: any) => sum + this.countFiles(child),
      0
    );
  }

  private countDirectories(node: any): number {
    if (node.type === "file") return 0;
    if (!node.children) return 1;
    return (
      1 +
      node.children.reduce(
        (sum: number, child: any) => sum + this.countDirectories(child),
        0
      )
    );
  }
}
