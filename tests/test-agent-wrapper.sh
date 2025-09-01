#!/bin/bash

echo "🧪 Testing ZMCPTools Agent Wrapper Integration"
echo ""
echo "This test will spawn agents and check if they use the wrapper with unique process names."
echo ""
echo "1. First, let's check if any agents are currently running:"
ps aux | grep -E "zmcp-[a-z]{2}-" | grep -v grep || echo "   No wrapped agents currently running"

echo ""
echo "2. Now spawn a test agent using MCP tools..."
echo "   In Claude, run: mcp__zmcp-tools__spawn_agent"
echo "   with parameters:"
echo '   {
     "agent_name": "test-wrapper",
     "agent_type": "backend",
     "repository_path": ".",
     "prompt": "Say hello and list files",
     "capabilities": ["file_operations"]
   }'

echo ""
echo "3. After spawning, run this command to see the wrapper process:"
echo "   ps aux | grep zmcp-"
echo ""
echo "Expected output format: zmcp-be-<project>-<agentid>"
echo "Where:"
echo "  - be = backend (agent type abbreviation)"
echo "  - project = project directory name"
echo "  - agentid = unique agent identifier"