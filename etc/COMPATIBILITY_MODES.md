# MCP Server Compatibility Modes

**Last Updated**: October 11, 2025
**Source**: `src/server/McpServer.ts` lines 649-701

## Overview

The MCP server has **4 operation modes** that control which tools are available:

1. **Standard Mode** (no flags) - For Claude Desktop/CLI
2. **OpenRouter Mode** (`--openrouter-compat`) - For OpenRouter remote agents
3. **Gemini Mode** (`--gemini-compat`) - For Gemini native integration
4. **Agent Mode** (`--include-agent-tools`) - For multi-agent coordination

These modes are **mutually exclusive** (except role-based filtering which applies to all).

---

## Tool Availability Matrix

| Tool Category | Standard | OpenRouter | Gemini | Agent | Count |
|--------------|----------|------------|--------|-------|-------|
| **Base Tools** (always available) |
| Knowledge graph tools | ✅ | ✅ | ✅ | ✅ | 10 |
| GPU search tools | ✅ | ✅ | ✅ | ✅ | 4 |
| Symbol indexing | ✅ | ✅ | ✅ | ✅ | 1 |
| **Mode-Specific Tools** |
| SharedState tools | ✅ | ❌ | ❌ | ✅ | 4 |
| FileSystem tools | ❌ | ✅ | ❌ | ❌ | 2 |
| Meta MCP tools | ❌ | ❌ | ✅ | ❌ | ? |
| **Total (before RBAC)** | 19 | 17 | 16+ | 19+ |

---

## Base Tools (Always Available)

These tools are available in **all modes**:

### Knowledge Graph Tools (10 tools)
From `KnowledgeGraphMcpTools` + `gpuKnowledgeTools`:
- `store_knowledge_memory` - Store facts/entities
- `create_knowledge_relationship` - Create relationships
- `search_knowledge_graph_gpu` - GPU-accelerated graph search
- `update_knowledge_entity` - Update entities
- `prune_knowledge_graph` - Remove stale data
- `compact_knowledge_graph` - Optimize storage
- `export_knowledge_graph` - Export graph data
- `wipe_knowledge_graph` - Clear all data
- `knowledge_graph_status` - Get statistics
- `switch_knowledge_mode` - Toggle GPU/CPU

### GPU Search Tools (4 tools)
From `getGPUSearchTools()`:
- `search_knowledge` - Semantic search across collections
- `index_document` - Add documents to vector store
- `list_collections` - Discover available collections
- `get_collection_stats` - Monitor collection health

### Symbol Indexing (1 tool)
From `indexSymbolGraphTool`:
- `index_symbol_graph` - Parse and index code symbols

**Total Base: 15 tools**

---

## Mode-Specific Tools

### SharedState Tools (Standard + Agent modes only)

**Condition**: `if (!openrouterCompat && !geminiCompat)`
**Source**: `SharedStateTools.getTools()`
**Purpose**: Multi-agent coordination (internal agents only)

Tools (4):
- `todo_write` - Write/update shared todos
- `todo_read` - Read shared todos with filtering
- `broadcast_progress` - Broadcast task progress
- `register_artifact` - Register created artifacts

**Why excluded from compat modes?**
These are for internal agent-to-agent coordination. Remote agents (OpenRouter/Gemini) should use their own task management, not our internal coordination system.

### FileSystem Tools (OpenRouter mode only)

**Condition**: `if (openrouterCompat)`
**Source**: `FileSystemTools.getTools()`
**Purpose**: File I/O for remote agents without MCP resource support

Tools (2):
- `read_file` - Read file contents
- `write_file` - Write file contents

**Why OpenRouter only?**
- Standard mode uses MCP resources (`file://*/` URIs) which are more token-efficient
- OpenRouter agents may not support MCP resources properly
- Gemini has its own file handling via `getMetaMcpTools()`

### Meta MCP Tools (Gemini mode only)

**Condition**: `if (geminiCompat)`
**Source**: `getMetaMcpTools(this.resourceManager)`
**Purpose**: Access MCP resources as tools for Gemini compatibility

Tools: TBD (count unknown)

**Why Gemini only?**
Gemini's tool calling interface may not support native MCP resources, so we expose them as tools instead.

---

## Role-Based Access Control (RBAC)

**After** mode-specific tools are added, **role-based filtering** is applied:

```typescript
if (this.capabilityManager && this.options.role) {
  const filteredTools = this.capabilityManager.filterToolsByRole(tools, this.options.role);
  return filteredTools;
}
```

See `talent-os/etc/agent_capabilities.json` for role definitions.

### Role Examples

**Testing role** (most restrictive):
- Allowed: `read_file`, `search_knowledge`, `list_collections`, `get_collection_stats`
- Denied: `write_file`, `index_document`, all SharedState tools
- Result: 4 tools (in openrouter-compat mode)

**Backend role** (full access):
- Allowed: All base tools + `read_file`, `write_file`, `index_document`
- Denied: None
- Result: 17+ tools

**Dom0 role** (unrestricted):
- Allowed: `*` (wildcard - all tools)
- Denied: None
- Result: All tools available

---

## Usage Examples

### Standard Mode (Claude Desktop)
```bash
node dist/server/index.js
# Tools: Base (15) + SharedState (4) = 19 tools
# Uses MCP resources (file://, project://) for file I/O
```

### OpenRouter Mode (Remote Agent)
```bash
node dist/server/index.js --role testing --openrouter-compat
# Tools: Base (15) + FileSystem (2) = 17 tools
# Then RBAC filters to: 4 tools (read_file, search_knowledge, list_collections, get_collection_stats)
```

### Gemini Mode (Gemini Native)
```bash
node dist/server/index.js --role backend --gemini-compat
# Tools: Base (15) + Meta MCP (?) = 16+ tools
# Then RBAC filters by backend role
```

### Agent Mode (Multi-Agent System)
```bash
node dist/server/index.js --role dom0 --include-agent-tools
# Tools: Base (15) + SharedState (4) + Agent-specific = 19+ tools
# Dom0 role = no RBAC filtering (all tools available)
```

---

## Implementation Details

### Source Code Location
**File**: `ZMCPTools/src/server/McpServer.ts`
**Method**: `getAvailableTools()` (lines 649-701)

### Tool Assembly Order
1. **Base tools** (always added)
   - Knowledge graph (lines 656-657)
   - GPU search (line 664)
   - Symbol indexing (line 668)

2. **Conditional tools** (mode-specific)
   - SharedState: `if (!openrouterCompat && !geminiCompat)` (lines 671-675)
   - FileSystem: `if (openrouterCompat)` (lines 677-680)
   - Meta MCP: `if (geminiCompat)` (lines 682-685)
   - Agent tools: `if (includeAgentTools)` (lines 687-691) [TODO]

3. **RBAC filtering** (if role specified)
   - Filter by `agent_capabilities.json` (lines 693-698)

### Debugging
The server logs tool counts:
```
DEBUG: this.options.openrouterCompat is: true
🔐 Filtered tools for role 'testing': 4/17 tools available
```

---

## Design Rationale

### Why Mode-Specific Tools?

**Problem**: Different AI platforms have different capabilities and security requirements.

**Solution**: Conditional tool loading based on deployment context:

1. **Standard mode** uses MCP resources (97% token reduction)
2. **OpenRouter mode** uses FileSystem tools (resource support unclear)
3. **Gemini mode** wraps resources as tools (native integration)
4. **Agent mode** adds coordination tools (internal agents only)

### Why Exclude SharedState from Compat Modes?

**Security**: Remote agents shouldn't access internal coordination system
**Separation**: External agents use their own task management
**Simplicity**: Reduces attack surface for remote agents

### Why Include FileSystem in OpenRouter Only?

**Compatibility**: OpenRouter clients may not support MCP resources
**Necessity**: Agents need file I/O for code analysis tasks
**Not Gemini**: Gemini has Meta MCP tools for resource access

---

## Migration Guide

### From Legacy Tool Names
Old tool names with `mcp__zmcp-tools__` prefix have been removed:

| Old Name | New Name |
|----------|----------|
| `mcp__zmcp-tools__store_knowledge_memory` | `store_knowledge_memory` |
| `mcp__zmcp-tools__create_knowledge_relationship` | `create_knowledge_relationship` |
| `mcp__zmcp-tools__search_knowledge_graph_gpu` | `search_knowledge_graph_gpu` |
| `mcp__zmcp-tools__todo_write` | `todo_write` |
| `mcp__zmcp-tools__todo_read` | `todo_read` |
| `mcp__zmcp-tools__broadcast_progress` | `broadcast_progress` |
| `mcp__zmcp-tools__register_artifact` | `register_artifact` |

**Action Required**: Update `talent-os/etc/agent_capabilities.json` to use new names (✅ Done Oct 11, 2025)

---

## Future Work

### Phase 3: Agent Tools
- **Issue**: Line 687-691 has TODO for `--include-agent-tools` flag
- **Purpose**: Load tools from `AGENT_TOOL_LIST.md` for multi-agent systems
- **Status**: Placeholder only, not yet implemented

### Phase 4: Dynamic Tool Loading
- **Goal**: Load tools dynamically based on configuration files
- **Benefit**: Avoid recompilation when adding new tools
- **Status**: Future enhancement

---

## Verification

To verify which tools are available in each mode:

```bash
# Test OpenRouter mode
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}
{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}' | \
node dist/server/index.js --role testing --openrouter-compat 2>&1 | \
grep -E '"name":'

# Expected: 4 tools (read_file, search_knowledge, list_collections, get_collection_stats)
```

---

**Questions?** See implementation in `src/server/McpServer.ts` or security docs in `SECURITY_IMPLEMENTATION.md`.
