#!/usr/bin/env node
/**
 * Debug MCP Registration Payload
 * Shows exactly what the LLM sees when MCP server attaches
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Create minimal MCP server
const server = new Server(
  { name: 'zmcp-debug', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// Register sample tool
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'example_tool',
      description: '🎯 WHEN TO USE: Sample tool showing what LLM sees. Use for: testing, debugging, verification.',
      inputSchema: {
        type: 'object',
        properties: {
          arg1: { type: 'string', description: 'Example argument' }
        },
        required: ['arg1']
      }
    }
  ]
}));

// Register sample resource
server.setRequestHandler('resources/list', async () => ({
  resources: [
    {
      uri: 'example://test',
      name: 'Example Resource',
      description: '📚 RESOURCE EXAMPLE: Shows URI template format. Use for: read-only access, data retrieval.',
      mimeType: 'application/json'
    }
  ]
}));

// Register sample prompt
server.setRequestHandler('prompts/list', async () => ({
  prompts: [
    {
      name: 'example_prompt',
      description: '💬 PROMPT EXAMPLE: Shows prompt template format.',
      arguments: [
        { name: 'task', description: 'Task description', required: true }
      ]
    }
  ]
}));

console.error('='.repeat(80));
console.error('MCP REGISTRATION PAYLOAD DEBUG');
console.error('='.repeat(80));
console.error('What the LLM receives during MCP server attach:\n');

console.error('📦 TOOLS (List):');
console.error('  - name: string');
console.error('  - description: string (THIS IS WHAT LLM READS!)');
console.error('  - inputSchema: JSONSchema');
console.error('  Token cost: ~120 tokens/tool\n');

console.error('📚 RESOURCES (List):');
console.error('  - uri: string (template with *)');
console.error('  - name: string');
console.error('  - description: string (THIS IS WHAT LLM READS!)');
console.error('  - mimeType: string');
console.error('  Token cost: ~30 tokens/resource\n');

console.error('💬 PROMPTS (List):');
console.error('  - name: string');
console.error('  - description: string (THIS IS WHAT LLM READS!)');
console.error('  - arguments: Array<{name, description, required}>');
console.error('  Token cost: ~50 tokens/prompt\n');

console.error('='.repeat(80));
console.error('ZMCP-TOOLS CURRENT REGISTRATION (approximate):');
console.error('='.repeat(80));
console.error('Tools: ~37 × 120 tokens = 4,440 tokens');
console.error('Resources: 20 × 30 tokens = 600 tokens');
console.error('Prompts: 0 × 50 tokens = 0 tokens');
console.error('TOTAL: ~5,040 tokens in registration payload');
console.error('='.repeat(80));

process.exit(0);
