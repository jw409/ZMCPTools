#!/bin/bash
# Claude Hook: Documentation Operations Monitor
# Triggers after documentation-related MCP tool usage

# Get hook data from stdin
HOOK_DATA=$(cat)

# Extract tool name and session info
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.toolName // empty')
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.sessionId // empty')
WORKING_DIR=$(echo "$HOOK_DATA" | jq -r '.workingDirectory // "."')

# Log file path
LOG_DIR="$HOME/.claude/zmcptools/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/docs-operations.log"

# Timestamp
TIMESTAMP=$(date -Iseconds)

case "$TOOL_NAME" in
    "mcp__claude-mcp-orchestration__scrape_documentation")
        echo "[$TIMESTAMP] Documentation scraped - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        
        # Track scraping activity
        SCRAPE_COUNT_FILE="$LOG_DIR/scrape-count.txt"
        if [[ -f "$SCRAPE_COUNT_FILE" ]]; then
            COUNT=$(cat "$SCRAPE_COUNT_FILE")
            echo $((COUNT + 1)) > "$SCRAPE_COUNT_FILE"
        else
            echo "1" > "$SCRAPE_COUNT_FILE"
        fi
        ;;
        
    "mcp__claude-mcp-orchestration__search_documentation")
        echo "[$TIMESTAMP] Documentation searched - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        
        # Track search patterns
        DOC_SEARCH_COUNT_FILE="$LOG_DIR/doc-search-count.txt"
        if [[ -f "$DOC_SEARCH_COUNT_FILE" ]]; then
            COUNT=$(cat "$DOC_SEARCH_COUNT_FILE")
            echo $((COUNT + 1)) > "$DOC_SEARCH_COUNT_FILE"
        else
            echo "1" > "$DOC_SEARCH_COUNT_FILE"
        fi
        ;;
        
    "mcp__claude-mcp-orchestration__update_documentation")
        echo "[$TIMESTAMP] Documentation updated - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        ;;
        
    "mcp__claude-mcp-orchestration__analyze_documentation_changes")
        echo "[$TIMESTAMP] Documentation changes analyzed - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        ;;
        
    "mcp__claude-mcp-orchestration__link_docs_to_code")
        echo "[$TIMESTAMP] Documentation linked to code - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"
        
        # Track documentation-code linking activity
        LINK_COUNT_FILE="$LOG_DIR/doc-link-count.txt"
        if [[ -f "$LINK_COUNT_FILE" ]]; then
            COUNT=$(cat "$LINK_COUNT_FILE")
            echo $((COUNT + 1)) > "$LINK_COUNT_FILE"
        else
            echo "1" > "$LINK_COUNT_FILE"
        fi
        ;;
esac

# Check for high documentation usage (suggest caching strategies)
if [[ -f "$LOG_DIR/doc-search-count.txt" ]]; then
    SEARCH_OPS=$(cat "$LOG_DIR/doc-search-count.txt")
    if (( SEARCH_OPS > 0 && SEARCH_OPS % 5 == 0 )); then
        echo "📚 Documentation milestone: $SEARCH_OPS searches performed" >> "$LOG_FILE"
    fi
fi

# Track documentation health
DOC_HEALTH_FILE="$LOG_DIR/docs-health.txt"
TOTAL_SCRAPES=$(cat "$LOG_DIR/scrape-count.txt" 2>/dev/null || echo "0")
TOTAL_SEARCHES=$(cat "$LOG_DIR/doc-search-count.txt" 2>/dev/null || echo "0")
TOTAL_LINKS=$(cat "$LOG_DIR/doc-link-count.txt" 2>/dev/null || echo "0")

echo "$TIMESTAMP|scrapes:$TOTAL_SCRAPES|searches:$TOTAL_SEARCHES|links:$TOTAL_LINKS" >> "$DOC_HEALTH_FILE"