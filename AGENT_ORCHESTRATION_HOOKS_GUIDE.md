# Agent Orchestration Hooks Guide

## Overview

This guide outlines beneficial hooks for ClaudeMcpTools agent orchestration, focusing on what's actually implementable with Claude Code's hook system and valuable for multi-agent workflows.

## Available Hook Events for Agent Orchestration

### 1. PreToolUse - MCP Tool Validation
**Pattern**: `mcp__claude-mcp-tools__*`
**Fires**: Before any MCP tool execution
**Can Block**: Yes

### 2. PostToolUse - MCP Tool Analysis
**Pattern**: `mcp__claude-mcp-tools__*`
**Fires**: After MCP tool completion
**Can Block**: No (tool already ran, but can provide feedback)

### 3. Stop - Session Completion
**Pattern**: N/A (no matcher)
**Fires**: When main Claude agent finishes responding
**Can Block**: Yes (can force continuation)

### 4. Notification - System Events
**Pattern**: N/A (no matcher)
**Fires**: Permission requests, idle notifications
**Can Block**: No

## 🎯 Top 3 Recommended Hooks for Agent Orchestration

### Hook 1: Agent Spawn Validation (PreToolUse)
**Event**: `PreToolUse`
**Pattern**: `mcp__claude-mcp-tools__spawn_agent`
**Priority**: HIGH
**Value**: Prevent problematic agent spawns

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__claude-mcp-tools__spawn_agent",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/validate-agent-spawn.py"
          }
        ]
      }
    ]
  }
}
```

**What it does:**
- Validates agent spawn parameters before execution
- Checks resource limits (max concurrent agents)
- Validates repository paths and permissions
- Prevents resource exhaustion
- Can block spawn if conditions aren't met

**Script receives:**
```json
{
  "tool_name": "mcp__claude-mcp-tools__spawn_agent",
  "tool_input": {
    "agent_type": "backend",
    "repository_path": "/path/to/repo",
    "task_description": "...",
    "depends_on": ["agent_123"]
  }
}
```

### Hook 2: Orchestration Monitoring (PostToolUse)
**Event**: `PostToolUse`
**Pattern**: `mcp__claude-mcp-tools__orchestrate_objective`
**Priority**: HIGH
**Value**: Track orchestration outcomes and patterns

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__claude-mcp-tools__orchestrate_objective",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/analyze-orchestration.py"
          }
        ]
      }
    ]
  }
}
```

**What it does:**
- Analyzes orchestration outcomes
- Tracks success/failure patterns
- Stores insights for optimization
- Identifies common workflow bottlenecks
- Provides recommendations for improvement

### Hook 3: Progress Analysis (PostToolUse)
**Event**: `PostToolUse`
**Pattern**: `mcp__claude-mcp-tools__report_progress`
**Priority**: MEDIUM
**Value**: Automatic progress pattern analysis

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__claude-mcp-tools__report_progress",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/analyze-progress.py"
          }
        ]
      }
    ]
  }
}
```

**What it does:**
- Analyzes progress reporting patterns
- Identifies stuck or slow agents
- Tracks completion rates by agent type
- Provides performance insights
- Suggests workflow optimizations

## Additional Useful Hooks

### Session Cleanup (Stop)
**Event**: `Stop`
**Priority**: MEDIUM
**Value**: Automatic cleanup and summary

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command", 
            "command": "/path/to/session-cleanup.py"
          }
        ]
      }
    ]
  }
}
```

**What it does:**
- Cleans up idle/orphaned agents
- Generates session summary
- Stores workflow insights
- Closes unnecessary communication rooms

### Memory Store Validation (PreToolUse)
**Event**: `PreToolUse`
**Pattern**: `mcp__claude-mcp-tools__store_memory`
**Priority**: LOW
**Value**: Prevent duplicate/invalid memory entries

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__claude-mcp-tools__store_memory",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/validate-memory.py"
          }
        ]
      }
    ]
  }
}
```

## What Hooks CAN'T Do for Agent Orchestration

❌ **Agent Lifecycle Events**: No direct agent start/stop hooks
❌ **Real-time Agent Monitoring**: Hooks are event-driven, not continuous
❌ **Inter-Agent Communication**: No hooks for room messages
❌ **Custom Events**: Only 6 predefined Claude Code events
❌ **Agent State Changes**: No hooks for agent status transitions

## Alternative Approaches for Non-Hook Features

### Agent Lifecycle Tracking
Use existing `EventBus` system instead of hooks:
```typescript
this.eventBus.on('agent:spawned', (agentId) => {
  // Handle agent spawn
});
```

### Real-time Monitoring  
Continue using `AgentMonitoringService` with periodic checks

### Inter-Agent Context
Use `store_memory` and `search_memory` tools for context sharing

## Implementation Priority

**Phase 1 (Immediate Value):**
1. Agent Spawn Validation (PreToolUse)
2. Orchestration Monitoring (PostToolUse)

**Phase 2 (Enhanced Workflow):**
1. Progress Analysis (PostToolUse)
2. Session Cleanup (Stop)

**Phase 3 (Quality Improvements):**
1. Memory Store Validation (PreToolUse)
2. Additional validation hooks

## Sample Hook Scripts

### validate-agent-spawn.py
```python
#!/usr/bin/env python3
import json
import sys
import os

data = json.load(sys.stdin)
tool_input = data.get('tool_input', {})

# Check concurrent agent limit
max_agents = 10
# current_agents = get_active_agents_count()
# if current_agents >= max_agents:
#     print(f"Too many agents running ({current_agents}/{max_agents})", file=sys.stderr)
#     sys.exit(2)  # Block the spawn

# Validate repository path
repo_path = tool_input.get('repository_path')
if not os.path.exists(repo_path):
    print(f"Repository path does not exist: {repo_path}", file=sys.stderr)
    sys.exit(2)  # Block the spawn

print("Agent spawn validation passed")
sys.exit(0)
```

### analyze-orchestration.py
```python
#!/usr/bin/env python3
import json
import sys
from datetime import datetime

data = json.load(sys.stdin)
tool_response = data.get('tool_response', {})

# Log orchestration completion
log_entry = {
    "timestamp": datetime.now().isoformat(),
    "session_id": data.get('session_id'),
    "success": tool_response.get('success', False),
    "agent_count": len(tool_response.get('spawned_agents', [])),
    "objective": data.get('tool_input', {}).get('objective', '')
}

# Append to orchestration log
with open(os.path.expanduser('~/.mcptools/orchestration-log.jsonl'), 'a') as f:
    f.write(json.dumps(log_entry) + '\n')

print(f"Logged orchestration: {log_entry['agent_count']} agents spawned")
sys.exit(0)
```

## Benefits of This Hook System

1. **Proactive Quality Control**: Prevent problems before they occur
2. **Automatic Insights**: Learn from workflow patterns without manual analysis  
3. **Resource Management**: Prevent resource exhaustion and conflicts
4. **Performance Tracking**: Identify optimization opportunities
5. **Workflow Automation**: Reduce manual oversight and cleanup tasks

## Integration with Existing Systems

These hooks complement (don't replace) existing ClaudeMcpTools features:
- **EventBus**: Still used for internal agent communication
- **AgentMonitoringService**: Still used for real-time monitoring
- **Shared Memory**: Still used for inter-agent context
- **Progress Reporting**: Enhanced by hooks, not replaced

The hooks provide an additional layer of automation and quality control specifically for Claude Code integration.