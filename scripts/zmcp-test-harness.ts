/**
 * ZMCPTools Generic Test Harness
 *
 * This script provides a stable, self-contained way to test the ZMCPTools server.
 * It accepts a command via CLI arguments, starts the server, connects a client,
 * executes the command, prints the raw JSON result, and then shuts down.
 * This allows for single-turn testing of any MCP functionality.
 *
 * Usage:
 *   tsx scripts/zmcp-test-harness.ts listTools
 *   tsx scripts/zmcp-test-harness.ts readResource <URI>
 *   tsx scripts/zmcp-test-harness.ts callTool <TOOL_NAME> [JSON_ARGS]
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error('❌ Error: No command provided.');
    console.error('Usage: tsx scripts/zmcp-test-harness.ts <listTools|readResource|callTool> [args...]');
    process.exit(1);
  }

  console.log(`🚀 Starting ZMCPTools Test Harness for command: ${command}...`);

  let client: Client | undefined;

  try {
    const serverPath = join(__dirname, '../src/index.ts');
    const transport = new StdioClientTransport({
      command: 'tsx',
      args: [serverPath],
    });

    client = new Client({ name: 'generic-harness-client', version: '1.0.1' }, { capabilities: {} });

    await client.connect(transport);

    let result: any;

    switch (command) {
      case 'getToolInventory':
      case 'listTools':
        result = await client.listTools();
        break;

      case 'readResource':
        const uri = args[1];
        if (!uri) {
          throw new Error('Missing URI for readResource command');
        }
        result = await client.readResource({ uri });
        break;

      case 'callTool':
        const toolName = args[1];
        const toolArgs = args[2] ? JSON.parse(args[2]) : {};
        if (!toolName) {
          throw new Error('Missing tool name for callTool command');
        }
        result = await client.callTool({ name: toolName, arguments: toolArgs });
        break;

      default:
        throw new Error(`Unknown command: ${command}`);
    }

    // Output the raw, unchanged JSON result for evaluation
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error(`❌ Test harness failed for command "${command}":`, error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

main();