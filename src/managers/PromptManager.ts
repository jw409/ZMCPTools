import type { Prompt, PromptArgument, GetPromptResult, PromptMessage } from '@modelcontextprotocol/sdk/types.js';

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
    // Multi-agent bug fix workflow
    this.prompts.set('multi-agent-bug-fix', {
      name: 'multi-agent-bug-fix',
      description: 'Coordinate multiple agents to investigate and fix a bug with comprehensive testing',
      arguments: [
        {
          name: 'bug_description',
          description: 'Description of the bug to fix',
          required: true
        },
        {
          name: 'repository_path',
          description: 'Path to the repository',
          required: false
        },
        {
          name: 'priority',
          description: 'Priority level (low, medium, high, critical)',
          required: false
        }
      ],
      template: `You are coordinating a multi-agent bug fix workflow. Here's the bug to investigate and fix:

**Bug Description:** {{bug_description}}
**Repository:** {{repository_path || "current directory"}}
**Priority:** {{priority || "medium"}}

COORDINATION PLAN:
1. **Investigation Agent**: Analyze the bug, reproduce it, and identify root cause
2. **Implementation Agent**: Implement the fix based on investigation findings
3. **Testing Agent**: Create comprehensive tests and verify the fix works
4. **Review Agent**: Review the implementation for quality and edge cases

Use orchestrate_objective() to spawn coordinated agents with proper dependencies.
Focus on thorough investigation, clean implementation, and comprehensive testing.`
    });

    // Issue fixer for general problems
    this.prompts.set('issue-fixer', {
      name: 'issue-fixer',
      description: 'Single-agent focused problem solver for specific issues',
      arguments: [
        {
          name: 'issue_description',
          description: 'Description of the issue to resolve',
          required: true
        },
        {
          name: 'files_affected',
          description: 'Comma-separated list of files that might be affected',
          required: false
        },
        {
          name: 'approach',
          description: 'Preferred approach (investigation, implementation, testing)',
          required: false
        }
      ],
      template: `You are a focused issue-fixer agent. Resolve this specific issue:

**Issue:** {{issue_description}}
**Affected Files:** {{files_affected || "to be determined"}}
**Approach:** {{approach || "comprehensive"}}

RESOLUTION STEPS:
1. Analyze the issue and understand the problem
2. Identify the root cause and affected components
3. Implement a clean, focused solution
4. Test the solution thoroughly
5. Verify the issue is completely resolved

Be methodical and thorough. Focus on solving the specific problem without over-engineering.`
    });

    // Code review prompt
    this.prompts.set('code-review', {
      name: 'code-review',
      description: 'Comprehensive code review with security, performance, and quality analysis',
      arguments: [
        {
          name: 'target_files',
          description: 'Files or patterns to review (e.g., "src/**/*.ts")',
          required: false
        },
        {
          name: 'review_type',
          description: 'Type of review (security, performance, quality, full)',
          required: false
        },
        {
          name: 'standards',
          description: 'Coding standards or guidelines to follow',
          required: false
        }
      ],
      template: `You are conducting a comprehensive code review. Focus on quality, security, and best practices.

**Target Files:** {{target_files || "all changed files"}}
**Review Type:** {{review_type || "full"}}
**Standards:** {{standards || "project conventions"}}

REVIEW CHECKLIST:
□ **Security**: Check for vulnerabilities, input validation, authentication
□ **Performance**: Identify bottlenecks, memory leaks, inefficient algorithms
□ **Quality**: Code clarity, maintainability, proper error handling
□ **Testing**: Test coverage, edge cases, integration tests
□ **Documentation**: Comments, API docs, README updates
□ **Standards**: Coding conventions, naming, project structure

Provide specific, actionable feedback with code examples where helpful.`
    });

    // Feature implementer
    this.prompts.set('feature-implementer', {
      name: 'feature-implementer',
      description: 'Systematic feature implementation with planning and testing',
      arguments: [
        {
          name: 'feature_description',
          description: 'Detailed description of the feature to implement',
          required: true
        },
        {
          name: 'requirements',
          description: 'Specific requirements or acceptance criteria',
          required: false
        },
        {
          name: 'architecture',
          description: 'Preferred architecture or patterns to use',
          required: false
        }
      ],
      template: `You are implementing a new feature. Plan thoroughly and execute systematically.

**Feature:** {{feature_description}}
**Requirements:** {{requirements || "to be refined based on feature description"}}
**Architecture:** {{architecture || "follow existing project patterns"}}

IMPLEMENTATION PLAN:
1. **Analysis**: Understand requirements and define scope
2. **Design**: Plan architecture, APIs, and data structures
3. **Implementation**: Write clean, tested code following project conventions
4. **Testing**: Create comprehensive unit and integration tests
5. **Documentation**: Update docs, comments, and examples
6. **Integration**: Ensure feature works with existing codebase

Focus on maintainable, well-tested code that integrates smoothly with the existing system.`
    });

    // Documentation writer
    this.prompts.set('documentation-writer', {
      name: 'documentation-writer',
      description: 'Create comprehensive documentation for code, APIs, and features',
      arguments: [
        {
          name: 'target',
          description: 'What to document (API, feature, codebase, etc.)',
          required: true
        },
        {
          name: 'audience',
          description: 'Target audience (developers, users, maintainers)',
          required: false
        },
        {
          name: 'format',
          description: 'Documentation format (markdown, API docs, inline comments)',
          required: false
        }
      ],
      template: `You are creating comprehensive documentation. Make it clear, useful, and maintainable.

**Target:** {{target}}
**Audience:** {{audience || "developers"}}
**Format:** {{format || "markdown"}}

DOCUMENTATION STRUCTURE:
1. **Overview**: Clear description of purpose and scope
2. **Getting Started**: Quick start guide with examples
3. **API Reference**: Detailed method/function documentation
4. **Examples**: Real-world usage scenarios
5. **Configuration**: Setup and configuration options
6. **Troubleshooting**: Common issues and solutions
7. **Contributing**: Guidelines for contributors

Focus on clarity, completeness, and practical examples that help users succeed.`
    });

    // Performance optimizer
    this.prompts.set('performance-optimizer', {
      name: 'performance-optimizer',
      description: 'Analyze and optimize code performance with benchmarking',
      arguments: [
        {
          name: 'target_area',
          description: 'Area to optimize (database, API, algorithms, etc.)',
          required: false
        },
        {
          name: 'metrics',
          description: 'Performance metrics to focus on (speed, memory, throughput)',
          required: false
        },
        {
          name: 'constraints',
          description: 'Constraints or requirements to maintain',
          required: false
        }
      ],
      template: `You are optimizing code performance. Use data-driven analysis and benchmarking.

**Target Area:** {{target_area || "entire codebase"}}
**Key Metrics:** {{metrics || "response time and memory usage"}}
**Constraints:** {{constraints || "maintain current functionality"}}

OPTIMIZATION PROCESS:
1. **Profile**: Identify bottlenecks using performance tools
2. **Benchmark**: Establish baseline performance metrics
3. **Analyze**: Find root causes of performance issues
4. **Optimize**: Implement targeted improvements
5. **Measure**: Verify improvements with benchmarks
6. **Document**: Record changes and performance gains

Focus on measurable improvements while maintaining code quality and functionality.`
    });
  }

  /**
   * Get all available prompts
   */
  async listPrompts(): Promise<Prompt[]> {
    return Array.from(this.prompts.values()).map(template => ({
      name: template.name,
      description: template.description,
      arguments: template.arguments || []
    }));
  }

  /**
   * Get a specific prompt with arguments substituted
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    const template = this.prompts.get(name);
    if (!template) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    // Substitute arguments in template
    let content = template.template;
    if (args) {
      content = this.substituteArguments(template.template, args);
    }

    const messages: PromptMessage[] = [
      {
        role: 'user',
        content: {
          type: 'text',
          text: content
        }
      }
    ];

    return {
      description: template.description,
      messages
    };
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
}