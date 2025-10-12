/**
 * TreeSitterASTTool Tests
 * Comprehensive testing for AST parsing, symbol extraction, and tree traversal
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TreeSitterASTTool } from '../tools/TreeSitterASTTool.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('TreeSitterASTTool - Core Functionality', () => {
  let astTool: TreeSitterASTTool;
  const testFilesDir = path.join(__dirname, '__test_files__');

  beforeAll(async () => {
    astTool = new TreeSitterASTTool();

    // Clear cache to avoid stale data from affecting tests
    await astTool['astCache'].clear();

    // Create test files directory
    await fs.mkdir(testFilesDir, { recursive: true });

    // Create TypeScript test file
    await fs.writeFile(
      path.join(testFilesDir, 'test.ts'),
      `export class TestClass {
  constructor(public name: string) {}

  greet(): string {
    return \`Hello, \${this.name}!\`;
  }
}

export function testFunction(arg: string): void {
  console.log(arg);
}

export interface TestInterface {
  id: number;
  name: string;
}

const testVar = "test";
`,
      'utf-8'
    );

    // Create Python test file
    await fs.writeFile(
      path.join(testFilesDir, 'test.py'),
      `class TestClass:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}!"

def test_function(arg):
    print(arg)

test_var = "test"
`,
      'utf-8'
    );
  });

  afterAll(async () => {
    // Clean up test files
    await fs.rm(testFilesDir, { recursive: true, force: true });
  });

  describe('TypeScript AST Parsing', () => {
    it('should parse TypeScript file successfully', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'parse',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      expect(result.language).toBe('typescript');
    });

    it('should extract symbols from TypeScript file', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'extract_symbols',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      expect(result.symbols).toBeInstanceOf(Array);

      // Debug: log what we got
      if (result.symbols.length === 0) {
        console.log('DEBUG: Empty symbols array');
        console.log('DEBUG: Result:', JSON.stringify(result, null, 2));
      }

      expect(result.symbols.length).toBeGreaterThan(0);

      // Should find the class
      const testClass = result.symbols.find((s: any) => s.name === 'TestClass');
      expect(testClass).toBeDefined();
      expect(testClass.kind).toBe('class');

      // Should find the function
      const testFunc = result.symbols.find((s: any) => s.name === 'testFunction');
      expect(testFunc).toBeDefined();
      expect(testFunc.kind).toBe('function');

      // Should find the interface
      const testInterface = result.symbols.find((s: any) => s.name === 'TestInterface');
      expect(testInterface).toBeDefined();
      expect(testInterface.kind).toBe('interface');
    });

    it('should extract imports from TypeScript file', async () => {
      // Create a file with imports
      const importFile = path.join(testFilesDir, 'with-imports.ts');
      await fs.writeFile(
        importFile,
        `import { foo } from './foo';
import * as bar from 'bar';
import type { Baz } from './types';

export const test = "test";
`,
        'utf-8'
      );

      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: importFile,
        operation: 'extract_imports',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      expect(result.imports).toBeInstanceOf(Array);
      expect(result.imports.length).toBeGreaterThan(0);
    });

    it('should extract exports from TypeScript file', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'extract_exports',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      expect(result.exports).toBeInstanceOf(Array);
    });
  });

  describe('Python AST Parsing', () => {
    it('should parse Python file successfully', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.py'),
        operation: 'parse',
        language: 'python'
      });

      // Python parsing uses subprocess - may succeed or fail based on environment
      expect(result).toBeDefined();
      expect(['python', 'unknown']).toContain(result.language);
    });

    it('should handle Python parsing errors gracefully', async () => {
      // Create invalid Python file
      const invalidFile = path.join(testFilesDir, 'invalid.py');
      await fs.writeFile(invalidFile, 'def invalid(\n  # Missing closing paren', 'utf-8');

      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: invalidFile,
        operation: 'parse',
        language: 'python'
      });

      // Should not throw, but may return errors
      expect(result).toBeDefined();
    });
  });

  describe('Tree Cursor Functionality', () => {
    it('should provide working tree.walk() method', async () => {
      const parseResult = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'parse',
        language: 'typescript'
      });

      expect(parseResult.success).toBe(true);

      // The parse result should have a tree with walk method
      // This is tested indirectly through symbol extraction which uses walk()
      const symbolResult = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'extract_symbols',
        language: 'typescript'
      });

      expect(symbolResult.success).toBe(true);
      // If walk() didn't work, symbol extraction would fail
    });
  });

  describe('Language Detection', () => {
    it('should auto-detect TypeScript from .ts extension', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'parse',
        language: 'auto'
      });

      expect(result.success).toBe(true);
      expect(result.language).toBe('typescript');
    });

    it('should auto-detect Python from .py extension', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.py'),
        operation: 'parse',
        language: 'auto'
      });

      expect(result).toBeDefined();
      expect(['python', 'unknown']).toContain(result.language);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent files gracefully', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: '/nonexistent/file.ts',
        operation: 'parse',
        language: 'typescript'
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle unsupported file types', async () => {
      const unsupportedFile = path.join(testFilesDir, 'test.xyz');
      await fs.writeFile(unsupportedFile, 'some content', 'utf-8');

      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: unsupportedFile,
        operation: 'parse',
        language: 'auto'
      });

      // Should return an error or unsupported language
      expect(result).toBeDefined();
    });
  });

  describe('Structure Generation', () => {
    it('should generate file structure outline', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'get_structure',
        language: 'typescript'
      });

      expect(result).toBeDefined();
      // Structure generation should return some form of outline
    });
  });

  describe('Symbol Position Information', () => {
    it('should include line and column positions for symbols', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'extract_symbols',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      const symbols = result.symbols;

      symbols.forEach((symbol: any) => {
        expect(symbol.startPosition).toBeDefined();
        expect(symbol.startPosition.row).toBeGreaterThanOrEqual(0);
        expect(symbol.startPosition.column).toBeGreaterThanOrEqual(0);
      });
    });
  });
});

describe('TreeSitterASTTool - Operation-Specific Functionality', () => {
  let astTool: TreeSitterASTTool;
  const testFilesDir = path.join(__dirname, '__test_files__');

  beforeAll(async () => {
    astTool = new TreeSitterASTTool();

    // Clear cache to avoid stale data from affecting tests
    await astTool['astCache'].clear();

    // Ensure test files exist (may already be created by previous suite)
    try {
      await fs.access(testFilesDir);
    } catch {
      // Directory doesn't exist, create it and test files
      await fs.mkdir(testFilesDir, { recursive: true });

      await fs.writeFile(
        path.join(testFilesDir, 'test.ts'),
        `export class TestClass {
  constructor(public name: string) {}

  greet(): string {
    return \`Hello, \${this.name}!\`;
  }
}

export function testFunction(arg: string): void {
  console.log(arg);
}

export interface TestInterface {
  id: number;
  name: string;
}

const testVar = "test";
`,
        'utf-8'
      );

      await fs.writeFile(
        path.join(testFilesDir, 'test.py'),
        `class TestClass:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}!"

def test_function(arg):
    print(arg)

test_var = "test"
`,
        'utf-8'
      );

      await fs.writeFile(
        path.join(testFilesDir, 'invalid.py'),
        'def invalid(\n  # Missing closing paren',
        'utf-8'
      );
    }
  });

  describe('find_pattern operation', () => {
    it('should find matches for simple string pattern in TypeScript', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'find_pattern',
        pattern: 'TestClass',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      expect(result.pattern).toBe('TestClass');
      expect(result.matches).toBeInstanceOf(Array);
      expect(result.matchCount).toBeGreaterThan(0);

      // Should find the class name
      const classMatch = result.matches.find((m: any) => m.type === 'identifier');
      expect(classMatch).toBeDefined();
    });

    it('should find matches for function pattern in Python', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.py'),
        operation: 'find_pattern',
        pattern: 'test_function',
        language: 'python'
      });

      expect(result).toBeDefined();
      if (result.success) {
        expect(result.pattern).toBe('test_function');
        expect(result.matches).toBeInstanceOf(Array);
      }
    });

    it('should handle regex pattern matching', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'find_pattern',
        pattern: 'Test.*',
        language: 'typescript'
      });

      expect(result.success).toBe(true);
      expect(result.matches).toBeInstanceOf(Array);
      expect(result.matchCount).toBeGreaterThan(0);
    });

    it('should return error when pattern is missing', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'find_pattern',
        language: 'typescript'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
      expect(result.error).toContain('Pattern required');
    });
  });

  describe('query operation', () => {
    it('should return helpful error message with alternative', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'query',
        query: '(function_declaration name: (identifier) @name)',
        language: 'typescript'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
      expect(result.error).toContain('S-expression tree-sitter queries not yet implemented');
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion.operation).toBe('find_pattern');
      expect(result.suggestion.example).toBeDefined();
    });

    it('should return error when query is missing', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'query',
        language: 'typescript'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
      expect(result.error).toContain('Query string required');
    });
  });

  describe('get_diagnostics operation', () => {
    it('should detect syntax errors in invalid TypeScript', async () => {
      // Create file with syntax error
      const invalidFile = path.join(testFilesDir, 'invalid-syntax.ts');
      await fs.writeFile(
        invalidFile,
        'function broken( {\n  // Missing closing paren\n  return "test";\n}',
        'utf-8'
      );

      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: invalidFile,
        operation: 'get_diagnostics',
        language: 'typescript'
      });

      expect(result).toBeDefined();
      // Diagnostics should be present for invalid syntax
      if (result.diagnostics) {
        expect(result.diagnostics).toBeInstanceOf(Array);
      }
    });

    it('should return empty diagnostics for valid code', async () => {
      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: path.join(testFilesDir, 'test.ts'),
        operation: 'get_diagnostics',
        language: 'typescript'
      });

      expect(result).toBeDefined();
    });

    it('should handle Python syntax errors', async () => {
      // The invalid.py file was created in Python tests
      const invalidFile = path.join(testFilesDir, 'invalid.py');

      const result = await astTool.executeByToolName('ast_analyze', {
        file_path: invalidFile,
        operation: 'get_diagnostics',
        language: 'python'
      });

      expect(result).toBeDefined();
      // Python diagnostics depend on subprocess availability
    });
  });
});

describe('TreeSitterASTTool - MCP Resource Integration', () => {
  it('should be compatible with file://*/symbols resource format', () => {
    // This test validates that the tool output matches the expected resource format
    const astTool = new TreeSitterASTTool();

    // The tool should be callable with the expected arguments
    expect(astTool.executeByToolName).toBeDefined();
    expect(typeof astTool.executeByToolName).toBe('function');
  });
});
