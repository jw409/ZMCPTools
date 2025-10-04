/**
 * Project Structure Resource Tests
 * Comprehensive testing for project structure MCP resource (project://{path}/structure)
 * Tests directory tree generation, file filtering, and TreeSummaryService integration
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { ResourceManager } from '../managers/ResourceManager.js';
import { DatabaseManager } from '../database/index.js';

describe('Project Structure Resource (project://*/structure)', () => {
  let testProjectDir: string;
  let dbManager: DatabaseManager;
  let resourceManager: ResourceManager;
  let originalCwd: string;

  beforeAll(() => {
    originalCwd = process.cwd();
  });

  afterAll(() => {
    process.chdir(originalCwd);
  });

  beforeEach(async () => {
    // Create test project directory with structure
    const timestamp = Date.now();
    testProjectDir = join('/tmp', `test-project-structure-${timestamp}`);

    // Create comprehensive test directory structure
    await fs.mkdir(testProjectDir, { recursive: true });
    await fs.mkdir(join(testProjectDir, 'src'), { recursive: true });
    await fs.mkdir(join(testProjectDir, 'src', 'components'), { recursive: true });
    await fs.mkdir(join(testProjectDir, 'src', 'utils'), { recursive: true });
    await fs.mkdir(join(testProjectDir, 'tests'), { recursive: true });
    await fs.mkdir(join(testProjectDir, 'node_modules'), { recursive: true });
    await fs.mkdir(join(testProjectDir, 'dist'), { recursive: true });
    await fs.mkdir(join(testProjectDir, '.git'), { recursive: true });
    await fs.mkdir(join(testProjectDir, 'docs'), { recursive: true });

    // Create test files
    await fs.writeFile(join(testProjectDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      version: '1.0.0'
    }));
    await fs.writeFile(join(testProjectDir, 'README.md'), '# Test Project');
    await fs.writeFile(join(testProjectDir, 'src', 'index.ts'), 'export const foo = "bar";');
    await fs.writeFile(join(testProjectDir, 'src', 'components', 'Button.tsx'), 'export const Button = () => {};');
    await fs.writeFile(join(testProjectDir, 'src', 'utils', 'helpers.ts'), 'export const helper = () => {};');
    await fs.writeFile(join(testProjectDir, 'tests', 'index.test.ts'), 'test("foo", () => {});');
    await fs.writeFile(join(testProjectDir, 'node_modules', 'package.json'), '{}');
    await fs.writeFile(join(testProjectDir, 'dist', 'index.js'), 'console.log("built");');
    await fs.writeFile(join(testProjectDir, 'docs', 'guide.md'), '# Guide');

    // Initialize database and resource manager
    dbManager = new DatabaseManager(':memory:');
    await dbManager.initialize();
    resourceManager = new ResourceManager(dbManager, testProjectDir);
  });

  afterEach(async () => {
    // Cleanup
    await dbManager.close();

    if (existsSync(testProjectDir)) {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('Basic Directory Tree Generation', () => {
    it('should generate directory tree structure', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      expect(result).toBeDefined();
      expect(result.mimeType).toBe('application/json');

      const data = JSON.parse(result.text);
      expect(data.structure).toBeDefined();
      expect(data.project_path).toContain(testProjectDir);
    });

    it('should include both files and directories', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      expect(data.structure).toBeDefined();

      // Should have structure with children
      expect(data.structure.type).toBe('directory');
      expect(data.structure.children).toBeDefined();
      expect(Array.isArray(data.structure.children)).toBe(true);
    });

    it('should include file metadata (size, lastModified)', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      // Find a file node
      const findFile = (node: any): any => {
        if (node.type === 'file') return node;
        if (node.children) {
          for (const child of node.children) {
            const file = findFile(child);
            if (file) return file;
          }
        }
        return null;
      };

      const fileNode = findFile(structure);
      expect(fileNode).toBeDefined();
      expect(fileNode.size).toBeDefined();
      expect(typeof fileNode.size).toBe('number');
      // Note: lastModified might be optional based on implementation
    });

    it('should provide file and directory counts', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      expect(data.total_files).toBeDefined();
      expect(typeof data.total_files).toBe('number');
      expect(data.total_directories).toBeDefined();
      expect(typeof data.total_directories).toBe('number');
      expect(data.total_files).toBeGreaterThan(0);
      expect(data.total_directories).toBeGreaterThan(0);
    });
  });

  describe('Default File Filtering', () => {
    it('should exclude node_modules by default', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      // Check that node_modules is not in the tree
      const hasNodeModules = (node: any): boolean => {
        if (node.name === 'node_modules') return true;
        if (node.children) {
          return node.children.some((child: any) => hasNodeModules(child));
        }
        return false;
      };

      expect(hasNodeModules(structure)).toBe(false);
    });

    it('should exclude dist directory by default', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      const hasDist = (node: any): boolean => {
        if (node.name === 'dist') return true;
        if (node.children) {
          return node.children.some((child: any) => hasDist(child));
        }
        return false;
      };

      expect(hasDist(structure)).toBe(false);
    });

    it('should exclude .git directory by default', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      const hasGit = (node: any): boolean => {
        if (node.name === '.git') return true;
        if (node.children) {
          return node.children.some((child: any) => hasGit(child));
        }
        return false;
      };

      expect(hasGit(structure)).toBe(false);
    });

    it('should include src and tests directories', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      const findDir = (node: any, name: string): boolean => {
        if (node.name === name) return true;
        if (node.children) {
          return node.children.some((child: any) => findDir(child, name));
        }
        return false;
      };

      expect(findDir(structure, 'src')).toBe(true);
      expect(findDir(structure, 'tests')).toBe(true);
    });
  });

  describe('Custom Exclude Patterns', () => {
    it('should respect custom exclude patterns via query param', async () => {
      const result = await resourceManager.readResource(
        `project://./structure?exclude=tests,docs`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      const hasTests = (node: any): boolean => {
        if (node.name === 'tests') return true;
        if (node.children) {
          return node.children.some((child: any) => hasTests(child));
        }
        return false;
      };

      const hasDocs = (node: any): boolean => {
        if (node.name === 'docs') return true;
        if (node.children) {
          return node.children.some((child: any) => hasDocs(child));
        }
        return false;
      };

      expect(hasTests(structure)).toBe(false);
      expect(hasDocs(structure)).toBe(false);
    });

    it('should handle comma-separated exclude patterns', async () => {
      const result = await resourceManager.readResource(
        `project://./structure?exclude=src,tests,docs`
      );

      const data = JSON.parse(result.text);
      expect(data.exclude_patterns).toEqual(['src', 'tests', 'docs']);
    });

    it('should merge custom excludes with default excludes', async () => {
      const result = await resourceManager.readResource(
        `project://./structure?exclude=tests`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      // Should exclude both default (node_modules, dist, .git) and custom (tests)
      const findDir = (node: any, name: string): boolean => {
        if (node.name === name) return true;
        if (node.children) {
          return node.children.some((child: any) => findDir(child, name));
        }
        return false;
      };

      expect(findDir(structure, 'node_modules')).toBe(false); // default exclude
      expect(findDir(structure, 'tests')).toBe(false); // custom exclude
      expect(findDir(structure, 'src')).toBe(true); // not excluded
    });
  });

  describe('Max Depth Parameter', () => {
    it('should respect max_depth=1 (only root level)', async () => {
      const result = await resourceManager.readResource(
        `project://./structure?max_depth=1`
      );

      const data = JSON.parse(result.text);
      expect(data.max_depth).toBe(1);

      const structure = data.structure;

      // Check depth
      const getMaxDepth = (node: any, depth = 0): number => {
        if (!node.children || node.children.length === 0) return depth;
        return Math.max(...node.children.map((child: any) => getMaxDepth(child, depth + 1)));
      };

      expect(getMaxDepth(structure)).toBeLessThanOrEqual(1);
    });

    it('should respect max_depth=2 (two levels deep)', async () => {
      const result = await resourceManager.readResource(
        `project://./structure?max_depth=2`
      );

      const data = JSON.parse(result.text);
      expect(data.max_depth).toBe(2);

      const structure = data.structure;

      const getMaxDepth = (node: any, depth = 0): number => {
        if (!node.children || node.children.length === 0) return depth;
        return Math.max(...node.children.map((child: any) => getMaxDepth(child, depth + 1)));
      };

      expect(getMaxDepth(structure)).toBeLessThanOrEqual(2);
    });

    it('should use max_depth=5 by default', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      expect(data.max_depth).toBe(5);
    });

    it('should handle max_depth=0 (unlimited depth)', async () => {
      const result = await resourceManager.readResource(
        `project://./structure?max_depth=0`
      );

      const data = JSON.parse(result.text);
      expect(data.max_depth).toBe(0);
      // Should traverse full depth of structure
    });
  });

  describe('.gitignore Integration', () => {
    beforeEach(async () => {
      // Create .gitignore file
      await fs.writeFile(
        join(testProjectDir, '.gitignore'),
        `*.log
coverage/
tmp/
.env
`
      );

      // Create files/dirs that should be ignored
      await fs.mkdir(join(testProjectDir, 'coverage'), { recursive: true });
      await fs.mkdir(join(testProjectDir, 'tmp'), { recursive: true });
      await fs.writeFile(join(testProjectDir, 'debug.log'), 'log content');
      await fs.writeFile(join(testProjectDir, '.env'), 'SECRET=value');
    });

    it('should respect .gitignore patterns', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      const findNode = (node: any, name: string): boolean => {
        if (node.name === name) return true;
        if (node.children) {
          return node.children.some((child: any) => findNode(child, name));
        }
        return false;
      };

      // These should be excluded by .gitignore
      expect(findNode(structure, 'coverage')).toBe(false);
      expect(findNode(structure, 'tmp')).toBe(false);
      expect(findNode(structure, 'debug.log')).toBe(false);
      expect(findNode(structure, '.env')).toBe(false);
    });
  });

  describe('.claudeignore Integration', () => {
    beforeEach(async () => {
      // Create .claudeignore file
      await fs.writeFile(
        join(testProjectDir, '.claudeignore'),
        `*.test.ts
__mocks__/
legacy/
`
      );

      // Create files/dirs that should be ignored
      await fs.mkdir(join(testProjectDir, '__mocks__'), { recursive: true });
      await fs.mkdir(join(testProjectDir, 'legacy'), { recursive: true });
      await fs.writeFile(join(testProjectDir, 'src', 'app.test.ts'), 'test content');
    });

    it('should respect .claudeignore patterns', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      const findNode = (node: any, name: string): boolean => {
        if (node.name === name) return true;
        if (node.children) {
          return node.children.some((child: any) => findNode(child, name));
        }
        return false;
      };

      // These should be excluded by .claudeignore
      expect(findNode(structure, '__mocks__')).toBe(false);
      expect(findNode(structure, 'legacy')).toBe(false);
      expect(findNode(structure, 'app.test.ts')).toBe(false);
    });

    it('should combine .gitignore and .claudeignore patterns', async () => {
      // Create both ignore files
      await fs.writeFile(
        join(testProjectDir, '.gitignore'),
        `*.log\n`
      );
      await fs.writeFile(
        join(testProjectDir, '.claudeignore'),
        `*.test.ts\n`
      );

      await fs.writeFile(join(testProjectDir, 'debug.log'), 'log');
      await fs.writeFile(join(testProjectDir, 'app.test.ts'), 'test');

      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      const findNode = (node: any, name: string): boolean => {
        if (node.name === name) return true;
        if (node.children) {
          return node.children.some((child: any) => findNode(child, name));
        }
        return false;
      };

      expect(findNode(structure, 'debug.log')).toBe(false); // .gitignore
      expect(findNode(structure, 'app.test.ts')).toBe(false); // .claudeignore
    });
  });

  describe('TreeSummaryService Integration', () => {
    it('should call TreeSummaryService.analyzeDirectory', async () => {
      // This tests the integration without mocking
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      expect(result).toBeDefined();
      expect(result.mimeType).toBe('application/json');

      const data = JSON.parse(result.text);
      expect(data.structure).toBeDefined();
    });

    it('should pass maxDepth option to analyzeDirectory', async () => {
      const result = await resourceManager.readResource(
        `project://./structure?max_depth=3`
      );

      const data = JSON.parse(result.text);
      expect(data.max_depth).toBe(3);
    });

    it('should pass excludePatterns option to analyzeDirectory', async () => {
      const result = await resourceManager.readResource(
        `project://./structure?exclude=custom1,custom2`
      );

      const data = JSON.parse(result.text);
      expect(data.exclude_patterns).toContain('custom1');
      expect(data.exclude_patterns).toContain('custom2');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing project directory', async () => {
      const missingDir = join('/tmp', `nonexistent-${Date.now()}`);
      const manager = new ResourceManager(dbManager, missingDir);

      const result = await manager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      expect(data.error).toBeDefined();
      expect(data.error).toContain('Directory not found');
    });

    it('should handle invalid max_depth parameter', async () => {
      const result = await resourceManager.readResource(
        `project://./structure?max_depth=invalid`
      );

      const data = JSON.parse(result.text);
      // Should fallback to default or handle gracefully
      expect(data.max_depth).toBeDefined();
    });

    it('should handle permission errors gracefully', async () => {
      // Create a directory without read permissions
      const restrictedDir = join(testProjectDir, 'restricted');
      await fs.mkdir(restrictedDir);
      await fs.chmod(restrictedDir, 0o000);

      const result = await resourceManager.readResource(
        `project://./structure`
      );

      // Should not crash, may exclude the directory or include error info
      expect(result).toBeDefined();

      // Cleanup
      await fs.chmod(restrictedDir, 0o755);
    });
  });

  describe('URI Path Resolution', () => {
    it('should handle relative path "." for current directory', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      expect(data.project_path).toBe(testProjectDir);
    });

    it('should handle subdirectory paths', async () => {
      const result = await resourceManager.readResource(
        `project://src/structure`
      );

      const data = JSON.parse(result.text);
      expect(data.project_path).toContain('src');
    });

    it('should resolve paths relative to repository path', async () => {
      const result = await resourceManager.readResource(
        `project://./src/structure`
      );

      const data = JSON.parse(result.text);
      expect(data.project_path).toContain(testProjectDir);
      expect(data.project_path).toContain('src');
    });
  });

  describe('Response Format', () => {
    it('should return JSON with correct MIME type', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      expect(result.mimeType).toBe('application/json');
      expect(() => JSON.parse(result.text)).not.toThrow();
    });

    it('should include timestamp in response', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      expect(data.timestamp).toBeDefined();
      expect(typeof data.timestamp).toBe('string');

      // Should be valid ISO 8601 timestamp
      expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
    });

    it('should include all required fields in response', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      expect(data.project_path).toBeDefined();
      expect(data.max_depth).toBeDefined();
      expect(data.exclude_patterns).toBeDefined();
      expect(data.structure).toBeDefined();
      expect(data.total_files).toBeDefined();
      expect(data.total_directories).toBeDefined();
      expect(data.timestamp).toBeDefined();
    });

    it('should format directory tree as nested objects', async () => {
      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      const structure = data.structure;

      expect(structure.name).toBeDefined();
      expect(structure.type).toBe('directory');
      expect(structure.path).toBeDefined();
      expect(Array.isArray(structure.children)).toBe(true);
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle empty directories', async () => {
      const emptyDir = join('/tmp', `empty-${Date.now()}`);
      await fs.mkdir(emptyDir);

      const manager = new ResourceManager(dbManager, emptyDir);
      const result = await manager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      expect(data.structure).toBeDefined();
      expect(data.structure.children).toEqual([]);

      await fs.rm(emptyDir, { recursive: true });
    });

    it('should handle deeply nested directories', async () => {
      // Create deeply nested structure
      let currentPath = testProjectDir;
      for (let i = 0; i < 10; i++) {
        currentPath = join(currentPath, `level${i}`);
        await fs.mkdir(currentPath);
      }

      const result = await resourceManager.readResource(
        `project://./structure?max_depth=15`
      );

      const data = JSON.parse(result.text);
      expect(data.structure).toBeDefined();

      const getDepth = (node: any, depth = 0): number => {
        if (!node.children || node.children.length === 0) return depth;
        return Math.max(...node.children.map((child: any) => getDepth(child, depth + 1)));
      };

      expect(getDepth(data.structure)).toBeGreaterThan(5);
    });

    it('should handle large number of files', async () => {
      // Create many files
      const manyFilesDir = join(testProjectDir, 'many_files');
      await fs.mkdir(manyFilesDir);

      for (let i = 0; i < 50; i++) {
        await fs.writeFile(join(manyFilesDir, `file${i}.txt`), `content ${i}`);
      }

      const result = await resourceManager.readResource(
        `project://./structure`
      );

      const data = JSON.parse(result.text);
      expect(data.total_files).toBeGreaterThan(50);
    });

    it('should handle symbolic links safely', async () => {
      // Create a symbolic link
      const targetFile = join(testProjectDir, 'target.txt');
      const linkFile = join(testProjectDir, 'link.txt');

      await fs.writeFile(targetFile, 'target content');
      await fs.symlink(targetFile, linkFile);

      const result = await resourceManager.readResource(
        `project://./structure`
      );

      // Should handle symlinks without infinite loops
      expect(result).toBeDefined();
      const data = JSON.parse(result.text);
      expect(data.structure).toBeDefined();
    });
  });
});
