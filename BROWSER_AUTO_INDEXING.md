# Browser Auto-Indexing Integration

## Overview

This document describes the implementation of automatic website indexing in the ClaudeMcpTools browser navigation tools. When users navigate to any URL, the system can automatically index the page in the website database with comprehensive content extraction and storage.

## Implementation Details

### 1. Database Schema Enhancements

The existing database schema in `/src/schemas/scraping.ts` already supported all required fields:

- **websites table**: Stores website/domain information
- **website_pages table**: Stores individual page content with:
  - `htmlContent`: Raw HTML content
  - `sanitizedHtmlContent`: HTML with scripts/styles removed
  - `markdownContent`: Converted markdown format
  - `domJsonContent`: DOM structure as navigable JSON
  - `screenshotBase64`: Base64-encoded screenshots
  - `screenshotMetadata`: Screenshot capture details
  - `contentHash`: SHA-256 hash for change detection

### 2. Repository Integration

Enhanced the existing repositories:

- **WebsiteRepository**: Handles domain extraction and website creation
- **WebsitePagesRepository**: Extended createOrUpdate method to handle all new content types

### 3. BrowserTools.ts Integration

#### New Dependencies Added:
```typescript
import { WebsiteRepository } from '../repositories/WebsiteRepository.js';
import { WebsitePagesRepository } from '../repositories/WebsitePagesRepository.js';
import { DatabaseManager } from '../database/index.js';
import { createHash, randomUUID } from 'crypto';
import { serializeDOMWithPlaywright, sanitizeHTMLContent, convertHTMLToMarkdown, type SerializationOptions, AI_OPTIMIZED_OPTIONS } from '../utils/domToJson.js';
```

#### New Method: `indexWebsitePage()`
```typescript
private async indexWebsitePage(
  sessionId: string,
  url: string,
  options: {
    extractHtml?: boolean;
    extractSanitizedHtml?: boolean;
    extractMarkdown?: boolean;
    extractDomJson?: boolean;
    captureScreenshot?: boolean;
    screenshotFullPage?: boolean;
    selector?: string;
    httpStatus?: number;
    title?: string;
    errorMessage?: string;
  }
): Promise<{
  success: boolean;
  websiteId?: string;
  pageId?: string;
  error?: string;
}>
```

This method:
1. **Extracts domain** from URL and finds/creates website entry
2. **Normalizes URL** for consistent storage
3. **Extracts content** based on options:
   - Raw HTML content
   - Sanitized HTML (scripts/styles removed)
   - Markdown conversion
   - DOM JSON structure using `serializeDOMWithPlaywright()`
   - Screenshots as base64 data
4. **Generates content hash** for change detection
5. **Creates or updates** page entry in database

#### Enhanced `navigateAndScrape()` Method

The main navigation method now includes:

```typescript
// Auto-index website if enabled
let indexingResult: { success: boolean; websiteId?: string; pageId?: string; error?: string } | null = null;
if (params.auto_index_website) {
  try {
    indexingResult = await this.indexWebsitePage(
      sessionId,
      navResult.url || params.url,
      {
        extractHtml: params.extract_html || params.extract_sanitized_html || params.extract_markdown,
        extractSanitizedHtml: params.extract_sanitized_html,
        extractMarkdown: params.extract_markdown,
        extractDomJson: params.extract_dom_json,
        captureScreenshot: params.capture_screenshot,
        screenshotFullPage: params.screenshot_full_page,
        selector: params.selector,
        httpStatus: 200, // Assume success since navigation succeeded
        title: navResult.title,
        errorMessage: undefined
      }
    );
  } catch (error) {
    console.warn('Failed to index website page:', error);
    // Don't fail the navigation for indexing failure
    indexingResult = { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown indexing error'
    };
  }
}
```

### 4. Schema Updates

The existing `/src/schemas/tools/browser.ts` already included all necessary parameters:

- `auto_index_website: z.boolean().default(true)` - Enable/disable auto-indexing
- `extract_sanitized_html: z.boolean().default(false)` - Extract sanitized HTML
- `extract_markdown: z.boolean().default(false)` - Convert to markdown
- `extract_dom_json: z.boolean().default(false)` - Extract DOM as JSON
- `capture_screenshot: z.boolean().default(false)` - Capture screenshots

### 5. Response Schema Enhancements

The response now includes indexing status:

```typescript
data: {
  website_indexed: boolean,      // Whether indexing was successful
  website_id: string,           // Database ID of website
  page_id: string,              // Database ID of page
  indexing_error?: string       // Error message if indexing failed
}
```

## Key Features

### 1. Automatic Website Discovery
- Extracts domain from any URL
- Creates website entry if it doesn't exist
- Uses domain as the natural key for websites

### 2. Comprehensive Content Extraction
- **Raw HTML**: Full page HTML including JavaScript-rendered content
- **Sanitized HTML**: Clean HTML with scripts, styles, and event handlers removed
- **Markdown**: AI-friendly markdown conversion using Turndown
- **DOM JSON**: Navigable DOM structure with inline styles and interactivity metadata
- **Screenshots**: Base64-encoded full-page or viewport screenshots

### 3. Change Detection
- Content hashing using SHA-256
- Only updates database when content actually changes
- Prevents duplicate storage and unnecessary database operations

### 4. Graceful Error Handling
- Indexing failures don't break navigation operations
- Partial content extraction on errors
- Comprehensive error logging and reporting

### 5. Performance Optimizations
- Reuses HTML content across multiple extraction types
- Efficient DOM JSON serialization with AI-optimized options
- Lazy loading of content types (only extract what's requested)

## Usage Examples

### Basic Auto-Indexing (Default Behavior)
```typescript
await navigateAndScrape({
  url: "https://docs.example.com",
  auto_index_website: true  // Default: true
});
```

### Full Content Extraction with Indexing
```typescript
await navigateAndScrape({
  url: "https://docs.example.com",
  extract_html: true,
  extract_sanitized_html: true,
  extract_markdown: true,
  extract_dom_json: true,
  capture_screenshot: true,
  screenshot_full_page: true,
  auto_index_website: true
});
```

### Disable Auto-Indexing
```typescript
await navigateAndScrape({
  url: "https://temporary-page.com",
  auto_index_website: false
});
```

## Integration Points

1. **All Browser Navigation Operations**: Auto-indexing works with any `navigate_and_scrape` call
2. **Existing Extraction Parameters**: Respects and enhances existing content extraction options
3. **Database Integration**: Uses existing repository pattern and database connections
4. **Error Handling**: Follows existing error handling patterns
5. **Response Schemas**: Extends existing response schemas with indexing status

## Content Hashing Strategy

The system generates content hashes by combining all extracted content types:

```typescript
const contentForHash = [
  htmlContent || '',
  sanitizedHtmlContent || '',
  markdownContent || '',
  JSON.stringify(domJsonContent) || '',
  screenshotBase64 || ''
].join('|');

const contentHash = createHash('sha256').update(contentForHash).digest('hex');
```

This ensures that any change in any content type will trigger an update.

## Database Storage

### Website Table
- `domain`: Unique domain name (e.g., "docs.example.com")
- `name`: Human-readable name
- `metaDescription`: Optional description

### Website Pages Table
- `websiteId`: Foreign key to websites table
- `url`: Normalized URL (tracking params removed, fragments removed)
- `contentHash`: SHA-256 hash for change detection
- `htmlContent`: Raw HTML content
- `sanitizedHtmlContent`: Cleaned HTML
- `markdownContent`: Markdown conversion
- `domJsonContent`: DOM structure as JSON
- `screenshotBase64`: Base64 screenshot data
- `screenshotMetadata`: Capture details (width, height, timestamp, etc.)
- `javascriptEnabled`: Whether JS was enabled during scraping

## Error Handling

The implementation includes comprehensive error handling:

1. **Database Errors**: Graceful fallback if database operations fail
2. **Content Extraction Errors**: Partial extraction continues on individual failures
3. **Navigation Isolation**: Indexing failures don't break navigation
4. **Logging**: Detailed error logging for debugging
5. **User Feedback**: Clear error messages in response metadata

## Testing

A comprehensive example is provided in `/examples/browser-auto-indexing-example.ts` demonstrating:

- Basic auto-indexing usage
- Full content extraction
- Change detection behavior
- Error handling scenarios
- Performance characteristics

## Future Enhancements

Potential future improvements:

1. **Incremental Updates**: Only update changed content types
2. **Compression**: Compress large content before storage
3. **Metadata Extraction**: Extract meta tags, structured data
4. **Link Analysis**: Track internal/external link relationships
5. **Performance Metrics**: Track page load times, rendering times
6. **Vector Indexing**: Automatic vector embedding generation for semantic search

## Backward Compatibility

The implementation maintains full backward compatibility:

- Default `auto_index_website: true` means existing code gets indexing automatically
- All existing parameters and response formats unchanged
- No breaking changes to existing functionality
- Graceful degradation when indexing is disabled or fails