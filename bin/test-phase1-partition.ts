#!/usr/bin/env tsx
/**
 * Phase 1 Test: Partition Classification and Authority Weighting
 * Validates that files are classified correctly and authority scores are applied
 */

import { getPartitionClassifier } from '../src/services/PartitionClassifier.js';

function testPartitionClassification() {
  console.log('='.repeat(80));
  console.log('PHASE 1: PARTITION CLASSIFICATION TEST');
  console.log('='.repeat(80));

  const classifier = getPartitionClassifier();

  // Test cases covering all partition types
  const testCases = [
    {
      path: '/home/jw/dev/game1/CLAUDE.md',
      expectedPartition: 'dom0',
      expectedAuthority: 0.95,
      description: 'Constitutional file'
    },
    {
      path: '/home/jw/dev/game1/etc/prompts/BOOTSTRAP.md',
      expectedPartition: 'dom0',
      expectedAuthority: 0.95,
      description: 'Constitutional prompt'
    },
    {
      path: '/home/jw/dev/game1/docs/typescript/api-reference.md',
      expectedPartition: 'lang_typescript',
      expectedAuthority: 0.85,
      description: 'TypeScript language spec'
    },
    {
      path: '/home/jw/dev/game1/docs/python/stdlib.md',
      expectedPartition: 'lang_python',
      expectedAuthority: 0.85,
      description: 'Python language spec'
    },
    {
      path: '/home/jw/dev/game1/etc/prompts/role_backend.md',
      expectedPartition: 'role_backend',
      expectedAuthority: 0.70,
      description: 'Backend role pattern'
    },
    {
      path: '/home/jw/dev/game1/talent-os/talents/becky-ops/skill.py',
      expectedPartition: 'talent_becky-ops',
      expectedAuthority: 0.50,
      description: 'Talent memory'
    },
    {
      path: '/home/jw/dev/game1/ZMCPTools/src/services/BM25Service.ts',
      expectedPartition: 'project',
      expectedAuthority: 0.35,
      description: 'Project implementation'
    },
    {
      path: '/home/jw/dev/game1/var/session/experiment_123.ts',
      expectedPartition: 'session',
      expectedAuthority: 0.20,
      description: 'Session work'
    },
    {
      path: '/home/jw/dev/game1/var/whiteboard/scratch_notes.md',
      expectedPartition: 'whiteboard',
      expectedAuthority: 0.10,
      description: 'Whiteboard scratch'
    }
  ];

  let passCount = 0;
  let failCount = 0;

  console.log('\nTesting partition classification:\n');

  for (const testCase of testCases) {
    const result = classifier.classify(testCase.path);
    const partitionMatch = result.partition === testCase.expectedPartition;
    const authorityMatch = result.authority === testCase.expectedAuthority;
    const passed = partitionMatch && authorityMatch;

    if (passed) {
      passCount++;
      console.log(`✅ ${testCase.description}`);
      console.log(`   Path: ${testCase.path}`);
      console.log(`   Partition: ${result.partition} (${result.authority.toFixed(2)} authority)`);
    } else {
      failCount++;
      console.log(`❌ ${testCase.description}`);
      console.log(`   Path: ${testCase.path}`);
      console.log(`   Expected: ${testCase.expectedPartition} @ ${testCase.expectedAuthority}`);
      console.log(`   Got: ${result.partition} @ ${result.authority}`);
    }
    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`✅ Passed: ${passCount}/${testCases.length}`);
  console.log(`❌ Failed: ${failCount}/${testCases.length}`);

  if (failCount === 0) {
    console.log('\n🎉 All partition classification tests passed!');
    console.log('\nPhase 1 implementation verified:');
    console.log('  • PartitionClassifier correctly identifies all partition types');
    console.log('  • Authority scores match hierarchy (dom0: 0.95 → whiteboard: 0.10)');
    console.log('  • Ready for authority-weighted search integration');
    return true;
  } else {
    console.log('\n❌ Some tests failed. Phase 1 implementation needs fixes.');
    return false;
  }
}

// Run tests
const success = testPartitionClassification();
process.exit(success ? 0 : 1);
