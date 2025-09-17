import type { MonitorData } from './MonitorService.js';

export interface HtmlOptions {
  refreshInterval?: number;
  title?: string;
  theme?: 'light' | 'dark';
}

export class MonitorFormatter {

  async formatTerminal(data: MonitorData): Promise<string> {
    const lines: string[] = [];

    // Header with emoji and colors
    lines.push('🔍 \x1b[96mZMCP Agent Monitor\x1b[0m');
    lines.push('─'.repeat(64));
    lines.push('');

    // System Overview
    lines.push('📊 \x1b[96mSystem Overview\x1b[0m');
    const overview = data.systemOverview;
    lines.push(`   Agents: \x1b[92m${overview.activeAgents}\x1b[0m/\x1b[90m${overview.totalAgents}\x1b[0m active`);
    lines.push(`   Tasks: \x1b[92m${overview.activeTasks}\x1b[0m/\x1b[90m${overview.totalTasks}\x1b[0m active, \x1b[93m${overview.pendingTasks}\x1b[0m pending`);
    lines.push(`   Rooms: \x1b[92m${overview.activeRooms}\x1b[0m/\x1b[90m${overview.totalRooms}\x1b[0m active`);
    lines.push('');

    // Agents Section
    if (data.agents.length > 0) {
      lines.push('🤖 \x1b[96mAgents\x1b[0m');
      lines.push('');

      for (const agent of data.agents) {
        const statusIcon = this.getStatusIcon(agent.status);
        const statusColor = this.getStatusColor(agent.status);
        const healthIcon = this.getHealthIcon(agent.health);
        const pidStatus = agent.pid ? `\x1b[92m${agent.pid} ✓\x1b[0m` : '\x1b[91mNot running ✗\x1b[0m';

        lines.push(`   \x1b[1m${agent.name}\x1b[0m (\x1b[90m${agent.id}\x1b[0m) [\x1b[90m${agent.processTitle}\x1b[0m]`);
        lines.push(`   Status: ${statusColor}${agent.status} ${statusIcon}\x1b[0m | PID: ${pidStatus}`);

        if (agent.roomId) {
          lines.push(`   Room: \x1b[94m${agent.roomId}\x1b[0m`);
        }

        lines.push(`   Last: "\x1b[93m${agent.lastActivity}\x1b[0m"`);
        lines.push(`   Health: ${healthIcon} \x1b[1m${agent.health}%\x1b[0m | Restarts: \x1b[93m${agent.performance.restarts}\x1b[0m | Uptime: \x1b[92m${agent.uptime}\x1b[0m`);
        lines.push('');
      }
    }

    // Process Information
    if (data.processes.length > 0) {
      lines.push('⚙️  \x1b[96mRunning Processes\x1b[0m');
      lines.push('');

      for (const process of data.processes) {
        lines.push(`   \x1b[1m${process.agentType}\x1b[0m (\x1b[90mPID: ${process.pid}\x1b[0m)`);
        lines.push(`   Title: \x1b[90m${process.title}\x1b[0m`);
        lines.push(`   Resources: CPU \x1b[93m${process.cpu}\x1b[0m | Memory \x1b[92m${process.memory}\x1b[0m | Started: \x1b[90m${process.startTime}\x1b[0m`);
        lines.push('');
      }
    }

    // Rooms Information
    if (data.rooms.length > 0) {
      lines.push('💬 \x1b[96mActive Rooms\x1b[0m');
      lines.push('');

      for (const room of data.rooms) {
        lines.push(`   \x1b[1m${room.name}\x1b[0m`);
        lines.push(`   Members: \x1b[92m${room.members}\x1b[0m | Messages: \x1b[93m${room.messageCount}\x1b[0m`);
        if (room.lastMessage) {
          lines.push(`   Last: "\x1b[90m${room.lastMessage}\x1b[0m"`);
        }
        lines.push('');
      }
    }

    // Errors Section
    if (data.errors.length > 0) {
      lines.push('❌ \x1b[91mErrors\x1b[0m');
      lines.push('');
      for (const error of data.errors) {
        lines.push(`   \x1b[91m${error}\x1b[0m`);
      }
      lines.push('');
    }

    // Footer
    lines.push(`\x1b[90mLast updated: ${new Date(data.timestamp).toLocaleString()}\x1b[0m`);

    return lines.join('\n');
  }

  async formatHtml(data: MonitorData, options: HtmlOptions = {}): Promise<string> {
    const title = options.title || 'ZMCP Agent Monitor';
    const theme = options.theme || 'light';
    const refreshInterval = options.refreshInterval || 0;

    const refreshMeta = refreshInterval > 0
      ? `<meta http-equiv="refresh" content="${refreshInterval / 1000}">`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${refreshMeta}
    <style>
        ${this.getHtmlStyles(theme)}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🔍 ${title}</h1>
            <div class="timestamp">Last updated: ${new Date(data.timestamp).toLocaleString()}</div>
        </header>

        ${this.renderSystemOverview(data.systemOverview)}
        ${this.renderAgents(data.agents)}
        ${this.renderProcesses(data.processes)}
        ${this.renderRooms(data.rooms)}
        ${this.renderErrors(data.errors)}
    </div>

    ${refreshInterval > 0 ? `
    <script>
        // Add visual refresh indicator
        let countdown = ${refreshInterval / 1000};
        const indicator = document.createElement('div');
        indicator.className = 'refresh-indicator';
        indicator.innerHTML = 'Refreshing in <span id="countdown">' + countdown + '</span>s';
        document.body.appendChild(indicator);

        const timer = setInterval(() => {
            countdown--;
            document.getElementById('countdown').textContent = countdown;
            if (countdown <= 0) {
                clearInterval(timer);
            }
        }, 1000);
    </script>
    ` : ''}
</body>
</html>`;
  }

  async formatJson(data: MonitorData): Promise<string> {
    return JSON.stringify(data, null, 2);
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'active': return '✓';
      case 'idle': return '○';
      case 'failed': return '✗';
      case 'terminated': return '◯';
      default: return '?';
    }
  }

  private getStatusColor(status: string): string {
    switch (status) {
      case 'active': return '\x1b[92m'; // Green
      case 'idle': return '\x1b[93m';   // Yellow
      case 'failed': return '\x1b[91m'; // Red
      case 'terminated': return '\x1b[90m'; // Gray
      default: return '\x1b[0m';
    }
  }

  private getHealthIcon(health: number): string {
    if (health >= 90) return '💚';
    if (health >= 70) return '💛';
    if (health >= 50) return '🧡';
    return '❤️';
  }

  private getHtmlStyles(theme: 'light' | 'dark'): string {
    const isDark = theme === 'dark';

    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
            line-height: 1.6;
            background: ${isDark ? '#1a1a1a' : '#f5f5f5'};
            color: ${isDark ? '#e0e0e0' : '#333'};
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: ${isDark ? '#2d2d2d' : '#fff'};
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }

        header {
            background: ${isDark ? '#3a3a3a' : '#f8f9fa'};
            padding: 20px;
            border-bottom: 1px solid ${isDark ? '#555' : '#dee2e6'};
        }

        h1 {
            font-size: 1.8rem;
            margin-bottom: 5px;
            color: ${isDark ? '#4a9eff' : '#0066cc'};
        }

        .timestamp {
            color: ${isDark ? '#999' : '#666'};
            font-size: 0.9rem;
        }

        .section {
            padding: 20px;
            border-bottom: 1px solid ${isDark ? '#444' : '#eee'};
        }

        .section:last-child {
            border-bottom: none;
        }

        .section-title {
            font-size: 1.3rem;
            margin-bottom: 15px;
            color: ${isDark ? '#4a9eff' : '#0066cc'};
            font-weight: bold;
        }

        .overview-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }

        .metric-card {
            background: ${isDark ? '#3a3a3a' : '#f8f9fa'};
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid ${isDark ? '#4a9eff' : '#0066cc'};
        }

        .metric-label {
            font-size: 0.9rem;
            color: ${isDark ? '#ccc' : '#666'};
            margin-bottom: 5px;
        }

        .metric-value {
            font-size: 1.4rem;
            font-weight: bold;
            color: ${isDark ? '#4a9eff' : '#0066cc'};
        }

        .agent-card, .process-card, .room-card {
            background: ${isDark ? '#3a3a3a' : '#f8f9fa'};
            border: 1px solid ${isDark ? '#555' : '#dee2e6'};
            border-radius: 6px;
            padding: 15px;
            margin-bottom: 15px;
        }

        .agent-name {
            font-size: 1.1rem;
            font-weight: bold;
            margin-bottom: 8px;
            color: ${isDark ? '#e0e0e0' : '#333'};
        }

        .agent-id {
            color: ${isDark ? '#999' : '#666'};
            font-size: 0.9rem;
        }

        .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: bold;
            margin-right: 10px;
        }

        .status-active {
            background: #d4edda;
            color: #155724;
        }

        .status-idle {
            background: #fff3cd;
            color: #856404;
        }

        .status-failed {
            background: #f8d7da;
            color: #721c24;
        }

        .status-terminated {
            background: ${isDark ? '#555' : '#e2e3e5'};
            color: ${isDark ? '#ccc' : '#6c757d'};
        }

        .health-bar {
            width: 100%;
            height: 8px;
            background: ${isDark ? '#555' : '#e9ecef'};
            border-radius: 4px;
            overflow: hidden;
            margin: 5px 0;
        }

        .health-fill {
            height: 100%;
            border-radius: 4px;
            transition: width 0.3s ease;
        }

        .health-excellent { background: #28a745; }
        .health-good { background: #ffc107; }
        .health-warning { background: #fd7e14; }
        .health-critical { background: #dc3545; }

        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
            margin-top: 10px;
        }

        .info-item {
            font-size: 0.9rem;
        }

        .info-label {
            color: ${isDark ? '#ccc' : '#666'};
            font-weight: 500;
        }

        .info-value {
            color: ${isDark ? '#e0e0e0' : '#333'};
            margin-left: 5px;
        }

        .error-list {
            list-style: none;
        }

        .error-item {
            background: #f8d7da;
            color: #721c24;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 8px;
            border-left: 4px solid #dc3545;
        }

        .no-data {
            text-align: center;
            color: ${isDark ? '#999' : '#666'};
            font-style: italic;
            padding: 20px;
        }

        .refresh-indicator {
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${isDark ? '#4a9eff' : '#0066cc'};
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 0.9rem;
            z-index: 1000;
        }

        @media (max-width: 768px) {
            .container {
                margin: 10px;
            }

            .overview-grid {
                grid-template-columns: 1fr;
            }

            .info-grid {
                grid-template-columns: 1fr;
            }
        }
    `;
  }

  private renderSystemOverview(overview: MonitorData['systemOverview']): string {
    return `
        <div class="section">
            <div class="section-title">📊 System Overview</div>
            <div class="overview-grid">
                <div class="metric-card">
                    <div class="metric-label">Total Agents</div>
                    <div class="metric-value">${overview.totalAgents}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Active Agents</div>
                    <div class="metric-value">${overview.activeAgents}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Total Tasks</div>
                    <div class="metric-value">${overview.totalTasks}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Active Tasks</div>
                    <div class="metric-value">${overview.activeTasks}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Active Rooms</div>
                    <div class="metric-value">${overview.activeRooms}</div>
                </div>
            </div>
        </div>
    `;
  }

  private renderAgents(agents: MonitorData['agents']): string {
    if (agents.length === 0) {
      return `
          <div class="section">
              <div class="section-title">🤖 Agents</div>
              <div class="no-data">No agents found</div>
          </div>
      `;
    }

    const agentCards = agents.map(agent => {
      const healthClass = this.getHealthClass(agent.health);
      const statusClass = `status-${agent.status}`;

      return `
          <div class="agent-card">
              <div class="agent-name">
                  ${agent.name}
                  <span class="agent-id">(${agent.id})</span>
              </div>
              <div style="margin-bottom: 10px;">
                  <span class="status-badge ${statusClass}">${agent.status}</span>
                  <span class="info-value">PID: ${agent.pid || 'Not running'}</span>
              </div>
              <div class="health-bar">
                  <div class="health-fill ${healthClass}" style="width: ${agent.health}%"></div>
              </div>
              <div class="info-grid">
                  <div class="info-item">
                      <span class="info-label">Type:</span>
                      <span class="info-value">${agent.type}</span>
                  </div>
                  <div class="info-item">
                      <span class="info-label">Health:</span>
                      <span class="info-value">${agent.health}%</span>
                  </div>
                  <div class="info-item">
                      <span class="info-label">Uptime:</span>
                      <span class="info-value">${agent.uptime}</span>
                  </div>
                  <div class="info-item">
                      <span class="info-label">Restarts:</span>
                      <span class="info-value">${agent.performance.restarts}</span>
                  </div>
                  ${agent.roomId ? `
                  <div class="info-item">
                      <span class="info-label">Room:</span>
                      <span class="info-value">${agent.roomId}</span>
                  </div>
                  ` : ''}
              </div>
              <div style="margin-top: 10px; font-size: 0.9rem; color: #666;">
                  Process: <code>${agent.processTitle}</code>
              </div>
          </div>
      `;
    }).join('');

    return `
        <div class="section">
            <div class="section-title">🤖 Agents</div>
            ${agentCards}
        </div>
    `;
  }

  private renderProcesses(processes: MonitorData['processes']): string {
    if (processes.length === 0) {
      return `
          <div class="section">
              <div class="section-title">⚙️ Running Processes</div>
              <div class="no-data">No ZMCP processes found</div>
          </div>
      `;
    }

    const processCards = processes.map(process => `
        <div class="process-card">
            <div class="agent-name">${process.agentType} (PID: ${process.pid})</div>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">CPU:</span>
                    <span class="info-value">${process.cpu}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Memory:</span>
                    <span class="info-value">${process.memory}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Started:</span>
                    <span class="info-value">${process.startTime}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Project:</span>
                    <span class="info-value">${process.projectContext}</span>
                </div>
            </div>
            <div style="margin-top: 10px; font-size: 0.9rem; color: #666;">
                Command: <code>${process.title}</code>
            </div>
        </div>
    `).join('');

    return `
        <div class="section">
            <div class="section-title">⚙️ Running Processes</div>
            ${processCards}
        </div>
    `;
  }

  private renderRooms(rooms: MonitorData['rooms']): string {
    if (rooms.length === 0) {
      return `
          <div class="section">
              <div class="section-title">💬 Active Rooms</div>
              <div class="no-data">No active rooms found</div>
          </div>
      `;
    }

    const roomCards = rooms.map(room => `
        <div class="room-card">
            <div class="agent-name">${room.name}</div>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Members:</span>
                    <span class="info-value">${room.members}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Messages:</span>
                    <span class="info-value">${room.messageCount}</span>
                </div>
            </div>
            ${room.lastMessage ? `
            <div style="margin-top: 10px; font-size: 0.9rem; color: #666;">
                Last message: "${room.lastMessage}"
            </div>
            ` : ''}
        </div>
    `).join('');

    return `
        <div class="section">
            <div class="section-title">💬 Active Rooms</div>
            ${roomCards}
        </div>
    `;
  }

  private renderErrors(errors: string[]): string {
    if (errors.length === 0) {
      return '';
    }

    const errorItems = errors.map(error => `
        <li class="error-item">${error}</li>
    `).join('');

    return `
        <div class="section">
            <div class="section-title">❌ Errors</div>
            <ul class="error-list">
                ${errorItems}
            </ul>
        </div>
    `;
  }

  private getHealthClass(health: number): string {
    if (health >= 90) return 'health-excellent';
    if (health >= 70) return 'health-good';
    if (health >= 50) return 'health-warning';
    return 'health-critical';
  }
}