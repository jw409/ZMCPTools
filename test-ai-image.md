# AI Image Format Support for Browser Tools

This document describes the new AI-consumable image format support added to the ClaudeMcpTools browser automation tools.

## Overview

The browser tools now support returning screenshots in an AI-compatible format that Claude can directly consume, rather than just saving to files.

## AI Image Format

When enabled, screenshots are returned in this format:

```json
{
  "type": "image",
  "data": "base64-encoded-image-data",
  "mimeType": "image/png" // or "image/jpeg"
}
```

## Updated Tools

### 1. `interact_with_page` Tool

**New Parameters for Screenshot Actions:**
- `return_for_ai`: boolean (default: false) - Return AI-compatible format instead of saving to file
- `full_page`: boolean (default: true) - Capture full page or viewport only  
- `image_format`: "png" | "jpeg" (default: "png") - Image format

**Example Usage:**
```json
{
  "session_id": "browser_session_123",
  "actions": [
    {
      "type": "screenshot",
      "return_for_ai": true,
      "full_page": true,
      "image_format": "png"
    }
  ]
}
```

### 2. `take_screenshot` Tool (Legacy)

**New Parameters:**
- `return_for_ai`: boolean (default: false) - Return AI-compatible format
- `filepath`: string (optional) - Required only when `return_for_ai` is false

**Example Usage:**
```json
{
  "session_id": "browser_session_123",
  "return_for_ai": true,
  "full_page": true,
  "type": "png"
}
```

## Response Format

### When `return_for_ai: false` (Default)
Traditional file-based response:
```json
{
  "success": true,
  "data": {
    "session_id": "browser_session_123",
    "screenshot_path": "/path/to/screenshot.png"
  }
}
```

### When `return_for_ai: true`
AI-compatible response with mixed content:
```json
{
  "success": true,
  "data": {
    "session_id": "browser_session_123",
    "ai_image": {
      "type": "image", 
      "data": "iVBORw0KGgoAAAANSUhEUgAA...",
      "mimeType": "image/png"
    }
  }
}
```

## MCP Server Integration

The MCP server automatically detects AI image format in tool responses and returns them as proper MCP image content alongside text content:

**MCP Response Structure:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"success\": true, \"data\": {...}}"
    },
    {
      "type": "image",
      "data": "base64-image-data",
      "mimeType": "image/png"
    }
  ],
  "isError": false
}
```

## Implementation Notes

### Browser Tools Changes
1. **Updated `takeScreenshotCore` method** to support AI format return option
2. **Added `AIImageFormat` interface** for type safety
3. **Enhanced `ScreenshotOptions` interface** with `returnForAI` flag
4. **Modified response transformation** to handle AI images in `transformResultData`

### Schema Updates
1. **Added AI image response schemas** to browser tool responses
2. **Updated action schemas** for `interact_with_page` with new screenshot parameters
3. **Enhanced legacy screenshot schema** with AI format support

### MCP Server Changes
1. **Added AI image detection** in tool response handler
2. **Implemented content type switching** between text and mixed content
3. **Added helper methods** for extracting and cleaning AI images from responses

## Backward Compatibility

All changes are backward compatible:
- Default behavior remains unchanged (screenshots save to files)
- Existing tools and schemas continue to work
- New functionality is opt-in via `return_for_ai` parameter

## Benefits

1. **Direct AI Consumption**: Screenshots can be directly analyzed by Claude without file system dependency
2. **Better Integration**: Seamless integration with MCP protocol image content
3. **Flexible Output**: Choose between file-based or AI-compatible format based on use case
4. **Performance**: Eliminates need for file I/O when images are for AI analysis only