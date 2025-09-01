#!/bin/bash

echo "🧪 Simple Knowledge Graph Test"
echo ""
echo "This will test the knowledge graph using MCP tools in Claude."
echo ""
echo "Step 1: Store test memory"
echo "Run in Claude:"
echo 'mcp__zmcp-tools__store_knowledge_memory with parameters:'
echo '{'
echo '  "repository_path": ".",'
echo '  "agent_id": "test-agent-kg",'
echo '  "memory_type": "technical_decision",'
echo '  "title": "Database Architecture Decision",'
echo '  "content": "We selected PostgreSQL with JSONB columns for flexible schema evolution and excellent query performance on semi-structured data"'
echo '}'
echo ""
echo "Step 2: Search with basic text matching"
echo 'mcp__zmcp-tools__search_knowledge_graph with parameters:'
echo '{'
echo '  "repository_path": ".",'
echo '  "query": "PostgreSQL",'
echo '  "semantic_search": false,'
echo '  "limit": 10'
echo '}'
echo ""
echo "Step 3: Search with semantic similarity"
echo 'mcp__zmcp-tools__search_knowledge_graph with parameters:'
echo '{'
echo '  "repository_path": ".",'
echo '  "query": "database selection criteria",'
echo '  "semantic_search": true,'
echo '  "limit": 10'
echo '}'
echo ""
echo "Expected results:"
echo "- Basic search should find exact text matches"
echo "- Semantic search should find conceptually similar content"