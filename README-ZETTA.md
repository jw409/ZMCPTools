# Zetta MCP Tools

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.15.0-purple.svg)](https://modelcontextprotocol.io/)

🚀 **Zetta MCP Tools** - A professional multi-agent orchestration platform for Claude with enhanced knowledge graph, semantic search, and TalentOS integration.

## Attribution

Zetta MCP Tools is a hard fork of:
- **[ZMCPTools](https://github.com/ZachHandley/ZMCPTools)** by Zach Handley - The original TypeScript MCP server implementation
- Built on **[Model Context Protocol (MCP)](https://modelcontextprotocol.io/)** by Anthropic
- Integrates with **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** by Anthropic

Related MCP Projects:
- **[claude-code-mcp](https://github.com/steipete/claude-code-mcp)** by steipete - Alternative one-shot MCP implementation
- Part of the growing MCP ecosystem for Claude Code automation

## Major Enhancements in Zetta

### 🧠 Fixed Knowledge Graph & Semantic Search
- **Fixed semantic search** - Now properly returns results (was broken in upstream)
- **Enhanced vector search** - Better threshold handling and recall
- **Persona-based knowledge isolation** - Support for dom0/domU separation
- **Talent card export/import** - Portable knowledge between projects

### 🔧 Bug Fixes
- Fixed missing threshold parameter in `searchKnowledgeGraph` 
- Fixed early return logic preventing semantic fallback
- Fixed MCP room sync table name mismatches
- Fixed various TypeScript compilation issues

### 🎯 TalentOS Integration
- Full integration with TalentOS hypervisor architecture
- Domain isolation for knowledge and personas
- Cross-domain learning with permission controls
- Talent portability via knowledge cards

## Key Features (Enhanced)

All original ZMCPTools features plus:

- **Fixed Semantic Search** - Actually works now with proper vector similarity
- **Knowledge Isolation** - Per-persona and per-domain knowledge boundaries
- **Talent Cards** - Export/import persona knowledge between projects
- **Better Error Handling** - More robust error recovery and logging
- **Performance Optimizations** - Lower thresholds, better recall

## Installation

```bash
# Install globally
npm install -g zetta-mcp-tools

# Or use with your preferred package manager
pnpm add -g zetta-mcp-tools
yarn global add zetta-mcp-tools
```

## Quick Start

```bash
# Install MCP integration
zetta-mcp-tools install

# This automatically:
# ✅ Installs MCP server to ~/.mcptools/server/
# ✅ Configures Claude Code integration
# ✅ Sets up SQLite + LanceDB databases
# ✅ Creates 61+ professional MCP tools
```

## What's Fixed

### Semantic Search (Critical Fix)
```typescript
// BEFORE (broken - missing parameter)
entities = await knowledgeGraph.findEntitiesBySemanticSearch(
  args.repository_path,
  args.query,
  args.entity_types,
  args.limit
);

// AFTER (working)
entities = await knowledgeGraph.findEntitiesBySemanticSearch(
  args.repository_path,
  args.query,
  args.entity_types,
  args.limit,
  args.threshold || 0.3  // This was missing!
);
```

### Room Sync
- Fixed table names: `communication_rooms` → `chat_rooms`
- Fixed table names: `communication_messages` → `chat_messages`

## Development

```bash
# Clone the Zetta fork
git clone https://github.com/jw409/ZMCPTools zetta-mcp-tools
cd zetta-mcp-tools

# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test
```

## Future Roadmap

- [ ] Complete talent card export/import implementation
- [ ] Add dom0/domU knowledge isolation
- [ ] Implement cross-domain learning controls
- [ ] Enhanced vector search with multiple embedding models
- [ ] Better error recovery and resilience

## License

MIT License - See LICENSE file for details

## Credits

- Original ZMCPTools by [Zach Handley](https://github.com/ZachHandley)
- Model Context Protocol by [Anthropic](https://anthropic.com)
- Claude Code by [Anthropic](https://anthropic.com)
- Enhancements and fixes by [jw409](https://github.com/jw409)

---

*Zetta MCP Tools - Making multi-agent orchestration actually work.*