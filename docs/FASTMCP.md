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