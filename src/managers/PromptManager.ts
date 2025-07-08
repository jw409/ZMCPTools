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

    // Vector search and documentation analyzer
    this.prompts.set('semantic-search', {
      name: 'semantic-search',
      description: 'Perform semantic search across documentation using vector embeddings',
      arguments: [
        {
          name: 'query',
          description: 'Search query for semantic similarity matching',
          required: true
        },
        {
          name: 'collection',
          description: 'Vector collection to search (default: documentation)',
          required: false
        },
        {
          name: 'limit',
          description: 'Maximum number of results (default: 10)',
          required: false
        },
        {
          name: 'threshold',
          description: 'Similarity threshold 0-1 (default: 0.7)',
          required: false
        }
      ],
      template: `You are performing semantic search across documentation using vector embeddings.

**Query:** {{query}}
**Collection:** {{collection || "documentation"}}
**Result Limit:** {{limit || "10"}}
**Similarity Threshold:** {{threshold || "0.7"}}

SEMANTIC SEARCH PROCESS:
1. **Query Analysis**: Understand the semantic intent of the search query
2. **Vector Search**: Use embedding similarity to find relevant content
3. **Result Ranking**: Order results by semantic relevance and similarity score
4. **Context Extraction**: Extract key information from similar documents
5. **Answer Synthesis**: Combine relevant findings into a comprehensive response

Focus on semantic meaning rather than keyword matching. Provide contextual answers based on the most relevant documentation found.`
    });

    // ChromaDB setup and management
    this.prompts.set('vector-db-setup', {
      name: 'vector-db-setup',
      description: 'Set up and configure ChromaDB vector database for semantic search',
      arguments: [
        {
          name: 'server_url',
          description: 'ChromaDB server URL (default: localhost:8000)',
          required: false
        },
        {
          name: 'embedding_provider',
          description: 'Embedding provider (openai, default)',
          required: false
        },
        {
          name: 'collection_name',
          description: 'Vector collection name to create/manage',
          required: false
        }
      ],
      template: `You are setting up ChromaDB vector database for semantic search capabilities.

**Server URL:** {{server_url || "http://localhost:8000"}}
**Embedding Provider:** {{embedding_provider || "default (Sentence Transformers)"}}
**Collection:** {{collection_name || "documentation"}}

SETUP PROCESS:
1. **Server Connection**: Verify ChromaDB server is running and accessible
2. **Collection Setup**: Create or configure vector collections
3. **Embedding Configuration**: Set up embedding function (OpenAI or default)
4. **Data Ingestion**: Import existing documentation into vector collections
5. **Search Testing**: Verify semantic search functionality works correctly
6. **Performance Tuning**: Optimize for search speed and accuracy

Ensure vector database is properly configured for production use with appropriate indexing and embedding strategies.`
    });

    // API documentation generator
    this.prompts.set('api-documenter', {
      name: 'api-documenter',
      description: 'Generate comprehensive API documentation with examples and schemas',
      arguments: [
        {
          name: 'api_files',
          description: 'API files or endpoints to document',
          required: true
        },
        {
          name: 'format',
          description: 'Documentation format (openapi, markdown, json)',
          required: false
        },
        {
          name: 'include_examples',
          description: 'Include request/response examples (true/false)',
          required: false
        }
      ],
      template: `You are generating comprehensive API documentation with examples and schemas.

**API Files:** {{api_files}}
**Format:** {{format || "markdown"}}
**Include Examples:** {{include_examples || "true"}}

DOCUMENTATION STRUCTURE:
1. **API Overview**: Purpose, authentication, base URLs
2. **Endpoint Reference**: Methods, paths, parameters, responses
3. **Schema Definitions**: Request/response models and types
4. **Authentication**: API keys, tokens, OAuth flows
5. **Examples**: Real request/response examples for each endpoint
6. **Error Handling**: Error codes, messages, troubleshooting
7. **Rate Limiting**: Throttling policies and best practices
8. **SDK/Client Examples**: Code samples in multiple languages

Create clear, comprehensive documentation that helps developers successfully integrate with the API.`
    });

    // Database migration assistant
    this.prompts.set('db-migration', {
      name: 'db-migration',
      description: 'Plan and execute database schema migrations safely',
      arguments: [
        {
          name: 'migration_type',
          description: 'Type of migration (schema, data, index, cleanup)',
          required: true
        },
        {
          name: 'database_type',
          description: 'Database type (sqlite, postgres, mysql)',
          required: false
        },
        {
          name: 'backwards_compatible',
          description: 'Require backwards compatibility (true/false)',
          required: false
        }
      ],
      template: `You are planning and executing database migrations safely and efficiently.

**Migration Type:** {{migration_type}}
**Database:** {{database_type || "sqlite"}}
**Backwards Compatible:** {{backwards_compatible || "true"}}

MIGRATION PROCESS:
1. **Analysis**: Review current schema and identify changes needed
2. **Planning**: Design migration steps with rollback strategy
3. **Backup**: Create database backup before migration
4. **Testing**: Test migration on copy of production data
5. **Execution**: Run migration with progress monitoring
6. **Validation**: Verify data integrity and application functionality
7. **Cleanup**: Remove temporary migration artifacts

Focus on data safety, minimal downtime, and complete rollback capability if issues arise.`
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