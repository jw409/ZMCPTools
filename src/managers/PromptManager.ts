import type { Prompt, PromptArgument, GetPromptResult, PromptMessage, GetPromptRequest, ListPromptsResult } from '@modelcontextprotocol/sdk/types.js';

export interface PromptTemplate {
  name: string;
  description: string;
  arguments?: PromptArgument[];
  template: string;
}

export class PromptManager {
  private prompts: Map<string, PromptTemplate> = new Map();

  constructor() {
    this.initializeBuiltinPrompts();
  }

  private initializeBuiltinPrompts(): void {
    // NOTE: All prompts removed - MCP Prompts don't work reliably with Claude Code
    // Use native Claude capabilities instead
    // See GitHub Issue #36 for details

    // Previous prompts (19 total, all removed):
    // - multi-agent-bug-fix, issue-fixer, code-review
    // - feature-implementer, documentation-writer, performance-optimizer
    // - semantic-search, vector-db-setup, api-documenter, db-migration
    // - sequential-thinking variants (architect, problem-solver, analysis, decision)
    // - architect-orchestration, knowledge-graph-integration
    // - task-breakdown-specialist, architect-planning-template
  }

  /**
   * Add a custom prompt template
   */
  addPrompt(template: PromptTemplate): void {
    this.prompts.set(template.name, template);
  }

  /**
   * Remove a prompt template
   */
  removePrompt(name: string): boolean {
    return this.prompts.delete(name);
  }

  private substituteArguments(template: string, args: Record<string, string>): string {
    // Simple template substitution: {{arg_name}} or {{arg_name || default}}
    return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
      const parts = expression.split('||');
      const argName = parts[0].trim();
      const defaultValue = parts[1]?.trim().replace(/["']/g, '') || '';

      return args[argName] || defaultValue || match;
    });
  }

  /**
   * Get all available prompts
   */
  listPrompts(): ListPromptsResult {
    const prompts: Prompt[] = Array.from(this.prompts.values()).map(template => ({
      name: template.name,
      description: template.description,
      arguments: template.arguments
    }));

    return { prompts };
  }

  /**
   * Get a specific prompt by name
   */
  getPrompt(name: string, args: Record<string, string> = {}): GetPromptResult | null {
    const template = this.prompts.get(name);
    if (!template) {
      return null;
    }

    const content = this.substituteArguments(template.template, args);

    const messages: PromptMessage[] = [{
      role: 'user',
      content: {
        type: 'text',
        text: content
      }
    }];

    return {
      description: template.description,
      messages
    };
  }
}
