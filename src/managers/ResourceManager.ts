import type {
  Resource,
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
import { readdir, stat, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface ResourceInfo {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
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
  }

  /**
   * Get all available resources
   */
  async listResources(): Promise<Resource[]> {
    const resources: Resource[] = [
      {
        uri: "agents://list",
        name: "Agent List",
        description:
          "List of all active agents with their status and metadata (use ?limit=50&offset=0&status=active&type=backend)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 10,
            "offset": 0,
            "status": "active",
            "type": "agentType"
          }
        }
      },
      {
        uri: "communication://rooms",
        name: "Communication Rooms",
        description:
          "List of all active communication rooms (use ?limit=50&offset=0&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "offset": 0,
            "search": "text to search room names and descriptions, if provided"
          }
        }
      },
      {
        uri: "communication://messages",
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
        uri: "scraping://jobs",
        name: "Scraper Jobs",
        description:
          "List of web scraping jobs and their status (use ?limit=50&offset=0&status=active&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "offset": 0,
            "status": "active",
            "search": "text to search job names and descriptions, if provided"
          }
        }
      },
      {
        uri: "docs://sources",
        name: "Documentation Sources",
        description:
          "List of scraped documentation sources (use ?limit=50&offset=0&sourceType=api&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "offset": 0,
            "sourceType": "api",
            "search": "text to search source names and descriptions, if provided"
          }
        }
      },
      {
        uri: "docs://websites",
        name: "Documentation Websites",
        description:
          "List of all scraped websites (use ?limit=50&offset=0&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "offset": 0,
            "search": "text to search website names and descriptions, if provided"
          }
        }
      },
      {
        uri: "docs://*/pages",
        name: "Website Pages",
        description:
          "List of pages for a specific website (use docs://{websiteId}/pages?limit=50&offset=0&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "websiteId": "ID of the website to fetch pages for (in the URI path)",
            "limit": 50,
            "offset": 0,
            "search": "text to search page titles and content, if provided"
          }
        }
      },
      {
        uri: "agents://insights",
        name: "Agent Insights",
        description:
          "Aggregated insights and learnings from agents (use ?limit=100&offset=0&memoryType=insight&agentId=id&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 100,
            "offset": 0,
            "memoryType": "insight",
            "agentId": "ID of the agent to fetch insights for",
            "search": "text to search insights, if provided"
          }
        }
      },
      {
        uri: "vector://collections",
        name: "Vector Collections",
        description:
          "List of ChromaDB vector collections and their statistics (use ?limit=50&offset=0&search=text)",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": 50,
            "offset": 0,
            "search": "text to search collection names and descriptions, if provided"
          }
        }
      },
      {
        uri: "vector://search",
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
        uri: "vector://status",
        name: "Vector Database Status",
        description: "ChromaDB connection status and health information",
        mimeType: "application/json",
        _meta: {
          "params": {}
        }
      },
      {
        uri: "docs://search",
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
        uri: "logs://list",
        name: "Logs Directory",
        description: "List directories and files in ~/.mcptools/logs/",
        mimeType: "application/json",
        _meta: {
          "params": {}
        }
      },
      {
        uri: "logs://*/files",
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
        uri: "logs://*/content",
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

        throw new Error(`Unknown resource: ${uri}`);
    }
  }

  private async getAgentsList(
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const status = searchParams.get("status") || undefined;
    const type = searchParams.get("type") || undefined;

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

    // Apply pagination
    const total = filteredAgents.length;
    const paginatedAgents = filteredAgents.slice(offset, offset + limit);

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
          total,
          limit,
          offset,
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
    const offset = parseInt(searchParams.get("offset") || "0");
    const search = searchParams.get("search") || undefined;

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

    // Apply pagination
    const total = filteredRooms.length;
    const paginatedRooms = filteredRooms.slice(offset, offset + limit);

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
    const offset = parseInt(searchParams.get("offset") || "0");
    const statusFilter = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;

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

    // Apply pagination
    const total = filteredJobs.length;
    const paginatedJobs = filteredJobs.slice(offset, offset + limit);

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
          total,
          limit,
          offset,
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
    const offset = parseInt(searchParams.get("offset") || "0");
    const searchTerm = searchParams.get("search") || undefined;

    const websites = await this.websiteRepository.listWebsites({
      limit,
      offset,
      searchTerm,
    });

    const totalCount = await this.websiteRepository.count(searchTerm);

    return {
      uri: "docs://websites",
      mimeType: "application/json",
      text: JSON.stringify(
        {
          websites: websites.map((website) => ({
            id: website.id,
            name: website.name,
            domain: website.domain,
            metaDescription: website.metaDescription,
            createdAt: website.createdAt,
            updatedAt: website.updatedAt,
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

      return {
        uri: "vector://status",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            status: connectionStatus.connected ? "connected" : "disconnected",
            version: connectionStatus.version,
            error: connectionStatus.error,
            collections: {
              total: collections.length,
              totalDocuments: collections.reduce(
                (sum, col) => sum + col.count,
                0
              ),
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
      // Use the documentation service to search
      const results = await this.documentationService.searchDocumentation(
        query,
        sourceId ? { sourceId, limit } : { limit }
      );

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
            sourceId: result.sourceId,
            sourceName: result.sourceName,
            relevanceScore: result.relevanceScore,
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
}
