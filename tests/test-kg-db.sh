#!/bin/bash

echo "🧪 Testing Knowledge Graph Database Directly"
echo ""

DB_PATH="$HOME/.mcptools/data/knowledge_graph.db"
VECTOR_PATH="$HOME/.mcptools/data/vector_store"

echo "1. Checking if database exists..."
if [ -f "$DB_PATH" ]; then
    echo "   ✅ Database found at: $DB_PATH"
    echo "   Size: $(ls -lh "$DB_PATH" | awk '{print $5}')"
else
    echo "   ❌ Database not found at: $DB_PATH"
fi

echo ""
echo "2. Checking vector store..."
if [ -d "$VECTOR_PATH" ]; then
    echo "   ✅ Vector store found at: $VECTOR_PATH"
    echo "   Contents:"
    ls -la "$VECTOR_PATH" | head -10
else
    echo "   ❌ Vector store not found at: $VECTOR_PATH"
fi

echo ""
echo "3. Checking database tables..."
if [ -f "$DB_PATH" ]; then
    sqlite3 "$DB_PATH" ".tables" 2>/dev/null || echo "   Error reading database"
fi

echo ""
echo "4. Checking knowledge_entities table..."
if [ -f "$DB_PATH" ]; then
    echo "   Table schema:"
    sqlite3 "$DB_PATH" ".schema knowledge_entities" 2>/dev/null | head -20
    
    echo ""
    echo "   Row count:"
    sqlite3 "$DB_PATH" "SELECT COUNT(*) as count FROM knowledge_entities;" 2>/dev/null || echo "   Error querying table"
    
    echo ""
    echo "   Sample entries:"
    sqlite3 "$DB_PATH" "SELECT id, name, entity_type, created_at FROM knowledge_entities LIMIT 5;" 2>/dev/null || echo "   No entries found"
fi

echo ""
echo "5. Testing direct insert..."
sqlite3 "$DB_PATH" "INSERT INTO knowledge_entities (id, repository_path, entity_type, name, description, metadata, created_at, updated_at) 
VALUES ('test-kg-' || hex(randomblob(4)), '.', 'knowledge_memory', 'Test Memory', 'This is a test knowledge memory entry', '{}', datetime('now'), datetime('now'));" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "   ✅ Test insert successful"
    
    echo "   Searching for test entry:"
    sqlite3 "$DB_PATH" "SELECT id, name FROM knowledge_entities WHERE name LIKE '%Test Memory%';" 2>/dev/null
else
    echo "   ❌ Test insert failed"
fi