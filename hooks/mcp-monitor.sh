#!/bin/bash
# Claude Hook: General MCP Tools Monitor
# Triggers after any ClaudeMcpTools MCP tool usage for central logging and metrics

# Get hook data from stdin
HOOK_DATA=$(cat)

# Extract tool name and session info
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.toolName // empty')
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.sessionId // empty')
WORKING_DIR=$(echo "$HOOK_DATA" | jq -r '.workingDirectory // "."')
EXIT_CODE=$(echo "$HOOK_DATA" | jq -r '.exitCode // 0')

# Only process our MCP tools
if [[ "$TOOL_NAME" != mcp__claude-mcp-orchestration__* ]]; then
    exit 0
fi

# Log file path
LOG_DIR="$HOME/.claude/zmcptools/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/mcp-tools-usage.log"
METRICS_FILE="$LOG_DIR/mcp-metrics.json"

# Timestamp
TIMESTAMP=$(date -Iseconds)

# Log the tool usage
echo "[$TIMESTAMP] MCP Tool: $TOOL_NAME | Session: $SESSION_ID | Exit: $EXIT_CODE | Dir: $WORKING_DIR" >> "$LOG_FILE"

# Extract tool category and name
TOOL_CATEGORY=""
TOOL_SHORT_NAME=""

case "$TOOL_NAME" in
    *__spawn_agent*|*__orchestrate_objective*|*__list_agents*|*__terminate_agent*)
        TOOL_CATEGORY="agents"
        TOOL_SHORT_NAME=$(echo "$TOOL_NAME" | sed 's/.*__//')
        ;;
    *__store_memory*|*__search_memory*|*__log_*|*__get_*learning*|*__get_*error*)
        TOOL_CATEGORY="memory"
        TOOL_SHORT_NAME=$(echo "$TOOL_NAME" | sed 's/.*__//')
        ;;
    *__scrape_documentation*|*__search_documentation*|*__link_docs*|*__analyze_documentation*)
        TOOL_CATEGORY="documentation"
        TOOL_SHORT_NAME=$(echo "$TOOL_NAME" | sed 's/.*__//')
        ;;
    *__create_task*|*__assign_task*|*__list_tasks*|*__workflow*)
        TOOL_CATEGORY="tasks"
        TOOL_SHORT_NAME=$(echo "$TOOL_NAME" | sed 's/.*__//')
        ;;
    *__list_files*|*__find_files*|*__easy_replace*|*__take_screenshot*)
        TOOL_CATEGORY="files"
        TOOL_SHORT_NAME=$(echo "$TOOL_NAME" | sed 's/.*__//')
        ;;
    *__analyze_project*|*__generate_project*|*__detect_dead*)
        TOOL_CATEGORY="analysis"
        TOOL_SHORT_NAME=$(echo "$TOOL_NAME" | sed 's/.*__//')
        ;;
    *)
        TOOL_CATEGORY="other"
        TOOL_SHORT_NAME=$(echo "$TOOL_NAME" | sed 's/.*__//')
        ;;
esac

# Update metrics
if [[ -f "$METRICS_FILE" ]]; then
    METRICS=$(cat "$METRICS_FILE")
else
    METRICS="{}"
fi

# Update category count
CATEGORY_COUNT=$(echo "$METRICS" | jq -r ".categories.$TOOL_CATEGORY // 0")
UPDATED_METRICS=$(echo "$METRICS" | jq ".categories.$TOOL_CATEGORY = $((CATEGORY_COUNT + 1))")

# Update tool-specific count
TOOL_COUNT=$(echo "$UPDATED_METRICS" | jq -r ".tools[\"$TOOL_SHORT_NAME\"] // 0")
FINAL_METRICS=$(echo "$UPDATED_METRICS" | jq ".tools[\"$TOOL_SHORT_NAME\"] = $((TOOL_COUNT + 1))")

# Update last used timestamp
FINAL_METRICS=$(echo "$FINAL_METRICS" | jq ".last_updated = \"$TIMESTAMP\"")

# Track errors
if [[ "$EXIT_CODE" != "0" ]]; then
    ERROR_COUNT=$(echo "$FINAL_METRICS" | jq -r ".errors // 0")
    FINAL_METRICS=$(echo "$FINAL_METRICS" | jq ".errors = $((ERROR_COUNT + 1))")
    echo "[$TIMESTAMP] ERROR: Tool $TOOL_SHORT_NAME failed with exit code $EXIT_CODE" >> "$LOG_FILE"
fi

# Save updated metrics
echo "$FINAL_METRICS" > "$METRICS_FILE"

# Performance tracking
DAILY_LOG="$LOG_DIR/daily-usage-$(date +%Y-%m-%d).log"
echo "$TIMESTAMP|$TOOL_CATEGORY|$TOOL_SHORT_NAME|$EXIT_CODE" >> "$DAILY_LOG"

# Alert on high usage patterns
RECENT_USAGE=$(tail -n 20 "$LOG_FILE" | wc -l)
if (( RECENT_USAGE >= 15 )); then
    echo "[$TIMESTAMP] ⚡ High MCP tool activity: $RECENT_USAGE recent operations" >> "$LOG_FILE"
fi

# Cleanup old daily logs (keep last 7 days)
find "$LOG_DIR" -name "daily-usage-*.log" -mtime +7 -delete 2>/dev/null