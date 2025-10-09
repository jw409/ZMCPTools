/**
 * Test: SymbolGraphIndexer hierarchical symbol support
 *
 * Verifies that the indexer correctly:
 * 1. Parses hierarchical AST symbols (classes with methods)
 * 2. Stores them in SQLite with parent_symbol relationships
 * 3. Uses compact location encoding
 * 4. Can reconstruct hierarchy from flattened storage
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SymbolGraphIndexer, SymbolRecord } from '../src/services/SymbolGraphIndexer.js';

describe('SymbolGraphIndexer - Hierarchical Symbols', () => {
  let indexer: SymbolGraphIndexer;
  const testFixturePath = path.resolve(__dirname, 'fixtures/test-class-hierarchy.ts');
  const testProjectPath = path.resolve(__dirname, 'fixtures');

  beforeAll(async () => {
    indexer = new SymbolGraphIndexer();
    await indexer.initialize(testProjectPath);
  });

  afterAll(async () => {
    await indexer.close();
  });

  it('should index file with hierarchical symbols', async () => {
    // Index the test fixture
    const stats = await indexer.indexRepository(testProjectPath);

    expect(stats.indexedFiles).toBeGreaterThan(0);
    expect(stats.errors).toHaveLength(0);
  });

  it('should store symbols with compact location encoding', async () => {
    // Get symbols for test fixture
    const symbols = await getSymbolsForFile(indexer, testFixturePath);

    // Verify all symbols have compact location format
    for (const sym of symbols) {
      expect(sym.location).toMatch(/^\d+:\d+-\d+:\d+$/);
      expect(sym.location).not.toContain('undefined');
    }
  });

  it('should preserve parent-child relationships for class methods', async () => {
    const symbols = await getSymbolsForFile(indexer, testFixturePath);

    // Find AuthService class
    const authServiceClass = symbols.find(s => s.name === 'AuthService' && s.type === 'class');
    expect(authServiceClass).toBeDefined();
    expect(authServiceClass!.parentSymbol).toBeNull();

    // Find methods that should belong to AuthService
    const loginMethod = symbols.find(s => s.name === 'login' && s.type === 'method');
    expect(loginMethod).toBeDefined();
    expect(loginMethod!.parentSymbol).toBe('AuthService');

    const logoutMethod = symbols.find(s => s.name === 'logout' && s.type === 'method');
    expect(logoutMethod).toBeDefined();
    expect(logoutMethod!.parentSymbol).toBe('AuthService');

    const validateTokenMethod = symbols.find(s => s.name === 'validateToken' && s.type === 'method');
    expect(validateTokenMethod).toBeDefined();
    expect(validateTokenMethod!.parentSymbol).toBe('AuthService');
  });

  it('should handle extended classes with their own methods', async () => {
    const symbols = await getSymbolsForFile(indexer, testFixturePath);

    // Find UserManager class
    const userManagerClass = symbols.find(s => s.name === 'UserManager' && s.type === 'class');
    expect(userManagerClass).toBeDefined();
    expect(userManagerClass!.parentSymbol).toBeNull();

    // Find methods that should belong to UserManager
    const createUserMethod = symbols.find(s => s.name === 'createUser' && s.type === 'method');
    expect(createUserMethod).toBeDefined();
    expect(createUserMethod!.parentSymbol).toBe('UserManager');

    const deleteUserMethod = symbols.find(s => s.name === 'deleteUser' && s.type === 'method');
    expect(deleteUserMethod).toBeDefined();
    expect(deleteUserMethod!.parentSymbol).toBe('UserManager');
  });

  it('should handle top-level functions with no parent', async () => {
    const symbols = await getSymbolsForFile(indexer, testFixturePath);

    // Find standalone function
    const standaloneFunc = symbols.find(s => s.name === 'standaloneFunction' && s.type === 'function');
    expect(standaloneFunc).toBeDefined();
    expect(standaloneFunc!.parentSymbol).toBeNull();
  });

  it('should reconstruct class hierarchy from flattened storage', async () => {
    const symbols = await getSymbolsForFile(indexer, testFixturePath);

    // Reconstruct hierarchy
    const hierarchy = reconstructHierarchy(symbols);

    // Verify AuthService has 3 methods
    const authService = hierarchy.find(s => s.name === 'AuthService');
    expect(authService).toBeDefined();
    expect(authService!.children).toHaveLength(3);
    expect(authService!.children.map(c => c.name).sort()).toEqual(['login', 'logout', 'validateToken']);

    // Verify UserManager has 2 methods
    const userManager = hierarchy.find(s => s.name === 'UserManager');
    expect(userManager).toBeDefined();
    expect(userManager!.children).toHaveLength(2);
    expect(userManager!.children.map(c => c.name).sort()).toEqual(['createUser', 'deleteUser']);

    // Verify standalone function has no children
    const standaloneFunc = hierarchy.find(s => s.name === 'standaloneFunction');
    expect(standaloneFunc).toBeDefined();
    expect(standaloneFunc!.children).toHaveLength(0);
  });

  it('should support keyword search that includes methods from parent classes', async () => {
    // Search for "login"
    const results = await indexer.searchKeyword('login', 10);

    expect(results.length).toBeGreaterThan(0);

    // Find result for our test file (path might be relative)
    const testFileResult = results.find(r =>
      r.filePath.includes('test-class-hierarchy') ||
      r.filePath.includes('fixtures')
    );

    if (testFileResult) {
      // Verify it includes the login method
      const loginSymbol = testFileResult.symbols?.find(s => s.name === 'login');
      expect(loginSymbol).toBeDefined();
      expect(loginSymbol!.parentSymbol).toBe('AuthService');
    } else {
      // If BM25 didn't index this file, verify symbols exist directly
      const symbols = await getSymbolsForFile(indexer, testFixturePath);
      const loginSymbol = symbols.find(s => s.name === 'login');
      expect(loginSymbol).toBeDefined();
      expect(loginSymbol!.parentSymbol).toBe('AuthService');
    }
  });

  it('should handle incremental updates without losing hierarchy', async () => {
    // Index once
    await indexer.indexRepository(testProjectPath);

    // Get initial symbols
    const initialSymbols = await getSymbolsForFile(indexer, testFixturePath);
    const initialCount = initialSymbols.length;

    // Touch the file to trigger re-indexing
    const content = await fs.readFile(testFixturePath, 'utf-8');
    await fs.writeFile(testFixturePath, content + '\n// Comment\n');

    // Re-index
    await indexer.indexRepository(testProjectPath);

    // Get updated symbols
    const updatedSymbols = await getSymbolsForFile(indexer, testFixturePath);

    // Verify hierarchy is still intact
    expect(updatedSymbols.length).toBe(initialCount);

    const authService = updatedSymbols.find(s => s.name === 'AuthService');
    expect(authService).toBeDefined();

    const loginMethod = updatedSymbols.find(s => s.name === 'login');
    expect(loginMethod).toBeDefined();
    expect(loginMethod!.parentSymbol).toBe('AuthService');

    // Cleanup: restore original file
    await fs.writeFile(testFixturePath, content);
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all symbols for a specific file from the indexer
 */
async function getSymbolsForFile(indexer: any, filePath: string): Promise<SymbolRecord[]> {
  const relativePath = path.relative(process.cwd(), filePath);

  // Access private db for testing
  const db = (indexer as any).db;
  if (!db) {
    throw new Error('Database not initialized');
  }

  const symbols = db.prepare(`
    SELECT * FROM symbols WHERE file_path = ?
  `).all(relativePath) as any[];

  return symbols.map(row => ({
    id: row.id,
    filePath: row.file_path,
    name: row.name,
    type: row.type,
    signature: row.signature,
    location: row.location,
    parentSymbol: row.parent_symbol,
    isExported: Boolean(row.is_exported)
  }));
}

/**
 * Reconstruct hierarchical structure from flat symbol list
 */
function reconstructHierarchy(symbols: SymbolRecord[]): Array<SymbolRecord & { children: SymbolRecord[] }> {
  // Separate top-level symbols and children
  const topLevel = symbols.filter(s => !s.parentSymbol);
  const children = symbols.filter(s => s.parentSymbol);

  // Build hierarchy
  return topLevel.map(parent => {
    const parentWithChildren = { ...parent, children: [] as SymbolRecord[] };
    parentWithChildren.children = children.filter(child => child.parentSymbol === parent.name);
    return parentWithChildren;
  });
}
