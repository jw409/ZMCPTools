#!/bin/bash

echo "🧪 Testing Semantic Search with Vector Store"
echo ""

# First check if LanceDB directory exists
LANCEDB_PATH="$HOME/.mcptools/lancedb"
echo "1. Checking LanceDB directory..."
if [ -d "$LANCEDB_PATH" ]; then
    echo "   ✅ LanceDB directory exists: $LANCEDB_PATH"
    echo "   Contents:"
    ls -la "$LANCEDB_PATH" | head -10
else
    echo "   ⚠️  LanceDB directory not found, will be created on first use"
fi

echo ""
echo "2. Testing MCP tools after restart..."
echo "   Restart Claude Code to load the updated MCP server"
echo ""
echo "3. Then test semantic search with these MCP commands:"
echo ""
echo "   Store a new memory with semantic content:"
echo '   mcp__zmcp-tools__store_knowledge_memory'
echo '   {'
echo '     "repository_path": ".",'
echo '     "agent_id": "semantic-test",'
echo '     "memory_type": "technical_decision",'
echo '     "title": "Vector Database Selection",'
echo '     "content": "Selected LanceDB for vector embeddings because it supports local storage, has excellent performance, and integrates well with HuggingFace transformers for semantic search capabilities"'
echo '   }'
echo ""
echo "   Search semantically for related concepts:"
echo '   mcp__zmcp-tools__search_knowledge_graph'
echo '   {'
echo '     "repository_path": ".",'
echo '     "query": "embedding storage performance requirements",'
echo '     "semantic_search": true,'
echo '     "limit": 10'
echo '   }'
echo ""
echo "Expected: Should find the Vector Database Selection entry with high similarity score"