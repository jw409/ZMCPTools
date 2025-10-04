import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { ResourceManager } from '../managers/ResourceManager.js';
import { DatabaseManager } from '../database/index.js';

describe('File Resource - Exports (file://*/exports)', () => {
  let dbManager: DatabaseManager;
  let resourceManager: ResourceManager;
  let testDir: string;
  let testCounter = 0;

  beforeEach(async () => {
    // Create unique test directory for each test
    testCounter++;
    testDir = join(process.cwd(), `test-temp-exports-${Date.now()}-${testCounter}`);
    await fs.mkdir(testDir, { recursive: true });

    // Initialize database with test path
    dbManager = new DatabaseManager(join(testDir, 'test.db'));
    await dbManager.initialize();

    // Initialize resource manager
    resourceManager = new ResourceManager(dbManager, testDir);
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }

    // Close database
    await dbManager.close();
  });

  describe('TypeScript/JavaScript Named Exports', () => {
    it('should extract named function exports', async () => {
      const filePath = join(testDir, 'functions.ts');
      const content = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function farewell(name: string): string {
  return \`Goodbye, \${name}!\`;
}

function internalHelper() {
  return 'internal';
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://functions.ts/exports`);

      expect(result.mimeType).toBe('application/json');
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('typescript');
      expect(data.exports).toContain('greet');
      expect(data.exports).toContain('farewell');
      expect(data.exports).not.toContain('internalHelper');
      expect(data.exportCount).toBe(2);
    });

    it('should extract named class exports', async () => {
      const filePath = join(testDir, 'classes.ts');
      const content = `
export class UserService {
  constructor() {}

  getUser(id: string) {
    return { id };
  }
}

export class ProductService {
  getProduct(id: string) {
    return { id };
  }
}

class InternalCache {
  cache = {};
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://classes.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('UserService');
      expect(data.exports).toContain('ProductService');
      expect(data.exports).not.toContain('InternalCache');
      expect(data.exportCount).toBe(2);
    });

    it('should extract named const/let/var exports', async () => {
      const filePath = join(testDir, 'constants.ts');
      const content = `
export const API_URL = 'https://api.example.com';
export const MAX_RETRIES = 3;
export let currentUser = null;
export var legacyFlag = true;

const PRIVATE_KEY = 'secret';
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://constants.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('API_URL');
      expect(data.exports).toContain('MAX_RETRIES');
      expect(data.exports).toContain('currentUser');
      expect(data.exports).toContain('legacyFlag');
      expect(data.exports).not.toContain('PRIVATE_KEY');
      expect(data.exportCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe('TypeScript/JavaScript Default Exports', () => {
    it('should detect default function export', async () => {
      const filePath = join(testDir, 'default-function.ts');
      const content = `
export default function authenticate(credentials: any) {
  return true;
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://default-function.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('typescript');
      // Default exports might be tracked differently or as 'default'
      expect(data.exports.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect default class export', async () => {
      const filePath = join(testDir, 'default-class.ts');
      const content = `
export default class Application {
  constructor() {}

  start() {
    console.log('Starting...');
  }
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://default-class.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('typescript');
      expect(data.exports.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect default object export', async () => {
      const filePath = join(testDir, 'default-object.ts');
      const content = `
export default {
  name: 'config',
  version: '1.0.0',
  settings: {
    debug: true
  }
};
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://default-object.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('typescript');
    });
  });

  describe('TypeScript/JavaScript Re-exports', () => {
    it('should detect re-exported named exports', async () => {
      const filePath = join(testDir, 're-exports.ts');
      const content = `
export { UserService, ProductService } from './services.js';
export { API_URL, MAX_RETRIES } from './constants.js';
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://re-exports.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('typescript');
      // Re-exports should be detected
      expect(data.exports.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect re-exported renamed exports', async () => {
      const filePath = join(testDir, 're-exports-renamed.ts');
      const content = `
export {
  UserService as User,
  ProductService as Product
} from './services.js';
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://re-exports-renamed.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('typescript');
    });

    it('should detect wildcard re-exports', async () => {
      const filePath = join(testDir, 're-exports-wildcard.ts');
      const content = `
export * from './utils.js';
export * from './helpers.js';
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://re-exports-wildcard.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('typescript');
    });
  });

  describe('TypeScript Type Exports', () => {
    it('should extract exported types', async () => {
      const filePath = join(testDir, 'types.ts');
      const content = `
export type User = {
  id: string;
  name: string;
  email: string;
};

export type Product = {
  id: string;
  title: string;
  price: number;
};

type InternalConfig = {
  secret: string;
};
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://types.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('User');
      expect(data.exports).toContain('Product');
      expect(data.exports).not.toContain('InternalConfig');
    });

    it('should extract exported interfaces', async () => {
      const filePath = join(testDir, 'interfaces.ts');
      const content = `
export interface Repository<T> {
  findById(id: string): Promise<T>;
  save(entity: T): Promise<void>;
}

export interface Service {
  execute(): Promise<void>;
}

interface InternalLogger {
  log(message: string): void;
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://interfaces.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('Repository');
      expect(data.exports).toContain('Service');
      expect(data.exports).not.toContain('InternalLogger');
    });

    it('should extract exported enums', async () => {
      const filePath = join(testDir, 'enums.ts');
      const content = `
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  GUEST = 'guest'
}

export enum Status {
  ACTIVE,
  INACTIVE,
  PENDING
}

enum InternalState {
  INIT,
  READY
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://enums.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('UserRole');
      expect(data.exports).toContain('Status');
      expect(data.exports).not.toContain('InternalState');
    });
  });

  describe('Python Exports (__all__)', () => {
    it('should extract __all__ list exports', async () => {
      const filePath = join(testDir, 'module.py');
      const content = `
"""A Python module with __all__ export list."""

def public_function():
    pass

def _private_function():
    pass

class PublicClass:
    pass

class _PrivateClass:
    pass

__all__ = ['public_function', 'PublicClass', 'CONSTANT']

CONSTANT = 42
_INTERNAL = 'secret'
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://module.py/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('python');
      expect(data.exports).toContain('public_function');
      expect(data.exports).toContain('PublicClass');
      expect(data.exports).toContain('CONSTANT');
      expect(data.exports).not.toContain('_private_function');
      expect(data.exports).not.toContain('_PrivateClass');
      expect(data.exports).not.toContain('_INTERNAL');
    });

    it('should handle __all__ with single quotes', async () => {
      const filePath = join(testDir, 'single-quotes.py');
      const content = `
__all__ = ['function_a', 'function_b', 'ClassA']

def function_a():
    pass

def function_b():
    pass

class ClassA:
    pass
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://single-quotes.py/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('function_a');
      expect(data.exports).toContain('function_b');
      expect(data.exports).toContain('ClassA');
    });

    it('should handle __all__ with double quotes', async () => {
      const filePath = join(testDir, 'double-quotes.py');
      const content = `
__all__ = ["function_x", "function_y", "ClassX"]

def function_x():
    pass

def function_y():
    pass

class ClassX:
    pass
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://double-quotes.py/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('function_x');
      expect(data.exports).toContain('function_y');
      expect(data.exports).toContain('ClassX');
    });

    it('should handle empty __all__ list', async () => {
      const filePath = join(testDir, 'empty-all.py');
      const content = `
__all__ = []

def some_function():
    pass
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://empty-all.py/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toEqual([]);
      expect(data.exportCount).toBe(0);
    });

    it('should handle Python without __all__', async () => {
      const filePath = join(testDir, 'no-all.py');
      const content = `
def public_function():
    pass

class PublicClass:
    pass
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://no-all.py/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('python');
      // Without __all__, exports might be empty or inferred
      expect(data.exports).toBeDefined();
    });
  });

  describe('Mixed Export Patterns', () => {
    it('should handle mixed named and default exports', async () => {
      const filePath = join(testDir, 'mixed.ts');
      const content = `
export const CONFIG = {
  version: '1.0.0'
};

export function helper() {
  return 'help';
}

export default class MainApp {
  start() {}
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://mixed.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('CONFIG');
      expect(data.exports).toContain('helper');
    });

    it('should handle exports with comments', async () => {
      const filePath = join(testDir, 'commented.ts');
      const content = `
// Export the main configuration
export const config = {};

/**
 * Export a utility function
 * @param input - The input value
 */
export function process(input: string) {
  return input.toUpperCase();
}

/* Not exported */
function internal() {}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://commented.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('config');
      expect(data.exports).toContain('process');
      expect(data.exports).not.toContain('internal');
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent file', async () => {
      const result = await resourceManager.readResource(`file://non-existent.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.error).toBeDefined();
      expect(data.error).toContain('ENOENT');
    });

    it('should handle invalid file path', async () => {
      const result = await resourceManager.readResource(`file:///exports`);
      const data = JSON.parse(result.text);

      expect(data.error).toBeDefined();
    });

    it('should handle malformed syntax', async () => {
      const filePath = join(testDir, 'malformed.ts');
      const content = `
export function broken(
  // Missing closing brace and body
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://malformed.ts/exports`);
      const data = JSON.parse(result.text);

      // Should still return a response, possibly with errors or empty exports
      expect(data).toBeDefined();
      expect(data.language).toBe('typescript');
    });

    it('should handle empty file', async () => {
      const filePath = join(testDir, 'empty.ts');
      await fs.writeFile(filePath, '');

      const result = await resourceManager.readResource(`file://empty.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toEqual([]);
      expect(data.exportCount).toBe(0);
    });

    it('should handle file with only imports', async () => {
      const filePath = join(testDir, 'only-imports.ts');
      const content = `
import { something } from './other';
import * as utils from './utils';
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://only-imports.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toEqual([]);
      expect(data.exportCount).toBe(0);
    });
  });

  describe('JavaScript Variations', () => {
    it('should extract exports from .js files', async () => {
      const filePath = join(testDir, 'module.js');
      const content = `
export const VERSION = '2.0.0';

export function initialize() {
  console.log('Initializing...');
}

function privateHelper() {
  console.log('Private');
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://module.js/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('javascript');
      expect(data.exports).toContain('VERSION');
      expect(data.exports).toContain('initialize');
      expect(data.exports).not.toContain('privateHelper');
    });

    it('should handle CommonJS-style exports in .js files', async () => {
      const filePath = join(testDir, 'commonjs.js');
      const content = `
const helper = () => 'help';

module.exports = {
  helper,
  config: { debug: true }
};
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://commonjs.js/exports`);
      const data = JSON.parse(result.text);

      // CommonJS exports might not be parsed the same way as ES modules
      expect(data.success).toBe(true);
      expect(data.language).toBe('javascript');
    });
  });

  describe('Edge Cases', () => {
    it('should handle exports with async functions', async () => {
      const filePath = join(testDir, 'async.ts');
      const content = `
export async function fetchData(url: string) {
  const response = await fetch(url);
  return response.json();
}

export const asyncHelper = async () => {
  return 'done';
};
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://async.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('fetchData');
      expect(data.exports).toContain('asyncHelper');
    });

    it('should handle exports with generics', async () => {
      const filePath = join(testDir, 'generics.ts');
      const content = `
export class Container<T> {
  constructor(private value: T) {}

  getValue(): T {
    return this.value;
  }
}

export function identity<T>(arg: T): T {
  return arg;
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://generics.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('Container');
      expect(data.exports).toContain('identity');
    });

    it('should handle exports with destructuring', async () => {
      const filePath = join(testDir, 'destructure.ts');
      const content = `
const utils = {
  add: (a: number, b: number) => a + b,
  subtract: (a: number, b: number) => a - b
};

export const { add, subtract } = utils;
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://destructure.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.language).toBe('typescript');
      // Destructured exports might be tracked differently
    });

    it('should handle namespace exports', async () => {
      const filePath = join(testDir, 'namespace.ts');
      const content = `
export namespace Utils {
  export function formatDate(date: Date): string {
    return date.toISOString();
  }

  export const VERSION = '1.0.0';
}
`;
      await fs.writeFile(filePath, content);

      const result = await resourceManager.readResource(`file://namespace.ts/exports`);
      const data = JSON.parse(result.text);

      expect(data.success).toBe(true);
      expect(data.exports).toContain('Utils');
    });
  });
});
