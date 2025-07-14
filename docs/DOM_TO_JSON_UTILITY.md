# DOM-to-JSON Utility Documentation

The DOM-to-JSON utility (`/src/utils/domToJson.ts`) provides comprehensive DOM element serialization for AI navigation and analysis within the ZMCPTools project.

## 🎯 Overview

This utility converts DOM elements into a navigable JSON structure that includes:
- **Computed CSS styles** inline with each element
- **Bounding box information** for positioning
- **Interactive element detection** (clickable, input, etc.)
- **HTML sanitization** and markdown conversion
- **AI-optimized filtering** for relevance
- **Playwright integration** for browser automation

## 📦 Core Features

### 1. DOM Serialization
```typescript
import { serializeDOMToJson, AI_OPTIMIZED_OPTIONS } from '../src/utils/domToJson.js';

// Browser context usage (Playwright page.evaluate)
const domJson = await page.evaluate(() => {
  return serializeDOMToJson('main', {
    includeInteractivity: true,
    includeBoundingBox: true,
    optimizeForAI: true
  });
});
```

### 2. Playwright Integration
```typescript
import { serializeDOMWithPlaywright } from '../src/utils/domToJson.js';

// High-level Playwright integration
const domJson = await serializeDOMWithPlaywright(
  page, 
  'body', 
  AI_OPTIMIZED_OPTIONS
);
```

### 3. HTML Processing
```typescript
import { sanitizeHTMLContent, convertHTMLToMarkdown } from '../src/utils/domToJson.js';

// Sanitize HTML for safe processing
const cleanHTML = sanitizeHTMLContent(rawHTML, {
  removeScripts: true,
  removeStyles: true,
  removeEventHandlers: true
});

// Convert to markdown
const markdown = convertHTMLToMarkdown(cleanHTML);
```

## 🏗️ Data Structure

### DOMJsonNode Interface
```typescript
interface DOMJsonNode {
  tagName: string;                    // Element tag name
  id?: string;                        // Element ID
  classes?: string[];                 // CSS classes
  attributes?: Record<string, string>; // HTML attributes
  styles?: Record<string, string>;    // Computed CSS styles
  boundingBox?: BoundingBox;          // Position and size
  textContent?: string;               // Direct text content
  innerText?: string;                 // Text including children
  isVisible?: boolean;                // Visibility state
  isInteractive?: boolean;            // Clickable/focusable
  interactionMetadata?: InteractionMetadata; // Interaction details
  children?: DOMJsonNode[];           // Child elements
  parentReference?: string;           // Parent element reference
  selectorPath?: string;              // CSS selector path
  depth?: number;                     // Tree depth
  siblingIndex?: number;              // Position among siblings
}
```

### Interactive Element Detection
```typescript
interface InteractionMetadata {
  type: 'click' | 'input' | 'select' | 'link' | 'button' | 'form' | 'media' | 'other';
  action?: string;              // Action type (navigate, submit, etc.)
  inputType?: string;           // Form input type
  href?: string;                // Link destination
  formMethod?: string;          // Form submission method
  accessibleName?: string;      // ARIA label or accessible name
  focusable?: boolean;          // Whether element can receive focus
  tabIndex?: number;            // Tab index value
}
```

## ⚙️ Configuration Options

### AI-Optimized Configuration
```typescript
export const AI_OPTIMIZED_OPTIONS: SerializationOptions = {
  includeAllStyles: false,
  styleFilter: { layoutOnly: true },
  includeBoundingBox: true,
  includeInteractivity: true,
  maxDepth: 25,
  excludeHidden: true,
  includeParentReferences: true,
  includeSelectorPaths: true,
  optimizeForAI: true
};
```

### Comprehensive Configuration
```typescript
export const COMPREHENSIVE_OPTIONS: SerializationOptions = {
  includeAllStyles: true,
  styleFilter: {},
  includeBoundingBox: true,
  includeInteractivity: true,
  maxDepth: 50,
  excludeHidden: false,
  includeParentReferences: true,
  includeSelectorPaths: true,
  optimizeForAI: false
};
```

### Custom Configuration Examples
```typescript
// Interactive elements only
const interactiveOnly: SerializationOptions = {
  includeInteractivity: true,
  optimizeForAI: true,
  styleFilter: { include: ['cursor', 'display', 'visibility'] },
  maxDepth: 15
};

// Layout analysis focused
const layoutFocused: SerializationOptions = {
  styleFilter: { layoutOnly: true },
  includeBoundingBox: true,
  excludeHidden: true,
  maxDepth: 30
};

// Text content extraction
const textOnly: SerializationOptions = {
  includeAllStyles: false,
  includeBoundingBox: false,
  includeInteractivity: false,
  optimizeForAI: true,
  excludeHidden: true
};
```

## 🎨 Style Filtering

### Predefined Style Categories
```typescript
// Layout styles
const layoutStyles = [
  'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'margin', 'padding', 'border',
  'flex', 'flexDirection', 'justifyContent', 'alignItems',
  'grid', 'gridTemplate', 'gap', 'overflow', 'zIndex'
];

// Visual styles
const visualStyles = [
  'color', 'backgroundColor', 'fontSize', 'fontFamily',
  'borderRadius', 'boxShadow', 'opacity', 'cursor'
];

// Custom filtering
const customFilter: StyleFilterOptions = {
  include: ['display', 'cursor', 'background-color'],
  exclude: ['font-family', 'line-height']
};
```

### AI Style Optimization
```typescript
import { optimizeStylesForAI } from '../src/utils/domToJson.js';

const rawStyles = {
  'display': 'block',
  'color': '#333',
  'font-family': 'Arial',
  'cursor': 'pointer',
  // ... many more styles
};

const optimized = optimizeStylesForAI(rawStyles);
// Returns only AI-relevant styles for navigation
```

## 🔧 Integration Examples

### With BrowserTools.ts
```typescript
// In BrowserTools scrapeContentCore method
if (options.extract_dom_json) {
  const domJson = await serializeDOMWithPlaywright(
    session.page,
    options.selector || 'html',
    AI_OPTIMIZED_OPTIONS
  );
  content.dom_json = domJson;
}
```

### Database Storage
```typescript
// Matches the database schema for domJsonContent
await websitePagesRepository.create({
  id: generateId(),
  websiteId: website.id,
  url: finalUrl,
  contentHash: hash,
  htmlContent: sanitizedHTML,
  markdownContent: markdown,
  domJsonContent: domJson, // Store the serialized DOM
  // ... other fields
});
```

### Agent Navigation
```typescript
// AI agents can use the DOM JSON for navigation
const clickableElements = domJson.children?.filter(
  child => child.isInteractive && child.interactionMetadata?.type === 'button'
);

for (const element of clickableElements) {
  console.log(`Found button: ${element.selectorPath}`);
  console.log(`Text: ${element.textContent}`);
  console.log(`Action: ${element.interactionMetadata?.action}`);
}
```

## 🛡️ Security & Sanitization

### HTML Sanitization Options
```typescript
const sanitizationOptions: SanitizationOptions = {
  removeScripts: true,           // Remove <script> tags
  removeStyles: true,            // Remove <style> tags
  removeComments: true,          // Remove HTML comments
  removeDataAttributes: false,   // Keep data-* attributes
  removeEventHandlers: true,     // Remove onclick, onload, etc.
  allowedTags: [],              // Whitelist specific tags
  forbiddenTags: ['iframe', 'object'] // Additional blacklisted tags
};
```

### Safe Content Processing
```typescript
// Always sanitize before processing
const safeHTML = sanitizeHTMLContent(userHTML, {
  removeScripts: true,
  removeEventHandlers: true
});

// Convert to safe markdown
const markdown = convertHTMLToMarkdown(safeHTML, {
  headings: true,
  links: true,
  lists: true,
  emphasis: true
});
```

## 🚀 Performance Considerations

### Optimization Strategies
1. **Depth Limiting**: Use `maxDepth` to prevent deep recursion
2. **Scope Targeting**: Use specific selectors instead of 'html'
3. **AI Optimization**: Enable `optimizeForAI` to filter irrelevant elements
4. **Style Filtering**: Use `styleFilter` to include only necessary styles
5. **Hidden Element Exclusion**: Use `excludeHidden` to skip invisible content

### Example Performance-Optimized Usage
```typescript
const performanceOptimized: SerializationOptions = {
  maxDepth: 20,              // Limit recursion depth
  optimizeForAI: true,       // Filter non-essential elements
  excludeHidden: true,       // Skip invisible elements
  styleFilter: { 
    include: ['display', 'cursor', 'position'] // Only essential styles
  },
  includeBoundingBox: false  // Skip expensive getBoundingClientRect calls
};

const result = await serializeDOMWithPlaywright(
  page, 
  'main', // Target specific section instead of entire page
  performanceOptimized
);
```

## 📝 Usage Examples

### Basic Navigation Analysis
```typescript
// Extract navigation structure
const navStructure = await serializeDOMWithPlaywright(page, 'nav', {
  includeInteractivity: true,
  includeSelectorPaths: true,
  optimizeForAI: true,
  maxDepth: 10
});

// Find all navigation links
const navLinks = navStructure.children?.filter(
  child => child.tagName === 'a' && child.interactionMetadata?.href
);
```

### Form Analysis
```typescript
// Analyze form structure
const formData = await serializeDOMWithPlaywright(page, 'form', {
  includeInteractivity: true,
  styleFilter: { include: ['display', 'visibility'] },
  maxDepth: 15
});

// Extract form inputs
const inputs = extractInteractiveElements(formData, ['input', 'select', 'textarea']);
```

### Content Extraction
```typescript
// Extract main content for analysis
const contentArea = await serializeDOMWithPlaywright(page, 'main', {
  optimizeForAI: true,
  excludeHidden: true,
  styleFilter: { layoutOnly: true }
});

// Convert to clean text
const textContent = extractTextContent(contentArea);
const markdown = convertHTMLToMarkdown(textContent);
```

## 🔍 Debugging & Development

### Debug Options
```typescript
// Development configuration with full details
const debugOptions: SerializationOptions = {
  includeAllStyles: true,
  includeBoundingBox: true,
  includeInteractivity: true,
  includeParentReferences: true,
  includeSelectorPaths: true,
  maxDepth: 100,
  optimizeForAI: false
};
```

### Logging & Analysis
```typescript
// Log structure for debugging
function logDOMStructure(node: DOMJsonNode, indent = 0) {
  const prefix = '  '.repeat(indent);
  console.log(`${prefix}${node.tagName}${node.id ? '#' + node.id : ''}${node.classes ? '.' + node.classes.join('.') : ''}`);
  
  if (node.isInteractive) {
    console.log(`${prefix}  → Interactive: ${node.interactionMetadata?.type}`);
  }
  
  if (node.children) {
    node.children.forEach(child => logDOMStructure(child, indent + 1));
  }
}
```

## 🤝 Contributing

When extending the utility:

1. **Maintain TypeScript compatibility** - All functions should be properly typed
2. **Handle edge cases** - Consider empty elements, malformed HTML, etc.
3. **Optimize for AI consumption** - Filter irrelevant data for AI navigation
4. **Test with real websites** - Verify functionality across different page structures
5. **Document new features** - Update this documentation for new capabilities

## 📚 Related Files

- `/src/utils/domToJson.ts` - Main utility implementation
- `/src/tools/BrowserTools.ts` - Browser automation integration
- `/src/schemas/tools/browser.ts` - Schema definitions for DOM JSON
- `/examples/domToJsonExample.ts` - Usage examples and demonstrations
- `/src/schemas/scraping.ts` - Database schema for domJsonContent storage

## 🎉 Summary

The DOM-to-JSON utility provides a comprehensive solution for converting web page DOM structures into AI-navigable JSON format. It includes advanced features like interactive element detection, style optimization, HTML sanitization, and seamless Playwright integration, making it ideal for AI-driven web automation and analysis tasks within the ZMCPTools ecosystem.