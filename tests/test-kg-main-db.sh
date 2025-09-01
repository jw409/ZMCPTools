#!/bin/bash

echo "🧪 Testing Knowledge Graph in Main Database"
echo ""

DB_PATH="$HOME/.mcptools/data/claude_mcp_tools.db"

echo "1. Checking knowledge_entities table..."
echo "   Schema:"
sqlite3 "$DB_PATH" ".schema knowledge_entities" | head -20

echo ""
echo "2. Current entries:"
COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM knowledge_entities;" 2>/dev/null)
echo "   Total entries: $COUNT"

if [ "$COUNT" -gt 0 ]; then
    echo "   Recent entries:"
    sqlite3 "$DB_PATH" "SELECT id, entity_type, name, created_at FROM knowledge_entities ORDER BY created_at DESC LIMIT 5;" 2>/dev/null
fi

echo ""
echo "3. Inserting test knowledge memory..."
TEST_ID="km_test_$(date +%s)_$(openssl rand -hex 4)"
sqlite3 "$DB_PATH" "INSERT INTO knowledge_entities (id, repository_path, entity_type, name, description, metadata, created_at, updated_at) 
VALUES ('$TEST_ID', '.', 'knowledge_memory', 'PostgreSQL Decision', 'Selected PostgreSQL for JSONB support and performance', '{\"memory_type\":\"technical_decision\",\"agent_id\":\"test-cli\"}', datetime('now'), datetime('now'));" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "   ✅ Inserted test memory with ID: $TEST_ID"
else
    echo "   ❌ Failed to insert test memory"
fi

echo ""
echo "4. Testing basic search..."
echo "   Searching for 'PostgreSQL':"
sqlite3 "$DB_PATH" "SELECT id, name, description FROM knowledge_entities WHERE name LIKE '%PostgreSQL%' OR description LIKE '%PostgreSQL%';" 2>/dev/null

echo ""
echo "5. Checking relationships table..."
sqlite3 "$DB_PATH" ".schema knowledge_relationships" | head -10

echo ""
echo "6. Checking insights table..."
sqlite3 "$DB_PATH" ".schema knowledge_insights" | head -10