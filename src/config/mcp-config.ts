import * as fs from 'fs';
import * as path from 'path';

interface MCPServerConfig {
  type: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Generate MCP configuration for ZMCP agents
 */
export function generateMCPConfig(): MCPConfig {
  const zmcpToolsPath = path.resolve(__dirname, '../index.ts');

  return {
    mcpServers: {
      "zmcp-tools": {
        type: "stdio",
        command: "/home/jw/.npm-global/bin/tsx",
        args: [zmcpToolsPath]
      },
      "sequential-thinking": {
        type: "stdio",
        command: "node",
        args: ["/home/jw/mcp-servers/src/sequentialthinking/index.js"]
      }
    }
  };
}

/**
 * Create a temporary MCP config file for an agent
 */
export function createAgentMCPConfig(agentId: string): string {
  const config = generateMCPConfig();
  const configPath = `/tmp/agent-${agentId}-mcp.json`;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  return configPath;
}

/**
 * Clean up MCP config file for an agent
 */
export function cleanupAgentMCPConfig(agentId: string): void {
  const configPath = `/tmp/agent-${agentId}-mcp.json`;

  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  } catch (error) {
    console.warn(`Failed to cleanup MCP config file ${configPath}:`, error);
  }
}