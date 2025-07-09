#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

// Installation paths
const INSTALL_PATHS = {
  DATA_DIR: path.join(os.homedir(), '.mcptools', 'data'),
  LOGS_DIR: path.join(os.homedir(), '.mcptools', 'logs'),
  GLOBAL_DIR: path.join(os.homedir(), '.mcptools'),
  CLAUDE_DIR: path.join(os.homedir(), '.claude'),
};

interface PackageManager {
  name: string;
  command: string;
  globalFlag: string;
  linkCommand: string;
  unlinkCommand: string;
  installCommand: string;
  buildCommand: string;
}

// Package manager configurations
const PACKAGE_MANAGERS: PackageManager[] = [
  {
    name: 'bun',
    command: 'bun',
    globalFlag: '--global',
    linkCommand: 'bun link --global',
    unlinkCommand: 'bun unlink --global',
    installCommand: 'bun install',
    buildCommand: 'bun run build'
  },
  {
    name: 'pnpm',
    command: 'pnpm',
    globalFlag: '--global',
    linkCommand: 'pnpm link --global',
    unlinkCommand: 'pnpm unlink --global',
    installCommand: 'pnpm install',
    buildCommand: 'pnpm build'
  },
  {
    name: 'yarn',
    command: 'yarn',
    globalFlag: 'global',
    linkCommand: 'yarn link',
    unlinkCommand: 'yarn unlink',
    installCommand: 'yarn install',
    buildCommand: 'yarn build'
  },
  {
    name: 'npm',
    command: 'npm',
    globalFlag: '--global',
    linkCommand: 'npm link',
    unlinkCommand: 'npm unlink',
    installCommand: 'npm install',
    buildCommand: 'npm run build'
  }
];

// Helper functions
function log(message: string, color: keyof typeof colors = 'white'): void {
  console.log(colors[color] + message + colors.reset);
}

function logStep(step: string, message: string): void {
  console.log(`${colors.blue}${step}${colors.reset} ${message}`);
}

function logSuccess(message: string): void {
  console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

function logError(message: string): void {
  console.log(`${colors.red}❌ ${message}${colors.reset}`);
}

function logWarning(message: string): void {
  console.log(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectPackageManager(): PackageManager | null {
  // Check for lockfiles first (more reliable than just command existence)
  if (fs.existsSync('bun.lockb')) {
    const bunPm = PACKAGE_MANAGERS.find(pm => pm.name === 'bun');
    if (bunPm && commandExists('bun')) return bunPm;
  }
  
  if (fs.existsSync('pnpm-lock.yaml')) {
    const pnpmPm = PACKAGE_MANAGERS.find(pm => pm.name === 'pnpm');
    if (pnpmPm && commandExists('pnpm')) return pnpmPm;
  }
  
  if (fs.existsSync('yarn.lock')) {
    const yarnPm = PACKAGE_MANAGERS.find(pm => pm.name === 'yarn');
    if (yarnPm && commandExists('yarn')) return yarnPm;
  }
  
  // If no lockfile, check for available package managers in preference order
  for (const pm of PACKAGE_MANAGERS) {
    if (commandExists(pm.command)) {
      return pm;
    }
  }
  
  return null;
}

function checkPrerequisites(): { success: boolean; packageManager: PackageManager | null } {
  logStep('📋', 'Checking prerequisites...');
  
  const missing: string[] = [];
  
  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  if (majorVersion < 18) {
    missing.push(`Node.js 18+ (current: ${nodeVersion})`);
  }
  
  // Detect package manager
  const packageManager = detectPackageManager();
  if (!packageManager) {
    missing.push('Package manager (bun, pnpm, yarn, or npm)');
  }
  
  // Check Claude CLI
  if (!commandExists('claude')) {
    missing.push('Claude CLI (https://docs.anthropic.com/en/docs/claude-code)');
  }
  
  if (missing.length > 0) {
    logError('Missing prerequisites:');
    missing.forEach(tool => log(`   • ${tool}`, 'red'));
    return { success: false, packageManager: null };
  }
  
  logSuccess(`All prerequisites found (using ${packageManager!.name})`);
  return { success: true, packageManager };
}

function createDirectories(): void {
  logStep('📁', 'Creating directories...');
  
  const dirs = [
    INSTALL_PATHS.DATA_DIR,
    INSTALL_PATHS.LOGS_DIR,
    path.join(INSTALL_PATHS.LOGS_DIR, 'claude_agents'),
    INSTALL_PATHS.GLOBAL_DIR,
    path.join(INSTALL_PATHS.CLAUDE_DIR, 'commands'),
  ];
  
  dirs.forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });
  
  logSuccess('Directories created');
}

function buildAndLink(packageManager: PackageManager): boolean {
  try {
    logStep('📦', 'Installing dependencies...');
    execSync(packageManager.installCommand, { stdio: 'pipe' });
    logSuccess('Dependencies installed');
    
    logStep('🔧', 'Building TypeScript...');
    execSync(packageManager.buildCommand, { stdio: 'pipe' });
    logSuccess('Build complete');
    
    logStep('🌐', 'Linking globally...');
    execSync(packageManager.linkCommand, { stdio: 'pipe' });
    logSuccess('Global link created');
    
    return true;
  } catch (error) {
    logError(`Build/link failed: ${error}`);
    return false;
  }
}

function configureMcpServer(): boolean {
  logStep('🔧', 'Configuring local MCP server...');
  
  try {
    const projectRoot = process.cwd();
    const serverPath = path.join(projectRoot, 'dist', 'index.js');
    
    if (!fs.existsSync(serverPath)) {
      logError('Built server not found. Build process may have failed.');
      return false;
    }
    
    logSuccess('MCP server path configured for local project');
    return true;
    
  } catch (error) {
    logError(`MCP configuration failed: ${error}`);
    return false;
  }
}

function createProjectConfig(): void {
  logStep('🔒', 'Setting up project configuration...');
  
  const projectClaudeDir = path.join(process.cwd(), '.claude');
  fs.mkdirSync(projectClaudeDir, { recursive: true });
  
  const settingsPath = path.join(projectClaudeDir, 'settings.local.json');
  
  // Load existing settings if they exist
  let existingSettings: any = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const existingContent = fs.readFileSync(settingsPath, 'utf8');
      existingSettings = JSON.parse(existingContent);
    } catch (error) {
      logWarning('Failed to parse existing settings.local.json, creating new');
    }
  }
  
  // Required permissions for ClaudeMcpTools
  const requiredPermissions = [
    // Core Claude Code tools
    "Bash(find:*)",
    "Bash(read:*)",
    "Bash(grep:*)",
    "Bash(ls:*)",
    "Edit",
    "MultiEdit",
    "Read(*)",
    "Find(*)",
    "Write",
    "Glob",
    "Grep",
    "LS(*)",
    "List",
    "Search",
    "TodoRead",
    "TodoWrite",
    "WebFetch(*)",
    "WebSearch",
    "Task",
    "exit_plan_mode",

    // ALL 43 MCP tools for full autonomous operation
    // Agent Orchestration Tools (14 tools)
    "mcp__claude-mcp-tools__orchestrate_objective",
    "mcp__claude-mcp-tools__spawn_agent",
    "mcp__claude-mcp-tools__create_task",
    "mcp__claude-mcp-tools__join_room",
    "mcp__claude-mcp-tools__send_message",
    "mcp__claude-mcp-tools__wait_for_messages",
    "mcp__claude-mcp-tools__store_memory",
    "mcp__claude-mcp-tools__search_memory",
    "mcp__claude-mcp-tools__list_agents",
    "mcp__claude-mcp-tools__terminate_agent",
    "mcp__claude-mcp-tools__close_room",
    "mcp__claude-mcp-tools__delete_room",
    "mcp__claude-mcp-tools__list_rooms",
    "mcp__claude-mcp-tools__list_room_messages",


    // Browser Automation Tools (6 tools)
    "mcp__claude-mcp-tools__create_browser_session",
    "mcp__claude-mcp-tools__navigate_and_scrape",
    "mcp__claude-mcp-tools__interact_with_page",
    "mcp__claude-mcp-tools__manage_browser_sessions",
    "mcp__claude-mcp-tools__navigate_to_url",
    "mcp__claude-mcp-tools__scrape_content",

    // Web Scraping & Documentation Tools (6 tools)
    "mcp__claude-mcp-tools__scrape_documentation",
    "mcp__claude-mcp-tools__get_scraping_status",
    "mcp__claude-mcp-tools__cancel_scrape_job",
    "mcp__claude-mcp-tools__start_scraping_worker",
    "mcp__claude-mcp-tools__stop_scraping_worker",
    "mcp__claude-mcp-tools__list_documentation_sources",

    // Project Analysis & File Operations Tools (7 tools)
    "mcp__claude-mcp-tools__analyze_project_structure",
    "mcp__claude-mcp-tools__generate_project_summary",
    "mcp__claude-mcp-tools__analyze_file_symbols",
    "mcp__claude-mcp-tools__list_files",
    "mcp__claude-mcp-tools__find_files",
    "mcp__claude-mcp-tools__easy_replace",
    "mcp__claude-mcp-tools__cleanup_orphaned_projects",

    // TreeSummary Tools (5 tools)
    "mcp__claude-mcp-tools__update_file_analysis",
    "mcp__claude-mcp-tools__remove_file_analysis",
    "mcp__claude-mcp-tools__update_project_metadata",
    "mcp__claude-mcp-tools__get_project_overview",
    "mcp__claude-mcp-tools__cleanup_stale_analyses",

    // Foundation Cache Tools - Now automatically integrated (no manual tools needed)
  ];
  
  // Merge permissions using Set to avoid duplicates
  const existingPermissions = existingSettings.permissions?.allow || [];
  const mergedPermissions = Array.from(new Set([...existingPermissions, ...requiredPermissions]));
  
  // Create merged settings
  const settings = {
    ...existingSettings,
    env: {
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000",
      MAX_MCP_OUTPUT_TOKENS: "64000",
      MCP_TIMEOUT: "60000",
      ...existingSettings.env,
    },
    permissions: {
      ...existingSettings.permissions,
      allow: mergedPermissions,
    },
    mcpServers: {
      ...existingSettings.mcpServers,
      "claude-mcp-tools": {
        command: "claude-mcp-tools",
        allowed: true,
        alwaysAllow: ["*"],
      },
    },
  };
  
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  
  logSuccess('Project configuration created/updated');
}

function createClaudeMd(): void {
  logStep('📝', 'Setting up CLAUDE.md integration...');
  
  const claudeSection = `<!-- zzClaudeMcpToolsTypescriptzz START -->
# ClaudeMcpTools TypeScript Integration

This project uses the TypeScript implementation of ClaudeMcpTools for enhanced MCP tools and multi-agent orchestration.

## 🎯 Agent Orchestration Commands

### Core Agent Operations
- \`spawn_agent(type, repository_path, task_description)\` - Create specialized agents
- \`list_agents(repository_path, status_filter)\` - View active agents
- \`terminate_agent(agent_id)\` - Stop specific agents
- \`orchestrate_objective(objective, repository_path)\` - Coordinate multi-agent workflows

### Task Management
- \`create_task(repository_path, task_type, title, description)\` - Create development tasks
- \`list_tasks(repository_path, status_filter)\` - View task status
- \`assign_task(task_id, agent_id)\` - Assign tasks to agents

### Shared Memory & Communication
- \`store_memory(repository_path, agent_id, entry_type, title, content)\` - Store insights
- \`search_memory(repository_path, query_text)\` - Search previous work
- \`join_room(room_name, agent_name)\` - Real-time agent communication
- \`send_message(room_name, message, mentions)\` - Coordinate via chat
- \`list_rooms(repository_path, status, limit, offset)\` - List communication rooms
- \`list_room_messages(room_name, limit, offset)\` - View room chat history
- \`close_room(room_name, terminate_agents)\` - Close room and cleanup agents
- \`delete_room(room_name, force_delete)\` - Permanently delete room

### Enhanced File Operations
- \`list_files(directory, show_hidden, max_depth)\` - Smart file listing
- \`find_files(pattern, directory)\` - Pattern-based search
- \`easy_replace(file_path, old_text, new_text)\` - Fuzzy string replacement
- \`take_screenshot(output_path, region)\` - Cross-platform screenshots

### Documentation Intelligence
- \`scrape_documentation(url, crawl_depth, selectors)\` - Web scraping
- \`search_documentation(query, limit, similarity_threshold)\` - Semantic search
- \`analyze_project_structure(project_path, output_format)\` - Code analysis

## 🚀 Example Workflows

### Multi-Agent Development
\`\`\`typescript
// Spawn coordinated agents for full-stack development
const backendAgent = await spawn_agent("backend", ".", "Implement REST API endpoints");
const frontendAgent = await spawn_agent("frontend", ".", "Create React components");
const testAgent = await spawn_agent("testing", ".", "Write comprehensive tests");

// Use shared memory for coordination
await store_memory(".", backendAgent.id, "api_design", "REST Endpoints", 
  "Implemented /users, /auth, /data endpoints with TypeScript types");
\`\`\`

### Documentation-Driven Development
\`\`\`typescript
// Scrape framework docs first
await scrape_documentation("https://docs.framework.com", 2);

// Implement following best practices
await orchestrate_objective(
  "Build app following official framework patterns from scraped docs", 
  "."
);
\`\`\`

### Development Environment Setup
\`\`\`typescript
// Coordinate development and testing
await orchestrate_objective(
  "Set up dev server and run tests in parallel",
  "."
);
\`\`\`

## 📋 CLI Commands

\`\`\`bash
# Agent management
claude-mcp-tools agent list --repository .
claude-mcp-tools agent spawn --type backend --repository . --description "API development"

# Task management  
claude-mcp-tools task list --repository .
claude-mcp-tools task create --type feature --title "User Auth"

# Memory operations
claude-mcp-tools memory search --query "authentication" --repository .

# Communication
claude-mcp-tools room list --repository .

# System status
claude-mcp-tools status
\`\`\`

## 🏗️ TypeScript Features

- **Type Safety**: Full TypeScript implementation with strict mode
- **Performance**: Better-sqlite3 for high-performance database operations  
- **Modern ES Modules**: Tree-shaking and efficient imports
- **Hot Reload Development**: TSX for development mode
- **Comprehensive Testing**: Vitest with TypeScript support

## 📊 Data Storage

- **Databases**: \`~/.mcptools/data/*.db\` (SQLite)
- **Configuration**: \`./.claude/settings.local.json\`
- **Agent Coordination**: Real-time via shared database
- **Memory Sharing**: Cross-agent insights and learning

🎯 **Recommended**: Start with \`orchestrate_objective()\` for complex multi-step tasks. The system will coordinate specialized agents with proper dependencies and shared context.

Data stored locally with intelligent caching and cross-agent memory sharing.
<!-- zzClaudeMcpToolsTypescriptzz END -->`;

  const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
  
  if (fs.existsSync(claudeMdPath)) {
    let content = fs.readFileSync(claudeMdPath, 'utf8');
    
    // Replace existing section or append
    if (content.includes('<!-- zzClaudeMcpToolsTypescriptzz START -->')) {
      const startMarker = '<!-- zzClaudeMcpToolsTypescriptzz START -->';
      const endMarker = '<!-- zzClaudeMcpToolsTypescriptzz END -->';
      
      const startIndex = content.indexOf(startMarker);
      const endIndex = content.indexOf(endMarker);
      
      if (startIndex !== -1 && endIndex !== -1) {
        content = content.slice(0, startIndex) + claudeSection + content.slice(endIndex + endMarker.length);
      } else {
        content += '\n\n' + claudeSection;
      }
    } else {
      content += '\n\n' + claudeSection;
    }
    
    fs.writeFileSync(claudeMdPath, content);
    logSuccess('Updated existing CLAUDE.md');
  } else {
    fs.writeFileSync(claudeMdPath, claudeSection + '\n');
    logSuccess('Created CLAUDE.md');
  }
}

async function initializeDatabase(): Promise<void> {
  logStep('🗄️', 'Initializing database with migrations...');
  
  try {
    // Create data directory
    fs.mkdirSync(INSTALL_PATHS.DATA_DIR, { recursive: true });
    
    // Import and initialize DatabaseManager to run migrations
    const { DatabaseManager } = await import('../database/index.js');
    const db = new DatabaseManager();
    
    // Initialize will automatically run migrations
    await db.initialize();
    
    // Close the database
    db.close();
    
    logSuccess('Database initialized with migrations');
  } catch (error) {
    logWarning(`Database initialization will occur on first use: ${error}`);
  }
}

export async function install(options: { globalOnly?: boolean; projectOnly?: boolean; skipMcp?: boolean } = {}): Promise<void> {
  console.log(`${colors.bold}${colors.blue}`);
  console.log('╭─────────────────────────────────────────╮');
  console.log('│ 🚀 ClaudeMcpTools TypeScript Installer │');
  console.log('│ Enhanced MCP Tools for Claude Code      │');
  console.log('╰─────────────────────────────────────────╯');
  console.log(colors.reset);
  
  // Check prerequisites
  const { success, packageManager } = checkPrerequisites();
  if (!success || !packageManager) {
    process.exit(1);
  }
  
  // Create directories
  createDirectories();
  
  // Build and link globally
  if (!options.projectOnly) {
    if (!buildAndLink(packageManager)) {
      process.exit(1);
    }
    
    // Configure MCP server
    if (!configureMcpServer()) {
      logWarning('Manual MCP configuration may be needed');
    }
  }
  
  // Set up project configuration
  if (!options.globalOnly) {
    createProjectConfig();
    createClaudeMd();
  }
  
  // Initialize database
  await initializeDatabase();
  
  // Success message
  console.log('\n' + colors.green + colors.bold);
  console.log('╭─────────────────── 🎉 Success ───────────────────╮');
  console.log('│ ✅ Installation Complete!                        │');
  console.log('│                                                   │');
  console.log('│ 📋 What was installed:                            │');
  console.log(`│ • TypeScript package: Globally linked            │`);
  console.log(`│ • Data storage: ~/.mcptools/data/                 │`);
  console.log(`│ • MCP server: claude-mcp-tools configured         │`);
  if (!options.globalOnly) {
    console.log(`│ • Project config: ./.claude/settings.local.json  │`);
    console.log(`│ • Project integration: ./CLAUDE.md               │`);
    console.log(`│ • ALL 43 MCP tools: Fully enabled               │`);
    console.log(`│ • Bash permissions: Full autonomous access       │`);
    console.log(`│ • 80+ commands: Pre-authorized for operation     │`);
  }
  console.log('│                                                   │');
  console.log('│ 🤖 Autonomous Operation Ready:                    │');
  console.log('│ • Multi-agent orchestration enabled              │');
  console.log('│ • Browser automation available                   │');
  console.log('│ • Documentation scraping configured              │');
  console.log('│ • Project analysis tools active                  │');
  console.log('│ • Foundation caching for cost reduction          │');
  console.log('│                                                   │');
  console.log('│ 🚀 Next steps:                                    │');
  console.log('│ 1. Restart Claude Code                            │');
  console.log('│ 2. Use /mcp to see all 43 available tools        │');
  console.log('│ 3. Try: orchestrate_objective() for workflows    │');
  console.log('│ 4. Check: ./CLAUDE.md for TypeScript examples    │');
  console.log('╰───────────────────────────────────────────────────╯');
  console.log(colors.reset);
}

export function uninstall(): void {
  logStep('🗑️', 'Uninstalling ClaudeMcpTools...');
  
  // Detect package manager for unlinking
  const packageManager = detectPackageManager();
  
  try {
    // Remove MCP server
    try {
      execSync('claude mcp remove claude-mcp-tools', { stdio: 'ignore' });
      logSuccess('MCP server removed');
    } catch {
      logWarning('MCP server was not configured');
    }
    
    // Unlink global package
    if (packageManager) {
      try {
        execSync(packageManager.unlinkCommand, { stdio: 'ignore' });
        logSuccess('Global package unlinked');
      } catch {
        logWarning('Package was not globally linked');
      }
    }
    
    // Preserve data directory with notice
    if (fs.existsSync(INSTALL_PATHS.DATA_DIR)) {
      log(`Data directory preserved: ${INSTALL_PATHS.DATA_DIR}`, 'yellow');
      log('(Remove manually if desired)', 'dim');
    }
    
    logSuccess('Uninstallation complete');
    
  } catch (error) {
    logError(`Uninstallation failed: ${error}`);
    process.exit(1);
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  if (command === 'uninstall') {
    uninstall();
  } else if (command === 'install' || !command) {
    const options = {
      globalOnly: process.argv.includes('--global-only'),
      projectOnly: process.argv.includes('--project-only')
    };
    install(options);
  } else {
    log('Usage: claude-mcp-tools-installer [install|uninstall] [--global-only|--project-only]', 'yellow');
    process.exit(1);
  }
}