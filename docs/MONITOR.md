# ZMCP Agent Monitor

The ZMCP Agent Monitor provides comprehensive real-time monitoring and management of ZMCP agents with process naming, health scoring, and multiple output formats.

## 🎯 Features

### Process Title Naming System
- **Descriptive Names**: All ZMCP agents appear with clear titles in `ps` output
- **Pattern**: `zmcp-<type>-<project>-<id>` (e.g., `zmcp-be-oauth-impl-a3f2e1`)
- **Easy Identification**: `ps aux | grep zmcp-` shows all running agents
- **Type Abbreviations**: `be`=backend, `fe`=frontend, `ts`=testing, `dc`=documentation, etc.

### Enhanced Agent Wrapper
- **Supervisor Process**: Wrapper stays alive as parent with custom process title
- **Crash Detection**: Automatic crash detection and recovery with configurable restart policies
- **Rate Limit Handling**: Exponential backoff for Claude Pro/Max 5-hour windows
- **Database Integration**: Tracks clean vs crashed exits in agent metrics
- **Signal Proxying**: Proper cleanup and graceful shutdown

### Comprehensive Monitor Tool
- **CLI Mode**: Beautiful terminal output with color-coded agent status
- **HTML Mode**: Generate static HTML dashboards or live web interface
- **JSON Mode**: Structured data for integration with other tools
- **Watch Mode**: Live updates with optional HTTP server for browser monitoring
- **Agent Details**: Shows status, tasks, rooms, and real-time activity

## 🚀 Quick Start

### Basic Monitoring
```bash
# View current agent status
zmcp-tools monitor

# Monitor with live updates
zmcp-tools monitor --watch

# Generate HTML report
zmcp-tools monitor -o html --output-file dashboard.html

# Start live web dashboard
zmcp-tools monitor --watch -o html -p 8080
```

### Process Management
```bash
# See all ZMCP agents
ps aux | grep zmcp-

# Monitor specific agent
zmcp-tools monitor -a agent_12345

# Kill all testing agents (example)
pkill -f "zmcp-ts-"
```

## 📊 Monitor Output Formats

### Terminal Mode (Default)
```
🔍 ZMCP Agent Monitor
────────────────────────────────────────────────────
📊 System Overview
   Agents: 3/5 active
   Tasks: 2/4 active, 2 pending
   Rooms: 5/5 active

🤖 Agents
   backend (agent_17) [zmcp-be-oauth-impl-a3f2e1]
   Status: active ✓ | PID: 12345 ✓
   Room: room-oauth-implementation
   Last: "Implementing JWT token validation..."
   Health: 💚 95% | Restarts: 0 | Uptime: 2h 15m
```

### HTML Mode
- Responsive web interface with dark/light theme support
- Real-time refresh capabilities
- Mobile-friendly design
- Color-coded health indicators
- Interactive agent cards with detailed metrics

### JSON Mode
```json
{
  "timestamp": "2024-01-01T12:00:00Z",
  "systemOverview": {
    "totalAgents": 3,
    "activeAgents": 2,
    "totalTasks": 5,
    "activeTasks": 3
  },
  "agents": [
    {
      "id": "agent_17",
      "name": "Backend Agent",
      "type": "backend",
      "status": "active",
      "health": 95,
      "performance": {
        "cpu": "2.5%",
        "memory": "50MB",
        "restarts": 0,
        "crashes": 0
      }
    }
  ]
}
```

## ⚙️ Configuration

### Monitor Options
```bash
zmcp-tools monitor [options]

Options:
  -o, --output <format>     Output format: terminal, html, json (default: terminal)
  -w, --watch              Enable watch mode with live updates
  -p, --port <port>        HTTP server port for watch mode (default: 8080)
  -r, --repository <path>   Repository path (default: current directory)
  -a, --agent <id>         Monitor specific agent ID
  --interval <ms>          Update interval in milliseconds (default: 2000)
  --output-file <path>     Save HTML/JSON output to file
  -d, --data-dir <path>    Data directory for database
```

### Process Wrapper Configuration
The agent wrapper supports configuration via environment variables:

```bash
# Rate limiting (for Claude Pro/Max users)
export ZMCP_RATE_LIMIT_WINDOW=18000000  # 5 hours in ms
export ZMCP_RATE_LIMIT_COOLDOWN=30000   # 30 seconds

# Restart behavior
export ZMCP_MAX_RESTARTS=5
export ZMCP_RESTART_DELAY=1000          # 1 second initial delay
export ZMCP_MAX_RESTART_DELAY=60000     # 1 minute max delay

# Logging
export ZMCP_VERBOSE=true
```

## 🏥 Health Scoring System

### Health Score Calculation
- **Base Score**: 100 points
- **Crash Penalty**: -10 points per crash (max -50)
- **Restart Penalty**: -5 points per restart (max -30)
- **Error Penalty**: -2 points per error (max -20)
- **Process Bonus**: +0 if running, -20 if not running
- **Activity Bonus**: +5 for recent activity (<5 minutes)

### Health Indicators
- 💚 **90-100%**: Excellent health
- 💛 **70-89%**: Good health
- 🧡 **50-69%**: Warning - needs attention
- ❤️ **0-49%**: Critical - immediate action required

## 📈 Performance Metrics

### Tracked Metrics
- **Uptime**: Total time agent has been running
- **Task Completion**: Success/failure rates
- **Resource Usage**: CPU and memory consumption
- **Communication**: Message counts and room activity
- **Errors**: Error patterns and recovery success

### Database Schema
The monitor uses enhanced database tables for tracking:
- `agent_metrics`: Performance and health metrics
- `agent_process_snapshots`: Process state over time
- `agent_health_checks`: Health check results and trends

## 🎮 Usage Examples

### Development Workflow
```bash
# Start development with monitoring
zmcp-tools monitor --watch &

# Spawn agents for a feature
zmcp-tools agent spawn -t backend -d "Implement user authentication"
zmcp-tools agent spawn -t frontend -d "Create login UI"
zmcp-tools agent spawn -t testing -d "Test auth flow"

# Monitor progress in real-time
# (monitor updates automatically show new agents)

# Generate final report
zmcp-tools monitor -o html --output-file final-report.html
```

### Debugging Issues
```bash
# Check for failed agents
zmcp-tools monitor | grep "❌"

# View detailed JSON for analysis
zmcp-tools monitor -o json > debug.json

# Monitor specific problematic agent
zmcp-tools monitor -a agent_12345 --watch

# Check process status directly
ps aux | grep zmcp-
```

### CI/CD Integration
```bash
# Generate JSON for build systems
zmcp-tools monitor -o json > agent-status.json

# Check if all agents healthy
if zmcp-tools monitor -o json | jq '.agents[] | select(.health < 70)' | grep -q .; then
  echo "Unhealthy agents detected"
  exit 1
fi
```

## 🔧 Troubleshooting

### Common Issues

#### No ZMCP Processes Found
- Ensure agents are running with the wrapper
- Check if `agentType` is specified when spawning agents
- Verify wrapper path exists: `ZMCPTools/dist/zmcp-agent-wrapper.cjs`

#### Monitor Command Not Found
```bash
# Build ZMCPTools first
cd ZMCPTools
npm run build

# Test monitor command
node dist/cli/index.js monitor --help
```

#### Health Scores Too Low
- Check agent error logs in database
- Look for high restart/crash counts
- Verify resource usage isn't excessive
- Check for rate limiting issues

#### Watch Mode Not Updating
- Verify update interval setting (`--interval`)
- Check for JavaScript errors in browser console (HTML mode)
- Ensure database connectivity

### Debug Commands
```bash
# Test monitor functionality
./tests/test-monitor.sh

# Check database tables
sqlite3 ~/.mcptools/data/claude_mcp_tools.db ".tables"

# View agent metrics
sqlite3 ~/.mcptools/data/claude_mcp_tools.db "SELECT * FROM agent_metrics LIMIT 5;"

# Check process wrapper logs
journalctl -f | grep zmcp
```

## 🚀 Advanced Features

### Custom Health Checks
Extend the health checking system:
```typescript
// Custom health check implementation
const healthCheck = {
  processAlive: await checkProcessExists(agent.pid),
  roomConnected: await checkRoomConnection(agent.roomId),
  recentActivity: await checkRecentActivity(agent.id, 300000) // 5 minutes
};
```

### Process Naming Patterns
Customize process naming for different projects:
```typescript
// In wrapper configuration
const processTitle = `zmcp-${typeAbbr}-${projectContext}-${agentId}`;

// Type abbreviations mapping
const typeMap = {
  'backend': 'be',
  'frontend': 'fe',
  'testing': 'ts',
  'documentation': 'dc',
  'architect': 'ar',
  'devops': 'dv'
};
```

### HTML Dashboard Themes
The HTML output supports both light and dark themes:
```bash
# Light theme (default)
zmcp-tools monitor -o html

# Dark theme can be enabled by modifying the formatter
# theme: 'dark' in formatHtml options
```

## 📚 API Reference

### MonitorService Class
```typescript
class MonitorService {
  constructor(databasePath: string)

  async start(config: MonitorConfig): Promise<void>
  stop(): void

  private async collectMonitorData(config: MonitorConfig): Promise<MonitorData>
  private async getZmcpProcesses(): Promise<AgentProcess[]>
}
```

### MonitorFormatter Class
```typescript
class MonitorFormatter {
  async formatTerminal(data: MonitorData): Promise<string>
  async formatHtml(data: MonitorData, options?: HtmlOptions): Promise<string>
  async formatJson(data: MonitorData): Promise<string>
}
```

### Configuration Types
```typescript
interface MonitorConfig {
  outputFormat: 'terminal' | 'html' | 'json';
  watchMode: boolean;
  port?: number;
  repositoryPath: string;
  agentId?: string;
  updateInterval: number;
  outputFile?: string;
}
```

## 🎯 Best Practices

1. **Regular Monitoring**: Use watch mode during active development
2. **Health Tracking**: Monitor health scores and address issues promptly
3. **Resource Management**: Watch CPU/memory usage trends
4. **Error Analysis**: Review error patterns for system improvements
5. **Documentation**: Generate HTML reports for stakeholder updates
6. **Automation**: Integrate JSON output with CI/CD pipelines
7. **Process Hygiene**: Regularly clean up terminated agents

## 📖 Related Documentation

- [Agent Orchestration Guide](./ORCHESTRATION.md)
- [Process Management](./PROCESS_MANAGEMENT.md)
- [Database Schema Reference](./DATABASE.md)
- [CLI Reference](./CLI.md)
- [ZMCPTools Integration](../CLAUDE.md)