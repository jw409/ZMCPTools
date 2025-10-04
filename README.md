# ZMCPTools

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.15.0-purple.svg)](https://modelcontextprotocol.io/)

**MCP server for multi-agent orchestration with named talent personas, knowledge graphs, and TalentOS integration.**

## What is this?

ZMCPTools is a TypeScript MCP (Model Context Protocol) server that enables AI agents to coordinate as **talents** - named personas with memory, learning capabilities, and distinct specializations. Think "Backend Boris" instead of "agent_42".

**Core capabilities:**
- **Talent Profile System**: Named AI personas with token-efficient, modular file structures
- **Knowledge Graph**: Cross-agent memory and learning with vector search
- **Multi-Agent Coordination**: Spawn, coordinate, and manage specialized agent teams
- **Filesystem-First**: All state is observable files (crash-safe, human-readable)
- **TalentOS Integration**: Designed for learning/scavenger/teacher systems

Built for developers creating AI agent systems where agents need to learn, remember, and work together effectively.

## 🔱 Fork Status

**This is a fork of [ZachHandley/ZMCPTools](https://github.com/ZachHandley/ZMCPTools)** focused on TalentOS architecture and agent personas.

### What Changed from Upstream:

**Added:**
- **Talent Profile System** - Named personas (Backend Boris, Frontend Felix, etc.) with modular profiles
- **Learning/Memory Architecture** - Foundation for cross-project talent knowledge accumulation
- **Token-Efficient Design** - Load only needed context files to manage LLM token limits

**Removed:**
- **Browser Automation** - Use external submodule ([playwright-mcp](https://github.com/jw409/playwright-mcp)) for cleaner separation
- **Database Complexity** - Simplified schema focused on agent coordination, not web scraping

**Why the Changes:**
- Focus on agent orchestration, not general-purpose tooling
- Modular architecture via MCP submodules (browser, docs, etc. as separate servers)
- Prepare for TalentOS learning/scavenger/teacher integration

**Maintained from Upstream:**
- Multi-agent orchestration core
- Knowledge graph and shared memory
- Task and execution plan management
- Agent communication rooms
- MCP protocol implementation

**Upstream**: https://github.com/ZachHandley/ZMCPTools | **This Fork**: https://github.com/jw409/ZMCPTools

## 🏗️ Architecture: Dual MCP Server Design

ZMCPTools implements **two separate MCP server binaries** to prevent namespace pollution:

### Dom0 (Global Orchestrator)
- **Binary**: `dist/server/index.js`
- **Purpose**: Main Claude instance orchestration tools
- **Tools**: Agent spawning, knowledge graph, project analysis, file operations
- **Used By**: Primary Claude Code instance

### DomU (Talent Coordination)
- **Binary**: `dist/talent-server/index.js`
- **Purpose**: Talent-specific coordination tools ONLY
- **Tools**: Email, meetings (inter-talent communication)
- **Used By**: Individual spawned talent agents

**Why Separate Servers?**
- Prevents talent coordination tools from polluting global tool list
- Reduces token usage in main Claude instance
- Each talent gets isolated server instance with `--talent-id` parameter
- "Never cross the streams" - strict layer boundary enforcement

See [AGENT_TOOL_LIST.md](./AGENT_TOOL_LIST.md) for complete tool breakdown.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Claude Code CLI

### Installation

```bash
# Clone the repository
git clone git@github.com:jw409/ZMCPTools.git
cd ZMCPTools

# Install dependencies
npm install

# Build both servers
npm run build
```

### Configure Claude Code

#### Global Server (Dom0)

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "zmcp-tools": {
      "command": "node",
      "args": ["/path/to/ZMCPTools/dist/server/index.js"],
      "env": {}
    }
  }
}
```

#### Talent Server (DomU)

When spawning talents programmatically:

```bash
# Stdio transport (for MCP client)
node dist/talent-server/index.js --talent-id backend-boris-001

# HTTP transport (for testing)
node dist/talent-server/index.js \
  --talent-id frontend-felix-001 \
  --transport http \
  --port 4270

# With explicit coordination root
node dist/talent-server/index.js \
  --talent-id testing-tina-001 \
  --coordination-root /path/to/project
```

## 📚 Documentation

**Key Documentation Files:**

- **[TOOL_LIST.md](./TOOL_LIST.md)** - Complete dom0 (global orchestrator) tool documentation
- **[AGENT_TOOL_LIST.md](./AGENT_TOOL_LIST.md)** - Complete domU (talent coordination) tool documentation
- **Talent System** - See "Talent Profile System" section below
- **Resources vs Tools** - See [GitHub Issue #35](https://github.com/jw409/ZMCPTools/issues/35) for migration details

## 🔍 MCP Resources (Token-Optimized)

ZMCPTools now supports **MCP Resources** for read-only operations, providing massive token savings compared to traditional Tools.

### Why Resources?

**Token Cost Comparison:**
- **Traditional Tool**: ~200 tokens per tool registration
- **MCP Resource**: ~30 tokens per resource template
- **Savings**: **97% reduction** for read operations

**Example:** 6 AST analysis tools (1,200 tokens) → 1 resource template (30 tokens) = **1,170 tokens saved**

### File Resources (AST Operations)

Access file analysis via URI-based resources instead of tools:

```typescript
// ❌ OLD: Tools (200 tokens each × 6 = 1,200 tokens)
ast_extract_symbols({ file_path: "src/index.ts" })
ast_extract_imports({ file_path: "src/index.ts" })
ast_extract_exports({ file_path: "src/index.ts" })

// ✅ NEW: Resources (30 tokens for all 6 operations)
resource://file/src/index.ts/symbols
resource://file/src/index.ts/imports
resource://file/src/index.ts/exports
resource://file/src/index.ts/structure
resource://file/src/index.ts/diagnostics
resource://file/src/index.ts/ast?compact=true&use_symbol_table=true
```

### Available File Resources

| Resource URI | Description | Query Parameters |
|--------------|-------------|------------------|
| `file://{path}/symbols` | Extract functions, classes, methods | `include_positions=true` |
| `file://{path}/imports` | Extract import statements | - |
| `file://{path}/exports` | Extract export statements | - |
| `file://{path}/structure` | Get file outline (Markdown) | - |
| `file://{path}/diagnostics` | Get parse errors | - |
| `file://{path}/ast` | Full AST with optimizations | `compact=true`, `use_symbol_table=true`, `max_depth=3` |

### Query Parameters for AST Resources

Optimize token usage with query parameters:

```typescript
// Compact AST with symbol table (30-50% token reduction)
resource://file/src/app.ts/ast?compact=true&use_symbol_table=true&max_depth=3

// Full symbols with position info
resource://file/src/utils.ts/symbols?include_positions=true

// Quick structure overview (Markdown format)
resource://file/src/index.ts/structure
```

**Available Parameters:**
- `compact=true` - Filter syntactic noise nodes
- `use_symbol_table=true` - Use symbolic representation (30-50% smaller)
- `max_depth=N` - Limit tree depth for quick overviews
- `include_semantic_hash=true` - Add hash for duplicate detection
- `omit_redundant_text=true` - Skip text from simple nodes

### Migration from Tools to Resources

**Deprecated Tools** (during transition period):
- `ast_analyze` tool is deprecated - use `file://` resources instead
- Old tools still work but show deprecation warnings
- See [GitHub Issue #35](https://github.com/jw409/ZMCPTools/issues/35) for migration timeline

**Benefits of Migration:**
- 97% token reduction for system prompts
- Fits under Cursor's 50 tool limit
- More intuitive URI-based access
- Better caching and performance

### Project Resources (Phase 2 ✅)

**2 project analysis operations now cost 30 tokens instead of 400 tokens!**

| Resource URI Template | Description | Query Parameters |
|----------------------|-------------|------------------|
| `project://{path}/structure` | Get directory tree with smart ignore patterns | `max_depth`, `exclude` |
| `project://{path}/summary` | AI-optimized project overview | `include_readme`, `include_package_info`, `include_git_info` |

**Example Usage:**
```typescript
// Get project structure with custom depth
resource://project/./structure?max_depth=3&exclude=node_modules,dist

// Get full project summary
resource://project/./summary?include_readme=true&include_git_info=true
```

**Query Parameters:**
- `max_depth=N` - Maximum directory depth (default: 5)
- `exclude=pattern1,pattern2` - Comma-separated ignore patterns
- `include_readme=true|false` - Include README.md content
- `include_package_info=true|false` - Include package.json/setup.py
- `include_git_info=true|false` - Include git branch/status

**Deprecated Tools:**
- `analyze_project_structure` → use `project://{path}/structure`
- `generate_project_summary` → use `project://{path}/summary`
- `list_files` → use Glob tool instead (more efficient)
- `analyze_file_symbols` → use `file://{path}/symbols` from Phase 1

### Knowledge Graph Resources (Phase 3 ✅)

**Search and navigate knowledge efficiently with 3 resource URIs:**

| Resource URI | Use Case | Key Parameters |
|-------------|----------|----------------|
| `knowledge://search` | Hybrid BM25 + semantic search | `query`, `limit=10`, `threshold=0.7`, `use_bm25=true`, `use_embeddings=true` |
| `knowledge://entity/{id}/related` | Find related entities | `limit=10`, `min_strength=0.5` |
| `knowledge://status` | Graph health & statistics | - |

**Usage Examples:**

```typescript
// Semantic + keyword search
await readResource('knowledge://search?query=authentication&limit=10&threshold=0.7')

// Find what's related to an entity
await readResource('knowledge://entity/auth-123/related?limit=5&min_strength=0.6')

// Check graph health
await readResource('knowledge://status')
```

**Keep Using (Mutation Tools):**
- `store_knowledge_memory` - Create entities
- `create_knowledge_relationship` - Link entities
- `update_knowledge_entity` - Modify entities
- `prune_knowledge_memory` - Remove low-quality data
- `compact_knowledge_memory` - Deduplicate
- `export_knowledge_graph` - Backup data
- `wipe_knowledge_graph` - Clear all (destructive)

### Agent Status Resources (Phase 4 ✅)

**Monitor and manage spawned agents with 2 resource URIs:**

| Resource URI | Use Case | Key Parameters |
|-------------|----------|----------------|
| `agents://list` | List all agents with filtering | `status=active/completed/failed/terminated`, `type=backend/frontend/testing`, `limit=50` |
| `agents://{id}/status` | Get detailed agent status | - |

**Usage Examples:**

```typescript
// List active backend agents
await readResource('agents://list?status=active&type=backend&limit=20')

// Get detailed status for specific agent
await readResource('agents://agent-123/status')
```

**Keep Using (Mutation Tools):**
- `spawn_agent` - Create new agents
- `terminate_agent` - Stop agents
- `monitor_agents` - Set up real-time monitoring
- `cleanup_stale_agents` - Remove dead agents

### Cleanup & Optimization (Phases 5-8 ✅)

**Architectural cleanup and description improvements:**

- **Phase 5**: Removed communication resources from dom0 (belong in domU talent server only)
- **Phase 6**: Removed docs/scraping resources from dom0 completely
- **Phase 7**: Enhanced vector resource descriptions (collections/search/status) with actionable guidance
- **Phase 8**: Enhanced logs resource descriptions (list/files/content) with emoji-prefixed use cases

All resource descriptions now follow consistent pattern: 🔍 USE CASE + practical examples + when to use

## 🎭 Talent Profile System

ZMCPTools implements a **token-efficient, modular talent profile system** for creating AI agent personas.

### File Structure (Token-Efficient)

```
var/talents/{talent-id}/
├── talent_card.json           # COMPACT core (always load) <100 lines
├── README.md                  # Human-readable overview
├── status.json                # Current state (lightweight checks)
├── prompt_specialization.md   # LLM behavior (load on spawn)
├── capabilities.md            # Detailed capabilities (load on demand)
├── collaboration.md           # Cross-talent coordination (load on demand)
├── philosophy.md              # Decision-making principles (load on demand)
├── knowledge/                 # Learning system (FUTURE: Issue #28+)
├── scavenger_insights/        # Failure analysis (FUTURE: Issue #30+)
└── teacher_downloads/         # Knowledge downloads (FUTURE: Issue #32+)
```

### Example Talents

Four example talent instances are provided:

**Backend Boris** (`backend-boris-001`)
- *"Clean APIs, happy developers!"*
- Core Persistent, Security-First mindset
- Python, API design, authentication, game logic

**Frontend Felix** (`frontend-felix-001`)
- *"Pixels perfect, performance pristine!"*
- Core Persistent, UX-First mindset
- React, TypeScript, responsive design, accessibility

**Product Manager Pat** (`product-manager-pat-001`)
- *"Vision to reality, one sprint at a time!"*
- Core Persistent, Strategic coordination
- Roadmap planning, feature prioritization, cross-team coordination

**QA Automation Quinn** (`qa-automation-quinn-001`)
- *"Automate the repetitive, focus on the creative!"*
- Intermittent, Comprehensive coverage mindset
- Test automation, E2E testing, CI/CD integration

### Talent Maturity Levels

1. **Baby**: Prompt-only, no memory (stateless LLM wrapper)
2. **Junior**: Project-local learning, references past work in THIS project
3. **Mid**: Cross-project memory, learns from ALL projects
4. **Senior**: Scavenger-enhanced, identifies blind spots and optimizations
5. **Expert**: Teacher-integrated, receives knowledge downloads, can teach others

### Usage Example

```typescript
import { createTalentProfileService } from './src/services/TalentProfileService.js';

const service = createTalentProfileService();

// Lightweight card load (most common)
const card = await service.getTalentCard('backend-boris-001');

// Check availability
const status = await service.getTalentStatus('backend-boris-001');

// Full load (use sparingly - high token cost)
const fullProfile = await service.getTalentFull('backend-boris-001');

// Update status
await service.updateTalentStatus('backend-boris-001', {
  status: 'active',
  current_task: 'Implementing OAuth API',
});

// Promote talent maturity
await service.promoteTalent('backend-boris-001', 'junior');
```

### Design Rationale

**Why Modular Files?**
- LLMs have token limits - load only what you need
- `talent_card.json` is ~35 lines, ultra-compact
- Philosophy/capabilities loaded only when needed
- Status checks don't require full context

**Why Named Personas?**
- "Backend Boris" gives LLM a character to embody
- Alliterative names (B-B, F-F) are memorable
- Personalities make prompts more effective than "backend-expert-001"

**Implemented in Issue #27**: Filesystem-based talent profile system foundation

### Talent Coordination (DomU Tools)

Talents use **separate MCP server instances** with coordination-specific tools:

**Email System** (`var/coordination/{talent-id}/inbox/`)
- Filesystem-based pseudo-email using talent IDs (not real addresses)
- Atomic JSON files for crash-safe async coordination
- Tools: `send_email`, `check_inbox`, `process_email`, `get_email`
- **Issue #28**: Filesystem-based email implementation

**Meeting Simulation** (`var/meetings/{date}/{meeting-id}.meeting`)
- Simulated meeting coordination for talent collaboration
- Atomic file writes with meeting minutes, decisions, action items
- Tools: `join_meeting`, `speak_in_meeting`, `leave_meeting`, `get_meeting_status`
- **Issue #29**: Meeting simulation implementation

**Coordination Root Resolution**
- Cooperative registration via `/tmp/zmcp-coordination-root.json`
- Ensures talents from different directories can communicate
- 4-tier priority: CLI arg → env var → registry file → CWD

See [AGENT_TOOL_LIST.md](./AGENT_TOOL_LIST.md) for complete domU tool documentation.

## 📜 License

MIT License - see LICENSE file for details.
