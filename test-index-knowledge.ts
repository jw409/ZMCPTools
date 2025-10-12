#!/usr/bin/env node
/**
 * Test script for IndexKnowledgeTool with code symbol extraction
 */

import { indexKnowledgeTool } from './src/tools/IndexKnowledgeTool.js';
import * as path from 'path';

async function test() {
  console.log('🧪 Testing IndexKnowledgeTool with code symbol extraction...\n');

  const repositoryPath = path.resolve('/home/jw/dev/game1/ZMCPTools');

  try {
    const result = await indexKnowledgeTool.handler({
      repository_path: repositoryPath,
      sources: {
        github_issues: false,  // Skip GitHub issues for faster testing
        markdown_docs: false,  // Skip markdown for faster testing
        code_symbols: true     // Test ONLY code symbols
      },
      skip_embeddings: true,   // Skip embeddings for faster testing
      output_path: path.join(repositoryPath, 'var/storage/test_indexed_knowledge.json')
    });

    console.log('\n✅ Test completed successfully!\n');
    console.log(result.content[0].text);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

test();
