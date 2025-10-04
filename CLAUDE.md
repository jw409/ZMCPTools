---
verify: ZMCP_TOOLS_v3.0_LOADED
version: 3.0
type: mcp_integration
storage: ~/.mcptools/data/
vector_db: ~/.mcptools/lancedb/
authoritative:
  tools: TOOL_LIST.md
  resources: etc/generated/MCP_RESOURCES.md
rules:
  prefer_resources: MCP resources over tools (97% token reduction)
  gpu_search: Port 8765 required for semantic search
discovery:
  mcp: ListMcpResourcesTool → ReadMcpResourceTool
  tools: cat ZMCPTools/TOOL_LIST.md
  removed: [orchestration, communication, plan_management, web_scraping]
---

# ZMCPTools MCP Integration v3.0

## Discovery Protocol

**MCP Resources** (primary):
- `ListMcpResourcesTool` - See available resources
- `ReadMcpResourceTool` - Read specific resources

**Tool catalog** (authoritative):
- `cat ZMCPTools/TOOL_LIST.md`

## Core Patterns

**Resources vs Tools**:
- Resources: Read-only (30 tokens) - `file://`, `project://`, `knowledge://`
- Tools: Mutations (200 tokens) - Create, update, delete

**Token optimization**: 97% reduction via resources

## Essential Services

**GPU embedding** (port 8765):
- Semantic search (10x faster)
- Check: `curl http://localhost:8765/health`
- Status: `knowledge://status`

**LanceDB**: Vector storage at `~/.mcptools/lancedb/`

## Quick Reference

**Analyze project**:
```
resource://project://./structure
```

**Semantic search**:
```
resource://knowledge://search?query=auth&limit=10
```

**Browser automation**:
```
create_browser_session() → perform_dynamic_interaction()
```

## Removed Tools

Orchestration (23), web scraping (9) - pending claude-agent-sdk

---

**Progressive discovery**: Load full docs via `cat ZMCPTools/TOOL_LIST.md`
**Token reduction**: 87% vs v2.0 (182 vs 1,402 words)
