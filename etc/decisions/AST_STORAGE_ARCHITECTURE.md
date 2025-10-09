# AST Storage Architecture

## Overview

TreeSitterASTTool now uses **SQLite-based caching with timestamp invalidation** following the same patterns as existing storage services.

## Storage Location (Dom0/DomU Isolation)

The AST cache respects project isolation:

- **DomU (Project-local)**: `{project}/var/storage/sqlite/ast_cache.db`
  - Used when project has `var/` directory
  - Activated with `ZMCP_USE_LOCAL_STORAGE=true` env var

- **Dom0 (System-wide)**: `~/dev/game1/var/storage/sqlite/ast_cache.db`
  - Fallback when project doesn't have local storage
  - Shared across projects in the same ecosystem

## Cache Schema

```sql
CREATE TABLE ast_cache (
  file_path TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL,              -- SHA256 of content
  last_modified TEXT NOT NULL,          -- ISO timestamp
  language TEXT NOT NULL,               -- typescript, python, etc.
  parse_result TEXT NOT NULL,           -- JSON serialized full AST
  symbols TEXT,                         -- JSON array of symbols
  imports TEXT,                         -- JSON array of imports
  exports TEXT,                         -- JSON array of exports
  structure TEXT,                       -- Markdown structure outline
  cached_at TEXT NOT NULL,              -- ISO timestamp
  parse_time_ms INTEGER,                -- Performance tracking
  file_size INTEGER,                    -- Original file size
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Timestamp-Based Invalidation

Cache entries are invalidated automatically when:

1. **File mtime changes** - File modification time is newer than `last_modified`
2. **Content hash changes** - Belt-and-suspenders check using SHA256
3. **Cache miss** - Entry doesn't exist

Following the same pattern as `RealFileIndexingService` and `AnalysisStorageService`.

## Integration

### TreeSitterASTTool

All cacheable operations check cache first:

```typescript
// Cacheable operations
- parse
- extract_symbols
- extract_imports
- extract_exports
- get_structure

// Non-cacheable (dynamic)
- query (depends on query param)
- find_pattern (depends on pattern param)
- get_diagnostics (always fresh)
```

### Cache Flow

```
1. executeByToolName(operation, args)
2. Check if operation is cacheable
3. astCache.get(file_path)
   ├─ Cache hit → Return cached data
   └─ Cache miss → Parse file
4. Execute operation
5. finally { astCache.set(...) }
```

## Performance

- **Cache hit**: ~1-5ms (SQLite read)
- **Cache miss + parse**: ~50-200ms depending on file size
- **Hit rate expected**: 80-95% in typical workflows

## Maintenance

```typescript
// Get stats
const stats = await astCache.getStats();
// { totalEntries, hitRate, avgParseTime, cacheSize, languages }

// Cleanup old entries
await astCache.cleanup(30); // Remove entries older than 30 days

// Invalidate specific file
await astCache.invalidate(filePath);

// Clear all
await astCache.clear();
```

## Comparison with Other Storage

| Service | Storage | Invalidation | Use Case |
|---------|---------|--------------|----------|
| **ASTCacheService** | SQLite | mtime + hash | AST parse results |
| **AnalysisStorageService** | SQLite | mtime + hash | File analysis (symbols, imports) |
| **RealFileIndexingService** | In-memory + LanceDB | None (rebuild) | Full-text search index |
| **IndexedKnowledgeSearch** | JSON file | Manual | GitHub issues + docs |

## Migration Path

AST cache is **opt-in and transparent**:

1. No migration needed - cache builds incrementally
2. Existing code works without changes
3. Cache improves performance automatically
4. Safe to delete cache DB - will rebuild

## Future Enhancements

- [ ] Batch invalidation for `git pull` scenarios
- [ ] Cache size limits with LRU eviction
- [ ] Shared cache across agents (needs locking)
- [ ] Cache warming on repository index
