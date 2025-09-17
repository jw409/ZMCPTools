/**
 * Tests for AnalysisStorageService with dom0/domU isolation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnalysisStorageService, FileAnalysisData } from '../services/AnalysisStorageService.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

describe('AnalysisStorageService', () => {
  let service: AnalysisStorageService;
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    service = new AnalysisStorageService();
    originalCwd = process.cwd();

    // Create temporary test directory structure
    tempDir = path.join(__dirname, '..', '..', 'test-temp', `analysis-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Restore original working directory
    process.chdir(originalCwd);

    // Cleanup
    await service.shutdown();

    // Remove temp directory
    if (existsSync(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('Context Path Resolution', () => {
    it('should detect project context from package.json', async () => {
      const projectDir = path.join(tempDir, 'test-project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"name": "test"}');

      const contexts = await service.resolveContextPaths(projectDir);

      expect(contexts.project).toContain('test-project/var/analysis/project_map.db');
      expect(contexts.ecosystem).toBeNull(); // No ecosystem in temp dir
    });

    it('should detect ecosystem context for game1 structure', async () => {
      // Mock game1 ecosystem structure
      const game1Dir = path.join(tempDir, 'dev', 'game1');
      const projectDir = path.join(game1Dir, 'test-project');

      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"name": "test"}');

      const contexts = await service.resolveContextPaths(projectDir);

      expect(contexts.project).toContain('test-project/var/analysis/project_map.db');
      expect(contexts.ecosystem).toContain('dev/game1/var/analysis/system_patterns.db');
    });

    it('should detect ecosystem context for meshly structure', async () => {
      // Mock meshly ecosystem structure
      const meshlyDir = path.join(tempDir, 'dev', 'meshly');
      const projectDir = path.join(meshlyDir, 'meshly-frontend');

      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"name": "frontend"}');

      const contexts = await service.resolveContextPaths(projectDir);

      expect(contexts.project).toContain('meshly-frontend/var/analysis/project_map.db');
      expect(contexts.ecosystem).toContain('dev/meshly/var/analysis/system_patterns.db');
    });

    it('should handle nested project structure', async () => {
      // Create nested structure: ecosystem/main-project/sub-project
      const ecosystemDir = path.join(tempDir, 'dev', 'game1');
      const mainProjectDir = path.join(ecosystemDir, 'main-project');
      const subProjectDir = path.join(mainProjectDir, 'sub-project');

      await fs.mkdir(subProjectDir, { recursive: true });

      // Add project markers
      await fs.writeFile(path.join(mainProjectDir, 'package.json'), '{"name": "main"}');
      await fs.writeFile(path.join(subProjectDir, 'package.json'), '{"name": "sub"}');

      const contexts = await service.resolveContextPaths(subProjectDir);

      expect(contexts.project).toContain('sub-project/var/analysis/project_map.db');
      expect(contexts.ecosystem).toContain('dev/game1/var/analysis/system_patterns.db');
    });
  });

  describe('Database Operations', () => {
    it('should create and initialize project database', async () => {
      const projectDir = path.join(tempDir, 'test-project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"name": "test"}');

      const db = await service.getDatabase('project', projectDir);

      expect(db).toBeDefined();

      // Verify schema tables exist
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const tableNames = tables.map((t: any) => t.name);

      expect(tableNames).toContain('context_hierarchy');
      expect(tableNames).toContain('file_hashes');
      expect(tableNames).toContain('symbols');
      expect(tableNames).toContain('imports_exports');
    });

    it('should store and retrieve file analysis data', async () => {
      const projectDir = path.join(tempDir, 'test-project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"name": "test"}');

      const testFile = path.join(projectDir, 'src', 'test.ts');
      await fs.mkdir(path.dirname(testFile), { recursive: true });
      await fs.writeFile(testFile, 'export function test() { return "hello"; }');

      const analysisData: FileAnalysisData = {
        filePath: testFile,
        hash: 'abc123',
        lastModified: new Date(),
        symbols: [
          {
            name: 'test',
            type: 'function',
            line: 1,
            column: 16,
            isExported: true
          }
        ],
        imports: [],
        exports: ['test'],
        size: 42,
        language: 'typescript'
      };

      await service.storeFileAnalysis(testFile, analysisData, 'project');

      // Verify data was stored
      const db = await service.getDatabase('project', projectDir);
      const fileRecord = db.prepare('SELECT * FROM file_hashes WHERE file_path = ?').get(testFile);

      expect(fileRecord).toBeDefined();
      expect(fileRecord.hash).toBe('abc123');

      const symbolRecord = db.prepare('SELECT * FROM symbols WHERE file_path = ?').get(testFile);
      expect(symbolRecord).toBeDefined();
      expect(symbolRecord.name).toBe('test');
      expect(symbolRecord.type).toBe('function');
      expect(symbolRecord.is_exported).toBe(1); // SQLite boolean as integer
    });
  });

  describe('Symbol Search', () => {
    it('should search symbols across project context', async () => {
      const projectDir = path.join(tempDir, 'test-project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"name": "test"}');

      const testFile = path.join(projectDir, 'src', 'utils.ts');
      await fs.mkdir(path.dirname(testFile), { recursive: true });

      const analysisData: FileAnalysisData = {
        filePath: testFile,
        hash: 'def456',
        lastModified: new Date(),
        symbols: [
          {
            name: 'calculateSum',
            type: 'function',
            line: 1,
            column: 16,
            isExported: true
          },
          {
            name: 'UserData',
            type: 'interface',
            line: 5,
            column: 0,
            isExported: true
          }
        ],
        imports: [],
        exports: ['calculateSum', 'UserData'],
        size: 120,
        language: 'typescript'
      };

      await service.storeFileAnalysis(testFile, analysisData, 'project');

      // Search for symbols
      const results = await service.searchSymbols('calculate', undefined, projectDir);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('calculateSum');
      expect(results[0].type).toBe('function');
      expect(results[0].contextLevel).toBe('project');
    });

    it('should filter symbols by type', async () => {
      const projectDir = path.join(tempDir, 'test-project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"name": "test"}');

      const testFile = path.join(projectDir, 'src', 'types.ts');
      await fs.mkdir(path.dirname(testFile), { recursive: true });

      const analysisData: FileAnalysisData = {
        filePath: testFile,
        hash: 'ghi789',
        lastModified: new Date(),
        symbols: [
          {
            name: 'User',
            type: 'interface',
            line: 1,
            column: 0,
            isExported: true
          },
          {
            name: 'UserService',
            type: 'class',
            line: 10,
            column: 0,
            isExported: true
          }
        ],
        imports: [],
        exports: ['User', 'UserService'],
        size: 200,
        language: 'typescript'
      };

      await service.storeFileAnalysis(testFile, analysisData, 'project');

      // Search for interfaces only
      const results = await service.searchSymbols('User', 'interface', projectDir);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('User');
      expect(results[0].type).toBe('interface');
    });
  });

  describe('File Dependencies', () => {
    it('should track file dependencies correctly', async () => {
      const projectDir = path.join(tempDir, 'test-project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, 'package.json'), '{"name": "test"}');

      const mainFile = path.join(projectDir, 'src', 'main.ts');
      const utilsFile = path.join(projectDir, 'src', 'utils.ts');

      await fs.mkdir(path.dirname(mainFile), { recursive: true });

      // Store utils file first
      const utilsAnalysis: FileAnalysisData = {
        filePath: utilsFile,
        hash: 'utils123',
        lastModified: new Date(),
        symbols: [
          {
            name: 'helper',
            type: 'function',
            line: 1,
            column: 16,
            isExported: true
          }
        ],
        imports: [],
        exports: ['helper'],
        size: 50,
        language: 'typescript'
      };

      await service.storeFileAnalysis(utilsFile, utilsAnalysis, 'project');

      // Store main file that imports from utils
      const mainAnalysis: FileAnalysisData = {
        filePath: mainFile,
        hash: 'main123',
        lastModified: new Date(),
        symbols: [
          {
            name: 'main',
            type: 'function',
            line: 3,
            column: 16,
            isExported: false
          }
        ],
        imports: ['./utils'],
        exports: [],
        size: 80,
        language: 'typescript'
      };

      await service.storeFileAnalysis(mainFile, mainAnalysis, 'project');

      // Get dependencies
      const deps = await service.getFileDependencies(mainFile, projectDir);

      expect(deps.imports).toContain('./utils');
      expect(deps.exports).toHaveLength(0);

      // Check reverse dependencies (what imports from utils)
      const utilsDeps = await service.getFileDependencies(utilsFile, projectDir);
      expect(utilsDeps.dependents).toContain(mainFile);
    });
  });

  describe('Context Isolation', () => {
    it('should isolate data between different ecosystems', async () => {
      // Create two separate ecosystem structures
      const game1Dir = path.join(tempDir, 'dev', 'game1', 'project1');
      const meshlyDir = path.join(tempDir, 'dev', 'meshly', 'project2');

      await fs.mkdir(game1Dir, { recursive: true });
      await fs.mkdir(meshlyDir, { recursive: true });

      await fs.writeFile(path.join(game1Dir, 'package.json'), '{"name": "game1-project"}');
      await fs.writeFile(path.join(meshlyDir, 'package.json'), '{"name": "meshly-project"}');

      // Store data in both projects
      const game1File = path.join(game1Dir, 'src', 'game.ts');
      const meshlyFile = path.join(meshlyDir, 'src', 'app.ts');

      await fs.mkdir(path.dirname(game1File), { recursive: true });
      await fs.mkdir(path.dirname(meshlyFile), { recursive: true });

      const game1Analysis: FileAnalysisData = {
        filePath: game1File,
        hash: 'game123',
        lastModified: new Date(),
        symbols: [{ name: 'gameFunction', type: 'function', line: 1, column: 0, isExported: true }],
        imports: [],
        exports: ['gameFunction'],
        size: 100,
        language: 'typescript'
      };

      const meshlyAnalysis: FileAnalysisData = {
        filePath: meshlyFile,
        hash: 'meshly123',
        lastModified: new Date(),
        symbols: [{ name: 'appFunction', type: 'function', line: 1, column: 0, isExported: true }],
        imports: [],
        exports: ['appFunction'],
        size: 120,
        language: 'typescript'
      };

      await service.storeFileAnalysis(game1File, game1Analysis, 'project');
      await service.storeFileAnalysis(meshlyFile, meshlyAnalysis, 'project');

      // Search from game1 context should only find game1 symbols
      const game1Results = await service.searchSymbols('Function', undefined, game1Dir);
      expect(game1Results).toHaveLength(1);
      expect(game1Results[0].name).toBe('gameFunction');

      // Search from meshly context should only find meshly symbols
      const meshlyResults = await service.searchSymbols('Function', undefined, meshlyDir);
      expect(meshlyResults).toHaveLength(1);
      expect(meshlyResults[0].name).toBe('appFunction');
    });
  });
});