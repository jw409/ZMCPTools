# MCP Resources vs Tools: Architectural Decision Document

## Executive Summary

**Problem**: Current ZMCPTools has ~105 MCP Tools. Each tool costs 150-300 tokens in the registration prompt sent to the LLM on startup. This creates:
- Massive system prompt bloat (~15,750-31,500 tokens for registration alone)
- Hits Cursor's 50 tool hard limit across all MCP servers
- Leaves no context budget for actual work

**Solution**: Split functionality into two categories:
1. **Resources** (READ operations) - URI-based, 30 tokens per resource template
2. **Consolidated Tools** (WRITE operations) - Operation-based, 200 tokens per tool

**Expected Savings**: 13,000+ tokens, 60+ tool slots freed

---

## Core Decision Criteria

### What Should Be a Resource?
**Resources = HTTP GET analogy**

✅ **YES - Make it a Resource if:**
- Read-only operation (no side effects)
- Accesses data that conceptually "exists" (file AST, project structure, agent status)
- Can be represented as a URI with query parameters
- Returns data that can be cached/indexed
- Naturally hierarchical (file/symbols, project/structure)

❌ **NO - Keep it as a Tool if:**
- Mutates state (creates, updates, deletes entities)
- Has side effects (spawns agents, sends messages)
- Requires complex multi-parameter logic that doesn't map to URIs
- Triggers workflows or multi-step operations

### Token Cost Comparison

| Type | Registration Cost | Example |
|------|------------------|---------|
| Resource | ~30 tokens | `resource://file/{path}/symbols` |
| Consolidated Tool | ~200 tokens | `tool: file_ops, operation: replace` |
| Separate Tool (old) | ~200 tokens EACH | `tool: ast_extract_symbols` |

**Impact**: Converting 6 tools → 1 resource template = 1,200 tokens → 30 tokens = **97% reduction**

---

## Proposed Architecture

### Phase 1: Convert Read Operations to Resources

#### A. File Analysis Resources (Replace 6 AST tools with 1 resource template)

**Before**: 6 separate tools × 200 tokens = 1,200 tokens
```typescript
tools: [
  "ast_extract_symbols",
  "ast_extract_imports",
  "ast_extract_exports",
  "ast_get_structure",
  "ast_get_diagnostics",
  "ast_parse"  // with optimizations
]
```

**After**: 1 resource template × 30 tokens = 30 tokens
```typescript
resource://file/{path}/{aspect}?compact=true&max_depth=3&use_symbol_table=true

where aspect = ast | symbols | imports | exports | structure | diagnostics
```

**Examples**:
- `resource://file/src/index.ts/symbols` → Returns optimized symbol list
- `resource://file/src/app.ts/ast?compact=true&max_depth=3` → Returns compact AST with depth limiting
- `resource://file/package.json/structure` → Returns file structure outline

**Keep as Tool**: `ast_analyze` with operation=query (for S-expression queries - complex parameterization)

**Savings**: 1,170 tokens + 5 tool slots

---

#### B. Project Analysis Resources (Replace 4 tools with 1 resource template)

**Before**: 4 tools × 200 tokens = 800 tokens
```typescript
tools: [
  "analyze_project_structure",
  "generate_project_summary",
  "list_files",
  "find_files"
]
```

**After**: 1 resource template × 30 tokens = 30 tokens
```typescript
resource://project/{path}/{aspect}?pattern=*.ts&exclude=node_modules

where aspect = structure | summary | files
```

**Examples**:
- `resource://project/./structure?max_depth=3` → Project tree
- `resource://project/./summary` → AI-optimized summary
- `resource://project/./files?pattern=*.ts&exclude=node_modules` → Filtered file list

**Keep as Tools**: `find_files` (complex search logic), `easy_replace` (mutation)

**Savings**: 770 tokens + 3 tool slots

---

#### C. Knowledge Graph Search Resources (Replace 3 tools with 1 resource template)

**Before**: 3 tools × 200 tokens = 600 tokens
```typescript
tools: [
  "search_knowledge_graph",
  "find_related_entities",
  "get_memory_status"
]
```

**After**: 1 resource template × 30 tokens = 30 tokens
```typescript
resource://knowledge/{query_or_entity_id}?limit=10&threshold=0.7

Special URIs:
- resource://knowledge/search?query=authentication → Search results
- resource://knowledge/entity/{id}/related → Related entities
- resource://knowledge/status → Memory status
```

**Keep as Tools**: `store_knowledge_memory`, `update_knowledge_entity`, `prune_knowledge_memory`, `wipe_knowledge_graph` (all mutations)

**Savings**: 570 tokens + 2 tool slots

---

#### D. Agent Status Resources (Replace 2 tools with 1 resource template)

**Before**: 2 tools × 200 tokens = 400 tokens
```typescript
tools: [
  "list_agents",
  "monitor_agents"
]
```

**After**: 1 resource template × 30 tokens = 30 tokens
```typescript
resource://agent/{agent_id_or_query}?status=active

Special URIs:
- resource://agent/all → List all agents
- resource://agent/all?status=active → Filter by status
- resource://agent/{agent_id}/status → Specific agent status
```

**Keep as Tools**: `spawn_agent`, `terminate_agent`, `cleanup_stale_agents` (all mutations)

**Savings**: 370 tokens + 1 tool slot

---

### Phase 2: Consolidate Remaining Tools by Operation

#### E. Agent Management Tools (Consolidate 6 tools → 1 tool)

**Before**: 6 tools × 200 tokens = 1,200 tokens
```typescript
tools: [
  "spawn_agent",
  "terminate_agent",
  "continue_agent_session",
  "cleanup_stale_agents",
  "cleanup_stale_rooms",
  "get_agent_results"
]
```

**After**: 1 consolidated tool × 200 tokens = 200 tokens
```typescript
tool: agent_manage
operations: [spawn, terminate, continue_session, cleanup_agents, cleanup_rooms, get_results]
```

**Savings**: 1,000 tokens + 5 tool slots

---

#### F. Knowledge Graph Mutation Tools (Consolidate 5 tools → 1 tool)

**Before**: 5 tools × 200 tokens = 1,000 tokens
```typescript
tools: [
  "store_knowledge_memory",
  "update_knowledge_entity",
  "create_knowledge_relationship",
  "prune_knowledge_memory",
  "wipe_knowledge_graph"
]
```

**After**: 1 consolidated tool × 200 tokens = 200 tokens
```typescript
tool: knowledge_mutate
operations: [store, update, create_relationship, prune, wipe]
```

**Savings**: 800 tokens + 4 tool slots

---

#### G. Communication Tools (Consolidate 7 tools → 2 tools)

**Before**: 7 tools × 200 tokens = 1,400 tokens
```typescript
tools: [
  "join_room",
  "send_message",
  "close_room",
  "delete_room",
  "list_rooms",
  "create_delayed_room",
  "broadcast_message_to_agents"
]
```

**After**: 2 consolidated tools × 200 tokens = 400 tokens
```typescript
tool: room_manage
operations: [join, create, create_delayed, close, delete, list]

tool: message_ops
operations: [send, broadcast]
```

**Savings**: 1,000 tokens + 5 tool slots

---

## Total Impact Summary

| Category | Strategy | Tools Before | Tools/Resources After | Tokens Saved | Slots Freed |
|----------|----------|--------------|----------------------|--------------|-------------|
| File Analysis | → Resources | 6 tools | 1 resource + 1 tool | 1,170 | 5 |
| Project Analysis | → Resources | 4 tools | 1 resource + 1 tool | 770 | 3 |
| Knowledge Search | → Resources | 3 tools | 1 resource | 570 | 3 |
| Agent Status | → Resources | 2 tools | 1 resource | 370 | 2 |
| Agent Mutations | Tool Consolidation | 6 tools | 1 tool | 1,000 | 5 |
| Knowledge Mutations | Tool Consolidation | 5 tools | 1 tool | 800 | 4 |
| Communication | Tool Consolidation | 7 tools | 2 tools | 1,000 | 5 |
| **TOTAL** | **Combined** | **33 tools** | **4 resources + 6 tools** | **5,680** | **27** |

**Grand Total Across All Categories (~105 tools):**
- Estimated final state: **~30 resources + ~20 tools** = 50 total registrations
- **Token savings: 13,000+ tokens**
- **Freed slots: 55+ tools** (fits comfortably under Cursor's 50 limit with headroom for other MCP servers)

---

## Implementation Concerns & Mitigations

### Concern 1: "Resources can't do complex filtering"
**FALSE** - Resources support full URI query parameters:
```
resource://file/{path}/ast?compact=true&use_symbol_table=true&max_depth=3&include_semantic_hash=true
```
The resource handler can apply all the same optimizations (symbol tables, depth limiting) as tools.

### Concern 2: "Resources return raw data, causing context bloat"
**MITIGATED** - Resource handlers return optimized/processed data:
- AST resources apply symbol table compression (30-50% token reduction)
- Project resources return compact summaries, not full file contents
- Knowledge resources apply similarity thresholds and limits

### Concern 3: "LLMs don't understand URI patterns well"
**ADDRESSED** - MCP protocol includes resource descriptions and examples in registration:
```typescript
{
  uri: "file://{path}/symbols",
  description: "Extract symbols (functions, classes) from a source file",
  mimeType: "application/json"
}
```

### Concern 4: "What if we need to add authentication/permissions?"
**FORWARD COMPATIBLE** - Resource URIs support standard auth patterns:
```
resource://file/{path}/ast?api_key=xxx
resource://knowledge/secure/{id}?token=xxx
```

### Concern 5: "Changing from Tools → Resources breaks existing LLM prompts"
**TRANSITION PLAN**:
1. Add Resources first (non-breaking)
2. Keep Tools as deprecated wrappers initially
3. Update documentation with migration examples
4. Remove old Tools after transition period

---

## Decision Points for Review

### 🔴 CRITICAL DECISIONS (Need approval before proceeding)

1. **AST Operations as Resources?**
   - ✅ YES: `resource://file/{path}/symbols`, `resource://file/{path}/ast?compact=true`
   - ❌ NO: Keep as consolidated `ast_analyze` tool
   - **Recommendation**: YES - saves 1,170 tokens, most natural API

2. **ast_query as Resource or Tool?**
   - Option A: `resource://file/{path}/query?expr=(function_declaration)` (resource)
   - Option B: `tool: ast_analyze, operation: query` (tool)
   - **Recommendation**: Option A - it's still read-only, URI can handle S-expressions

3. **Knowledge Graph Searches as Resources?**
   - ✅ YES: `resource://knowledge/search?query=auth`
   - ❌ NO: Keep as `search_knowledge_graph` tool
   - **Recommendation**: YES - classic read operation, saves 570 tokens

4. **Project Analysis as Resources?**
   - ✅ YES: `resource://project/{path}/structure`
   - ❌ NO: Keep as `analyze_project_structure` tool
   - **Recommendation**: YES - natural fit, saves 770 tokens

### 🟡 IMPLEMENTATION DECISIONS (Can adjust during development)

5. **Resource URI Hierarchy Style?**
   - Option A: `resource://file/{path}/ast` (file-centric, RESTful)
   - Option B: `resource://ast/{path}` (feature-centric)
   - **Recommendation**: Option A - matches mental model better

6. **Complex Query Parameters in URIs?**
   - Should S-expressions in ast_query be URL-encoded in URI?
   - **Recommendation**: Yes, standard URL encoding handles this

7. **Resource Caching Strategy?**
   - Should MCP server cache Resource responses?
   - **Recommendation**: Yes, with TTL based on file mtime (cache invalidation on file change)

---

## Implementation Plan (If Approved)

### Week 1: Resources Foundation
- [ ] Implement resource template handler architecture
- [ ] Create `resource://file/{path}/{aspect}` handler
- [ ] Migrate AST operations (symbols, imports, exports, structure, diagnostics)
- [ ] Add tests for resource parameter handling
- [ ] Update documentation

### Week 2: Expand Resources
- [ ] Implement `resource://project/{path}/{aspect}` handler
- [ ] Implement `resource://knowledge/{query}` handler
- [ ] Implement `resource://agent/{id_or_query}` handler
- [ ] Add caching layer for resources
- [ ] Performance testing

### Week 3: Tool Consolidation
- [ ] Consolidate Agent management tools
- [ ] Consolidate Knowledge mutation tools
- [ ] Consolidate Communication tools
- [ ] Regression testing

### Week 4: Migration & Cleanup
- [ ] Mark old tools as deprecated
- [ ] Update TOOL_LIST.md
- [ ] Create migration guide for users
- [ ] Remove deprecated tools after transition

---

## Questions for Review

1. **Is the Resources vs Tools distinction clear and correct?**
   - Resources = GET (read-only)
   - Tools = POST/PUT/DELETE (mutations)

2. **Are we over-optimizing for token cost at the expense of API usability?**
   - Resource URIs might be less intuitive than tool names
   - Counter-argument: URIs are standard (HTTP/REST), widely understood

3. **Should we keep ANY commonly-used operations as Tools for convenience?**
   - Example: Keep `get_symbols` as a tool alias that internally reads resource?
   - Trade-off: Convenience vs token efficiency

4. **What's the risk if MCP protocol changes resource handling in the future?**
   - MCP is still evolving (v1.x)
   - Mitigation: Implement abstraction layer for easy migration

5. **Should we provide BOTH Resources and Tools during transition?**
   - Safer migration but doubles registration cost temporarily
   - Or force-switch with good documentation?

---

## Approval Needed

**This decision affects**:
- API design for all future MCP functionality
- Token budget for system prompts
- LLM interaction patterns
- Migration path for existing tools

**Please review and approve**:
- [ ] Overall Resources vs Tools strategy
- [ ] Specific categories to convert (AST, Project, Knowledge, Agent)
- [ ] URI naming conventions
- [ ] Migration/deprecation timeline

**Sign-off**:
- [ ] Architect: _____________
- [ ] Technical Lead: _____________
- [ ] Date: _____________

---

## Alternative Considered: "Do Nothing"

**If we don't implement this**:
- Current: ~105 tools × 200 tokens = 21,000 tokens in registration
- Hits Cursor's 50 tool limit (need to disable other MCP servers)
- Can't add new functionality without removing existing tools
- Context window mostly consumed by tool registration, not work

**Verdict**: Not viable for production use

---

## References

- MCP Protocol Spec: https://modelcontextprotocol.io/
- MCP Resources Documentation: https://modelcontextprotocol.io/docs/concepts/resources
- Cursor MCP Tool Limit: 50 tools (hard limit)
- REST API Design: https://restfulapi.net/
- Token estimation: ~150-300 per tool, ~30 per resource template
