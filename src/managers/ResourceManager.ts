import type { Resource, TextResourceContents } from '@modelcontextprotocol/sdk/types.js';
import { DatabaseManager } from '../database/index.js';
import { AgentService } from '../services/AgentService.js';
import { CommunicationService } from '../services/CommunicationService.js';
import { WebScrapingService } from '../services/WebScrapingService.js';
import { DocumentationService } from '../services/DocumentationService.js';
import { MemoryService } from '../services/MemoryService.js';

export interface ResourceInfo {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export class ResourceManager {
  private agentService: AgentService;
  private communicationService: CommunicationService;
  private webScrapingService: WebScrapingService;
  private documentationService: DocumentationService;
  private memoryService: MemoryService;

  constructor(
    private db: DatabaseManager,
    private repositoryPath: string
  ) {
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
  }

  /**
   * Get all available resources
   */
  async listResources(): Promise<Resource[]> {
    const resources: Resource[] = [
      {
        uri: 'mcp://agents/list',
        name: 'Agent List',
        description: 'List of all active agents with their status and metadata',
        mimeType: 'application/json'
      },
      {
        uri: 'mcp://communication/rooms',
        name: 'Communication Rooms',
        description: 'List of all active communication rooms',
        mimeType: 'application/json'
      },
      {
        uri: 'mcp://communication/messages',
        name: 'Room Messages',
        description: 'Recent messages from communication rooms',
        mimeType: 'application/json'
      },
      {
        uri: 'mcp://scraping/jobs',
        name: 'Scraper Jobs',
        description: 'List of web scraping jobs and their status',
        mimeType: 'application/json'
      },
      {
        uri: 'mcp://documentation/sources',
        name: 'Documentation Sources',
        description: 'List of scraped documentation sources',
        mimeType: 'application/json'
      },
      {
        uri: 'mcp://agents/insights',
        name: 'Agent Insights',
        description: 'Aggregated insights and learnings from agents',
        mimeType: 'application/json'
      }
    ];

    return resources;
  }

  /**
   * Read a specific resource by URI
   */
  async readResource(uri: string): Promise<TextResourceContents> {
    const url = new URL(uri);
    const path = url.pathname;

    switch (path) {
      case '/agents/list':
        return await this.getAgentsList();
      
      case '/communication/rooms':
        return await this.getCommunicationRooms();
      
      case '/communication/messages':
        return await this.getRoomMessages(url.searchParams);
      
      case '/scraping/jobs':
        return await this.getScrapingJobs();
      
      case '/documentation/sources':
        return await this.getDocumentationSources();
      
      case '/agents/insights':
        return await this.getAgentInsights();
      
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  }

  private async getAgentsList(): Promise<TextResourceContents> {
    const agents = await this.agentService.listAgents(this.repositoryPath);
    
    return {
      uri: 'mcp://agents/list',
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
      uri: 'mcp://communication/rooms',
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
      uri: `mcp://communication/messages?room=${roomName}&limit=${limit}`,
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
      uri: 'mcp://scraping/jobs',
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
      uri: 'mcp://documentation/sources',
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
      uri: 'mcp://agents/insights',
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
}