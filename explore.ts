import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';

async function main() {
  const transport = new StreamableHTTPClientTransport('http://localhost:4269');
  const client = new Client({
    name: 'Explorer',
    version: '1.0.0',
  });

  try {
    await client.connect(transport);
    const resources = await client.listResources();
    console.log(JSON.stringify(resources, null, 2));
  } catch (error) {
    console.error('Failed to explore resources:', error);
  } finally {
    await client.close();
  }
}

main();