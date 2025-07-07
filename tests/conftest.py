"""Pytest configuration and shared fixtures for ClaudeMcpTools tests."""

import asyncio
import os
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Generator

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

# Set environment variables for testing before any imports
os.environ["MCPTOOLS_ENV"] = "test"
os.environ["MCPTOOLS_TEST_MODE"] = "true"

from claude_mcp_tools.config import config
from claude_mcp_tools.database import get_session, init_database


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def test_db_engine():
    """Create a test database engine."""
    # Use in-memory SQLite for tests
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        future=True,
    )
    
    # Initialize the database
    await init_database(engine)
    
    yield engine
    
    # Cleanup
    await engine.dispose()


@pytest.fixture
async def test_db_session(test_db_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create a fresh database session for each test."""
    async with AsyncSession(test_db_engine, expire_on_commit=False) as session:
        # Start a transaction
        transaction = await session.begin()
        
        yield session
        
        # Rollback the transaction to clean up
        await transaction.rollback()


@pytest.fixture
def temp_repository() -> Generator[Path, None, None]:
    """Create a temporary directory for test repository."""
    with tempfile.TemporaryDirectory() as temp_dir:
        repo_path = Path(temp_dir)
        
        # Create some basic files to make it look like a repository
        (repo_path / "README.md").write_text("# Test Repository")
        (repo_path / "src").mkdir()
        (repo_path / "src" / "main.py").write_text("print('Hello, World!')")
        
        yield repo_path


@pytest.fixture
def mock_claude_cli(monkeypatch):
    """Mock the Claude CLI to avoid actual process spawning."""
    from unittest.mock import Mock
    
    # Create a mock process
    mock_process = Mock()
    mock_process.pid = 12345
    mock_process.poll.return_value = None  # Process is running
    mock_process.returncode = None
    mock_process.stdout = Mock()
    mock_process.stderr = Mock()
    
    # Mock the spawn function directly - avoid mocking subprocess.Popen 
    # which interferes with MCP library imports
    def mock_spawn_claude_sync(*args, **kwargs):
        return {
            "success": True,
            "pid": 12345,
            "process": mock_process,
            "work_folder": kwargs.get("workFolder", "."),
            "session_id": kwargs.get("session_id"),
            "spawned_at": "2024-01-01T00:00:00Z",
        }
    
    # Use a delayed import approach to avoid import-time issues
    def apply_spawn_mock():
        try:
            from claude_mcp_tools import orchestration_server
            orchestration_server.spawn_claude_sync = mock_spawn_claude_sync
        except ImportError:
            pass
            
        try:
            from claude_mcp_tools import claude_spawner
            claude_spawner.spawn_claude_sync = mock_spawn_claude_sync
        except ImportError:
            pass
    
    # Apply the mock after imports are done
    apply_spawn_mock()
    
    return mock_process


@pytest.fixture
def mock_psutil(monkeypatch):
    """Mock psutil for process monitoring."""
    from unittest.mock import Mock
    
    mock_process = Mock()
    mock_process.pid = 12345
    mock_process.is_running.return_value = True
    mock_process.status.return_value = "running"
    mock_process.memory_info.return_value = Mock(rss=1024*1024*50)  # 50MB
    mock_process.cpu_percent.return_value = 5.0
    
    def mock_process_init(pid):
        if pid == 12345:
            return mock_process
        else:
            from psutil import NoSuchProcess
            raise NoSuchProcess(pid)
    
    monkeypatch.setattr("psutil.Process", mock_process_init)
    
    return mock_process


@pytest.fixture
def agent_config():
    """Standard agent configuration for testing."""
    return {
        "agent_type": "implementer",
        "task_description": "Test task for agent lifecycle",
        "capabilities": ["testing", "debugging"],
        "configuration": {"test_mode": True},
    }


@pytest.fixture
async def cleanup_agents(test_db_session):
    """Cleanup any agents created during tests."""
    yield
    
    # Clean up any agents that were created
    await test_db_session.execute(text("DELETE FROM agents"))
    await test_db_session.commit()


# Pytest configuration
pytest_plugins = ["pytest_asyncio"]