#!/usr/bin/env tsx
import { AsyncHook, createHook } from 'async_hooks';

// Track where we are in execution
const asyncOps = new Map<number, {type: string, stack: string}>();

const hook = createHook({
  init(asyncId, type, triggerAsyncId) {
    const stack = new Error().stack?.split('\n')[3] || 'unknown';
    asyncOps.set(asyncId, {type, stack});
  },
  before(asyncId) {
    const op = asyncOps.get(asyncId);
    if (op && (op.type === 'PROMISE' || op.type === 'ChildProcess')) {
      console.log(`>>> Entering ${op.type} at: ${op.stack}`);
    }
  },
  after(asyncId) {
    const op = asyncOps.get(asyncId);
    if (op && (op.type === 'PROMISE' || op.type === 'ChildProcess')) {
      console.log(`<<< Exiting ${op.type}`);
    }
  },
  destroy(asyncId) {
    asyncOps.delete(asyncId);
  }
});

hook.enable();

// Now import and run the spawner
import { ClaudeSpawner } from './src/process/ClaudeSpawner.js';

async function testSpawn() {
  console.log('\n=== STARTING TEST ===\n');
  const spawner = ClaudeSpawner.getInstance();

  const config = {
    prompt: 'What is 6 times 7? Just respond with the number.',
    workingDirectory: '/home/jw/dev/game1',
    model: 'sonnet',
    agentType: 'test',
    timeout: 3000  // 3 second timeout
  };

  try {
    console.log('>>> About to spawn agent');
    const process = await spawner.spawnClaudeAgent(config);
    console.log(`>>> Spawned with PID: ${process.pid}`);

    console.log('>>> About to call start()');
    await process.start();
    console.log('>>> start() returned');

    console.log('>>> Waiting for completion');
    await process.waitForCompletion();
    console.log('>>> Process completed!');
  } catch (error) {
    console.error('>>> Error caught:', error);
  } finally {
    hook.disable();
    process.exit(0);
  }
}

testSpawn();