---
verify: ZMCP_TOOLS_v3.0_LOADED
type: mcp_integration
primary_mode: orchestrate_objective
storage: ~/.mcptools/data/
vector_db: ~/.mcptools/lancedb/
cost_optimization: foundation_session_id (85-90% reduction)
agent_types: [backend, frontend, testing, documentation, devops, analysis]
---

# ZMCPTools Integration

MCP tools with architect-led multi-agent orchestration.

## Architect-Led Orchestration (Primary)

**Complex tasks** → `orchestrate_objective()`:
```python
orchestrate_objective(
    objective="Implement OAuth with tests and docs",
    repository_path=".",
    foundation_session_id="shared-context-123"  # Cost reduction
)
```

**Architect does**:
1. Analyze objective → break into tasks
2. Spawn coordinated agents (backend → frontend → testing → docs)
3. Coordinate dependencies + communication
4. Monitor progress

## Agent Types

- `backend` - API, database, server logic
- `frontend` - UI components, state, UX
- `testing` - Unit/integration/E2E tests
- `documentation` - Technical writing, API docs
- `devops` - CI/CD, deployment
- `analysis` - Code review, performance

## Key Tools

**File ops**:
- `list_files(directory=".")`
- `find_files(pattern="*.py")`
- `easy_replace(file_path, old, new)`

**Project analysis** (use before implementing):
- `analyze_project_structure(".")`
- `generate_project_summary(".")`

**Documentation + vector search**:
- `scrape_documentation(url)` - LanceDB indexing
- `search_documentation(query)` - Semantic search
- `link_docs_to_code(project_path)`
- `create_vector_collection(name, provider)`

**Agent coordination**:
- `spawn_agent(type, path, task, depends_on=[])`
- `create_task(path, type, title, dependencies)`
- `join_room(room_name)`
- `send_message(room, message, mentions)`

**Knowledge management**:
- `store_knowledge_memory(path, agent_id, type, title, content)`
- `search_knowledge_graph(path, query)`
- `get_error_patterns(path)`

## Workflows

**Full-stack**:
```python
orchestrate_objective(
    "Add JWT auth, login UI, tests, docs",
    "."
)
```

**Documentation-first**:
```python
scrape_documentation("https://docs.framework.com")
orchestrate_objective(
    "Implement following scraped docs patterns",
    "."
)
```

**Analysis → Implementation**:
```python
analyze_project_structure(".")
orchestrate_objective(
    "Refactor based on analysis findings",
    "."
)
```

## Agent Dependencies

```python
# Testing waits for implementation
backend = spawn_agent("backend", ".", "OAuth API")
frontend = spawn_agent("frontend", ".", "Login UI")
test = spawn_agent("testing", ".", "OAuth tests",
    depends_on=[backend["agent_id"], frontend["agent_id"]])
```

## Best Practices

**Always**:
- Start complex tasks with `orchestrate_objective()`
- Use foundation sessions (cost optimization)
- Store insights immediately
- Check existing knowledge first
- Coordinate via shared rooms

**Never**:
- Implement without analysis
- Skip docs scraping for new frameworks
- Ignore shared memory from other agents
- Start agents without coordination

## Quick Start Checklist

1. `analyze_project_structure(".")` - Understand codebase
2. `search_knowledge_graph(".", query)` - Check existing work
3. `orchestrate_objective(objective, ".", {foundation_session_id: "name"})` - Coordinate
4. `join_room("task-coordination")` - Monitor
5. `store_knowledge_memory()` - Document learnings

## Monitoring

```bash
# Real-time terminal
zmcp-tools monitor

# HTML dashboard
zmcp-tools monitor -o html --output-file dashboard.html

# Live web
zmcp-tools monitor --watch -o html -p 8080

# JSON output
zmcp-tools monitor -o json > status.json
```

**Process naming**: All agents appear in `ps` as `zmcp-{type}-{task}-{id}`

---

**Core principle**: Multi-agent orchestration for complex tasks. Single agents for simple ops only.
