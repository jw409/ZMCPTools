#!/bin/bash

echo "🧪 Testing Fixed Agent Spawning"
echo "================================"
echo ""
echo "This test will spawn an agent to analyze the backend structure"
echo "It should NOT fail with sequential_thinking tool error anymore"
echo ""
echo "Run this test in Claude Code after restarting to load the updated MCP server:"
echo ""
cat << 'EOF'
// Test 1: Simple agent spawn
await mcp__zmcp-tools__spawn_agent({
  agentType: "backend",
  task: "List all files in the src directory",
  workingDirectory: ".",
  prompt: "Please list all the files in the src directory and provide a brief summary."
})

// Test 2: Agent with knowledge graph
await mcp__zmcp-tools__spawn_agent({
  agentType: "analysis",
  task: "Analyze project and store insights",
  workingDirectory: ".",
  prompt: "Analyze the project structure and store key insights in the knowledge graph about the backend architecture."
})

// Test 3: Parallel agent orchestration
await mcp__zmcp-tools__orchestrate_objective({
  objective: "Analyze the backend and frontend structure of this project",
  repositoryPath: ".",
  foundationSessionId: "test-parallel-agents"
})
EOF

echo ""
echo "Monitor agent logs at: ~/.mcptools/logs/claude_agents/"
echo "Check for successful completion without 'sequential_thinking' errors"