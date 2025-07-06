#!/bin/bash
# Claude Hook: Memory Operations Monitor
# Triggers after memory-related MCP tool usage

# Get hook data from stdin
HOOK_DATA=$(cat)

# Extract tool name and session info
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.toolName // empty')
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.sessionId // empty')
WORKING_DIR=$(echo "$HOOK_DATA" | jq -r '.workingDirectory // "."')

# Log file path
LOG_DIR="$HOME/.claude/zmcptools/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/memory-operations.log"

# Timestamp
TIMESTAMP=$(date -Iseconds)

case "$TOOL_NAME" in
    "mcp__claude-mcp-orchestration__store_memory")
        echo "[$TIMESTAMP] Memory stored - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        
        # Track memory usage patterns
        MEMORY_COUNT_FILE="$LOG_DIR/memory-count.txt"
        if [[ -f "$MEMORY_COUNT_FILE" ]]; then
            COUNT=$(cat "$MEMORY_COUNT_FILE")
            echo $((COUNT + 1)) > "$MEMORY_COUNT_FILE"
        else
            echo "1" > "$MEMORY_COUNT_FILE"
        fi
        ;;
        
    "mcp__claude-mcp-orchestration__search_memory")
        echo "[$TIMESTAMP] Memory searched - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        
        # Track search patterns
        SEARCH_COUNT_FILE="$LOG_DIR/search-count.txt"
        if [[ -f "$SEARCH_COUNT_FILE" ]]; then
            COUNT=$(cat "$SEARCH_COUNT_FILE")
            echo $((COUNT + 1)) > "$SEARCH_COUNT_FILE"
        else
            echo "1" > "$SEARCH_COUNT_FILE"
        fi
        ;;
esac

# Check for high memory usage patterns (alert if needed)
if [[ -f "$LOG_DIR/memory-count.txt" ]]; then
    MEMORY_OPS=$(cat "$LOG_DIR/memory-count.txt")
    if (( MEMORY_OPS > 0 && MEMORY_OPS % 10 == 0 )); then
        echo "🧠 Memory milestone: $MEMORY_OPS operations logged" >> "$LOG_FILE"
    fi
fi