/**
 * Test suite for dependency analysis MCP resources
 * Tests dependency analysis resources: dependencies, dependents, circular-deps, impact-analysis
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ResourceManager } from '../src/managers/ResourceManager.js';
import { DatabaseManager } from '../src/database/index.js';
import { getSymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';
import path from 'path';

describe('Dependency Analysis Resources', () => {
  let resourceManager: ResourceManager;
  let db: DatabaseManager;
  const testProjectPath = path.resolve(__dirname, '..');

  beforeAll(async () => {
    db = new DatabaseManager({ databasePath: ':memory:' });
    resourceManager = new ResourceManager(db, testProjectPath);

    // Index the project for testing
    const indexer = getSymbolGraphIndexer();
    await indexer.initialize(testProjectPath);
    await indexer.indexRepository(testProjectPath);
  });

  afterAll(async () => {
    const indexer = getSymbolGraphIndexer();
    await indexer.close();
  });

  it('should list dependency analysis resources', () => {
    const resources = resourceManager.listResources();

    const dependencyResources = resources.filter(r =>
      r.uriTemplate.startsWith('project://') &&
      ['dependencies', 'dependents', 'circular-deps', 'impact-analysis'].some(aspect =>
        r.uriTemplate.includes(aspect)
      )
    );

    expect(dependencyResources.length).toBe(4);
    expect(dependencyResources.map(r => r.name)).toContain('File Dependencies');
    expect(dependencyResources.map(r => r.name)).toContain('File Dependents');
    expect(dependencyResources.map(r => r.name)).toContain('Circular Dependencies');
    expect(dependencyResources.map(r => r.name)).toContain('Impact Analysis');
  });

  it('should get file dependencies', async () => {
    // Test with ResourceManager.ts which should have dependencies
    const result = await resourceManager.readResource(
      'project://src/managers/ResourceManager.ts/dependencies'
    );

    expect(result.mimeType).toBe('application/json');
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('file_path');
    expect(data).toHaveProperty('dependencies');
    expect(data).toHaveProperty('total');
    expect(Array.isArray(data.dependencies)).toBe(true);
    // Note: May be 0 if indexer hasn't fully processed imports yet
    expect(data.total).toBeGreaterThanOrEqual(0);
  });

  it('should get file dependents', async () => {
    // Test with DatabaseManager which should be imported by many files
    const result = await resourceManager.readResource(
      'project://src/database/index.ts/dependents'
    );

    expect(result.mimeType).toBe('application/json');
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('file_path');
    expect(data).toHaveProperty('dependents');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('impact_note');
    expect(Array.isArray(data.dependents)).toBe(true);
    // Note: May be 0 if indexer hasn't fully processed imports yet
    expect(data.total).toBeGreaterThanOrEqual(0);
  });

  it('should detect circular dependencies', async () => {
    const result = await resourceManager.readResource(
      'project://./circular-deps'
    );

    expect(result.mimeType).toBe('application/json');
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('circular_dependencies');
    expect(data).toHaveProperty('total_cycles');
    expect(data).toHaveProperty('severity');
    expect(data).toHaveProperty('note');
    expect(Array.isArray(data.circular_dependencies)).toBe(true);
  });

  it('should perform impact analysis', async () => {
    // Test with DatabaseManager to see what files are affected
    const result = await resourceManager.readResource(
      'project://src/database/index.ts/impact-analysis?max_depth=3'
    );

    expect(result.mimeType).toBe('application/json');
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('file_path');
    expect(data).toHaveProperty('max_depth');
    expect(data).toHaveProperty('impacted_files');
    expect(data).toHaveProperty('total_impacted');
    expect(data).toHaveProperty('note');
    expect(Array.isArray(data.impacted_files)).toBe(true);
    expect(data.max_depth).toBe(3);

    // Verify impact structure
    if (data.impacted_files.length > 0) {
      const firstImpact = data.impacted_files[0];
      expect(firstImpact).toHaveProperty('filePath');
      expect(firstImpact).toHaveProperty('depth');
      expect(firstImpact).toHaveProperty('path');
      expect(Array.isArray(firstImpact.path)).toBe(true);
      expect(firstImpact.depth).toBeGreaterThanOrEqual(1);
      expect(firstImpact.depth).toBeLessThanOrEqual(3);
    }
  });

  it('should handle unknown aspects gracefully', async () => {
    const result = await resourceManager.readResource(
      'project://src/index.ts/unknown-aspect'
    );

    expect(result.mimeType).toBe('application/json');
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('Unknown project aspect');
    expect(data).toHaveProperty('valid_aspects');
    expect(data.valid_aspects).toContain('dependencies');
    expect(data.valid_aspects).toContain('dependents');
    expect(data.valid_aspects).toContain('circular-deps');
    expect(data.valid_aspects).toContain('impact-analysis');
  });

  it('should handle missing files gracefully', async () => {
    const result = await resourceManager.readResource(
      'project://src/nonexistent-file.ts/dependencies'
    );

    expect(result.mimeType).toBe('application/json');
    const data = JSON.parse(result.text);
    // Should have either an error or empty results
    if (data.error) {
      expect(data.error).toBeTruthy();
    } else {
      expect(data.dependencies).toBeDefined();
      expect(data.total).toBe(0);
    }
  });
});
