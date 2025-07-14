# FastMCP Integration Guide

This document outlines key information about FastMCP configuration and best practices for the ZMCPTools project.

## Key Findings

### Tool Registration Issue

**Problem**: Claude Code appears to be automatically stringifying JSON parameters, causing FastMCP input validation errors like:
```
Error: Input validation error: '{"source_name": "...", "url": "...", ...}' is not of type 'object'
```

**Root Cause**: FastMCP expects actual objects, not JSON strings, when using Pydantic schemas as parameters.

### FastMCP Tool Configuration Best Practices

Based on the FastMCP documentation, here are the recommended approaches:

#### 1. Tool Decorator Usage

FastMCP automatically infers tool names and descriptions from function names and docstrings:

```python
@app.tool(tags={"category", "subcategory"})  # Minimal decorator
async def my_function(params: MySchema) -> dict[str, Any]:
    """This docstring becomes the tool description."""
    # Implementation
```

**Key Points:**
- Function name becomes tool name automatically
- Docstring becomes tool description
- Only specify `name` and `description` in decorator if you need to override defaults
- Always keep `tags` for categorization

#### 2. Schema Handling

FastMCP handles Pydantic schemas correctly when:
- The schema is properly typed
- Field validation is set up correctly
- The client sends actual objects, not JSON strings

**Current Issue**: The stringification problem suggests either:
1. Claude Code interface issue with JSON serialization
2. FastMCP server configuration issue
3. Schema definition problem

#### 3. Composition Patterns

FastMCP supports two composition approaches:

**Option A: Import Pattern (Static)**
```python
# Separate tool modules
weather_tools = FastMCP("WeatherTools")
main_app = FastMCP("MainApp")

# Import tools from other modules
main_app.import_server(weather_tools, prefix="weather_")
```

**Option B: Mount Pattern (Dynamic)**
```python
# Live mounting for dynamic updates
main_app.mount(weather_tools, prefix="weather")
```

### Recommended Refactoring

Instead of the current `register_*_tools(app)` pattern, consider:

1. **Separate MCP servers per domain**:
   ```python
   # memory_server.py
   memory_mcp = FastMCP("MemoryTools")
   
   @memory_mcp.tool(tags={"memory", "storage"})
   async def store_memory_entry(params: StoreMemoryEntrySchema):
       # Implementation
   ```

2. **Compose in main server**:
   ```python
   # main_server.py
   main_mcp = FastMCP("ZMCPTools")
   main_mcp.import_server(memory_mcp)
   main_mcp.import_server(documentation_mcp)
   main_mcp.import_server(communication_mcp)
   ```

### Context and Advanced Features

FastMCP provides rich context capabilities:

```python
from fastmcp import Context

@app.tool(tags={"analysis"})
async def analyze_with_context(data: str, ctx: Context) -> dict:
    await ctx.info("Starting analysis...")
    
    # Use LLM sampling for AI-powered analysis
    result = await ctx.sample(
        messages=[f"Analyze this data: {data}"],
        temperature=0.1
    )
    
    await ctx.info("Analysis complete")
    return {"analysis": result}
```

### Input Validation Debugging

To debug the current validation issue:

1. **Check FastMCP version**: Ensure using latest version
2. **Verify schema definitions**: Make sure Pydantic schemas are correctly defined
3. **Test with minimal example**: Create simple tool to isolate the issue
4. **Check client serialization**: Verify how Claude Code sends parameters

### Next Steps

1. **Test minimal FastMCP setup** to verify if issue is in our configuration
2. **Consider modular server architecture** using composition patterns
3. **Add proper error handling** and logging using FastMCP context
4. **Implement sampling features** for AI-powered tool capabilities

## Message Handling

FastMCP provides flexible message handling capabilities for client-server communication:

### Function-Based Message Handler

Simple approach that receives all messages:

```python
async def message_handler(message):
    if hasattr(message, 'root'):
        method = message.root.method
        print(f"Received: {method}")

client = Client(
    "my_mcp_server.py",
    message_handler=message_handler,
)
```

### Class-Based Message Handler

More structured approach using `MessageHandler` class:

```python
from fastmcp import MessageHandler
import mcp.types

class MyMessageHandler(MessageHandler):
    async def on_tool_list_changed(
        self, notification: mcp.types.ToolListChangedNotification
    ):
        print("Tool list changed - refreshing available tools")
    
    async def on_progress(self, notification):
        """Handle progress updates from long-running operations"""
        progress = notification.progress
        print(f"Progress: {progress.progress}/{progress.total}")
    
    async def on_logging_message(self, notification):
        """Handle server log messages"""
        level = notification.level
        message = notification.data
        print(f"[{level}] {message}")

client = Client(
    "my_mcp_server.py",
    message_handler=MyMessageHandler(),
)
```

### Available Handler Methods

- `on_message(message)`: Handles ALL messages
- `on_request(request)`: Handles requests needing responses  
- `on_notification(notification)`: Handles notifications
- `on_tool_list_changed(notification)`: Tool list updates
- `on_progress(notification)`: Progress updates from operations
- `on_logging_message(notification)`: Server log messages

### Progress Callbacks

For request-specific handling, use dedicated callback parameters:

```python
# Progress callback for long-running operations
async def progress_callback(progress):
    print(f"Operation progress: {progress.progress}/{progress.total}")

# Use with specific operations
result = await client.call_tool(
    "long_running_operation",
    arguments={"data": "large_dataset"},
    progress_handler=progress_callback
)
```

## Logging System

FastMCP provides comprehensive logging capabilities for server-client communication:

### Log Levels

Supported log levels (in order of severity):
- `"debug"`
- `"info"` 
- `"notice"`
- `"warning"`
- `"error"`
- `"critical"`
- `"alert"`
- `"emergency"`

### Log Handler Implementation

```python
from fastmcp.types import LogMessage

async def log_handler(message: LogMessage):
    level = message.level.upper()
    logger = message.logger or 'server'
    data = message.data
    
    # Custom log formatting and routing
    timestamp = datetime.now().isoformat()
    formatted_log = f"[{timestamp}] [{level}] {logger}: {data}"
    
    # Route to appropriate logger
    if level in ['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY']:
        print(f"🔴 {formatted_log}")
    elif level in ['WARNING']:
        print(f"🟡 {formatted_log}")
    elif level in ['INFO', 'NOTICE']:
        print(f"🔵 {formatted_log}")
    else:  # DEBUG
        print(f"⚪ {formatted_log}")

client = Client(
    "my_mcp_server.py",
    log_handler=log_handler,
)
```

### Log Message Attributes

- `level`: Log severity level string
- `logger`: Optional logger name (can be None)
- `data`: The actual log message content

### Default Behavior

If no custom log handler is provided, FastMCP automatically emits a DEBUG-level log for each received message.

### Server-Side Logging

Tools can emit logs using the Context object:

```python
@app.tool(tags={"logging", "example"})
async def logging_example(message: str, ctx: Context) -> dict[str, Any]:
    """Example tool demonstrating logging capabilities."""
    
    await ctx.debug(f"Starting processing for: {message}")
    await ctx.info("Processing initiated")
    
    try:
        # Simulate work
        result = process_message(message)
        await ctx.info(f"Processing completed successfully")
        return {"success": True, "result": result}
        
    except Exception as e:
        await ctx.error(f"Processing failed: {str(e)}")
        await ctx.critical("Critical error in message processing")
        return {"success": False, "error": str(e)}
```

## Transport System

FastMCP provides flexible transport options for different deployment scenarios:

### ⚠️ Important Configuration Notes

**Deprecated Parameters**: As of recent FastMCP versions, several constructor parameters are deprecated:
- `stateless_http`: Should be passed to `run()` method or set globally instead
- Server configuration should be done through `fastmcp.settings` rather than constructor

**Current Best Practices**:
```python
# ❌ Deprecated - don't do this
app = FastMCP(stateless_http=True, host="0.0.0.0")

# ✅ Recommended - do this instead  
app = FastMCP("MyServer")
app.run(transport="http", stateless_http=True, host="0.0.0.0")

# Or configure globally
import fastmcp
fastmcp.settings.stateless_http = True
```

### Transport Inference

FastMCP automatically determines the connection method based on input:

```python
from fastmcp import Client, FastMCP

# In-memory transport (recommended for testing)
client_memory = Client(FastMCP("TestServer"))

# Python Stdio transport (file ending in .py)
client_script = Client("./server.py")

# Node.js Stdio transport (file ending in .js) 
client_node = Client("./server.js")

# HTTP transport (URLs starting with http/https)
client_http = Client("https://api.example.com/mcp")

# Multi-server client (MCPConfig dictionary)
client_multi = Client(config_dict)
```

### Available Transport Types

#### 1. Network Transports
- **Streamable HTTP** (recommended for remote/persistent servers)
- **Server-Sent Events (SSE)** (legacy support)

```python
# HTTP transport with authentication
client = Client(
    "https://mcp-server.example.com",
    headers={"Authorization": "Bearer your-token"},
    keep_alive=True  # Session persistence
)
```

#### 2. Local Transports
- **Python Stdio** - For `.py` server files
- **Node.js Stdio** - For `.js` server files  
- **UVX Stdio** (experimental) - For uvx tool mode
- **NPX Stdio** (experimental) - For npm packages

```python
# UVX transport (relevant for uvx tool mode)
client = Client("uvx://claude-mcp-tools")

# Python stdio with custom interpreter
client = Client("./server.py", interpreter="python3.11")

# Environment configuration
client = Client("./server.py", env={"CUSTOM_VAR": "value"})
```

#### 3. In-Memory Transport
- **FastMCP Transport** - Direct server communication (testing)

```python
# Preferred for testing - eliminates network complexity
server = FastMCP("TestServer")
client = Client(server)  # In-memory communication
```

#### 4. Configuration-Based Transport
- **MCPConfig Transport** - Multi-server management

```python
config = {
    "mcpServers": {
        "claude-mcp-tools": {
            "command": "uvx",
            "args": ["claude-mcp-tools"],
            "env": {"DEBUG": "1"}
        }
    }
}
client = Client(config)
```

### Transport Recommendations

| Use Case | Recommended Transport | Example |
|----------|----------------------|---------|
| Testing/Development | FastMCP (in-memory) | `Client(FastMCP("TestServer"))` |
| Remote Servers | Streamable HTTP | `Client("https://api.example.com")` |
| Local Python Scripts | Python Stdio | `Client("./server.py")` |
| UVX Tool Mode | UVX Stdio | `Client("uvx://claude-mcp-tools")` |
| Multi-Server Setup | MCPConfig | `Client(config_dict)` |

### UVX Transport Considerations

When running in uvx tool mode, FastMCP can use UVX Stdio transport for **client connections**:

**Note**: UVX transport is typically used when creating a **client** that connects to a UVX-packaged server, not when **running** the server itself. For ZMCPTools:

- **Server Side**: Uses default stdio transport (handled by Claude Code launcher)
- **Client Side**: Can use UVX transport when connecting to ZMCPTools from other applications

```python
# UVX-specific CLIENT configuration (for connecting TO ZMCPTools)
client = Client(
    "uvx://claude-mcp-tools",
    args=["--debug"],  # Additional uvx arguments
    env={"MCPTOOLS_DEBUG": "1"},  # Environment variables
    keep_alive=True  # Maintain connection
)

# SERVER configuration (ZMCPTools itself) - uses stdio by default
app = FastMCP("ZMCPTools Orchestration Server")
app.run()  # Uses stdio transport automatically when called by Claude Code
```

**Key Benefits for UVX Mode:**
- Automatic dependency management
- Isolated execution environment  
- Simple deployment and updates
- Consistent runtime environment

**Configuration Options:**
- `args`: Additional arguments passed to uvx
- `env`: Environment variables for the uvx process
- `keep_alive`: Whether to maintain persistent connections
- `interpreter`: Specific Python version (if needed)

## 🚨 CRITICAL FINDINGS: Transport Issues in ZMCPTools

### Root Cause of ClosedResourceError Crashes

**DISCOVERED**: The `ClosedResourceError` crashes in ZMCPTools are caused by **async context conflicts**, NOT database issues.

#### Key Finding: `server.run()` Async Context Issue

```python
# ❌ PROBLEM: This causes "Already running asyncio in this thread"
async def some_async_function():
    server = FastMCP("MyServer")
    server.run(transport="http", host="127.0.0.1", port=9876)  # FAILS!

# ✅ SOLUTION: server.run() must be called from non-async context
def main():
    server = FastMCP("MyServer") 
    server.run(transport="http", host="127.0.0.1", port=9876)  # WORKS!
```

#### Test Results Summary

**✅ In-Memory Transport**: Works perfectly, no errors
- `client = Client(FastMCP("TestServer"))` - No issues
- Tools execute correctly with proper return values
- No `ClosedResourceError` or communication failures

**❌ HTTP Transport in Async Context**: Fails with async conflict
- `server.run()` cannot be called from within async functions
- Causes `RuntimeError: Already running asyncio in this thread`
- This is likely the root cause of orchestration crashes

**✅ HTTP Transport in Sync Context**: Should work (requires separate testing)
- Server must run in non-async context
- Client connections work from async context

#### Impact on ZMCPTools Architecture

The orchestration server crashes because:

1. **Main server runs via stdio** (managed by Claude Code)
2. **Orchestration attempts** may try to start additional servers
3. **Async context conflicts** occur when `server.run()` is called from async orchestration code
4. **FastMCP communication channels** get corrupted, causing `ClosedResourceError`

#### Recommended Fix

**Do NOT restart or create new FastMCP servers from within async orchestration code**. Instead:

1. **Use existing server instance** for all operations
2. **Never call `server.run()` from async functions**
3. **Handle errors gracefully** without server restarts
4. **Use proper async session management** for database operations

#### Testing Commands

```bash
# Test in-memory transport (works)
uv run python test_fastmcp_http_transport.py

# Test HTTP server (separate processes)
# Terminal 1:
uv run python test_fastmcp_http_simple.py

# Terminal 2: 
uv run python test_fastmcp_client.py
```

## 📋 Latest FastMCP Server Configuration (2024 Updates)

### Updated Constructor Patterns

**FastMCP 2.0** introduces improved configuration patterns with more flexible server initialization:

```python
# ✅ Recommended 2024 Pattern
from fastmcp import FastMCP, Context

app = FastMCP(
    name="ZMCPTools",
    instructions="Advanced MCP server with orchestration capabilities",
    tags={"orchestration", "documentation", "memory"},
    dependencies=["redis>=5.0.0", "aiohttp>=3.8.0"],  # Optional package specs
    include_tags={"public", "api"},  # Selectively expose components
    exclude_tags={"internal", "debug"},  # Hide specific components
    on_duplicate_tools="warn"  # Options: "error", "warn", "replace"
)

# ❌ Deprecated Pattern (avoid)
app = FastMCP(
    stateless_http=True,  # Deprecated - use run() method instead
    host="0.0.0.0"       # Deprecated - use run() method instead
)
```

### Settings Management (2024)

**Environment Variable Configuration**:
```python
# Configure via environment variables (prefixed with FASTMCP_)
import os

os.environ["FASTMCP_LOG_LEVEL"] = "DEBUG"
os.environ["FASTMCP_MASK_ERROR_DETAILS"] = "False"
os.environ["FASTMCP_RESOURCE_PREFIX_FORMAT"] = "protocol"

# Or use global settings
import fastmcp
fastmcp.settings.log_level = "DEBUG"
fastmcp.settings.mask_error_details = False
```

**Advanced Configuration Options**:
```python
# Custom serialization for tools
import yaml

def yaml_serializer(data):
    return yaml.dump(data, sort_keys=False)

app = FastMCP(
    name="CustomServer",
    tool_serializer=yaml_serializer,
    instructions="Server with custom YAML serialization"
)
```

### Deprecated Parameters (IMPORTANT)

**⚠️ Breaking Changes in 2024**:
- `stateless_http`: Move to `run()` method or global settings
- `host`/`port`: Move to `run()` method transport configuration
- Server-specific settings: Use environment variables or global settings

```python
# ❌ OLD WAY (Deprecated)
app = FastMCP("MyServer", stateless_http=True, host="0.0.0.0", port=8000)

# ✅ NEW WAY (2024 Pattern)
app = FastMCP("MyServer")
app.run(transport="http", host="0.0.0.0", port=8000, stateless_http=True)

# Or configure globally
fastmcp.settings.stateless_http = True
app.run(transport="http", host="0.0.0.0", port=8000)
```

## 🛡️ Enhanced Error Handling Patterns

### Comprehensive Exception Handling

**Production-Ready Error Handling**:
```python
from fastmcp import FastMCP, Context
import asyncio
import logging

logger = logging.getLogger(__name__)

@app.tool(tags={"robust", "error-handling"})
async def robust_operation(params: OperationSchema, ctx: Context) -> dict[str, Any]:
    """Tool with comprehensive error handling and recovery."""
    
    try:
        await ctx.info(f"Starting operation: {params.operation_type}")
        
        # Validate inputs
        if not params.data:
            await ctx.warning("No data provided, using defaults")
            params.data = get_default_data()
        
        # Main operation with timeout
        result = await asyncio.wait_for(
            perform_operation(params.data),
            timeout=30.0
        )
        
        await ctx.info("Operation completed successfully")
        return {"success": True, "result": result, "metadata": {"duration": "30s"}}
        
    except asyncio.TimeoutError:
        await ctx.error("Operation timed out after 30 seconds")
        return {
            "success": False, 
            "error": {"code": "TIMEOUT", "message": "Operation exceeded time limit"}
        }
        
    except ValidationError as e:
        await ctx.error(f"Input validation failed: {e}")
        return {
            "success": False,
            "error": {"code": "VALIDATION_ERROR", "message": str(e), "details": e.errors()}
        }
        
    except ConnectionError as e:
        await ctx.error(f"Connection failed: {e}")
        # Implement retry logic
        return await retry_operation(params, ctx, max_retries=3)
        
    except Exception as e:
        await ctx.error(f"Unexpected error: {str(e)}")
        logger.exception("Unexpected error in robust_operation")
        return {
            "success": False,
            "error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"}
        }

async def retry_operation(params: OperationSchema, ctx: Context, max_retries: int = 3) -> dict[str, Any]:
    """Retry operation with exponential backoff."""
    for attempt in range(max_retries):
        try:
            await ctx.info(f"Retry attempt {attempt + 1}/{max_retries}")
            delay = 2 ** attempt  # Exponential backoff
            await asyncio.sleep(delay)
            
            result = await perform_operation(params.data)
            await ctx.info(f"Retry successful on attempt {attempt + 1}")
            return {"success": True, "result": result, "retry_count": attempt + 1}
            
        except Exception as e:
            if attempt == max_retries - 1:
                await ctx.error(f"All retry attempts failed: {e}")
                return {
                    "success": False,
                    "error": {"code": "RETRY_EXHAUSTED", "message": f"Failed after {max_retries} attempts"}
                }
            await ctx.warning(f"Retry attempt {attempt + 1} failed: {e}")
```

### Client Disconnection Management

**Graceful Disconnection Handling**:
```python
import asyncio
from contextlib import asynccontextmanager

class ConnectionManager:
    """Manages client connections and cleanup."""
    
    def __init__(self):
        self.active_connections = set()
        self.cleanup_tasks = {}
    
    @asynccontextmanager
    async def connection_context(self, connection_id: str):
        """Context manager for connection lifecycle."""
        self.active_connections.add(connection_id)
        try:
            yield connection_id
        finally:
            await self.cleanup_connection(connection_id)
    
    async def cleanup_connection(self, connection_id: str):
        """Clean up resources for a disconnected client."""
        if connection_id in self.active_connections:
            self.active_connections.remove(connection_id)
            
            # Cancel any pending tasks for this connection
            if connection_id in self.cleanup_tasks:
                task = self.cleanup_tasks[connection_id]
                if not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                del self.cleanup_tasks[connection_id]

connection_manager = ConnectionManager()

@app.tool(tags={"connection", "management"})
async def long_running_operation(params: LongRunningSchema, ctx: Context) -> dict[str, Any]:
    """Handle long-running operations with proper cleanup."""
    
    connection_id = f"conn_{id(ctx)}"
    
    async with connection_manager.connection_context(connection_id):
        try:
            # Start background task
            task = asyncio.create_task(background_work(params.data))
            connection_manager.cleanup_tasks[connection_id] = task
            
            # Report progress
            for i in range(10):
                await ctx.report_progress(i + 1, 10, f"Processing step {i + 1}")
                await asyncio.sleep(1)
            
            result = await task
            return {"success": True, "result": result}
            
        except asyncio.CancelledError:
            await ctx.warning("Operation cancelled due to client disconnection")
            return {"success": False, "error": {"code": "CANCELLED", "message": "Operation cancelled"}}
```

## 🔄 Async Context Management

### Proper Lifespan Management

**Server Lifespan Handling**:
```python
from contextlib import asynccontextmanager
from fastmcp import FastMCP
import asyncio

@asynccontextmanager
async def lifespan(app: FastMCP):
    """Manage server lifespan with proper resource initialization and cleanup."""
    
    # Startup
    await startup_resources()
    try:
        yield
    finally:
        # Cleanup
        await cleanup_resources()

async def startup_resources():
    """Initialize resources on server startup."""
    # Initialize database connections
    await init_database_pool()
    
    # Initialize Redis connections
    await init_redis_client()
    
    # Start background tasks
    await start_background_tasks()
    
    logger.info("Server resources initialized successfully")

async def cleanup_resources():
    """Clean up resources on server shutdown."""
    # Stop background tasks
    await stop_background_tasks()
    
    # Close database connections
    await close_database_pool()
    
    # Close Redis connections
    await close_redis_client()
    
    logger.info("Server resources cleaned up successfully")

# Apply lifespan to server
app = FastMCP("ZMCPTools", lifespan=lifespan)
```

### Resource Cleanup Patterns

**Automatic Resource Management**:
```python
from contextlib import asynccontextmanager
import aiohttp
import asyncio

class ResourceManager:
    """Centralized resource management for the MCP server."""
    
    def __init__(self):
        self.http_session = None
        self.background_tasks = set()
        self.cleanup_handlers = []
    
    async def initialize(self):
        """Initialize all managed resources."""
        # Create HTTP session with proper configuration
        connector = aiohttp.TCPConnector(
            limit=100,  # Connection pool limit
            limit_per_host=10,
            ttl_dns_cache=300,
            use_dns_cache=True,
            keepalive_timeout=30,
            enable_cleanup_closed=True
        )
        
        self.http_session = aiohttp.ClientSession(
            connector=connector,
            timeout=aiohttp.ClientTimeout(total=30, connect=10)
        )
        
        # Register cleanup handler
        self.cleanup_handlers.append(self.cleanup_http_session)
    
    async def cleanup_http_session(self):
        """Clean up HTTP session."""
        if self.http_session:
            await self.http_session.close()
            self.http_session = None
    
    async def create_background_task(self, coro):
        """Create and track background task."""
        task = asyncio.create_task(coro)
        self.background_tasks.add(task)
        task.add_done_callback(self.background_tasks.discard)
        return task
    
    async def cleanup_all(self):
        """Clean up all managed resources."""
        # Cancel all background tasks
        for task in self.background_tasks:
            if not task.done():
                task.cancel()
        
        # Wait for tasks to complete
        if self.background_tasks:
            await asyncio.gather(*self.background_tasks, return_exceptions=True)
        
        # Run cleanup handlers
        for handler in self.cleanup_handlers:
            try:
                await handler()
            except Exception as e:
                logger.error(f"Error during cleanup: {e}")

# Global resource manager
resource_manager = ResourceManager()

@app.tool(tags={"resource", "management"})
async def resource_aware_operation(params: ResourceSchema, ctx: Context) -> dict[str, Any]:
    """Operation that properly manages resources."""
    
    try:
        # Use managed HTTP session
        async with resource_manager.http_session.get(params.url) as response:
            data = await response.json()
        
        # Create background task if needed
        if params.background_processing:
            task = await resource_manager.create_background_task(
                background_process(data)
            )
            await ctx.info(f"Background task started: {task}")
        
        return {"success": True, "data": data}
        
    except Exception as e:
        await ctx.error(f"Resource operation failed: {e}")
        return {"success": False, "error": str(e)}
```

### Background Task Handling

**Robust Background Task Management**:
```python
import asyncio
from typing import Dict, Set
from dataclasses import dataclass

@dataclass
class TaskInfo:
    """Information about a background task."""
    task: asyncio.Task
    started_at: float
    description: str
    context_id: str

class BackgroundTaskManager:
    """Manages background tasks with proper lifecycle handling."""
    
    def __init__(self):
        self.tasks: Dict[str, TaskInfo] = {}
        self.context_tasks: Dict[str, Set[str]] = {}
    
    async def start_task(self, task_id: str, coro, description: str, context_id: str = None):
        """Start a background task with tracking."""
        if task_id in self.tasks:
            await self.cancel_task(task_id)
        
        task = asyncio.create_task(coro)
        task_info = TaskInfo(
            task=task,
            started_at=asyncio.get_event_loop().time(),
            description=description,
            context_id=context_id
        )
        
        self.tasks[task_id] = task_info
        
        # Track by context if provided
        if context_id:
            if context_id not in self.context_tasks:
                self.context_tasks[context_id] = set()
            self.context_tasks[context_id].add(task_id)
        
        # Set up completion callback
        task.add_done_callback(lambda t: self._task_completed(task_id))
        
        return task
    
    async def cancel_task(self, task_id: str):
        """Cancel a specific task."""
        if task_id in self.tasks:
            task_info = self.tasks[task_id]
            if not task_info.task.done():
                task_info.task.cancel()
                try:
                    await task_info.task
                except asyncio.CancelledError:
                    pass
            del self.tasks[task_id]
    
    async def cancel_context_tasks(self, context_id: str):
        """Cancel all tasks associated with a context."""
        if context_id in self.context_tasks:
            task_ids = list(self.context_tasks[context_id])
            for task_id in task_ids:
                await self.cancel_task(task_id)
            del self.context_tasks[context_id]
    
    def _task_completed(self, task_id: str):
        """Handle task completion."""
        if task_id in self.tasks:
            task_info = self.tasks[task_id]
            
            # Remove from context tracking
            if task_info.context_id and task_info.context_id in self.context_tasks:
                self.context_tasks[task_info.context_id].discard(task_id)
                if not self.context_tasks[task_info.context_id]:
                    del self.context_tasks[task_info.context_id]
            
            del self.tasks[task_id]
    
    async def cleanup_all(self):
        """Cancel all background tasks."""
        task_ids = list(self.tasks.keys())
        for task_id in task_ids:
            await self.cancel_task(task_id)

# Global task manager
task_manager = BackgroundTaskManager()

@app.tool(tags={"background", "async"})
async def start_background_process(params: BackgroundSchema, ctx: Context) -> dict[str, Any]:
    """Start a background process with proper management."""
    
    task_id = f"bg_{params.process_type}_{asyncio.get_event_loop().time()}"
    context_id = f"ctx_{id(ctx)}"
    
    try:
        # Define background work
        async def background_work():
            await ctx.info(f"Background process {params.process_type} started")
            
            for i in range(params.steps):
                await asyncio.sleep(1)  # Simulate work
                await ctx.report_progress(i + 1, params.steps, f"Processing step {i + 1}")
            
            await ctx.info(f"Background process {params.process_type} completed")
            return {"completed": True, "steps": params.steps}
        
        # Start task
        task = await task_manager.start_task(
            task_id=task_id,
            coro=background_work(),
            description=f"Background {params.process_type} process",
            context_id=context_id
        )
        
        return {
            "success": True,
            "task_id": task_id,
            "message": f"Background process started: {params.process_type}"
        }
        
    except Exception as e:
        await ctx.error(f"Failed to start background process: {e}")
        return {"success": False, "error": str(e)}
```

## 🔌 Transport Reliability Analysis

### Production Transport Comparison

**Transport Selection Matrix**:

| Transport | Reliability | Latency | Scalability | Use Case |
|-----------|------------|---------|-------------|----------|
| **STDIO** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | Local tools, CLI integration |
| **HTTP** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Web services, REST APIs |
| **SSE** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | Real-time updates, streaming |

### STDIO Transport (Recommended for ZMCPTools)

**Advantages**:
- Highest reliability - direct process communication
- Lowest latency - no network overhead
- Automatic process lifecycle management
- Built-in error handling and recovery

**Configuration**:
```python
# STDIO transport (default for ZMCPTools)
app = FastMCP("ZMCPTools")

# Server runs automatically when called by Claude Code
if __name__ == "__main__":
    app.run()  # Uses STDIO transport by default
```

**Best Practices for STDIO**:
```python
import sys
import signal
import asyncio

def setup_signal_handlers():
    """Set up graceful shutdown on SIGINT/SIGTERM."""
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, shutting down gracefully...")
        asyncio.create_task(shutdown_server())
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

async def shutdown_server():
    """Gracefully shutdown the server."""
    # Cancel background tasks
    await task_manager.cleanup_all()
    
    # Close resources
    await resource_manager.cleanup_all()
    
    # Exit
    sys.exit(0)

# Apply signal handlers
setup_signal_handlers()
```

### HTTP Transport (For Web Deployment)

**Production HTTP Configuration**:
```python
from fastmcp import FastMCP
import uvicorn
import asyncio

app = FastMCP("ZMCPTools")

# Production HTTP server configuration
async def run_production_server():
    """Run HTTP server with production settings."""
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True,
        server_header=False,
        date_header=False,
        workers=1,  # Single worker for MCP
        loop="asyncio",
        lifespan="on"
    )
    
    server = uvicorn.Server(config)
    await server.serve()

# Health check endpoint
@app.tool(tags={"health", "monitoring"})
async def health_check(ctx: Context) -> dict[str, Any]:
    """Health check endpoint for load balancers."""
    
    checks = {
        "database": await check_database_health(),
        "redis": await check_redis_health(),
        "memory": await check_memory_usage(),
        "tasks": len(task_manager.tasks)
    }
    
    all_healthy = all(checks.values())
    
    return {
        "healthy": all_healthy,
        "timestamp": asyncio.get_event_loop().time(),
        "checks": checks
    }
```

### SSE Transport (For Real-time Updates)

**SSE Configuration with Resilience**:
```python
from fastmcp import FastMCP
import redis.asyncio as redis
import json

app = FastMCP("ZMCPTools")

class SSETransport:
    """SSE transport with Redis backend for reliability."""
    
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self.redis_client = None
        self.connection_pool = None
    
    async def initialize(self):
        """Initialize Redis connection pool."""
        self.connection_pool = redis.ConnectionPool.from_url(
            self.redis_url,
            max_connections=20,
            retry_on_timeout=True,
            socket_keepalive=True,
            socket_keepalive_options={}
        )
        
        self.redis_client = redis.Redis(connection_pool=self.connection_pool)
    
    async def handle_reconnection(self):
        """Handle Redis reconnection with exponential backoff."""
        retry_count = 0
        max_retries = 5
        base_delay = 1.0
        
        while retry_count < max_retries:
            try:
                await self.redis_client.ping()
                logger.info("Redis reconnection successful")
                return
            except Exception as e:
                retry_count += 1
                delay = base_delay * (2 ** retry_count)
                logger.warning(f"Redis reconnection failed: {e}. Retrying in {delay}s")
                await asyncio.sleep(delay)
        
        raise ConnectionError("Failed to reconnect to Redis after maximum retries")
    
    async def send_event(self, event_type: str, data: dict):
        """Send SSE event with reliability."""
        try:
            await self.redis_client.publish(
                "mcp_events",
                json.dumps({"type": event_type, "data": data})
            )
        except redis.ConnectionError:
            logger.warning("Redis connection lost, attempting reconnection")
            await self.handle_reconnection()
            await self.redis_client.publish(
                "mcp_events",
                json.dumps({"type": event_type, "data": data})
            )

# Initialize SSE transport
sse_transport = SSETransport("redis://localhost:6379")
```

## 🚀 Production Deployment Patterns

### Monitoring and Observability

**Comprehensive Monitoring Setup**:
```python
from prometheus_client import Counter, Histogram, Gauge, start_http_server
import time
import psutil
import structlog

# Metrics collection
REQUEST_COUNT = Counter('mcp_requests_total', 'Total MCP requests', ['method', 'status'])
REQUEST_DURATION = Histogram('mcp_request_duration_seconds', 'Request duration')
ACTIVE_CONNECTIONS = Gauge('mcp_active_connections', 'Active connections')
MEMORY_USAGE = Gauge('mcp_memory_usage_bytes', 'Memory usage')

# Structured logging
logger = structlog.get_logger()

class MonitoringMiddleware:
    """Middleware for monitoring and observability."""
    
    def __init__(self, app: FastMCP):
        self.app = app
        self.setup_metrics_server()
    
    def setup_metrics_server(self):
        """Start Prometheus metrics server."""
        start_http_server(8001)  # Metrics on separate port
        logger.info("Metrics server started on port 8001")
    
    async def __call__(self, request):
        """Process request with monitoring."""
        start_time = time.time()
        method = getattr(request, 'method', 'unknown')
        
        try:
            # Update active connections
            ACTIVE_CONNECTIONS.inc()
            
            # Process request
            response = await self.app(request)
            
            # Record success metrics
            REQUEST_COUNT.labels(method=method, status='success').inc()
            REQUEST_DURATION.observe(time.time() - start_time)
            
            return response
            
        except Exception as e:
            # Record error metrics
            REQUEST_COUNT.labels(method=method, status='error').inc()
            REQUEST_DURATION.observe(time.time() - start_time)
            
            logger.error("Request failed", error=str(e), method=method)
            raise
            
        finally:
            # Update active connections
            ACTIVE_CONNECTIONS.dec()
            
            # Update memory usage
            MEMORY_USAGE.set(psutil.Process().memory_info().rss)

# Apply monitoring middleware
app = FastMCP("ZMCPTools")
monitoring_app = MonitoringMiddleware(app)
```

### Health Checks and Dependency Management

**Advanced Health Check System**:
```python
from datetime import datetime, timedelta
from typing import Dict, Any
import aiohttp
import asyncio

class HealthChecker:
    """Comprehensive health checking system."""
    
    def __init__(self):
        self.last_check = {}
        self.check_interval = 30  # seconds
        self.timeout = 5  # seconds
    
    async def check_database_health(self) -> dict[str, Any]:
        """Check database connectivity and performance."""
        try:
            start_time = time.time()
            
            # Simple query to test connection
            async with get_db_connection() as conn:
                result = await conn.execute("SELECT 1")
                await result.fetchone()
            
            duration = time.time() - start_time
            
            return {
                "healthy": True,
                "duration": duration,
                "message": "Database connection successful"
            }
            
        except Exception as e:
            return {
                "healthy": False,
                "error": str(e),
                "message": "Database connection failed"
            }
    
    async def check_redis_health(self) -> dict[str, Any]:
        """Check Redis connectivity and performance."""
        try:
            start_time = time.time()
            
            # Test Redis connection
            await redis_client.ping()
            
            duration = time.time() - start_time
            
            return {
                "healthy": True,
                "duration": duration,
                "message": "Redis connection successful"
            }
            
        except Exception as e:
            return {
                "healthy": False,
                "error": str(e),
                "message": "Redis connection failed"
            }
    
    async def check_memory_usage(self) -> dict[str, Any]:
        """Check memory usage and availability."""
        try:
            process = psutil.Process()
            memory_info = process.memory_info()
            memory_percent = process.memory_percent()
            
            # Alert if memory usage is high
            memory_healthy = memory_percent < 80.0
            
            return {
                "healthy": memory_healthy,
                "rss": memory_info.rss,
                "vms": memory_info.vms,
                "percent": memory_percent,
                "message": f"Memory usage: {memory_percent:.1f}%"
            }
            
        except Exception as e:
            return {
                "healthy": False,
                "error": str(e),
                "message": "Memory check failed"
            }
    
    async def check_external_services(self) -> dict[str, Any]:
        """Check external service dependencies."""
        services = {
            "documentation_api": "https://docs.example.com/health",
            "vector_service": "http://localhost:8080/health"
        }
        
        results = {}
        
        for service_name, url in services.items():
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, timeout=self.timeout) as response:
                        if response.status == 200:
                            results[service_name] = {
                                "healthy": True,
                                "status": response.status,
                                "message": "Service available"
                            }
                        else:
                            results[service_name] = {
                                "healthy": False,
                                "status": response.status,
                                "message": f"Service returned {response.status}"
                            }
            except Exception as e:
                results[service_name] = {
                    "healthy": False,
                    "error": str(e),
                    "message": "Service unreachable"
                }
        
        return results
    
    async def comprehensive_health_check(self) -> dict[str, Any]:
        """Perform comprehensive health check."""
        checks = await asyncio.gather(
            self.check_database_health(),
            self.check_redis_health(),
            self.check_memory_usage(),
            self.check_external_services(),
            return_exceptions=True
        )
        
        database_health, redis_health, memory_health, external_services = checks
        
        overall_healthy = all([
            database_health.get("healthy", False),
            redis_health.get("healthy", False),
            memory_health.get("healthy", False),
            all(service.get("healthy", False) for service in external_services.values())
        ])
        
        return {
            "healthy": overall_healthy,
            "timestamp": datetime.utcnow().isoformat(),
            "checks": {
                "database": database_health,
                "redis": redis_health,
                "memory": memory_health,
                "external_services": external_services
            }
        }

# Global health checker
health_checker = HealthChecker()

@app.tool(tags={"health", "monitoring"})
async def liveness_check(ctx: Context) -> dict[str, Any]:
    """Liveness check - is the server running?"""
    return {
        "alive": True,
        "timestamp": datetime.utcnow().isoformat(),
        "uptime": time.time() - start_time
    }

@app.tool(tags={"health", "monitoring"})
async def readiness_check(ctx: Context) -> dict[str, Any]:
    """Readiness check - is the server ready to serve requests?"""
    return await health_checker.comprehensive_health_check()
```

### Graceful Shutdown Procedures

**Production Shutdown Handling**:
```python
import signal
import asyncio
import sys
from contextlib import asynccontextmanager

class GracefulShutdown:
    """Handles graceful shutdown of the MCP server."""
    
    def __init__(self, app: FastMCP, timeout: int = 30):
        self.app = app
        self.timeout = timeout
        self.shutdown_event = asyncio.Event()
        self.setup_signal_handlers()
    
    def setup_signal_handlers(self):
        """Set up signal handlers for graceful shutdown."""
        def signal_handler(signum, frame):
            logger.info(f"Received signal {signum}, initiating graceful shutdown...")
            asyncio.create_task(self.shutdown())
        
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
    
    async def shutdown(self):
        """Perform graceful shutdown sequence."""
        logger.info("Starting graceful shutdown sequence...")
        
        # Set shutdown event
        self.shutdown_event.set()
        
        # Phase 1: Stop accepting new requests
        logger.info("Phase 1: Stopping new request acceptance...")
        await self.stop_accepting_requests()
        
        # Phase 2: Complete ongoing requests
        logger.info("Phase 2: Completing ongoing requests...")
        await self.complete_ongoing_requests()
        
        # Phase 3: Cancel background tasks
        logger.info("Phase 3: Canceling background tasks...")
        await task_manager.cleanup_all()
        
        # Phase 4: Close connections and resources
        logger.info("Phase 4: Closing connections and resources...")
        await resource_manager.cleanup_all()
        
        # Phase 5: Final cleanup
        logger.info("Phase 5: Final cleanup...")
        await self.final_cleanup()
        
        logger.info("Graceful shutdown completed")
        sys.exit(0)
    
    async def stop_accepting_requests(self):
        """Stop accepting new requests."""
        # Implementation depends on transport type
        pass
    
    async def complete_ongoing_requests(self):
        """Wait for ongoing requests to complete."""
        # Wait for active connections to complete
        max_wait = self.timeout
        wait_interval = 1
        
        while ACTIVE_CONNECTIONS._value.get() > 0 and max_wait > 0:
            await asyncio.sleep(wait_interval)
            max_wait -= wait_interval
            logger.info(f"Waiting for {ACTIVE_CONNECTIONS._value.get()} active connections...")
        
        if ACTIVE_CONNECTIONS._value.get() > 0:
            logger.warning(f"Force closing {ACTIVE_CONNECTIONS._value.get()} remaining connections")
    
    async def final_cleanup(self):
        """Perform final cleanup operations."""
        # Close database connections
        await close_database_connections()
        
        # Close Redis connections
        await close_redis_connections()
        
        # Save state if needed
        await save_application_state()

# Initialize graceful shutdown
shutdown_handler = GracefulShutdown(app)

@asynccontextmanager
async def lifespan(app: FastMCP):
    """Application lifespan management."""
    
    # Startup
    logger.info("Starting MCP server...")
    await startup_resources()
    
    try:
        yield
    finally:
        # Shutdown
        if not shutdown_handler.shutdown_event.is_set():
            await shutdown_handler.shutdown()
```

## 💡 Stability Improvements

### Solutions for ClosedResourceError

**Connection Pool Management**:
```python
import asyncio
import aiohttp
from contextlib import asynccontextmanager
import weakref

class ConnectionPoolManager:
    """Manages connection pools to prevent resource leaks."""
    
    def __init__(self):
        self.pools = weakref.WeakValueDictionary()
        self.cleanup_interval = 300  # 5 minutes
        self.cleanup_task = None
    
    async def get_pool(self, name: str, **kwargs) -> aiohttp.ClientSession:
        """Get or create a connection pool."""
        if name not in self.pools:
            connector = aiohttp.TCPConnector(
                limit=kwargs.get('limit', 100),
                limit_per_host=kwargs.get('limit_per_host', 10),
                ttl_dns_cache=kwargs.get('ttl_dns_cache', 300),
                use_dns_cache=kwargs.get('use_dns_cache', True),
                keepalive_timeout=kwargs.get('keepalive_timeout', 30),
                enable_cleanup_closed=True
            )
            
            session = aiohttp.ClientSession(
                connector=connector,
                timeout=aiohttp.ClientTimeout(
                    total=kwargs.get('timeout', 30),
                    connect=kwargs.get('connect_timeout', 10)
                )
            )
            
            self.pools[name] = session
        
        return self.pools[name]
    
    async def cleanup_pools(self):
        """Clean up unused connection pools."""
        for name, pool in list(self.pools.items()):
            if pool.closed:
                del self.pools[name]
    
    async def start_cleanup_task(self):
        """Start background cleanup task."""
        if self.cleanup_task is None:
            self.cleanup_task = asyncio.create_task(self._cleanup_loop())
    
    async def _cleanup_loop(self):
        """Background cleanup loop."""
        while True:
            try:
                await asyncio.sleep(self.cleanup_interval)
                await self.cleanup_pools()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")
    
    async def close_all(self):
        """Close all connection pools."""
        if self.cleanup_task:
            self.cleanup_task.cancel()
            try:
                await self.cleanup_task
            except asyncio.CancelledError:
                pass
        
        for pool in list(self.pools.values()):
            if not pool.closed:
                await pool.close()
        
        self.pools.clear()

# Global connection pool manager
pool_manager = ConnectionPoolManager()
```

### Retry Logic and Circuit Breaker

**Resilient Operation Patterns**:
```python
import asyncio
import time
from enum import Enum
from typing import Callable, Any

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    """Circuit breaker for preventing cascading failures."""
    
    def __init__(self, failure_threshold: int = 5, timeout: float = 60.0):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.failure_count = 0
        self.last_failure_time = 0
        self.state = CircuitState.CLOSED
    
    async def call(self, func: Callable, *args, **kwargs) -> Any:
        """Call function with circuit breaker protection."""
        
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time > self.timeout:
                self.state = CircuitState.HALF_OPEN
                self.failure_count = 0
            else:
                raise Exception("Circuit breaker is OPEN")
        
        try:
            result = await func(*args, **kwargs)
            
            if self.state == CircuitState.HALF_OPEN:
                self.state = CircuitState.CLOSED
                self.failure_count = 0
            
            return result
            
        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = time.time()
            
            if self.failure_count >= self.failure_threshold:
                self.state = CircuitState.OPEN
            
            raise

class RetryHandler:
    """Handles retry logic with exponential backoff."""
    
    def __init__(self, max_retries: int = 3, base_delay: float = 1.0, max_delay: float = 60.0):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
    
    async def retry(self, func: Callable, *args, **kwargs) -> Any:
        """Retry function with exponential backoff."""
        
        for attempt in range(self.max_retries + 1):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                if attempt == self.max_retries:
                    raise
                
                delay = min(self.base_delay * (2 ** attempt), self.max_delay)
                await asyncio.sleep(delay)
                
                logger.warning(f"Retry attempt {attempt + 1} failed: {e}. Retrying in {delay}s")

# Global circuit breaker and retry handler
circuit_breaker = CircuitBreaker()
retry_handler = RetryHandler()

@app.tool(tags={"resilient", "database"})
async def resilient_database_operation(params: DatabaseSchema, ctx: Context) -> dict[str, Any]:
    """Database operation with circuit breaker and retry logic."""
    
    async def database_operation():
        """The actual database operation."""
        async with get_db_connection() as conn:
            result = await conn.execute(params.query, params.parameters)
            return await result.fetchall()
    
    try:
        # Use circuit breaker and retry logic
        result = await circuit_breaker.call(
            retry_handler.retry,
            database_operation
        )
        
        return {"success": True, "result": result}
        
    except Exception as e:
        await ctx.error(f"Database operation failed after all retries: {e}")
        return {"success": False, "error": str(e)}
```

### Memory Management and Resource Monitoring

**Advanced Memory Management**:
```python
import gc
import psutil
import asyncio
from typing import Dict, Any

class MemoryMonitor:
    """Monitors and manages memory usage."""
    
    def __init__(self, warning_threshold: float = 80.0, critical_threshold: float = 90.0):
        self.warning_threshold = warning_threshold
        self.critical_threshold = critical_threshold
        self.monitoring_task = None
        self.monitoring_interval = 30  # seconds
    
    async def start_monitoring(self):
        """Start memory monitoring task."""
        if self.monitoring_task is None:
            self.monitoring_task = asyncio.create_task(self._monitoring_loop())
    
    async def _monitoring_loop(self):
        """Background memory monitoring loop."""
        while True:
            try:
                await asyncio.sleep(self.monitoring_interval)
                await self.check_memory_usage()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in memory monitoring: {e}")
    
    async def check_memory_usage(self):
        """Check current memory usage and take action if needed."""
        process = psutil.Process()
        memory_percent = process.memory_percent()
        
        if memory_percent > self.critical_threshold:
            logger.critical(f"Critical memory usage: {memory_percent:.1f}%")
            await self.emergency_cleanup()
        elif memory_percent > self.warning_threshold:
            logger.warning(f"High memory usage: {memory_percent:.1f}%")
            await self.routine_cleanup()
    
    async def routine_cleanup(self):
        """Perform routine memory cleanup."""
        # Force garbage collection
        gc.collect()
        
        # Clean up connection pools
        await pool_manager.cleanup_pools()
        
        # Clean up finished tasks
        await task_manager.cleanup_finished_tasks()
    
    async def emergency_cleanup(self):
        """Perform emergency memory cleanup."""
        # Routine cleanup first
        await self.routine_cleanup()
        
        # Cancel non-essential background tasks
        await task_manager.cancel_non_essential_tasks()
        
        # Close idle connections
        await resource_manager.close_idle_connections()
        
        # Force more aggressive garbage collection
        for _ in range(3):
            gc.collect()
            await asyncio.sleep(0.1)
    
    def get_memory_stats(self) -> Dict[str, Any]:
        """Get current memory statistics."""
        process = psutil.Process()
        memory_info = process.memory_info()
        
        return {
            "rss": memory_info.rss,
            "vms": memory_info.vms,
            "percent": process.memory_percent(),
            "available": psutil.virtual_memory().available,
            "total": psutil.virtual_memory().total
        }

# Global memory monitor
memory_monitor = MemoryMonitor()

@app.tool(tags={"monitoring", "memory"})
async def memory_status(ctx: Context) -> dict[str, Any]:
    """Get current memory status and statistics."""
    
    stats = memory_monitor.get_memory_stats()
    
    return {
        "memory_stats": stats,
        "gc_stats": {
            "collections": gc.get_stats(),
            "garbage_count": len(gc.garbage)
        },
        "connection_pools": len(pool_manager.pools),
        "active_tasks": len(task_manager.tasks)
    }
```

This comprehensive update to the FastMCP documentation provides detailed guidance on:

1. **Latest 2024 server configuration patterns** with deprecated parameter warnings
2. **Enhanced error handling** with comprehensive exception management and retry logic
3. **Async context management** with proper lifespan handling and resource cleanup
4. **Transport reliability analysis** comparing STDIO, HTTP, and SSE for production use
5. **Production deployment patterns** with monitoring, health checks, and graceful shutdown
6. **Stability improvements** addressing ClosedResourceError and connection management issues

The documentation now provides actionable guidance for improving server stability and resolving orchestration crashes in the ZMCPTools project.

## Configuration Examples

### Minimal Tool Example
```python
@app.tool(tags={"test"})
async def simple_test(message: str) -> dict[str, str]:
    """Simple test tool without complex schemas."""
    return {"response": f"Received: {message}"}
```

### Complex Schema Tool
```python
from pydantic import BaseModel, Field

class ComplexParams(BaseModel):
    name: str = Field(description="The name parameter")
    count: int = Field(ge=1, le=100, description="Count between 1-100")
    optional_data: dict[str, Any] | None = None

@app.tool(tags={"complex", "validation"})
async def complex_tool(params: ComplexParams) -> dict[str, Any]:
    """Tool with complex parameter validation."""
    return {
        "processed": True,
        "name": params.name,
        "count": params.count,
        "has_data": params.optional_data is not None
    }
```

### Error Handling Pattern
```python
@app.tool(tags={"robust", "error-handling"})
async def robust_tool(params: SomeSchema, ctx: Context) -> dict[str, Any]:
    """Tool with proper error handling and logging."""
    try:
        await ctx.info(f"Processing request with {len(params.data)} items")
        
        # Tool logic here
        result = process_data(params.data)
        
        await ctx.info("Processing completed successfully")
        return {"success": True, "result": result}
        
    except Exception as e:
        await ctx.error(f"Tool execution failed: {str(e)}")
        return {"success": False, "error": {"code": "EXECUTION_FAILED", "message": str(e)}}
```