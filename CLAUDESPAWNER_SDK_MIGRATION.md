# ClaudeSpawner SDK Migration

## Overview
Successfully replaced the CLI-based ClaudeSpawner implementation with a new SDK-based version using `@anthropic-ai/claude-code`.

## Key Changes

### 1. Replaced CLI Spawning with SDK Query
- **Before**: Used `spawn()` to execute `claude` CLI commands
- **After**: Uses `query()` function from `@anthropic-ai/claude-code` SDK
- **Benefit**: Direct SDK integration, better error handling, no subprocess overhead

### 2. AbortController Support
- **Added**: Native AbortController support for proper cancellation
- **Replaces**: SIGTERM/SIGKILL signal handling
- **Benefit**: Cleaner cancellation, SDK-native abort support

### 3. Session Management
- **Enhanced**: Better session resume capabilities using `sessionId`
- **Feature**: SDK-native session handling via `resume` option
- **Benefit**: Persistent context across agent interactions

### 4. System Prompt Injection
- **Added**: Automatic injection of CLAUDE.md content into system prompt
- **Method**: Uses `appendSystemPrompt` option to inject project context
- **Benefit**: Agents have immediate access to ClaudeMcpTools capabilities

### 5. Model Validation
- **Added**: Validation for supported models:
  - `claude-3-7-sonnet-latest`
  - `claude-sonnet-4-0` (default)
  - `claude-opus-4-0`
- **Behavior**: Auto-fallback to `claude-sonnet-4-0` for unsupported models

### 6. JSON Streaming
- **Enhanced**: Better handling of SDK's stream-json output format
- **Features**: Message type detection, structured event emission
- **Types**: `assistant`, `user`, `system`, `result` message types

### 7. Error Handling
- **Improved**: SDK-specific error handling vs CLI error handling
- **Features**: Graceful degradation, detailed error logging
- **Benefit**: Better debugging and failure recovery

## Architecture Changes

### ClaudeProcess Class
```typescript
// Before: ChildProcess wrapper
constructor(childProcess: ChildProcess, config: ClaudeSpawnConfig)

// After: SDK execution wrapper  
constructor(config: ClaudeSpawnConfig)
async start(): Promise<void>
```

### Key Methods
- `executeQuery()`: Core SDK execution logic
- `buildSystemPrompt()`: CLAUDE.md injection
- `handleSDKMessage()`: Process streaming SDK messages
- `terminate()`: AbortController-based cancellation

### Maintained Interface
- **Public API**: Unchanged - same methods and events
- **Compatibility**: Existing agent spawning code works without changes
- **Events**: Same event structure (`stdout`, `stderr`, `exit`, `error`)

## Benefits

### Performance
- **No subprocess overhead**: Direct SDK calls vs CLI spawning
- **Better memory usage**: Single process vs multiple child processes
- **Faster startup**: No CLI initialization delay

### Reliability
- **SDK error handling**: Native error types vs process exit codes
- **Session persistence**: Resume interrupted conversations
- **Cancellation support**: Clean abort vs process killing

### Developer Experience
- **Better debugging**: Structured message types
- **Type safety**: Full TypeScript types from SDK
- **Context injection**: Automatic CLAUDE.md system prompt

### Integration
- **MCP tools**: Direct access without CLI wrapper
- **Shared context**: Session-based agent coordination
- **Tool restrictions**: Native SDK tool filtering

## Files Modified
- `/src/process/ClaudeSpawner.ts` - Complete rewrite using SDK
- Added SDK dependency validation and model checking

## Testing
- `test-spawner.ts` - Verification script for SDK functionality
- Validates: Agent spawning, message handling, graceful shutdown

## Migration Notes
- **Zero breaking changes**: Same public interface maintained
- **Performance improvement**: Reduced latency and memory usage
- **Enhanced capabilities**: Session management and context injection
- **Better error handling**: SDK-native error types and recovery