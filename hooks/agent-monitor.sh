#!/bin/bash
# Claude Hook: Agent Orchestration Monitor
# Triggers after agent-related MCP tool usage

# Get hook data from stdin
HOOK_DATA=$(cat)

# Extract tool name and session info
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.toolName // empty')
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.sessionId // empty')
WORKING_DIR=$(echo "$HOOK_DATA" | jq -r '.workingDirectory // "."')

# Log file path
LOG_DIR="$HOME/.claude/zmcptools/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/agent-operations.log"

# Timestamp
TIMESTAMP=$(date -Iseconds)

case "$TOOL_NAME" in
    "mcp__claude-mcp-orchestration__spawn_agent")
        echo "[$TIMESTAMP] Agent spawned - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        
        # Track active agent count
        AGENT_COUNT_FILE="$LOG_DIR/active-agents.txt"
        if [[ -f "$AGENT_COUNT_FILE" ]]; then
            COUNT=$(cat "$AGENT_COUNT_FILE")
            echo $((COUNT + 1)) > "$AGENT_COUNT_FILE"
        else
            echo "1" > "$AGENT_COUNT_FILE"
        fi
        ;;
        
    "mcp__claude-mcp-orchestration__spawn_agents_batch")
        echo "[$TIMESTAMP] Agent batch spawned - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        ;;
        
    "mcp__claude-mcp-orchestration__orchestrate_objective")
        echo "[$TIMESTAMP] Objective orchestration started - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        
        # Mark orchestration session
        ORCHESTRATION_FILE="$LOG_DIR/orchestration-active.txt"
        echo "$TIMESTAMP|$SESSION_ID|$WORKING_DIR" > "$ORCHESTRATION_FILE"
        ;;
        
    "mcp__claude-mcp-orchestration__terminate_agent")
        echo "[$TIMESTAMP] Agent terminated - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        
        # Decrease active agent count
        AGENT_COUNT_FILE="$LOG_DIR/active-agents.txt"
        if [[ -f "$AGENT_COUNT_FILE" ]]; then
            COUNT=$(cat "$AGENT_COUNT_FILE")
            if (( COUNT > 0 )); then
                echo $((COUNT - 1)) > "$AGENT_COUNT_FILE"
            fi
        fi
        ;;
        
    "mcp__claude-mcp-orchestration__list_agents")
        echo "[$TIMESTAMP] Agents listed - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        ;;
        
    "mcp__claude-mcp-orchestration__get_agent_status")
        echo "[$TIMESTAMP] Agent status checked - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        ;;
esac

# Alert on high agent activity
if [[ -f "$LOG_DIR/active-agents.txt" ]]; then
    ACTIVE_COUNT=$(cat "$LOG_DIR/active-agents.txt")
    if (( ACTIVE_COUNT >= 5 )); then
        echo "⚠️  High agent activity: $ACTIVE_COUNT active agents" >> "$LOG_FILE"
    fi
fi