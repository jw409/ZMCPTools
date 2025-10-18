import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpTool } from '../schemas/tools/index.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DatabaseManager } from '../database/index.js';
import { CommunicationService, KnowledgeGraphService } from '../services/index.js';
import type { MessageType } from '../schemas/index.js';

// Import centralized request schemas
import {
  JoinRoomSchema,
  SendMessageSchema,
  WaitForMessagesSchema,
  CloseRoomSchema,
  DeleteRoomSchema,
  ListRoomsSchema,
  ListRoomMessagesSchema,
  CreateDelayedRoomSchema,
  AnalyzeCoordinationPatternsSchema,
  BroadcastMessageToAgentsSchema
} from '../schemas/tools/communication.js';

// Import centralized response schemas
import {
  createSuccessResponse,
  createErrorResponse,
  type AgentOrchestrationResponse
} from '../schemas/toolResponses.js';

// Import individual response schemas and types
import {
  JoinRoomResponseSchema,
  SendMessageResponseSchema,
  WaitForMessagesResponseSchema,
  CloseRoomResponseSchema,
  DeleteRoomResponseSchema,
  ListRoomsResponseSchema,
  ListRoomMessagesResponseSchema,
  CreateDelayedRoomResponseSchema,
  AnalyzeCoordinationPatternsResponseSchema,
  BroadcastMessageToAgentsResponseSchema,
  type JoinRoomResponse,
  type SendMessageResponse,
  type WaitForMessagesResponse,
  type CloseRoomResponse,
  type DeleteRoomResponse,
  type ListRoomsResponse,
  type ListRoomMessagesResponse,
  type CreateDelayedRoomResponse,
  type AnalyzeCoordinationPatternsResponse,
  type BroadcastMessageToAgentsResponse
} from '../schemas/tools/communication.js';

export class CommunicationTools {
  private communicationService: CommunicationService;
  private knowledgeGraphService: KnowledgeGraphService;

  constructor(private db: DatabaseManager, repositoryPath: string) {
    // Calculate filesystem rooms path: {repositoryPath}/talent-os/var/rooms
    const fsRoomsPath = `${repositoryPath}/talent-os/var/rooms`;
    this.communicationService = new CommunicationService(db, fsRoomsPath);
    // Initialize KnowledgeGraphService with VectorSearchService
    this.initializeKnowledgeGraphService(db);
  }

  private async initializeKnowledgeGraphService(db: DatabaseManager): Promise<void> {
    try {
      const { VectorSearchService } = await import('../services/VectorSearchService.js');
      const vectorService = new VectorSearchService(db);
      this.knowledgeGraphService = new KnowledgeGraphService(db, vectorService);
    } catch (error: any) {
      console.warn('Failed to initialize KnowledgeGraphService:', error);
      // Fallback to a minimal implementation that doesn't crash
      this.knowledgeGraphService = {
        createEntity: async () => ({ id: 'fallback', name: 'fallback' }),
        findEntitiesBySemanticSearch: async () => []
      } as any;
    }
  }

  /**
   * Get MCP tools for communication functionality
   * Returns properly structured McpTool objects with handlers
   */
  getTools(): McpTool[] {
    return [
      {
        name: 'report_critical_failure',
        description: 'Reports a critical failure that prevents the agent from continuing its task.',
        inputSchema: z.object({
          reason: z.string(),
        }),
        handler: this.reportCriticalFailure.bind(this),
      },
      {
        name: 'register_and_orient',
        description: 'Registers the agent and receives its task orientation.',
        inputSchema: z.object({
          role: z.string(),
          room_id: z.string(),
        }),
        handler: this.registerAndOrient.bind(this),
      },
      {
        name: 'join_room',
        description: 'Joins a coordination room to enable reading and posting messages. Call this before using send_message or wait_for_messages in a room.',
        inputSchema: zodToJsonSchema(JoinRoomSchema) as any,
        outputSchema: zodToJsonSchema(JoinRoomResponseSchema) as any,
        handler: this.joinRoom.bind(this)
      },
      {
        name: 'send_message',
        description: 'Posts your message to a coordination room so other agents can read it. Use this to share results, report numbers you calculated, ask questions, or communicate progress in multi-agent tasks.',
        inputSchema: zodToJsonSchema(SendMessageSchema) as any,
        outputSchema: zodToJsonSchema(SendMessageResponseSchema) as any,
        handler: this.sendMessage.bind(this)
      },
      {
        name: 'wait_for_messages',
        description: 'Waits for new messages to arrive in a room (polling with timeout). Use wait_for_messages when you need real-time updates, or get_room_messages to read existing messages.',
        inputSchema: zodToJsonSchema(WaitForMessagesSchema) as any,
        outputSchema: zodToJsonSchema(WaitForMessagesResponseSchema) as any,
        handler: this.waitForMessages.bind(this)
      },
      {
        name: 'close_room',
        description: 'Close a communication room (soft delete - marks as closed but keeps data)',
        inputSchema: zodToJsonSchema(CloseRoomSchema) as any,
        outputSchema: zodToJsonSchema(CloseRoomResponseSchema) as any,
        handler: this.closeRoom.bind(this)
      },
      {
        name: 'delete_room',
        description: 'Permanently delete a communication room and all its messages',
        inputSchema: zodToJsonSchema(DeleteRoomSchema) as any,
        outputSchema: zodToJsonSchema(DeleteRoomResponseSchema) as any,
        handler: this.deleteRoom.bind(this)
      },
      {
        name: 'list_rooms',
        description: 'Lists all available coordination rooms in the repository. Use this only when you need to discover what rooms exist, NOT for reading or posting messages to a specific room you already know about.',
        inputSchema: zodToJsonSchema(ListRoomsSchema) as any,
        outputSchema: zodToJsonSchema(ListRoomsResponseSchema) as any,
        handler: this.listRooms.bind(this)
      },
      {
        name: 'list_room_messages',
        description: 'Reads all messages posted in a coordination room by other agents. Use this to see what other agents have said, find numbers or data they shared, or check progress in multi-agent workflows.',
        inputSchema: zodToJsonSchema(ListRoomMessagesSchema) as any,
        outputSchema: zodToJsonSchema(ListRoomMessagesResponseSchema) as any,
        handler: this.listRoomMessages.bind(this)
      },
      {
        name: 'create_delayed_room',
        description: 'Create a delayed room for coordination when agents realize they need it',
        inputSchema: zodToJsonSchema(CreateDelayedRoomSchema) as any,
        outputSchema: zodToJsonSchema(CreateDelayedRoomResponseSchema) as any,
        handler: this.createDelayedRoom.bind(this)
      },
      {
        name: 'analyze_coordination_patterns',
        description: 'Analyze coordination patterns and suggest improvements',
        inputSchema: zodToJsonSchema(AnalyzeCoordinationPatternsSchema) as any,
        outputSchema: zodToJsonSchema(AnalyzeCoordinationPatternsResponseSchema) as any,
        handler: this.analyzeCoordinationPatterns.bind(this)
      },
      {
        name: 'broadcast_message_to_agents',
        description: 'Broadcast a message to multiple agents with auto-resume functionality',
        inputSchema: zodToJsonSchema(BroadcastMessageToAgentsSchema) as any,
        outputSchema: zodToJsonSchema(BroadcastMessageToAgentsResponseSchema) as any,
        handler: this.broadcastMessageToAgents.bind(this)
      }
    ];
  }



  async reportCriticalFailure(args: { reason: string; room_id: string }): Promise<any> {
    const { reason, room_id } = args;
    const room = await this.communicationService.getRoom(room_id);
    if (!room) {
      return createErrorResponse('Room not found', `Room '${room_id}' not found`, 'ROOM_NOT_FOUND');
    }

    await this.communicationService.updateRoomMetadata(room_id, {
        ...room.roomMetadata,
        status: 'failed',
        failure_reason: reason,
    });

    return createSuccessResponse('Critical failure reported.', {
        room_id: room_id,
        status: 'failed',
        reason: reason,
    });
  }

  async getRoomSummary(args: { room_id: string }): Promise<any> {
    const { room_id } = args;
    const room = await this.communicationService.getRoom(room_id);
    if (!room) {
      return createErrorResponse('Room not found', `Room '${room_id}' not found`, 'ROOM_NOT_FOUND');
    }

    const state = await this.communicationService.getRoomState(room_id);
    const agents = await this.communicationService.getRoomParticipants(room_id);
    const messages = await this.communicationService.getRecentMessages(room_id, 10);

    return createSuccessResponse('Room summary retrieved.', {
      room: room,
      state: state,
      agents: agents,
      recent_messages: messages,
    });
  }

  async registerAndOrient(args: { role: string; room_id: string }): Promise<any> {
    const { role, room_id } = args;
    const state = await this.communicationService.getRoomState(room_id);
    const task = state?.agent_tasks?.[role];

    if (!task) {
      return createErrorResponse(
        'Task not found for role',
        `Task not found for role '${role}' in room '${room_id}'`,
        'TASK_NOT_FOUND'
      );
    }

    return createSuccessResponse('Registration and orientation complete.', {
      introduction: `Welcome, ${role}. Your task has been confirmed.`,
      task: task,
    });
  }

  /**
   * Join communication room for coordination
   */
  async joinRoom(args: any): Promise<JoinRoomResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      roomName: args.roomName || args.room_name,
      agentName: args.agentName || args.agent_name
    };
    
    const { roomName, agentName } = JoinRoomSchema.parse(normalizedArgs);
    const startTime = performance.now();
    
    try {
      // Check if room exists
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        return createErrorResponse(
          'Room not found',
          `Room ${roomName} not found`,
          'ROOM_NOT_FOUND'
        ) as JoinRoomResponse;
      }

      // Join the room
      await this.communicationService.joinRoom(roomName, agentName);

      // Get recent messages for context
      const recentMessages = await this.communicationService.getRecentMessages(roomName, 10);
      const participants = await this.communicationService.getRoomParticipants(roomName);

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Successfully joined room ${roomName}`,
        {
          room_id: room.id,
          room_name: roomName,
          agent_name: agentName,
          participant_count: participants.length,
          recent_message_count: recentMessages.length,
          recent_messages: recentMessages.slice(0, 5) // Return last 5 for context
        },
        executionTime
      ) as JoinRoomResponse;

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to join room',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'JOIN_ROOM_ERROR'
      ) as JoinRoomResponse;
    }
  }

  /**
   * Send message to coordination room
   */
  async sendMessage(args: any): Promise<SendMessageResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      roomName: args.roomName || args.room_name,
      agentName: args.agentName || args.agent_name,
      message: args.message,
      mentions: args.mentions
    };
    
    const { roomName, agentName, message, mentions } = SendMessageSchema.parse(normalizedArgs);
    const startTime = performance.now();
    
    try {
      const sentMessage = await this.communicationService.sendMessage({
        roomName,
        agentName,
        message,
        mentions,
        messageType: 'standard' as MessageType
      });

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        'Message sent successfully',
        {
          message_id: sentMessage.id,
          room_name: roomName,
          agent_name: agentName,
          mentions: mentions || []
        },
        executionTime
      ) as SendMessageResponse;

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to send message',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'SEND_MESSAGE_ERROR'
      ) as SendMessageResponse;
    }
  }

  /**
   * Wait for messages in a room
   */
  async waitForMessages(args: any): Promise<WaitForMessagesResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      roomName: args.roomName || args.room_name,
      timeout: args.timeout,
      sinceTimestamp: args.sinceTimestamp || args.since_timestamp
    };
    
    const { roomName, timeout = 30000, sinceTimestamp } = WaitForMessagesSchema.parse(normalizedArgs);
    const since = sinceTimestamp ? new Date(sinceTimestamp) : undefined;
    const startTime = performance.now();
    
    try {
      const messages = await this.communicationService.waitForMessages(
        roomName,
        since,
        timeout
      );

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Retrieved ${messages.length} messages`,
        {
          messages,
          count: messages.length,
          room_name: roomName
        },
        executionTime
      ) as WaitForMessagesResponse;

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to wait for messages',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'WAIT_FOR_MESSAGES_ERROR'
      ) as WaitForMessagesResponse;
    }
  }

  /**
   * Close a communication room (soft delete - marks as closed but keeps data)
   */
  async closeRoom(args: any): Promise<CloseRoomResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      roomName: args.roomName || args.room_name,
      terminateAgents: args.terminateAgents || args.terminate_agents
    };
    
    const { roomName, terminateAgents = true } = CloseRoomSchema.parse(normalizedArgs);
    const startTime = performance.now();
    
    try {
      // Get room info to find associated agents
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        const executionTime = performance.now() - startTime;
        return createErrorResponse(
          `Room '${roomName}' not found`,
          `Room '${roomName}' not found`,
          'ROOM_NOT_FOUND'
        ) as CloseRoomResponse;
      }

      let terminatedAgents: string[] = [];

      // NOTE: Agent termination removed - managed by claude-agent-sdk now
      // The terminateAgents parameter is kept for API compatibility but ignored
      if (terminateAgents) {
        // TODO: Integrate with claude-agent-sdk for agent lifecycle management
      }

      // Mark room as closed by updating metadata
      await this.communicationService.updateRoomMetadata(roomName, {
        ...room.roomMetadata,
        status: 'closed',
        closedAt: new Date().toISOString(),
        terminatedAgents
      });
      
      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Room '${roomName}' closed successfully${terminateAgents ? ` and ${terminatedAgents.length} agents terminated` : ''}`,
        {
          room_name: roomName,
          terminated_agents: terminatedAgents,
          agent_count: terminatedAgents.length
        },
        executionTime
      ) as CloseRoomResponse;

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to close room',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'CLOSE_ROOM_ERROR'
      ) as CloseRoomResponse;
    }
  }

  /**
   * Permanently delete a communication room and all its messages
   */
  async deleteRoom(args: any): Promise<DeleteRoomResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      roomName: args.roomName || args.room_name,
      forceDelete: args.forceDelete || args.force_delete
    };
    
    const { roomName, forceDelete = false } = DeleteRoomSchema.parse(normalizedArgs);
    const startTime = performance.now();
    
    try {
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        const executionTime = performance.now() - startTime;
        return createErrorResponse(
          `Room '${roomName}' not found`,
          `Room '${roomName}' not found`,
          'ROOM_NOT_FOUND'
        ) as DeleteRoomResponse;
      }

      // Check if room is closed or force delete
      const isClosed = room.roomMetadata?.status === 'closed';
      if (!isClosed && !forceDelete) {
        const executionTime = performance.now() - startTime;
        return createErrorResponse(
          `Room '${roomName}' must be closed before deletion. Use force_delete=true to override.`,
          `Room '${roomName}' must be closed before deletion`,
          'ROOM_NOT_CLOSED'
        ) as DeleteRoomResponse;
      }

      // NOTE: Agent termination removed - managed by claude-agent-sdk now
      const roomAgents: any[] = [];
      // TODO: Integrate with claude-agent-sdk for agent lifecycle management

      // Delete the room
      await this.communicationService.deleteRoom(roomName);
      
      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Room '${roomName}' permanently deleted`,
        {
          room_name: roomName,
          messages_deleted: true,
          agents_terminated: roomAgents.length
        },
        executionTime
      ) as DeleteRoomResponse;

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to delete room',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'DELETE_ROOM_ERROR'
      ) as DeleteRoomResponse;
    }
  }

  /**
   * List communication rooms with filtering and pagination
   */
  async listRooms(args: any): Promise<ListRoomsResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      repositoryPath: args.repositoryPath || args.repository_path,
      status: args.status,
      limit: args.limit,
      offset: args.offset
    };
    
    const { repositoryPath, status, limit = 20, offset = 0 } = ListRoomsSchema.parse(normalizedArgs);
    const startTime = performance.now();
    
    try {
      const allRooms = await this.communicationService.listRooms(repositoryPath);
      
      // Filter by status
      let filteredRooms = allRooms;
      if (status && status !== 'all') {
        filteredRooms = allRooms.filter(room => {
          const roomStatus = room.roomMetadata?.status || 'active';
          return roomStatus === status;
        });
      }

      // Apply pagination
      const total = filteredRooms.length;
      const paginatedRooms = filteredRooms.slice(offset, offset + limit);

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Found ${total} rooms${status ? ` with status '${status}'` : ''}`,
        {
          rooms: paginatedRooms.map(room => ({
            id: room.id,
            name: room.name,
            description: room.description,
            repository_path: room.repositoryPath,
            is_general: room.isGeneral,
            status: room.roomMetadata?.status || 'active',
            created_at: room.createdAt,
            closed_at: room.roomMetadata?.closedAt,
            metadata: room.roomMetadata
          })),
          pagination: {
            total,
            limit,
            offset,
            has_more: offset + limit < total
          }
        },
        executionTime
      ) as ListRoomsResponse;

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to list rooms',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'LIST_ROOMS_ERROR'
      ) as ListRoomsResponse;
    }
  }

  /**
   * List messages from a specific room with pagination
   */
  async listRoomMessages(args: any): Promise<ListRoomMessagesResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      roomName: args.roomName || args.room_name,
      limit: args.limit,
      offset: args.offset,
      sinceTimestamp: args.sinceTimestamp || args.since_timestamp
    };
    
    const { roomName, limit = 50, offset = 0, sinceTimestamp } = ListRoomMessagesSchema.parse(normalizedArgs);
    const startTime = performance.now();
    
    try {
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        const executionTime = performance.now() - startTime;
        return createErrorResponse(
          `Room '${roomName}' not found`,
          `Room '${roomName}' not found`,
          'ROOM_NOT_FOUND'
        ) as ListRoomMessagesResponse;
      }

      const since = sinceTimestamp ? new Date(sinceTimestamp) : undefined;
      const messages = await this.communicationService.getMessages(roomName, limit + offset, since);
      
      // Apply offset manually since the service doesn't support it
      const paginatedMessages = messages.slice(offset, offset + limit);

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Retrieved ${paginatedMessages.length} messages from room '${roomName}'`,
        {
          room_id: room.id,
          room_name: roomName,
          messages: paginatedMessages.map(msg => ({
            id: msg.id,
            agent_name: msg.agentName,
            message: msg.message,
            mentions: msg.mentions,
            message_type: msg.messageType,
            timestamp: msg.timestamp
          })),
          pagination: {
            total: messages.length,
            limit,
            offset,
            has_more: offset + limit < messages.length
          }
        },
        executionTime
      ) as ListRoomMessagesResponse;

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to list messages',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'LIST_ROOM_MESSAGES_ERROR'
      ) as ListRoomMessagesResponse;
    }
  }


  /**
   * Create a delayed room for coordination when agents realize they need it
   */
  async createDelayedRoom(args: any): Promise<CreateDelayedRoomResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      agentId: args.agentId || args.agent_id,
      repositoryPath: args.repositoryPath || args.repository_path,
      reason: args.reason,
      participants: args.participants
    };
    
    const { agentId, repositoryPath, reason, participants = [] } = CreateDelayedRoomSchema.parse(normalizedArgs);
    const startTime = performance.now();
    
    try {
      // Generate room name based on reason ONLY (no timestamp for shared rooms!)
      const normalizedReason = reason
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 50);
      const roomName = `coordination-${normalizedReason}`;
      
      // Create the room
      const room = await this.communicationService.createRoom({
        name: roomName,
        description: `Coordination room created by ${agentId} for: ${reason}`,
        repositoryPath,
        metadata: { type: 'coordination', participants: [...participants, agentId] }
      });
      
      // Join the requesting agent to the room
      await this.communicationService.joinRoom(room.name, agentId);
      
      // Join other participants if they exist
      for (const participantId of participants) {
        try {
          await this.communicationService.joinRoom(room.name, participantId);
        } catch (error: any) {
          // Log warning but don't fail the entire operation
          console.warn(`Failed to add participant ${participantId} to room ${room.name}: ${error}`);
        }
      }
      
      // Send initial coordination message
      await this.communicationService.sendMessage({
        roomName: room.name,
        agentName: agentId,
        message: `Coordination room created. Reason: ${reason}`,
        messageType: 'coordination'
      });
      
      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Delayed coordination room created successfully`,
        {
          room_name: room.name,
          reason,
          participants: [...participants, agentId],
          created_at: new Date().toISOString()
        },
        executionTime
      ) as CreateDelayedRoomResponse;
      
    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to create delayed room',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'CREATE_DELAYED_ROOM_ERROR'
      ) as CreateDelayedRoomResponse;
    }
  }

  /**
   * Analyze coordination patterns and suggest improvements
   */
  async analyzeCoordinationPatterns(args: any): Promise<AnalyzeCoordinationPatternsResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      repositoryPath: args.repositoryPath || args.repository_path
    };
    
    const { repositoryPath } = AnalyzeCoordinationPatternsSchema.parse(normalizedArgs);
    const startTime = performance.now();
    
    try {
      // Simple analysis of room usage patterns
      const rooms = await this.communicationService.listRooms(repositoryPath);
      const totalRooms = rooms.length;
      const activeRooms = rooms.filter(room => room.roomMetadata?.status !== 'closed').length;
      
      // Basic recommendations based on room usage
      const recommendations = [
        'Consider using memory-based coordination for simple tasks',
        'Use task status updates for sequential workflows',
        'Reserve rooms for multi-agent collaboration',
        'Clean up unused rooms regularly'
      ];

      const executionTime = performance.now() - startTime;
      
      return createSuccessResponse(
        `Coordination analysis complete for ${repositoryPath}`,
        {
          total_rooms: totalRooms,
          active_rooms: activeRooms,
          recommendations
        },
        executionTime
      ) as AnalyzeCoordinationPatternsResponse;

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to analyze coordination patterns',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'ANALYZE_COORDINATION_ERROR'
      ) as AnalyzeCoordinationPatternsResponse;
    }
  }

  /**
   * Broadcast a message to multiple agents with auto-resume functionality
   */
  async broadcastMessageToAgents(args: any): Promise<BroadcastMessageToAgentsResponse> {
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      repositoryPath: args.repositoryPath || args.repository_path,
      agentIds: args.agentIds || args.agent_ids,
      message: args.message,
      autoResume: args.autoResume || args.auto_resume,
      priority: args.priority,
      messageType: args.messageType || args.message_type
    };
    
    const validatedArgs = BroadcastMessageToAgentsSchema.parse(normalizedArgs);
    const startTime = performance.now();
    
    try {
      // NOTE: Agent broadcasting removed - managed by claude-agent-sdk now
      // This is a placeholder implementation that returns a stub response
      // TODO: Integrate with claude-agent-sdk for agent messaging

      const executionTime = performance.now() - startTime;

      return createSuccessResponse(
        `Broadcast functionality pending claude-agent-sdk integration`,
        {
          total_agents: validatedArgs.agentIds.length,
          delivered_count: 0,
          resumed_count: 0,
          failed_count: 0,
          delivery_results: [],
          message_content: validatedArgs.message,
          priority: validatedArgs.priority || 'normal',
          message_type: validatedArgs.messageType || 'coordination',
          note: 'Agent broadcasting will be available after claude-agent-sdk integration'
        },
        executionTime
      ) as BroadcastMessageToAgentsResponse;

    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        'Failed to broadcast message to agents',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'BROADCAST_MESSAGE_ERROR'
      ) as BroadcastMessageToAgentsResponse;
    }
  }
}