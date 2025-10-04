#!/bin/bash
# Setup test data for knowledge graph resource tests
# Uses existing TalentOS indexer to populate knowledge graph with etc/*.md files

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TALENT_OS_ROOT="$(cd "$PROJECT_ROOT/../talent-os" && pwd)"

echo "🔧 Setting up knowledge graph test data..."
echo "  Project root: $PROJECT_ROOT"
echo "  TalentOS root: $TALENT_OS_ROOT"

# Step 1: Verify embedding service is running
echo ""
echo "📡 Step 1: Checking embedding service (port 8765)..."
if ! curl -s http://localhost:8765/health > /dev/null 2>&1; then
    echo "❌ Embedding service not running on port 8765"
    echo "   Start it with: cd $TALENT_OS_ROOT && uv run python bin/start_embedding_service.py"
    exit 1
fi
echo "✅ Embedding service is healthy"

# Step 2: Index etc/*.md files into knowledge graph
echo ""
echo "📚 Step 2: Indexing etc/*.md files into knowledge graph..."
echo "  Files to index:"
cd "$PROJECT_ROOT/.."
find etc -name "*.md" -type f | head -10

# Use existing comprehensive indexer but only for etc/ directory
echo ""
echo "  Running knowledge indexer..."
cd "$TALENT_OS_ROOT"
uv run python bin/index_knowledge_comprehensive.py \
    --paths "$PROJECT_ROOT/../etc" \
    --repo-path "$PROJECT_ROOT" \
    --skip-github \
    2>&1 | tee /tmp/knowledge-test-index.log || true

# Step 3: Verify data was indexed
echo ""
echo "🔍 Step 3: Verifying indexed data..."
ENTITY_COUNT=$(sqlite3 "$PROJECT_ROOT/var/storage/sqlite/coordination.db" \
    "SELECT COUNT(*) FROM knowledge_entities WHERE entity_type='documentation'" 2>/dev/null || echo "0")

echo "  Indexed entities: $ENTITY_COUNT"

if [ "$ENTITY_COUNT" -gt "0" ]; then
    echo "✅ Test data setup complete"
    echo ""
    echo "📊 Sample entities:"
    sqlite3 "$PROJECT_ROOT/var/storage/sqlite/coordination.db" \
        "SELECT entity_type, name FROM knowledge_entities LIMIT 5" 2>/dev/null || true
else
    echo "⚠️  No entities indexed - tests may fail"
fi

echo ""
echo "🎯 Ready to run tests:"
echo "  npm test -- test/resources/knowledgeGraph.test.ts"
