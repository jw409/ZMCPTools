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

# Build
npm run build
```

### Configure Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "zmcp-tools": {
      "command": "node",
      "args": ["/path/to/ZMCPTools/dist/index.js"],
      "env": {}
    }
  }
}
```

## 📚 Documentation

**See [TOOL_LIST.md](./TOOL_LIST.md) for complete tool documentation.**

Key documentation:
- **[TOOL_LIST.md](./TOOL_LIST.md)** - All available MCP tools and their usage
- **Talent System** - See "Talent Profile System" section below

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

## 📜 License

MIT License - see LICENSE file for details.
