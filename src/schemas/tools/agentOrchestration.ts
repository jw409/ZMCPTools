import { z } from 'zod';
import { type TaskType, type AgentStatus, type EntityType, taskTypeSchema, entityTypeSchema, agentStatusSchema } from '../index.js';

// ===============================================
// Agent Orchestration Tool Request Schemas
// ===============================================

export const OrchestrationObjectiveSchema = z.object({
  title: z.string().describe('Title for the orchestration objective - should be descriptive and concise'),
  objective: z.string().describe('Detailed description of the objective to be orchestrated by the architect agent. This should be a clear, comprehensive statement of what needs to be accomplished across multiple specialized agents.'),
  repositoryPath: z.string().describe('Absolute path to the repository where the orchestration will take place. This is the working directory for all spawned agents.'),
  foundationSessionId: z.string().optional().describe('Optional session ID for cost optimization. When provided, all spawned agents will share this session context, reducing token costs by 85-90% through shared conversation history.')
});

export const SpawnAgentSchema = z.object({
  agentType: z.string().describe('Type of specialized agent to spawn (e.g., "backend", "frontend", "testing", "documentation", "devops", "researcher"). This determines the agent\'s role-specific instructions and capabilities.'),
  repositoryPath: z.string().describe('Absolute path to the repository where the agent will operate. This is the working directory for all agent operations.'),
  taskDescription: z.string().describe('Detailed description of the specific task or responsibility this agent should handle. Should be clear, actionable, and include any important context or requirements.'),
  capabilities: z.array(z.string()).optional().default(['ALL_TOOLS']).describe('Array of capabilities or tools the agent should have access to. Defaults to "ALL_TOOLS" which grants full access to all available tools including file operations, code analysis, web browsing, and coordination tools.'),
  dependsOn: z.array(z.string()).optional().default([]).describe('Array of agent IDs that this agent depends on. The agent will only be spawned after all dependencies are satisfied (agents exist and are active/completed).'),
  metadata: z.record(z.string(), z.any()).optional().default({}).describe('Optional metadata object for storing additional agent configuration, context, or coordination information.')
});

export const CreateTaskSchema = z.object({
  repositoryPath: z.string().describe('Absolute path to the repository where the task will be created. This determines the context and scope of the task.'),
  taskType: taskTypeSchema.describe('Type of task being created (e.g., "feature", "bug", "enhancement", "documentation", "testing"). This helps categorize and prioritize the task.'),
  title: z.string().describe('Short, descriptive title for the task that summarizes what needs to be done.'),
  description: z.string().describe('Detailed description of the task including requirements, context, and expected outcomes. Should be comprehensive enough for an agent to understand and execute.'),
  requirements: z.record(z.string(), z.any()).optional().describe('Optional object containing specific requirements, configuration, or parameters for the task. Can include priority, estimated duration, assigned agent ID, and other task-specific data.'),
  dependencies: z.array(z.string()).optional().describe('Optional array of task IDs that this task depends on. The task will only be eligible for assignment after all dependencies are completed.')
});

export const JoinRoomSchema = z.object({
  roomName: z.string().describe('Name of the communication room to join. This should be an existing room created for coordination between agents.'),
  agentName: z.string().describe('Name or identifier of the agent joining the room. This will be used to identify the agent in room communications.')
});

export const SendMessageSchema = z.object({
  roomName: z.string().describe('Name of the communication room where the message will be sent. The room must exist and the agent should be a member.'),
  agentName: z.string().describe('Name or identifier of the agent sending the message. This will be displayed as the message sender.'),
  message: z.string().describe('The message content to send to the room. Can include coordination instructions, status updates, questions, or other communication.'),
  mentions: z.array(z.string()).optional().describe('Optional array of agent names to mention in the message. Mentioned agents may receive special notifications or attention.')
});

export const WaitForMessagesSchema = z.object({
  roomName: z.string().describe('Name of the communication room to monitor for new messages. The agent should be a member of this room.'),
  timeout: z.number().default(30000).describe('Maximum time to wait for messages in milliseconds. Defaults to 30 seconds (30000ms). After this time, the function will return with whatever messages were received.'),
  sinceTimestamp: z.string().optional().describe('Optional ISO timestamp string to only retrieve messages sent after this time. If not provided, will wait for any new messages from the current time.')
});

export const StoreMemorySchema = z.object({
  repositoryPath: z.string().describe('Absolute path to the repository where the memory will be stored. This determines the scope and context of the shared memory.'),
  agentId: z.string().describe('ID of the agent creating the memory entry. This tracks which agent contributed the knowledge or insight.'),
  entryType: entityTypeSchema.describe('Type of memory entry being stored (e.g., "insight", "pattern", "decision", "lesson"). This helps categorize and retrieve relevant memories.'),
  title: z.string().describe('Short, descriptive title for the memory entry that summarizes the key insight or knowledge.'),
  content: z.string().describe('Detailed content of the memory entry. Should include the insight, learning, decision, or pattern that other agents can benefit from.'),
  tags: z.array(z.string()).optional().describe('Optional array of tags to categorize and improve searchability of the memory entry. Tags help agents find relevant knowledge quickly.')
});

export const SearchMemorySchema = z.object({
  repositoryPath: z.string().describe('Absolute path to the repository where memories will be searched. This determines the scope of the search.'),
  queryText: z.string().describe('Search query text to find relevant memories. Uses semantic search to find memories with similar content or meaning.'),
  agentId: z.string().optional().describe('Optional agent ID to filter memories created by a specific agent. If not provided, will search all agents\' memories in the repository.'),
  limit: z.number().default(10).describe('Maximum number of memory entries to return. Defaults to 10. Results are ordered by relevance score.')
});

export const ListAgentsSchema = z.object({
  repositoryPath: z.string().describe('Absolute path to the repository where agents will be listed. This determines the scope of the agent search.'),
  status: agentStatusSchema.optional().describe('Optional status filter to only show agents with specific status (e.g., "active", "completed", "failed", "idle"). If not provided, will return agents of all statuses.'),
  limit: z.number().default(5).describe('Maximum number of agents to return. Defaults to 5. Use for pagination.'),
  offset: z.number().default(0).describe('Number of agents to skip before returning results. Defaults to 0. Use for pagination.')
});

export const TerminateAgentSchema = z.object({
  agentIds: z.array(z.string()).describe('Array of agent IDs to terminate. Each ID should correspond to an active agent. The termination process will gracefully shut down each agent and clean up their resources.')
});

export const CloseRoomSchema = z.object({
  roomName: z.string().describe('Name of the communication room to close. This performs a soft close, marking the room as closed but preserving all messages and data.'),
  terminateAgents: z.boolean().default(true).describe('Whether to terminate all agents associated with this room when closing it. Defaults to true. If false, agents will remain active but lose their room association.')
});

export const DeleteRoomSchema = z.object({
  roomName: z.string().describe('Name of the communication room to permanently delete. This will remove all messages and data associated with the room.'),
  forceDelete: z.boolean().default(false).describe('Whether to force delete the room even if it\'s not closed. Defaults to false. If false, the room must be closed before deletion. If true, will delete the room regardless of status.')
});

export const ListRoomsSchema = z.object({
  repositoryPath: z.string().describe('Absolute path to the repository where rooms will be listed. This determines the scope of the room search.'),
  status: z.enum(['active', 'closed', 'all']).optional().describe('Optional status filter to show rooms with specific status. "active" shows only open rooms, "closed" shows only closed rooms, "all" shows all rooms. If not provided, defaults to showing all rooms.'),
  limit: z.number().default(20).describe('Maximum number of rooms to return. Defaults to 20. Use for pagination.'),
  offset: z.number().default(0).describe('Number of rooms to skip before returning results. Defaults to 0. Use for pagination.')
});

export const ListRoomMessagesSchema = z.object({
  roomName: z.string().describe('Name of the communication room to retrieve messages from. The room must exist and be accessible.'),
  limit: z.number().default(50).describe('Maximum number of messages to return. Defaults to 50. Use for pagination and to control response size.'),
  offset: z.number().default(0).describe('Number of messages to skip before returning results. Defaults to 0. Use for pagination through message history.'),
  sinceTimestamp: z.string().optional().describe('Optional ISO timestamp string to only retrieve messages sent after this time. Useful for getting recent messages or continuing from a specific point in time.')
});

export const MonitorAgentsSchema = z.object({
  agentId: z.string().optional().describe('Optional specific agent ID to monitor. If provided, will focus monitoring on this single agent. If not provided, will monitor all agents in the scope.'),
  orchestrationId: z.string().optional().describe('Optional orchestration ID to monitor. If provided, will monitor all agents and tasks within this orchestration context.'),
  roomName: z.string().optional().describe('Optional room name to monitor. If provided, will monitor communication and activity within this specific room.'),
  repositoryPath: z.string().optional().describe('Optional repository path to monitor. If provided, will monitor all agents and activities within this repository context. If not provided, uses current working directory.'),
  monitoringMode: z.enum(['status', 'activity', 'communication', 'full']).default('status').describe('Type of monitoring to perform. "status" monitors agent status changes, "activity" monitors task and work activity, "communication" monitors room messages and coordination, "full" monitors all aspects.'),
  updateInterval: z.number().default(2000).describe('Interval in milliseconds between monitoring updates. Defaults to 2000ms (2 seconds). Lower values provide more frequent updates but use more resources.'),
  maxDuration: z.number().default(50000).describe('Maximum duration in milliseconds to monitor. Defaults to 50000ms (50 seconds). After this time, monitoring will automatically stop.'),
  detailLevel: z.enum(['summary', 'detailed', 'verbose']).default('summary').describe('Level of detail in monitoring output. "summary" provides basic updates, "detailed" includes more context and metadata, "verbose" provides comprehensive information about all events.')
});

export type OrchestrationObjectiveInput = z.infer<typeof OrchestrationObjectiveSchema>;
export type SpawnAgentInput = z.infer<typeof SpawnAgentSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type JoinRoomInput = z.infer<typeof JoinRoomSchema>;
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type WaitForMessagesInput = z.infer<typeof WaitForMessagesSchema>;
export type StoreMemoryInput = z.infer<typeof StoreMemorySchema>;
export type SearchMemoryInput = z.infer<typeof SearchMemorySchema>;
export type ListAgentsInput = z.infer<typeof ListAgentsSchema>;
export type TerminateAgentInput = z.infer<typeof TerminateAgentSchema>;
export type CloseRoomInput = z.infer<typeof CloseRoomSchema>;
export type DeleteRoomInput = z.infer<typeof DeleteRoomSchema>;
export type ListRoomsInput = z.infer<typeof ListRoomsSchema>;
export type ListRoomMessagesInput = z.infer<typeof ListRoomMessagesSchema>;
export type MonitorAgentsInput = z.infer<typeof MonitorAgentsSchema>;

// ===============================================
// Agent Orchestration Tool Response Schemas
// ===============================================

// Orchestrate Objective Response
export const OrchestrationObjectiveResponseSchema = z.object({
  success: z.boolean().describe('Whether the orchestration was successfully initiated. True if architect agent was spawned and coordination room was created.'),
  message: z.string().describe('Human-readable message describing the orchestration result, including success confirmation or error details.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the orchestration was initiated.'),
  execution_time_ms: z.number().optional().describe('Time taken to complete the orchestration setup in milliseconds, including agent spawning and room creation.'),
  data: z.object({
    architect_agent_id: z.string().describe('Unique identifier of the spawned architect agent responsible for coordinating the multi-agent objective.'),
    room_name: z.string().describe('Name of the created coordination room where all agents will communicate and coordinate their work.'),
    objective: z.string().describe('The original objective description that was passed to the architect agent for orchestration.'),
    master_task_id: z.string().describe('ID of the master task created for this orchestration, which serves as the root task for all sub-tasks.')
  }).optional().describe('Orchestration details returned when successful, containing architect agent info, coordination room, and master task details.')
});

// Spawn Agent Response
export const SpawnAgentResponseSchema = z.object({
  success: z.boolean().describe('Whether the agent was successfully spawned and is ready to begin work. True if agent process started and is responding.'),
  message: z.string().describe('Human-readable message describing the spawn result, including agent type and success confirmation or error details.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the agent spawn operation was completed.'),
  execution_time_ms: z.number().optional().describe('Time taken to spawn the agent in milliseconds, including process creation and initialization.'),
  data: z.object({
    agent_id: z.string().describe('Unique identifier of the newly spawned agent, used for all subsequent operations and coordination.'),
    agent_type: z.string().describe('Type of specialized agent that was spawned (e.g., "backend", "frontend", "testing", "documentation").'),
    pid: z.string().optional().describe('Process ID of the spawned Claude agent process, if available. Used for process management and monitoring.'),
    capabilities: z.array(z.string()).describe('List of capabilities and tools the agent has access to, such as ["ALL_TOOLS", "file_operations", "web_browsing"].')
  }).optional().describe('Agent spawn details returned when successful, containing agent identifier, type, process info, and capabilities.')
});

// Create Task Response
export const CreateTaskResponseSchema = z.object({
  success: z.boolean().describe('Whether the task was successfully created in the system. True if task was stored and is ready for assignment.'),
  message: z.string().describe('Human-readable message describing the task creation result, including task ID and confirmation or error details.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the task was created.'),
  execution_time_ms: z.number().optional().describe('Time taken to create the task in milliseconds, including database operations and dependency setup.'),
  data: z.object({
    task_id: z.string().describe('Unique identifier of the created task, used for assignment, tracking, and updates.'),
    task_type: z.string().describe('Type of task that was created (e.g., "feature", "bug", "enhancement", "documentation", "testing").'),
    status: z.string().describe('Current status of the task (typically "pending" for newly created tasks).'),
    priority: z.number().describe('Priority level of the task (1-10 scale, where 10 is highest priority).'),
    estimated_duration: z.number().optional().describe('Estimated time to complete the task in minutes, if provided during creation.'),
    dependencies: z.array(z.string()).describe('List of task IDs that this task depends on. Task will only be eligible for assignment after dependencies are completed.')
  }).optional().describe('Task creation details returned when successful, containing task metadata, priority, and dependency information.')
});

// Join Room Response
export const JoinRoomResponseSchema = z.object({
  success: z.boolean().describe('Whether the agent successfully joined the communication room. True if agent is now a participant and can send/receive messages.'),
  message: z.string().describe('Human-readable message describing the join result, including room name and confirmation or error details.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the agent joined the room.'),
  execution_time_ms: z.number().optional().describe('Time taken to join the room in milliseconds, including participant registration and message history retrieval.'),
  data: z.object({
    room_id: z.string().describe('Unique identifier of the joined room, used for internal operations and message routing.'),
    room_name: z.string().describe('Human-readable name of the room that was joined.'),
    agent_name: z.string().describe('Name of the agent that joined the room, as it will appear in messages and participant lists.'),
    participant_count: z.number().describe('Total number of participants currently in the room, including the newly joined agent.'),
    recent_message_count: z.number().describe('Number of recent messages retrieved for context, typically the last 10 messages.'),
    recent_messages: z.array(z.any()).describe('Array of recent message objects providing context about ongoing conversations, limited to last 5 messages for response size.')
  }).optional().describe('Room join details returned when successful, containing room info, participant count, and recent message context.')
});

// Send Message Response
export const SendMessageResponseSchema = z.object({
  success: z.boolean().describe('Whether the message was successfully sent to the room. True if message was delivered to all participants.'),
  message: z.string().describe('Human-readable confirmation of message delivery or error details if sending failed.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the message was sent and delivered.'),
  execution_time_ms: z.number().optional().describe('Time taken to send the message in milliseconds, including delivery to all participants.'),
  data: z.object({
    message_id: z.string().describe('Unique identifier of the sent message, used for tracking and potential message operations.'),
    room_name: z.string().describe('Name of the room where the message was sent.'),
    agent_name: z.string().describe('Name of the agent that sent the message, as it appears to other participants.'),
    mentions: z.array(z.string()).describe('List of agent names that were mentioned in the message, who may receive special notifications.')
  }).optional().describe('Message sending details returned when successful, containing message ID, room info, and mention information.')
});

// Wait For Messages Response
export const WaitForMessagesResponseSchema = z.object({
  success: z.boolean().describe('Whether the wait operation completed successfully. True if messages were retrieved or timeout was reached gracefully.'),
  message: z.string().describe('Human-readable description of the wait result, including number of messages received or timeout information.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the wait operation completed.'),
  execution_time_ms: z.number().optional().describe('Actual time spent waiting for messages in milliseconds, may be less than requested timeout if messages arrived.'),
  data: z.object({
    messages: z.array(z.any()).describe('Array of message objects received during the wait period, each containing agent name, message content, timestamp, and metadata.'),
    count: z.number().describe('Total number of messages received during the wait period.'),
    room_name: z.string().describe('Name of the room that was monitored for messages.')
  }).optional().describe('Message wait results returned when successful, containing all messages received during the wait period with metadata.')
});

// Store Memory Response
export const StoreMemoryResponseSchema = z.object({
  success: z.boolean().describe('Whether the memory entry was successfully stored in the shared knowledge graph. True if insight is now available to other agents.'),
  message: z.string().describe('Human-readable confirmation of memory storage or error details if storage failed.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the memory entry was created and stored.'),
  execution_time_ms: z.number().optional().describe('Time taken to store the memory entry in milliseconds, including knowledge graph operations and indexing.'),
  data: z.object({
    memory_id: z.string().describe('Unique identifier of the stored memory entry, used for retrieval and cross-referencing.'),
    entry_type: z.string().describe('Type of memory entry that was stored (e.g., "insight", "pattern", "decision", "lesson").'),
    title: z.string().describe('Title of the memory entry as it was stored, used for search and identification.'),
    agent_id: z.string().describe('ID of the agent that created and stored this memory entry, tracking knowledge contribution.')
  }).optional().describe('Memory storage details returned when successful, containing memory ID, type, and contributor information.')
});

// Search Memory Response
export const SearchMemoryResponseSchema = z.object({
  success: z.boolean().describe('Whether the memory search completed successfully. True if search was executed and results were retrieved.'),
  message: z.string().describe('Human-readable description of search results, including number of insights found or search errors.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the search was completed.'),
  execution_time_ms: z.number().optional().describe('Time taken to complete the semantic search in milliseconds, including vector similarity calculations.'),
  data: z.object({
    insights: z.array(z.any()).describe('Array of matching memory entries/insights, each containing title, content, type, agent ID, and relevance score. Ordered by relevance.'),
    count: z.number().describe('Total number of memory entries found matching the search criteria.'),
    query: z.string().describe('The original search query text that was used for semantic matching.')
  }).optional().describe('Memory search results returned when successful, containing relevant insights with metadata and relevance scoring.')
});

// List Agents Response
export const ListAgentsResponseSchema = z.object({
  success: z.boolean().describe('Whether the agent listing operation completed successfully. True if agent information was retrieved from the system.'),
  message: z.string().describe('Human-readable description of the listing result, including number of agents found or any filtering applied.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the agent listing was completed.'),
  execution_time_ms: z.number().optional().describe('Time taken to retrieve and format the agent list in milliseconds.'),
  data: z.object({
    agents: z.array(z.object({
      id: z.string().describe('Unique identifier of the agent.'),
      name: z.string().describe('Human-readable name or type of the agent.'),
      status: z.string().describe('Current operational status of the agent (e.g., "active", "idle", "completed", "failed").'),
      capabilities: z.array(z.string()).describe('List of capabilities and tools the agent has access to.'),
      last_heartbeat: z.string().optional().describe('ISO timestamp of the agent\'s last heartbeat/health check, if available.'),
      metadata: z.any().optional().describe('Additional agent metadata including room assignments, task info, and configuration.')
    })).describe('Array of agent objects with their current status, capabilities, and metadata.'),
    count: z.number().describe('Total number of agents returned in the list.')
  }).optional().describe('Agent listing details returned when successful, containing agent status information, capabilities, and metadata.')
});

// Terminate Agent Response
export const TerminateAgentResponseSchema = z.object({
  success: z.boolean().describe('Whether all requested agent terminations completed successfully. True only if all agents were terminated without errors.'),
  message: z.string().describe('Human-readable summary of termination results, including success/failure counts and overall outcome.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the termination operation completed.'),
  execution_time_ms: z.number().optional().describe('Time taken to terminate all requested agents in milliseconds.'),
  data: z.object({
    results: z.array(z.object({
      agent_id: z.string().describe('ID of the agent that was targeted for termination.'),
      success: z.boolean().describe('Whether this specific agent was successfully terminated.'),
      error: z.string().optional().describe('Error message if termination failed for this agent.')
    })).describe('Array of termination results for each individual agent, showing success/failure status.'),
    success_count: z.number().describe('Number of agents that were successfully terminated.'),
    failure_count: z.number().describe('Number of agents that failed to terminate properly.'),
    total_count: z.number().describe('Total number of agents that were targeted for termination.')
  }).optional().describe('Agent termination details returned when operation completes, containing individual results and summary counts.')
});

// Close Room Response
export const CloseRoomResponseSchema = z.object({
  success: z.boolean().describe('Whether the room was successfully closed. True if room is marked as closed and associated agents were handled.'),
  message: z.string().describe('Human-readable description of the close operation result, including room name and agent termination summary.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the room was closed.'),
  execution_time_ms: z.number().optional().describe('Time taken to close the room in milliseconds, including agent termination if requested.'),
  data: z.object({
    room_name: z.string().describe('Name of the room that was closed.'),
    terminated_agents: z.array(z.string()).describe('List of agent IDs that were terminated as part of the room closure process.'),
    agent_count: z.number().describe('Number of agents that were terminated when closing the room.')
  }).optional().describe('Room closure details returned when successful, containing room name and information about terminated agents.')
});

// Delete Room Response
export const DeleteRoomResponseSchema = z.object({
  success: z.boolean().describe('Whether the room was successfully deleted permanently. True if room and all associated data were removed.'),
  message: z.string().describe('Human-readable description of the deletion result, including room name and data removal confirmation.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the room was permanently deleted.'),
  execution_time_ms: z.number().optional().describe('Time taken to delete the room in milliseconds, including message deletion and agent cleanup.'),
  data: z.object({
    room_name: z.string().describe('Name of the room that was permanently deleted.'),
    messages_deleted: z.boolean().describe('Whether all messages in the room were successfully deleted from the database.'),
    agents_terminated: z.number().describe('Number of agents that were terminated as part of the room deletion process.')
  }).optional().describe('Room deletion details returned when successful, containing room name and confirmation of data removal.')
});

// List Rooms Response
export const ListRoomsResponseSchema = z.object({
  success: z.boolean().describe('Whether the room listing operation completed successfully. True if room information was retrieved and formatted.'),
  message: z.string().describe('Human-readable description of the listing result, including number of rooms found and any filtering applied.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the room listing was completed.'),
  execution_time_ms: z.number().optional().describe('Time taken to retrieve and format the room list in milliseconds.'),
  data: z.object({
    rooms: z.array(z.object({
      id: z.string().describe('Unique identifier of the room.'),
      name: z.string().describe('Human-readable name of the room.'),
      description: z.string().optional().describe('Optional description of the room\'s purpose or context.'),
      repository_path: z.string().describe('File system path of the repository this room is associated with.'),
      is_general: z.boolean().describe('Whether this is a general-purpose room (true) or a specialized coordination room (false).'),
      status: z.string().describe('Current status of the room ("active" for open rooms, "closed" for closed rooms).'),
      created_at: z.string().describe('ISO timestamp string indicating when the room was created.'),
      closed_at: z.string().optional().describe('ISO timestamp string indicating when the room was closed, if applicable.'),
      metadata: z.any().optional().describe('Additional room metadata including creation context, associated agents, and configuration.')
    })).describe('Array of room objects with their status, metadata, and associated repository information.'),
    pagination: z.object({
      total: z.number().describe('Total number of rooms matching the search criteria (before pagination).'),
      limit: z.number().describe('Maximum number of rooms returned in this response.'),
      offset: z.number().describe('Number of rooms skipped before this page of results.'),
      has_more: z.boolean().describe('Whether there are more rooms available beyond this page.')
    }).describe('Pagination information for navigating through large room lists.')
  }).optional().describe('Room listing details returned when successful, containing room information with pagination support.')
});

// List Room Messages Response
export const ListRoomMessagesResponseSchema = z.object({
  success: z.boolean().describe('Whether the message listing operation completed successfully. True if messages were retrieved from the specified room.'),
  message: z.string().describe('Human-readable description of the message retrieval result, including number of messages found.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the message listing was completed.'),
  execution_time_ms: z.number().optional().describe('Time taken to retrieve and format the message list in milliseconds.'),
  data: z.object({
    room_id: z.string().describe('Unique identifier of the room from which messages were retrieved.'),
    room_name: z.string().describe('Human-readable name of the room from which messages were retrieved.'),
    messages: z.array(z.object({
      id: z.string().describe('Unique identifier of the message.'),
      agent_name: z.string().describe('Name of the agent that sent this message.'),
      message: z.string().describe('Full text content of the message.'),
      mentions: z.array(z.string()).optional().describe('List of agent names that were mentioned in this message.'),
      message_type: z.string().describe('Type of message (e.g., "standard", "system", "coordination").'),
      timestamp: z.string().describe('ISO timestamp string indicating when this message was sent.')
    })).describe('Array of message objects in chronological order, containing full message content and metadata.'),
    pagination: z.object({
      total: z.number().describe('Total number of messages in the room (before pagination).'),
      limit: z.number().describe('Maximum number of messages returned in this response.'),
      offset: z.number().describe('Number of messages skipped before this page of results.'),
      has_more: z.boolean().describe('Whether there are more messages available beyond this page.')
    }).describe('Pagination information for navigating through message history.')
  }).optional().describe('Message listing details returned when successful, containing message content and metadata with pagination support.')
});

// Monitor Agents Response
export const MonitorAgentsResponseSchema = z.object({
  success: z.boolean().describe('Whether the monitoring operation completed successfully. True if monitoring was set up and ran for the specified duration.'),
  message: z.string().describe('Human-readable description of the monitoring result, including duration and events captured.'),
  timestamp: z.string().describe('ISO timestamp string indicating when the monitoring operation completed.'),
  execution_time_ms: z.number().optional().describe('Actual time spent monitoring in milliseconds, may be less than requested if terminated early.'),
  data: z.object({
    monitoring_mode: z.string().describe('Type of monitoring that was performed ("status", "activity", "communication", or "full").'),
    detail_level: z.string().describe('Level of detail in monitoring output ("summary", "detailed", or "verbose").'),
    duration: z.number().describe('Actual duration of monitoring in milliseconds.'),
    event_subscriptions: z.number().describe('Number of event types that were subscribed to during monitoring (e.g., agent status changes, task updates).'),
    errors: z.string().optional().describe('Summary of any errors that occurred during monitoring, if any.'),
    monitoring_type: z.string().describe('Technical type of monitoring implementation used (e.g., "real-time-eventbus").'),
    final_status: z.string().describe('Summary of the final monitoring outcome (e.g., "Agent monitored", "Orchestration monitored", "Repository monitored").')
  }).optional().describe('Monitoring operation details returned when successful, containing monitoring configuration, duration, and event capture summary.')
});

// Export response types
export type OrchestrationObjectiveResponse = z.infer<typeof OrchestrationObjectiveResponseSchema>;
export type SpawnAgentResponse = z.infer<typeof SpawnAgentResponseSchema>;
export type CreateTaskResponse = z.infer<typeof CreateTaskResponseSchema>;
export type JoinRoomResponse = z.infer<typeof JoinRoomResponseSchema>;
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;
export type WaitForMessagesResponse = z.infer<typeof WaitForMessagesResponseSchema>;
export type StoreMemoryResponse = z.infer<typeof StoreMemoryResponseSchema>;
export type SearchMemoryResponse = z.infer<typeof SearchMemoryResponseSchema>;
export type ListAgentsResponse = z.infer<typeof ListAgentsResponseSchema>;
export type TerminateAgentResponse = z.infer<typeof TerminateAgentResponseSchema>;
export type CloseRoomResponse = z.infer<typeof CloseRoomResponseSchema>;
export type DeleteRoomResponse = z.infer<typeof DeleteRoomResponseSchema>;
export type ListRoomsResponse = z.infer<typeof ListRoomsResponseSchema>;
export type ListRoomMessagesResponse = z.infer<typeof ListRoomMessagesResponseSchema>;
export type MonitorAgentsResponse = z.infer<typeof MonitorAgentsResponseSchema>;