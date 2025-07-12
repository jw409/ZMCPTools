/**
 * Browser Auto-Indexing Example
 * 
 * This example demonstrates the new automatic website indexing feature
 * in BrowserTools. When you navigate to any URL with auto_index_website: true,
 * the page will be automatically indexed in the website database with:
 * 
 * - HTML content
 * - Sanitized HTML (scripts/styles removed)
 * - Markdown conversion
 * - DOM structure as navigable JSON
 * - Screenshots stored as base64
 * - Content hashing for change detection
 */

import { BrowserTools } from '../src/tools/BrowserTools.js';
import { DatabaseManager } from '../src/database/index.js';
import { KnowledgeGraphService } from '../src/services/KnowledgeGraphService.js';

async function demonstrateAutoIndexing() {
  console.log('🚀 Browser Auto-Indexing Example');
  console.log('==================================\n');

  // Initialize services (you would normally get these from your app)
  const db = new DatabaseManager({ path: './examples/test.db' });
  const knowledgeGraph = new KnowledgeGraphService(db);
  
  // Initialize BrowserTools with auto-indexing capabilities
  const browserTools = new BrowserTools(knowledgeGraph, process.cwd(), db);

  try {
    console.log('1. Navigating to example.com with auto-indexing enabled...');
    
    // This will automatically:
    // - Create a website entry for "example.com"
    // - Extract HTML, sanitized HTML, markdown, DOM JSON, and screenshot
    // - Store everything in the database with content hashing
    const result = await browserTools.getTools()
      .find(tool => tool.name === 'navigate_and_scrape')
      ?.handler({
        url: 'https://example.com',
        auto_index_website: true,        // Enable auto-indexing
        extract_html: true,              // Store raw HTML
        extract_sanitized_html: true,    // Store sanitized HTML
        extract_markdown: true,          // Convert to markdown
        extract_dom_json: true,          // Extract DOM structure as JSON
        capture_screenshot: true,        // Take screenshot
        screenshot_full_page: true,      // Full page screenshot
        auto_create_session: true        // Auto-create browser session
      });

    if (result?.success) {
      console.log('✅ Navigation and indexing successful!');
      console.log(`   Website ID: ${result.data?.website_id}`);
      console.log(`   Page ID: ${result.data?.page_id}`);
      console.log(`   Website Indexed: ${result.data?.website_indexed}`);
      
      if (result.data?.content) {
        const content = result.data.content;
        console.log('\n📄 Extracted Content:');
        console.log(`   - HTML: ${content.html ? 'Yes' : 'No'} (${content.html?.length || 0} chars)`);
        console.log(`   - Sanitized HTML: ${content.sanitized_html ? 'Yes' : 'No'} (${content.sanitized_html?.length || 0} chars)`);
        console.log(`   - Markdown: ${content.markdown ? 'Yes' : 'No'} (${content.markdown?.length || 0} chars)`);
        console.log(`   - DOM JSON: ${content.dom_json ? 'Yes' : 'No'}`);
        console.log(`   - Screenshot: ${content.screenshot_base64 ? 'Yes' : 'No'} (${content.screenshot_base64?.length || 0} chars)`);
        
        if (content.dom_json) {
          console.log(`   - DOM Elements: ${countDOMElements(content.dom_json)}`);
        }
      }
    } else {
      console.error('❌ Navigation failed:', result?.error);
    }

    console.log('\n2. Navigating to the same URL again (should detect no changes)...');
    
    // Second navigation to same URL should detect content hasn't changed
    const result2 = await browserTools.getTools()
      .find(tool => tool.name === 'navigate_and_scrape')
      ?.handler({
        url: 'https://example.com',
        auto_index_website: true,
        extract_html: true,
        auto_create_session: true
      });

    if (result2?.success) {
      console.log('✅ Second navigation completed');
      console.log(`   Website Indexed: ${result2.data?.website_indexed}`);
      console.log('   (Content hashing should detect this is the same page)');
    }

  } catch (error) {
    console.error('❌ Error during auto-indexing demo:', error);
  } finally {
    // Cleanup
    await browserTools.shutdown();
    console.log('\n🧹 Browser sessions cleaned up');
  }
}

function countDOMElements(domJson: any): number {
  if (!domJson) return 0;
  
  let count = 1; // Count this element
  
  if (domJson.children && Array.isArray(domJson.children)) {
    for (const child of domJson.children) {
      count += countDOMElements(child);
    }
  }
  
  return count;
}

// Example usage scenarios
console.log(`
🎯 Key Features of Auto-Indexing:

1. **Automatic Website Discovery**: 
   - Extracts domain from URL
   - Creates website entry if doesn't exist

2. **Comprehensive Content Extraction**:
   - Raw HTML for full content
   - Sanitized HTML (scripts/styles removed) 
   - Markdown conversion for AI analysis
   - DOM JSON for AI navigation
   - Screenshots for visual analysis

3. **Change Detection**:
   - Content hashing prevents duplicate storage
   - Only updates when content actually changes

4. **Graceful Error Handling**:
   - Indexing failures don't break navigation
   - Partial content extraction on errors

5. **Integration Points**:
   - Works with all browser navigation operations
   - Default enabled (auto_index_website: true)
   - Respects existing extraction parameters

Usage Examples:

// Basic auto-indexing (default behavior)
navigate_and_scrape({
  url: "https://docs.example.com",
  auto_index_website: true  // Default: true
})

// Full content extraction with indexing
navigate_and_scrape({
  url: "https://docs.example.com", 
  extract_html: true,
  extract_sanitized_html: true,
  extract_markdown: true,
  extract_dom_json: true,
  capture_screenshot: true,
  auto_index_website: true
})

// Disable auto-indexing if not wanted
navigate_and_scrape({
  url: "https://temporary-page.com",
  auto_index_website: false
})
`);

// Run the demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateAutoIndexing().catch(console.error);
}

export { demonstrateAutoIndexing };