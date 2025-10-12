# ZMCPTools Debugging Guide

This document provides guidance on debugging the ZMCPTools server and its components.

## `run-mcp-command.ts` Script

For direct interaction with the ZMCP server, you can use the `run-mcp-command.ts` script. This script allows you to send JSON-RPC commands to the server over `stdio` and inspect the output. This is particularly useful for testing individual tools or debugging the server's request handling logic.

### Usage

```bash
tsx scripts/run-mcp-command.ts [options]
```

### Options

-   `--method <name>`: The JSON-RPC method to call (default: `"tools/list"`).
-   `--params '{"a":1}'`: A JSON string with the parameters for the method (default: `{}`).
-   `--timeout <ms>`: The timeout in milliseconds to wait for a response (default: 5000).
-   `--help`: Show the help message.

### Examples

**List all available tools:**

```bash
tsx scripts/run-mcp-command.ts --method tools/list
```

**Call a specific tool (`store_knowledge_memory`):**

```bash
tsx scripts/run-mcp-command.ts --method tools/call --params '{"name":"store_knowledge_memory","arguments":{"repository_path":".","agent_id":"test-agent","partition":"project","entity_type":"concept","entity_name":"test"}}'
```
