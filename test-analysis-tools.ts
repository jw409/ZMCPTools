// Simple test to verify AnalysisMcpTools can be imported and instantiated
import { AnalysisMcpTools } from './src/tools/AnalysisMcpTools.js';
import { MemoryService } from './src/services/MemoryService.js';
import { ClaudeDatabase } from './src/database/index.js';

// Mock setup
const db = new ClaudeDatabase(':memory:');
const memoryService = new MemoryService(db);
const analysisTools = new AnalysisMcpTools(memoryService, '.');

// Test basic functionality
async function testAnalysisTools() {
  try {
    console.log('Testing AnalysisMcpTools...');
    
    // Test getting tools list
    const tools = analysisTools.getTools();
    console.log(`✓ Found ${tools.length} analysis tools`);
    
    // Test tool names
    const expectedTools = [
      'analyze_project_structure',
      'generate_project_summary', 
      'analyze_file_symbols',
      'list_files',
      'find_files',
      'easy_replace',
      'cleanup_orphaned_projects'
    ];
    
    const toolNames = tools.map(t => t.name);
    const missingTools = expectedTools.filter(name => !toolNames.includes(name));
    
    if (missingTools.length === 0) {
      console.log('✓ All expected tools are present');
    } else {
      console.log(`✗ Missing tools: ${missingTools.join(', ')}`);
    }
    
    // Test a simple tool call
    const listResult = await analysisTools.handleToolCall('list_files', { directory: '.' });
    if (listResult.success) {
      console.log('✓ list_files tool works correctly');
    } else {
      console.log('✗ list_files tool failed:', listResult.error);
    }
    
    console.log('Analysis tools test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testAnalysisTools();