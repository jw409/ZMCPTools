/**
 * Example usage of the DOM-to-JSON utility
 * Demonstrates how to use the comprehensive DOM serialization features
 */

import { 
  serializeDOMWithPlaywright,
  sanitizeHTMLContent,
  convertHTMLToMarkdown,
  optimizeStylesForAI,
  AI_OPTIMIZED_OPTIONS,
  COMPREHENSIVE_OPTIONS,
  type DOMJsonNode,
  type SerializationOptions 
} from '../src/utils/domToJson.js';
import { chromium } from 'patchright';

async function demonstrateDOMSerialization() {
  console.log('🚀 DOM-to-JSON Utility Demonstration\n');

  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to a test page (using a simple HTML string)
    const testHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Page</title>
        <style>
          .container { padding: 20px; background: #f0f0f0; }
          .button { background: blue; color: white; padding: 10px; cursor: pointer; }
          .hidden { display: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1 id="main-title">Welcome to ZMCPTools</h1>
          <p>This is a demonstration of DOM-to-JSON serialization.</p>
          
          <nav>
            <ul>
              <li><a href="/docs" data-test="docs-link">Documentation</a></li>
              <li><a href="/api">API Reference</a></li>
            </ul>
          </nav>
          
          <section class="interactive-section">
            <button id="primary-btn" class="button" onclick="alert('Hello')">Click Me</button>
            <input type="text" placeholder="Enter your name" />
            <select name="category">
              <option value="dev">Development</option>
              <option value="prod">Production</option>
            </select>
          </section>
          
          <div class="hidden">This content is hidden</div>
          
          <footer>
            <p>&copy; 2024 ZMCPTools</p>
          </footer>
        </div>
        
        <script>
          console.log("This script should be removed in sanitized HTML");
        </script>
      </body>
      </html>
    `;

    await page.setContent(testHTML);

    console.log('1. 🎯 AI-Optimized Serialization');
    console.log('   (Focuses on interactive elements and structure)\n');

    // AI-optimized serialization
    const aiOptimizedResult = await serializeDOMWithPlaywright(
      page, 
      'body', 
      AI_OPTIMIZED_OPTIONS
    );

    console.log('📊 AI-Optimized Result:');
    console.log(JSON.stringify(aiOptimizedResult, null, 2));
    console.log('\n' + '='.repeat(60) + '\n');

    console.log('2. 🔍 Comprehensive Serialization');
    console.log('   (Includes all elements and detailed information)\n');

    // Comprehensive serialization
    const comprehensiveResult = await serializeDOMWithPlaywright(
      page, 
      'body', 
      COMPREHENSIVE_OPTIONS
    );

    console.log('📊 Comprehensive Result:');
    console.log(JSON.stringify(comprehensiveResult, null, 2));
    console.log('\n' + '='.repeat(60) + '\n');

    console.log('3. 🎛️ Custom Options Example');
    console.log('   (Interactive elements only, with selector paths)\n');

    // Custom serialization - interactive elements only
    const customOptions: SerializationOptions = {
      includeInteractivity: true,
      includeSelectorPaths: true,
      includeBoundingBox: false,
      optimizeForAI: true,
      maxDepth: 10,
      styleFilter: { include: ['cursor', 'display', 'visibility'] }
    };

    const customResult = await serializeDOMWithPlaywright(
      page, 
      '.interactive-section', 
      customOptions
    );

    console.log('📊 Custom Result (Interactive Section):');
    console.log(JSON.stringify(customResult, null, 2));
    console.log('\n' + '='.repeat(60) + '\n');

    console.log('4. 🧹 HTML Sanitization Demo\n');

    // Get the page HTML and sanitize it
    const pageHTML = await page.content();
    
    console.log('📄 Original HTML (first 300 chars):');
    console.log(pageHTML.substring(0, 300) + '...\n');

    const sanitizedHTML = sanitizeHTMLContent(pageHTML, {
      removeScripts: true,
      removeStyles: true,
      removeEventHandlers: true,
      removeComments: true
    });

    console.log('🧹 Sanitized HTML (first 300 chars):');
    console.log(sanitizedHTML.substring(0, 300) + '...\n');

    console.log('5. 📝 Markdown Conversion Demo\n');

    // Convert to markdown
    const markdownContent = convertHTMLToMarkdown(sanitizedHTML);
    
    console.log('📝 Markdown Content:');
    console.log(markdownContent);
    console.log('\n' + '='.repeat(60) + '\n');

    console.log('6. ⚡ Style Optimization Demo\n');

    // Demonstrate style optimization
    const rawStyles = {
      'display': 'block',
      'position': 'relative',
      'color': '#333333',
      'background-color': '#ffffff',
      'font-family': 'Arial, sans-serif',
      'font-size': '16px',
      'line-height': '1.5',
      'margin': '10px',
      'padding': '20px',
      'border': '1px solid #ccc',
      'border-radius': '4px',
      'cursor': 'pointer',
      'user-select': 'none',
      'text-decoration': 'none',
      'overflow': 'hidden',
      'z-index': '100'
    };

    const optimizedStyles = optimizeStylesForAI(rawStyles);

    console.log('🎨 Original Styles:');
    console.log(JSON.stringify(rawStyles, null, 2));
    console.log('\n🚀 AI-Optimized Styles:');
    console.log(JSON.stringify(optimizedStyles, null, 2));

  } catch (error) {
    console.error('❌ Error during demonstration:', error);
  } finally {
    await browser.close();
  }

  console.log('\n✅ DOM-to-JSON Utility Demonstration Complete!');
  console.log('\n📚 Key Features Demonstrated:');
  console.log('   • AI-optimized DOM serialization');
  console.log('   • Comprehensive DOM analysis');
  console.log('   • Interactive element detection');
  console.log('   • Bounding box extraction');
  console.log('   • CSS style filtering');
  console.log('   • HTML sanitization');
  console.log('   • Markdown conversion');
  console.log('   • Playwright integration');
}

// Integration example for BrowserTools
export function integrateWithBrowserTools() {
  console.log(`
🔧 Integration with BrowserTools.ts:

To use this utility in BrowserTools, add to the scraping method:

\`\`\`typescript
// In BrowserTools scrapeContentCore method
if (options.extract_dom_json) {
  const domJson = await serializeDOMWithPlaywright(
    session.page,
    options.selector || 'html',
    AI_OPTIMIZED_OPTIONS
  );
  content.dom_json = domJson;
}
\`\`\`

Database Schema Integration:
The domJsonContent field in the database can store the serialized DOM:

\`\`\`typescript
await websitePagesRepository.create({
  // ... other fields
  domJsonContent: domJson // Matches database schema
});
\`\`\`
  `);
}

// Run the demonstration if this file is executed directly
if (require.main === module) {
  demonstrateDOMSerialization()
    .then(() => {
      integrateWithBrowserTools();
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to run demonstration:', error);
      process.exit(1);
    });
}

export { demonstrateDOMSerialization, integrateWithBrowserTools };