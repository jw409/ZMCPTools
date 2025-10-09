# ZMCPTools Documentation Map

**Purpose**: Central index of all authoritative documentation. Start here for any ZMCPTools reference.

---

## Core Documentation

### Project Overview

| Document | Location | Purpose | Last Updated |
|----------|----------|---------|--------------|
| **Main README** | `README.md` | Project overview, quickstart | Check file |
| **Tool List** | `etc/TOOL_LIST.md` | Complete MCP tool catalog | Auto-generated |
| **Agent Tool List** | `etc/AGENT_TOOL_LIST.md` | Tool catalog for agent contexts | Auto-generated |
| **Resource Registry** | `etc/RESOURCE_REGISTRY.md` | MCP resource catalog | Auto-generated |
| **CLAUDE.md** | `CLAUDE.md` | Bootloader for agent context | 2025-10-08 |

### Architecture & Strategy

| Document | Location | Purpose | Last Updated |
|----------|----------|---------|--------------|
| **Embedding Strategy** | `etc/EMBEDDING_STRATEGY.md` | GPU/CPU embedding model selection, LanceDB architecture | 2025-10-03 |
| **GitHub Issues Guide** | `etc/GITHUB_ISSUES.md` | Labels, issue creation, workflow integration | 2025-10-08 |

### Design Decisions

| Document | Location | Purpose | Last Updated |
|----------|----------|---------|--------------|
| **Embedding Model Selection** | `etc/decisions/EMBEDDING_MODEL_SELECTION.md` | Why Gemma3-300M for embeddings | Check file |
| **Resources vs Tools** | `etc/decisions/RESOURCES_VS_TOOLS_DECISION.md` | When to use MCP resources vs tools | Check file |
| **Browser Tools Archive** | `etc/decisions/WHY_ARCHIVED_LEGACY_BROWSER_TOOLS.md` | Why we migrated to Playwright MCP | Check file |
| **AST Storage Architecture** | `etc/decisions/AST_STORAGE_ARCHITECTURE.md` | Code symbol storage design | Check file |

### Test Plans & Validation

| Document | Location | Purpose | Last Updated |
|----------|----------|---------|--------------|
| **GPU Embedding Tests** | `etc/test-plans/GPU_EMBEDDING_TEST_CRITERIA.md` | GPU embedding test criteria | Check file |
| **Phase 5 Test Plan** | `etc/test-plans/TEST_PLAN_PHASE5.md` | Phase 5 test plan | Check file |
| **Collaborative Agent Validation** | `etc/test-plans/VALIDATION_PROTOCOL_COLLABORATIVE_AGENTS.md` | Agent validation protocol | Check file |
| **Reproducible Benchmarks** | `etc/test-plans/README_REPRODUCIBLE_BENCHMARK.md` | Benchmark setup guide | Check file |

### Development Workflows

| Document | Location | Purpose | Last Updated |
|----------|----------|---------|--------------|
| **Agent Verification** | `etc/AGENT_VERIFICATION_CHECKLIST.md` | Post-agent validation protocol | 2025-10-03 |

---

## Documentation Discovery Protocol

### 1. Start Here (META_DOCUMENTATION_MAP.md)

**Location**: `etc/META_DOCUMENTATION_MAP.md`

**When to use**: First stop for any documentation lookup

**What it provides**:
- Index of all docs
- Last updated timestamps
- Purpose of each doc

### 2. Check CLAUDE.md

**Location**: `CLAUDE.md`

**When to use**: Agent context loading, bootloader verification

**What it provides**:
- Prompt chain system
- Authoritative file pointers
- Discovery rules (MCP resources, service ports, tools)

### 3. Domain-Specific Docs

**Use this map** to find:
- **Embedding/Search**: → `etc/EMBEDDING_STRATEGY.md`
- **GitHub Operations**: → `etc/GITHUB_ISSUES.md`
- **Agent Workflow**: → `etc/AGENT_VERIFICATION_CHECKLIST.md`
- **Tool Reference**: → `etc/TOOL_LIST.md`
- **Design Decisions**: → `etc/decisions/`
- **Test Plans**: → `etc/test-plans/`

---

## Document Categories

### 🏗️ Architecture & Design

**Purpose**: Long-term strategy, model selection, system design

- `etc/EMBEDDING_STRATEGY.md` - GPU model choice (Gemma3), LanceDB patterns
- `etc/decisions/EMBEDDING_MODEL_SELECTION.md` - Gemma3-300M selection rationale
- `etc/decisions/RESOURCES_VS_TOOLS_DECISION.md` - Resource vs tool decision tree
- `etc/decisions/AST_STORAGE_ARCHITECTURE.md` - Code symbol storage patterns
- `etc/decisions/WHY_ARCHIVED_LEGACY_BROWSER_TOOLS.md` - Playwright migration rationale

### 🔧 Developer Workflows

**Purpose**: Day-to-day development processes

- `etc/AGENT_VERIFICATION_CHECKLIST.md` - Verify agent work (files changed, tests pass)
- `etc/GITHUB_ISSUES.md` - Labels, issue creation, PR linking
- `etc/test-plans/VALIDATION_PROTOCOL_COLLABORATIVE_AGENTS.md` - Agent validation protocol
- `etc/test-plans/GPU_EMBEDDING_TEST_CRITERIA.md` - GPU embedding test criteria
- `etc/test-plans/TEST_PLAN_PHASE5.md` - Phase 5 test plan
- `etc/test-plans/README_REPRODUCIBLE_BENCHMARK.md` - Benchmark setup guide

### 📚 Reference & Catalogs

**Purpose**: Lookup tables, generated lists, API references

- `etc/TOOL_LIST.md` - Complete MCP tool catalog (auto-generated)
- `etc/AGENT_TOOL_LIST.md` - Tool catalog for agent contexts (auto-generated)
- `etc/RESOURCE_REGISTRY.md` - MCP resource catalog (auto-generated)
- Future: `etc/generated/SERVICE_PORTS.md` - Port assignments
- Future: `etc/generated/MCP_RESOURCES.md` - Available MCP resources

### 🚀 User Guides

**Purpose**: End-user documentation

- `README.md` - Quickstart, installation, usage examples
- `etc/PLAYWRIGHT_USAGE.md` - Browser automation via playwright-mcp (2025-10-09)
- Future: `docs/SEMANTIC_SEARCH_GUIDE.md` - How to use semantic search
- Future: `docs/CODE_ACQUISITION_GUIDE.md` - External repo indexing

---

## Document Lifecycle

### Creation Rules

**When to create new doc**:
1. Pattern used 3+ times (worth documenting)
2. Non-obvious decision with rationale (e.g., model selection)
3. Workflow requiring multiple steps (e.g., agent verification)
4. Reference data needed frequently (e.g., GitHub labels)

**Where to put it**:
- `etc/` - Internal developer docs (strategy, workflow, architecture)
- `docs/` - External user docs (guides, tutorials)
- `etc/generated/` - Auto-generated references (SERVICE_PORTS.md, MCP_RESOURCES.md)

**What to include**:
- Purpose statement (first line)
- Last updated timestamp (bottom)
- Practical examples (not just theory)
- File/line references (concrete pointers)
- Troubleshooting section (common errors)

### Update Protocol

**When to update**:
- Immediately after major feature (e.g., SymbolGraphIndexer → update EMBEDDING_STRATEGY.md)
- When workflow changes (e.g., new label added → update GITHUB_ISSUES.md)
- When error pattern emerges (e.g., agent docs-only bug → update AGENT_VERIFICATION_CHECKLIST.md)

**How to update**:
1. Edit the doc
2. Update "Last Updated" timestamp at bottom
3. Update this META_DOCUMENTATION_MAP.md table
4. Commit with message: `docs: Update FILENAME.md - brief description`

### Deprecation

**When to deprecate**:
- Workflow no longer used
- Strategy replaced by better approach
- Tool/feature removed from project

**How to deprecate**:
1. Add "⚠️ DEPRECATED" to doc title
2. Link to replacement doc
3. Keep file for historical reference (don't delete)
4. Update META_DOCUMENTATION_MAP.md to mark as deprecated

---

## Quick Reference

### "Where do I find...?"

| Question | Answer |
|----------|--------|
| Available GitHub labels? | `etc/GITHUB_ISSUES.md` → "Available Labels" section |
| Which embedding model to use? | `etc/EMBEDDING_STRATEGY.md` → "Model Selection" section |
| How to verify agent work? | `etc/AGENT_VERIFICATION_CHECKLIST.md` → "Verification Checklist" |
| List of all MCP tools? | `etc/TOOL_LIST.md` (auto-generated) |
| Service port assignments? | `etc/generated/SERVICE_PORTS.md` (if exists) |
| How to create GitHub issue? | `etc/GITHUB_ISSUES.md` → "Issue Creation Protocol" |
| Browser automation usage? | `etc/PLAYWRIGHT_USAGE.md` → Full playwright-mcp guide |
| Design decision rationale? | `etc/decisions/` (by topic) |
| Test criteria for feature? | `etc/test-plans/` (by feature) |

### "How do I...?"

| Task | Documentation |
|------|---------------|
| Create a GitHub issue | `etc/GITHUB_ISSUES.md` → "Issue Creation Protocol" |
| Verify agent completed work | `etc/AGENT_VERIFICATION_CHECKLIST.md` → "Post-Agent Verification Protocol" |
| Choose embedding model | `etc/EMBEDDING_STRATEGY.md` → "Model Selection: Gemma3-300M" |
| Add new MCP tool | `etc/TOOL_LIST.md` → Check pattern, then implement |
| Debug semantic search | `etc/EMBEDDING_STRATEGY.md` → "Troubleshooting" |
| Automate browser interactions | `etc/PLAYWRIGHT_USAGE.md` → "Usage Patterns" + Examples |
| Understand design decision | `etc/decisions/` → Find relevant decision doc |
| Find test criteria | `etc/test-plans/` → Find relevant test plan |

---

## Authoritative Files (Auto-Generated)

**Rule**: NEVER hardcode values from these files. Always `cat` them to get current state.

| File | Generated By | Update Frequency | Usage |
|------|--------------|------------------|-------|
| `etc/TOOL_LIST.md` | Build process | On code change | MCP tool reference |
| `etc/AGENT_TOOL_LIST.md` | Build process | On code change | Agent tool catalog |
| `etc/RESOURCE_REGISTRY.md` | Build process | On code change | MCP resource registry |
| `etc/generated/SERVICE_PORTS.md` | Post-commit hook | Every commit | Port discovery |
| `etc/generated/MCP_RESOURCES.md` | Runtime discovery | On server start | Resource catalog |

**Example**:
```bash
# ❌ NEVER hardcode
EMBEDDING_PORT=8765  # May change!

# ✅ ALWAYS discover
EMBEDDING_PORT=$(cat etc/generated/SERVICE_PORTS.md | grep embedding | awk '{print $2}')
```

---

## Documentation Anti-Patterns

### ❌ DON'T: Hardcode changing values

**Bad**:
```markdown
The embedding service runs on port 8765.
```

**Good**:
```markdown
The embedding service port is defined in `etc/generated/SERVICE_PORTS.md`.

Check current port:
```bash
cat etc/generated/SERVICE_PORTS.md | grep embedding
```

### ❌ DON'T: Create docs without updating this map

**Bad**: Create `etc/TESTING_STRATEGY.md` but forget to add it here

**Good**: Create doc, immediately add entry to META_DOCUMENTATION_MAP.md

### ❌ DON'T: Leave stale "Last Updated" timestamps

**Bad**: Edit `GITHUB_ISSUES.md` but leave "Last Updated: 2025-01-01"

**Good**: Update timestamp every time file changes

### ❌ DON'T: Write docs without examples

**Bad**: "Use the correct label when creating issues"

**Good**:
```bash
# Check available labels
gh label list

# Create issue with verified label
gh issue create --label "enhancement"
```

---

## Future Documentation Roadmap

### Planned Docs (Priority Order)

1. **`etc/STORAGE_ARCHITECTURE.md`** - SQLite vs LanceDB decision tree, project-local patterns
2. **`etc/TESTING_STRATEGY.md`** - Unit/integration/E2E split, mocking patterns
3. **`etc/MCP_RESOURCE_DESIGN.md`** - When to use resources vs tools (97% token reduction)
4. **`docs/SEMANTIC_SEARCH_GUIDE.md`** - End-user guide to GPU semantic search
5. **`docs/CODE_ACQUISITION_GUIDE.md`** - How to index external repos

### Documentation Gaps (Known)

- No MCP resource catalog (should be auto-generated)
- No service port reference (should be auto-generated from SERVICE_PORTS.md)
- No testing strategy doc (need after test refactor)
- No contribution guide (CONTRIBUTING.md for external contributors)

---

## Maintenance Schedule

| Frequency | Task | Owner |
|-----------|------|-------|
| **On commit** | Update SERVICE_PORTS.md | Post-commit hook |
| **On feature** | Update relevant etc/ docs | Feature implementer |
| **On release** | Review all "Last Updated" dates | Release manager |
| **Monthly** | Audit for stale docs | Team |

---

**Last Updated**: 2025-10-09 (Added PLAYWRIGHT_USAGE.md for browser automation)

**Status**: Living document - update whenever new docs added

**Authority**: This is the authoritative documentation index. All docs MUST be listed here.
