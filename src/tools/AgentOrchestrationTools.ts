import { DatabaseManager } from '../database/index.js';
import { AgentService, TaskService, CommunicationService, KnowledgeGraphService } from '../services/index.js';
import { WebScrapingService } from '../services/WebScrapingService.js';
import { AgentMonitoringService } from '../services/AgentMonitoringService.js';
import { ClaudeSpawner } from '../process/ClaudeSpawner.js';
import type { TaskType, AgentStatus, MessageType } from '../schemas/index.js';

export interface OrchestrationResult {
  success: boolean;
  message: string;
  data?: any;
}

export interface SpawnAgentOptions {
  agentType: string;
  repositoryPath: string;
  taskDescription: string;
  capabilities?: string[];
  dependsOn?: string[];
  metadata?: Record<string, any>;
}

export class AgentOrchestrationTools {
  private agentService: AgentService;
  private taskService: TaskService;
  private communicationService: CommunicationService;
  private knowledgeGraphService: KnowledgeGraphService;
  private webScrapingService: WebScrapingService;
  private monitoringService: AgentMonitoringService;

  constructor(private db: DatabaseManager, repositoryPath: string) {
    this.agentService = new AgentService(db);
    this.taskService = new TaskService(db);
    this.communicationService = new CommunicationService(db);
    // Initialize KnowledgeGraphService with VectorSearchService
    this.initializeKnowledgeGraphService(db);
    this.webScrapingService = new WebScrapingService(
      db,
      repositoryPath
    );
    this.monitoringService = new AgentMonitoringService(db, repositoryPath);
  }

  private async initializeKnowledgeGraphService(db: DatabaseManager): Promise<void> {
    try {
      const { VectorSearchService } = await import('../services/VectorSearchService.js');
      const vectorService = new VectorSearchService(db);
      this.knowledgeGraphService = new KnowledgeGraphService(db, vectorService);
    } catch (error) {
      console.warn('Failed to initialize KnowledgeGraphService:', error);
      // Fallback to a minimal implementation that doesn't crash
      this.knowledgeGraphService = {
        createEntity: async () => ({ id: 'fallback', name: 'fallback' }),
        findEntitiesBySemanticSearch: async () => []
      } as any;
    }
  }

  /**
   * Spawn architect agent to coordinate multi-agent objective completion
   */
  async orchestrateObjective(
    title: string,
    objective: string,
    repositoryPath: string,
    foundationSessionId?: string
  ): Promise<OrchestrationResult> {
    try {
      // 1. Create coordination room (orchestration always needs room)
      const roomName = `objective_${Date.now()}`;
      await this.communicationService.createRoom({
        name: roomName,
        description: `Coordination room for: ${objective}`,
        repositoryPath,
        metadata: {
          objective,
          foundationSessionId,
          orchestrationMode: true,
          createdAt: new Date().toISOString()
        }
      });

      // 2. AUTO-CREATE MASTER TASK for the objective
      const masterTask = await this.taskService.createTask({
        repositoryPath,
        taskType: 'feature' as TaskType,
        description: `${title}: ${objective}`,
        requirements: {
          objective,
          roomName,
          foundationSessionId,
          isOrchestrationTask: true,
          createdBy: 'orchestrateObjective'
        },
        priority: 10 // High priority for orchestration tasks
      });

      // 3. Store objective in knowledge graph with task reference
      try {
        await this.knowledgeGraphService.createEntity({
          id: `orchestration-${Date.now()}`,
          repositoryPath,
          entityType: 'insight',
          name: title,
          description: `Objective: ${objective}\n\nMulti-agent objective coordination started.\nRoom: ${roomName}\nFoundation Session: ${foundationSessionId || 'none'}\nMaster Task: ${masterTask.id}`,
          properties: { tags: ['objective', 'orchestration', 'coordination', 'task-creation'] },
          discoveredBy: 'system',
          discoveredDuring: 'orchestration',
          importanceScore: 0.9,
          confidenceScore: 1.0,
          relevanceScore: 0.9
        });
      } catch (error) {
        console.warn('Failed to store objective in knowledge graph:', error);
      }

      // 4. Generate architect prompt with task-first approach
      const architectPrompt = this.generateArchitectPrompt(objective, repositoryPath, roomName, foundationSessionId, masterTask.id);

      // 5. Spawn architect agent with full autonomy, task assignment, and room
      const architectAgent = await this.agentService.createAgent({
        agentName: 'architect',
        repositoryPath,
        taskDescription: `Orchestrate objective: ${objective}`,
        capabilities: ['ALL_TOOLS', 'orchestration', 'planning', 'coordination'],
        roomId: roomName, // Explicitly assign room for orchestration
        metadata: {
          role: 'architect',
          objective,
          roomName,
          foundationSessionId,
          fullAutonomy: true,
          assignedTaskId: masterTask.id
        },
        claudeConfig: {
          prompt: architectPrompt,
          sessionId: foundationSessionId,
          environmentVars: {
            ORCHESTRATION_MODE: 'architect',
            TARGET_ROOM: roomName,
            OBJECTIVE: objective,
            MASTER_TASK_ID: masterTask.id
          }
        }
      });

      // 6. Assign master task to architect agent
      await this.taskService.assignTask(masterTask.id, architectAgent.id);

      // 7. Send welcome message to room with task info
      this.communicationService.sendMessage({
        roomName,
        agentName: 'system',
        message: `🏗️ Architect agent ${architectAgent.id} has been spawned to coordinate objective: "${objective}"\n📋 Master task ${masterTask.id} created and assigned`,
        messageType: 'system' as MessageType
      });

      return {
        success: true,
        message: 'Architect agent spawned successfully with master task',
        data: {
          architectAgentId: architectAgent.id,
          roomName,
          objective,
          masterTaskId: masterTask.id
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to orchestrate objective: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Spawn fully autonomous Claude agent with complete tool access
   */
  async spawnAgent(options: SpawnAgentOptions): Promise<OrchestrationResult> {
    try {
      // Add detailed logging to track what architects are passing
      const logger = new (await import('../utils/logger.js')).Logger('AgentOrchestration');
      
      logger.info('[SPAWN_AGENT] Called with options', {
        agentType: options.agentType,
        repositoryPath: options.repositoryPath,
        taskDescriptionType: typeof options.taskDescription,
        taskDescriptionLength: options.taskDescription?.length,
        taskDescriptionPreview: options.taskDescription?.substring(0, 100),
        capabilitiesType: typeof options.capabilities,
        capabilitiesIsArray: Array.isArray(options.capabilities),
        capabilitiesValue: options.capabilities,
        dependsOnType: typeof options.dependsOn,
        dependsOnIsArray: Array.isArray(options.dependsOn),
        dependsOnValue: options.dependsOn,
        metadataType: typeof options.metadata,
        metadataKeys: options.metadata ? Object.keys(options.metadata) : [],
        rawOptionsStringified: JSON.stringify(options)
      });

      const {
        agentType,
        repositoryPath,
        taskDescription,
        capabilities = ['ALL_TOOLS'],
        dependsOn = [],
        metadata = {}
      } = options;

      // 1. Check dependencies if any
      if (dependsOn.length > 0) {
        const depCheck = await this.checkDependencies(dependsOn);
        if (!depCheck.success) {
          return {
            success: false,
            message: `Dependencies not met: ${depCheck.message}`,
            data: { missingDependencies: depCheck.data }
          };
        }
      }

      // 2. Generate specialized prompt
      const specializedPrompt = this.generateAgentPrompt(agentType, taskDescription, repositoryPath);

      // 3. Create agent with full capabilities
      const agent = await this.agentService.createAgent({
        agentName: agentType,
        repositoryPath,
        taskDescription,
        capabilities,
        dependsOn,
        metadata: {
          ...metadata,
          spawnedAt: new Date().toISOString(),
          fullAutonomy: true
        },
        claudeConfig: {
          prompt: specializedPrompt
        }
      });

      // 4. Store agent spawn in knowledge graph
      try {
        await this.knowledgeGraphService.createEntity({
          id: `agent-spawn-${Date.now()}`,
          repositoryPath,
          entityType: 'task',
          name: `Agent ${agentType} spawned`,
          description: `Successfully spawned ${agentType} agent for task: ${taskDescription}`,
          properties: {
            agentId: agent.id,
            agentType,
            capabilities,
            dependsOn,
            tags: ['agent-spawn', agentType]
          },
          discoveredBy: 'system',
          discoveredDuring: 'agent-spawn',
          importanceScore: 0.7,
          confidenceScore: 1.0,
          relevanceScore: 0.8
        });
      } catch (error) {
        console.warn('Failed to store agent spawn in knowledge graph:', error);
      }

      return {
        success: true,
        message: `${agentType} agent spawned successfully`,
        data: {
          agentId: agent.id,
          agentType,
          pid: agent.claudePid,
          capabilities
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to spawn ${options.agentType} agent: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Create and assign task to agents with enhanced capabilities
   */
  async createTask(
    repositoryPath: string,
    taskType: TaskType,
    title: string,
    description: string,
    requirements?: Record<string, any>,
    dependencies?: string[]
  ): Promise<OrchestrationResult> {
    try {
      // Create the task with enhanced features
      const task = await this.taskService.createTask({
        repositoryPath,
        taskType,
        description: `${title}: ${description}`,
        requirements,
        priority: requirements?.priority || 1,
        estimatedDuration: requirements?.estimatedDuration,
        tags: requirements?.tags || [taskType, 'orchestration']
      });

      // Add dependencies if specified
      if (dependencies && dependencies.length > 0) {
        for (const depId of dependencies) {
          await this.taskService.addTaskDependency(task.id, depId);
        }
      }

      // Auto-assign if agent specified
      if (requirements?.assignedAgentId) {
        await this.taskService.assignTask(task.id, requirements.assignedAgentId);
      }

      // Store task creation in knowledge graph with enhanced metadata
      try {
        await this.knowledgeGraphService.createEntity({
          id: `task-creation-${Date.now()}`,
          repositoryPath,
          entityType: 'task',
          name: `Task created: ${title}`,
          description: `Task ${task.id} created with type ${taskType}.\nDescription: ${description}\nPriority: ${task.priority}\nEstimated Duration: ${requirements?.estimatedDuration || 'N/A'} minutes`,
          properties: {
            taskId: task.id,
            taskType,
            dependencies: dependencies || [],
            priority: task.priority,
            estimatedDuration: requirements?.estimatedDuration,
            tags: ['task-creation', taskType, 'orchestration', ...(requirements?.tags || [])]
          },
          discoveredBy: 'system',
          discoveredDuring: 'task-creation',
          importanceScore: 0.8,
          confidenceScore: 1.0,
          relevanceScore: 0.8
        });
      } catch (error) {
        console.warn('Failed to store task creation in knowledge graph:', error);
      }

      return {
        success: true,
        message: 'Task created successfully with enhanced tracking',
        data: {
          taskId: task.id,
          taskType,
          status: task.status,
          priority: task.priority,
          estimatedDuration: requirements?.estimatedDuration,
          dependencies: dependencies || []
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to create task: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Join communication room for coordination
   */
  async joinRoom(roomName: string, agentName: string): Promise<OrchestrationResult> {
    try {
      // Check if room exists
      const room = this.communicationService.getRoom(roomName);
      if (!room) {
        return {
          success: false,
          message: `Room ${roomName} not found`,
          data: { roomName }
        };
      }

      // Join the room
      await this.communicationService.joinRoom(roomName, agentName);

      // Get recent messages for context
      const recentMessages = await this.communicationService.getRecentMessages(roomName, 10);
      const participants = await this.communicationService.getRoomParticipants(roomName);

      return {
        success: true,
        message: `Successfully joined room ${roomName}`,
        data: {
          roomName,
          agentName,
          participantCount: participants.length,
          recentMessageCount: recentMessages.length,
          recentMessages: recentMessages.slice(0, 5) // Return last 5 for context
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to join room: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Send message to coordination room
   */
  async sendMessage(
    roomName: string,
    agentName: string,
    message: string,
    mentions?: string[]
  ): Promise<OrchestrationResult> {
    try {
      const sentMessage = await this.communicationService.sendMessage({
        roomName,
        agentName,
        message,
        mentions,
        messageType: 'standard' as MessageType
      });

      return {
        success: true,
        message: 'Message sent successfully',
        data: {
          messageId: sentMessage.id,
          roomName,
          agentName,
          mentions: mentions || []
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to send message: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Wait for messages in a room
   */
  async waitForMessages(
    roomName: string,
    timeout = 30000,
    sinceTimestamp?: Date
  ): Promise<OrchestrationResult> {
    try {
      const messages = await this.communicationService.waitForMessages(
        roomName,
        sinceTimestamp,
        timeout
      );

      return {
        success: true,
        message: `Retrieved ${messages.length} messages`,
        data: {
          messages,
          count: messages.length,
          roomName
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to wait for messages: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Store insights and learnings in shared memory
   */
  async storeMemory(
    repositoryPath: string,
    agentId: string,
    entryType: 'insight' | 'error' | 'decision' | 'task',
    title: string,
    content: string,
    tags?: string[]
  ): Promise<OrchestrationResult> {
    try {
      let memory;

      try {
        memory = await this.knowledgeGraphService.createEntity({
          id: `memory-${Date.now()}`,
          repositoryPath,
          entityType: entryType,
          name: title,
          description: content,
          properties: { tags: tags || [] },
          discoveredBy: agentId,
          discoveredDuring: 'agent-work',
          importanceScore: 0.7,
          confidenceScore: 0.8,
          relevanceScore: 0.8
        });
      } catch (error) {
        console.warn('Failed to store memory in knowledge graph:', error);
        throw new Error(`Failed to store ${entryType}: ${error}`);
      }

      return {
        success: true,
        message: `${entryType} stored successfully`,
        data: {
          memoryId: memory.id,
          entryType,
          title,
          agentId
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to store memory: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Search shared memory for insights
   */
  async searchMemory(
    repositoryPath: string,
    queryText: string,
    agentId?: string,
    limit = 10
  ): Promise<OrchestrationResult> {
    try {
      const insights = await this.knowledgeGraphService.findEntitiesBySemanticSearch(
        repositoryPath,
        queryText,
        undefined, // entityTypes - search all types
        limit,
        0.7 // threshold
      );
      
      // Filter by agent if specified
      const filteredInsights = agentId 
        ? insights.filter(entity => entity.discoveredBy === agentId)
        : insights;

      return {
        success: true,
        message: `Found ${filteredInsights.length} relevant memories`,
        data: {
          insights: filteredInsights,
          count: filteredInsights.length,
          query: queryText
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to search memory: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get list of active agents
   */
  async listAgents(repositoryPath: string, status?: AgentStatus, limit: number = 5, offset: number = 0): Promise<OrchestrationResult> {
    try {
      const agents = await this.agentService.listAgents(repositoryPath, status, limit, offset);

      return {
        success: true,
        message: `Found ${agents.length} agents`,
        data: {
          agents: agents.map(agent => ({
            id: agent.id,
            name: agent.agentName,
            status: agent.status,
            capabilities: agent.capabilities,
            lastHeartbeat: agent.lastHeartbeat,
            metadata: agent.agentMetadata
          })),
          count: agents.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to list agents: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Terminate one or more agents
   */
  async terminateAgent(agentIds: string[]): Promise<OrchestrationResult> {
    try {
      const ids = agentIds;
      const results: Array<{ agentId: string; success: boolean; error?: string }> = [];

      for (const agentId of ids) {
        try {
          // Use the AgentService's built-in terminate method
          await this.agentService.terminateAgent(agentId);
          
          results.push({
            agentId,
            success: true
          });

        } catch (error) {
          results.push({
            agentId,
            success: false,
            error: String(error)
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;

      return {
        success: failureCount === 0,
        message: `Terminated ${successCount}/${results.length} agents${failureCount > 0 ? ` (${failureCount} failed)` : ''}`,
        data: {
          results,
          successCount,
          failureCount,
          totalCount: results.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to terminate agents: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  // Private helper methods
  private generateArchitectPrompt(
    objective: string,
    repositoryPath: string,
    roomName: string,
    foundationSessionId?: string,
    masterTaskId?: string
  ): string {
    return `🏗️ ARCHITECT AGENT - Strategic Orchestration Leader with Sequential Thinking

OBJECTIVE: ${objective}
REPOSITORY: ${repositoryPath}
COORDINATION ROOM: ${roomName}
FOUNDATION SESSION: ${foundationSessionId || 'none'}
MASTER TASK: ${masterTaskId || 'none'}

You are an autonomous architect agent with COMPLETE CLAUDE CODE CAPABILITIES and advanced sequential thinking for complex planning.
You can use ALL tools: file operations, web browsing, code analysis, agent spawning, etc.

🧠 SEQUENTIAL THINKING METHODOLOGY:
You have access to the sequential_thinking tool for complex problem decomposition and planning.
Use this tool systematically throughout your orchestration process:

1. **Initial Analysis**: Use sequential_thinking() to understand objective scope and complexity
2. **Problem Decomposition**: Break down the objective into logical components systematically
3. **Dependency Analysis**: Identify relationships and dependencies between components
4. **Agent Planning**: Determine optimal agent types and task assignments
5. **Risk Assessment**: Consider potential challenges and mitigation strategies
6. **Execution Strategy**: Plan coordination and monitoring approach
7. **Iterative Refinement**: Revise and improve your approach as understanding deepens

🎯 KNOWLEDGE GRAPH INTEGRATION:
Before planning, always search for relevant knowledge and patterns:
- search_memory() to learn from previous similar objectives
- Look for patterns in agent coordination, task breakdown, and execution strategies
- Identify reusable components and successful approaches from past work
- Use knowledge graph insights to inform your sequential thinking process

🎯 TASK-FIRST ORCHESTRATION APPROACH:
Your orchestration centers around hierarchical task management. You have been assigned master task ${masterTaskId || 'TBD'}.

ORCHESTRATION PHASES:

1. **STRATEGIC ANALYSIS WITH SEQUENTIAL THINKING**
   REQUIRED: Start with sequential_thinking() to analyze the objective:
   - Thought 1: Initial objective understanding and scope assessment
   - Thought 2: Complexity analysis and decomposition approach
   - Thought 3: Dependencies and execution strategy
   - Thought 4: Agent coordination requirements
   - Thought 5: Risk assessment and mitigation planning
   - Continue iterative refinement as needed
   
2. **KNOWLEDGE GRAPH DISCOVERY**
   - Join coordination room: join_room("${roomName}", "architect")
   - Search shared memory for relevant patterns: search_memory()
   - Query previous orchestration experiences: search_memory("orchestration patterns")
   - Analyze repository structure thoroughly
   - Identify reusable components and successful approaches
   
3. **STRUCTURED TASK BREAKDOWN WITH SEQUENTIAL THINKING**
   REQUIRED: Use sequential_thinking() for task decomposition:
   - Analyze objective components systematically
   - Create hierarchical task structure with dependencies
   - Define agent specialization requirements
   - Plan execution sequencing and coordination
   - Store complete plan in shared memory: store_memory()
   
4. **COORDINATED AGENT EXECUTION**
   - spawn_agent() specialist agents with specific task assignments
   - Create sub-tasks using create_task() for complex work
   - Monitor progress through room messages: wait_for_messages()
   - Handle conflicts and dependencies proactively
   - Ensure quality gates and completion criteria
   
5. **CONTINUOUS MONITORING & ADAPTATION**
   - Monitor agent progress and identify bottlenecks
   - Use sequential_thinking() for problem-solving when issues arise
   - Adapt coordination strategy based on real-time feedback
   - Create additional tasks or agents as needed
   
6. **COMPLETION & KNOWLEDGE CAPTURE**
   - Verify all tasks completed successfully
   - Update master task status
   - Document learnings and patterns in shared memory
   - Provide comprehensive final status report

AVAILABLE ORCHESTRATION TOOLS:
- sequential_thinking() - Step-by-step problem decomposition and planning
- create_task() - Create sub-tasks with dependencies and requirements
- spawn_agent() - Create specialized agents (they'll be prompted to use task tools)
- join_room() - Join coordination rooms
- send_message() - Communicate with agents
- wait_for_messages() - Monitor conversations
- store_memory() - Share insights, decisions, and patterns
- search_memory() - Learn from previous work and knowledge graph
- list_agents() - Check agent status and coordination needs

CRITICAL SEQUENTIAL THINKING USAGE:
- ALWAYS start with sequential_thinking() for initial objective analysis
- Use sequential_thinking() for complex task decomposition
- Apply sequential thinking when encountering problems or roadblocks
- Use iterative thinking to refine and improve your approach
- Consider alternative paths and risk mitigation systematically
- Document your reasoning process in shared memory

CRITICAL KNOWLEDGE GRAPH INTEGRATION:
- Search memory before planning to leverage previous experiences
- Look for patterns in similar objectives and successful approaches
- Use knowledge graph insights to inform your sequential thinking
- Store new insights and patterns for future orchestration
- Build upon successful coordination strategies from past work

CRITICAL TASK MANAGEMENT:
- Always use create_task() to break down work into manageable pieces
- Create hierarchical task structures with clear dependencies
- Assign tasks to agents when spawning them
- Monitor task completion and update statuses regularly
- Use task dependencies to coordinate agent work effectively

ORCHESTRATION BEST PRACTICES:
1. Begin with sequential_thinking() to understand the objective thoroughly
2. Search knowledge graph for relevant patterns and successful approaches
3. Create a structured task breakdown with clear dependencies
4. Spawn specialized agents with specific, well-defined tasks
5. Monitor progress continuously and adapt strategy as needed
6. Document learnings and patterns for future orchestration

CRITICAL: You have COMPLETE autonomy with advanced sequential thinking capabilities.
Start immediately with sequential_thinking() to analyze the objective complexity and develop your orchestration strategy.`;
  }

  private generateAgentPrompt(agentType: string, taskDescription: string, repositoryPath: string): string {
    const basePrompt = `You are a fully autonomous ${agentType} agent with COMPLETE CLAUDE CODE CAPABILITIES and advanced sequential thinking.

TASK: ${taskDescription}
REPOSITORY: ${repositoryPath}

You have access to ALL tools:
- File operations (Read, Write, Edit, Search, etc.)
- Code analysis and refactoring
- Web browsing and research
- System commands and build tools
- Git operations
- Database queries
- Agent coordination tools (spawn_agent, join_room, send_message, etc.)
- Shared memory and communication (store_memory, search_memory, etc.)
- Task management tools (create_task, list_tasks, update_task, etc.)
- Sequential thinking tool (sequential_thinking) for complex problem solving

🧠 SEQUENTIAL THINKING METHODOLOGY:
You have access to the sequential_thinking tool for complex problem decomposition and solution development.
Use this tool systematically for complex challenges:

1. **Problem Analysis**: Use sequential_thinking() to understand the challenge scope
2. **Solution Planning**: Break down the approach into logical steps
3. **Implementation Strategy**: Plan execution with considerations for dependencies
4. **Risk Assessment**: Identify potential issues and mitigation strategies
5. **Quality Assurance**: Plan testing and validation approaches
6. **Iterative Refinement**: Revise and improve your approach as understanding deepens

🎯 KNOWLEDGE GRAPH INTEGRATION:
Before starting work, search for relevant knowledge and patterns:
- search_memory() to learn from previous similar tasks
- Look for patterns in successful implementations
- Identify reusable components and established approaches
- Use knowledge graph insights to inform your sequential thinking process

🎯 TASK-DRIVEN OPERATION:
- You are expected to work in a task-driven manner
- Use sequential_thinking() for complex problem analysis
- Use create_task() to break down complex work into manageable pieces
- Create sub-tasks when your assigned work is complex
- Update task progress regularly and report completion
- Use task dependencies to coordinate with other agents

AUTONOMOUS OPERATION GUIDELINES:
- Work independently to complete your assigned task
- Use sequential_thinking() for complex problem solving
- Use any tools necessary for success
- Search knowledge graph before implementing to leverage previous work
- Coordinate with other agents when beneficial
- Store insights and learnings in shared memory
- Report progress in coordination rooms
- Make decisions and take actions as needed

COORDINATION TOOLS AVAILABLE:
- sequential_thinking() - Step-by-step problem decomposition
- create_task() - Break down complex work into sub-tasks
- join_room() - Join project coordination rooms
- send_message() - Communicate with other agents
- store_memory() - Share knowledge, insights, and patterns
- search_memory() - Learn from previous work and knowledge graph
- spawn_agent() - Create helper agents if needed

CRITICAL SEQUENTIAL THINKING USAGE:
- Use sequential_thinking() for complex implementation challenges
- Break down multi-step processes systematically
- Revise and refine your approach as understanding deepens
- Consider alternative solutions and trade-offs
- Use iterative thinking to improve solution quality
- Document your reasoning process in shared memory

CRITICAL KNOWLEDGE GRAPH INTEGRATION:
- Search memory before implementing to leverage previous experiences
- Look for patterns in similar tasks and successful approaches
- Use knowledge graph insights to inform your sequential thinking
- Store new insights and patterns for future tasks
- Build upon successful implementation strategies from past work

CRITICAL TASK MANAGEMENT:
- Always assess if your work needs to be broken into sub-tasks
- Create sub-tasks for complex implementations
- Report progress and completion status
- Use task dependencies to coordinate sequencing with other agents

IMPLEMENTATION BEST PRACTICES:
1. Begin with sequential_thinking() to understand the task thoroughly
2. Search knowledge graph for relevant patterns and successful approaches
3. Create a structured implementation plan with clear steps
4. Execute systematically with continuous validation
5. Document learnings and patterns for future tasks

CRITICAL: You are fully autonomous with advanced sequential thinking capabilities.
Start with sequential_thinking() to analyze your task and develop your implementation strategy.`;

    // Add role-specific instructions
    const roleInstructions = this.getRoleInstructions(agentType);
    return basePrompt + roleInstructions;
  }

  private getRoleInstructions(agentType: string): string {
    const instructions: Record<string, string> = {
      'backend': `

BACKEND AGENT SPECIALIZATION:
- Focus on server-side implementation
- Database design and API development
- Security and performance optimization
- Integration testing and validation
- Use appropriate frameworks and libraries
- Follow security best practices`,

      'frontend': `

FRONTEND AGENT SPECIALIZATION:
- User interface and user experience
- Component design and state management
- Responsive design and accessibility
- Client-side testing and optimization
- Modern UI frameworks and patterns
- Cross-browser compatibility`,

      'testing': `

TESTING AGENT SPECIALIZATION:
- Comprehensive test strategy and implementation
- Unit, integration, and end-to-end testing
- Test automation and CI/CD integration
- Quality assurance and bug detection
- Performance and load testing
- Coverage analysis and reporting`,

      'documentation': `

DOCUMENTATION AGENT SPECIALIZATION:
- Technical documentation and guides
- API documentation and examples
- User manuals and tutorials
- Knowledge base maintenance
- Code documentation and comments
- Architecture decision records`,

      'devops': `

DEVOPS AGENT SPECIALIZATION:
- Infrastructure as code
- CI/CD pipeline optimization
- Container orchestration
- Monitoring and logging
- Security and compliance
- Performance optimization`,

      'researcher': `

RESEARCH AGENT SPECIALIZATION:
- Technology research and analysis
- Best practices investigation
- Competitive analysis
- Documentation scraping and analysis
- Trend analysis and recommendations
- Knowledge synthesis and reporting`
    };

    return instructions[agentType] || `

SPECIALIST AGENT:
- Apply your expertise to the specific task
- Follow best practices in your domain
- Collaborate effectively with other agents
- Deliver high-quality results
- Document your decisions and learnings`;
  }

  private async checkDependencies(dependsOn: string[]): Promise<{ success: boolean; message: string; data?: any }> {
    const missingDeps: string[] = [];

    for (const depId of dependsOn) {
      const agent = await this.agentService.getAgent(depId);
      if (!agent) {
        missingDeps.push(depId);
      } else if (agent.status !== 'completed' && agent.status !== 'active') {
        missingDeps.push(`${depId} (status: ${agent.status})`);
      }
    }

    if (missingDeps.length > 0) {
      return {
        success: false,
        message: `Missing or incomplete dependencies: ${missingDeps.join(', ')}`,
        data: missingDeps
      };
    }

    return { success: true, message: 'All dependencies satisfied' };
  }

  /**
   * Close a communication room (soft delete - marks as closed but keeps data)
   */
  async closeRoom(roomName: string, terminateAgents: boolean = true): Promise<OrchestrationResult> {
    try {
      // Get room info to find associated agents
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        return {
          success: false,
          message: `Room '${roomName}' not found`,
          data: { roomName }
        };
      }

      let terminatedAgents: string[] = [];
      
      if (terminateAgents) {
        // Find agents in this room and terminate them
        const agents = await this.agentService.listAgents(room.repositoryPath);
        const roomAgents = agents.filter(agent => 
          agent.agentMetadata?.roomName === roomName || 
          agent.status === 'active' // Terminate active agents as safety measure
        );
        
        if (roomAgents.length > 0) {
          const agentIds = roomAgents.map(a => a.id);
          const terminationResult = await this.terminateAgent(agentIds);
          terminatedAgents = agentIds;
        }
      }

      // Mark room as closed by updating metadata
      await this.communicationService.updateRoomMetadata(roomName, {
        ...room.roomMetadata,
        status: 'closed',
        closedAt: new Date().toISOString(),
        terminatedAgents
      });
      
      return {
        success: true,
        message: `Room '${roomName}' closed successfully${terminateAgents ? ` and ${terminatedAgents.length} agents terminated` : ''}`,
        data: { 
          roomName, 
          terminatedAgents,
          agentCount: terminatedAgents.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to close room '${roomName}': ${error}`,
        data: { error: String(error), roomName }
      };
    }
  }

  /**
   * Permanently delete a communication room and all its messages
   */
  async deleteRoom(roomName: string, forceDelete: boolean = false): Promise<OrchestrationResult> {
    try {
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        return {
          success: false,
          message: `Room '${roomName}' not found`,
          data: { roomName }
        };
      }

      // Check if room is closed or force delete
      const isClosed = room.roomMetadata?.status === 'closed';
      if (!isClosed && !forceDelete) {
        return {
          success: false,
          message: `Room '${roomName}' must be closed before deletion. Use force_delete=true to override.`,
          data: { roomName, suggestion: 'close_room_first' }
        };
      }

      // Terminate any remaining agents
      const agents = await this.agentService.listAgents(room.repositoryPath);
      const roomAgents = agents.filter(agent => 
        agent.agentMetadata?.roomName === roomName
      );
      
      if (roomAgents.length > 0) {
        await this.terminateAgent(roomAgents.map(a => a.id));
      }

      // Delete the room
      await this.communicationService.deleteRoom(roomName);
      
      return {
        success: true,
        message: `Room '${roomName}' permanently deleted`,
        data: { 
          roomName,
          messagesDeleted: true,
          agentsTerminated: roomAgents.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to delete room '${roomName}': ${error}`,
        data: { error: String(error), roomName }
      };
    }
  }

  /**
   * List communication rooms with filtering and pagination
   */
  async listRooms(
    repositoryPath: string, 
    status?: 'active' | 'closed' | 'all',
    limit: number = 20,
    offset: number = 0
  ): Promise<OrchestrationResult> {
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

      return {
        success: true,
        message: `Found ${total} rooms${status ? ` with status '${status}'` : ''}`,
        data: {
          rooms: paginatedRooms.map(room => ({
            name: room.name,
            description: room.description,
            repositoryPath: room.repositoryPath,
            status: room.roomMetadata?.status || 'active',
            createdAt: room.createdAt,
            closedAt: room.roomMetadata?.closedAt,
            metadata: room.roomMetadata
          })),
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to list rooms: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * List messages from a specific room with pagination
   */
  async listRoomMessages(
    roomName: string,
    limit: number = 50,
    offset: number = 0,
    sinceTimestamp?: string
  ): Promise<OrchestrationResult> {
    try {
      const room = await this.communicationService.getRoom(roomName);
      if (!room) {
        return {
          success: false,
          message: `Room '${roomName}' not found`,
          data: { roomName }
        };
      }

      const since = sinceTimestamp ? new Date(sinceTimestamp) : undefined;
      const messages = await this.communicationService.getMessages(roomName, limit + offset, since);
      
      // Apply offset manually since the service doesn't support it
      const paginatedMessages = messages.slice(offset, offset + limit);

      return {
        success: true,
        message: `Retrieved ${paginatedMessages.length} messages from room '${roomName}'`,
        data: {
          roomName,
          messages: paginatedMessages.map(msg => ({
            id: msg.id,
            agentName: msg.agentName,
            message: msg.message,
            mentions: msg.mentions,
            messageType: msg.messageType,
            timestamp: msg.timestamp
          })),
          pagination: {
            total: messages.length,
            limit,
            offset,
            hasMore: offset + limit < messages.length
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to list messages: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Create a room when agents realize they need coordination
   */
  async createRoomForAgent(
    agentId: string,
    repositoryPath: string,
    reason: string,
    participants: string[] = []
  ): Promise<OrchestrationResult> {
    try {
      const agent = await this.agentService.getAgent(agentId);
      if (!agent) {
        return {
          success: false,
          message: `Agent ${agentId} not found`,
          data: { agentId }
        };
      }

      // Use the CommunicationService's createRoomForAgent method
      const result = await this.communicationService.createRoomForAgent(
        agent.agentName,
        repositoryPath,
        reason,
        participants
      );

      // Update agent with new room ID
      await this.agentService.updateAgentStatus(agentId, {
        status: agent.status,
        metadata: {
          ...agent.agentMetadata,
          roomId: result.roomName,
          roomCreatedAt: new Date().toISOString()
        }
      });

      // Store coordination event in knowledge graph
      try {
        await this.knowledgeGraphService.createEntity({
          id: `coord-room-${Date.now()}`,
          repositoryPath,
          entityType: 'task',
          name: 'On-demand room creation',
          description: `Created coordination room ${result.roomName} for reason: ${reason}`,
          properties: {
            roomName: result.roomName,
            reason,
            participants,
            tags: ['on-demand-coordination', 'room-creation']
          },
          discoveredBy: agentId,
          discoveredDuring: 'room-creation',
          importanceScore: 0.6,
          confidenceScore: 1.0,
          relevanceScore: 0.7
        });
      } catch (error) {
        console.warn('Failed to store coordination event in knowledge graph:', error);
      }

      return {
        success: true,
        message: `Coordination room '${result.roomName}' created successfully`,
        data: {
          roomName: result.roomName,
          agentId,
          reason,
          participants,
          initiatingAgent: agent.agentName
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to create room for agent: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Create a delayed room for coordination when agents realize they need it
   */
  async createDelayedRoom(
    agentId: string,
    repositoryPath: string,
    reason: string,
    participants: string[] = []
  ): Promise<OrchestrationResult> {
    try {
      // Generate room name based on reason and timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const roomName = `coordination-${reason.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${timestamp}`;
      
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
        } catch (error) {
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
      
      return {
        success: true,
        message: `Delayed coordination room created successfully`,
        data: {
          roomName: room.name,
          reason,
          participants: [...participants, agentId],
          createdAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create delayed room: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Analyze coordination patterns and suggest improvements
   */
  async analyzeCoordinationPatterns(repositoryPath: string): Promise<OrchestrationResult> {
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

      return {
        success: true,
        message: `Coordination analysis complete for ${repositoryPath}`,
        data: {
          totalRooms,
          activeRooms,
          recommendations
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to analyze coordination patterns: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get task analytics and insights
   */
  async getTaskAnalytics(repositoryPath: string): Promise<OrchestrationResult> {
    try {
      const analytics = await this.taskService.getTaskAnalytics(repositoryPath);
      
      return {
        success: true,
        message: `Task analytics retrieved for ${repositoryPath}`,
        data: {
          analytics,
          summary: {
            totalTasks: analytics.totalTasks,
            completionRate: `${analytics.completionRate.toFixed(1)}%`,
            averageTime: `${analytics.averageCompletionTime.toFixed(1)} minutes`,
            topBottleneck: 'None identified',
            topRecommendation: 'System performing well'
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to get task analytics: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get task hierarchy and progress
   */
  async getTaskHierarchy(taskId: string): Promise<OrchestrationResult> {
    try {
      const hierarchy = await this.taskService.getTaskHierarchy(taskId);
      
      if (!hierarchy) {
        return {
          success: false,
          message: `Task ${taskId} not found`,
          data: { taskId }
        };
      }
      
      return {
        success: true,
        message: `Task hierarchy retrieved for ${taskId}`,
        data: {
          hierarchy,
          summary: {
            rootTasks: hierarchy.rootTasks.length,
            totalSubtasks: Object.keys(hierarchy.taskTree).length,
            orphanTasks: hierarchy.orphanTasks.length,
            treeDepth: Math.max(...Object.values(hierarchy.taskTree).map(tasks => tasks.length))
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to get task hierarchy: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Update task progress with enhanced tracking
   */
  async updateTaskProgress(
    taskId: string,
    progress: {
      status?: 'pending' | 'in_progress' | 'completed' | 'failed';
      progressPercentage?: number;
      notes?: string;
      results?: Record<string, any>;
    }
  ): Promise<OrchestrationResult> {
    try {
      await this.taskService.updateTask(taskId, {
        status: progress.status,
        progressPercentage: progress.progressPercentage,
        notes: progress.notes,
        results: progress.results
      });
      
      return {
        success: true,
        message: `Task ${taskId} updated successfully`,
        data: {
          taskId,
          progress: {
            status: progress.status,
            progressPercentage: progress.progressPercentage,
            hasNotes: !!progress.notes,
            hasResults: !!progress.results
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to update task progress: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get task execution plan with critical path analysis
   */
  async getTaskExecutionPlan(repositoryPath: string): Promise<OrchestrationResult> {
    try {
      // Get all tasks for this repository
      const allTasks = await this.taskService.getTasksByRepository(repositoryPath);
      const taskIds = allTasks.map(task => task.id);
      
      const plan = await this.taskService.createExecutionPlan(taskIds);
      
      return {
        success: true,
        message: `Execution plan generated for ${repositoryPath}`,
        data: {
          plan,
          summary: {
            totalTasks: plan.tasks.length,
            estimatedDuration: `${plan.estimatedDuration} minutes`,
            criticalPathLength: plan.criticalPath.length,
            riskLevel: plan.riskAssessment.confidenceLevel > 0.8 ? 'Low' : 
                      plan.riskAssessment.confidenceLevel > 0.6 ? 'Medium' : 'High',
            topRisk: plan.riskAssessment.mitigationStrategies[0] || 'No major risks identified'
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to get execution plan: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Break down a complex task into subtasks
   */
  async breakdownTask(
    taskId: string,
    subtasks: Array<{
      title: string;
      description: string;
      taskType: TaskType;
      estimatedDuration?: number;
      priority?: number;
      dependencies?: string[];
    }>
  ): Promise<OrchestrationResult> {
    try {
      const task = await this.taskService.getTask(taskId);
      if (!task) {
        return {
          success: false,
          message: `Task ${taskId} not found`,
          data: { taskId }
        };
      }

      const createdSubtasks = await this.taskService.breakdownTask(
        taskId,
        subtasks.map(subtask => ({
          description: `${subtask.title}: ${subtask.description}`,
          taskType: subtask.taskType,
          requirements: {
            estimatedDuration: subtask.estimatedDuration,
            priority: subtask.priority,
            tags: ['subtask', subtask.taskType]
          },
          dependencies: subtask.dependencies || []
        }))
      );

      // Store task breakdown in knowledge graph with enhanced metadata
      try {
        await this.knowledgeGraphService.createEntity({
          id: `task-breakdown-${Date.now()}`,
          repositoryPath: task.repositoryPath,
          entityType: 'task',
          name: `Task breakdown: ${task.description}`,
          description: `Task ${taskId} broken down into ${createdSubtasks.length} subtasks`,
          properties: {
            parentTaskId: taskId,
            subtaskIds: createdSubtasks.map(t => t.id),
            subtaskCount: createdSubtasks.length,
            tags: ['task-breakdown', 'orchestration']
          },
          discoveredBy: 'system',
          discoveredDuring: 'task-breakdown',
          importanceScore: 0.8,
          confidenceScore: 1.0,
          relevanceScore: 0.8
        });
      } catch (error) {
        console.warn('Failed to store task breakdown in knowledge graph:', error);
      }

      return {
        success: true,
        message: `Task ${taskId} broken down into ${createdSubtasks.length} subtasks`,
        data: {
          parentTaskId: taskId,
          subtasks: createdSubtasks.map(subtask => ({
            id: subtask.id,
            description: subtask.description,
            taskType: subtask.taskType,
            priority: subtask.priority,
            estimatedDuration: subtask.requirements?.estimatedDuration
          }))
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to breakdown task: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Auto-assign tasks to available agents based on capabilities
   */
  async autoAssignTasks(repositoryPath: string): Promise<OrchestrationResult> {
    try {
      // Get available agents first
      const agents = await this.agentService.listAgents(repositoryPath, 'active');
      const availableAgents = agents;
      
      let assignments: any[] = [];
      if (availableAgents.length > 0) {
        // Use the first available agent for simplicity
        assignments = await this.taskService.autoAssignTasks(repositoryPath, availableAgents[0].id);
      }
      
      // Store assignment results in knowledge graph
      try {
        await this.knowledgeGraphService.createEntity({
          id: `auto-assignment-${Date.now()}`,
          repositoryPath,
          entityType: 'task',
          name: 'Auto-assignment completed',
          description: `${assignments.length} tasks automatically assigned to agents`,
          properties: {
            assignmentCount: assignments.length,
            assignments: assignments.map(a => ({ taskId: a.id, agentId: a.assignedAgentId })),
            tags: ['auto-assignment', 'orchestration']
          },
          discoveredBy: 'system',
          discoveredDuring: 'auto-assignment',
          importanceScore: 0.7,
          confidenceScore: 1.0,
          relevanceScore: 0.7
        });
      } catch (error) {
        console.warn('Failed to store auto-assignment in knowledge graph:', error);
      }

      return {
        success: true,
        message: `${assignments.length} tasks auto-assigned successfully`,
        data: {
          assignmentCount: assignments.length,
          assignments: assignments.map(assignment => ({
            taskId: assignment.id,
            agentId: assignment.assignedAgentId
          }))
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to auto-assign tasks: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Get comprehensive task insights for better orchestration
   */
  async getTaskInsights(repositoryPath: string): Promise<OrchestrationResult> {
    try {
      const [analytics, pendingTasks, inProgressTasks] = await Promise.all([
        this.taskService.getTaskAnalytics(repositoryPath),
        this.taskService.getPendingTasks(repositoryPath),
        this.taskService.listTasks(repositoryPath, { status: 'in_progress' })
      ]);

      const insights = {
        analytics,
        currentState: {
          pendingTasks: pendingTasks.length,
          inProgressTasks: inProgressTasks.length,
          unassignedTasks: pendingTasks.filter(t => !t.assignedAgentId).length,
          blockedTasks: 0 // TODO: Calculate blocked tasks
        },
        recommendations: [
          pendingTasks.length > 5 ? 'Consider spawning additional agents for pending tasks' : null,
          inProgressTasks.length > 10 ? 'Monitor in-progress tasks for potential bottlenecks' : null
        ].filter(Boolean) as string[]
      };

      return {
        success: true,
        message: `Task insights generated for ${repositoryPath}`,
        data: insights
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to get task insights: ${error}`,
        data: { error: String(error) }
      };
    }
  }

  /**
   * Monitor agents with real-time updates and timeout handling
   */
  async monitorAgents(
    agentId?: string,
    orchestrationId?: string,
    roomName?: string,
    repositoryPath?: string,
    monitoringMode: 'status' | 'activity' | 'communication' | 'full' = 'status',
    updateInterval: number = 2000,
    maxDuration: number = 50000,
    detailLevel: 'summary' | 'detailed' | 'verbose' = 'summary'
  ): Promise<OrchestrationResult> {
    try {
      const resolvedPath = repositoryPath || process.cwd();
      const startTime = Date.now();
      const updates: string[] = [];
      const errors: string[] = [];
      
      // Add opening message
      updates.push(`🔍 Starting agent monitoring (${monitoringMode} mode, ${detailLevel} detail)`);
      updates.push(`⏱️ Monitoring for up to ${maxDuration/1000} seconds with ${updateInterval/1000}s intervals`);
      updates.push('');

      // Initial status snapshot
      updates.push('📊 INITIAL STATUS:');
      let initialStatus;
      try {
        if (agentId) {
          initialStatus = await this.monitoringService.getAgentStatus(agentId);
          updates.push(`Agent ${agentId}: ${initialStatus.status}`);
          if (initialStatus.currentTask) {
            updates.push(`  Current task: ${initialStatus.currentTask.description}`);
          }
          updates.push(`  Uptime: ${Math.floor(initialStatus.uptime/60)}m ${Math.floor(initialStatus.uptime%60)}s`);
        } else if (orchestrationId) {
          initialStatus = await this.monitoringService.getOrchestrationStatus(orchestrationId);
          updates.push(`Orchestration ${orchestrationId}: ${initialStatus.status}`);
          updates.push(`  Progress: ${initialStatus.progress.toFixed(1)}%`);
          updates.push(`  Active agents: ${initialStatus.activeAgents.length}`);
          updates.push(`  Completed tasks: ${initialStatus.completedTasks.length}/${initialStatus.totalTasks}`);
        } else if (roomName) {
          initialStatus = await this.monitoringService.getRoomActivity(roomName);
          updates.push(`Room ${roomName}: ${initialStatus.coordinationStatus}`);
          updates.push(`  Active members: ${initialStatus.activeMembers.length}`);
          updates.push(`  Messages: ${initialStatus.messageCount}`);
        } else {
          initialStatus = await this.monitoringService.getActiveAgents(resolvedPath);
          updates.push(`Repository ${resolvedPath}: ${initialStatus.length} active agents`);
          initialStatus.forEach((agent: any) => {
            updates.push(`  Agent ${agent.agentId}: ${agent.status}`);
          });
        }
      } catch (error) {
        errors.push(`Failed to get initial status: ${error}`);
      }

      updates.push('');
      updates.push('🔄 MONITORING UPDATES:');

      // Monitoring loop with timeout awareness
      let iteration = 0;
      const maxIterations = Math.floor(maxDuration / updateInterval);
      
      while (Date.now() - startTime < maxDuration) {
        await new Promise(resolve => setTimeout(resolve, updateInterval));
        iteration++;

        const elapsed = Date.now() - startTime;
        const remaining = maxDuration - elapsed;

        try {
          let hasUpdates = false;
          const timestamp = new Date().toLocaleTimeString();

          if (agentId) {
            const currentStatus = await this.monitoringService.getAgentStatus(agentId);
            
            // Check for status changes
            if (JSON.stringify(currentStatus) !== JSON.stringify(initialStatus)) {
              updates.push(`[${timestamp}] Agent ${agentId} status changed:`);
              
              if (monitoringMode === 'full' || monitoringMode === 'activity') {
                if (currentStatus.currentTask !== (initialStatus as any)?.currentTask) {
                  updates.push(`  Task: ${currentStatus.currentTask?.description || 'None'}`);
                }
                if (currentStatus.status !== (initialStatus as any)?.status) {
                  updates.push(`  Status: ${(initialStatus as any)?.status} → ${currentStatus.status}`);
                }
              }
              
              if (monitoringMode === 'communication' || monitoringMode === 'full') {
                if (currentStatus.recentMessages.length > 0) {
                  updates.push(`  Recent messages: ${currentStatus.recentMessages.length}`);
                  if (detailLevel === 'detailed' || detailLevel === 'verbose') {
                    const latestMessage = currentStatus.recentMessages[0];
                    updates.push(`    Latest: "${latestMessage.message.substring(0, 50)}..."`);
                  }
                }
              }
              
              hasUpdates = true;
              initialStatus = currentStatus;
            }
          } else if (orchestrationId) {
            const currentStatus = await this.monitoringService.getOrchestrationStatus(orchestrationId);
            
            if (JSON.stringify(currentStatus) !== JSON.stringify(initialStatus)) {
              updates.push(`[${timestamp}] Orchestration ${orchestrationId} update:`);
              updates.push(`  Progress: ${currentStatus.progress.toFixed(1)}%`);
              updates.push(`  Active agents: ${currentStatus.activeAgents.length}`);
              
              if (detailLevel === 'detailed' || detailLevel === 'verbose') {
                if (currentStatus.completedTasks.length > (initialStatus as any)?.completedTasks?.length) {
                  updates.push(`  ✅ Tasks completed: ${currentStatus.completedTasks.length}/${currentStatus.totalTasks}`);
                }
                if (currentStatus.failedTasks.length > (initialStatus as any)?.failedTasks?.length) {
                  updates.push(`  ❌ Tasks failed: ${currentStatus.failedTasks.length}`);
                }
              }
              
              hasUpdates = true;
              initialStatus = currentStatus;
            }
          } else if (roomName) {
            const currentStatus = await this.monitoringService.getRoomActivity(roomName);
            
            if (JSON.stringify(currentStatus) !== JSON.stringify(initialStatus)) {
              updates.push(`[${timestamp}] Room ${roomName} update:`);
              updates.push(`  Status: ${currentStatus.coordinationStatus}`);
              
              if (currentStatus.messageCount > (initialStatus as any)?.messageCount) {
                updates.push(`  📨 New messages: ${currentStatus.messageCount - (initialStatus as any)?.messageCount}`);
                if (detailLevel === 'detailed' || detailLevel === 'verbose') {
                  const latestMessage = currentStatus.recentMessages[currentStatus.recentMessages.length - 1];
                  if (latestMessage) {
                    updates.push(`    From ${latestMessage.agentName}: "${latestMessage.message.substring(0, 50)}..."`);
                  }
                }
              }
              
              hasUpdates = true;
              initialStatus = currentStatus;
            }
          } else {
            const currentStatus = await this.monitoringService.getActiveAgents(resolvedPath);
            
            if (JSON.stringify(currentStatus) !== JSON.stringify(initialStatus)) {
              updates.push(`[${timestamp}] Repository agents update:`);
              updates.push(`  Active agents: ${currentStatus.length}`);
              
              if (detailLevel === 'detailed' || detailLevel === 'verbose') {
                const previousCount = Array.isArray(initialStatus) ? initialStatus.length : 0;
                if (currentStatus.length > previousCount) {
                  updates.push(`  📈 New agents: ${currentStatus.length - previousCount}`);
                } else if (currentStatus.length < previousCount) {
                  updates.push(`  📉 Agents terminated: ${previousCount - currentStatus.length}`);
                }
              }
              
              hasUpdates = true;
              initialStatus = currentStatus;
            }
          }

          // Progress indicator
          if (iteration % 5 === 0 || hasUpdates) {
            const progressPercent = Math.min((elapsed / maxDuration) * 100, 100);
            updates.push(`[${timestamp}] ⏱️ Monitoring... ${progressPercent.toFixed(0)}% (${Math.floor(remaining/1000)}s remaining)`);
          }

          // Break if we're approaching timeout
          if (remaining < updateInterval * 1.5) {
            updates.push(`[${timestamp}] ⏰ Approaching timeout, wrapping up...`);
            break;
          }

        } catch (error) {
          errors.push(`[${new Date().toLocaleTimeString()}] Monitoring error: ${error}`);
        }
      }

      // Final status
      updates.push('');
      updates.push('📋 FINAL STATUS:');
      try {
        let finalStatus;
        if (agentId) {
          finalStatus = await this.monitoringService.getAgentStatus(agentId);
          updates.push(`Agent ${agentId}: ${finalStatus.status}`);
          if (finalStatus.currentTask) {
            updates.push(`  Current task: ${finalStatus.currentTask.description}`);
          }
          updates.push(`  Performance: ${finalStatus.performance.tasksCompleted} tasks completed`);
        } else if (orchestrationId) {
          finalStatus = await this.monitoringService.getOrchestrationStatus(orchestrationId);
          updates.push(`Orchestration ${orchestrationId}: ${finalStatus.status}`);
          updates.push(`  Final progress: ${finalStatus.progress.toFixed(1)}%`);
          updates.push(`  Total agents: ${finalStatus.spawnedAgents.length}`);
        } else if (roomName) {
          finalStatus = await this.monitoringService.getRoomActivity(roomName);
          updates.push(`Room ${roomName}: ${finalStatus.coordinationStatus}`);
          updates.push(`  Final message count: ${finalStatus.messageCount}`);
        } else {
          finalStatus = await this.monitoringService.getActiveAgents(resolvedPath);
          updates.push(`Repository ${resolvedPath}: ${finalStatus.length} active agents`);
        }
      } catch (error) {
        errors.push(`Failed to get final status: ${error}`);
      }

      // Summary
      const totalDuration = Date.now() - startTime;
      updates.push('');
      updates.push('📊 MONITORING SUMMARY:');
      updates.push(`  Duration: ${Math.floor(totalDuration/1000)}s`);
      updates.push(`  Updates: ${iteration} iterations`);
      updates.push(`  Errors: ${errors.length}`);
      updates.push(`  Mode: ${monitoringMode} (${detailLevel})`);

      return {
        success: true,
        message: `Agent monitoring completed successfully`,
        data: {
          monitoringMode,
          detailLevel,
          duration: totalDuration,
          iterations: iteration,
          updates: updates.join('\n'),
          errors: errors.length > 0 ? errors.join('\n') : null,
          finalStatus: agentId ? 'Agent monitored' : 
                       orchestrationId ? 'Orchestration monitored' : 
                       roomName ? 'Room monitored' : 'Repository monitored'
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `Failed to monitor agents: ${error}`,
        data: { error: String(error) }
      };
    }
  }
}