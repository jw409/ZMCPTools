#!/usr/bin/env node

import { FileOperationsService } from './src/services/FileOperationsService.js';

async function testFileOperations() {
  console.log('Testing FileOperationsService...');
  
  const fileOps = new FileOperationsService();
  
  try {
    // Test listing files in current directory
    console.log('Testing listFiles...');
    const files = await fileOps.listFiles('.', {
      recursive: false,
      includeHidden: false
    });
    
    console.log(`Found ${files.length} files/directories`);
    files.slice(0, 5).forEach(file => {
      console.log(`  ${file.type}: ${file.name} (${file.size} bytes)`);
    });
    
    // Test finding TypeScript files
    console.log('\nTesting findFiles...');
    const tsFiles = await fileOps.findFiles('*.ts', {
      directory: './src'
    });
    
    console.log(`Found ${tsFiles.length} TypeScript files`);
    tsFiles.slice(0, 5).forEach(file => {
      console.log(`  ${file}`);
    });
    
    console.log('\n✅ FileOperationsService working correctly!');
    
  } catch (error) {
    console.error('❌ Error testing FileOperationsService:', error);
  }
}

testFileOperations().catch(console.error);