# Architect-Led Multi-Agent Orchestration Vision

## Core Concept: Architect → Plan → Spawn → Execute

### The Flow:
1. **User**: "Please implement user authentication with tests and docs"
2. **Architect Agent**: Analyzes complexity, creates execution plan
3. **Architect**: Spawns specialized agents with specific tasks
4. **Execution**: Agents work (some depend on others)
5. **Documentation Agent**: Spawned LAST to document what others built

## Example Orchestration Pattern:

```
User Request: "Add OAuth login to the app"

Architect Agent Analysis:
├── Task 1: Backend Agent - API endpoints and auth logic
├── Task 2: Frontend Agent - Login UI components  
├── Task 3: Testing Agent - Auth flow tests (waits for Tasks 1+2)
└── Task 4: Documentation Agent - Document the auth system (waits for all)
```

## Implementation Design:

### Enhanced spawn_agent()
```python
async def spawn_agent(
    agent_type: str,
    repository_path: str,
    task_description: str,           # NEW: Specific task to execute
    depends_on: List[str] = [],      # NEW: Agent IDs to wait for
    foundation_session_id: str = "", # NEW: Shared context
    auto_execute: bool = True        # NEW: Actually spawn Claude
):
    # 1. Create database record
    agent_record = await AgentService.create_agent(...)
    
    # 2. Check dependencies
    if depends_on:
        await setup_dependency_monitoring(agent_record["agent_id"], depends_on)
    
    # 3. Spawn actual Claude instance with task
    if auto_execute:
        claude_pid = await mcp__ccm__claude_code(
            model="sonnet",
            session_id=foundation_session_id,  # SHARED CONTEXT!
            prompt=f"You are {agent_type} agent. Task: {task_description}. Join room: {coordination_room}"
        )
```

### Dependency Examples:

**Documentation Agent** (spawned last):
```python
doc_agent = await spawn_agent(
    agent_type="documentation",
    task_description="Document the OAuth implementation created by other agents",
    depends_on=[backend_agent_id, frontend_agent_id, testing_agent_id],
    foundation_session_id=shared_session
)
```

**Testing Agent** (waits for implementation):
```python
test_agent = await spawn_agent(
    agent_type="testing", 
    task_description="Create comprehensive tests for OAuth flow",
    depends_on=[backend_agent_id, frontend_agent_id],
    foundation_session_id=shared_session
)
```

## Benefits:

1. **Documentation Agent** always has complete context of what was built
2. **Testing Agent** tests the actual implemented features
3. **Foundation Sessions** provide 85-90% cost reduction through shared context
4. **Architect Agent** creates intelligent execution plans
5. **Real Orchestration** - actual running agents, not just database records

## Current Multi-Agent ORM Migration:
This is EXACTLY what we're doing right now! Our 6 agents are:
- Foundation → Communication → Documentation → Orchestration → Testing → Cleanup

The testing agent waits for others, cleanup waits for validation - perfect example of the dependency pattern!

---

**Next Phase**: After ORM migration, implement this architect-led orchestration as the core feature of ClaudeMcpTools.