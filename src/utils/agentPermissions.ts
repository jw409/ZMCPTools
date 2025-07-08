import type { ToolPermissions, ToolCategory, AgentType } from '../schemas/agents.js';
import { TOOL_CATEGORY_MAPPINGS, AGENT_TYPE_DEFINITIONS } from '../schemas/agents.js';
import { Logger } from './logger.js';

const logger = new Logger('AgentPermissions');

/**
 * Utility class for managing agent tool permissions
 */
export class AgentPermissionManager {
  
  /**
   * Generate tool permissions for an agent type
   */
  static generateToolPermissions(agentType: AgentType, customPermissions?: Partial<ToolPermissions>): ToolPermissions {
    const agentDef = AGENT_TYPE_DEFINITIONS[agentType];
    
    if (!agentDef) {
      logger.warn(`Unknown agent type: ${agentType}, using general_agent defaults`);
      return this.generateToolPermissions('general_agent', customPermissions);
    }

    // Start with allowed tools from categories
    const allowedTools: string[] = [];
    const allowedCategories = agentDef.defaultAllowedCategories;
    
    for (const category of allowedCategories) {
      const tools = TOOL_CATEGORY_MAPPINGS[category];
      if (tools) {
        allowedTools.push(...tools);
      }
    }

    // Remove tools from disallowed categories
    const disallowedTools: string[] = [];
    if (agentDef.defaultDisallowedCategories) {
      for (const category of agentDef.defaultDisallowedCategories) {
        const tools = TOOL_CATEGORY_MAPPINGS[category];
        if (tools) {
          disallowedTools.push(...tools);
        }
      }
    }

    // Filter out disallowed tools from allowed tools
    const finalAllowedTools = allowedTools.filter(tool => !disallowedTools.includes(tool));

    const permissions: ToolPermissions = {
      allowedTools: finalAllowedTools,
      disallowedTools: disallowedTools,
      allowedCategories: allowedCategories,
      disallowedCategories: agentDef.defaultDisallowedCategories,
      customPermissions: {}
    };

    // Apply custom permissions if provided
    if (customPermissions) {
      if (customPermissions.allowedTools) {
        permissions.allowedTools = [...(permissions.allowedTools || []), ...customPermissions.allowedTools];
      }
      if (customPermissions.disallowedTools) {
        permissions.disallowedTools = [...(permissions.disallowedTools || []), ...customPermissions.disallowedTools];
      }
      if (customPermissions.allowedCategories) {
        permissions.allowedCategories = [...(permissions.allowedCategories || []), ...customPermissions.allowedCategories];
      }
      if (customPermissions.disallowedCategories) {
        permissions.disallowedCategories = [...(permissions.disallowedCategories || []), ...customPermissions.disallowedCategories];
      }
      if (customPermissions.customPermissions) {
        permissions.customPermissions = { ...permissions.customPermissions, ...customPermissions.customPermissions };
      }
    }

    return permissions;
  }

  /**
   * Check if an agent is allowed to use a specific tool
   */
  static isToolAllowed(toolName: string, permissions: ToolPermissions): boolean {
    // Check custom permissions first
    if (permissions.customPermissions && permissions.customPermissions[toolName] !== undefined) {
      return permissions.customPermissions[toolName];
    }

    // Check explicit disallowed tools
    if (permissions.disallowedTools && permissions.disallowedTools.includes(toolName)) {
      return false;
    }

    // Check explicit allowed tools
    if (permissions.allowedTools && permissions.allowedTools.includes(toolName)) {
      return true;
    }

    // Check category-based permissions
    const toolCategory = this.getToolCategory(toolName);
    if (toolCategory) {
      // Check if category is explicitly disallowed
      if (permissions.disallowedCategories && permissions.disallowedCategories.includes(toolCategory)) {
        return false;
      }
      
      // Check if category is explicitly allowed
      if (permissions.allowedCategories && permissions.allowedCategories.includes(toolCategory)) {
        return true;
      }
    }

    // Default to disallowed if not explicitly permitted
    return false;
  }

  /**
   * Get the category for a specific tool
   */
  static getToolCategory(toolName: string): ToolCategory | null {
    for (const [category, tools] of Object.entries(TOOL_CATEGORY_MAPPINGS)) {
      if (tools.includes(toolName)) {
        return category as ToolCategory;
      }
    }
    return null;
  }

  /**
   * Generate allowed tools list for Claude Code --allowedTools flag
   */
  static generateAllowedToolsFlag(permissions: ToolPermissions): string {
    const allowedTools = permissions.allowedTools || [];
    
    // Add category-based tools
    if (permissions.allowedCategories) {
      for (const category of permissions.allowedCategories) {
        const categoryTools = TOOL_CATEGORY_MAPPINGS[category];
        if (categoryTools) {
          allowedTools.push(...categoryTools);
        }
      }
    }

    // Remove duplicates and disallowed tools
    const disallowedTools = permissions.disallowedTools || [];
    const finalTools = [...new Set(allowedTools)].filter(tool => !disallowedTools.includes(tool));

    // Apply custom permissions
    if (permissions.customPermissions) {
      for (const [tool, allowed] of Object.entries(permissions.customPermissions)) {
        if (allowed && !finalTools.includes(tool)) {
          finalTools.push(tool);
        } else if (!allowed) {
          const index = finalTools.indexOf(tool);
          if (index > -1) {
            finalTools.splice(index, 1);
          }
        }
      }
    }

    return finalTools.join(',');
  }

  /**
   * Generate room name for an agent
   */
  static generateRoomName(agentType: AgentType, agentId: string, timestamp?: number): string {
    const agentDef = AGENT_TYPE_DEFINITIONS[agentType];
    const pattern = agentDef?.roomNamingPattern || 'agent_{timestamp}';
    const actualTimestamp = timestamp || Date.now();
    
    return pattern
      .replace('{agentType}', agentType)
      .replace('{agentId}', agentId)
      .replace('{timestamp}', actualTimestamp.toString());
  }

  /**
   * Check if agent type should auto-create room
   */
  static shouldAutoCreateRoom(agentType: AgentType): boolean {
    const agentDef = AGENT_TYPE_DEFINITIONS[agentType];
    return agentDef?.autoCreateRoom !== false; // Default to true
  }

  /**
   * Get maximum concurrent agents for a type
   */
  static getMaxConcurrentAgents(agentType: AgentType): number | undefined {
    const agentDef = AGENT_TYPE_DEFINITIONS[agentType];
    return agentDef?.maxConcurrentAgents;
  }

  /**
   * Validate tool permissions configuration
   */
  static validatePermissions(permissions: ToolPermissions): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for conflicting permissions
    if (permissions.allowedTools && permissions.disallowedTools) {
      const conflicts = permissions.allowedTools.filter(tool => 
        permissions.disallowedTools!.includes(tool)
      );
      if (conflicts.length > 0) {
        errors.push(`Tools cannot be both allowed and disallowed: ${conflicts.join(', ')}`);
      }
    }

    // Check for conflicting categories
    if (permissions.allowedCategories && permissions.disallowedCategories) {
      const conflicts = permissions.allowedCategories.filter(category => 
        permissions.disallowedCategories!.includes(category)
      );
      if (conflicts.length > 0) {
        errors.push(`Categories cannot be both allowed and disallowed: ${conflicts.join(', ')}`);
      }
    }

    // Check for unknown tools
    if (permissions.allowedTools) {
      const allKnownTools = Object.values(TOOL_CATEGORY_MAPPINGS).flat();
      const unknownTools = permissions.allowedTools.filter(tool => 
        !allKnownTools.includes(tool) && !tool.startsWith('mcp__')
      );
      if (unknownTools.length > 0) {
        logger.warn(`Unknown tools in allowed list: ${unknownTools.join(', ')}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}