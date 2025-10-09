# ZMCPTools - Complete Tool Reference

This document provides a comprehensive reference for all MCP tools and resources available in ZMCPTools.

⚠️  **AUTO-GENERATED** from source code by `npm run generate:docs`
Last generated: 2025-10-09T04:45:40.167Z

## ⚡ Token Optimization Notice

**ZMCPTools now uses MCP Resources for read-only operations** - saving ~13,000+ tokens in system prompts!

- **Resources** (~30 tokens): URI-based read operations (file analysis, searches, status)
- **Tools** (~200 tokens): Action-based mutations and complex workflows

See [GitHub Issue #35](https://github.com/jw409/ZMCPTools/issues/35) for migration details.

## Table of Contents

- [🔍 MCP Resources (Token-Optimized)](#mcp-resources-token-optimized)
- [Other (4 tools)](#other)

**Total Active Tools**: 4

---

## 🔍 MCP Resources (Token-Optimized)

**New in v0.5.0**: Read-only operations are now available as **MCP Resources** instead of Tools, providing 97% token reduction.

## Other

<a name="other"></a>

### `broadcast_progress`

Broadcast task progress to all agents in the repository

### `register_artifact`

Register created artifacts for discovery by other agents

### `todo_read`

Read shared todos with optional filtering

### `todo_write`

Write or update shared todos that all agents can see

---

**Token optimization**: Resources use ~30 tokens vs ~200 tokens for equivalent tools
**Total savings**: ~13,000+ tokens in system prompts vs tool-based approach
