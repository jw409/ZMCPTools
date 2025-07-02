"""Database session management and initialization for SQLAlchemy ORM."""

import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path

import structlog
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .models import Base

logger = structlog.get_logger()

# Global engine and session factory
engine = None
AsyncSessionLocal = None


async def init_database(db_path: Path | None = None) -> None:
    """Initialize database engine, create tables, and set up session factory.
    
    Args:
        db_path: Path to SQLite database file. If None, uses default location.
    """
    global engine, AsyncSessionLocal

    if db_path is None:
        # Default to .claude/zmcptools directory in user's home
        db_path = Path.home() / ".claude" / "zmcptools" / "orchestration.db"

    # Ensure directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # Create async engine with aiosqlite and connection pooling
    database_url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(
        database_url,
        echo=False,  # Set to True for SQL debugging
        future=True,
        # Optimized pool settings for concurrent operations
        pool_size=20,           # More connections for concurrent agents
        max_overflow=30,        # Allow bursts of additional connections
        pool_timeout=30,        # Wait time for connection
        pool_recycle=3600,      # Refresh connections hourly
        pool_pre_ping=True,     # Verify connections before use
        # SQLite-specific optimizations
        connect_args={
            "check_same_thread": False,  # Allow cross-thread usage
            "timeout": 20,               # Connection timeout
        },
    )

    # Create session factory
    AsyncSessionLocal = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    # Create all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database initialized", db_path=str(db_path))


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Get an async database session.
    
    Yields:
        AsyncSession: Database session
    """
    if AsyncSessionLocal is None:
        await init_database()

    async with AsyncSessionLocal() as session:
        try:
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

        self.session = AsyncSessionLocal()
        return self.session

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit the context manager and cleanup session."""
        if self.session:
            if exc_type:
                await self.session.rollback()
            await self.session.close()


# Convenience function for simple queries
async def execute_query(query_func, *args, **kwargs):
    """Execute a query function with automatic session management.
    
    Args:
        query_func: Async function that takes a session as first parameter
        *args: Arguments to pass to query_func
        **kwargs: Keyword arguments to pass to query_func
        
    Returns:
        Result of query_func
    """
    async with DatabaseSession() as session:
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
