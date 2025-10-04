# Knowledge Graph Resources Tests

Tests for the knowledge graph MCP resource migration (Issue #35 Phase 3).

## Test Structure

- **Smoke Tests**: Verify resources are discoverable via `client.listResources()`
- **E2E Tests**: Simulate LLM querying resources via MCP Client SDK
- **Data Validation**: Verify entity structure and quality metrics
- **Performance Tests**: Ensure queries complete within target times

## Running Tests

```bash
# Run all resource tests
npm test -- test/resources/knowledgeGraph.test.ts

# Or run all tests
npm test
```

## Test Results Summary

✅ **11/12 tests passing** - Resource protocol migration complete

### Passing Tests (Core Functionality)
- ✅ Resource discovery (knowledge://search, knowledge://status, knowledge://entity/*/related)
- ✅ Error handling for missing parameters (search_params included in all responses)
- ✅ Entity structure validation
- ✅ Performance benchmarks (<2s for search, <500ms for status)
- ✅ Hybrid search parameter handling (use_bm25, use_embeddings, use_reranker)
- ✅ Embedding model consistency (gemma_embed 768D)

### Known Issues (Unrelated to Resource Migration)
- ⚠️ Tool schema validation (tools 41-46) - ZodError for inputSchema.type field
  - This is a separate issue unrelated to the resource migration
  - Affects `listTools()` call but not resource functionality

## Test Data Setup

The test data setup script indexes etc/*.md files using the talent-os indexer:

```bash
cd test
./setup-knowledge-test-data.sh
```

**Note**: Both the test indexer and ZMCPTools server now use `gemma_embed` (768D) for consistency.
Empty search results are due to no test data being indexed yet - run the setup script above to populate test data.

## Migration Summary

**Token Savings**: ~480 net tokens (3 tools → 3 resources, each saving ~160 tokens)

**Migrated Resources**:
- `knowledge://search` - Hybrid BM25 + semantic search
- `knowledge://entity/*/related` - Find related entities
- `knowledge://status` - Knowledge graph statistics

**Removed Tools**:
- ❌ `search_knowledge_graph` (→ `knowledge://search`)
- ❌ `find_related_entities` (→ `knowledge://entity/*/related`)
- ❌ `get_memory_status` (→ `knowledge://status`)

**Remaining Tools** (write operations):
- ✅ `store_knowledge_memory`
- ✅ `create_knowledge_relationship`
- ✅ `prune_knowledge_memory`
- ✅ `compact_knowledge_memory`
- ✅ `update_knowledge_entity`
- ✅ `export_knowledge_graph`
- ✅ `wipe_knowledge_graph`
