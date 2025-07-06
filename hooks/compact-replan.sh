#!/bin/bash
# Claude Hook: Compaction Detection and Auto-Replan
# Triggers on SubagentStop to detect compaction and auto-replan

# Get hook data from stdin
HOOK_DATA=$(cat)

# Extract session info
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.sessionId // empty')
WORKING_DIR=$(echo "$HOOK_DATA" | jq -r '.workingDirectory // "."')
EVENT_TYPE=$(echo "$HOOK_DATA" | jq -r '.eventType // empty')

# Log file path
LOG_DIR="$HOME/.claude/zmcptools/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/compaction-replan.log"

# Timestamp
TIMESTAMP=$(date -Iseconds)

# Only process SubagentStop events
if [[ "$EVENT_TYPE" != "SubagentStop" ]]; then
    exit 0
fi

echo "[$TIMESTAMP] SubagentStop detected - Session: $SESSION_ID, Dir: $WORKING_DIR" >> "$LOG_FILE"

# Check if this looks like a compaction event
# Heuristics: Look for signs of context compaction
COMPACTION_INDICATORS=(
    "context"
    "compact"
    "summariz"
    "length"
    "token"
    "limit"
)

# Check recent conversation for compaction indicators
CONVERSATION_CHECK=false
for indicator in "${COMPACTION_INDICATORS[@]}"; do
    if echo "$HOOK_DATA" | grep -qi "$indicator"; then
        COMPACTION_CHECK=true
        echo "[$TIMESTAMP] Compaction indicator found: $indicator" >> "$LOG_FILE"
        break
    fi
done

# Track conversation context patterns
CONTEXT_TRACK_FILE="$LOG_DIR/context-tracking.txt"
echo "$TIMESTAMP|$SESSION_ID|SubagentStop" >> "$CONTEXT_TRACK_FILE"

# Count recent SubagentStop events (if many, might indicate compaction)
RECENT_STOPS=$(tail -n 10 "$CONTEXT_TRACK_FILE" | grep "SubagentStop" | wc -l)

# Auto-replan if compaction likely occurred
if [[ "$COMPACTION_CHECK" == "true" ]] || [[ $RECENT_STOPS -gt 3 ]]; then
    echo "[$TIMESTAMP] Compaction detected, triggering auto-replan..." >> "$LOG_FILE"
    
    # Create a replan prompt for Claude
    REPLAN_PROMPT="Based on the current conversation context after compaction, please use TodoWrite to create an updated task plan that reflects our current progress and next steps. Review what has been completed and what still needs to be done."
    
    # Log the replan trigger
    echo "[$TIMESTAMP] Auto-replan triggered for session $SESSION_ID" >> "$LOG_FILE"
    
    # The replan will be handled by Claude naturally through the prompt
    # We don't directly execute tools, but we signal the need for replanning
    
    # Create a marker file for the next hook to detect
    REPLAN_MARKER="$LOG_DIR/replan-needed-$SESSION_ID.marker"
    echo "$TIMESTAMP|$WORKING_DIR|$REPLAN_PROMPT" > "$REPLAN_MARKER"
    
    echo "[$TIMESTAMP] Replan marker created: $REPLAN_MARKER" >> "$LOG_FILE"
fi

# Cleanup old markers (older than 1 hour)
find "$LOG_DIR" -name "replan-needed-*.marker" -mmin +60 -delete 2>/dev/null

echo "[$TIMESTAMP] Compact-replan hook completed" >> "$LOG_FILE"