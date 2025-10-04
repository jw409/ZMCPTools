# ZMCPTools Agent Tool Reference

## Architecture Overview

ZMCPTools implements a **dual MCP server architecture** separating dom0 (orchestration) and domU (talent coordination) concerns:

- **Global MCP Server (dom0)**: Orchestration tools for the main Claude instance
- **Talent MCP Server (domU)**: Coordination tools for individual talent agents

This separation prevents namespace pollution and ensures talents only see relevant tools.

## Dom0 Tools (Global Orchestrator)

Available in the global ZMCPTools MCP server for the main Claude instance.

### Agent Orchestration
- `orchestrate_objective` - Multi-agent coordination with architect-led breakdown
- `spawn_agent` - Create specialized talent agents (backend, frontend, testing, etc.)
- `list_agents` - View active and completed agents
- `create_task` - Define coordination tasks with dependencies

### Knowledge Graph & Vector Search
- `search_knowledge_graph` - Semantic search across stored knowledge
- `store_knowledge_memory` - Store insights, patterns, and learnings
- `get_memory_status` - View knowledge graph statistics
- `scrape_documentation` - Index external docs with LanceDB vectors
- `search_documentation` - Semantic search of scraped docs

### Project Analysis
- `analyze_project_structure` - Generate .treesummary files
- `generate_project_summary` - AI-optimized codebase overview
- `list_files` - Smart file listing with ignore patterns
- `find_files` - Pattern-based file search

### File Operations
- `easy_replace` - Fuzzy string replacement in files
- `take_screenshot` - Cross-platform screenshot capture

### Agent Communication
- `join_room` - Join agent coordination rooms
- `send_message` - Send messages to room members
- `list_rooms` - View active coordination rooms

## DomU Tools (Talent Coordination)

Available **only** in talent-specific MCP servers via `zmcp-talent-server`. Each talent gets their own server instance.

### Email Coordination

**Purpose**: Filesystem-based pseudo-email for talent-to-talent communication using talent IDs (not real email addresses).

#### `send_email`
Send email to other talents.

**Input Schema**:
```json
{
  "to": ["backend-boris-001", "frontend-felix-001"],
  "cc": [],
  "subject": "API schema discussion",
  "body": "Message content here",
  "priority": "normal",
  "thread_id": null,
  "in_reply_to": null,
  "attachments": []
}
```

**Output**: `EmailSendResult` with success status and file path

**Storage**: `var/coordination/{recipient-id}/inbox/{timestamp}-{sender}-{subject}.email`

#### `check_inbox`
Check for new emails in talent's inbox.

**Input Schema**:
```json
{
  "talent_id": "backend-boris-001",
  "include_processed": false
}
```

**Output**: `InboxResult` with array of unread emails

**Note**: Missing inbox directory means no emails received (not an error)

#### `process_email`
Mark email as processed/read.

**Input Schema**:
```json
{
  "talent_id": "backend-boris-001",
  "email_file": "20250104-120000-frontend-felix-001-API-discussion.email"
}
```

**Output**: `EmailProcessingResult` with success status

**Action**: Moves email from `inbox/` to `processed/`

#### `get_email`
Read specific email content.

**Input Schema**:
```json
{
  "talent_id": "backend-boris-001",
  "email_file": "20250104-120000-frontend-felix-001-API-discussion.email"
}
```

**Output**: Full `EmailMessage` object

#### `ensure_coordination_directories`
Create coordination directories for a talent (thin provisioning).

**Input Schema**:
```json
{
  "talent_id": "backend-boris-001"
}
```

**Output**: Success status and created paths

**Note**: Called automatically by other tools when needed

### Meeting Simulation

**Purpose**: Simulated meeting coordination for talent collaboration.

#### `join_meeting`
Join or create a meeting.

**Input Schema**:
```json
{
  "meeting_id": "sprint-planning-2025-01-04",
  "talent_id": "backend-boris-001",
  "meeting_title": "Sprint Planning",
  "meeting_purpose": "Plan Q1 2025 sprint objectives"
}
```

**Output**: `JoinMeetingResult` with meeting status and attendees

**Storage**: `var/meetings/{date}/{meeting_id}.meeting`

**Behavior**: First attendee creates meeting and starts it

#### `speak_in_meeting`
Contribute to meeting discussion.

**Input Schema**:
```json
{
  "meeting_id": "sprint-planning-2025-01-04",
  "talent_id": "backend-boris-001",
  "message": "I propose we focus on API refactoring this sprint"
}
```

**Output**: `SpeakInMeetingResult` with success status

**Action**: Appends message to meeting minutes with timestamp

#### `leave_meeting`
Leave a meeting.

**Input Schema**:
```json
{
  "meeting_id": "sprint-planning-2025-01-04",
  "talent_id": "backend-boris-001"
}
```

**Output**: Success status

**Action**: Removes talent from attendees, ends meeting if last attendee leaves

#### `get_meeting_status`
Get current meeting state.

**Input Schema**:
```json
{
  "meeting_id": "sprint-planning-2025-01-04"
}
```

**Output**: Full `Meeting` object with attendees, minutes, decisions, action items

## Coordination Root Resolution

Talent servers use a 4-tier priority system to find the coordination root directory:

1. **CLI Argument**: `--coordination-root /path/to/root` (highest priority)
2. **Environment Variable**: `ZMCP_COORDINATION_ROOT=/path/to/root`
3. **Registry File**: `/tmp/zmcp-coordination-root.json` (cooperative registration)
4. **Current Working Directory**: Falls back to `process.cwd()` and creates registry

### Registry File Format

```json
{
  "coordination_root": "/home/jw/dev/game1/ZMCPTools",
  "created_by": "backend-boris-001",
  "created_at": "2025-01-04T02:05:49.592Z",
  "pid": 138478,
  "hostname": "aircooled3"
}
```

**Purpose**: Ensures talents started from different directories can communicate by agreeing on a single coordination root.

## Usage Examples

### Starting a Talent Server

```bash
# Stdio transport (default)
node dist/talent-server/index.js --talent-id backend-boris-001

# HTTP transport with specific port
node dist/talent-server/index.js \
  --talent-id frontend-felix-001 \
  --transport http \
  --port 4270

# With explicit coordination root
node dist/talent-server/index.js \
  --talent-id testing-tina-001 \
  --coordination-root /path/to/project
```

### Email Workflow

```javascript
// Talent 1: Send email
await send_email({
  to: ["backend-boris-001"],
  subject: "API Schema Review",
  body: "Please review the attached schema design",
  priority: "high"
});

// Talent 2: Check and read email
const inbox = await check_inbox({
  talent_id: "backend-boris-001"
});

const email = await get_email({
  talent_id: "backend-boris-001",
  email_file: inbox.emails[0].filename
});

// Talent 2: Mark as processed
await process_email({
  talent_id: "backend-boris-001",
  email_file: inbox.emails[0].filename
});
```

### Meeting Workflow

```javascript
// Multiple talents join meeting
await join_meeting({
  meeting_id: "architecture-review",
  talent_id: "backend-boris-001",
  meeting_title: "Architecture Review",
  meeting_purpose: "Review microservices architecture"
});

await join_meeting({
  meeting_id: "architecture-review",
  talent_id: "frontend-felix-001"
});

// Contribute to discussion
await speak_in_meeting({
  meeting_id: "architecture-review",
  talent_id: "backend-boris-001",
  message: "I recommend using event-driven architecture for service communication"
});

// Leave when done
await leave_meeting({
  meeting_id: "architecture-review",
  talent_id: "backend-boris-001"
});
```

## Best Practices

### Email System
- Use descriptive subjects for easy inbox scanning
- Use talent IDs only (e.g., "backend-boris-001"), never real email addresses
- Process emails after reading to keep inbox clean
- Missing inbox directory is normal (no emails received yet)

### Meetings
- Use date-based meeting IDs for organization (e.g., "sprint-planning-2025-01-04")
- Include meeting title and purpose for context
- Leave meetings when done to free up coordination resources
- Last talent leaving automatically ends the meeting

### Coordination Root
- Set `ZMCP_COORDINATION_ROOT` when running talents from different directories
- First talent to start creates the registry - others should use it
- Check `/tmp/zmcp-coordination-root.json` if talents can't communicate

### Thin Provisioning
- Directories created on-demand, not pre-created
- "No such directory" errors handled gracefully
- Tools automatically create necessary structure

## File Structure

```
var/
├── coordination/           # Email coordination
│   └── {talent-id}/
│       ├── inbox/          # Unread emails
│       └── processed/      # Read emails
└── meetings/              # Meeting records
    └── {date}/            # e.g., 2025-01-04/
        └── {meeting-id}.meeting
```

## Related Documentation

- Issues #28 (Email System) and #29 (Meeting Simulation)
- `src/talent-server/TalentMcpServer.ts` - Server implementation
- `src/services/TalentEmailService.ts` - Email service logic
- `src/services/TalentMeetingService.ts` - Meeting service logic
