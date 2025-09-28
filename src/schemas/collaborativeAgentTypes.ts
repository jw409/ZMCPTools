/**
 * Enhanced Agent Type Definitions for Three-Agent Collaborative Teams
 * Addresses Issue #22: Implement Collaborative Agent Architecture
 */

import type { AgentTypeDefinitions, ToolCategory } from './agents.js';

/**
 * Enhanced permissions for collaborative agent teams
 * Fixes permission starvation issue by providing generous but secure tool access
 */
export const COLLABORATIVE_AGENT_PERMISSIONS: AgentTypeDefinitions = {
  // 🎯 PLANNER/BOSS AGENT - The Strategic Coordinator
  planner_agent: {
    description: 'Strategic planner and boss agent that coordinates team activities, makes decisions, and manages objectives',
    defaultCapabilities: [
      'strategic_planning',
      'team_coordination',
      'decision_making',
      'objective_management',
      'knowledge_synthesis'
    ],
    defaultAllowedCategories: [
      'core_tools',           // Read, Write, Edit, MultiEdit, LS, Glob, Grep
      'communication_tools',  // join_room, send_message, wait_for_messages
      'knowledge_graph_tools', // store_knowledge_memory, search_knowledge_graph
      'orchestration_tools',  // orchestrate_objective, create_task
      'analysis_tools',       // analyze_project_structure, generate_project_summary
      'thinking_tools',       // sequential_thinking for complex analysis
      'file_tools'            // list_files, find_files for understanding structure
    ],
    // Planners should NOT execute code or spawn agents directly
    defaultDisallowedCategories: [
      'execution_tools',      // No Bash execution - delegates to implementers
      'agent_tools'           // No spawn_agent - managed by orchestration
    ],
    autoCreateRoom: true,
    roomNamingPattern: 'collab-planner_{timestamp}',
    maxConcurrentAgents: 3  // Allow multiple planning sessions
  },

  // 🔧 IMPLEMENTER AGENT - The Code Executor
  implementer_agent: {
    description: 'Implementer agent specialized in coding, building, and execution based on planner specifications',
    defaultCapabilities: [
      'code_implementation',
      'software_building',
      'execution_management',
      'technical_problem_solving',
      'file_operations'
    ],
    defaultAllowedCategories: [
      'core_tools',           // Read, Write, Edit, MultiEdit, LS, Glob, Grep
      'execution_tools',      // Bash - CRITICAL for implementation work
      'communication_tools',  // join_room, send_message, wait_for_messages
      'knowledge_graph_tools', // store_knowledge_memory, search_knowledge_graph
      'file_tools',           // list_files, find_files, easy_replace
      'analysis_tools'        // analyze_project_structure, analyze_file_symbols
    ],
    // Implementers should NOT orchestrate or spawn other agents
    defaultDisallowedCategories: [
      'agent_tools',          // No spawn_agent - focus on implementation
      'orchestration_tools',  // No orchestrate_objective - follow planner's lead
      'browser_tools',        // Specialized agents handle browser testing
      'web_tools'             // Not needed for pure implementation
    ],
    autoCreateRoom: true,
    roomNamingPattern: 'collab-implementer_{timestamp}',
    maxConcurrentAgents: 5  // Allow multiple implementers in parallel
  },

  // 🧪 TESTER/VERIFIER AGENT - The Quality Guardian
  tester_agent: {
    description: 'Tester and verifier agent focused on validation, testing, and quality assurance',
    defaultCapabilities: [
      'test_execution',
      'quality_verification',
      'validation_testing',
      'browser_automation',
      'test_reporting'
    ],
    defaultAllowedCategories: [
      'core_tools',           // Read, Write, Edit, MultiEdit, LS, Glob, Grep
      'execution_tools',      // Bash - CRITICAL for running tests
      'communication_tools',  // join_room, send_message, wait_for_messages
      'knowledge_graph_tools', // store_knowledge_memory, search_knowledge_graph
      'file_tools',           // list_files, find_files for test discovery
      'analysis_tools',       // analyze_project_structure for test planning
      'browser_tools'         // Browser automation for E2E testing
    ],
    // Testers should NOT orchestrate, spawn agents, or scrape web
    defaultDisallowedCategories: [
      'agent_tools',          // No spawn_agent - focus on testing
      'orchestration_tools',  // No orchestrate_objective - follow planner's lead
      'web_tools'             // No web scraping - focus on testing existing code
    ],
    autoCreateRoom: true,
    roomNamingPattern: 'collab-tester_{timestamp}',
    maxConcurrentAgents: 3  // Allow multiple test environments
  }
};

/**
 * Enhanced tool category mappings with additional MCP tools
 * Includes new unified search and code acquisition tools
 */
export const ENHANCED_TOOL_CATEGORY_MAPPINGS: Record<ToolCategory, string[]> = {
  core_tools: [
    'Read', 'Write', 'Edit', 'MultiEdit', 'LS', 'Glob', 'Grep'
  ],
  execution_tools: [
    'Bash',
    'Task'
  ],
  communication_tools: [
    'mcp__zmcp-tools__join_room',
    'mcp__zmcp-tools__send_message',
    'mcp__zmcp-tools__wait_for_messages',
    'mcp__zmcp-tools__list_rooms',
    'mcp__zmcp-tools__list_room_messages'
  ],
  knowledge_graph_tools: [
    'mcp__zmcp-tools__store_knowledge_memory',
    'mcp__zmcp-tools__search_knowledge_graph',
    'mcp__zmcp-tools__find_related_entities',
    'mcp__zmcp-tools__create_knowledge_relationship',
    'mcp__zmcp-tools__get_memory_status',
    // NEW: Unified search tools
    'search_knowledge_graph_unified',
    'acquire_repository',
    'list_acquisitions',
    'remove_acquisition'
  ],
  agent_tools: [
    'mcp__zmcp-tools__spawn_agent',
    'mcp__zmcp-tools__list_agents',
    'mcp__zmcp-tools__cleanup_stale_agents',
    'mcp__zmcp-tools__monitor_agents',
    'mcp__zmcp-tools__get_agent_results'
  ],
  orchestration_tools: [
    'mcp__zmcp-tools__orchestrate_objective',
    'mcp__zmcp-tools__orchestrate_objective_structured',
    'mcp__zmcp-tools__create_task'
  ],
  file_tools: [
    'mcp__zmcp-tools__list_files',
    'mcp__zmcp-tools__find_files',
    'mcp__zmcp-tools__easy_replace'
  ],
  analysis_tools: [
    'mcp__zmcp-tools__analyze_project_structure',
    'mcp__zmcp-tools__generate_project_summary',
    'mcp__zmcp-tools__analyze_file_symbols',
    'mcp__zmcp-tools__find_files'
  ],
  browser_tools: [
    'mcp__zmcp-tools__create_browser_session',
    'mcp__zmcp-tools__navigate_and_scrape',
    'mcp__zmcp-tools__interact_with_page',
    'mcp__zmcp-tools__search_dom_elements',
    'mcp__zmcp-tools__manage_browser_sessions'
  ],
  web_tools: [
    'mcp__zmcp-tools__scrape_documentation',
    'mcp__zmcp-tools__get_scraping_status',
    'mcp__zmcp-tools__start_scraping_worker',
    'mcp__zmcp-tools__stop_scraping_worker'
  ],
  cache_tools: [
    'mcp__zmcp-tools__create_foundation_session',
    'mcp__zmcp-tools__derive_session_from_foundation',
    'mcp__zmcp-tools__get_cached_analysis',
    'mcp__zmcp-tools__cache_analysis_result'
  ],
  tree_tools: [
    'mcp__zmcp-tools__update_file_analysis',
    'mcp__zmcp-tools__get_project_overview',
    'mcp__zmcp-tools__cleanup_stale_analyses'
  ],
  thinking_tools: [
    'mcp__sequential-thinking__sequential_thinking'
  ]
};

/**
 * Validation rules for collaborative agent permissions
 */
export const COLLABORATIVE_PERMISSION_RULES = {
  // Planners must have orchestration and communication tools
  planner_required_categories: ['orchestration_tools', 'communication_tools', 'knowledge_graph_tools'],

  // Implementers must have execution tools
  implementer_required_categories: ['execution_tools', 'communication_tools', 'file_tools'],

  // Testers must have execution and browser tools
  tester_required_categories: ['execution_tools', 'communication_tools', 'browser_tools'],

  // All agents must have core tools and communication
  all_agents_required_categories: ['core_tools', 'communication_tools']
};

/**
 * Helper function to validate collaborative agent permissions
 */
export function validateCollaborativePermissions(agentType: string, allowedCategories: ToolCategory[]): {
  valid: boolean;
  missing: ToolCategory[];
  suggestions: string[];
} {
  const rules = COLLABORATIVE_PERMISSION_RULES;
  let requiredCategories: ToolCategory[] = [...rules.all_agents_required_categories];

  // Add role-specific requirements
  switch(agentType) {
    case 'planner_agent':
      requiredCategories.push(...rules.planner_required_categories);
      break;
    case 'implementer_agent':
      requiredCategories.push(...rules.implementer_required_categories);
      break;
    case 'tester_agent':
      requiredCategories.push(...rules.tester_required_categories);
      break;
  }

  const missing = requiredCategories.filter(cat => !allowedCategories.includes(cat));

  const suggestions = [];
  if (missing.length > 0) {
    suggestions.push(`Add missing categories: ${missing.join(', ')}`);
  }

  if (agentType === 'implementer_agent' && !allowedCategories.includes('execution_tools')) {
    suggestions.push('Implementer agents MUST have execution_tools to run code');
  }

  if (agentType === 'planner_agent' && allowedCategories.includes('execution_tools')) {
    suggestions.push('Planner agents should delegate execution, not run code directly');
  }

  return {
    valid: missing.length === 0,
    missing,
    suggestions
  };
}