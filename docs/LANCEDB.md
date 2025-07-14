# LanceDB Vector Database Integration

ZMCPTools includes native LanceDB integration for high-performance vector search and semantic analysis. This document covers setup, configuration, and usage of the vector database features.

## Overview

LanceDB provides native TypeScript vector database capabilities with:
- **Local Storage**: All data stored locally at `~/.mcptools/lancedb/`
- **No Python Dependencies**: Pure TypeScript implementation  
- **High Performance**: Optimized for fast similarity search
- **Multi-Provider Embeddings**: Support for OpenAI, HuggingFace, and local models
- **Rust-Backed Performance**: Uses @lancedb/lancedb (Rust-based) for maximum performance
- **Migration Support**: Easy table recreation with overwrite mode

## Quick Start

### Basic Usage

```typescript
// Create a vector collection
await create_vector_collection("docs", "openai");

// Add documents with automatic embedding
await add_documents_to_collection("docs", [
  { id: "doc1", content: "TypeScript is a typed superset of JavaScript" },
  { id: "doc2", content: "LanceDB provides high-performance vector storage" }
]);

// Search for similar content
const results = await search_vectors("docs", "JavaScript typing", {
  limit: 5,
  similarity_threshold: 0.8
});
```

### Documentation Intelligence

```typescript
// Scrape docs with automatic LanceDB indexing
await scrape_documentation("https://docs.typescript.org", {
  crawl_depth: 2,
  embedding_provider: "openai",
  collection_name: "typescript-docs"
});

// Search scraped documentation
const relevant = await search_documentation_vectors("typescript interfaces", {
  collection: "typescript-docs",
  limit: 10
});
```

## Embedding Providers

### OpenAI Embeddings

**Recommended for production use**

```typescript
await manage_embeddings("openai", {
  apiKey: "your-openai-api-key",
  model: "text-embedding-3-small" // or text-embedding-3-large
});
```

**Features:**
- High quality embeddings
- Fast inference
- Good multilingual support
- Requires OpenAI API key

### HuggingFace Embeddings

**Good for specialized domains**

```typescript
await manage_embeddings("huggingface", {
  model: "sentence-transformers/all-MiniLM-L6-v2",
  apiKey: "your-hf-token" // optional for public models
});
```

**Features:**
- Many specialized models available
- Free for public models
- Can run locally or via API
- Good for domain-specific tasks

### Local Embeddings

**Best for privacy and offline use**

```typescript
await manage_embeddings("local", {
  model: "all-MiniLM-L6-v2" // Default local model
});
```

**Features:**
- Complete privacy - no API calls
- Works offline
- No API costs
- Lower quality than OpenAI

## Configuration

### Environment Variables

```bash
# OpenAI configuration
OPENAI_API_KEY=your-api-key

# HuggingFace configuration
HUGGINGFACE_API_KEY=your-token

# LanceDB configuration
LANCEDB_PATH=~/.mcptools/lancedb/
LANCEDB_VECTOR_SIZE=1536  # For OpenAI embeddings
```

### Configuration File

Create `~/.mcptools/config/vector.json`:

```json
{
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "model": "text-embedding-3-small",
      "apiKey": "${OPENAI_API_KEY}"
    },
    "huggingface": {
      "model": "sentence-transformers/all-MiniLM-L6-v2",
      "apiKey": "${HUGGINGFACE_API_KEY}"
    },
    "local": {
      "model": "all-MiniLM-L6-v2"
    }
  },
  "collections": {
    "documentation": {
      "provider": "openai",
      "description": "Scraped technical documentation"
    },
    "code-analysis": {
      "provider": "huggingface", 
      "description": "Code symbols and analysis results"
    }
  }
}
```

## Advanced Usage

### Multi-Collection Search

```typescript
// Search across multiple collections
const collections = ["typescript-docs", "react-docs", "node-docs"];
const results = await Promise.all(
  collections.map(collection => 
    search_vectors(collection, query, { limit: 3 })
  )
);
```

### Collection Management

```typescript
// List all collections
const collections = await list_vector_collections();

// Get collection statistics
const stats = await get_collection_stats("docs");
console.log(`Collection has ${stats.count} documents`);

// Delete collection
await delete_vector_collection("old-docs");
```

### Performance Optimization

```typescript
// Batch document additions
const docs = generateLargeDocumentSet();
const batchSize = 100;

for (let i = 0; i < docs.length; i += batchSize) {
  const batch = docs.slice(i, i + batchSize);
  await add_documents_to_collection("large-collection", batch);
}
```

## Integration Examples

### With Agent Orchestration

```typescript
// Use vector search in multi-agent workflows
await orchestrate_objective({
  objective: "Research TypeScript best practices and implement them",
  repository_path: ".",
  preparation: [
    "scrape_documentation('https://www.typescriptlang.org/docs/', { embedding_provider: 'openai' })",
    "create_vector_collection('project-context', 'openai')"
  ]
});
```

### With Documentation Intelligence

```typescript
// Enhanced documentation workflow
await scrape_documentation("https://docs.anthropic.com", {
  crawl_depth: 3,
  embedding_provider: "openai",
  collection_name: "anthropic-docs",
  selectors: {
    content: "main article",
    title: "h1, h2"
  }
});

// Search for implementation guidance
const guidance = await search_documentation_vectors(
  "MCP server implementation patterns",
  { 
    collection: "anthropic-docs",
    similarity_threshold: 0.85 
  }
);
```

## Storage and Data

### Data Organization

```
~/.mcptools/
├── lancedb/                 # LanceDB vector storage
│   ├── docs.lance/         # Collection directories (Rust-based)
│   ├── code-analysis.lance/
│   ├── knowledge_graph.lance/
│   └── metadata.json       # Collection metadata
├── data/                   # SQLite databases
│   └── claude_mcp_tools.db
└── config/                 # Configuration files
    └── vector.json
```

### Migration and Table Management

LanceDB supports table recreation with overwrite mode:

```typescript
// Recreate table with new schema
await db.createTable("my_table", data, { mode: "overwrite" });

// This replaces the old table completely
// Useful for schema changes or corrupted collections
```

### Backup and Migration

```bash
# Backup vector database
tar -czf lancedb-backup.tar.gz ~/.mcptools/lancedb/

# Restore from backup
tar -xzf lancedb-backup.tar.gz -C ~/

# Clean slate - remove all collections
rm -rf ~/.mcptools/lancedb/
# Collections will be automatically recreated
```

## Troubleshooting

### Common Issues

1. **"Collection not found"**
   ```typescript
   // Ensure collection exists
   await create_vector_collection("missing-collection", "openai");
   ```

2. **"Embedding provider not configured"**
   ```typescript
   // Configure provider first
   await manage_embeddings("openai", { apiKey: "your-key" });
   ```

3. **"Low similarity scores"**
   - Try different embedding providers
   - Adjust similarity threshold
   - Check query text quality

4. **"internal error: entered unreachable code" (Rust panic)**
   ```typescript
   // Recreate corrupted collection
   await db.createTable("corrupted_collection", data, { mode: "overwrite" });
   
   // Or delete and recreate
   rm -rf ~/.mcptools/lancedb/corrupted_collection.lance/
   ```

5. **"Failed to create collection"**
   - Check disk space
   - Verify permissions on `~/.mcptools/lancedb/`
   - Try recreating with overwrite mode

### Performance Issues

1. **Slow search performance**
   - Use appropriate similarity thresholds
   - Consider batch processing for large datasets
   - Check system memory usage

2. **Large storage usage**
   - Clean up unused collections
   - Archive old collections
   - Use compression for backups

### Debug Mode

```typescript
// Enable debug logging
await manage_embeddings("openai", { 
  apiKey: "your-key",
  debug: true 
});

// Test connection
const status = await test_vector_connection();
console.log("LanceDB Status:", status);
```

## Best Practices

### 1. Collection Organization
- Use descriptive collection names
- Group related documents together
- Regularly clean up unused collections

### 2. Embedding Strategy
- Use OpenAI for general purpose
- Use HuggingFace for specialized domains
- Use local embeddings for privacy-sensitive data

### 3. Query Optimization
- Write clear, specific queries
- Use appropriate similarity thresholds (0.7-0.9)
- Consider query expansion for better results

### 4. Performance
- Batch document additions when possible
- Monitor collection sizes
- Use appropriate limits for search results

## API Reference

### Core Functions

| Function | Description |
|----------|-------------|
| `create_vector_collection(name, provider)` | Create new collection |
| `search_vectors(collection, query, options)` | Search for similar vectors |
| `add_documents_to_collection(collection, docs)` | Add documents with embeddings |
| `manage_embeddings(provider, config)` | Configure embedding providers |
| `list_vector_collections()` | List all collections |
| `get_collection_stats(collection)` | Get collection statistics |
| `delete_vector_collection(collection)` | Delete collection |
| `test_vector_connection()` | Test LanceDB connection |

### Search Options

```typescript
interface SearchOptions {
  limit?: number;              // Max results (default: 10)
  similarity_threshold?: number; // Min similarity (default: 0.7)
  include_metadata?: boolean;   // Include document metadata
  metric?: 'cosine' | 'euclidean'; // Distance metric
}
```

---

## Migration from Legacy API

If you're upgrading from the older `vectordb` package, note these changes:

### Table Creation
```typescript
// Old API
db.createTable(tableName, data, { writeMode: lancedb.WriteMode.Overwrite });

// New API (@lancedb/lancedb)
db.createTable(tableName, data, { mode: "overwrite" });
```

### Index Creation
```typescript
// Old API
await tbl.createIndex({
  column: "vector",
  type: "ivf_pq",
  num_partitions: 2,
  num_sub_vectors: 2,
});

// New API
await table.createIndex("vector", {
  config: lancedb.Index.ivfPq({
    numPartitions: 2,
    numSubVectors: 2,
  }),
});
```

### Search Operations
```typescript
// Old API
await tbl.search(Array(1536).fill(1.2)).limit(10).execute();

// New API
await tbl.search(Array(128).fill(1.2)).limit(10).toArray();
```

### Distance Type
```typescript
// Old API  
.metricType(lancedb.MetricType.Cosine)

// New API
.distanceType("cosine")
```

---

**Note**: LanceDB integration is included in ZMCPTools v0.2.0+ with no additional setup required. The vector database is automatically initialized on first use. Uses the modern @lancedb/lancedb Rust-backed client for maximum performance.