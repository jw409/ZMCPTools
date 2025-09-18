#!/usr/bin/env tsx
import { ClaudeSpawner } from './src/process/ClaudeSpawner.js';

// Enable async hooks for tracing
import { AsyncLocalStorage, AsyncResource } from 'async_hooks';

async function testSpawn() {
  console.trace('Creating spawner...');
  const spawner = ClaudeSpawner.getInstance();

  console.log('Spawning agent with simple math task...');
  const config = {
    prompt: 'What is 6 times 7? Just respond with the number.',
    workingDirectory: '/home/jw/dev/game1',
    model: 'sonnet',
    agentType: 'test',
    timeout: 10000  // 10 second timeout
  };

  try {
    const process = await spawner.spawnClaudeAgent(config);
    console.log(`Spawned with PID: ${process.pid}`);

    // Listen for output
    process.on('data', (data) => {
      console.log('Got data:', data);
    });

    process.on('exit', ({code, signal}) => {
      console.log(`Process exited with code ${code}, signal ${signal}`);
    });

    // Start the process
    await process.start();
    console.log('Process started, waiting for completion...');

    // Wait for it to finish
    await process.waitForCompletion();
    console.log('Process completed!');

  } catch (error) {
    console.error('Error:', error);
  }
}

testSpawn();