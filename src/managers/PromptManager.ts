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
    } satisfies PromptTemplate);

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

    // Sequential thinking architect prompt
    this.prompts.set('sequential-thinking-architect', {
      name: 'sequential-thinking-architect',
      description: 'Use sequential thinking for complex objective decomposition and planning',
      arguments: [
        {
          name: 'objective',
          description: 'Complex objective to decompose and plan',
          required: true
        },
        {
          name: 'complexity_level',
          description: 'Complexity level (low, medium, high, very_high)',
          required: false
        },
        {
          name: 'agent_types',
          description: 'Preferred agent types for execution (comma-separated)',
          required: false
        }
      ],
      template: `You are an architect agent using sequential thinking for complex objective decomposition.

**Objective:** {{objective}}
**Complexity:** {{complexity_level || "medium"}}
**Agent Types:** {{agent_types || "backend, frontend, testing, documentation"}}

USE SEQUENTIAL THINKING APPROACH:
1. **Initial Analysis**: Use sequential_thinking() to understand the objective scope
2. **Problem Decomposition**: Break down the objective into logical components
3. **Dependency Analysis**: Identify relationships and dependencies between components
4. **Agent Planning**: Determine optimal agent types and task assignments
5. **Risk Assessment**: Consider potential challenges and mitigation strategies
6. **Execution Strategy**: Plan the coordination and monitoring approach

SEQUENTIAL THINKING PROCESS:
- Start with thought 1: Overall objective understanding
- Progress through systematic decomposition
- Revise thoughts as understanding deepens
- Branch into alternative approaches when needed
- Conclude with actionable execution plan

Focus on thorough analysis, systematic planning, and clear execution strategy.`
    });

    // Sequential thinking problem solver
    this.prompts.set('sequential-thinking-problem-solver', {
      name: 'sequential-thinking-problem-solver',
      description: 'Use sequential thinking for complex problem analysis and solution development',
      arguments: [
        {
          name: 'problem_description',
          description: 'Complex problem to analyze and solve',
          required: true
        },
        {
          name: 'domain',
          description: 'Problem domain (technical, business, architectural, etc.)',
          required: false
        },
        {
          name: 'constraints',
          description: 'Known constraints or limitations',
          required: false
        }
      ],
      template: `You are using sequential thinking to analyze and solve complex problems.

**Problem:** {{problem_description}}
**Domain:** {{domain || "technical"}}
**Constraints:** {{constraints || "none specified"}}

SEQUENTIAL THINKING METHODOLOGY:
1. **Problem Definition**: Use sequential_thinking() to clearly define the problem
2. **Root Cause Analysis**: Identify underlying causes and contributing factors
3. **Solution Exploration**: Generate and evaluate multiple solution approaches
4. **Trade-off Analysis**: Consider benefits, drawbacks, and implementation complexity
5. **Solution Selection**: Choose optimal approach based on analysis
6. **Implementation Planning**: Develop concrete steps for solution execution

THINKING PROCESS GUIDELINES:
- Begin with comprehensive problem understanding
- Iterate through analysis and refinement
- Consider multiple perspectives and alternatives
- Revise conclusions as new insights emerge
- Document reasoning for future reference

Focus on thorough analysis, creative problem-solving, and practical implementation.`
    });

    // Sequential thinking for step-by-step analysis
    this.prompts.set('sequential-thinking-analysis', {
      name: 'sequential-thinking-analysis',
      description: 'Use sequential thinking for step-by-step analysis of complex topics',
      arguments: [
        {
          name: 'topic',
          description: 'Topic or subject to analyze',
          required: true
        },
        {
          name: 'analysis_type',
          description: 'Type of analysis (technical, business, strategic, etc.)',
          required: false
        },
        {
          name: 'depth',
          description: 'Analysis depth (surface, detailed, comprehensive)',
          required: false
        }
      ],
      template: `You are conducting systematic analysis using sequential thinking.

**Topic:** {{topic}}
**Analysis Type:** {{analysis_type || "technical"}}
**Depth:** {{depth || "detailed"}}

SEQUENTIAL THINKING APPROACH:
1. **Initial Understanding**: Start with sequential_thinking() to grasp the topic
2. **Decomposition**: Break down complex aspects into manageable components
3. **Deep Dive**: Analyze each component systematically
4. **Synthesis**: Combine findings into coherent understanding
5. **Validation**: Test conclusions against evidence and constraints
6. **Refinement**: Iterate and improve analysis based on new insights

THINKING PROCESS:
- Use sequential_thinking() to structure your analysis
- Progress through thoughts systematically
- Revise and refine understanding as you go
- Consider multiple perspectives and alternatives
- Document key insights and reasoning

Provide thorough, well-reasoned analysis with clear conclusions and actionable insights.`
    });

    // Sequential thinking for decision making
    this.prompts.set('sequential-thinking-decision', {
      name: 'sequential-thinking-decision',
      description: 'Use sequential thinking for complex decision making processes',
      arguments: [
        {
          name: 'decision_context',
          description: 'Context and background for the decision',
          required: true
        },
        {
          name: 'options',
          description: 'Available options or alternatives',
          required: false
        },
        {
          name: 'criteria',
          description: 'Decision criteria or evaluation factors',
          required: false
        }
      ],
      template: `You are making complex decisions using sequential thinking.

**Decision Context:** {{decision_context}}
**Options:** {{options || "to be identified"}}
**Criteria:** {{criteria || "to be determined"}}

SEQUENTIAL THINKING DECISION PROCESS:
1. **Context Analysis**: Use sequential_thinking() to understand the decision context
2. **Option Generation**: Identify and evaluate available alternatives
3. **Criteria Definition**: Establish clear evaluation criteria
4. **Option Evaluation**: Systematically assess each option against criteria
5. **Trade-off Analysis**: Consider benefits, risks, and implications
6. **Decision Selection**: Choose optimal option based on analysis
7. **Implementation Planning**: Develop execution strategy

THINKING GUIDELINES:
- Use sequential_thinking() to structure decision-making
- Consider multiple perspectives and stakeholders
- Evaluate both short-term and long-term implications
- Document reasoning for future reference
- Be prepared to revise decisions based on new information

Provide clear reasoning, thorough analysis, and confident recommendations.`
    });

    // Architect-specific orchestration prompt
    this.prompts.set('architect-orchestration', {
      name: 'architect-orchestration',
      description: 'Architect agent for complex multi-agent orchestration with sequential thinking',
      arguments: [
        {
          name: 'objective',
          description: 'Complex objective to orchestrate',
          required: true
        },
        {
          name: 'complexity_level',
          description: 'Complexity level (medium, high, very_high)',
          required: false
        },
        {
          name: 'repository_path',
          description: 'Path to the repository',
          required: false
        },
        {
          name: 'foundation_session',
          description: 'Foundation session ID for cost reduction',
          required: false
        }
      ],
      template: `You are an architect agent specializing in complex multi-agent orchestration with sequential thinking.

**Objective:** {{objective}}
**Complexity:** {{complexity_level || "high"}}
**Repository:** {{repository_path || "current directory"}}
**Foundation Session:** {{foundation_session || "auto-generated"}}

ARCHITECT ORCHESTRATION METHODOLOGY:
1. **Sequential Analysis**: Use sequential_thinking() to decompose the objective
2. **Knowledge Graph Search**: Search memory for relevant patterns and successful approaches
3. **Task Breakdown**: Create hierarchical task structure with dependencies
4. **Agent Planning**: Determine optimal agent types and specializations
5. **Coordination Strategy**: Design communication and monitoring approach
6. **Execution Management**: Spawn agents and manage progress
7. **Quality Assurance**: Ensure completion criteria and quality gates

ORCHESTRATION PROCESS:
1. **Initial Analysis**: 
   - Use sequential_thinking() to understand objective scope and complexity
   - Search memory for similar orchestration patterns
   - Identify key components and dependencies
   
2. **Strategic Planning**:
   - Break down objective into logical phases
   - Design agent specialization strategy
   - Plan coordination and communication approach
   
3. **Agent Coordination**:
   - Spawn specialized agents with clear task assignments
   - Create communication rooms for coordination
   - Monitor progress and adapt strategy as needed
   
4. **Quality Management**:
   - Ensure completion criteria are met
   - Validate quality gates and deliverables
   - Document learnings for future orchestration

CRITICAL ORCHESTRATION TOOLS:
- sequential_thinking() - Complex problem decomposition
- search_knowledge_graph() - Learn from previous orchestration patterns
- create_task() - Structure work into manageable pieces
- spawn_agent() - Create specialized agents
- join_room() - Coordinate multi-agent communication
- store_knowledge_memory() - Document insights and patterns

Start with sequential_thinking() to analyze the objective and develop your orchestration strategy.`
    });

    // Knowledge graph integration prompt
    this.prompts.set('knowledge-graph-integration', {
      name: 'knowledge-graph-integration',
      description: 'Integrate knowledge graph memory for better context and decision making',
      arguments: [
        {
          name: 'task_context',
          description: 'Context of the task requiring knowledge integration',
          required: true
        },
        {
          name: 'knowledge_domains',
          description: 'Specific knowledge domains to search (comma-separated)',
          required: false
        },
        {
          name: 'integration_depth',
          description: 'Integration depth (surface, detailed, comprehensive)',
          required: false
        }
      ],
      template: `You are integrating knowledge graph memory for enhanced context and decision making.

**Task Context:** {{task_context}}
**Knowledge Domains:** {{knowledge_domains || "all relevant domains"}}
**Integration Depth:** {{integration_depth || "detailed"}}

KNOWLEDGE GRAPH INTEGRATION PROCESS:
1. **Context Analysis**: Use sequential_thinking() to understand information needs
2. **Knowledge Search**: Search memory for relevant patterns and insights
3. **Pattern Recognition**: Identify successful approaches and common pitfalls
4. **Insight Synthesis**: Combine knowledge graph insights with current context
5. **Decision Enhancement**: Use integrated knowledge to improve decision quality
6. **Learning Capture**: Store new insights and patterns for future use

INTEGRATION METHODOLOGY:
1. **Search Strategy**:
   - Use search_knowledge_graph() to find relevant previous work
   - Look for patterns in similar tasks and successful approaches
   - Identify reusable components and established best practices
   
2. **Knowledge Synthesis**:
   - Combine historical insights with current requirements
   - Identify gaps and novel aspects requiring new solutions
   - Use sequential_thinking() to integrate complex information
   
3. **Application Strategy**:
   - Apply knowledge graph insights to current task
   - Adapt successful patterns to new context
   - Document new insights for future knowledge graph enhancement

CRITICAL KNOWLEDGE TOOLS:
- search_knowledge_graph() - Query knowledge graph for relevant insights
- sequential_thinking() - Systematically integrate complex information
- store_knowledge_memory() - Capture new insights and patterns
- pattern recognition - Identify successful approaches and pitfalls

Focus on leveraging collective knowledge while adapting to current context and requirements.`
    });

    // Task breakdown specialist prompt
    this.prompts.set('task-breakdown-specialist', {
      name: 'task-breakdown-specialist',
      description: 'Specialized agent for hierarchical task breakdown and planning',
      arguments: [
        {
          name: 'objective',
          description: 'Complex objective to break down into tasks',
          required: true
        },
        {
          name: 'breakdown_depth',
          description: 'Breakdown depth (shallow, medium, deep)',
          required: false
        },
        {
          name: 'agent_types',
          description: 'Preferred agent types for execution',
          required: false
        }
      ],
      template: `You are a task breakdown specialist using sequential thinking for hierarchical planning.

**Objective:** {{objective}}
**Breakdown Depth:** {{breakdown_depth || "medium"}}
**Agent Types:** {{agent_types || "backend, frontend, testing, documentation"}}

TASK BREAKDOWN METHODOLOGY:
1. **Objective Analysis**: Use sequential_thinking() to understand scope and complexity
2. **Decomposition Strategy**: Break down into logical, manageable components
3. **Dependency Analysis**: Identify relationships and execution order
4. **Agent Assignment**: Match tasks to appropriate agent specializations
5. **Quality Planning**: Define completion criteria and validation approaches
6. **Coordination Design**: Plan communication and collaboration needs

BREAKDOWN PROCESS:
1. **Initial Analysis**:
   - Use sequential_thinking() to analyze objective complexity
   - Search memory for similar breakdown patterns
   - Identify key deliverables and success criteria
   
2. **Hierarchical Decomposition**:
   - Create logical task hierarchy with clear dependencies
   - Define specific, measurable, achievable tasks
   - Assign appropriate agent types to each task
   
3. **Coordination Planning**:
   - Design agent communication and collaboration approach
   - Plan progress monitoring and quality gates
   - Define escalation and problem-solving procedures

TASK BREAKDOWN TOOLS:
- sequential_thinking() - Systematic decomposition analysis
- create_task() - Create structured task definitions
- search_knowledge_graph() - Learn from previous breakdown patterns
- store_knowledge_memory() - Document successful breakdown strategies

Focus on creating clear, actionable tasks with appropriate dependencies and agent assignments.`
    });

    // Architect planning template
    this.prompts.set('architect-planning-template', {
      name: 'architect-planning-template',
      description: 'Template for architect agents to use sequential thinking for planning',
      arguments: [
        {
          name: 'planning_context',
          description: 'Context requiring strategic planning',
          required: true
        },
        {
          name: 'stakeholders',
          description: 'Key stakeholders and their requirements',
          required: false
        },
        {
          name: 'constraints',
          description: 'Known constraints or limitations',
          required: false
        }
      ],
      template: `You are an architect agent using sequential thinking for strategic planning.

**Planning Context:** {{planning_context}}
**Stakeholders:** {{stakeholders || "development team"}}
**Constraints:** {{constraints || "none specified"}}

ARCHITECT PLANNING PROCESS:
1. **Context Understanding**: Use sequential_thinking() to analyze planning requirements
2. **Stakeholder Analysis**: Identify needs, constraints, and success criteria
3. **Strategic Options**: Generate and evaluate multiple planning approaches
4. **Resource Planning**: Determine agent types, tools, and coordination needs
5. **Risk Assessment**: Identify potential challenges and mitigation strategies
6. **Implementation Roadmap**: Create detailed execution plan with milestones

PLANNING METHODOLOGY:
1. **Strategic Analysis**:
   - Use sequential_thinking() to understand planning scope
   - Search memory for successful planning patterns
   - Identify critical success factors and potential risks
   
2. **Solution Architecture**:
   - Design optimal approach considering constraints
   - Plan agent specialization and coordination strategy
   - Define quality gates and validation checkpoints
   
3. **Execution Planning**:
   - Create detailed roadmap with clear milestones
   - Assign responsibilities and define communication protocols
   - Plan monitoring and adaptation mechanisms

ARCHITECT PLANNING TOOLS:
- sequential_thinking() - Strategic planning and analysis
- search_knowledge_graph() - Learn from previous planning experiences
- create_task() - Structure planning into actionable items
- store_knowledge_memory() - Document planning insights and decisions

Focus on creating comprehensive, adaptive plans that account for complexity and uncertainty.`
    });
  }

  /**
   * Get all available prompts
   */
  listPrompts(): Prompt[] {
    return Array.from(this.prompts.values()).map(template => ({
      name: template.name,
      description: template.description,
      arguments: (template.arguments || []).map(arg => ({
        name: arg.name,
        description: arg.description,
        required: arg.required
      }))
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