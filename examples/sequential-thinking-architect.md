# Sequential Thinking for Architect Agents

This document demonstrates how architect agents can use the sequential thinking MCP server for complex objective decomposition and planning.

## Overview

The sequential thinking integration enables architect agents to:
- Break down complex objectives systematically
- Revise and refine plans as understanding deepens
- Consider alternative approaches and trade-offs
- Make better decisions through structured reasoning

## Basic Sequential Thinking Example

```typescript
// Example: Using sequential thinking for complex feature implementation
const architectAgent = await orchestrate_objective({
  objective: "Implement a real-time chat system with authentication, message history, and file sharing",
  repository_path: ".",
  foundation_session_id: "chat-system-2024"
});

// The architect agent will use sequential thinking like this:
const thinking = await sequential_thinking({
  thought: "Analyzing the chat system requirements: real-time messaging, authentication, message history, and file sharing. This is a complex multi-component system requiring careful architectural planning.",
  nextThoughtNeeded: true,
  thoughtNumber: 1,
  totalThoughts: 8
});

// Continue with iterative thinking...
const thinking2 = await sequential_thinking({
  thought: "Breaking down the system into core components: 1) Authentication service, 2) WebSocket server for real-time messaging, 3) Message persistence layer, 4) File upload/storage service, 5) Frontend chat interface. Each component has specific technical requirements.",
  nextThoughtNeeded: true,
  thoughtNumber: 2,
  totalThoughts: 8
});
```

## Advanced Planning with Branching

```typescript
// Example: Complex architectural decision with multiple paths
const systemDesign = await sequential_thinking({
  thought: "Considering architecture options for the chat system. Option A: Monolithic with WebSocket integration. Option B: Microservices with message broker. Option C: Hybrid with modular monolith.",
  nextThoughtNeeded: true,
  thoughtNumber: 3,
  totalThoughts: 8,
  branchFromThought: 2,
  branchId: "architecture-options"
});

// Exploring Option A in detail
const optionA = await sequential_thinking({
  thought: "Option A Analysis: Monolithic architecture with integrated WebSocket server. Benefits: simpler deployment, easier development, lower complexity. Drawbacks: harder to scale individual components, potential performance bottlenecks.",
  nextThoughtNeeded: true,
  thoughtNumber: 4,
  totalThoughts: 8,
  branchFromThought: 3,
  branchId: "option-a-analysis"
});

// Exploring Option B in detail
const optionB = await sequential_thinking({
  thought: "Option B Analysis: Microservices with message broker (Redis/RabbitMQ). Benefits: independent scaling, technology diversity, fault isolation. Drawbacks: increased complexity, network latency, operational overhead.",
  nextThoughtNeeded: true,
  thoughtNumber: 4,
  totalThoughts: 8,
  branchFromThought: 3,
  branchId: "option-b-analysis"
});
```

## Task Decomposition with Sequential Thinking

```typescript
// Example: Using sequential thinking to create detailed task breakdown
const taskPlanning = await sequential_thinking({
  thought: "Based on the architecture analysis, I need to create a detailed task breakdown. Starting with the authentication service: 1) JWT token system, 2) User registration/login, 3) Session management, 4) Password security. This will be the foundation for other services.",
  nextThoughtNeeded: true,
  thoughtNumber: 5,
  totalThoughts: 8
});

// After thinking, create actual tasks
const authTask = await create_task({
  repository_path: ".",
  task_type: "feature",
  title: "Authentication Service",
  description: "Implement JWT-based authentication with user registration, login, and session management",
  requirements: {
    components: ["JWT tokens", "User registration", "Login system", "Session management"],
    security: ["Password hashing", "Rate limiting", "Input validation"],
    database: ["User table", "Session store", "Migration scripts"]
  }
});

const realtimeTask = await create_task({
  repository_path: ".",
  task_type: "feature", 
  title: "Real-time Messaging",
  description: "Implement WebSocket server for real-time chat messaging",
  requirements: {
    components: ["WebSocket server", "Message routing", "Connection management"],
    dependencies: [authTask.id] // Depends on authentication
  }
});
```

## Risk Assessment and Mitigation

```typescript
// Example: Using sequential thinking for risk analysis
const riskAnalysis = await sequential_thinking({
  thought: "Analyzing potential risks in the chat system implementation. Technical risks: WebSocket connection stability, message delivery guarantees, concurrent user handling. Business risks: scalability requirements, data privacy compliance, system availability.",
  nextThoughtNeeded: true,
  thoughtNumber: 6,
  totalThoughts: 8
});

const mitigationPlanning = await sequential_thinking({
  thought: "Mitigation strategies: 1) Implement connection retry logic and heartbeat mechanism for WebSocket stability, 2) Add message acknowledgment system for delivery guarantees, 3) Use connection pooling and load balancing for concurrent users, 4) Implement proper data encryption and audit logging for privacy compliance.",
  nextThoughtNeeded: true,
  thoughtNumber: 7,
  totalThoughts: 8
});
```

## Agent Coordination Strategy

```typescript
// Example: Planning agent coordination with sequential thinking
const coordinationStrategy = await sequential_thinking({
  thought: "Planning agent coordination strategy. Backend agent will handle authentication and WebSocket server. Frontend agent will create chat interface and real-time UI updates. Database agent will design message persistence and user management. Testing agent will create comprehensive integration tests. Documentation agent will create API docs and user guides.",
  nextThoughtNeeded: false,
  thoughtNumber: 8,
  totalThoughts: 8
});

// Spawn agents based on the thinking results
const backendAgent = await spawn_agent({
  agent_type: "backend",
  repository_path: ".",
  task_description: "Implement authentication service and WebSocket server for real-time messaging",
  capabilities: ["database", "websocket", "authentication"],
  metadata: {
    priority: "high",
    complexity: "medium"
  }
});

const frontendAgent = await spawn_agent({
  agent_type: "frontend",
  repository_path: ".",
  task_description: "Create chat interface with real-time messaging UI",
  depends_on: [backendAgent.id],
  capabilities: ["react", "websocket", "ui"],
  metadata: {
    priority: "high",
    complexity: "medium"
  }
});
```

## Revision and Refinement

```typescript
// Example: Revising previous thoughts based on new information
const revisedThinking = await sequential_thinking({
  thought: "Revising the WebSocket implementation approach. After further analysis, I realize we need to consider horizontal scaling from the beginning. We should implement a Redis-based message broker to handle message distribution across multiple server instances.",
  nextThoughtNeeded: true,
  thoughtNumber: 9,
  totalThoughts: 10,
  isRevision: true,
  revisesThought: 4
});

const scalingStrategy = await sequential_thinking({
  thought: "Updated architecture with Redis message broker: WebSocket servers will publish messages to Redis channels, all connected servers subscribe to relevant channels and broadcast to their clients. This enables horizontal scaling and message persistence during server restarts.",
  nextThoughtNeeded: false,
  thoughtNumber: 10,
  totalThoughts: 10
});
```

## Best Practices

### 1. Start with High-Level Analysis
- Begin with understanding the complete objective
- Identify major components and their relationships
- Consider constraints and requirements

### 2. Use Iterative Refinement
- Start with a rough understanding
- Refine details as thinking progresses
- Revise earlier thoughts when new insights emerge

### 3. Consider Multiple Approaches
- Use branching to explore alternatives
- Compare trade-offs systematically
- Document decision rationale

### 4. Plan for Complexity
- Break down complex objectives into manageable parts
- Consider dependencies between components
- Plan for potential risks and mitigation strategies

### 5. Connect Thinking to Action
- Use thinking results to create concrete tasks
- Assign tasks to appropriate agents
- Coordinate execution based on planned dependencies

## Integration with Agent Orchestration

Sequential thinking integrates seamlessly with the existing agent orchestration system:

```typescript
// Complete workflow example
async function architectComplexFeature(objective: string) {
  // 1. Initial analysis with sequential thinking
  const analysis = await sequential_thinking({
    thought: `Analyzing the objective: ${objective}. Need to understand scope, complexity, and requirements.`,
    nextThoughtNeeded: true,
    thoughtNumber: 1,
    totalThoughts: 5
  });

  // 2. Task decomposition based on thinking
  const tasks = await createTasksFromThinking(analysis);

  // 3. Agent coordination based on task dependencies
  const agents = await spawnAgentsForTasks(tasks);

  // 4. Monitor and adjust based on progress
  const monitoring = await monitorAndAdjust(agents, tasks);

  return {
    analysis,
    tasks,
    agents,
    monitoring
  };
}
```

This integration enables architect agents to make better decisions, create more effective plans, and coordinate more successfully with specialized agents.