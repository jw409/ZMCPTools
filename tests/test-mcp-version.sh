#!/bin/bash

echo "🔍 Testing which ZMCPTools version Claude is using..."
echo ""

# Check if any zmcp processes are running
echo "1. Current zmcp processes:"
ps aux | grep -E "zmcp|claude-mcp-tools" | grep -v grep || echo "   None running"

echo ""
echo "2. To definitively test which version Claude is using:"
echo "   a) In Claude, run any MCP tool that logs something"
echo "   b) While it's running, in another terminal run:"
echo "      ps aux | grep node | grep -E 'zmcp|mcp-tools'"
echo "   c) Look at the full command path - it will show exactly which binary is running"
echo ""
echo "3. Check for the local install marker:"
echo "   If using local version, the process will load from:"
echo "   /home/jw/dev/ZMCPTools/dist/server/index.js"
echo ""
echo "4. The startup log will show:"
echo "   '🔧 USING LOCAL ZMCP-TOOLS BUILD WITH FIXES'"
echo "   (visible in Claude's debug output if verbose logging is enabled)"