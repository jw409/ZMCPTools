#!/bin/bash

# Claude Hooks: Session Start Context Injection
# Reminds Claude about available MCP tools and project resources

# Only inject context once per session
if [[ -z "$CLAUDE_CONTEXT_INJECTED" ]]; then
    echo "🤖 ZMCPTools: Knowledge graph, analysis, browser automation, and plan tools available"
    echo "💡 Core tools: analyze_project_structure(), search_knowledge_graph(), plan creation tools"
    echo "📚 Full guide in CLAUDE.md"
    
    # Mark context as injected for this session
    export CLAUDE_CONTEXT_INJECTED=1
fi

exit 0