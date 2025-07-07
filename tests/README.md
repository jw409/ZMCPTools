# ClaudeMcpTools Test Framework

This test framework is designed to systematically investigate and resolve the defunct agent process issue in the ClaudeMcpTools orchestration system.

## Setup Complete ✅

- **Test Structure**: Created `/tests/` with `unit/`, `integration/`, `fixtures/`, `utils/` subdirectories
- **Dependencies**: Added `pytest`, `pytest-asyncio`, `psutil` for testing
- **Configuration**: Added `pytest.ini` with proper async test configuration
- **Fixtures**: Created `conftest.py` with database and mocking fixtures
- **Process Monitor**: Built `tests/utils/process_monitor.py` for detecting defunct processes

## Current State

### Working Tests ✅
- `test_process_monitor_basic`: Basic process monitoring functionality
- `test_database_agent_operations`: Database operations without spawning

### Test Files Created
1. **`tests/test_simple_spawn.py`**: Core test for reproducing defunct process issue
2. **`tests/integration/test_agent_lifecycle.py`**: Comprehensive agent lifecycle tests
3. **`tests/utils/process_monitor.py`**: Process monitoring utilities
4. **`tests/conftest.py`**: Pytest configuration and fixtures

## Key Findings from Code Analysis

### Potential Issues Identified

1. **Subprocess Management**: In `orchestration_server.py` lines 156-162, uses `subprocess.Popen` without proper cleanup
2. **Process Monitoring**: Spawned processes may not be properly tracked or reaped
3. **Error Isolation**: Exception handling might leave processes in inconsistent states
4. **Async/Sync Mix**: Complex interaction between async orchestration and sync subprocess calls

### Test Framework Capabilities

- **Process Monitoring**: Track all processes spawned during tests
- **Defunct Detection**: Identify zombie/defunct processes automatically
- **Cleanup Tools**: Attempt to clean up orphaned processes
- **Mock Support**: Test logic without real Claude CLI spawning
- **Real Process Testing**: Optionally test with real Claude CLI if available

## Next Steps - Subagent Task Breakdown

## 🔍 **Agent 1: Process Debugging Specialist**
**Task**: `Investigate process spawning mechanisms and identify defunct process root cause`

**Specific Work**:
1. Run the real spawn test: `pytest tests/test_simple_spawn.py::TestSimpleSpawn::test_spawn_without_mocks -v`
2. Analyze subprocess.Popen usage in `orchestration_server.py` lines 146-216
3. Add process lifecycle logging to track exactly when processes become defunct
4. Test different spawning patterns (sequential vs parallel)
5. Create a focused test that reliably reproduces the defunct process issue

**Expected Deliverables**:
- Modified test that consistently reproduces the problem
- Detailed analysis of when/why processes become defunct
- Logging enhancements to track process state transitions

---

## 🧹 **Agent 2: Process Cleanup Specialist** 
**Task**: `Implement robust process cleanup and monitoring mechanisms`

**Specific Work**:
1. Enhance the `ProcessMonitor` class in `tests/utils/process_monitor.py`
2. Add automatic cleanup of defunct processes in `orchestration_server.py`
3. Implement proper signal handling for spawned processes
4. Add process reaping mechanisms using SIGCHLD handlers
5. Test cleanup effectiveness with stress tests

**Expected Deliverables**:
- Enhanced process monitoring with automatic cleanup
- Signal handling code for proper process reaping
- Stress tests showing improved cleanup

---

## 🔧 **Agent 3: Spawning Mechanism Refactor**
**Task**: `Refactor agent spawning to prevent defunct processes`

**Specific Work**:
1. Analyze the `spawn_claude_sync` function in `orchestration_server.py`
2. Implement proper process management using `asyncio.subprocess` instead of `subprocess.Popen`
3. Add process pool management with proper cleanup
4. Ensure spawned processes are properly tracked and terminated
5. Add timeout mechanisms for runaway processes

**Expected Deliverables**:
- Refactored spawning mechanism using asyncio.subprocess
- Process pool with automatic cleanup
- Timeout and error handling improvements

---

## 📊 **Agent 4: Test Coverage Expansion**
**Task**: `Create comprehensive test suite for all agent spawning scenarios`

**Specific Work**:
1. Create unit tests for individual components in `tests/unit/`
2. Add stress tests for concurrent agent spawning
3. Test error conditions (failed spawns, timeouts, resource limits)
4. Add integration tests for full orchestration workflows
5. Create performance benchmarks for process spawning

**Expected Deliverables**:
- Complete test coverage for agent spawning
- Stress and performance tests  
- Error condition testing
- CI/CD ready test suite

---

## 🚀 **Agent 5: Integration and Validation**
**Task**: `Integrate all fixes and validate the solution works end-to-end`

**Specific Work**:
1. Integrate fixes from all other agents
2. Run full test suite to verify no regressions
3. Test with real Claude CLI spawning in production-like conditions
4. Validate that defunct processes are eliminated
5. Update documentation and add monitoring tools

**Expected Deliverables**:
- Fully integrated solution
- Validated test suite with no defunct processes
- Production-ready monitoring tools
- Updated documentation

## Running Tests

### Basic Test Run
```bash
uv run pytest tests/test_simple_spawn.py -v
```

### Run with Process Monitoring
```bash
uv run pytest tests/integration/test_agent_lifecycle.py -v -s
```

### Run All Tests
```bash
uv run pytest tests/ -v
```

### Skip Real Spawn Tests
```bash
uv run pytest tests/ -v -m "not real_spawn"
```

## Test Structure

```
tests/
├── __init__.py
├── conftest.py                    # Pytest configuration and fixtures
├── pytest.ini                    # Pytest settings
├── README.md                      # This file
├── test_simple_spawn.py          # Core spawn tests
├── integration/
│   ├── __init__.py
│   └── test_agent_lifecycle.py   # Full lifecycle tests
├── unit/
│   └── __init__.py               # Individual component tests
├── utils/
│   ├── __init__.py
│   └── process_monitor.py        # Process monitoring utilities
└── fixtures/
    └── __init__.py               # Test data and fixtures
```

## Key Commands

- **Run one test**: `uv run pytest tests/test_simple_spawn.py::TestSimpleSpawn::test_process_monitor_basic -v`
- **Debug with output**: `uv run pytest tests/test_simple_spawn.py -v -s`
- **Run integration tests**: `uv run pytest tests/integration/ -v`
- **Check for real Claude CLI**: `which claude && echo "Available" || echo "Not available"`

The test framework is ready for the subagents to use. Each agent can focus on their specific area while using the shared testing infrastructure to validate their work.