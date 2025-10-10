# MCP Tool Contract: index_symbol_graph

**Status**: DRAFT
**Issue**: [#53](https://github.com/jw409/ZMCPTools/issues/53)
**Priority**: High - Enables flexible code indexing and corruption recovery
**Related**:
- #52 (LanceDB metadata corruption bug)
- symbols:// resource (new, for querying cache)

---

## Purpose

Flexible code indexing tool following Unix design philosophy: composable, reusable, does one thing well. Enables adding new code to search, recovering from corruption, and scoped indexing.

## Problem Statement

**Current limitations**:
1. **No flexible indexing**: Can't add new files or scope to specific paths via MCP
2. **No corruption recovery**: Can't wipe bad cache when #52-style bugs occur
3. **No cache visibility**: Can't query what's already indexed (need symbols:// resource)
4. **Not composable**: Can't pipe from project:// structure or filter programmatically

**Impact**: Manual Bash scripts required for index management, breaks Unix philosophy of small composable tools.

---

## Tool Signature

```typescript
mcp__zmcp-tools__index_symbol_graph({
  repository_path: string,

  // Input methods (composable, pick one or combine)
  files?: string[],              // Explicit file list (from symbols:// comparison, etc.)
  include?: string[],            // Glob patterns to include
  exclude?: string[],            // Glob patterns to exclude

  // Options
  force_clean?: boolean,         // Wipe cache and rebuild from scratch
  max_workers?: number           // CPU parallelism (default: 4)
})
```

**Note**: Incremental is automatic via mtime/hash tracking (>95% cache hit rate). No `mode` parameter needed.

---

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `repository_path` | string | ✓ | - | Absolute path to repository to index |
| `files` | string[] | - | - | Explicit file list (composable with symbols://, project://) |
| `include` | string[] | - | `['**/*.ts', '**/*.js', '**/*.py', '**/*.md']` | Glob patterns to include |
| `exclude` | string[] | - | `['node_modules/**', 'dist/**', '**/*.test.ts']` | Glob patterns to exclude |
| `force_clean` | boolean | - | `false` | Wipe cache before indexing (corruption recovery) |
| `max_workers` | number | - | `4` | CPU parallelism for scanning/parsing |

**Composability**: If `files` provided, use that list. Otherwise, use `include`/`exclude` globs. Incremental via mtime is automatic.

---

## Return Value

**Success Response**:
```typescript
{
  status: 'completed' | 'running',
  task_id?: string,          // If background=true
  files_indexed: number,
  symbols_extracted: number,
  embeddings_generated: number,
  duration_ms: number,
  storage: {
    sqlite_path: string,     // e.g., "{repo}/var/storage/sqlite/symbol_graph.db"
    sqlite_size_mb: number,
    lancedb_path: string,    // e.g., "{repo}/var/storage/lancedb/symbol_graph_embeddings.lance"
    lancedb_size_mb: number
  },
  logs: {
    operation_log: string,   // File path: "{repo}/var/storage/logs/zmcp/reindex/success-{timestamp}.log"
    operation_resource: string  // Resource URI: "logs://zmcp/content?file=reindex/success-{timestamp}.log"
  },
  warnings: string[]
}
```

**Error Response** (Silent Failure Prevention):
```typescript
{
  status: 'failed',
  errors: string[],          // Human-readable error messages
  diagnostics: {
    gpu_service_port?: number,
    gpu_service_status?: 'available' | 'unavailable' | 'timeout',
    connection_error?: string,
    sqlite_path?: string,
    lancedb_path?: string,
    permission_issues?: string[],
    suggested_fixes?: string[]
  },
  logs: {
    operation_log: string,   // "{repo}/var/storage/logs/zmcp/reindex/failed-{timestamp}.log"
    operation_resource: string,  // "logs://zmcp/content?file=reindex/failed-{timestamp}.log"
    server_diagnostic?: string   // dom0: "logs://server/content?file=operations.log"
  },
  partial_results?: {
    files_processed: number,
    symbols_extracted: number,
    embeddings_generated: number
  }
}
```

---

## Logging Architecture (Issue #6 Per-Project Isolation)

### Storage Scope via StoragePathResolver

**domU** (per-project, default when `var/` exists):
- **Operation logs**: `{repository_path}/var/storage/logs/zmcp/reindex/{timestamp}.log`
- **SQLite**: `{repository_path}/var/storage/sqlite/symbol_graph.db`
- **LanceDB**: `{repository_path}/var/storage/lancedb/symbol_graph_embeddings.lance`

**dom0** (global fallback):
- **Server diagnostics**: `~/dev/game1/var/storage/logs/server/operations.log`
- **MCP server logs**: `~/dev/game1/var/storage/logs/server/mcp-server.log`

### Log Content Structure

**Operation log** (`{repo}/var/storage/logs/zmcp/reindex/{status}-{timestamp}.log`):
```
[2025-10-09T18:30:15Z] REINDEX START
Repository: /home/jw/dev/game1/ZMCPTools
Mode: full, Force Clean: true

[2025-10-09T18:30:15Z] GPU Service Check
Port 8765: Checking... SUCCESS
Model: EmbeddingGemma-300M (768D)
VRAM: 10.2GB / 32GB available

[2025-10-09T18:30:16Z] Wiping Corrupted Data
SQLite: Deleted 17 entries with embedding_stored=0
LanceDB: Dropped collection symbol_graph_embeddings

[2025-10-09T18:30:20Z] Indexing Files
Scanning: src/**/*.ts, bin/**/*.py
Found: 319 files

[2025-10-09T18:35:42Z] REINDEX COMPLETE
Files indexed: 319
Symbols extracted: 3,847
Embeddings generated: 3,847 (768D)
Duration: 5m 27s
SQLite size: 1.2 MB
LanceDB size: 14.3 MB
```

**Server diagnostic** (`~/dev/game1/var/storage/logs/server/operations.log`):
```
[2025-10-09T18:30:15Z] TOOL: reindex_symbol_graph
Repository: /home/jw/dev/game1/ZMCPTools
Mode: full, Force Clean: true
Result: SUCCESS (5m 27s)
```

### Silent Failure Prevention

Return value **MUST include log paths** for Claude to investigate failures:

```typescript
// Example: GPU unavailable
{
  status: 'failed',
  errors: ['GPU embedding service unavailable on port 8765'],
  diagnostics: {
    gpu_service_port: 8765,
    gpu_service_status: 'unavailable',
    connection_error: 'ECONNREFUSED',
    suggested_fixes: [
      'Start embedding service: uv run python talent-os/bin/start_embedding_service.py',
      'Check GPU availability: nvidia-smi',
      'Verify port 8765 not in use: lsof -i :8765'
    ]
  },
  logs: {
    operation_log: '/home/jw/dev/game1/ZMCPTools/var/storage/logs/zmcp/reindex/failed-2025-10-09-18-30-15.log',
    operation_resource: 'logs://zmcp/content?file=reindex/failed-2025-10-09-18-30-15.log',
    server_diagnostic: 'logs://server/content?file=operations.log&pattern=reindex_symbol_graph&line_numbers=true&C=5'
  }
}
```

**Claude can then**:
1. Read detailed log: `ReadMcpResourceTool('logs://zmcp/content?file=reindex/failed-...')`
2. Apply suggested fix: Run embedding service startup command
3. Retry reindex with same parameters

---

## Use Cases

### 1. Add New Code to Search

**Scenario**: Just wrote new feature, want it searchable

```typescript
// Unix-style composability
await index_symbol_graph({
  repository_path: '/home/jw/dev/game1/ZMCPTools',
  files: ['src/features/new-auth.ts', 'src/features/new-auth.test.ts']
})
// Incremental: Only indexes these 2 files (~2s)
```

### 2. Corruption Recovery (#52)

**Scenario**: LanceDB corrupted, missing file_path in results

```typescript
await index_symbol_graph({
  repository_path: '/home/jw/dev/game1/ZMCPTools',
  force_clean: true  // Wipe bad cache, rebuild all
})
// Full rebuild: 2-5 min, fixes corruption
```

### 3. Scope to Specific Paths

**Scenario**: Only index services, skip tests

```typescript
await index_symbol_graph({
  repository_path: '/home/jw/dev/game1/ZMCPTools',
  include: ['src/services/**/*.ts'],
  exclude: ['**/*.test.ts', '**/*.spec.ts']
})
// Selective: Only service code
```

### 4. Composable with symbols:// Resource

**Scenario**: Check cache, index missing files

```typescript
// 1. Query what's cached
const cached = await ReadMcpResourceTool('symbols://list')
// → ['src/old-file.ts', 'src/utils.ts']

// 2. Query actual files
const actual = await ReadMcpResourceTool('project://./structure')
// → Parse to get file list

// 3. Index the delta (in LLM logic)
const missing = actual.filter(f => !cached.includes(f))
await index_symbol_graph({
  repository_path: '/home/jw/dev/game1/ZMCPTools',
  files: missing
})
```

---

## Related: symbols:// MCP Resource (New)

**Companion resource for querying the cache** (Unix philosophy: separate read/write):

```typescript
// Query cached symbol index (read-only, instant)
symbols://list                              // All indexed files
symbols://search?name=foo&type=function     // Find symbols by name/type
symbols://file/{path}                       // Symbols in specific file
symbols://stats                             // Index statistics (cache hit rate, etc.)
```

**Use case**: Compare cache vs reality
```typescript
// Check what's cached
const cached = ReadMcpResourceTool('symbols://list')

// Check actual files
const actual = ReadMcpResourceTool('project://./structure')

// Index the delta
index_symbol_graph({ files: missing })
```

**Implementation**: Queries SymbolGraphIndexer SQLite directly (instant, no GPU)

---

## Implementation Notes

### Reuses Existing Infrastructure

- **Indexer**: `src/services/SymbolGraphIndexer.ts` (has all logic)
- **Vector storage**: `src/services/LanceDBService.ts`
- **GPU embeddings**: Port 8765 (EmbeddingGemma-300M, 768D)
- **Storage paths**: `src/services/StoragePathResolver.ts` (domU/dom0 isolation)

### Incremental is Automatic

**Already implemented** in SymbolGraphIndexer.ts (lines 335-372):
- mtime + hash tracking (>95% cache hit rate)
- `shouldReindex()` checks if file changed
- Unchanged files skipped instantly
- No `mode` parameter needed - it just works!

### Input Handling

**Priority order**:
1. If `files` provided → Index exactly those files
2. Else if `include`/`exclude` → Use glob patterns
3. Else → Index all indexable extensions (default)

**force_clean**:
- Wipes SQLite + LanceDB before indexing
- Used for corruption recovery (#52)

### CPU Parallelism

**`max_workers` parameter** (default: 4):
- Parallelizes file scanning, AST parsing, symbol extraction
- GPU embeddings still sequential (single service on port 8765)
- Performance: 5min → 2-3min for full rebuild

### GPU Requirements

- **Required**: Embedding service on port 8765
- **Model**: EmbeddingGemma-300M (768-dimensional vectors)
- **Fallback**: If GPU unavailable, return detailed error (NO silent failure)
- **Health check**: Verify port 8765 before starting, suggest fix if down

---

## Minified MCP Tool Description

**For tool registration** (teach LLM when/how to use):

```
Index code symbols for semantic search. Incremental by default (mtime/hash, >95% cache hit).

Use when:
- Adding new code to search
- Recovering from index corruption
- Scoping to specific paths/files
- Comparing cache (symbols://) vs actual (project://)

Params:
- files: Explicit list (composable!)
- include/exclude: Glob patterns
- force_clean: Wipe cache (corruption recovery)
- max_workers: CPU parallelism (default: 4)

Returns:
- files_indexed, symbols_extracted, embeddings_generated
- duration_ms, cache_hit_rate
- logs: {repo}/var/storage/logs/zmcp/index/

Blocks: 2s-5min depending on scope (incremental is fast!)
```

---

## Error Handling

### GPU Service Unavailable

```typescript
{
  status: 'failed',
  errors: ['GPU embedding service unavailable on port 8765'],
  diagnostics: {
    gpu_service_port: 8765,
    gpu_service_status: 'unavailable',
    connection_error: 'ECONNREFUSED',
    suggested_fixes: [
      'uv run python talent-os/bin/start_embedding_service.py',
      'Check: nvidia-smi',
      'Verify port: lsof -i :8765'
    ]
  },
  logs: {
    operation_log: '{repo}/var/storage/logs/zmcp/reindex/failed-{timestamp}.log',
    operation_resource: 'logs://zmcp/content?file=reindex/failed-{timestamp}.log'
  }
}
```

### Permission Denied

```typescript
{
  status: 'failed',
  errors: ['Cannot write to SQLite database'],
  diagnostics: {
    sqlite_path: '{repo}/var/storage/sqlite/symbol_graph.db',
    permission_issues: ['EACCES: permission denied'],
    suggested_fixes: [
      'Check permissions: ls -la {repo}/var/storage/sqlite/',
      'Fix ownership: sudo chown -R $USER {repo}/var/storage/'
    ]
  },
  logs: { ... }
}
```

### Corruption Detected (Verify Mode)

```typescript
{
  status: 'completed',  // Verify succeeded, corruption found
  warnings: [
    'Found 17 files with embedding_stored=0 but missing from LanceDB',
    'Found 2 orphaned LanceDB entries without SQLite metadata',
    'Recommend: Run with mode=full, force_clean=true to fix'
  ],
  logs: {
    operation_log: '{repo}/var/storage/logs/zmcp/reindex/verify-{timestamp}.log',
    operation_resource: 'logs://zmcp/content?file=reindex/verify-{timestamp}.log'
  }
}
```

---

## Testing

### Unit Tests

- `tests/services/reindex-modes.test.ts` - Test full/incremental/verify modes
- `tests/services/reindex-corruption.test.ts` - Test corruption recovery
- `tests/services/reindex-logging.test.ts` - Test log file creation and content
- `tests/services/reindex-errors.test.ts` - Test error handling and diagnostics

### Integration Tests

- `tests/integration/reindex-e2e.test.ts` - End-to-end reindex flow
- `tests/integration/self-healing.test.ts` - Claude detects + fixes corruption
- `tests/integration/background-task.test.ts` - Background mode with #43

### Benchmarks

- Full reindex: ~2-5 min for 266K files (existing full-reindex.ts baseline)
- Incremental: <10 seconds for typical changes (10-20 files)
- Verify: <30 seconds (no embeddings generated)

---

## Documentation Updates

When implemented, update:

1. **ZMCPTools/etc/TOOL_LIST.md** - Add tool documentation
2. **talent-os/etc/TOOLS-MANIFEST.md** - Reference from TalentOS
3. **ZMCPTools/README.md** - Add to quick reference
4. **Issue #79** - Mark as resolved, link to implementation

---

## Acceptance Criteria

- [ ] Tool callable via MCP protocol
- [ ] All three modes (full, incremental, verify) working
- [ ] `force_clean` successfully wipes corrupted data
- [ ] Background mode integrates with task queue (#43)
- [ ] Graceful failure when GPU service unavailable
- [ ] Return value includes operation_log paths (domU per-project)
- [ ] Logs written to `{repo}/var/storage/logs/zmcp/reindex/`
- [ ] Server diagnostics written to dom0 `logs/server/operations.log`
- [ ] Integration test: Claude detects #52-style corruption → calls tool → self-heals
- [ ] Documentation complete in TOOL_LIST.md
- [ ] No silent failures - all errors return structured diagnostics

---

## Related Issues & Resources

- **#52** - LanceDB metadata corruption (corruption recovery use case)
- **symbols:// resource** (NEW) - Query cached symbols for composability
- **project:// resource** (existing) - File structure discovery
- **#6** - Per-project isolation (StoragePathResolver implements domU/dom0)

**Future enhancements**:
- Agent-based indexing when claude-agent-sdk exists
- Git history integration (#23)

---

**Designed**: 2025-10-09
**Updated**: 2025-10-09 (Unix composability, symbols:// resource)
**Author**: Claude (via ultrathink + user feedback on Unix philosophy)
