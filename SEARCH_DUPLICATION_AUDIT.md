# Search Tool/Resource Duplication Audit

**Date**: 2025-10-12
**Issue**: `search_knowledge` tool returns 0 results + violates Resources > Tools architecture
**Root Cause**: Read-only search tools duplicate MCP resources (violates 97% token reduction principle)

## 🔴 Critical Violations

### Architecture Principle (ZMCP_TOOLS_v3.1_LOADED)
> **Resources** (~30 tokens): URI-based read operations
> **Tools** (~200 tokens): Action-based mutations

**READ-ONLY operations must be RESOURCES, not TOOLS.**

---

## 📊 Exact Duplication Matrix

| Tool (200 tokens) | Resource (30 tokens) | Duplication | Action |
|---|---|---|---|
| `search_knowledge` | `vector://search` | 100% | **DELETE TOOL** |
| `list_collections` | `vector://collections` | 100% | **DELETE TOOL** |
| `get_collection_stats` | `vector://status` | Partial (stats subset) | **DELETE TOOL** |
| `index_document` | (none) | N/A - WRITE operation | **KEEP TOOL** ✅ |

---

## 🔍 Evidence

### 1. `search_knowledge` Tool (gpuSearchTools.ts:60-133)

```typescript
{
  name: 'search_knowledge',
  description: 'Search knowledge base using GPU-accelerated embeddings...',
  handler: async (args) => {
    const results = await service.search(query, collection, limit, threshold);
    return { success: true, results };
  }
}
```

**Duplicates**: `vector://search` resource (ResourceManager.ts:944-1019)

```typescript
case "vector://search":
  return await this.getVectorSearch(searchParams);

private async getVectorSearch(searchParams) {
  const results = await this.vectorSearchService.searchSimilar(...);
  return { uri: "vector://search", text: JSON.stringify({ results }) };
}
```

**BOTH call same service method**: `vectorSearchService.search()` / `searchSimilar()`

---

### 2. `list_collections` Tool (gpuSearchTools.ts:173-198)

```typescript
{
  name: 'list_collections',
  description: 'List all available knowledge collections...',
  handler: async () => {
    const collections = await service.listCollections();
    return { success: true, collections };
  }
}
```

**Duplicates**: `vector://collections` resource (ResourceManager.ts:878-942)

```typescript
case "vector://collections":
  return await this.getVectorCollections(searchParams);

private async getVectorCollections(searchParams) {
  const collections = await this.vectorSearchService.listCollections();
  return { uri: "vector://collections", text: JSON.stringify({ collections }) };
}
```

**BOTH call same service method**: `vectorSearchService.listCollections()`

---

### 3. `get_collection_stats` Tool (gpuSearchTools.ts:201-226)

```typescript
{
  name: 'get_collection_stats',
  description: 'Get statistics for a specific collection...',
  handler: async (args) => {
    const stats = await service.getCollectionStats(collection);
    return { success: true, stats };
  }
}
```

**Duplicates**: `vector://status` resource (ResourceManager.ts:1021-1106)

```typescript
case "vector://status":
  return await this.getVectorStatus();

private async getVectorStatus() {
  const collections = await this.vectorSearchService.listCollections();
  // Returns aggregate stats including per-collection counts
}
```

**Partial duplication**: `vector://status` provides overall health + all collection stats

---

## ✅ Valid Tool (KEEP)

### `index_document` Tool (gpuSearchTools.ts:136-170)

```typescript
{
  name: 'index_document',
  description: 'Index a document into GPU vector store...',
  handler: async (args) => {
    const result = await service.addDocuments(collection, documents);
    return { success: result.success };
  }
}
```

**Reason**: WRITE operation (mutates vector store) → Valid tool per architecture

---

## 📉 Token Waste Calculation

Current state:
- 3 read-only tools × 200 tokens = **600 tokens**
- 3 equivalent resources × 30 tokens = **90 tokens**

Waste: **510 tokens per agent invocation**

---

## 🎯 Consolidation Plan

### Phase 1: Deprecate Tools (Immediate)

**Remove from `src/tools/gpuSearchTools.ts`:**
1. ❌ `search_knowledge` → Use `vector://search` resource
2. ❌ `list_collections` → Use `vector://collections` resource
3. ❌ `get_collection_stats` → Use `vector://status` resource

**Keep:**
- ✅ `index_document` (WRITE operation)

### Phase 2: Update Documentation

**Files to update:**
1. `etc/TOOL_LIST.md` - Remove deprecated tools
2. `README.md` - Update examples to use resources
3. `CLAUDE.md` - Emphasize Resources > Tools

### Phase 3: Migration Guide

**Old (tool)**:
```typescript
await callTool('search_knowledge', {
  query: 'embedding service',
  collection: 'documentation',
  limit: 10
});
```

**New (resource)**:
```typescript
await readResource('vector://search?query=embedding+service&collection=documentation&limit=10');
```

**Token savings**: 200 → 30 tokens (85% reduction)

---

## 🐛 Why `search_knowledge` Returned 0 Results

**Root cause**: Tool queries **global collections** (empty), Resources query **project collections** (populated)

**Evidence from embedding_status**:
- Project collections: 6 exist (default, documentation, knowledge_graph, symbol_graph_embeddings, whiteboard_search, zmcptools_benchmark)
- Global collections: 3 exist but **vectors=0** (knowledge_graph_qwen3/gemma3/minilm)

**Tool path**:
```
gpuSearchTools.ts → VectorSearchService.search()
→ queries global LanceDB path (~/.mcptools/lancedb/)
```

**Resource path**:
```
ResourceManager.ts → vectorSearchService.searchSimilar()
→ queries project LanceDB path (var/storage/lancedb/)
```

**Fix**: Remove tool, use resource (already works correctly)

---

## ✅ Verification

**Tested**: BM25 + Symbol Graph indexing works (5,644 docs, 77,140 symbols)

**Confirmed**: `vector://search` resource correctly queries project collections

**Next**: Remove duplicate tools, update docs, commit consolidation

---

**Author**: jw
**Status**: Awaiting approval for tool removal
