# Proposed Hooks System for ClaudeMcpTools

Based on analysis of the existing codebase, here are the current hook implementation patterns and proposed enhancements for a comprehensive hooks system.

## Current Implementation Analysis

### 1. EventBus System (`/home/zach/github/ClaudeMcpTools/src/services/EventBus.ts`)

**Existing Pattern**: Sophisticated event-driven architecture with typed events
- **Event Types**: Agent lifecycle, task updates, communication, orchestration, system events
- **Subscription Model**: Pattern-based filtering, repository-scoped events, one-time listeners
- **Event Flow**: `agent_status_change`, `task_update`, `room_message`, `orchestration_update`

**Key Features**:
```typescript
// Real-time event subscription
eventBus.subscribe('agent_status_change', handler, { repositoryPath: './project' });

// Wait for specific events
await eventBus.waitForEvents(['task_completed', 'agent_terminated']);

// One-time listeners
const result = await eventBus.once('orchestration_update');
```

### 2. Progress Reporting (`/home/zach/github/ClaudeMcpTools/src/tools/ReportProgressTool.ts`)

**Existing Pattern**: Structured progress reporting with event integration
- **Progress Types**: `status`, `task`, `milestone`, `error`, `completion`
- **Auto-Broadcasting**: Integration with agent room communication
- **MCP Compliance**: Validated progress tracking with ProgressTracker service

**Current Hooks**:
```typescript
// Agent completion handling
await this.handleCompletionProgress(report);

// Error progress handling  
await this.handleErrorProgress(report);

// Status change broadcasting
await this.broadcastProgressToRoom(report, agent);
```

### 3. Agent Monitoring (`/home/zach/github/ClaudeMcpTools/src/services/AgentMonitoringService.ts`)

**Existing Pattern**: Real-time agent status tracking with 55-second timeout awareness
- **Status Snapshots**: Comprehensive agent state capture
- **Performance Metrics**: Task completion rates, error tracking, uptime monitoring
- **Coordination Status**: Room activity assessment, blocking detection

### 4. Transport Layer (`/home/zach/github/ClaudeMcpTools/src/server/McpServer.ts`)

**Existing Pattern**: MCP protocol implementation with stdio transport
- **Tool Call Handling**: Pre/post tool execution pipeline
- **Sampling Requests**: Client-server communication for AI sampling
- **Progress Tokens**: Support for progress notifications during tool execution

**Current Hook Points**:
```typescript
// Tool execution pipeline
const result = await this.handleToolCall(name, args, progressContext);

// Sampling request handling
const response = await this.server.request(samplingRequest, CreateMessageRequestSchema);
```

### 5. Process Management (`/home/zach/github/ClaudeMcpTools/src/process/ClaudeSpawner.ts`)

**Existing Pattern**: Claude agent process lifecycle management
- **Process Events**: `exit`, `error`, `stdout`, `stderr`
- **Cleanup Handling**: Graceful shutdown, timeout management, reaper process
- **Event Forwarding**: Process events to parent orchestration system

**Current Lifecycle Hooks**:
```typescript
// Process lifecycle events
claudeProcess.on('exit', ({ code, signal, pid }) => {
  this.emit('process-exit', { pid, code, signal });
});

claudeProcess.on('error', ({ error, pid }) => {
  this.emit('process-error', { pid, error });
});
```

## Proposed Hooks Enhancement

### 1. Claude Code Integration Hooks

Based on the CLAUDE_CODE.md documentation, implement hooks that align with Claude Code's lifecycle:

```typescript
interface ClaudeCodeHooks {
  // Tool execution hooks (align with Claude Code patterns)
  PreToolUse: HookEvent<{
    toolName: string;
    arguments: Record<string, any>;
    context: ToolExecutionContext;
  }>;
  
  PostToolUse: HookEvent<{
    toolName: string;
    arguments: Record<string, any>;
    result: any;
    duration: number;
    context: ToolExecutionContext;
  }>;
  
  // Agent lifecycle hooks
  AgentStart: HookEvent<{
    agentId: string;
    capabilities: string[];
    repositoryPath: string;
    initialPrompt: string;
  }>;
  
  AgentStop: HookEvent<{
    agentId: string;
    exitCode: number | null;
    completedTasks: string[];
    finalStatus: AgentStatus;
  }>;
  
  SubagentStop: HookEvent<{
    parentAgentId: string;
    subagentId: string;
    exitCode: number | null;
    results: Record<string, any>;
  }>;
  
  // User interaction hooks
  UserMessage: HookEvent<{
    message: string;
    sessionId: string;
    timestamp: Date;
    messageType: 'prompt' | 'continuation' | 'command';
  }>;
  
  // Notification hooks
  Notification: HookEvent<{
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
    context: string;
    agentId?: string;
  }>;
}
```

### 2. Hook Matcher System

Implement pattern matching similar to Claude Code's tool permissions:

```typescript
interface HookMatcher {
  // Tool pattern matching
  toolPattern?: string; // e.g., "Bash(git commit*)", "Edit(*.py)"
  
  // Agent pattern matching
  agentType?: string;   // e.g., "backend", "frontend", "testing"
  
  // Repository pattern matching
  repositoryPattern?: string; // e.g., "**/src/**", "*.ts"
  
  // Conditional matching
  condition?: (context: HookContext) => boolean;
}

interface HookDefinition {
  matcher: HookMatcher;
  hooks: HookAction[];
  priority?: number;
  async?: boolean;
}
```

### 3. Hook Actions

Support various hook action types:

```typescript
interface HookAction {
  type: 'command' | 'notification' | 'api' | 'custom';
  
  // Command execution
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  
  // Notification
  notificationType?: 'info' | 'warning' | 'error';
  message?: string;
  
  // API call
  apiEndpoint?: string;
  apiMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  apiPayload?: Record<string, any>;
  
  // Custom function
  customFunction?: (context: HookContext) => Promise<HookResult>;
  
  // Execution options
  timeout?: number;
  retries?: number;
  continueOnError?: boolean;
}
```

### 4. Integration with Existing Systems

#### EventBus Integration
```typescript
class HookManager {
  constructor(private eventBus: EventBus) {
    // Subscribe to existing events for hook triggers
    this.eventBus.subscribe('agent_status_change', this.handleAgentStatusHook.bind(this));
    this.eventBus.subscribe('task_completed', this.handleTaskCompletionHook.bind(this));
    this.eventBus.subscribe('system_error', this.handleErrorHook.bind(this));
  }
  
  private async handleAgentStatusHook(data: any): Promise<void> {
    await this.executeHooks('AgentStatusChange', data);
  }
}
```

#### Progress Reporting Integration
```typescript
// Extend ReportProgressTool to support hooks
class EnhancedReportProgressTool extends ReportProgressTool {
  private hookManager: HookManager;
  
  async reportProgress(options: ReportProgressOptions): Promise<any> {
    // Pre-progress hooks
    await this.hookManager.executeHooks('PreProgress', options);
    
    const result = await super.reportProgress(options);
    
    // Post-progress hooks
    await this.hookManager.executeHooks('PostProgress', { options, result });
    
    return result;
  }
}
```

#### Tool Execution Hooks
```typescript
// Integrate with McpServer tool handling
private async handleToolCall(name: string, args: any, progressContext?: any): Promise<any> {
  const context = {
    toolName: name,
    arguments: args,
    timestamp: new Date(),
    repositoryPath: this.repositoryPath
  };
  
  // Pre-tool hooks
  await this.hookManager.executeHooks('PreToolUse', context);
  
  try {
    const result = await this.executeToolInternal(name, args, progressContext);
    
    // Post-tool hooks (success)
    await this.hookManager.executeHooks('PostToolUse', {
      ...context,
      result,
      success: true
    });
    
    return result;
  } catch (error) {
    // Post-tool hooks (error)
    await this.hookManager.executeHooks('PostToolUse', {
      ...context,
      error,
      success: false
    });
    
    throw error;
  }
}
```

### 5. Configuration Schema

```typescript
interface HooksConfiguration {
  hooks: {
    [K in keyof ClaudeCodeHooks]?: HookDefinition[];
  };
  
  // Global hook settings
  settings: {
    maxConcurrentHooks: number;
    defaultTimeout: number;
    errorHandling: 'abort' | 'continue' | 'retry';
    logging: {
      enabled: boolean;
      level: 'debug' | 'info' | 'warn' | 'error';
      destination: 'file' | 'console' | 'eventbus';
    };
  };
  
  // Environment variables available to hooks
  environment: Record<string, string>;
}
```

### 6. Example Configurations

#### Code Formatting Hook
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": {
          "toolPattern": "Edit(*.py)"
        },
        "hooks": [
          {
            "type": "command",
            "command": "black",
            "args": ["${TOOL_ARG_file_path}"],
            "continueOnError": true
          }
        ]
      }
    ]
  }
}
```

#### Agent Completion Notification
```json
{
  "hooks": {
    "AgentStop": [
      {
        "matcher": {
          "agentType": "testing"
        },
        "hooks": [
          {
            "type": "notification",
            "notificationType": "success",
            "message": "Testing agent completed: ${agentId}"
          },
          {
            "type": "api",
            "apiEndpoint": "https://slack.company.com/webhook",
            "apiMethod": "POST",
            "apiPayload": {
              "text": "Agent ${agentId} completed testing phase"
            }
          }
        ]
      }
    ]
  }
}
```

#### Pre-commit Validation
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": {
          "toolPattern": "Bash(git commit*)"
        },
        "hooks": [
          {
            "type": "command",
            "command": "npm",
            "args": ["run", "lint"],
            "continueOnError": false
          },
          {
            "type": "command", 
            "command": "npm",
            "args": ["test"],
            "continueOnError": false
          }
        ]
      }
    ]
  }
}
```

## Implementation Priority

1. **Phase 1**: Basic hook infrastructure
   - HookManager service
   - EventBus integration
   - Simple command hooks

2. **Phase 2**: Tool execution hooks
   - PreToolUse/PostToolUse implementation
   - Pattern matching system
   - Error handling

3. **Phase 3**: Agent lifecycle hooks
   - AgentStart/AgentStop hooks
   - SubagentStop hooks
   - Progress integration

4. **Phase 4**: Advanced features
   - User message hooks
   - API hooks
   - Custom hook functions

5. **Phase 5**: Claude Code alignment
   - Full compatibility with Claude Code hook patterns
   - Configuration migration tools
   - Documentation updates

## Benefits

1. **Seamless Integration**: Leverages existing EventBus and progress reporting
2. **Claude Code Compatibility**: Aligns with documented hook patterns
3. **Flexible Configuration**: Supports various hook types and matchers
4. **Error Resilience**: Built-in error handling and retry mechanisms
5. **Performance Aware**: Async execution with timeout controls
6. **Debugging Support**: Comprehensive logging and monitoring

This proposed system builds upon the existing robust infrastructure while providing the hook capabilities needed for comprehensive automation and integration workflows.