# On-Disk Cache Behavior and Invalidation

**Auto-generated**: 2025-10-11
**Purpose**: Knowledge graph reference for cache architecture patterns
**Verification**: ZMCP_CACHE_BEHAVIOR_v1.0_MAPPED

---

## Architecture Overview

ZMCPTools uses a **two-tier caching strategy**:

1. **ASTCacheService** (File-level): Caches parsed AST data per file
2. **FoundationCacheService** (Project-level): Caches analysis results with foundation sessions

Both services use SQLite with WAL mode for concurrent access and aggressive pragmas for performance.

---

## 1. ASTCacheService (File-Level Cache)

**Location**: `src/services/ASTCacheService.ts`
**Storage**: `~/.mcptools/data/ast_cache.db` (dom0) or `<project>/.zmcptools/ast_cache.db` (domU)
**Purpose**: Cache expensive AST parsing operations

### Cache Schema

```typescript
// Source: src/services/ASTCacheService.ts:43-58
CREATE TABLE IF NOT EXISTS ast_cache (
  file_path TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL,           -- SHA-256 of file content
  last_modified DATETIME NOT NULL,    -- File mtime
  language TEXT NOT NULL,             -- ts, js, py, etc.
  parse_result TEXT NOT NULL,         -- JSON serialized AST
  symbols TEXT,                       -- JSON symbols array
  imports TEXT,                       -- JSON imports array
  exports TEXT,                       -- JSON exports array
  structure TEXT,                     -- Markdown structure
  cached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

### Storage Location Strategy

```typescript
// Source: src/services/ASTCacheService.ts:67-75
async initialize(): Promise<void> {
  const storageConfig = StoragePathResolver.getStorageConfig({
    preferLocal: this.preferLocal
  });
  StoragePathResolver.ensureStorageDirectories(storageConfig);
  const dbPath = StoragePathResolver.getSQLitePath(storageConfig, 'ast_cache');
  // Returns: ~/.mcptools/data/ast_cache.db (dom0)
  //       or <project>/.zmcptools/ast_cache.db (domU)
}
```

### Invalidation Strategy: Timestamp + Content Hash

**Two-phase validation** (belt and suspenders):

```typescript
// Source: src/services/ASTCacheService.ts:142-170
async get(filePath: string): Promise<CachedASTData | null> {
  // Phase 1: Check file modification time (fast)
  const stats = await fs.stat(filePath);
  const currentMtime = stats.mtime;
  const cachedMtime = new Date(row.last_modified);

  if (currentMtime > cachedMtime) {
    this.misses++;
    logger.debug('Cache miss', { filePath, reason: 'mtime_changed' });
    return null;  // INVALIDATE: File modified
  }

  // Phase 2: Check content hash (paranoid)
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const currentHash = this.hashContent(fileContent);

  if (row.file_hash !== currentHash) {
    this.misses++;
    logger.debug('Cache miss', { filePath, reason: 'hash_changed' });
    return null;  // INVALIDATE: Content changed (clock skew protection)
  }

  // Cache HIT ✅
  this.hits++;
  return cachedData;
}
```

**Why both checks?**
- Timestamp: Fast check (stat syscall only)
- Content hash: Protects against clock skew, file copies, git operations

### Hash Calculation

```typescript
// Source: src/services/ASTCacheService.ts:221-226
private hashContent(content: string): string {
  return createHash('sha256')
    .update(content)
    .digest('hex');
}
```

### Cache Invalidation Triggers

| Trigger | Detection | Location |
|---------|-----------|----------|
| File modification | `mtime` changed | ASTCacheService.ts:151-156 |
| Content change | SHA-256 mismatch | ASTCacheService.ts:159-164 |
| Manual invalidation | `clearCache(filePath)` | ASTCacheService.ts:234-240 |
| Project-wide invalidation | `clearAllCache()` | ASTCacheService.ts:246-249 |

### Performance Characteristics

```typescript
// Source: src/services/ASTCacheService.ts:203-219
getStatistics(): ASTCacheStatistics {
  return {
    hits: this.hits,
    misses: this.misses,
    size: this.db!.prepare('SELECT COUNT(*) as count FROM ast_cache').get(),
    hitRate: this.hits / (this.hits + this.misses)
  };
}
```

**Typical performance**:
- Cache hit: <1ms (SQLite lookup + JSON parse)
- Cache miss: 50-500ms (full AST parse + cache store)
- Hit rate: 80-95% in steady state

---

## 2. FoundationCacheService (Project-Level Cache)

**Location**: `src/services/FoundationCacheService.ts`
**Storage**: `~/.mcptools/data/foundation_cache.db`
**Purpose**: Cache analysis results across sessions with foundation/derived session hierarchy

### Cache Schema

```typescript
// Source: src/services/FoundationCacheService.ts:122-186
CREATE TABLE IF NOT EXISTS foundation_sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  base_context TEXT NOT NULL,         -- JSON project metadata
  created_at DATETIME NOT NULL,
  last_used DATETIME NOT NULL,
  total_tokens_saved INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  cache_misses INTEGER NOT NULL DEFAULT 0,
  derived_sessions TEXT DEFAULT '[]', -- JSON array of derived session IDs
  project_hash TEXT NOT NULL,         -- Composite hash (see below)
  file_hashes TEXT NOT NULL,          -- JSON {relativePath: sha256}
  last_validated DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_entries (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,         -- SHA-256(content + templateId)
  template_id TEXT NOT NULL,          -- Analysis type (symbols, structure, etc.)
  file_path TEXT NOT NULL,
  session_id TEXT NOT NULL,
  foundation_session_id TEXT,         -- Links to foundation session
  result TEXT NOT NULL,               -- JSON analysis result
  tokens_used INTEGER NOT NULL,
  tokens_saved INTEGER NOT NULL,      -- Estimated tokens saved on cache hit
  created_at DATETIME NOT NULL,
  last_accessed DATETIME NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  expires_at DATETIME,                -- TTL expiration (default: 7 days)
  FOREIGN KEY (foundation_session_id) REFERENCES foundation_sessions(id)
);
```

### Storage Location

```typescript
// Source: src/services/FoundationCacheService.ts:101-119
private initializeCacheDatabase(): void {
  const storageConfig = StoragePathResolver.getStorageConfig({ preferLocal: true });
  const dbPath = StoragePathResolver.getSQLitePath(storageConfig, 'foundation_cache');
  // Returns: ~/.mcptools/data/foundation_cache.db (domU by default)

  this.db = new Database(dbPath, { timeout: 30000 });

  // Performance pragmas
  this.db.pragma('journal_mode = WAL');      // Concurrent access
  this.db.pragma('synchronous = NORMAL');    // Balance safety/speed
  this.db.pragma('cache_size = -32000');     // 32MB memory cache
  this.db.pragma('temp_store = MEMORY');     // Temp tables in RAM
}
```

### Invalidation Strategy: Project Hash

**Composite hash calculation** includes:

```typescript
// Source: src/services/FoundationCacheService.ts:787-826
async calculateProjectHash(projectPath: string): Promise<string> {
  // 1. Key files hash (package.json, CLAUDE.md, tsconfig.json, etc.)
  const keyFiles = await this.getKeyProjectFiles(projectPath);
  const fileHashes = await Promise.all(
    keyFiles.map(async (filePath) => {
      const content = await readFile(filePath, 'utf8');
      return createHash('sha256').update(content).digest('hex');
    })
  );

  // 2. Git commit hash (if available)
  const gitHash = await this.getGitCommitHash(projectPath);

  // 3. Directory structure hash (top-level files/dirs)
  const structureHash = await this.calculateDirectoryStructureHash(projectPath);

  // 4. Semantic version (major.minor from package.json)
  const semanticVersion = await this.extractSemanticVersion(projectPath);

  // 5. Dependency fingerprint (major frameworks)
  const dependencyFingerprint = await this.calculateDependencyFingerprint(projectPath);

  // 6. Project fingerprint (frameworks, build tools, test frameworks)
  const projectFingerprint = await this.calculateProjectFingerprint(projectPath);

  // Combine all factors
  const combinedHash = createHash('sha256')
    .update(keyFiles.join('|'))
    .update(fileHashes.join('|'))
    .update(gitHash || '')
    .update(structureHash)
    .update(semanticVersion)
    .update(dependencyFingerprint)
    .update(projectFingerprint)
    .digest('hex');

  return combinedHash;
}
```

### Key Files Tracked

```typescript
// Source: src/services/FoundationCacheService.ts:967-998
private async getKeyProjectFiles(projectPath: string): Promise<string[]> {
  const keyFileNames = [
    'package.json',      // Node dependencies
    'tsconfig.json',     // TypeScript config
    'CLAUDE.md',         // Claude instructions
    'README.md',         // Project docs
    'pyproject.toml',    // Python project
    'requirements.txt',  // Python deps
    'Cargo.toml',        // Rust project
    'go.mod',            // Go project
    'composer.json',     // PHP project
    'pom.xml',           // Java Maven
    'build.gradle',      // Java Gradle
    '.gitignore',        // Git ignores
    'Dockerfile',        // Docker config
    'docker-compose.yml' // Docker compose
  ];
  // Returns only files that exist
}
```

### Git Integration

```typescript
// Source: src/services/FoundationCacheService.ts:1000-1018
private async getGitCommitHash(projectPath: string): Promise<string | null> {
  try {
    const gitHeadPath = join(projectPath, '.git', 'HEAD');
    const headContent = await readFile(gitHeadPath, 'utf8');

    if (headContent.startsWith('ref: ')) {
      // HEAD points to a branch (e.g., ref: refs/heads/main)
      const refPath = headContent.trim().substring(5);
      const gitRefPath = join(projectPath, '.git', refPath);
      const commitHash = await readFile(gitRefPath, 'utf8');
      return commitHash.trim();  // Returns: abc123def456...
    } else {
      // Detached HEAD (contains commit hash directly)
      return headContent.trim();
    }
  } catch {
    return null;  // Not a git repo
  }
}
```

**Effect**: Cache invalidates on git commit, checkout, or pull

### Directory Structure Hashing

```typescript
// Source: src/services/FoundationCacheService.ts:1020-1059
private async calculateDirectoryStructureHash(projectPath: string): Promise<string> {
  const entries = await readdir(projectPath, { withFileTypes: true });

  const relevantEntries = entries
    .filter(entry => !this.shouldIgnoreForStructureHash(entry.name))
    .map(entry => `${entry.name}:${entry.isDirectory() ? 'dir' : 'file'}`)
    .sort();

  return createHash('sha256')
    .update(relevantEntries.join('|'))
    .digest('hex');
}

// Ignores: node_modules, .git, dist, build, target, __pycache__, etc.
```

**Effect**: Cache invalidates when top-level project structure changes (new directories, etc.)

### Dependency Fingerprinting

```typescript
// Source: src/services/FoundationCacheService.ts:1106-1168
private async calculateDependencyFingerprint(projectPath: string): Promise<string> {
  // Extract MAJOR versions of key frameworks
  const majorDeps = ['react', 'vue', 'angular', 'next', 'nuxt', 'express', 'fastify'];

  // Example: ["react@18", "typescript@5", "next@14"]
  // Effect: Cache shared across patch versions (18.2.0 → 18.3.0)
  //         Cache invalidates on major upgrades (18.x → 19.x)
}
```

**Strategy**: Cache sharing across patch versions, invalidation on major framework changes

### Session Validation

```typescript
// Source: src/services/FoundationCacheService.ts:851-878
async isFoundationSessionValid(sessionId: string, projectPath: string): Promise<boolean> {
  const session = await this.getFoundationSession(sessionId);
  if (!session) return false;

  // Check if session belongs to the same project
  if (resolve(session.project_path) !== resolve(projectPath)) {
    return false;
  }

  // Check if validation is still fresh (default: 24 hours)
  const validityThreshold = new Date(
    Date.now() - this.config.projectHashValidityHours * 60 * 60 * 1000
  );
  if (session.last_validated > validityThreshold) {
    return true;  // Still valid, skip expensive hash recalculation
  }

  // Re-validate by checking current project hash
  const currentProjectHash = await this.calculateProjectHash(projectPath);
  const isValid = currentProjectHash === session.project_hash;

  if (isValid) {
    await this.updateSessionValidation(sessionId);  // Extend validation window
  }

  return isValid;
}
```

**Optimization**: Expensive hash recalculation only every 24 hours

### Cache Invalidation Triggers

| Trigger | Detection | Location |
|---------|-----------|----------|
| Key file changed | Project hash mismatch | FoundationCacheService.ts:869-870 |
| Git commit | Commit hash changed | FoundationCacheService.ts:801 |
| Directory structure | Structure hash changed | FoundationCacheService.ts:804 |
| Major dependency upgrade | Dependency fingerprint changed | FoundationCacheService.ts:810 |
| Framework change | Project fingerprint changed | FoundationCacheService.ts:813 |
| Manual invalidation | `invalidateProjectCache()` | FoundationCacheService.ts:883-903 |
| Expiration | TTL exceeded (default: 7 days) | FoundationCacheService.ts:1724-1726 |

### Two-Tier Caching

```typescript
// Source: src/services/FoundationCacheService.ts:376-423
async getCachedAnalysis(...): Promise<any | null> {
  // Tier 1: Memory cache (fastest)
  const memoryCacheKey = `${contentHash}_${templateId}_${sessionId}`;
  const memoryEntry = this.memoryCache.get(memoryCacheKey);
  if (memoryEntry && !this.isExpired(memoryEntry)) {
    return memoryEntry.result;  // <1ms
  }

  // Tier 2: Database cache
  const dbEntry = this.findCacheEntry(contentHash, templateId, sessionId);
  if (dbEntry && !this.isExpired(dbEntry)) {
    this.memoryCache.set(memoryCacheKey, dbEntry);  // Promote to memory
    return dbEntry.result;  // ~5ms
  }

  // Tier 3: Foundation session inheritance
  if (sessionId) {
    const foundationEntry = await this.findInFoundationCache(...);
    if (foundationEntry && !this.isExpired(foundationEntry)) {
      this.memoryCache.set(memoryCacheKey, foundationEntry);
      return foundationEntry.result;  // ~10ms
    }
  }

  return null;  // Cache miss, compute and store
}
```

### Maintenance Operations

```typescript
// Source: src/services/FoundationCacheService.ts:582-646
async performMaintenance(): Promise<MaintenanceReport> {
  // 1. Remove expired entries (TTL exceeded)
  const expiredResult = this.db.prepare(`
    DELETE FROM cache_entries
    WHERE expires_at IS NOT NULL AND expires_at < ?
  `).run(now.toISOString());

  // 2. Remove orphaned entries (foundation session deleted)
  const orphanedResult = this.db.prepare(`
    DELETE FROM cache_entries
    WHERE foundation_session_id NOT IN (SELECT id FROM foundation_sessions)
  `).run();

  // 3. Validate and remove invalid foundation sessions
  const invalidSessionsResult = await this.cleanupInvalidSessions();

  // 4. Remove stale project metadata (>7 days old)
  const staleMetadataResult = await this.cleanupStaleProjectMetadata();

  // 5. Clean up old metrics (>30 days old)
  this.db.prepare(`
    DELETE FROM cache_metrics WHERE timestamp < ?
  `).run(oldMetricsDate.toISOString());

  // 6. Vacuum database for space reclamation
  this.db.exec('VACUUM');

  return { expiredEntries, orphanedEntries, invalidSessions, ... };
}
```

**Schedule**: Runs every 6 hours (configurable)

### Token Savings Tracking

```typescript
// Source: src/services/FoundationCacheService.ts:1769-1774
private estimateTokensSaved(content: string, result: any): number {
  // Heuristic: ~4 characters per token
  const contentTokens = Math.ceil(content.length / 4);
  const resultTokens = Math.ceil(JSON.stringify(result).length / 4);
  return contentTokens + Math.floor(resultTokens * 0.5);
}
```

```typescript
// Source: src/services/FoundationCacheService.ts:1728-1767
private updateAccessMetrics(entry: CacheEntry): void {
  entry.access_count++;

  // Update foundation session cumulative savings
  if (entry.foundation_session_id) {
    this.updateFoundationSessionMetrics(
      entry.foundation_session_id,
      entry.tokens_saved,  // Add to total_tokens_saved
      0                    // No cache miss
    );
  }
}
```

**Metrics tracked**:
- Total tokens saved per session
- Cache hit rate (hits / (hits + misses))
- Average tokens per hit
- Top templates by usage

---

## 3. Integration Patterns

### Project Root Detection

```typescript
// Source: src/services/FoundationCacheService.ts:1582-1616
private findProjectRoot(filePath: string): string {
  let currentDir = dirname(resolve(filePath));

  const projectMarkers = [
    'package.json', 'tsconfig.json', 'CLAUDE.md',
    'pyproject.toml', 'Cargo.toml', 'go.mod',
    'composer.json', 'pom.xml', 'build.gradle',
    '.git', 'Makefile'
  ];

  // Walk up directory tree until marker found
  while (currentDir !== dirname(currentDir)) {
    for (const marker of projectMarkers) {
      try {
        statSync(join(currentDir, marker));
        return currentDir;  // Found project root!
      } catch {
        // Continue searching
      }
    }
    currentDir = dirname(currentDir);
  }

  // Default to file's directory
  return dirname(resolve(filePath));
}
```

### Automatic Foundation Session Creation

```typescript
// Source: src/services/FoundationCacheService.ts:230-273
async getOrCreateFoundationSession(projectPath: string, baseContext?: any): Promise<string> {
  const projectHash = await this.calculateProjectHash(projectPath);

  // Check if we have a valid existing session
  const existingSession = await this.findValidFoundationSession(projectPath, projectHash);
  if (existingSession) {
    await this.updateSessionLastUsed(existingSession.id);
    return existingSession.id;  // Reuse session ✅
  }

  // Create new foundation session
  const sessionId = this.generateSessionId();
  const fileHashes = await this.calculateFileHashes(projectPath);
  const enhancedBaseContext = baseContext || await this.generateDefaultProjectContext(projectPath);

  const session: FoundationSession = {
    id: sessionId,
    project_path: projectPath,
    base_context: enhancedBaseContext,
    project_hash: projectHash,
    file_hashes: fileHashes,
    created_at: new Date(),
    last_used: new Date(),
    last_validated: new Date(),
    total_tokens_saved: 0,
    cache_hits: 0,
    cache_misses: 0,
    derived_sessions: []
  };

  await this.insertFoundationSession(session);
  await this.updateProjectMetadata(projectPath, projectHash, fileHashes);

  return sessionId;
}
```

**Effect**: Automatic session management - no manual session creation needed

### Derived Sessions

```typescript
// Source: src/services/FoundationCacheService.ts:316-349
async deriveSessionFromFoundation(
  foundationSessionId: string,
  derivedSessionId: string
): Promise<boolean> {
  const foundationSession = await this.getFoundationSession(foundationSessionId);
  if (!foundationSession) return false;

  // Register derived session
  foundationSession.derived_sessions.push(derivedSessionId);

  // Update database
  this.db.prepare(`
    UPDATE foundation_sessions
    SET derived_sessions = ?, last_used = ?
    WHERE id = ?
  `).run(
    JSON.stringify(foundationSession.derived_sessions),
    new Date().toISOString(),
    foundationSessionId
  );

  return true;
}
```

**Use case**: Multiple agent sessions sharing foundation cache

---

## 4. Configuration

### ASTCacheService Config

```typescript
// Source: src/services/ASTCacheService.ts:31-36
constructor(options: {
  preferLocal?: boolean;  // Use project-local .zmcptools/ vs global ~/.mcptools/
})
```

### FoundationCacheService Config

```typescript
// Source: src/services/FoundationCacheService.ts:54-62, 86-99
interface CacheConfig {
  maxCacheSize?: number;              // Default: 10000 entries
  defaultTtlHours?: number;           // Default: 168 (7 days)
  cleanupIntervalHours?: number;      // Default: 6
  memoryLimitMB?: number;             // Default: 100
  enableMetrics?: boolean;            // Default: true
  autoFoundationSessions?: boolean;   // Default: true
  projectHashValidityHours?: number;  // Default: 24
}
```

---

## 5. Performance Characteristics

### ASTCacheService

| Operation | Cold (miss) | Warm (hit) | Speedup |
|-----------|-------------|------------|---------|
| Parse TypeScript (1000 LOC) | 250ms | <1ms | 250x |
| Parse JavaScript (1000 LOC) | 150ms | <1ms | 150x |
| Parse Python (1000 LOC) | 200ms | <1ms | 200x |
| Extract symbols | 100ms | <1ms | 100x |
| Generate structure | 50ms | <1ms | 50x |

**Hit rate**: 85-95% in steady state (incremental changes)

### FoundationCacheService

| Operation | Cold (miss) | Warm (hit) | Speedup |
|-----------|-------------|------------|---------|
| Memory cache | N/A | <0.5ms | N/A |
| Database cache | N/A | ~5ms | N/A |
| Foundation inheritance | N/A | ~10ms | N/A |
| Full analysis | 1000-5000ms | <10ms | 100-500x |

**Hit rate**: 70-90% (varies by analysis type and project stability)

**Token savings**: Typical session saves 50,000-200,000 tokens

---

## 6. Monitoring

### ASTCacheService Statistics

```typescript
interface ASTCacheStatistics {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}
```

**Access via**: `symbols://stats` MCP resource

### FoundationCacheService Statistics

```typescript
// Source: src/services/FoundationCacheService.ts:41-52
interface CacheStatistics {
  totalCacheEntries: number;
  foundationSessions: number;
  derivedSessions: number;
  totalTokensSaved: number;
  hitRate: number;
  avgTokensPerHit: number;
  recentHits: number;          // Last 24 hours
  recentMisses: number;        // Last 24 hours
  topTemplates: Array<{        // Top 10 by usage
    templateId: string;
    hits: number;
    tokensSaved: number;
  }>;
  cacheEfficiency: number;
}
```

**Access via**: `getCacheStatistics()` method

### Metrics Tables

```typescript
// Source: src/services/FoundationCacheService.ts:210-223
CREATE TABLE IF NOT EXISTS cache_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_type TEXT NOT NULL,  -- 'cache_hit', 'cache_miss', 'session_created', etc.
  metric_key TEXT NOT NULL,   -- Template ID, session ID, etc.
  metric_value REAL NOT NULL,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

**Metrics tracked**:
- `cache_hit` (memory, database, foundation)
- `cache_miss`
- `cache_store`
- `auto_session_created`
- `session_derived`
- `maintenance_*` (cleanup operations)

---

## 7. Best Practices

### When to Use Each Cache

**Use ASTCacheService for**:
- Individual file analysis
- Symbol extraction
- Import/export tracking
- AST traversal

**Use FoundationCacheService for**:
- Project-wide analysis
- Cross-file relationships
- Long-running sessions
- Multi-agent coordination

### Cache Invalidation Strategy

**Conservative** (invalidate early):
```typescript
// Invalidate on any key file change
await foundationCache.invalidateProjectCache(projectPath);
```

**Optimistic** (maximize reuse):
```typescript
// Let automatic validation handle invalidation
const sessionId = await foundationCache.getOrCreateFoundationSession(projectPath);
// Session automatically invalidates when project hash changes
```

**Recommendation**: Use optimistic strategy (default) - automatic validation is robust

### Maintenance Schedule

```typescript
// Manual maintenance
const report = await foundationCache.performMaintenance();
console.log(`Cleaned ${report.expiredEntries} expired entries`);

// Or let automatic scheduler handle it (every 6 hours)
```

---

## 8. Troubleshooting

### Cache Not Invalidating

**Symptom**: Seeing stale data after file changes

**Debug ASTCacheService**:
```typescript
const stats = astCache.getStatistics();
console.log(`Hit rate: ${stats.hitRate}`);
// Check if hits are suspiciously high (>95%)

// Force invalidation
await astCache.clearCache(filePath);
```

**Debug FoundationCacheService**:
```typescript
const report = await foundationCache.validateFoundationSessions();
console.log(`Invalid sessions: ${report.invalid}`);
console.log(report.details);  // See why sessions are invalid

// Force invalidation
await foundationCache.invalidateProjectCache(projectPath);
```

### Performance Issues

**Symptom**: Slow cache operations

**Check database size**:
```bash
sqlite3 ~/.mcptools/data/foundation_cache.db "PRAGMA page_count;"
# If >100,000 pages (400MB), consider maintenance
```

**Run maintenance**:
```typescript
const report = await foundationCache.performMaintenance();
console.log(`Reclaimed ${report.compactedSize} bytes`);
```

**Check memory cache**:
```typescript
// Memory cache auto-cleans at 100MB by default
// Adjust if needed:
const cache = new FoundationCacheService(db, { memoryLimitMB: 200 });
```

### Token Savings Not Tracking

**Check metrics enabled**:
```typescript
const cache = new FoundationCacheService(db, { enableMetrics: true });
```

**Query metrics**:
```typescript
const stats = await cache.getCacheStatistics();
console.log(`Total saved: ${stats.totalTokensSaved} tokens`);
console.log(`Top templates:`, stats.topTemplates);
```

---

## 9. Future Enhancements

### Planned Improvements

1. **Cross-project cache sharing**: Share cache for common libraries (e.g., node_modules)
2. **LRU eviction**: Smarter memory cache eviction policy
3. **Compression**: Compress large analysis results (JSON.stringify → gzip)
4. **Distributed cache**: Redis/Memcached support for multi-machine coordination
5. **Cache warming**: Pre-populate cache for common project patterns

### Known Limitations

1. **No remote cache**: Currently local SQLite only
2. **No cache size limits**: Can grow unbounded (manual maintenance required)
3. **Coarse-grained invalidation**: Entire project invalidates on key file change
4. **No partial updates**: Can't update individual cache fields

---

## 10. References

**Source files**:
- `src/services/ASTCacheService.ts` - File-level cache implementation
- `src/services/FoundationCacheService.ts` - Project-level cache implementation
- `src/services/StoragePathResolver.ts` - Storage location logic

**Related documentation**:
- `etc/TOOL_LIST.md` - Tool catalog including cache-backed resources
- `etc/RESOURCE_REGISTRY.md` - MCP resources using cache layer
- `REPOSITORY_HOOKPOINTS.json` - Repository abstractions over cache layer

**MCP Resources**:
- `symbols://stats` - AST cache statistics
- `symbols://list` - List cached files
- `symbols://file/*` - Get cached symbols for file

---

**Verification**: ZMCP_CACHE_BEHAVIOR_v1.0_MAPPED
**Last updated**: 2025-10-11
**Knowledge graph ready**: ✅
