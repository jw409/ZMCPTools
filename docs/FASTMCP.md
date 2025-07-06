# FastMCP Integration Guide

This document outlines key information about FastMCP configuration and best practices for the ClaudeMcpTools project.

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
   main_mcp = FastMCP("ClaudeMcpTools")
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

**Note**: UVX transport is typically used when creating a **client** that connects to a UVX-packaged server, not when **running** the server itself. For ClaudeMcpTools:

- **Server Side**: Uses default stdio transport (handled by Claude Code launcher)
- **Client Side**: Can use UVX transport when connecting to ClaudeMcpTools from other applications

```python
# UVX-specific CLIENT configuration (for connecting TO ClaudeMcpTools)
client = Client(
    "uvx://claude-mcp-tools",
    args=["--debug"],  # Additional uvx arguments
    env={"MCPTOOLS_DEBUG": "1"},  # Environment variables
    keep_alive=True  # Maintain connection
)

# SERVER configuration (ClaudeMcpTools itself) - uses stdio by default
app = FastMCP("ClaudeMcpTools Orchestration Server")
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