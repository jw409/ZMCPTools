/**
 * Agent Capabilities - Role-based access control for MCP tools
 *
 * Loads talent-os/etc/agent_capabilities.json and provides filtering
 * for tool/resource access based on agent roles.
 *
 * Defense in depth:
 * 1. Tool listing - Don't expose forbidden tools to agent
 * 2. Runtime validation - Block execution even if they try
 * 3. Path sandbox - Python layer validates filesystem access
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';

export interface AgentCapabilities {
  description: string;
  mcp_tools: {
    allowed: string[];
    denied: string[];
  };
  mcp_resources: {
    allowed: string[];
    denied: string[];
  };
}

export interface CapabilitiesConfig {
  version: string;
  roles: {
    [role: string]: AgentCapabilities;
  };
}

export class AgentCapabilityManager {
  private config: CapabilitiesConfig;
  private configPath: string;

  constructor(configPath?: string) {
    // Default to talent-os/etc/agent_capabilities.json
    if (!configPath) {
      // Walk up from cwd to find project root (contains both ZMCPTools and talent-os)
      let currentDir = resolve(process.cwd());

      // Check if we're in ZMCPTools or talent-os subdirectory
      if (currentDir.endsWith('ZMCPTools') || currentDir.endsWith('talent-os')) {
        currentDir = resolve(currentDir, '..');
      }

      this.configPath = join(currentDir, 'talent-os', 'etc', 'agent_capabilities.json');
    } else {
      this.configPath = configPath;
    }

    this.config = this.loadConfig();
  }

  private loadConfig(): CapabilitiesConfig {
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load agent capabilities from ${this.configPath}: ${message}`);
    }
  }

  /**
   * Get capabilities for a specific role
   */
  getRoleCapabilities(role: string): AgentCapabilities {
    if (!this.config.roles[role]) {
      const availableRoles = Object.keys(this.config.roles).join(', ');
      throw new Error(`Unknown role '${role}'. Available roles: ${availableRoles}`);
    }

    return this.config.roles[role];
  }

  /**
   * Check if a role can use a specific tool
   */
  canUseTool(role: string, toolName: string): boolean {
    const capabilities = this.getRoleCapabilities(role);
    const { allowed, denied } = capabilities.mcp_tools;

    // Check wildcard allow
    if (allowed.includes('*')) {
      return true;
    }

    // Check explicit deny
    if (denied.includes(toolName)) {
      return false;
    }

    // Check explicit allow
    if (allowed.includes(toolName)) {
      return true;
    }

    // Default deny
    return false;
  }

  /**
   * Filter tool list by role
   */
  filterToolsByRole(tools: Array<{name: string}>, role: string): Array<{name: string}> {
    return tools.filter(tool => this.canUseTool(role, tool.name));
  }

  /**
   * Check if a role can access a specific resource
   */
  canAccessResource(role: string, resourceUri: string): boolean {
    const capabilities = this.getRoleCapabilities(role);
    const { allowed, denied } = capabilities.mcp_resources;

    // Check wildcard allow
    if (allowed.includes('*')) {
      return true;
    }

    // Check explicit deny
    if (denied.includes(resourceUri)) {
      return false;
    }

    // Check pattern deny
    for (const pattern of denied) {
      if (this.matchesPattern(resourceUri, pattern)) {
        return false;
      }
    }

    // Check explicit allow
    if (allowed.includes(resourceUri)) {
      return true;
    }

    // Check pattern allow
    for (const pattern of allowed) {
      if (this.matchesPattern(resourceUri, pattern)) {
        return true;
      }
    }

    // Default deny
    return false;
  }

  /**
   * Match URI against pattern with wildcards
   */
  private matchesPattern(uri: string, pattern: string): boolean {
    if (!pattern.includes('*')) {
      return uri === pattern;
    }

    // Simple wildcard matching (prefix*/suffix)
    const parts = pattern.split('*');
    if (parts.length !== 2) {
      return false;
    }

    const [prefix, suffix] = parts;
    return uri.startsWith(prefix) && uri.endsWith(suffix);
  }
}
