---
verify: ZMCP_TOOLS_v3.0_LOADED
version: 3.0
type: mcp_integration
storage: ~/.mcptools/data/
vector_db: ~/.mcptools/lancedb/
authoritative:
  docs: etc/META_DOCUMENTATION_MAP.md
  github: etc/GITHUB_ISSUES.md
  tools: etc/TOOL_LIST.md
  agent_tools: etc/AGENT_TOOL_LIST.md
  resources: etc/RESOURCE_REGISTRY.md
rules:
  prefer_resources: MCP resources over tools (97% token reduction)
  gpu_search: Port 8765 required for semantic search
discovery:
  mcp: ListMcpResourcesTool → ReadMcpResourceTool
  tools: cat ZMCPTools/etc/TOOL_LIST.md
  removed: [orchestration, communication, plan_management, web_scraping]
---

# ZMCPTools MCP Integration v3.0

## Discovery Protocol

**Progressive discovery** (load on demand, not upfront):
1. Read `etc/TOOL_LIST.md` to see available tools
2. Call specific tools when needed
3. Full documentation in etc/TOOL_LIST.md (not in tool registration)

**MCP Resources** (primary):
- `ListMcpResourcesTool` - See available resources
- `ReadMcpResourceTool` - Read specific resources

**Documentation & References** (authoritative):
- `cat etc/TOOL_LIST.md` - MCP tool catalog (READ FIRST for tool discovery)
- `cat etc/AGENT_TOOL_LIST.md` - Agent tool catalog
- `cat etc/RESOURCE_REGISTRY.md` - MCP resource registry
- `cat etc/META_DOCUMENTATION_MAP.md` - Documentation index
- `cat etc/GITHUB_ISSUES.md` - GitHub labels & issue protocol
- `cat etc/decisions/` - Design decision rationale
- `cat etc/test-plans/` - Test criteria & validation

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

**Progressive discovery**: Load full docs via `cat ZMCPTools/etc/TOOL_LIST.md`
**Token reduction**: 87% vs v2.0 (182 vs 1,402 words)
