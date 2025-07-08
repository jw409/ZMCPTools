import type { Resource, TextResourceContents } from '@modelcontextprotocol/sdk/types.js';
import { DatabaseManager } from '../database/index.js';
import { AgentService } from '../services/AgentService.js';
import { CommunicationService } from '../services/CommunicationService.js';
import { WebScrapingService } from '../services/WebScrapingService.js';
import { DocumentationService } from '../services/DocumentationService.js';
import { MemoryService } from '../services/MemoryService.js';
import { VectorSearchService } from '../services/VectorSearchService.js';
import { PathUtils } from '../utils/pathUtils.js';

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
  private memoryService: MemoryService;
  private vectorSearchService: VectorSearchService;

  constructor(
    private db: DatabaseManager,
    repositoryPath: string
  ) {
    // Resolve repository path to absolute path
    this.repositoryPath = PathUtils.resolveRepositoryPath(repositoryPath, 'ResourceManager');
    
    this.agentService = new AgentService(this.db);
    this.communicationService = new CommunicationService(this.db);
    this.memoryService = new MemoryService(this.db);
    this.webScrapingService = new WebScrapingService(
      this.db,
      this.agentService,
      this.memoryService,
      this.repositoryPath
    );
    this.documentationService = new DocumentationService(this.db);
    this.vectorSearchService = new VectorSearchService(this.db);
  }

  /**
   * Get all available resources
   */
  async listResources(): Promise<Resource[]> {
    const resources: Resource[] = [
      {
        uri: 'agents://list',
        name: 'Agent List',
        description: 'List of all active agents with their status and metadata',
        mimeType: 'application/json'
      },
      {
        uri: 'communication://rooms',
        name: 'Communication Rooms',
        description: 'List of all active communication rooms',
        mimeType: 'application/json'
      },
      {
        uri: 'communication://messages',
        name: 'Room Messages',
        description: 'Recent messages from communication rooms (use ?room=name&limit=50)',
        mimeType: 'application/json'
      },
      {
        uri: 'scraping://jobs',
        name: 'Scraper Jobs',
        description: 'List of web scraping jobs and their status',
        mimeType: 'application/json'
      },
      {
        uri: 'documentation://sources',
        name: 'Documentation Sources',
        description: 'List of scraped documentation sources',
        mimeType: 'application/json'
      },
      {
        uri: 'agents://insights',
        name: 'Agent Insights',
        description: 'Aggregated insights and learnings from agents',
        mimeType: 'application/json'
      },
      {
        uri: 'vector://collections',
        name: 'Vector Collections',
        description: 'List of ChromaDB vector collections and their statistics',
        mimeType: 'application/json'
      },
      {
        uri: 'vector://search',
        name: 'Vector Search',
        description: 'Semantic search across vector collections (use ?query=text&collection=name&limit=10)',
        mimeType: 'application/json'
      },
      {
        uri: 'vector://status',
        name: 'Vector Database Status',
        description: 'ChromaDB connection status and health information',
        mimeType: 'application/json'
      }
    ];

    return resources;
  }

  /**
   * Read a specific resource by URI
   */
  async readResource(uri: string): Promise<TextResourceContents> {
    // Parse custom URI schemes like communication://rooms, agents://list, etc.
    const [scheme, rest] = uri.split('://', 2);
    const [path, queryString] = rest ? rest.split('?', 2) : ['', ''];
    const searchParams = new URLSearchParams(queryString || '');

    const resourceKey = `${scheme}://${path}`;

    switch (resourceKey) {
      case 'agents://list':
        return await this.getAgentsList();
      
      case 'communication://rooms':
        return await this.getCommunicationRooms();
      
      case 'communication://messages':
        return await this.getRoomMessages(searchParams);
      
      case 'scraping://jobs':
        return await this.getScrapingJobs();
      
      case 'documentation://sources':
        return await this.getDocumentationSources();
      
      case 'agents://insights':
        return await this.getAgentInsights();
      
      case 'vector://collections':
        return await this.getVectorCollections();
      
      case 'vector://search':
        return await this.getVectorSearch(searchParams);
      
      case 'vector://status':
        return await this.getVectorStatus();
      
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  }

  private async getAgentsList(): Promise<TextResourceContents> {
    const agents = await this.agentService.listAgents(this.repositoryPath);
    
    return {
      uri: 'agents://list',
      mimeType: 'application/json',
      text: JSON.stringify({
        agents: agents.map(agent => ({
          id: agent.id,
          type: agent.agentType,
          status: agent.status,
          repositoryPath: agent.repositoryPath,
          taskDescription: agent.agentMetadata?.taskDescription || 'No description',
          createdAt: agent.createdAt,
          lastActiveAt: agent.lastHeartbeat,
          capabilities: agent.capabilities,
          metadata: agent.agentMetadata
        })),
        total: agents.length,
        timestamp: new Date().toISOString()
      }, null, 2)
    };
  }

  private async getCommunicationRooms(): Promise<TextResourceContents> {
    const rooms = await this.communicationService.listRooms(this.repositoryPath);
    
    return {
      uri: 'communication://rooms',
      mimeType: 'application/json',
      text: JSON.stringify({
        rooms: rooms.map(room => ({
          name: room.name,
          description: room.description,
          repositoryPath: room.repositoryPath,
          metadata: room.roomMetadata,
          createdAt: room.createdAt
        })),
        total: rooms.length,
        timestamp: new Date().toISOString()
      }, null, 2)
    };
  }

  private async getRoomMessages(searchParams: URLSearchParams): Promise<TextResourceContents> {
    const roomName = searchParams.get('room');
    const limit = parseInt(searchParams.get('limit') || '50');
    
    if (!roomName) {
      throw new Error('Room parameter is required for messages resource');
    }

    const messages = await this.communicationService.getRecentMessages(roomName, limit);
    
    return {
      uri: `communication://messages?room=${roomName}&limit=${limit}`,
      mimeType: 'application/json',
      text: JSON.stringify({
        roomName,
        messages: messages.map(msg => ({
          id: msg.id,
          agentName: msg.agentName,
          message: msg.message,
          timestamp: msg.timestamp,
          mentions: msg.mentions,
          messageType: msg.messageType
        })),
        total: messages.length,
        timestamp: new Date().toISOString()
      }, null, 2)
    };
  }

  private async getScrapingJobs(): Promise<TextResourceContents> {
    const status = await this.webScrapingService.getScrapingStatus();
    const jobs = [...status.active_jobs, ...status.pending_jobs];
    
    return {
      uri: 'scraping://jobs',
      mimeType: 'application/json',
      text: JSON.stringify({
        jobs: jobs.map(job => ({
          id: job.id,
          sourceId: job.sourceId,
          status: job.status,
          url: job.url,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          progress: job.progress,
          errorMessage: job.errorMessage
        })),
        total: jobs.length,
        timestamp: new Date().toISOString()
      }, null, 2)
    };
  }

  private async getDocumentationSources(): Promise<TextResourceContents> {
    const sources = await this.documentationService.listDocumentationSources();
    
    return {
      uri: 'documentation://sources',
      mimeType: 'application/json',
      text: JSON.stringify({
        sources: sources.map(source => ({
          id: source.id,
          name: source.name,
          url: source.url,
          sourceType: source.sourceType,
          entryCount: source.entryCount,
          lastScrapedAt: source.lastScrapedAt,
          createdAt: source.createdAt
        })),
        total: sources.length,
        timestamp: new Date().toISOString()
      }, null, 2)
    };
  }

  private async getAgentInsights(): Promise<TextResourceContents> {
    const insights = await this.memoryService.searchMemories('', { 
      repositoryPath: this.repositoryPath, 
      memoryType: 'insight',
      limit: 100 
    });
    
    return {
      uri: 'agents://insights',
      mimeType: 'application/json',
      text: JSON.stringify({
        insights: insights.map(insight => ({
          id: insight.id,
          agentId: insight.agentId,
          entryType: insight.memoryType,
          title: insight.title,
          content: insight.content,
          tags: insight.tags,
          createdAt: insight.createdAt
        })),
        total: insights.length,
        timestamp: new Date().toISOString()
      }, null, 2)
    };
  }

  private async getVectorCollections(): Promise<TextResourceContents> {
    try {
      const collections = await this.vectorSearchService.listCollections();
      
      return {
        uri: 'vector://collections',
        mimeType: 'application/json',
        text: JSON.stringify({
          collections: collections.map(collection => ({
            name: collection.name,
            documentCount: collection.count,
            metadata: collection.metadata
          })),
          total: collections.length,
          timestamp: new Date().toISOString()
        }, null, 2)
      };
    } catch (error) {
      return {
        uri: 'vector://collections',
        mimeType: 'application/json',
        text: JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to get vector collections',
          collections: [],
          total: 0,
          timestamp: new Date().toISOString()
        }, null, 2)
      };
    }
  }

  private async getVectorSearch(searchParams: URLSearchParams): Promise<TextResourceContents> {
    const query = searchParams.get('query');
    const collection = searchParams.get('collection') || 'documentation';
    const limit = parseInt(searchParams.get('limit') || '10');
    const threshold = parseFloat(searchParams.get('threshold') || '0.7');
    
    if (!query) {
      return {
        uri: `vector://search?query=${query}&collection=${collection}&limit=${limit}`,
        mimeType: 'application/json',
        text: JSON.stringify({
          error: 'Query parameter is required for vector search',
          results: [],
          total: 0,
          timestamp: new Date().toISOString()
        }, null, 2)
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
        mimeType: 'application/json',
        text: JSON.stringify({
          query,
          collection,
          results: results.map(result => ({
            id: result.id,
            content: result.content.substring(0, 500) + (result.content.length > 500 ? '...' : ''),
            similarity: result.similarity,
            distance: result.distance,
            metadata: result.metadata
          })),
          total: results.length,
          timestamp: new Date().toISOString()
        }, null, 2)
      };
    } catch (error) {
      return {
        uri: `vector://search?query=${query}&collection=${collection}&limit=${limit}`,
        mimeType: 'application/json',
        text: JSON.stringify({
          error: error instanceof Error ? error.message : 'Vector search failed',
          query,
          collection,
          results: [],
          total: 0,
          timestamp: new Date().toISOString()
        }, null, 2)
      };
    }
  }

  private async getVectorStatus(): Promise<TextResourceContents> {
    try {
      const connectionStatus = await this.vectorSearchService.testConnection();
      const collections = await this.vectorSearchService.listCollections();
      
      return {
        uri: 'vector://status',
        mimeType: 'application/json',
        text: JSON.stringify({
          status: connectionStatus.connected ? 'connected' : 'disconnected',
          version: connectionStatus.version,
          error: connectionStatus.error,
          collections: {
            total: collections.length,
            totalDocuments: collections.reduce((sum, col) => sum + col.count, 0)
          },
          timestamp: new Date().toISOString()
        }, null, 2)
      };
    } catch (error) {
      return {
        uri: 'vector://status',
        mimeType: 'application/json',
        text: JSON.stringify({
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to get vector status',
          timestamp: new Date().toISOString()
        }, null, 2)
      };
    }
  }
}