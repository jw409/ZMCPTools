# ClaudeMcpTools - Complete MCP Tool Inventory

This document lists ALL MCP tools available in the ClaudeMcpTools project, organized by category.

## Summary
- **Total Tools**: 43
- **Categories**: 6
- **Tool Prefix**: `mcp__claude-mcp-tools__`
- **Foundation Caching**: Automatically integrated (no manual tools needed)

## Tool Categories

### 1. Agent Orchestration Tools (14 tools)
*Defined in McpServer.ts - Multi-agent coordination and communication*

1. `mcp__claude-mcp-tools__orchestrate_objective` - Spawn architect agent to coordinate multi-agent objective completion
2. `mcp__claude-mcp-tools__spawn_agent` - Spawn fully autonomous Claude agent with complete tool access
3. `mcp__claude-mcp-tools__create_task` - Create and assign task to agents
4. `mcp__claude-mcp-tools__join_room` - Join communication room for coordination
5. `mcp__claude-mcp-tools__send_message` - Send message to coordination room
6. `mcp__claude-mcp-tools__wait_for_messages` - Wait for new messages in a room
7. `mcp__claude-mcp-tools__store_memory` - Store insights and learnings in shared memory
8. `mcp__claude-mcp-tools__search_memory` - Search shared memory for insights
9. `mcp__claude-mcp-tools__list_agents` - Get list of active agents
10. `mcp__claude-mcp-tools__terminate_agent` - Terminate one or more agents
11. `mcp__claude-mcp-tools__close_room` - Close a communication room (soft delete, keeps data)
12. `mcp__claude-mcp-tools__delete_room` - Permanently delete a communication room and all messages
13. `mcp__claude-mcp-tools__list_rooms` - List communication rooms with filtering and pagination
14. `mcp__claude-mcp-tools__list_room_messages` - List messages from a specific room with pagination

### 2. Browser Automation Tools (6 tools)
*Defined in BrowserMcpTools.ts - Web browser automation with intelligent session management*

1. `mcp__claude-mcp-tools__create_browser_session` - Create a new browser session with intelligent auto-close and session management
2. `mcp__claude-mcp-tools__navigate_and_scrape` - Navigate to a URL and optionally scrape content in one operation. Auto-creates session if needed
3. `mcp__claude-mcp-tools__interact_with_page` - Perform multiple interactions with a page: click, type, hover, select, screenshot, wait, scroll
4. `mcp__claude-mcp-tools__manage_browser_sessions` - Manage browser sessions: list, close, cleanup idle sessions, get status
5. `mcp__claude-mcp-tools__navigate_to_url` - [LEGACY] Navigate to a URL in an existing browser session. Use navigate_and_scrape instead
6. `mcp__claude-mcp-tools__scrape_content` - [LEGACY] Extract content from the current page. Use navigate_and_scrape instead

### 3. Web Scraping & Documentation Tools (6 tools)
*Defined in WebScrapingMcpTools.ts - Intelligent documentation scraping with sub-agent coordination*

1. `mcp__claude-mcp-tools__scrape_documentation` - Scrape documentation from a website using intelligent sub-agents
2. `mcp__claude-mcp-tools__get_scraping_status` - Get status of active and recent scraping jobs
3. `mcp__claude-mcp-tools__cancel_scrape_job` - Cancel an active or pending scraping job
4. `mcp__claude-mcp-tools__start_scraping_worker` - Start the background scraping worker to process queued jobs
5. `mcp__claude-mcp-tools__stop_scraping_worker` - Stop the background scraping worker
6. `mcp__claude-mcp-tools__list_documentation_sources` - List all configured documentation sources

### 4. LanceDB Vector Search Tools (9 tools)
*Defined in VectorSearchService.ts - Native TypeScript vector database with LanceDB*

1. `mcp__claude-mcp-tools__create_vector_collection` - Create LanceDB collections for custom embeddings
2. `mcp__claude-mcp-tools__search_vectors` - Advanced vector similarity search with configurable thresholds
3. `mcp__claude-mcp-tools__manage_embeddings` - Configure embedding providers (OpenAI, HuggingFace, local)
4. `mcp__claude-mcp-tools__add_documents_to_collection` - Add documents to vector collection with embeddings
5. `mcp__claude-mcp-tools__get_collection_stats` - Get statistics for vector collections
6. `mcp__claude-mcp-tools__list_vector_collections` - List all available vector collections
7. `mcp__claude-mcp-tools__delete_vector_collection` - Delete vector collection and associated data
8. `mcp__claude-mcp-tools__search_documentation_vectors` - Search documentation using vector embeddings
9. `mcp__claude-mcp-tools__test_vector_connection` - Test LanceDB connection and performance

### 5. Project Analysis & File Operations Tools (7 tools)
*Defined in AnalysisMcpTools.ts - Project structure analysis and smart file operations*

1. `mcp__claude-mcp-tools__analyze_project_structure` - Analyze project structure and generate a comprehensive overview
2. `mcp__claude-mcp-tools__generate_project_summary` - Generate AI-optimized project overview and analysis
3. `mcp__claude-mcp-tools__analyze_file_symbols` - Extract and analyze symbols (functions, classes, etc.) from code files
4. `mcp__claude-mcp-tools__list_files` - List files in a directory with smart ignore patterns
5. `mcp__claude-mcp-tools__find_files` - Search for files by pattern with optional content matching
6. `mcp__claude-mcp-tools__easy_replace` - Fuzzy string replacement in files with smart matching
7. `mcp__claude-mcp-tools__cleanup_orphaned_projects` - Clean up orphaned or unused project directories

### 6. TreeSummary Tools (5 tools)
*Defined in TreeSummaryTools.ts - Advanced project analysis and caching system*

1. `mcp__claude-mcp-tools__update_file_analysis` - Update or create analysis data for a specific file in the TreeSummary system
2. `mcp__claude-mcp-tools__remove_file_analysis` - Remove analysis data for a deleted file from the TreeSummary system
3. `mcp__claude-mcp-tools__update_project_metadata` - Update project metadata in the TreeSummary system
4. `mcp__claude-mcp-tools__get_project_overview` - Get comprehensive project overview from TreeSummary analysis
5. `mcp__claude-mcp-tools__cleanup_stale_analyses` - Clean up stale analysis files older than specified days

### 7. Foundation Caching
*Automatically integrated into agent creation and spawning - no manual tools needed*

Foundation caching is now **automatically handled** by the system:
- 85-90% token cost reduction through shared context
- Seamless integration with agent spawning and orchestration
- Intelligent session management and cache optimization
- No manual cache management required

## Tool Implementation Details

### Core Tool Classes
- **AgentOrchestrationTools** (inline in McpServer.ts) - Multi-agent coordination
- **BrowserMcpTools** - Browser automation with session management
- **WebScrapingMcpTools** - Documentation scraping with sub-agents
- **VectorSearchService** - LanceDB vector database and semantic search
- **AnalysisMcpTools** - Project analysis and file operations
- **TreeSummaryTools** - Advanced project caching and analysis
- **FoundationCacheService** - Automatic foundation caching (integrated)

### Tool Registration
All tools are registered in `McpServer.ts` through the `getAvailableTools()` method:
```typescript
private getAvailableTools(): Tool[] {
  return [
    ...this.getOrchestrationTools(),      // 14 tools
    ...this.browserMcpTools.getTools(),   // 6 tools
    ...this.webScrapingMcpTools.getTools(), // 6 tools
    ...this.vectorSearchTools.getTools(), // 9 tools
    ...this.analysisMcpTools.getTools(),  // 7 tools
    ...this.treeSummaryTools.getTools(),  // 5 tools
    // Foundation caching now automatic - no manual tools
  ];
}
```

### Legacy Support
- 2 browser tools are marked as LEGACY but maintained for backward compatibility
- All tools use the `mcp__claude-mcp-tools__` prefix for proper namespacing

## Usage Notes

1. **Multi-Agent Workflows**: Start with `orchestrate_objective` for complex tasks
2. **Browser Automation**: Use `navigate_and_scrape` for most browser operations
3. **Documentation**: Use `scrape_documentation` for intelligent doc crawling with LanceDB indexing
4. **Vector Search**: Use `search_vectors` for semantic similarity search across documents
5. **Project Analysis**: Begin with `analyze_project_structure` for overview
6. **Caching**: Use foundation sessions for significant token cost reduction
7. **TreeSummary**: Integrated with project analysis for enhanced caching
8. **Embeddings**: Configure providers with `manage_embeddings` for optimal search performance

## Tool Count by Category
- Agent Orchestration: 14 tools
- Browser Automation: 6 tools 
- Web Scraping: 6 tools
- LanceDB Vector Search: 9 tools
- Project Analysis: 7 tools
- TreeSummary: 5 tools
- Foundation Cache: **Automatic** (no manual tools)

**Total: 43 MCP tools** (including 14 orchestration tools defined inline)

---
*Generated on 2025-07-07*
*Project: ClaudeMcpTools TypeScript Implementation*