# Playwright MCP Usage Guide

**Purpose**: Browser automation via Microsoft's playwright-mcp server. Provides structured accessibility-based interactions (no vision models needed).

---

## Overview

**playwright-mcp** is Microsoft's MCP server for browser automation using [Playwright](https://playwright.dev).

**Key Benefits**:
- **Fast**: Uses accessibility tree, not pixel-based input
- **LLM-friendly**: Structured data, no vision models needed
- **Deterministic**: Avoids ambiguity of screenshot-based approaches
- **Project-local**: Configured in `.claude/mcp_config.json` (not global `~/.claude`)

**Integration**: Git submodule at `external/playwright-mcp`

---

## Configuration

**Location**: `.claude/mcp_config.json` (project-local)

**Current Setup**:
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--browser=chromium",
        "--caps=tabs,pdf,vision",
        "--output-dir=/home/jw/dev/game1/var/playwright-output",
        "--timeout-action=5000",
        "--timeout-navigation=60000",
        "--isolated",
        "--save-trace",
        "--save-video=1280x720"
      ]
    }
  }
}
```

**Configuration Choices**:
- **Browser**: `chromium` (fastest, most compatible)
- **Capabilities**: `tabs` (tab management), `pdf` (PDF generation), `vision` (coordinate-based clicks)
- **Mode**: `--isolated` (clean state per session, no pollution)
- **Tracing**: `--save-trace` (full Playwright trace for debugging)
- **Video**: `--save-video=1280x720` (record all interactions)
- **Output**: `/home/jw/dev/game1/var/playwright-output` (traces, screenshots, videos)

**Modify Configuration**:
```bash
# Edit project-local config
cat .claude/mcp_config.json

# Restart Claude Code to apply changes
```

---

## Available Tools

### Core Browser Automation

| Tool | Description | Read-Only |
|------|-------------|-----------|
| `browser_navigate` | Navigate to a URL | false |
| `browser_snapshot` | Capture accessibility snapshot (better than screenshot) | true |
| `browser_click` | Click element (single or double) | false |
| `browser_type` | Type text into editable element | false |
| `browser_fill_form` | Fill multiple form fields | false |
| `browser_select_option` | Select dropdown option | false |
| `browser_press_key` | Press keyboard key | false |
| `browser_hover` | Hover over element | true |
| `browser_drag` | Drag and drop between elements | false |
| `browser_evaluate` | Execute JavaScript on page/element | false |

### Navigation & State

| Tool | Description | Read-Only |
|------|-------------|-----------|
| `browser_navigate_back` | Go back to previous page | true |
| `browser_wait_for` | Wait for text to appear/disappear or time | true |
| `browser_close` | Close browser | true |

### Observability

| Tool | Description | Read-Only |
|------|-------------|-----------|
| `browser_console_messages` | Get console messages (all or errors only) | true |
| `browser_network_requests` | List network requests since page load | true |
| `browser_take_screenshot` | Take screenshot (viewport or full page) | true |

### Tab Management (opt-in via `--caps=tabs`)

| Tool | Description | Read-Only |
|------|-------------|-----------|
| `browser_tabs` | List, create, close, or select browser tab | false |

### PDF Generation (opt-in via `--caps=pdf`)

| Tool | Description | Read-Only |
|------|-------------|-----------|
| `browser_pdf_save` | Save page as PDF | true |

### Coordinate-Based (opt-in via `--caps=vision`)

| Tool | Description | Read-Only |
|------|-------------|-----------|
| `browser_mouse_click_xy` | Click at (x, y) coordinates | false |
| `browser_mouse_move_xy` | Move mouse to (x, y) | true |
| `browser_mouse_drag_xy` | Drag from (x1, y1) to (x2, y2) | false |

---

## Usage Patterns

### Pattern 1: Navigate and Capture Snapshot

**Use case**: Analyze page structure before interacting

```typescript
// Navigate to URL
browser_navigate({ url: "https://example.com" })

// Get structured accessibility snapshot
browser_snapshot()

// Snapshot returns structured data:
// - Element refs for clicking/typing
// - Text content
// - Semantic structure
```

### Pattern 2: Form Filling

**Use case**: Fill multi-field forms

```typescript
// Option 1: Fill multiple fields at once
browser_fill_form({
  fields: [
    { element: "username", ref: "input-1", text: "jw" },
    { element: "password", ref: "input-2", text: "secret" }
  ]
})

// Option 2: Fill individually
browser_type({
  element: "username field",
  ref: "input-1",
  text: "jw",
  submit: false
})
browser_type({
  element: "password field",
  ref: "input-2",
  text: "secret",
  submit: true  // Press Enter after typing
})
```

### Pattern 3: Wait for Dynamic Content

**Use case**: Handle AJAX/dynamic loading

```typescript
// Navigate
browser_navigate({ url: "https://example.com/search" })

// Type search query
browser_type({
  element: "search input",
  ref: "search-box",
  text: "playwright",
  submit: true
})

// Wait for results to load
browser_wait_for({ text: "Search Results" })

// Capture results
browser_snapshot()
```

### Pattern 4: Console Error Debugging

**Use case**: Debug JavaScript errors on page

```typescript
// Navigate to page
browser_navigate({ url: "https://example.com" })

// Interact with page
browser_click({ element: "submit button", ref: "btn-1" })

// Check for errors
browser_console_messages({ onlyErrors: true })
// Returns: [{level: "error", text: "Uncaught TypeError..."}]
```

### Pattern 5: Multi-Tab Workflows

**Use case**: Compare across multiple pages

```typescript
// Open first page
browser_navigate({ url: "https://site1.com" })
browser_snapshot()

// Create new tab
browser_tabs({ action: "create" })

// Navigate in new tab
browser_navigate({ url: "https://site2.com" })
browser_snapshot()

// Switch back to first tab
browser_tabs({ action: "select", index: 0 })
```

---

## Examples

### Example 1: GitHub Issue Search

```typescript
// Navigate to GitHub issues
browser_navigate({
  url: "https://github.com/jw409/ZMCPTools/issues"
})

// Get page snapshot to find search box ref
browser_snapshot()

// Type search query
browser_type({
  element: "search issues input",
  ref: "issue-search-field",
  text: "playwright",
  submit: true
})

// Wait for results
browser_wait_for({ text: "results" })

// Capture results
browser_snapshot()

// Take screenshot for documentation
browser_take_screenshot({
  filename: "github-search-results.png"
})
```

### Example 2: Form Submission with Validation

```typescript
// Navigate to form
browser_navigate({ url: "https://example.com/contact" })

// Fill form
browser_fill_form({
  fields: [
    { element: "name", ref: "name-1", text: "Jeff W" },
    { element: "email", ref: "email-1", text: "invalid-email" }
  ]
})

// Click submit
browser_click({ element: "submit button", ref: "btn-submit" })

// Check for validation errors
browser_wait_for({ text: "valid email address" })

// Fix email
browser_type({
  element: "email field",
  ref: "email-1",
  text: "jw@example.com",
  submit: false
})

// Submit again
browser_click({ element: "submit button", ref: "btn-submit" })

// Wait for success
browser_wait_for({ text: "Thank you" })
```

### Example 3: Export Page as PDF

```typescript
// Navigate to documentation page
browser_navigate({
  url: "https://playwright.dev/docs/api/class-page"
})

// Wait for page load
browser_wait_for({ time: 2 })

// Save as PDF
browser_pdf_save({
  filename: "playwright-api-docs.pdf"
})
// PDF saved to: var/playwright-output/playwright-api-docs.pdf
```

---

## Output Files

**Location**: `/home/jw/dev/game1/var/playwright-output/`

### Traces

**File**: `trace-{timestamp}.zip`

**Contains**: Full Playwright trace (network, console, DOM snapshots, screenshots)

**View**:
```bash
npx playwright show-trace var/playwright-output/trace-*.zip
```

### Videos

**File**: `video-{timestamp}.webm`

**Format**: 1280x720 WebM video of full session

**View**:
```bash
mpv var/playwright-output/video-*.webm
# or
vlc var/playwright-output/video-*.webm
```

### Screenshots

**File**: Custom filename or `page-{timestamp}.png`

**Format**: PNG or JPEG

**View**:
```bash
feh var/playwright-output/*.png
# or
eog var/playwright-output/*.png
```

### PDFs

**File**: Custom filename or `page-{timestamp}.pdf`

**Format**: PDF with full page content

---

## Troubleshooting

### Browser Not Installed

**Error**: `browserType.launch: Executable doesn't exist`

**Solution**:
```typescript
// Install browser
browser_install()

// Then retry your operation
browser_navigate({ url: "..." })
```

### Element Not Found

**Error**: `Element reference "xyz" not found in snapshot`

**Cause**: Using stale element ref from old snapshot

**Solution**:
```typescript
// Always get fresh snapshot before interacting
browser_snapshot()

// Use ref from LATEST snapshot
browser_click({ element: "...", ref: "fresh-ref-123" })
```

### Timeout Errors

**Error**: `Action timeout: 5000ms exceeded`

**Cause**: Element not ready within 5s

**Solution**:
```typescript
// Wait before acting
browser_wait_for({ text: "expected content" })

// Or increase timeout in config:
// Edit .claude/mcp_config.json → --timeout-action=10000
```

### Network Requests Not Captured

**Issue**: `browser_network_requests` returns empty array

**Cause**: Network recording starts AFTER page load

**Solution**:
```typescript
// Navigate (starts recording)
browser_navigate({ url: "..." })

// Interact (generates requests)
browser_click({ element: "load more", ref: "btn-1" })

// Now capture requests
browser_network_requests()
```

### Console Messages Missing

**Issue**: `browser_console_messages` returns old messages

**Cause**: Console messages accumulate from page load

**Solution**:
```typescript
// Get baseline at page load
browser_navigate({ url: "..." })
const baseline = browser_console_messages()

// Interact
browser_click({ element: "...", ref: "..." })

// Get NEW messages only
const all = browser_console_messages()
const new_messages = all.filter(msg =>
  !baseline.some(b => b.text === msg.text)
)
```

### Video Not Recording

**Issue**: No video files in output directory

**Cause**: Video recording requires headed mode

**Solution**:
```bash
# Remove --headless from .claude/mcp_config.json
# Current config already uses headed mode (no --headless flag)

# Restart Claude Code
```

### Isolated Mode Loses Login State

**Issue**: Have to log in every session

**Cause**: `--isolated` mode discards state after session

**Solution (Persistent Profile)**:
```json
// Edit .claude/mcp_config.json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--browser=chromium",
        // Remove --isolated
        "--user-data-dir=/home/jw/.cache/playwright-profile",
        // Keep other args...
      ]
    }
  }
}
```

**Solution (Storage State)**:
```json
// Use --storage-state with --isolated
{
  "args": [
    "@playwright/mcp@latest",
    "--isolated",
    "--storage-state=/home/jw/dev/game1/var/playwright-auth.json",
    // ... other args
  ]
}
```

---

## Advanced Configuration

### Custom Browser

```json
// Use specific browser or channel
{
  "args": [
    "@playwright/mcp@latest",
    "--browser=firefox",  // or webkit
    // OR
    "--browser=msedge",   // Edge
    // ... other args
  ]
}
```

### Proxy Configuration

```json
{
  "args": [
    "@playwright/mcp@latest",
    "--proxy-server=http://proxy:3128",
    "--proxy-bypass=.com,localhost",
    // ... other args
  ]
}
```

### Custom User Agent

```json
{
  "args": [
    "@playwright/mcp@latest",
    "--user-agent=CustomBot/1.0",
    // ... other args
  ]
}
```

### Device Emulation

```json
{
  "args": [
    "@playwright/mcp@latest",
    "--device=iPhone 15",
    // ... other args
  ]
}
```

### Block Service Workers

```json
{
  "args": [
    "@playwright/mcp@latest",
    "--block-service-workers",
    // ... other args
  ]
}
```

---

## Integration with ZMCPTools

**Use with Knowledge Graph**:
```typescript
// Search knowledge graph for test URLs
knowledge://search?query=test+sites&limit=5

// Navigate to result
browser_navigate({ url: result.url })

// Store results in knowledge graph
knowledge_store({
  entity: "browser_test",
  data: browser_snapshot()
})
```

**Use with Project Analysis**:
```typescript
// Get project structure
project://./structure

// Find HTML files
project://./files?pattern=*.html

// Test each HTML file locally
for (const file of html_files) {
  browser_navigate({ url: `file://${file}` })
  browser_console_messages({ onlyErrors: true })
}
```

---

## Related Documentation

- **Playwright Docs**: https://playwright.dev/docs/intro
- **Playwright MCP Server**: `external/playwright-mcp/README.md`
- **MCP Protocol**: https://modelcontextprotocol.io
- **ZMCPTools TOOL_LIST**: `etc/TOOL_LIST.md`
- **ZMCPTools META Map**: `etc/META_DOCUMENTATION_MAP.md`

---

**Last Updated**: 2025-10-09

**Status**: Active - playwright-mcp integrated as git submodule, configured in project-local .claude/mcp_config.json

**Authority**: Authoritative guide for playwright-mcp usage in ZMCPTools project
