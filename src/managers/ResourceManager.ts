import type {
  Resource,
  ResourceTemplate,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import { DatabaseManager } from "../database/index.js";
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
import { StoragePathResolver } from "../services/StoragePathResolver.js";
import { getSymbolGraphIndexer } from "../services/SymbolGraphIndexer.js";
import { readdir, stat, readFile } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";
import { Logger } from "../utils/logger.js";

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
  private logger: Logger;

  constructor(private db: DatabaseManager, repositoryPath: string) {
    // Resolve repository path to absolute path
    this.repositoryPath = PathUtils.resolveRepositoryPath(
      repositoryPath,
      "ResourceManager"
    );

    this.communicationService = new CommunicationService(this.db);

    // Vector search with project-local storage (fixes #6: venv isolation)
    const vectorSearchConfig = {
      projectPath: this.repositoryPath,
      preferLocal: true,
      embeddingModel: 'qwen3_4b'  // TalentOS GPU embeddings (Qwen3-4B 2560D)
    };
    const vectorService = new VectorSearchService(this.db, vectorSearchConfig);
    this.vectorSearchService = vectorService;

    this.knowledgeGraphService = new KnowledgeGraphService(this.db, vectorService);
    this.memoryService = new MemoryService(this.db);
    this.webScrapingService = new WebScrapingService(
      this.db,
      this.repositoryPath
    );
    this.documentationService = new DocumentationService(this.db);
    this.websiteRepository = new WebsiteRepository(this.db);
    this.websitePagesRepository = new WebsitePagesRepository(this.db);
    this.treeSitterASTTool = new TreeSitterASTTool();
    this.treeSummaryService = new TreeSummaryService();
    this.logger = new Logger('resource-manager');
  }

  /**
   * Get logs directory path using StoragePathResolver
   */
  private getLogsPath(category?: string): string {
    const storageConfig = StoragePathResolver.getStorageConfig({ preferLocal: true });
    return StoragePathResolver.getLogsPath(storageConfig, category);
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
          "Get project directory tree. TWO MODES: 1) flat=true (RECOMMENDED): Instant paginated file list from Symbol Graph SQLite cache (3,891 files in <50ms). COMPACT by default (just file paths, 70-80% token savings). Use ?verbose=true for metadata. Use ?dir=src/ for hierarchical navigation. 2) flat=false (default): Live filesystem scan with async batching + limits (slower). Example: project://{path}/structure?flat=true&limit=100&cursor=<token>",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "project path (. for current directory)",
            "flat": "true = cached paginated list (instant), false = live tree scan (slower, default: false)",
            "verbose": "true = include metadata (indexed_at, symbol_count, has_embeddings), false = compact mode with only file paths (default: false, flat mode only)",
            "dir": "filter files by directory prefix for hierarchical navigation (e.g., dir=src/, flat mode only)",
            "limit": "max results per page (flat mode only, default: 100)",
            "cursor": "pagination cursor from nextCursor field (flat mode only)",
            "max_depth": "maximum directory depth for tree mode (default: 3)",
            "max_files": "maximum files to scan in tree mode (default: 1000)",
            "max_directories": "maximum directories to scan in tree mode (default: 500)",
            "exclude": "comma-separated exclude patterns for tree mode (default: node_modules,dist,.git,.next,build,coverage)"
          }
        }
      },
      {
        uriTemplate: "project://*/dependencies",
        name: "File Dependencies",
        description:
          "Get direct dependencies (imports) for a source file from symbol graph cache (use project://{file_path}/dependencies). Fast SQLite lookup using indexed import tracking.",
        mimeType: "application/json",
        _meta: {
          "params": {
            "file_path": "relative path to source file (in URI path)"
          }
        }
      },
      {
        uriTemplate: "project://*/dependents",
        name: "File Dependents",
        description:
          "Get reverse dependencies (files that import this file) from symbol graph cache (use project://{file_path}/dependents). Fast SQLite lookup for impact analysis.",
        mimeType: "application/json",
        _meta: {
          "params": {
            "file_path": "relative path to source file (in URI path)"
          }
        }
      },
      {
        uriTemplate: "project://*/circular-deps",
        name: "Circular Dependencies",
        description:
          "Detect circular dependency chains in the project using DFS graph traversal (use project://./circular-deps). Helps identify problematic import cycles.",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "project path (. for current directory)"
          }
        }
      },
      {
        uriTemplate: "project://*/impact-analysis",
        name: "Impact Analysis",
        description:
          "Analyze impact of changes to a file via recursive dependency traversal (use project://{file_path}/impact-analysis?max_depth=5). Shows all files affected by modifications.",
        mimeType: "application/json",
        _meta: {
          "params": {
            "file_path": "relative path to source file (in URI path)",
            "max_depth": "maximum traversal depth (default: 5)"
          }
        }
      },
      // Symbol Graph Cache Resources (Unix composability - query cached symbols)
      {
        uriTemplate: "symbols://list",
        name: "Cached Symbol Files",
        description:
          "📂 LIST INDEXED FILES (PAGINATED): Get all files currently indexed in symbol graph cache (SQLite). Use to compare cached files vs actual project structure before indexing. Returns file paths, last indexed time, symbol counts. Instant SQLite query. **Params**: `?limit=100&cursor=<token>`. Default limit: 100, sorted by indexed time (newest first). Returns: nextCursor for pagination.",
        mimeType: "application/json",
        _meta: {
          "params": {
            "limit": "max files to return (default: 100)",
            "cursor": "optional cursor token from previous response for pagination"
          }
        }
      },
      {
        uriTemplate: "symbols://search",
        name: "Symbol Search",
        description:
          "🔍 FIND SYMBOLS BY NAME/TYPE (PAGINATED): Search cached symbols by name and type (function, class, method, interface). Use `?name=foo&type=function&limit=50&cursor=<token>` to find specific symbols. Returns symbol definitions with file locations. Fast SQLite lookup. **Pagination**: Default limit 50, use nextCursor for more results.",
        mimeType: "application/json",
        _meta: {
          "params": {
            "name": "symbol name to search for (partial match)",
            "type": "symbol type filter (function, class, method, interface, variable)",
            "limit": "max results (default: 50)",
            "cursor": "optional cursor token from previous response for pagination"
          }
        }
      },
      {
        uriTemplate: "symbols://file/*",
        name: "File Symbols (Cached)",
        description:
          "📄 GET SYMBOLS FROM CACHE: Get all symbols for a specific file from cache (use symbols://file/{path}). Returns cached symbol definitions without reparsing. Instant SQLite lookup. Compare with file://{path}/symbols (live parse) to verify freshness.",
        mimeType: "application/json",
        _meta: {
          "params": {
            "path": "relative path to source file (in URI path)"
          }
        }
      },
      {
        uriTemplate: "symbols://stats",
        name: "Symbol Graph Statistics",
        description:
          "📊 INDEX HEALTH CHECK: Get symbol graph cache statistics - total files indexed, symbols extracted, cache hit rate, embedding coverage, last update times. Use to verify indexing completed and check what's searchable. Instant SQLite query.",
        mimeType: "application/json",
        _meta: {
          "params": {}
        }
      },
      // Knowledge Graph Resources (replaces 3 tools - saves 570 tokens)
      {
        uriTemplate: "knowledge://search",
        name: "Knowledge Graph Search",
        description:
          "🔍 SEARCH BEFORE IMPLEMENTING (PAGINATED): Search GitHub issues, architecture docs, implementation patterns, and prior solutions. Contains: ZMCPTools issues, TalentOS architecture (CLAUDE.md, etc/*.md, docs/*.md), design decisions, and known solutions. Use for: finding prior work, understanding architecture, discovering existing solutions, checking if feature exists. GPU-accelerated semantic + BM25 hybrid search. **Pagination**: Default limit 10, use cursor for more results. Example: knowledge://search?query=resource+migration+MCP&limit=10&cursor=<token>",
        mimeType: "application/json",
        _meta: {
          "params": {
            "query": "what to search for (e.g., 'authentication pattern', 'embedding service')",
            "limit": "max results (default: 10, try 5-20)",
            "cursor": "optional cursor token from previous response for pagination",
            "threshold": "similarity threshold 0-1 (default: 0.7, lower = more results)",
            "use_bm25": "keyword search (default: true, good for exact terms)",
            "use_embeddings": "semantic search (default: true, good for concepts)",
            "use_reranker": "apply reranker (default: false, slower but better)"
          }
        }
      },
      {
        uriTemplate: "knowledge://entity/*/related",
        name: "Related Knowledge Entities",
        description:
          "📊 DISCOVER CONNECTIONS: Find entities related to a specific entity via graph traversal. Use after finding an entity via search to discover: related issues, connected docs, dependency chains, implementation patterns, similar solutions. Example: knowledge://entity/issue-35/related?limit=5&min_strength=0.6 finds docs/issues related to issue #35",
        mimeType: "application/json",
        _meta: {
          "params": {
            "id": "entity ID from search results (in URI path like /entity/ID/related)",
            "limit": "max related entities (default: 10)",
            "min_strength": "minimum relationship strength 0-1 (default: 0.5, higher = stronger connections)"
          }
        }
      },
      {
        uriTemplate: "knowledge://status",
        name: "Knowledge Graph Status",
        description:
          "📈 KNOWLEDGE GRAPH HEALTH: Get statistics about indexed content - total entities, relationships, quality metrics, entity types, index freshness. Use to: verify indexing completed, check what's searchable, understand graph size, debug empty search results. Quick health check before searching",
        mimeType: "application/json",
        _meta: {
          "params": {}
        }
      },
      {
        uriTemplate: "vector://collections",
        name: "Vector Collections",
        description:
          "📚 BROWSE VECTOR COLLECTIONS: List all LanceDB collections with statistics (doc count, embedding dimensions, storage size). Use `?search=text` to find specific collections. Useful for discovering available knowledge bases before semantic search.",
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
          "🔍 SEMANTIC SEARCH: Find documents by meaning, not keywords. Query across vector collections using embeddings for similarity matching. Returns top-N most relevant results with cosine similarity scores. Use `?collection=name` to target specific knowledge bases.",
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
        description: "📊 VECTOR DATABASE HEALTH: Check LanceDB connection status, TalentOS GPU integration info, active embedding models (Stock vs Enhanced mode), and available vector collections. Use to verify GPU acceleration and model configuration before operations.",
        mimeType: "application/json",
        _meta: {
          "params": {}
        }
      },
      {
        uriTemplate: "logs://list",
        name: "Logs Directory",
        description: "📂 BROWSE LOG DIRECTORIES: List all log directories in ~/.mcptools/logs/ organized by agent, session, or service type. Use to discover available logs before drilling down to specific files. Returns directory names and file counts.",
        mimeType: "application/json",
        _meta: {
          "params": {}
        }
      },
      {
        uriTemplate: "logs://*/files",
        name: "Log Files",
        description:
          "📄 LIST LOG FILES (PAGINATED): Get log files with pagination. **Params**: `?limit=100&offset=0`. Default limit: 100, sorted by modified time (newest first). Returns: files array, total, hasMore, nextOffset. Example: `logs://crashes/files?limit=50&offset=0`",
        mimeType: "application/json",
        _meta: {
          "params": {
            "dirname": "name of the log directory to list files from",
            "limit": "max files to return (default: 100)",
            "offset": "skip N files (default: 0)"
          }
        }
      },
      {
        uriTemplate: "logs://*/content",
        name: "Log File Content",
        description:
          "📖 GREP LOG CONTENT (PAGINATED): Search/filter log content with regex + pagination. **Required**: `?file=error.log`. **Optional**: `pattern=CUDA` (regex), `case_insensitive=true`, `line_numbers=true`, `A=3` (after), `B=3` (before), `C=3` (context), `limit=1000`, `offset=0`. Example: `logs://crashes/content?file=agent.log&pattern=error&case_insensitive=true&line_numbers=true&C=2&limit=100`",
        mimeType: "text/plain",
        _meta: {
          "params": {
            "dirname": "name of the log directory",
            "file": "log file name (required)",
            "pattern": "regex pattern to match",
            "case_insensitive": "case-insensitive matching",
            "line_numbers": "show line numbers",
            "A": "context lines after match",
            "B": "context lines before match",
            "C": "context lines around match",
            "limit": "max lines to return (default: 1000)",
            "offset": "skip N matched lines (default: 0)"
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

    // Handle symbols:// resources with dynamic paths
    if (scheme === "symbols") {
      return await this.getSymbolsResource(path, searchParams);
    }

    const resourceKey = `${scheme}://${path}`;

    switch (resourceKey) {
      case "vector://collections":
        return await this.getVectorCollections(searchParams);

      case "vector://search":
        return await this.getVectorSearch(searchParams);

      case "vector://status":
        return await this.getVectorStatus();

      case "knowledge://search":
        return await this.getKnowledgeSearch(searchParams);

      case "knowledge://status":
        return await this.getKnowledgeStatus(searchParams);

      case "logs://list":
        return await this.getLogsList();

      default:
        // Handle logs://{dirname}/files pattern
        if (scheme === "logs" && path.endsWith("/files")) {
          const dirname = path.replace("/files", "");
          if (dirname) {
            return await this.getLogFiles(dirname, searchParams);
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
        ? `${versionInfo} + TalentOS GPU embeddings`
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
              active_model: talentosStatus?.available ? 'qwen3_4b' : 'Xenova/all-MiniLM-L6-v2',
              dimensions: talentosStatus?.available ? 2560 : 384,
              acceleration: talentosStatus?.available ? 'GPU (Qwen3-4B 2560D)' : 'CPU baseline',
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
      const logsPath = this.getLogsPath();
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
            path: this.getLogsPath(),
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

  private async getLogFiles(dirname: string, searchParams?: URLSearchParams): Promise<TextResourceContents> {
    try {
      const dirPath = this.getLogsPath(dirname);
      const entries = await readdir(dirPath, { withFileTypes: true });

      // Pagination parameters
      const limit = parseInt(searchParams?.get("limit") || "100");
      const offset = parseInt(searchParams?.get("offset") || "0");

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

      // Sort by modified time (newest first)
      const sortedFiles = files.sort((a, b) => b.modified.localeCompare(a.modified));

      // Apply pagination
      const paginatedFiles = sortedFiles.slice(offset, offset + limit);
      const hasMore = offset + limit < sortedFiles.length;

      return {
        uri: `logs://${dirname}/files`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            directory: dirname,
            path: dirPath,
            files: paginatedFiles,
            total: files.length,
            limit,
            offset,
            hasMore,
            nextOffset: hasMore ? offset + limit : undefined,
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
            path: this.getLogsPath(dirname),
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
      const dirPath = this.getLogsPath(dirname);
      const filePath = join(dirPath, filename);
      const content = await readFile(filePath, "utf8");

      // Grep/filter parameters
      const pattern = searchParams.get("pattern");
      const caseInsensitive = searchParams.get("case_insensitive") === "true";
      const lineNumbers = searchParams.get("line_numbers") === "true";
      const contextBefore = parseInt(searchParams.get("B") || "0");
      const contextAfter = parseInt(searchParams.get("A") || "0");
      const contextAround = parseInt(searchParams.get("C") || "0");

      // Pagination parameters
      const limit = parseInt(searchParams.get("limit") || "1000");
      const offset = parseInt(searchParams.get("offset") || "0");

      let lines = content.split("\n");
      let matchedLines: Array<{lineNum: number, content: string, isContext?: boolean}> = [];

      if (pattern) {
        // Create regex from pattern
        const flags = caseInsensitive ? "i" : "";
        const regex = new RegExp(pattern, flags);

        const beforeLines = contextAround || contextBefore;
        const afterLines = contextAround || contextAfter;

        // Track which lines to include
        const linesToInclude = new Set<number>();

        // Find matches and mark context lines
        lines.forEach((line, idx) => {
          if (regex.test(line)) {
            // Mark match line
            linesToInclude.add(idx);

            // Mark context lines
            for (let i = Math.max(0, idx - beforeLines); i < idx; i++) {
              linesToInclude.add(i);
            }
            for (let i = idx + 1; i <= Math.min(lines.length - 1, idx + afterLines); i++) {
              linesToInclude.add(i);
            }
          }
        });

        // Build matched lines array
        const sortedLines = Array.from(linesToInclude).sort((a, b) => a - b);
        matchedLines = sortedLines.map(idx => ({
          lineNum: idx + 1,
          content: lines[idx],
          isContext: !regex.test(lines[idx])
        }));

      } else {
        // No pattern, return all lines
        matchedLines = lines.map((line, idx) => ({
          lineNum: idx + 1,
          content: line
        }));
      }

      // Apply pagination
      const paginatedLines = matchedLines.slice(offset, offset + limit);
      const hasMore = offset + limit < matchedLines.length;

      // Format output
      let formattedText = "";
      if (lineNumbers) {
        formattedText = paginatedLines.map(l =>
          `${l.lineNum}:${l.isContext ? "-" : ""} ${l.content}`
        ).join("\n");
      } else {
        formattedText = paginatedLines.map(l => l.content).join("\n");
      }

      // Add metadata footer
      const metadata = [
        `\n---`,
        `Matches: ${matchedLines.length}`,
        `Showing: ${offset + 1}-${Math.min(offset + limit, matchedLines.length)}`,
        hasMore ? `More available: use ?offset=${offset + limit}` : 'End of results',
        pattern ? `Pattern: ${pattern}${caseInsensitive ? ' (case-insensitive)' : ''}` : 'No filter'
      ].join('\n');

      return {
        uri: `logs://${dirname}/content?file=${filename}${pattern ? `&pattern=${pattern}` : ''}`,
        mimeType: "text/plain",
        text: formattedText + metadata,
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
    const cursor = searchParams.get("cursor");
    const threshold = parseFloat(searchParams.get("threshold") || "0.0");
    const useBm25 = searchParams.get("use_bm25") !== "false"; // default true
    const useEmbeddings = searchParams.get("use_embeddings") !== "false"; // default true
    const bm25Weight = parseFloat(searchParams.get("bm25_weight") || "0.3");
    const semanticWeight = parseFloat(searchParams.get("semantic_weight") || "0.7");

    if (!query) {
      return {
        uri: "knowledge://search",
        mimeType: "application/json",
        text: JSON.stringify({
          error: "Query parameter is required for knowledge graph search",
          query: "",
          results: [],
          total: 0,
          search_params: { useBm25, useEmbeddings, threshold, bm25Weight, semanticWeight },
          timestamp: new Date().toISOString(),
        }),
      };
    }

    try {
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

      // Use IndexedKnowledgeSearch for direct search of indexed_knowledge.json
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      this.logger.info('[ResourceManager] Creating IndexedKnowledgeSearch with path:', this.repositoryPath);
      const searchService = new IndexedKnowledgeSearch(this.repositoryPath);

      // Fetch more results to support pagination
      const fetchLimit = startPosition + limit * 2;
      this.logger.info('[ResourceManager] Calling search with query:', { query, options: { limit: fetchLimit, useBm25, useEmbeddings } });
      const allResults = await searchService.search(query, {
        limit: fetchLimit,
        useBm25,
        useSemanticSearch: useEmbeddings,
        bm25Weight,
        semanticWeight,
        minScoreThreshold: threshold
      });
      this.logger.info('[ResourceManager] Search returned', { count: allResults.length });

      // Apply cursor-based pagination
      const endPosition = startPosition + limit;
      const paginatedResults = allResults.slice(startPosition, endPosition);

      // Generate next cursor if more results exist
      let nextCursor: string | undefined;
      if (allResults.length > endPosition) {
        nextCursor = CursorManager.createPositionCursor(endPosition);
      }

      // Format results for knowledge:// resource
      const formattedResults = paginatedResults.map(r => ({
        id: r.document.id,
        type: r.document.type,
        title: r.document.title || r.document.relative_path || r.document.id,
        content: r.document.content.substring(0, 500), // Preview
        score: r.score,
        matchType: r.matchType,
        bm25Score: r.bm25Score,
        semanticScore: r.semanticScore,
        // Include metadata
        repo: r.document.repo,
        number: r.document.number,
        state: r.document.state,
        labels: r.document.labels,
        file_path: r.document.file_path,
        relative_path: r.document.relative_path
      }));

      return {
        uri: `knowledge://search?query=${encodeURIComponent(query)}&limit=${limit}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            query,
            results: formattedResults,
            nextCursor,
            limit,
            total: allResults.length,
            search_params: { useBm25, useEmbeddings, threshold, bm25Weight, semanticWeight },
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
            search_params: { useBm25, useEmbeddings, threshold, bm25Weight, semanticWeight },
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
            related: results.slice(0, limit).map((entity: any) => ({
              id: entity.id,
              type: entity.entity_type,
              name: entity.name,
              description: entity.description?.substring(0, 200),
              importance: entity.importance_score,
              distance: entity.distance || 1,
              relationshipType: entity.relationship_type,
              strength: entity.strength || 0.7,
            })),
            total: results.length,
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

  private async getKnowledgeStatus(searchParams?: URLSearchParams): Promise<TextResourceContents> {
    try {
      // Support optional repository_path parameter for partition-specific stats
      const repositoryPath = searchParams?.get("repository_path") || this.repositoryPath;

      const stats = await this.knowledgeGraphService.getStats(
        repositoryPath
      );

      // Calculate quality metrics from entities
      const avgImportance = stats.topEntitiesByImportance.length > 0
        ? stats.topEntitiesByImportance.reduce((sum, e) => sum + (e.importanceScore || 0), 0) / stats.topEntitiesByImportance.length
        : 0;

      const avgConfidence = stats.topEntitiesByImportance.length > 0
        ? stats.topEntitiesByImportance.reduce((sum, e) => sum + (e.confidenceScore || 0), 0) / stats.topEntitiesByImportance.length
        : 0;

      return {
        uri: `knowledge://status${repositoryPath !== this.repositoryPath ? `?repository_path=${encodeURIComponent(repositoryPath)}` : ''}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            partition: {
              repository_path: repositoryPath,
              is_default: repositoryPath === this.repositoryPath
            },
            total_entities: stats.totalEntities,
            total_relationships: stats.totalRelationships,
            entity_types: stats.entitiesByType,
            quality_metrics: {
              avg_importance: avgImportance,
              avg_confidence: avgConfidence,
              low_quality_count: stats.topEntitiesByImportance.filter(e => (e.importanceScore || 0) < 0.3).length,
            },
            storage_info: {
              repository_path: repositoryPath,
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

    // Resolve file path relative to repository path
    const resolvedFilePath = resolve(this.repositoryPath, filePath);

    // Build args from query parameters with defaults
    const args: any = {
      file_path: resolvedFilePath,
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

      // Check if operation failed (has errors)
      if (result.success === false || result.errors) {
        return {
          uri: `file://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              uri: `file://${path}`,
              language: result.language,
              errors: result.errors || []
            },
            null,
            2
          ),
        };
      }

      // Build compact hierarchical output for symbols
      let outputData: any;
      if (aspect === "symbols") {
        // Compact hierarchical format with location encoding
        outputData = {
          uri: `file://${path}`,
          language: result.language,
          symbols: result.symbols || []
        };
      } else if (aspect === "structure") {
        // Structure returns markdown text directly
        return {
          uri: `file://${path}`,
          mimeType,
          text: typeof result.structure === "string"
            ? result.structure
            : JSON.stringify(result, null, 2)
        };
      } else {
        // For other aspects (imports, exports, diagnostics), use clean format
        outputData = {
          uri: `file://${path}`,
          language: result.language,
          ...result
        };
        // Remove redundant wrapper fields
        delete outputData.success;
      }

      return {
        uri: `file://${path}`,
        mimeType,
        text: JSON.stringify(outputData, null, 2),
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
      // NEW: flat=true mode uses Symbol Graph cache (instant, paginated)
      const useFlat = searchParams.get("flat") === "true";

      if (useFlat) {
        // CACHE MODE: Query Symbol Graph SQLite cache for instant results
        try {
          const indexer = getSymbolGraphIndexer();
          await indexer.initialize(resolvedPath);

          // Get all indexed files from cache
          let allFiles = await indexer.getIndexedFiles();

          // Directory filtering for hierarchical navigation
          const dirFilter = searchParams.get("dir");
          if (dirFilter) {
            const normalizedFilter = dirFilter.endsWith("/") ? dirFilter : dirFilter + "/";
            allFiles = allFiles.filter(f => f.file_path.startsWith(normalizedFilter));
          }

          // Pagination parameters
          const limit = parseInt(searchParams.get("limit") || "100");
          const cursor = searchParams.get("cursor");

          // Verbose mode: include metadata (indexed_at, symbol_count, has_embeddings)
          // Compact mode (default): only file_path strings (70-80% token reduction)
          const verbose = searchParams.get("verbose") === "true";

          // Parse cursor for position
          let startPosition = 0;
          if (cursor) {
            try {
              const cursorData = CursorManager.decode(cursor);
              startPosition = cursorData.position || 0;
            } catch (error) {
              throw new Error('Invalid cursor parameter');
            }
          }

          // Apply cursor-based pagination
          const endPosition = startPosition + limit;
          const paginatedFiles = allFiles.slice(startPosition, endPosition);

          // Generate next cursor if more results exist
          let nextCursor: string | undefined;
          if (endPosition < allFiles.length) {
            nextCursor = CursorManager.createPositionCursor(endPosition);
          }

          // Format files based on verbose flag
          const formattedFiles = verbose
            ? paginatedFiles.map(f => ({
                file_path: f.file_path,
                indexed_at: f.indexed_at,
                symbol_count: f.symbol_count || 0,
                has_embeddings: f.has_embeddings || false
              }))
            : paginatedFiles.map(f => f.file_path); // Compact: just strings

          return {
            uri: `project://${path}?flat=true`,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                project_path: resolvedPath,
                mode: verbose ? "cached_flat_verbose" : "cached_flat_compact",
                files: formattedFiles,
                nextCursor,
                limit,
                total: allFiles.length,
                ...(dirFilter && { dir_filter: dirFilter }),
                performance: {
                  source: "Symbol Graph SQLite cache (instant)",
                  token_optimization: verbose ? "verbose mode (full metadata)" : "compact mode (70-80% token reduction)",
                  note: "Use ?verbose=true for debugging with metadata. Use ?dir=src/ for hierarchical navigation."
                },
                timestamp: new Date().toISOString()
              },
              null,
              2
            )
          };
        } catch (error) {
          return {
            uri: `project://${path}?flat=true`,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                error: error instanceof Error ? error.message : "Failed to query symbol graph cache",
                hint: "Run index_symbol_graph tool first to populate cache, or use flat=false for live scan",
                timestamp: new Date().toISOString()
              },
              null,
              2
            )
          };
        }
      }

      // LIVE SCAN MODE: Original tree-based scanning with limits
      const maxDepth = parseInt(searchParams.get("max_depth") || "3");  // LOWERED default from 5→3
      const maxFiles = parseInt(searchParams.get("max_files") || "1000");  // NEW: File count limit
      const maxDirectories = parseInt(searchParams.get("max_directories") || "500");  // NEW: Dir count limit
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
          { maxDepth, excludePatterns, maxFiles, maxDirectories }
        );

        // Calculate stats from the structure
        const totalFiles = this.countFiles(structure);
        const totalDirectories = this.countDirectories(structure);

        // Check if limits were hit
        const limitWarnings = [];
        if (totalFiles >= maxFiles) {
          limitWarnings.push(`File limit reached (${maxFiles}). Use ?max_files=N to increase or reduce max_depth.`);
        }
        if (totalDirectories >= maxDirectories) {
          limitWarnings.push(`Directory limit reached (${maxDirectories}). Use ?max_directories=N to increase or reduce max_depth.`);
        }

        return {
          uri: `project://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              project_path: resolvedPath,
              mode: "live_tree",
              max_depth: maxDepth,
              max_files: maxFiles,
              max_directories: maxDirectories,
              exclude_patterns: excludePatterns,
              structure,
              total_files: totalFiles,
              total_directories: totalDirectories,
              warnings: limitWarnings.length > 0 ? limitWarnings : undefined,
              performance: {
                async_batching: "Yields control every 10 directories to prevent blocking",
                recommendation: totalFiles > 500 ? "Consider using flat=true for cached paginated results" : "Scan completed within limits"
              },
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
    } else if (aspect === "dependencies") {
      // Get direct dependencies (imports) for a file
      try {
        const indexer = getSymbolGraphIndexer();
        await indexer.initialize(this.repositoryPath);

        const dependencies = await indexer.getFileDependencies(resolvedPath);

        return {
          uri: `project://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              file_path: resolvedPath,
              dependencies,
              total: dependencies.length,
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
                  : "Failed to get file dependencies",
              file_path: resolvedPath,
              aspect
            },
            null,
            2
          )
        };
      }
    } else if (aspect === "dependents") {
      // Get reverse dependencies (files that import this file)
      try {
        const indexer = getSymbolGraphIndexer();
        await indexer.initialize(this.repositoryPath);

        const dependents = await indexer.getFileDependents(resolvedPath);

        return {
          uri: `project://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              file_path: resolvedPath,
              dependents,
              total: dependents.length,
              impact_note: "These files import the specified file and may be affected by changes",
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
                  : "Failed to get file dependents",
              file_path: resolvedPath,
              aspect
            },
            null,
            2
          )
        };
      }
    } else if (aspect === "circular-deps") {
      // Detect circular dependency chains
      try {
        const indexer = getSymbolGraphIndexer();
        await indexer.initialize(this.repositoryPath);

        const cycles = await indexer.detectCircularDependencies();

        return {
          uri: `project://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              project_path: resolvedPath,
              circular_dependencies: cycles,
              total_cycles: cycles.length,
              severity: cycles.length > 0 ? "warning" : "ok",
              note: cycles.length > 0
                ? "Circular dependencies found - consider refactoring to break cycles"
                : "No circular dependencies detected",
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
                  : "Failed to detect circular dependencies",
              project_path: resolvedPath,
              aspect
            },
            null,
            2
          )
        };
      }
    } else if (aspect === "impact-analysis") {
      // Recursive impact analysis (all affected files)
      const maxDepth = parseInt(searchParams.get("max_depth") || "5");

      try {
        const indexer = getSymbolGraphIndexer();
        await indexer.initialize(this.repositoryPath);

        const impactedFiles = await indexer.getImpactAnalysis(resolvedPath, maxDepth);

        return {
          uri: `project://${path}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              file_path: resolvedPath,
              max_depth: maxDepth,
              impacted_files: impactedFiles,
              total_impacted: impactedFiles.length,
              note: "Files shown in dependency order - changes to the target file may affect these files",
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
                  : "Failed to perform impact analysis",
              file_path: resolvedPath,
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
            valid_aspects: ["structure", "dependencies", "dependents", "circular-deps", "impact-analysis"],
            usage: "project://{path}/{aspect}?params"
          },
          null,
          2
        )
      };
    }
  }

  /**
   * Handle symbols:// resource URIs for symbol graph cache queries
   * URI format: symbols://{aspect}?params
   * Examples:
   *   - symbols://list
   *   - symbols://search?name=foo&type=function
   *   - symbols://file/{path}
   *   - symbols://stats
   */
  private async getSymbolsResource(
    path: string,
    searchParams: URLSearchParams
  ): Promise<TextResourceContents> {
    try {
      const indexer = getSymbolGraphIndexer();
      await indexer.initialize(this.repositoryPath);

      // Handle symbols://list - all indexed files (with cursor pagination)
      if (path === "list") {
        const limit = parseInt(searchParams.get("limit") || "100");
        const cursor = searchParams.get("cursor");

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

        const files = await indexer.getIndexedFiles();

        // Sort by indexed_at time for consistent cursor pagination
        const sortedFiles = files.sort((a, b) =>
          new Date(b.indexed_at || 0).getTime() - new Date(a.indexed_at || 0).getTime()
        );

        // Apply cursor-based pagination
        const endPosition = startPosition + limit;
        const paginatedFiles = sortedFiles.slice(startPosition, endPosition);

        // Generate next cursor if more results exist
        let nextCursor: string | undefined;
        if (endPosition < sortedFiles.length) {
          nextCursor = CursorManager.createPositionCursor(endPosition);
        }

        return {
          uri: "symbols://list",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              repository_path: this.repositoryPath,
              indexed_files: paginatedFiles.map(f => ({
                file_path: f.file_path,
                indexed_at: f.indexed_at,
                symbol_count: f.symbol_count || 0,
                has_embeddings: f.has_embeddings || false
              })),
              nextCursor,
              limit,
              total: sortedFiles.length,
              timestamp: new Date().toISOString()
            },
            null,
            2
          )
        };
      }

      // Handle symbols://search?name=foo&type=function - search symbols (with cursor pagination)
      if (path === "search") {
        const name = searchParams.get("name") || "";
        const type = searchParams.get("type") || undefined;
        const limit = parseInt(searchParams.get("limit") || "50");
        const cursor = searchParams.get("cursor");

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

        // Get more results than limit to determine if more exist
        const fetchLimit = startPosition + limit * 2;
        const allSymbols = await indexer.searchSymbols(name, type, fetchLimit);

        // Apply cursor-based pagination
        const endPosition = startPosition + limit;
        const paginatedSymbols = allSymbols.slice(startPosition, endPosition);

        // Generate next cursor if more results exist
        let nextCursor: string | undefined;
        if (allSymbols.length > endPosition) {
          nextCursor = CursorManager.createPositionCursor(endPosition);
        }

        return {
          uri: `symbols://search?name=${name}${type ? `&type=${type}` : ""}&limit=${limit}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              query: { name, type, limit },
              symbols: paginatedSymbols.map(s => ({
                name: s.name,
                type: s.type,
                file_path: s.file_path,
                start_line: s.start_line,
                end_line: s.end_line,
                signature: s.signature
              })),
              nextCursor,
              limit,
              total: allSymbols.length,
              timestamp: new Date().toISOString()
            },
            null,
            2
          )
        };
      }

      // Handle symbols://stats - index statistics
      if (path === "stats") {
        const stats = await indexer.getStats();

        return {
          uri: "symbols://stats",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              repository_path: this.repositoryPath,
              total_files: stats.totalFiles,
              files_with_embeddings: stats.filesWithEmbeddings,
              total_symbols: stats.totalSymbols || 0,
              cache_hit_rate: stats.cacheHitRate || 0,
              last_indexed: stats.lastIndexed || null,
              embedding_coverage: stats.filesWithEmbeddings / Math.max(stats.totalFiles, 1),
              timestamp: new Date().toISOString()
            },
            null,
            2
          )
        };
      }

      // Handle symbols://file/{path} - symbols for specific file
      if (path.startsWith("file/")) {
        const filePath = path.replace("file/", "");
        const resolvedPath = resolve(this.repositoryPath, filePath);

        const symbols = await indexer.getFileSymbols(resolvedPath);
        const fileInfo = await indexer.getFileInfo(resolvedPath);

        return {
          uri: `symbols://file/${filePath}`,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              file_path: resolvedPath,
              indexed_at: fileInfo?.indexed_at || null,
              has_embeddings: fileInfo?.has_embeddings || false,
              symbols: symbols.map(s => ({
                name: s.name,
                type: s.type,
                start_line: s.start_line,
                end_line: s.end_line,
                signature: s.signature
              })),
              total: symbols.length,
              note: "Cached symbols - compare with file://{path}/symbols for live parse",
              timestamp: new Date().toISOString()
            },
            null,
            2
          )
        };
      }

      // Unknown symbols:// resource
      return {
        uri: `symbols://${path}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error: `Unknown symbols resource: ${path}`,
            valid_resources: ["list", "search", "stats", "file/{path}"],
            usage: "symbols://{resource}?params"
          },
          null,
          2
        )
      };

    } catch (error) {
      return {
        uri: `symbols://${path}`,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to access symbol graph cache",
            path,
            repository_path: this.repositoryPath,
            timestamp: new Date().toISOString()
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
