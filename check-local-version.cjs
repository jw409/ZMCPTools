#!/usr/bin/env node

// Quick script to verify local ZMCPTools installation

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Checking ZMCPTools installation...\n');

// Check if local build exists
const localBuildPath = path.join(__dirname, 'dist/server/index.js');
if (fs.existsSync(localBuildPath)) {
  console.log('✅ Local build found at:', localBuildPath);
  
  // Check for our test marker
  const content = fs.readFileSync(localBuildPath, 'utf8');
  if (content.includes('USING LOCAL ZMCP-TOOLS BUILD WITH FIXES')) {
    console.log('✅ Local version marker found!');
    console.log('   This proves you are using the local build with all fixes');
  } else {
    console.log('❌ Local version marker NOT found');
  }
} else {
  console.log('❌ Local build not found');
}

// Check Claude settings
const settingsPath = path.join(process.env.HOME, '.claude/settings.local.json');
if (fs.existsSync(settingsPath)) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const mcpServers = settings.mcpServers || {};
  
  if (mcpServers['claude-mcp-tools']) {
    const server = mcpServers['claude-mcp-tools'];
    console.log('\n📋 MCP Server Configuration:');
    console.log('  Command:', server.command);
    console.log('  Args:', server.args?.join(' ') || 'none');
    
    // Check if it's using local path
    if (server.command.includes('/home/jw/dev/ZMCPTools')) {
      console.log('  ✅ Using local ZMCPTools installation!');
    } else {
      console.log('  ❌ Not using local installation');
    }
  }
}

// Check for running agents with wrapper
console.log('\n🔄 Checking for running agents:');
try {
  const agents = execSync('ps aux | grep zmcp- | grep -v grep', { encoding: 'utf8' });
  if (agents.trim()) {
    console.log('✅ Agent wrappers found:');
    agents.split('\n').filter(Boolean).forEach(line => {
      const match = line.match(/zmcp-(\w+)-/);
      if (match) {
        console.log(`  - ${match[0]}`);
      }
    });
  } else {
    console.log('  No agents currently running');
  }
} catch (e) {
  console.log('  No agents currently running');
}

console.log('\n✨ To verify in a new Claude session:');
console.log('1. Run an MCP tool that spawns an agent');
console.log('2. Check process names with: ps aux | grep zmcp-');
console.log('3. Test knowledge graph search - should filter results properly');