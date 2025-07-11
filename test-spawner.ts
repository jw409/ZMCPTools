#!/usr/bin/env tsx

import { ClaudeSpawner, ClaudeSpawnConfig } from './src/process/ClaudeSpawner.js';

async function testClaudeSpawner() {
  console.log('Testing SDK-based ClaudeSpawner...\n');
  
  const spawner = ClaudeSpawner.getInstance();
  
  const config: ClaudeSpawnConfig = {
    workingDirectory: process.cwd(),
    prompt: 'Say hello and describe what tools you have access to. This is a test of the SDK-based spawner.',
    sessionId: `test-session-${Date.now()}`,
    model: 'claude-sonnet-4-0',
    allowedTools: ['Read', 'LS'],
    timeout: 30000 // 30 seconds
  };

  try {
    console.log(`Spawning Claude agent with config:`, {
      workingDirectory: config.workingDirectory,
      model: config.model,
      sessionId: config.sessionId,
      prompt: config.prompt.substring(0, 50) + '...'
    });
    
    const claudeProcess = await spawner.spawnClaudeAgent(config);
    
    console.log(`Agent spawned with PID: ${claudeProcess.pid}\n`);
    
    // Listen for stdout
    claudeProcess.on('stdout', ({ data, messageType, isJson }) => {
      if (isJson && messageType) {
        console.log(`[${messageType.toUpperCase()}]`, data.substring(0, 200) + '...\n');
      } else {
        console.log(`[OUTPUT]`, data, '\n');
      }
    });
    
    // Listen for stderr
    claudeProcess.on('stderr', ({ data }) => {
      console.error(`[ERROR]`, data, '\n');
    });
    
    // Listen for exit
    claudeProcess.on('exit', ({ code, signal }) => {
      console.log(`Agent exited with code ${code}, signal ${signal}`);
      process.exit(0);
    });
    
    // Listen for errors
    claudeProcess.on('error', ({ error }) => {
      console.error(`Agent error:`, error);
      process.exit(1);
    });
    
    console.log('Waiting for Claude to respond...\n');
    
    // Wait for process to complete or timeout
    setTimeout(() => {
      if (!claudeProcess.hasExited()) {
        console.log('Test timeout - terminating agent...');
        claudeProcess.terminate();
      }
    }, 35000);
    
  } catch (error) {
    console.error('Failed to spawn Claude agent:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, cleaning up...');
  const spawner = ClaudeSpawner.getInstance();
  spawner.cleanup();
  process.exit(0);
});

testClaudeSpawner().catch(console.error);