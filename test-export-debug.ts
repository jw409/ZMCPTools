import { TreeSitterASTTool } from './src/tools/TreeSitterASTTool.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function test() {
  const tool = new TreeSitterASTTool();
  
  // Create test file
  const content = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export const API_URL = 'https://api.example.com';
`;
  
  writeFileSync('/tmp/test-exports.ts', content);
  
  const result = await tool.executeByToolName('ast_analyze', {
    file_path: '/tmp/test-exports.ts',
    operation: 'extract_exports'
  });
  
  console.log(JSON.stringify(result, null, 2));
}

test().catch(console.error);
