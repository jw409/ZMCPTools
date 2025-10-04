# MCP Tool Consolidation Analysis

## Problem Statement

**Token Cost Crisis**: Each MCP tool registration sends to the LLM:
- Tool name (~10 tokens)
- Tool description (~30-50 tokens)
- Full JSON Schema for inputs (~80-150 tokens)
- Output schema if provided (~50-100 tokens)

**Total per tool: ~150-300 tokens**

With Cursor's hard limit of **~50 MCP tools total**, tool proliferation creates:
1. Massive system prompt bloat
2. Reduced context window for actual work
3. Hit tool limits quickly across multiple MCP servers

## AST Tools: Case Study (COMPLETED ✅)

### Before Consolidation
**8 separate tools:**
- `ast_parse` - Parse source to AST
- `ast_query` - Query with S-expressions
- `ast_extract_symbols` - Extract functions/classes
- `ast_extract_imports` - Extract imports
- `ast_extract_exports` - Extract exports
- `ast_find_pattern` - Find code patterns
- `ast_get_structure` - Get outline
- `ast_get_diagnostics` - Get syntax errors

**Cost**: 8 × ~150 tokens = **~1,200 tokens**

### After Consolidation
**1 unified tool:**
```typescript
{
  name: "ast_analyze",
  operation: enum["parse", "query", "extract_symbols", "extract_imports",
                   "extract_exports", "find_pattern", "get_structure", "get_diagnostics"]
}
```

**Cost**: 1 × ~200 tokens = **~200 tokens**

**Savings**: **1,000 tokens (83% reduction)** + **7 tool slots freed**

## Pattern Recognition: Categories for Consolidation

### 1. Project Analysis Tools (7 tools → 2 tools)
**Current separate tools:**
- `analyze_project_structure`
- `generate_project_summary`
- `analyze_file_symbols`
- `list_files`
- `find_files`
- `easy_replace`
- `cleanup_orphaned_projects`

**Proposed consolidation:**
- `project_analyze` (operations: structure, summary, symbols)
- `file_ops` (operations: list, find, replace, cleanup)

**Estimated savings**: 5 tools, ~750 tokens

### 2. Agent Orchestration Tools (13 tools → 3 tools)
**Current separate tools:**
- `orchestrate_objective`
- `orchestrate_objective_structured`
- `spawn_agent`
- `create_task`
- `list_agents`
- `terminate_agent`
- `monitor_agents`
- `continue_agent_session`
- `cleanup_stale_agents`
- `cleanup_stale_rooms`
- `run_comprehensive_cleanup`
- `get_cleanup_configuration`
- `get_agent_results`

**Proposed consolidation:**
- `agent_manage` (operations: spawn, terminate, continue, list, get_results)
- `agent_orchestrate` (operations: objective, structured_objective, create_task)
- `agent_cleanup` (operations: agents, rooms, comprehensive, get_config)

**Estimated savings**: 10 tools, ~1,500 tokens

### 3. Knowledge Graph Tools (10 tools → 2 tools)
**Current separate tools:**
- `store_knowledge_memory`
- `create_knowledge_relationship`
- `search_knowledge_graph`
- `find_related_entities`
- `prune_knowledge_memory`
- `compact_knowledge_memory`
- `get_memory_status`
- `update_knowledge_entity`
- `export_knowledge_graph`
- `wipe_knowledge_graph`

**Proposed consolidation:**
- `knowledge_ops` (operations: store, update, search, find_related, export, wipe)
- `knowledge_maintenance` (operations: prune, compact, get_status)

**Estimated savings**: 8 tools, ~1,200 tokens

### 4. Browser Tools (12 tools → 3 tools)
**Current separate tools:**
- `create_browser_session`
- `navigate_and_scrape`
- `interact_with_page`
- `manage_browser_sessions`
- `perform_dynamic_interaction`
- `navigate_to_url`
- `scrape_content`
- `take_screenshot`
- `execute_browser_script`
- `interact_with_element`
- `close_browser_session`
- `list_browser_sessions`

**Proposed consolidation:**
- `browser_session` (operations: create, close, list, manage)
- `browser_navigate` (operations: to_url, scrape, take_screenshot)
- `browser_interact` (operations: with_page, with_element, execute_script, dynamic)

**Estimated savings**: 9 tools, ~1,350 tokens

### 5. Communication Tools (10 tools → 2 tools)
**Current separate tools:**
- `join_room`
- `send_message`
- `wait_for_messages`
- `close_room`
- `delete_room`
- `list_rooms`
- `list_room_messages`
- `create_delayed_room`
- `analyze_coordination_patterns`
- `broadcast_message_to_agents`

**Proposed consolidation:**
- `room_ops` (operations: join, create, create_delayed, close, delete, list)
- `message_ops` (operations: send, wait, list, broadcast, analyze_patterns)

**Estimated savings**: 8 tools, ~1,200 tokens

## Total Potential Savings

| Category | Tools Before | Tools After | Tools Saved | Tokens Saved |
|----------|--------------|-------------|-------------|--------------|
| AST (DONE) | 8 | 1 | 7 | ~1,000 |
| Project Analysis | 7 | 2 | 5 | ~750 |
| Agent Orchestration | 13 | 3 | 10 | ~1,500 |
| Knowledge Graph | 10 | 2 | 8 | ~1,200 |
| Browser | 12 | 3 | 9 | ~1,350 |
| Communication | 10 | 2 | 8 | ~1,200 |
| **TOTAL** | **60** | **13** | **47** | **~7,000** |

**Overall Reduction: 78% fewer tools, 7,000+ tokens saved**

## Implementation Strategy

### Phase 1: AST Tools (✅ COMPLETED)
- Modified `TreeSitterASTTool.getTools()` to return single consolidated tool
- Updated `executeByToolName` to support both operation parameter and legacy tool names
- Backward compatible: internal code using `ast_extract_symbols` still works

### Phase 2: Project Analysis Tools (NEXT)
- Consolidate analyze/summary into `project_analyze`
- Consolidate file operations into `file_ops`

### Phase 3: Agent Tools
- High impact: 13 → 3 tools saves 1,500 tokens

### Phase 4: Knowledge Graph Tools
- Medium complexity, high value

### Phase 5: Browser & Communication Tools
- Lower priority, still significant savings

## Best Practices for Operation-Based Tools

### 1. Self-Documenting Enums
```typescript
operation: {
  type: "string",
  enum: ["parse", "query", "extract_symbols", ...],
  description: "parse=full tree, query=S-expression search, extract_symbols=functions/classes"
}
```

### 2. Optional Operation-Specific Parameters
```typescript
query: {
  type: "string",
  description: "Tree-sitter query (for operation=query only)"
}
```

### 3. Backward Compatibility
```typescript
// Support both new and legacy calls
const operation = args.operation || toolName.replace('prefix_', '');
```

### 4. Clear Operation Naming
- Use verbs: `parse`, `query`, `extract`, `search`
- Be consistent: `extract_symbols`, `extract_imports` (not `get_symbols`, `fetch_imports`)
- Match existing naming patterns in the codebase

## Migration Plan

### For Each Tool Category:
1. **Identify common parameters** across all tools in category
2. **Create operation enum** with clear, verb-based names
3. **Design unified schema** with required + optional params
4. **Implement operation switch** in handler
5. **Add backward compatibility** for legacy tool names
6. **Test thoroughly** before deprecating old tools
7. **Update documentation** with migration examples

### Testing Checklist:
- [ ] New consolidated tool works with all operations
- [ ] Legacy tool names still work (if supported)
- [ ] Internal code using old executeByToolName still works
- [ ] Build succeeds without TypeScript errors
- [ ] Tool count reduced in dist/server/index.js
- [ ] Token savings verified via grep analysis

## Success Metrics

### Immediate Wins (AST Consolidation ✅):
- ✅ 7 tool slots freed under Cursor's 50 tool limit
- ✅ ~1,000 tokens saved in system prompt
- ✅ Cleaner API: 1 tool instead of 8 to learn
- ✅ Easier maintenance: single schema to update

### Target State (Full Consolidation):
- 🎯 60 → 13 tools (78% reduction)
- 🎯 ~7,000 tokens saved (enough for ~3,500 words of actual context)
- 🎯 Well under Cursor's 50 tool limit (37 slots remaining for other MCP servers)
- 🎯 More semantic grouping (all AST ops in one tool, all agent ops together)

## Lessons Learned

### What Worked:
1. **Operation-based design** is the right pattern for related functionality
2. **Backward compatibility** via dual case statements enables safe migration
3. **Token measurement** proves the value (83% reduction is massive)
4. **Enum descriptions** make operations self-documenting

### Pitfalls to Avoid:
1. Don't consolidate **unrelated** functionality (e.g., mixing file ops with agent ops)
2. Don't create **mega-tools** with 20+ operations (split at logical boundaries)
3. Don't break **existing internal code** - support both patterns during transition
4. Don't skip **token measurements** - measure before/after to prove value

## Next Steps

1. ✅ Complete AST consolidation (DONE)
2. ⏳ Apply to Project Analysis tools (5 tools → 2 tools)
3. ⏳ Apply to Agent Orchestration (13 tools → 3 tools) - highest impact
4. ⏳ Document pattern for future tool development
5. ⏳ Add linting rule: "New tools must use operation-based design if >3 related operations"

## References

- MCP Protocol Spec: https://modelcontextprotocol.io/
- Cursor Tool Limits: 50 tools max across all MCP servers
- TreeSitterASTTool.ts: Reference implementation of consolidation pattern
- Token Estimation: ~150-300 tokens per tool registration

---

**Author**: Generated during ZMCPTools token optimization sprint
**Date**: 2025-10-03
**Status**: Phase 1 (AST) Complete ✅ | Phases 2-5 Pending ⏳
