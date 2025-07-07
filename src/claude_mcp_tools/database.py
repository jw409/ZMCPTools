"""Database session management and initialization for SQLAlchemy ORM."""

import asyncio
import fcntl
import os
import shutil
import sqlite3
import sys
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from pathlib import Path

import structlog
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine, AsyncEngine
from sqlalchemy import text
from typing import Callable, Any

from .models import Base

logger = structlog.get_logger()

# Global engine and session factory
engine: AsyncEngine | None = None
AsyncSessionLocal: async_sessionmaker[AsyncSession] | None = None

# Cross-process coordination
_initialization_lock_fd: int | None = None


def create_backup(db_path: Path) -> Path | None:
    """Create a timestamped backup of the database.
    
    Args:
        db_path: Path to the database file to backup
        
    Returns:
        Path to the backup file, or None if backup failed
    """
    try:
        if not db_path.exists() or db_path.stat().st_size == 0:
            logger.info("No existing database to backup")
            return None
            
        timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        backup_path = db_path.with_suffix(f".backup.{timestamp}.db")
        
        logger.info("Creating database backup...", backup_path=str(backup_path))
        shutil.copy2(db_path, backup_path)
        
        # Verify backup
        if backup_path.exists() and backup_path.stat().st_size == db_path.stat().st_size:
            logger.info("Database backup created successfully", size_mb=backup_path.stat().st_size / 1024 / 1024)
            return backup_path
        else:
            logger.error("Backup verification failed")
            return None
            
    except Exception as e:
        logger.error("Failed to create database backup", error=str(e))
        return None


def restore_from_backup(db_path: Path, backup_path: Path) -> bool:
    """Restore database from backup.
    
    Args:
        db_path: Path to the current database file
        backup_path: Path to the backup file
        
    Returns:
        True if restoration successful, False otherwise
    """
    try:
        if not backup_path.exists():
            logger.error("Backup file not found", backup_path=str(backup_path))
            return False
            
        logger.info("Restoring database from backup...", backup_path=str(backup_path))
        
        # Remove current database
        if db_path.exists():
            db_path.unlink()
            
        # Restore from backup
        shutil.copy2(backup_path, db_path)
        
        # Verify restoration
        if db_path.exists() and db_path.stat().st_size == backup_path.stat().st_size:
            logger.info("Database restored successfully from backup")
            return True
        else:
            logger.error("Database restoration verification failed")
            return False
            
    except Exception as e:
        logger.error("Failed to restore database from backup", error=str(e))
        return False


def preview_migration_changes(alembic_cfg: Config) -> list[str]:
    """Preview what changes the migration will make.
    
    Args:
        alembic_cfg: Alembic configuration
        
    Returns:
        List of change descriptions
    """
    try:
        # This is a simplified preview - in a full implementation you'd
        # use alembic's autogenerate to get detailed change information
        script_dir = ScriptDirectory.from_config(alembic_cfg)
        
        # Get current and head revisions
        try:
            current_rev = command.current(alembic_cfg)
            head_rev = script_dir.get_current_head()
            
            if current_rev == head_rev:
                return ["Database is already up to date"]
            elif current_rev is None:
                return ["Will initialize migration tracking and apply latest schema"]
            else:
                return ["Will apply pending migration updates"]
                
        except Exception:
            return ["Will initialize new database schema"]
            
    except Exception as e:
        logger.error("Failed to preview migration changes", error=str(e))
        return ["Could not preview changes - migration will proceed"]


def handle_migration_error(error: Exception, backup_path: Path | None) -> str:
    """Handle migration errors with user choice.
    
    Args:
        error: The migration error that occurred
        backup_path: Path to backup file (if any)
        
    Returns:
        User's choice: "retry", "fallback", "restore", or "abort"
    """
    logger.error("Migration failed", error=str(error))
    
    print("\n" + "="*60)
    print("🚨 DATABASE MIGRATION FAILED")
    print("="*60)
    print(f"Error: {error}")
    print()
    
    options = []
    if backup_path and backup_path.exists():
        options.extend([
            "1. Restore from backup and use existing schema",
            "2. Continue with fallback method (old create_all)",
            "3. Retry migration",
            "4. Abort startup"
        ])
        choices = {"1": "restore", "2": "fallback", "3": "retry", "4": "abort"}
    else:
        options.extend([
            "1. Continue with fallback method (old create_all)", 
            "2. Retry migration",
            "3. Abort startup"
        ])
        choices = {"1": "fallback", "2": "retry", "3": "abort"}
    
    print("Choose an option:")
    for option in options:
        print(f"  {option}")
    print()
    
    while True:
        try:
            choice = input("Enter your choice (number): ").strip()
            if choice in choices:
                selected = choices[choice]
                print(f"Selected: {selected}")
                return selected
            else:
                print("Invalid choice. Please try again.")
        except (EOFError, KeyboardInterrupt):
            print("\nAbort selected")
            return "abort"


async def run_migrations(db_path: Path | None = None) -> None:
    """Run Alembic migrations with enhanced safety and user control.
    
    Args:
        db_path: Path to SQLite database file. If None, uses default location.
    """
    if db_path is None:
        db_path = Path.home() / ".mcptools" / "data" / "orchestration.db"
    
    # Ensure directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Create backup if database exists
    backup_path = None
    database_exists = db_path.exists() and db_path.stat().st_size > 0
    
    if database_exists:
        backup_path = create_backup(db_path)
        if backup_path:
            logger.info("✅ Database backup created", backup_file=backup_path.name)
        else:
            logger.warning("⚠️ Could not create backup, proceeding without backup")
    
    # Retry loop for migration attempts
    max_retries = 3
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            # Get the alembic.ini path relative to this file
            package_root = Path(__file__).parent.parent.parent
            alembic_cfg_path = package_root / "alembic.ini"
            
            if not alembic_cfg_path.exists():
                logger.warning("Alembic configuration not found, using fallback method", 
                             path=str(alembic_cfg_path))
                await _fallback_create_all()
                return
            
            # Configure Alembic
            alembic_cfg = Config(str(alembic_cfg_path))
            database_url = f"sqlite+aiosqlite:///{db_path}"
            alembic_cfg.set_main_option("sqlalchemy.url", database_url)
            
            # Step 2: Preview changes
            if database_exists:
                changes = preview_migration_changes(alembic_cfg)
                logger.info("Migration preview:", changes=changes)
                for change in changes:
                    logger.info(f"  📋 {change}")
            
            # Step 3: Run migrations with error handling
            def setup_and_run_migrations():
                try:
                    if database_exists:
                        # For existing databases without migrations, stamp them at current version
                        try:
                            current_rev = command.current(alembic_cfg)
                            if not current_rev:
                                logger.info("📌 Stamping existing database at current migration version")
                                command.stamp(alembic_cfg, "head")
                        except Exception:
                            logger.info("📌 Initializing migration tracking for existing database")
                            command.stamp(alembic_cfg, "head")
                    
                    # Run the actual migration
                    logger.info("🔄 Applying database migrations...")
                    command.upgrade(alembic_cfg, "head")
                    return True
                    
                except Exception as e:
                    raise e
            
            # Use thread pool to run sync Alembic commands
            import concurrent.futures
            
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(setup_and_run_migrations)
                success = future.result(timeout=60)  # 60 second timeout
                
            if success:
                logger.info("✅ Database migrations completed successfully")
                return
                
        except Exception as e:
            retry_count += 1
            
            # Handle migration error with user choice
            if retry_count < max_retries:
                choice = handle_migration_error(e, backup_path)
                
                if choice == "retry":
                    logger.info("🔄 Retrying migration...")
                    continue
                elif choice == "restore":
                    if backup_path and restore_from_backup(db_path, backup_path):
                        logger.info("✅ Database restored from backup")
                        return
                    else:
                        logger.error("❌ Failed to restore from backup, using fallback")
                        await _fallback_create_all()
                        return
                elif choice == "fallback":
                    logger.info("🔄 Using fallback method")
                    await _fallback_create_all()
                    return
                elif choice == "abort":
                    logger.error("❌ Migration aborted by user")
                    sys.exit(1)
            else:
                # Max retries reached
                logger.error(f"❌ Migration failed after {max_retries} attempts")
                choice = handle_migration_error(e, backup_path)
                
                if choice == "restore" and backup_path:
                    if restore_from_backup(db_path, backup_path):
                        logger.info("✅ Database restored from backup")
                        return
                    else:
                        logger.error("❌ Failed to restore from backup")
                elif choice == "abort":
                    logger.error("❌ Migration aborted by user")
                    sys.exit(1)
                
                # Default to fallback
                logger.info("🔄 Using fallback method")
                await _fallback_create_all()
                return


async def _fallback_create_all() -> None:
    """Fallback method using the old create_all approach."""
    logger.info("Using fallback database initialization method")
    if engine:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("✅ Database initialized with fallback method")


async def _enable_wal_mode() -> None:
    """Enable SQLite WAL mode for better concurrent access."""
    if engine is None:
        logger.warning("Cannot enable WAL mode - engine not initialized")
        return
        
    try:
        async with engine.begin() as conn:
            # Enable WAL mode for better concurrent read/write performance
            await conn.execute(text("PRAGMA journal_mode = WAL;"))
            # Set busy timeout for better concurrent access
            await conn.execute(text("PRAGMA busy_timeout = 30000;"))
            # Optimize for concurrent access
            await conn.execute(text("PRAGMA synchronous = NORMAL;"))
            # Increase cache size for better performance
            await conn.execute(text("PRAGMA cache_size = -64000;"))  # 64MB cache
            # Keep temp tables in memory
            await conn.execute(text("PRAGMA temp_store = MEMORY;"))
            
        logger.info("✅ SQLite WAL mode and optimizations enabled")
    except Exception as e:
        logger.warning("Failed to enable WAL mode, proceeding with defaults", error=str(e))


async def _acquire_init_lock(db_path: Path) -> bool:
    """Acquire cross-process initialization lock to prevent conflicts."""
    global _initialization_lock_fd
    
    lock_file = db_path.parent / f".{db_path.name}.init.lock"
    
    try:
        # Create lock file if it doesn't exist
        lock_file.parent.mkdir(parents=True, exist_ok=True)
        _initialization_lock_fd = os.open(str(lock_file), os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
        
        # Try to acquire exclusive lock (non-blocking)
        fcntl.flock(_initialization_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        
        # Write process ID to lock file
        os.write(_initialization_lock_fd, f"{os.getpid()}\n".encode())
        os.fsync(_initialization_lock_fd)
        
        logger.debug("Acquired database initialization lock", pid=os.getpid())
        return True
        
    except (OSError, IOError) as e:
        # Lock already held by another process
        if _initialization_lock_fd is not None:
            try:
                os.close(_initialization_lock_fd)
            except:
                pass
            _initialization_lock_fd = None
        
        logger.debug("Database initialization lock held by another process", error=str(e))
        return False


async def _release_init_lock() -> None:
    """Release cross-process initialization lock."""
    global _initialization_lock_fd
    
    if _initialization_lock_fd is not None:
        try:
            fcntl.flock(_initialization_lock_fd, fcntl.LOCK_UN)
            os.close(_initialization_lock_fd)
            logger.debug("Released database initialization lock", pid=os.getpid())
        except Exception as e:
            logger.warning("Error releasing database initialization lock", error=str(e))
        finally:
            _initialization_lock_fd = None


async def init_database_with_migrations(db_path: Path | None = None) -> None:
    """Initialize database with full migrations (for install/setup only).
    
    This function should only be called during installation or setup,
    not during runtime operations.
    
    Args:
        db_path: Path to SQLite database file. If None, uses default location.
    """
    global engine, AsyncSessionLocal

    if db_path is None:
        # Default to .mcptools/data directory in user's home
        db_path = Path.home() / ".mcptools" / "data" / "orchestration.db"

    # Ensure directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Try to acquire initialization lock
    has_lock = await _acquire_init_lock(db_path)
    
    try:
        if has_lock:
            # We have the lock - perform full initialization WITH MIGRATIONS
            logger.info("Performing database initialization with migrations", pid=os.getpid())
            await _init_database_with_migrations_locked(db_path)
        else:
            # Another process is initializing - wait for them to finish
            logger.info("Waiting for database initialization by another process", pid=os.getpid())
            
            # Wait for database to be ready (poll every 100ms, max 60 seconds for migrations)
            max_wait = 60.0
            poll_interval = 0.1
            waited = 0.0
            
            while waited < max_wait:
                if await is_database_ready(db_path):
                    logger.info("Database ready after migration by another process")
                    await init_engine_only(db_path)
                    return
                
                await asyncio.sleep(poll_interval)
                waited += poll_interval
            
            # Timeout waiting - fall back to full initialization
            logger.warning("Timeout waiting for database initialization, proceeding with full init")
            await _init_database_with_migrations_locked(db_path)
            
    finally:
        if has_lock:
            await _release_init_lock()


async def init_database(db_path: Path | None = None) -> None:
    """Initialize database engine for runtime use (no migrations).
    
    This is the fast runtime initialization that assumes migrations
    have already been run during installation/setup.
    
    Args:
        db_path: Path to SQLite database file. If None, uses default location.
    """
    global engine, AsyncSessionLocal

    if db_path is None:
        # Default to .mcptools/data directory in user's home
        db_path = Path.home() / ".mcptools" / "data" / "orchestration.db"

    # Ensure directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    # If already initialized, just return
    if engine is not None and AsyncSessionLocal is not None:
        logger.debug("Database already initialized, skipping")
        return

    # Check if database exists and is ready
    if not await is_database_ready(db_path):
        # Database not ready - this is a setup issue
        logger.error("Database not found or not ready. Please run database setup first.")
        raise RuntimeError(
            "Database not initialized. Please run 'uv run python -m claude_mcp_tools.database setup' first."
        )
    
    # Use lightweight initialization (no migrations, no locking)
    logger.info("Using fast runtime database initialization", pid=os.getpid())
    await _init_database_locked(db_path)


async def _init_database_locked(db_path: Path) -> None:
    """Perform actual database initialization (called when holding lock)."""
    global engine, AsyncSessionLocal

    # Create async engine with aiosqlite and connection pooling
    database_url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(
        database_url,
        echo=False,  # Set to True for SQL debugging
        future=True,
        # Enhanced pool settings for high concurrent operations
        pool_size=50,           # More connections for concurrent agents
        max_overflow=100,       # Allow many concurrent operations
        pool_timeout=60,        # Longer wait time for busy periods
        pool_recycle=7200,      # Refresh connections every 2 hours
        pool_pre_ping=True,     # Verify connections before use
        # SQLite-specific optimizations for concurrency
        connect_args={
            "check_same_thread": False,  # Allow cross-thread usage
            "timeout": 60,               # Longer connection timeout for busy periods
            # SQLite WAL mode for better concurrency
            "isolation_level": None,     # Autocommit mode
        },
    )

    # Create session factory
    AsyncSessionLocal = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    # REMOVED: Run database migrations to ensure schema is up to date
    # await run_migrations(db_path)  # <-- This was causing the hanging!
    # Migrations should be run during install/setup, not during runtime

    # Enable SQLite WAL mode for better concurrent access
    await _enable_wal_mode()

    logger.info("Database initialized with runtime connection (no migrations)", db_path=str(db_path))


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Get an async database session.
    
    Yields:
        AsyncSession: Database session
    """
    if AsyncSessionLocal is None:
        await init_database()
    assert AsyncSessionLocal is not None, "AsyncSessionLocal must be initialized before use"

    # Create session outside of async with to avoid cancellation issues
    session = AsyncSessionLocal()
    try:
        # Yield outside of resource management context to prevent cancellation bugs
        yield session
    except SQLAlchemyError as e:
        await session.rollback()
        logger.error("Database session error", error=str(e))
        raise
    finally:
        await session.close()


async def close_database() -> None:
    """Close database engine and cleanup connections."""
    global engine

    if engine:
        await engine.dispose()
        logger.info("Database connections closed")


# Context manager for database sessions
class DatabaseSession:
    """Context manager for database sessions with automatic cleanup."""

    def __init__(self):
        self.session: AsyncSession | None = None

    async def __aenter__(self) -> AsyncSession:
        """Enter the context manager and return a session."""
        if AsyncSessionLocal is None:
            await init_database()
            
        assert AsyncSessionLocal is not None, "AsyncSessionLocal must be initialized before use"

        self.session = AsyncSessionLocal()
        return self.session

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit the context manager and cleanup session."""
        if self.session:
            if exc_type:
                await self.session.rollback()
            await self.session.close()


# Fast context manager for sub-agents
class DatabaseSessionFast:
    """Context manager for database sessions with lightweight initialization for sub-agents."""

    def __init__(self):
        self.session: AsyncSession | None = None

    async def __aenter__(self) -> AsyncSession:
        """Enter the context manager and return a session with fast initialization."""
        global AsyncSessionLocal
        
        if AsyncSessionLocal is None:
            # Check if database is already ready
            if await is_database_ready():
                # Use lightweight initialization (skip migrations)
                await init_engine_only()
                logger.debug("Using lightweight database initialization for sub-agent")
            else:
                # Database not ready - fall back to full initialization
                await init_database()
                logger.debug("Database not ready - using full initialization")
                
        assert AsyncSessionLocal is not None, "AsyncSessionLocal must be initialized before use"

        self.session = AsyncSessionLocal()
        return self.session

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit the context manager and cleanup session."""
        if self.session:
            if exc_type:
                await self.session.rollback()
            await self.session.close()


# Convenience function for simple queries with smart initialization
async def execute_query(query_func, *args, **kwargs):
    """Execute a query function with automatic session management.
    
    This function automatically detects if it's running in a sub-agent context
    and uses optimized database initialization when appropriate.
    
    Args:
        query_func: Async function that takes a session as first parameter
        *args: Arguments to pass to query_func
        **kwargs: Keyword arguments to pass to query_func
        
    Returns:
        Result of query_func
    """
    # Smart detection: if we're in a sub-agent (not the main MCP server process)
    # and the database is already ready, use fast initialization
    if _is_sub_agent_context() and await is_database_ready():
        async with DatabaseSessionFast() as session:
            return await query_func(session, *args, **kwargs)
    else:
        # Use full initialization for MCP server or when database needs setup
        async with DatabaseSession() as session:
            return await query_func(session, *args, **kwargs)


def _is_sub_agent_context() -> bool:
    """Detect if we're running in a sub-agent context rather than the main MCP server.
    
    Returns:
        bool: True if this appears to be a sub-agent process, False if main server
    """
    import os
    import sys
    
    # Check if we're running as a spawned Claude CLI process
    # Claude CLI processes will have 'claude' in their command line
    try:
        # Get the command line that started this process
        with open(f'/proc/{os.getpid()}/cmdline', 'rb') as f:
            cmdline = f.read().decode('utf-8', errors='ignore')
            
        # If command line contains 'claude' and not 'orchestration_server', 
        # we're likely in a sub-agent
        if 'claude' in cmdline and 'orchestration_server' not in cmdline:
            return True
            
    except (FileNotFoundError, PermissionError, OSError):
        # /proc filesystem not available (non-Linux) or permission issues
        # Fall back to checking sys.argv
        try:
            argv_str = ' '.join(sys.argv)
            if 'claude' in argv_str and 'orchestration_server' not in argv_str:
                return True
        except Exception:
            pass
    
    # Check environment variables that might indicate sub-agent context
    # MCP servers typically run with specific environment settings
    if os.environ.get('MCP_TIMEOUT'):
        # If MCP_TIMEOUT is set and we're not the main server, likely a sub-agent
        return 'orchestration_server' not in ' '.join(sys.argv)
    
    # Default to main server context (safer - uses full initialization)
    return False


# Fast version for sub-agents
async def execute_query_fast(query_func, *args, **kwargs):
    """Execute a query function with optimized session management for sub-agents.
    
    This function uses the fast session factory that skips database initialization
    when the database is already ready, improving performance for sub-agents.
    
    Args:
        query_func: Async function that takes a session as first parameter
        *args: Arguments to pass to query_func
        **kwargs: Keyword arguments to pass to query_func
        
    Returns:
        Result of query_func
    """
    async with DatabaseSessionFast() as session:
        return await query_func(session, *args, **kwargs)


# Optimized function for concurrent operations
async def execute_concurrent_queries(query_specs: list[dict], max_concurrent: int = 10):
    """Execute multiple queries concurrently with controlled parallelism.
    
    Args:
        query_specs: List of query specifications, each containing:
                    - 'func': Query function to execute
                    - 'args': Positional arguments for the function
                    - 'kwargs': Keyword arguments for the function
                    - 'id': Optional identifier for the query
        max_concurrent: Maximum number of concurrent database operations
        
    Returns:
        List of results in the same order as input queries
    """
    if not query_specs:
        return []

    # Semaphore to control concurrent database connections
    db_semaphore = asyncio.Semaphore(max_concurrent)

    async def execute_with_semaphore(query_spec: dict, index: int):
        """Execute a single query with concurrency control."""
        async with db_semaphore:
            try:
                result = await execute_query(
                    query_spec["func"],
                    *query_spec.get("args", []),
                    **query_spec.get("kwargs", {}),
                )
                return {"index": index, "result": result, "success": True, "id": query_spec.get("id")}
            except Exception as e:
                logger.error("Concurrent query failed",
                           query_id=query_spec.get("id", index),
                           error=str(e))
                return {"index": index, "error": str(e), "success": False, "id": query_spec.get("id")}

    # Execute all queries in parallel
    query_tasks = [execute_with_semaphore(spec, i) for i, spec in enumerate(query_specs)]
    results = await asyncio.gather(*query_tasks, return_exceptions=True)

    # Sort results by index and extract the actual results
    sorted_results = sorted([r for r in results if isinstance(r, dict)], key=lambda x: x["index"])
    return [r["result"] if r["success"] else r for r in sorted_results]


# Batch operations for high-performance inserts/updates
async def execute_batch_operations(operations: list[dict], batch_size: int = 50):
    """Execute batch database operations for improved performance.
    
    Args:
        operations: List of operation specifications
        batch_size: Number of operations per batch
        
    Returns:
        Summary of batch execution results
    """
    if not operations:
        return {"success": True, "processed": 0, "batches": 0}

    batches = [operations[i:i + batch_size] for i in range(0, len(operations), batch_size)]
    successful_operations = 0
    failed_operations = 0

    async with DatabaseSession() as session:
        for batch in batches:
            try:
                # Process each operation in the batch
                for operation in batch:
                    if operation["type"] == "insert":
                        session.add(operation["object"])
                    elif operation["type"] == "update":
                        # Update operation handled by modifying the object
                        pass
                    elif operation["type"] == "delete":
                        await session.delete(operation["object"])

                # Commit the entire batch
                await session.commit()
                successful_operations += len(batch)

            except Exception as e:
                logger.error("Batch operation failed", batch_size=len(batch), error=str(e))
                await session.rollback()
                failed_operations += len(batch)

    return {
        "success": failed_operations == 0,
        "processed": successful_operations,
        "failed": failed_operations,
        "batches": len(batches),
        "batch_size": batch_size,
    }


async def is_database_ready(db_path: Path | None = None) -> bool:
    """Quick check if database exists and has current schema.
    
    This function performs a lightweight check to see if the database
    is already initialized and ready for use, avoiding the need for
    full migration checks in sub-agents.
    
    Args:
        db_path: Path to SQLite database file. If None, uses default location.
        
    Returns:
        bool: True if database is ready to use, False if needs full initialization
    """
    try:
        if db_path is None:
            db_path = Path.home() / ".mcptools" / "data" / "orchestration.db"
        
        # Check if database file exists and has content
        if not db_path.exists() or db_path.stat().st_size == 0:
            logger.debug("Database file missing or empty", db_path=str(db_path))
            return False
        
        # Quick schema validation - check if core tables exist
        # Using synchronous sqlite3 for this quick check to avoid async overhead
        import sqlite3
        
        with sqlite3.connect(str(db_path), timeout=5) as conn:
            cursor = conn.cursor()
            
            # Check if alembic version table exists (indicates migrations were run)
            cursor.execute("""
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='alembic_version'
            """)
            if not cursor.fetchone():
                logger.debug("No alembic_version table found - database needs initialization")
                return False
            
            # Check if core tables exist (basic schema validation)
            core_tables = ['agent_sessions', 'chat_rooms', 'memories']
            for table in core_tables:
                cursor.execute("""
                    SELECT name FROM sqlite_master 
                    WHERE type='table' AND name=?
                """, (table,))
                if not cursor.fetchone():
                    logger.debug("Core table missing", table=table)
                    return False
            
            logger.debug("Database appears ready", db_path=str(db_path))
            return True
            
    except Exception as e:
        logger.debug("Database readiness check failed", error=str(e), db_path=str(db_path))
        return False


async def init_engine_only(db_path: Path | None = None) -> None:
    """Initialize database engine and session factory without running migrations.
    
    This is a lightweight initialization for sub-agents that assumes
    the database is already properly initialized with current schema.
    
    Args:
        db_path: Path to SQLite database file. If None, uses default location.
    """
    global engine, AsyncSessionLocal
    
    if db_path is None:
        db_path = Path.home() / ".mcptools" / "data" / "orchestration.db"
    
    # Ensure directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Create async engine with same optimized settings as full init
    database_url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(
        database_url,
        echo=False,
        future=True,
        # Same optimized pool settings
        pool_size=20,
        max_overflow=30,
        pool_timeout=30,
        pool_recycle=3600,
        pool_pre_ping=True,
        connect_args={
            "check_same_thread": False,
            "timeout": 20,
        },
    )
    
    # Create session factory
    AsyncSessionLocal = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    
    logger.info("Database engine initialized (lightweight mode)", db_path=str(db_path))


# =============================================================================
# CONCURRENT DATABASE ACCESS METHODS WITH RETRY
# =============================================================================

async def execute_with_retry(
    operation: Callable,
    max_retries: int = 3,
    base_delay: float = 0.1,
    max_delay: float = 5.0
) -> Any:
    """Execute database operation with exponential backoff retry for busy database.
    
    Args:
        operation: Async function to execute
        max_retries: Maximum number of retry attempts
        base_delay: Initial retry delay in seconds
        max_delay: Maximum retry delay in seconds
        
    Returns:
        Result of the operation
        
    Raises:
        Exception: Re-raises the last exception if all retries fail
    """
    last_exception = None
    
    for attempt in range(max_retries + 1):
        try:
            return await operation()
        except Exception as e:
            last_exception = e
            
            # Check if this is a retryable error
            error_str = str(e).lower()
            if any(term in error_str for term in ['database is locked', 'busy', 'timeout']):
                if attempt < max_retries:
                    # Calculate exponential backoff delay
                    delay = min(base_delay * (2 ** attempt), max_delay)
                    logger.warning(
                        "Database operation failed, retrying",
                        attempt=attempt + 1,
                        max_retries=max_retries,
                        delay=delay,
                        error=str(e)
                    )
                    await asyncio.sleep(delay)
                    continue
            
            # Non-retryable error or max retries reached
            break
    
    # All retries failed
    if last_exception is not None:
        logger.error("Database operation failed after all retries", error=str(last_exception))
        raise last_exception
    else:
        # This shouldn't happen, but handle the edge case
        error_msg = "Database operation failed after all retries (no exception captured)"
        logger.error(error_msg)
        raise RuntimeError(error_msg)


# =============================================================================
# MCP-SAFE DATABASE ACCESS METHODS
# =============================================================================

async def mcp_safe_execute_query(query_func, *args, timeout: float = 5.0, **kwargs):
    """Execute a query function with MCP-safe session management and timeout protection.
    
    This function is specifically designed to work safely with FastMCP's communication 
    channel lifecycle by ensuring database operations complete before MCP timeouts
    and providing proper error isolation.
    
    Args:
        query_func: Async function that takes a session as first parameter
        *args: Arguments to pass to query_func
        timeout: Maximum time allowed for database operation (default 5 seconds)
        **kwargs: Keyword arguments to pass to query_func
        
    Returns:
        Result of query_func or None if timeout/error occurs
        
    Raises:
        asyncio.TimeoutError: If operation exceeds timeout
        Exception: Re-raises database errors after proper cleanup
    """
    # Fast path: Direct session creation without complex context detection
    global AsyncSessionLocal
    
    try:
        # Ensure database is initialized with lightweight approach
        if AsyncSessionLocal is None:
            if await is_database_ready():
                await init_engine_only()
                logger.debug("MCP-safe: Using lightweight database initialization")
            else:
                await init_database()
                logger.debug("MCP-safe: Using full database initialization")
        
        assert AsyncSessionLocal is not None, "AsyncSessionLocal must be initialized"
        
        # Execute with timeout protection
        async with asyncio.timeout(timeout):
            async with AsyncSessionLocal() as session:
                try:
                    result = await query_func(session, *args, **kwargs)
                    return result
                except Exception as e:
                    await session.rollback()
                    logger.warning("MCP-safe query failed, rolled back transaction", error=str(e))
                    raise
                finally:
                    # Explicit session close to ensure cleanup before MCP channel closure
                    await session.close()
                    
    except asyncio.TimeoutError:
        logger.warning("MCP-safe query timed out", timeout=timeout, func=query_func.__name__)
        raise
    except Exception as e:
        logger.error("MCP-safe query error", error=str(e), func=query_func.__name__)
        raise


class MCPSafeSession:
    """MCP-safe database session context manager with explicit lifecycle control.
    
    This context manager is optimized for FastMCP resource handlers, ensuring
    database sessions are properly closed before MCP communication channels.
    """
    
    def __init__(self, timeout: float = 5.0):
        """Initialize MCP-safe session context manager.
        
        Args:
            timeout: Maximum time allowed for all database operations in this session
        """
        self.session: AsyncSession | None = None
        self.timeout = timeout
        self._timeout_handle = None
    
    async def __aenter__(self) -> AsyncSession:
        """Enter the context manager and return a session with timeout protection."""
        global AsyncSessionLocal
        
        # Ensure database is initialized
        if AsyncSessionLocal is None:
            if await is_database_ready():
                await init_engine_only()
            else:
                await init_database()
        
        assert AsyncSessionLocal is not None, "AsyncSessionLocal must be initialized"
        
        # Create session with timeout protection
        self._timeout_handle = asyncio.timeout(self.timeout)
        await self._timeout_handle.__aenter__()
        
        self.session = AsyncSessionLocal()
        logger.debug("MCP-safe session created", timeout=self.timeout)
        return self.session
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit the context manager with guaranteed cleanup."""
        try:
            if self.session:
                if exc_type:
                    await self.session.rollback()
                    logger.debug("MCP-safe session rolled back due to exception")
                # Always explicitly close the session
                await self.session.close()
                logger.debug("MCP-safe session closed")
        except Exception as cleanup_error:
            logger.warning("Error during MCP-safe session cleanup", error=str(cleanup_error))
        finally:
            # Always clean up timeout handler
            if self._timeout_handle:
                try:
                    await self._timeout_handle.__aexit__(exc_type, exc_val, exc_tb)
                except Exception:
                    pass  # Ignore timeout handler cleanup errors


# =============================================================================
# SYNCHRONOUS DATABASE FUNCTIONS FOR THREADPOOLEXECUTOR
# =============================================================================

def get_session_sync(db_path: Path | None = None) -> sqlite3.Connection:
    """Get a synchronous SQLite database connection for use within ThreadPoolExecutor threads.
    
    This function provides direct sqlite3 access for thread-safe operations that
    avoid uvloop conflicts in ThreadPoolExecutor environments.
    
    Args:
        db_path: Path to SQLite database file. If None, uses default location.
        
    Returns:
        sqlite3.Connection: Direct SQLite database connection
        
    Raises:
        sqlite3.Error: If database connection fails
    """
    if db_path is None:
        db_path = Path.home() / ".mcptools" / "data" / "orchestration.db"
    
    # Ensure directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        # Create connection with optimized settings for concurrent access
        conn = sqlite3.connect(
            str(db_path),
            timeout=30.0,  # 30 second timeout for concurrent access
            check_same_thread=False,  # Allow cross-thread usage
            isolation_level=None  # Autocommit mode for thread safety
        )
        
        # Set pragmas for better concurrent performance
        conn.execute("PRAGMA busy_timeout = 30000")  # 30 second busy timeout
        conn.execute("PRAGMA journal_mode = WAL")    # Write-Ahead Logging for concurrency
        conn.execute("PRAGMA synchronous = NORMAL")  # Balance between safety and speed
        conn.execute("PRAGMA cache_size = -64000")   # 64MB cache size
        conn.execute("PRAGMA temp_store = MEMORY")   # Store temp tables in memory
        
        logger.debug("Synchronous database connection established", db_path=str(db_path))
        return conn
        
    except sqlite3.Error as e:
        logger.error("Failed to establish synchronous database connection", 
                    db_path=str(db_path), error=str(e))
        raise


def save_scraped_urls_sync(scraped_data: list[dict], source_id: str, db_path: Path | None = None) -> None:
    """Save scraped URLs to database for deduplication using synchronous SQLite access.
    
    This function mirrors the async _save_scraped_urls functionality for use in
    ThreadPoolExecutor threads where async operations would conflict with uvloop.
    
    Args:
        scraped_data: List of scraped entry data with URLs and metadata
        source_id: Documentation source ID for associating URLs
        db_path: Path to SQLite database file. If None, uses default location.
        
    Raises:
        sqlite3.Error: If database operations fail
    """
    if not scraped_data:
        logger.debug("No scraped data to save")
        return
    
    conn = None
    try:
        conn = get_session_sync(db_path)
        
        # Import here to avoid circular imports
        from .models.documentation import ScrapedUrl
        
        # Prepare batch insert data
        scraped_url_records = []
        
        for entry_data in scraped_data:
            url = entry_data.get("url")
            content_hash = entry_data.get("content_hash")
            
            if url:
                normalized_url = ScrapedUrl.normalize_url(url)
                
                # Create record data tuple
                record = (
                    str(uuid.uuid4()),              # id
                    normalized_url,                 # normalized_url
                    url,                           # original_url
                    source_id,                     # source_id
                    content_hash,                  # content_hash
                    datetime.now(timezone.utc),    # last_scraped
                    1,                             # scrape_count
                    200,                           # last_status_code
                    datetime.now(timezone.utc),    # created_at
                    datetime.now(timezone.utc)     # updated_at
                )
                scraped_url_records.append(record)
        
        # Batch insert with IGNORE to handle conflicts gracefully
        if scraped_url_records:
            insert_sql = """
                INSERT OR IGNORE INTO scraped_urls (
                    id, normalized_url, original_url, source_id, content_hash,
                    last_scraped, scrape_count, last_status_code, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            
            conn.executemany(insert_sql, scraped_url_records)
            
            # Get number of rows actually inserted
            rows_inserted = conn.total_changes
            
            logger.info("💾 Saved scraped URLs to database (sync)",
                       total_records=len(scraped_url_records),
                       rows_inserted=rows_inserted,
                       source_id=source_id)
    
    except sqlite3.Error as e:
        logger.warning("Failed to save scraped URLs to database (sync)", 
                      error=str(e), source_id=source_id)
        raise
    except Exception as e:
        logger.error("Unexpected error saving scraped URLs (sync)", 
                    error=str(e), source_id=source_id)
        raise
    finally:
        if conn:
            conn.close()


def check_existing_urls_sync(urls: list[str], source_id: str, db_path: Path | None = None) -> set[str]:
    """Check which URLs have already been scraped using synchronous database lookups.
    
    This function mirrors the async _check_existing_urls functionality for use in
    ThreadPoolExecutor threads where async operations would conflict with uvloop.
    
    Args:
        urls: List of URLs to check for existing records
        source_id: Documentation source ID to scope the check
        db_path: Path to SQLite database file. If None, uses default location.
        
    Returns:
        Set of normalized URLs that already exist in the database
        
    Raises:
        sqlite3.Error: If database query fails
    """
    if not urls:
        logger.debug("No URLs to check")
        return set()
    
    conn = None
    try:
        conn = get_session_sync(db_path)
        
        # Import here to avoid circular imports
        from .models.documentation import ScrapedUrl
        
        # Normalize all URLs first
        normalized_urls = [ScrapedUrl.normalize_url(url) for url in urls]
        
        # Prepare query with placeholders for IN clause
        placeholders = ','.join('?' for _ in normalized_urls)
        query_sql = f"""
            SELECT normalized_url 
            FROM scraped_urls 
            WHERE normalized_url IN ({placeholders}) 
            AND source_id = ?
        """
        
        # Execute query with normalized URLs and source_id
        cursor = conn.execute(query_sql, normalized_urls + [source_id])
        existing_normalized = {row[0] for row in cursor.fetchall()}
        
        logger.info("🔍 Database URL check completed (sync)",
                   total_urls=len(urls),
                   existing_count=len(existing_normalized),
                   new_count=len(normalized_urls) - len(existing_normalized),
                   source_id=source_id)
        
        return existing_normalized
    
    except sqlite3.Error as e:
        logger.warning("Failed to check existing URLs (sync), proceeding without deduplication", 
                      error=str(e), source_id=source_id)
        # Return empty set to allow processing to continue
        return set()
    except Exception as e:
        logger.error("Unexpected error checking existing URLs (sync)", 
                    error=str(e), source_id=source_id)
        # Return empty set to allow processing to continue  
        return set()
    finally:
        if conn:
            conn.close()




async def get_session_fast() -> AsyncGenerator[AsyncSession, None]:
    """Get an async database session with minimal initialization for sub-agents.
    
    This function optimizes database access for sub-agents by skipping
    migration checks when the database is already properly initialized.
    Falls back to full initialization if the database is not ready.
    
    Yields:
        AsyncSession: Database session
    """
    global AsyncSessionLocal
    
    if AsyncSessionLocal is None:
        # Check if database is already ready
        if await is_database_ready():
            # Use lightweight initialization (skip migrations)
            await init_engine_only()
            logger.debug("Using lightweight database initialization for sub-agent")
        else:
            # Database not ready - fall back to full initialization
            await init_database()
            logger.debug("Database not ready - using full initialization")
    
    # Same session management as get_session()
    assert AsyncSessionLocal is not None, "AsyncSessionLocal must be initialized before use"
    
    # Create session outside of async with to avoid cancellation issues
    session = AsyncSessionLocal()
    try:
        # Yield outside of resource management context to prevent cancellation bugs
        yield session
    except SQLAlchemyError as e:
        await session.rollback()
        logger.error("Database session error", error=str(e))
        raise
    finally:
        await session.close()



async def _init_database_with_migrations_locked(db_path: Path) -> None:
    """Perform database initialization WITH migrations (for setup only)."""
    global engine, AsyncSessionLocal

    # Create async engine with aiosqlite and connection pooling
    database_url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(
        database_url,
        echo=False,  # Set to True for SQL debugging
        future=True,
        # Enhanced pool settings for high concurrent operations
        pool_size=50,           # More connections for concurrent agents
        max_overflow=100,       # Allow many concurrent operations
        pool_timeout=60,        # Longer wait time for busy periods
        pool_recycle=7200,      # Refresh connections every 2 hours
        pool_pre_ping=True,     # Verify connections before use
        # SQLite-specific optimizations for concurrency
        connect_args={
            "check_same_thread": False,  # Allow cross-thread usage
            "timeout": 60,               # Longer connection timeout for busy periods
            # SQLite WAL mode for better concurrency
            "isolation_level": None,     # Autocommit mode
        },
    )

    # Create session factory
    AsyncSessionLocal = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    # Run database migrations to ensure schema is up to date
    await run_migrations(db_path)

    # Enable SQLite WAL mode for better concurrent access
    await _enable_wal_mode()

    logger.info("Database initialized with migrations and WAL mode", db_path=str(db_path))

