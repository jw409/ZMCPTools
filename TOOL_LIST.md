# ZMCPTools - Complete Tool Reference

This document provides a comprehensive reference for all 61 MCP tools available in ZMCPTools. Tools are organized by category for easy navigation and understanding.

## Table of Contents

- [Multi-Agent Orchestration (13 tools)](#multi-agent-orchestration)
- [Browser Automation (12 tools)](#browser-automation)
- [Browser AI DOM Tools (5 tools)](#browser-ai-dom-tools)
- [Communication & Coordination (10 tools)](#communication--coordination)
- [Documentation & Web Scraping (9 tools)](#documentation--web-scraping)
- [Project Analysis & File Operations (7 tools)](#project-analysis--file-operations)
- [Knowledge Graph & Memory (4 tools)](#knowledge-graph--memory)
- [Tree Summary System (5 tools)](#tree-summary-system)
- [Progress Reporting (1 tool)](#progress-reporting)

---

## Multi-Agent Orchestration

**13 tools for coordinating and managing AI agent teams**

| Tool Name | Description |
|-----------|-------------|
| `orchestrate_objective` | Spawn architect agent to coordinate multi-agent objective completion |
| `orchestrate_objective_structured` | Execute structured phased orchestration with intelligent model selection (Research → Plan → Execute → Monitor → Cleanup) |
| `spawn_agent` | Spawn fully autonomous Claude agent with complete tool access |
| `create_task` | Create and assign task to agents with enhanced capabilities |
| `list_agents` | Get list of active agents with filtering and status information |
| `terminate_agent` | Terminate one or more agents with cleanup |
| `monitor_agents` | Monitor agents with real-time updates using EventBus system |
| `continue_agent_session` | Continue an agent session using stored conversation session ID with additional instructions |
| `cleanup_stale_agents` | Clean up stale agents with enhanced options and optional room cleanup |
| `cleanup_stale_rooms` | Clean up stale rooms based on activity and participant criteria |
| `run_comprehensive_cleanup` | Run comprehensive cleanup for both agents and rooms with detailed reporting |
| `get_cleanup_configuration` | Get current cleanup configuration and settings for agents and rooms |
| `create_execution_plan` | Create comprehensive execution plan using sequential thinking before spawning agents |

---

## Browser Automation

**12 tools for advanced web automation and interaction**

| Tool Name | Description |
|-----------|-------------|
| `create_browser_session` | Create a new browser session with intelligent auto-close and session management |
| `navigate_and_scrape` | Navigate to a URL and optionally scrape content in one operation. Auto-creates session if needed |
| `interact_with_page` | Perform multiple interactions with a page: click, type, hover, select, screenshot, wait, scroll |
| `manage_browser_sessions` | Manage browser sessions: list, close, cleanup idle sessions, get status |
| `navigate_to_url` | [LEGACY] Navigate to a URL in an existing browser session. Use navigate_and_scrape instead |
| `scrape_content` | [LEGACY] Scrape content from the current page. Use navigate_and_scrape instead |
| `take_screenshot` | [LEGACY] Take a screenshot of the current page. Use interact_with_page instead |
| `execute_browser_script` | [LEGACY] Execute JavaScript in the browser context. Use interact_with_page instead |
| `interact_with_element` | [LEGACY] Interact with a page element. Use interact_with_page instead |
| `close_browser_session` | [LEGACY] Close a browser session. Use manage_browser_sessions instead |
| `list_browser_sessions` | [LEGACY] List all browser sessions. Use manage_browser_sessions instead |
| `execute_with_plan` | Execute an objective using a pre-created execution plan with well-defined agent tasks |

---

## Browser AI DOM Tools

**5 tools for AI-powered DOM analysis and navigation**

| Tool Name | Description |
|-----------|-------------|
| `analyze_dom_structure` | AI-guided exploration and analysis of DOM structure using goal-oriented patterns. Analyzes stored DOM JSON to identify interactive elements, content areas, and navigation patterns |
| `navigate_dom_path` | Navigate to specific elements in DOM JSON using dot notation paths (e.g., 'body.main.article[0].paragraphs[2]'). Extracts content and provides element information |
| `search_dom_elements` | Search for DOM elements by type, content, keywords, or attributes. Returns matching elements with their paths for further navigation |
| `get_page_screenshot` | Retrieve stored screenshot for a page. Returns file path or base64 encoded image data for AI visual analysis |
| `analyze_screenshot` | AI-powered analysis of page screenshots with custom prompts. Can focus on specific regions and provide contextual insights |

---

## Communication & Coordination

**10 tools for agent communication and coordination**

| Tool Name | Description |
|-----------|-------------|
| `join_room` | Join communication room for coordination |
| `send_message` | Send message to coordination room |
| `wait_for_messages` | Wait for messages in a room |
| `close_room` | Close a communication room (soft delete - marks as closed but keeps data) |
| `delete_room` | Permanently delete a communication room and all its messages |
| `list_rooms` | List communication rooms with filtering and pagination |
| `list_room_messages` | List messages from a specific room with pagination |
| `create_delayed_room` | Create a delayed room for coordination when agents realize they need it |
| `analyze_coordination_patterns` | Analyze coordination patterns and suggest improvements |
| `broadcast_message_to_agents` | Broadcast a message to multiple agents with auto-resume functionality |

---

## Documentation & Web Scraping

**9 tools for intelligent documentation collection and management**

| Tool Name | Description |
|-----------|-------------|
| `scrape_documentation` | Scrape documentation from a website using intelligent sub-agents. Jobs are queued and processed automatically by the background worker. Supports plain string selectors for content extraction |
| `get_scraping_status` | Get status of active and recent scraping jobs (worker runs automatically) |
| `cancel_scrape_job` | Cancel an active or pending scraping job |
| `force_unlock_job` | Force unlock a stuck scraping job - useful for debugging and recovery |
| `force_unlock_stuck_jobs` | Force unlock all stuck scraping jobs (jobs that haven't been updated recently) |
| `list_documentation_sources` | List all configured documentation sources |
| `delete_pages_by_pattern` | Delete website pages matching URL patterns (useful for cleaning up version URLs, static assets) |
| `delete_pages_by_ids` | Delete specific pages by their IDs |
| `delete_all_website_pages` | Delete all pages for a website (useful for clean slate before re-scraping) |

---

## Project Analysis & File Operations

**7 tools for code analysis and smart file operations**

| Tool Name | Description |
|-----------|-------------|
| `analyze_project_structure` | Analyze project structure and generate a comprehensive overview |
| `generate_project_summary` | Generate AI-optimized project overview and analysis |
| `analyze_file_symbols` | Extract and analyze symbols (functions, classes, etc.) from code files |
| `list_files` | List files in a directory with smart ignore patterns |
| `find_files` | Search for files by pattern with optional content matching |
| `easy_replace` | Fuzzy string replacement in files with smart matching |
| `cleanup_orphaned_projects` | Clean up orphaned or unused project directories |

---

## Knowledge Graph & Memory

**4 tools for knowledge management and semantic search**

| Tool Name | Description |
|-----------|-------------|
| `store_knowledge_memory` | Store a knowledge graph memory with entity creation |
| `create_knowledge_relationship` | Create a relationship between two entities in the knowledge graph |
| `search_knowledge_graph` | Search the knowledge graph using semantic or basic search |
| `find_related_entities` | Find related entities through relationship traversal |

---

## Tree Summary System

**5 tools for project structure caching and analysis**

| Tool Name | Description |
|-----------|-------------|
| `update_file_analysis` | Update or create analysis data for a specific file in the TreeSummary system |
| `remove_file_analysis` | Remove analysis data for a deleted file from the TreeSummary system |
| `update_project_metadata` | Update project metadata in the TreeSummary system |
| `get_project_overview` | Get comprehensive project overview from TreeSummary analysis |
| `cleanup_stale_analyses` | Clean up stale analysis files older than specified days |

---

## Progress Reporting

**1 tool for agent progress tracking**

| Tool Name | Description |
|-----------|-------------|
| `report_progress` | Report progress updates for agent tasks and status changes |

---

## Tool Categories Summary

- **Multi-Agent Orchestration**: 13 tools for coordinating AI agent teams
- **Browser Automation**: 12 tools for web automation (8 legacy tools for backward compatibility)
- **Browser AI DOM Tools**: 5 tools for intelligent DOM analysis
- **Communication & Coordination**: 10 tools for agent collaboration
- **Documentation & Web Scraping**: 9 tools for intelligent documentation collection
- **Project Analysis & File Operations**: 7 tools for code analysis and file management
- **Knowledge Graph & Memory**: 4 tools for semantic knowledge management
- **Tree Summary System**: 5 tools for project structure caching
- **Progress Reporting**: 1 tool for progress tracking

**Total: 61 Professional MCP Tools**

## Usage Notes

### Legacy Tool Support
ZMCPTools maintains backward compatibility by keeping legacy browser tools available while recommending modern alternatives. Legacy tools are clearly marked with `[LEGACY]` in their descriptions.

### Foundation Session Optimization
Many orchestration tools support `foundation_session_id` parameters for 85-90% cost reduction through shared context management.

### Type Safety
All tools are built with TypeScript and Zod schemas for runtime validation, ensuring reliable operation and clear error messages.

### MCP Compliance
Every tool follows MCP 1.15.0 protocol standards with proper JSON-RPC 2.0 implementation, error handling, and schema validation.

---

*For detailed usage examples and implementation guides, see the main [README.md](./README.md) and tool-specific documentation.*