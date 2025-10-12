import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/cli/index.js', 'server']
});

const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

console.log('Indexing symbol graph...\n');

// Index the codebase
await client.callTool({
  name: 'index_symbol_graph',
  arguments: {
    repository_path: '/home/jw/dev/game1/ZMCPTools'
  }
});

console.log('\nSearching for EmbeddingClient usage...\n');

// Search for files that import EmbeddingClient
const imports = await client.callTool({
  name: 'get_symbols_search',
  arguments: {
    repository_path: '/home/jw/dev/game1/ZMCPTools',
    name: 'EmbeddingClient'
  }
});

console.log(JSON.parse(imports.content[0].text));

await client.close();
