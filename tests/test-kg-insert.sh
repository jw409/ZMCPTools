#!/bin/bash

echo "🧪 Testing Knowledge Graph Insert with Correct Schema"
echo ""

DB_PATH="$HOME/.mcptools/data/claude_mcp_tools.db"

echo "1. Inserting test knowledge memories..."

# Insert multiple test memories
TEST_ID1="km_test_$(date +%s)_001"
sqlite3 "$DB_PATH" "INSERT INTO knowledge_entities (id, repositoryPath, entityType, name, description, properties) 
VALUES ('$TEST_ID1', '.', 'knowledge_memory', 'PostgreSQL Architecture Decision', 
'Selected PostgreSQL with JSONB for flexible schema and performance', 
'{\"memory_type\":\"technical_decision\",\"agent_id\":\"test-kg\",\"tags\":[\"database\",\"architecture\"]}');"

TEST_ID2="km_test_$(date +%s)_002"
sqlite3 "$DB_PATH" "INSERT INTO knowledge_entities (id, repositoryPath, entityType, name, description, properties) 
VALUES ('$TEST_ID2', '.', 'knowledge_memory', 'React useState Performance Issue', 
'useState with nested objects caused re-render loops. Solution: useReducer', 
'{\"memory_type\":\"error_pattern\",\"agent_id\":\"test-kg\",\"tags\":[\"react\",\"performance\"]}');"

TEST_ID3="km_test_$(date +%s)_003"
sqlite3 "$DB_PATH" "INSERT INTO knowledge_entities (id, repositoryPath, entityType, name, description, properties) 
VALUES ('$TEST_ID3', '.', 'knowledge_memory', 'JWT Authentication Implementation', 
'JWT in httpOnly cookies with CSRF tokens for SPA security', 
'{\"memory_type\":\"implementation_pattern\",\"agent_id\":\"test-kg\",\"tags\":[\"security\",\"authentication\"]}');"

echo "   ✅ Inserted 3 test memories"

echo ""
echo "2. Verifying insertions..."
sqlite3 "$DB_PATH" "SELECT COUNT(*) as new_count FROM knowledge_entities WHERE id LIKE 'km_test_%';"

echo ""
echo "3. Testing basic text search..."
echo "   Query: 'PostgreSQL'"
sqlite3 "$DB_PATH" "SELECT name, description FROM knowledge_entities 
WHERE (name LIKE '%PostgreSQL%' OR description LIKE '%PostgreSQL%') 
AND entityType = 'knowledge_memory';" 2>/dev/null

echo ""
echo "   Query: 'performance'"
sqlite3 "$DB_PATH" "SELECT name, description FROM knowledge_entities 
WHERE (name LIKE '%performance%' OR description LIKE '%performance%') 
AND entityType = 'knowledge_memory';" 2>/dev/null

echo ""
echo "4. Checking all knowledge memories..."
sqlite3 "$DB_PATH" "SELECT id, name FROM knowledge_entities 
WHERE entityType = 'knowledge_memory' 
ORDER BY createdAt DESC LIMIT 10;"

echo ""
echo "5. Testing knowledge graph MCP tools..."
echo "   To test via MCP tools, use these commands in Claude:"
echo ""
echo "   Search basic:"
echo '   mcp__zmcp-tools__search_knowledge_graph'
echo '   {'
echo '     "repository_path": ".",'
echo '     "query": "PostgreSQL",'
echo '     "semantic_search": false'
echo '   }'
echo ""
echo "   Search semantic:"
echo '   mcp__zmcp-tools__search_knowledge_graph'
echo '   {'
echo '     "repository_path": ".",'
echo '     "query": "database selection criteria",'
echo '     "semantic_search": true'
echo '   }'