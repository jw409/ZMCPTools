#!/usr/bin/env tsx
import { spawn } from 'child_process';
import minimist from 'minimist';

const args = minimist(process.argv.slice(2));

const method = args.method || 'tools/list';
const params = args.params ? JSON.parse(args.params) : {};
const timeout = args.timeout || 5000;

if (args.help) {
    console.log(`
Usage: tsx scripts/run-mcp-command.ts [options]

Options:
  --method <name>    The JSON-RPC method to call (default: "tools/list").
  --params '{"a":1}'  A JSON string with the parameters for the method (default: {}).
  --timeout <ms>     The timeout in milliseconds to wait for a response (default: 5000).
  --help             Show this help message.

Example:
  tsx scripts/run-mcp-command.ts --method tools/list
  tsx scripts/run-mcp-command.ts --method tools/call --params '{"name":"store_knowledge_memory","arguments":{"repository_path":".","agent_id":"test-agent","partition":"project","entity_type":"concept","entity_name":"test"}}'
    `);
    process.exit(0);
}

console.log(`[DEBUG] Starting ZMCP server command runner...`);
console.log(`[DEBUG] Method: ${method}, Params: ${JSON.stringify(params)}, Timeout: ${timeout}ms`);

const child = spawn('/home/jw/.npm-global/bin/tsx', ['/home/jw/dev/game1/ZMCPTools/src/index.ts']);

child.stdout.on('data', (data) => {
  console.log(`[STDOUT] ${data}`);
});

child.stderr.on('data', (data) => {
  console.error(`[STDERR] ${data}`);
});

child.on('exit', (code, signal) => {
  console.log(`[DEBUG] Process exited with code ${code}, signal ${signal}`);
});

child.on('error', (error) => {
  console.error('[ERROR]', error);
});

console.log('[DEBUG] Spawn called, PID:', child.pid);

// After a short delay to allow the server to start, send the request
setTimeout(() => {
    const request = {
        jsonrpc: '2.0',
        method: method,
        params: params,
        id: '1'
    };
    console.log(`[DEBUG] Sending request: ${JSON.stringify(request)}`);
    child.stdin.write(JSON.stringify(request) + '\n');
}, 2000);

// Terminate after the specified timeout
setTimeout(() => {
    console.log(`[DEBUG] Timeout reached. Terminating process...`);
    child.kill('SIGTERM');
}, timeout);
