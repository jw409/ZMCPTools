# MCP Registration Payload - What the LLM Sees

## At Server Attach

When Claude Code connects to zmcp-tools MCP server, it receives:

### 1. Server Capabilities (initialize response)
```json
{
  "capabilities": {
    "tools": {},
    "resources": {},
    "prompts": {},
    "sampling": {},
    "notifications": { "progress": true }
  }
}
```

### 2. Tool List (tools/list request)
```json
{
  "tools": [
    {
      "name": "create_browser_session",
      "description": "Create a new browser session with intelligent auto-close...",
      "inputSchema": { /* JSONSchema */ }
    },
    // ... 36 more tools
  ]
}
```

**What LLM reads**: `description` field for each tool
**Token cost**: ~120 tokens per tool (name + description + schema)

### 3. Resource List (resources/list request)
```json
{
  "resources": [
    {
      "uri": "file://*/symbols",
      "name": "File Symbols",
      "description": "Extract symbols (functions, classes...) from source file",
      "mimeType": "application/json"
    },
    // ... 19 more resources
  ]
}
```

**What LLM reads**: `description` field for each resource
**Token cost**: ~30 tokens per resource (uri + name + description + mime)

### 4. Prompt List (prompts/list request)
```json
{
  "prompts": []  // EMPTY - all removed (Claude Code incompatible)
}
```

**Token cost**: 0 (list is empty)

## ZMCP-Tools Current Registration

```
Tools: ~37 tools × 120 tokens = 4,440 tokens
Resources: 20 resources × 30 tokens = 600 tokens
Prompts: 0 prompts × 50 tokens = 0 tokens
────────────────────────────────────────
TOTAL: ~5,040 tokens in registration payload
```

## Description Quality Checklist

For LLM to use tools/resources effectively, descriptions must include:

✅ **When to use** (emoji-prefixed use case)
✅ **What it does** (1-2 sentence summary)
✅ **Key parameters** (query params for resources, args for tools)
✅ **Examples** (concrete usage patterns)

### Good Example (Resource)
```
🔍 SEARCH BEFORE IMPLEMENTING: Search GitHub issues, architecture docs, 
implementation patterns, and prior solutions. GPU-accelerated semantic + 
BM25 hybrid search. Example: knowledge://search?query=auth&limit=5
```

### Bad Example (Old Tool)
```
Analyze project structure and generate a comprehensive overview
```
(Missing: when to use, why, examples)

## Optimization Impact

### Before Deprecation
- 13 analysis tools × 120 tokens = 1,560 tokens
- Total: ~6,600 tokens

### After Deprecation
- 0 analysis tools × 120 tokens = 0 tokens
- Total: ~5,040 tokens
- **Savings**: 1,560 tokens (24% reduction)

## Next Investigation

1. Review all 37 remaining tool descriptions for quality
2. Review all 20 resource descriptions for clarity
3. Verify no deprecated tools still registered
4. Check for "two birds one stone" consolidation opportunities
