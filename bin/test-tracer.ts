#!/usr/bin/env node
/**
 * Simple test for TypeScript call tracer
 */

import { CallTracer } from './trace-wrapper';

// Create tracer
const tracer = new CallTracer('/tmp/ts-test-trace.jsonl', true);

// Test functions
function add(a: number, b: number): number {
  return a + b;
}

function multiply(a: number, b: number): number {
  return a * b;
}

function calculate(x: number, y: number): number {
  const sum = tracedAdd(x, y);
  const product = tracedMultiply(sum, 2);
  return product;
}

async function asyncOperation(value: number): Promise<number> {
  await new Promise(resolve => setTimeout(resolve, 10));
  return value * 2;
}

function throwingFunction(): void {
  throw new Error('This is a test error');
}

// Wrap functions
const tracedAdd = tracer.wrap(add, 'add');
const tracedMultiply = tracer.wrap(multiply, 'multiply');
const tracedCalculate = tracer.wrap(calculate, 'calculate');
const tracedAsync = tracer.wrap(asyncOperation, 'asyncOperation');
const tracedThrow = tracer.wrap(throwingFunction, 'throwingFunction');

async function main() {
  console.log('Testing TypeScript call tracer...');

  // Test simple calls
  const result1 = tracedAdd(5, 3);
  console.log(`add(5, 3) = ${result1}`);

  const result2 = tracedMultiply(4, 7);
  console.log(`multiply(4, 7) = ${result2}`);

  // Test nested calls
  const result3 = tracedCalculate(10, 20);
  console.log(`calculate(10, 20) = ${result3}`);

  // Test async
  const result4 = await tracedAsync(15);
  console.log(`asyncOperation(15) = ${result4}`);

  // Test exception
  try {
    tracedThrow();
  } catch (error) {
    console.log(`Caught expected error: ${(error as Error).message}`);
  }

  // Close tracer
  tracer.close();

  console.log('\nTrace file written to: /tmp/ts-test-trace.jsonl');
  console.log('Analyze with: npx tsx bin/trace-wrapper.ts analyze /tmp/ts-test-trace.jsonl');
}

main().catch(console.error);
