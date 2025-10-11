/**
 * ZMCPTools Test Harness
 *
 * This script provides a stable, self-contained way to test the ZMCPTools server.
 * It starts the server, connects a client via stdio, executes a simple command,
 * and then shuts down. This allows for testing server health and basic
 * functionality without requiring a full agent environment and avoids issues
 * with server restarts causing context loss.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('🚀 Starting ZMCPTools Test Harness...');

  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;

  try {
    // 1. Define the server entry point
    // We use `tsx` to run the TypeScript source directly.
    const serverPath = join(__dirname, '../src/index.ts');
    console.log(`Server path: ${serverPath}`);

    // 2. Instantiate the StdioClientTransport
    // This will spawn the server process and manage communication over stdio.
    transport = new StdioClientTransport({
      command: 'tsx',
      args: [serverPath],
    });

    // 3. Instantiate the MCP Client
    client = new Client(
      {
        name: 'test-harness-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // 4. Connect the client to the transport
    console.log('🔌 Connecting to server via stdio...');
    await client.connect(transport);
    console.log('✅ Connected successfully!\n');

    // 5. Execute a simple, read-only command to verify the connection
    console.log('Listing available tools...');
    const response = await client.listTools();

    // 6. Log the result
    console.log('\n🛠️ Available Tools:');
    if (response.tools.length > 0) {
      response.tools.forEach(tool => {
        console.log(`- ${tool.name}`);
      });
    } else {
      console.log('No tools found.');
    }
    console.log(`\nTotal tools found: ${response.tools.length}`);

    console.log('\n✅ Test harness completed successfully!');

  } catch (error) {
    console.error('❌ Test harness failed:', error);
    process.exit(1);
  } finally {
    // 7. Shutdown
    if (client) {
      console.log('\n🛑 Shutting down client and server...');
      await client.close();
      console.log('✅ Shutdown complete.');
    }
  }
}

main();
