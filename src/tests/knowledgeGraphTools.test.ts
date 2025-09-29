/**
 * Functional Unit Tests for Knowledge Graph Tools
 * Tests: update_knowledge_entity, export_knowledge_graph, wipe_knowledge_graph
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../database/index.js';
import { KnowledgeGraphMcpTools } from '../tools/knowledgeGraphTools.js';
import type {
  UpdateKnowledgeEntityInput,
  ExportKnowledgeGraphInput,
  WipeKnowledgeGraphInput
} from '../schemas/tools/knowledgeGraph.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VectorSearchService } from '../services/VectorSearchService.js';
import { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';

// Helper to create KG service
async function getKGService(db: DatabaseManager) {
  const vectorService = new VectorSearchService(db);
  await vectorService.initialize();
  return new KnowledgeGraphService(db, vectorService);
}

describe('KnowledgeGraphTools - Functional Tests', () => {
  let db: DatabaseManager;
  let tools: KnowledgeGraphMcpTools;
  let testRepoPath: string;

  beforeEach(async () => {
    // Create temporary test directory
    testRepoPath = mkdtempSync(join(tmpdir(), 'zmcp-test-'));

    // Initialize database manager and tools
    db = new DatabaseManager();
    await db.initialize();
    tools = new KnowledgeGraphMcpTools(db);

    // Create test entities
    const kgService = await getKGService(db);
    await kgService.createEntity({
      id: 'test-entity-1',
      entityType: 'function',
      name: 'calculateSum',
      description: 'Adds two numbers together',
      importanceScore: 0.7,
      confidenceScore: 0.8,
      properties: { language: 'typescript', complexity: 'low' },
      discoveredBy: 'test-suite',
      embedding: new Array(768).fill(0.1)
    });

    await kgService.createEntity({
      id: 'test-entity-2',
      entityType: 'class',
      name: 'Calculator',
      description: 'A simple calculator class',
      importanceScore: 0.8,
      confidenceScore: 0.9,
      properties: { language: 'typescript' },
      discoveredBy: 'test-suite',
      embedding: new Array(768).fill(0.2)
    });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testRepoPath, { recursive: true, force: true });
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('update_knowledge_entity', () => {
    it('should update entity name', async () => {
      const input: UpdateKnowledgeEntityInput = {
        repository_path: testRepoPath,
        entity_id: 'test-entity-1',
        updates: {
          entity_name: 'calculateTotal'
        }
      };

      const result = await tools['updateKnowledgeEntity'](input);

      expect(result.success).toBe(true);
      expect(result.entity_id).toBe('test-entity-1');
      expect(result.fields_updated).toContain('entity_name');
      expect(result.re_embedded).toBe(false);

      // Verify entity was actually updated
      const kgService = await getKGService(db);
      const entity = await kgService.getEntity('test-entity-1');
      expect(entity?.name).toBe('calculateTotal');
    });

    it('should update importance and confidence scores', async () => {
      const input: UpdateKnowledgeEntityInput = {
        repository_path: testRepoPath,
        entity_id: 'test-entity-1',
        updates: {
          importance_score: 0.95,
          confidence_score: 0.98
        }
      };

      const result = await tools['updateKnowledgeEntity'](input);

      expect(result.success).toBe(true);
      expect(result.fields_updated).toContain('importance_score');
      expect(result.fields_updated).toContain('confidence_score');
      expect(result.fields_updated.length).toBe(2);
    });

    it('should auto re-embed when description changes', async () => {
      const input: UpdateKnowledgeEntityInput = {
        repository_path: testRepoPath,
        entity_id: 'test-entity-1',
        updates: {
          entity_description: 'Adds multiple numbers together using reduce'
        }
      };

      const result = await tools['updateKnowledgeEntity'](input);

      expect(result.success).toBe(true);
      expect(result.fields_updated).toContain('entity_description');
      expect(result.re_embedded).toBe(true);
      expect(result.message).toContain('re-embedded');
    });

    it('should force re-embed when re_embed=true', async () => {
      const input: UpdateKnowledgeEntityInput = {
        repository_path: testRepoPath,
        entity_id: 'test-entity-1',
        updates: {
          importance_score: 0.9
        },
        re_embed: true
      };

      const result = await tools['updateKnowledgeEntity'](input);

      expect(result.success).toBe(true);
      expect(result.re_embedded).toBe(true);
    });

    it('should merge properties', async () => {
      const input: UpdateKnowledgeEntityInput = {
        repository_path: testRepoPath,
        entity_id: 'test-entity-1',
        updates: {
          properties: {
            author: 'jw',
            tested: 'true'
          }
        }
      };

      const result = await tools['updateKnowledgeEntity'](input);

      expect(result.success).toBe(true);

      // Verify properties were merged (not replaced)
      const kgService = await getKGService(db);
      const entity = await kgService.getEntity('test-entity-1');
      expect(entity?.properties).toEqual({
        language: 'typescript',
        complexity: 'low',
        author: 'jw',
        tested: 'true'
      });
    });

    it('should fail for non-existent entity', async () => {
      const input: UpdateKnowledgeEntityInput = {
        repository_path: testRepoPath,
        entity_id: 'non-existent-id',
        updates: {
          entity_name: 'NewName'
        }
      };

      await expect(tools['updateKnowledgeEntity'](input)).rejects.toThrow('Entity not found');
    });
  });

  describe('export_knowledge_graph', () => {
    it('should export to JSON format', async () => {
      const input: ExportKnowledgeGraphInput = {
        repository_path: testRepoPath,
        output_format: 'json',
        include_embeddings: false
      };

      const result = await tools['exportKnowledgeGraph'](input);

      expect(result.success).toBe(true);
      expect(result.total_entities).toBe(2);
      expect(result.total_relationships).toBe(0);
      expect(result.export_format).toBe('json');
      expect(result.data).toBeDefined();

      // Verify data structure
      const data = result.data as any;
      expect(data.entities).toHaveLength(2);
      expect(data.entities[0]).toHaveProperty('id');
      expect(data.entities[0]).toHaveProperty('name');
      expect(data.entities[0]).not.toHaveProperty('embedding');
    });

    it('should export to JSONL format', async () => {
      const outputFile = join(testRepoPath, 'export.jsonl');
      const input: ExportKnowledgeGraphInput = {
        repository_path: testRepoPath,
        output_format: 'jsonl',
        include_embeddings: false,
        output_file: outputFile
      };

      const result = await tools['exportKnowledgeGraph'](input);

      expect(result.success).toBe(true);
      expect(result.output_file).toBe(outputFile);
      expect(result.data_size).toMatch(/\d+(\.\d+)?(B|KB|MB)/);
    });

    it('should export to CSV format', async () => {
      const outputFile = join(testRepoPath, 'export.csv');
      const input: ExportKnowledgeGraphInput = {
        repository_path: testRepoPath,
        output_format: 'csv',
        include_embeddings: false,
        output_file: outputFile
      };

      const result = await tools['exportKnowledgeGraph'](input);

      expect(result.success).toBe(true);
      expect(result.output_file).toBe(outputFile);
    });

    it('should include embeddings when requested', async () => {
      const input: ExportKnowledgeGraphInput = {
        repository_path: testRepoPath,
        output_format: 'json',
        include_embeddings: true
      };

      const result = await tools['exportKnowledgeGraph'](input);

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.entities[0]).toHaveProperty('embedding');
      expect(Array.isArray(data.entities[0].embedding)).toBe(true);
    });

    it('should calculate data size correctly', async () => {
      const input: ExportKnowledgeGraphInput = {
        repository_path: testRepoPath,
        output_format: 'json',
        include_embeddings: true
      };

      const result = await tools['exportKnowledgeGraph'](input);

      expect(result.data_size).toBeDefined();
      // With embeddings, should be KB or MB
      expect(result.data_size).toMatch(/(KB|MB)/);
    });
  });

  describe('wipe_knowledge_graph', () => {
    it('should fail without confirmation', async () => {
      const input: WipeKnowledgeGraphInput = {
        repository_path: testRepoPath,
        confirm: false
      };

      await expect(tools['wipeKnowledgeGraph'](input)).rejects.toThrow('explicit confirmation');
    });

    it('should create backup before wiping', async () => {
      const input: WipeKnowledgeGraphInput = {
        repository_path: testRepoPath,
        confirm: true,
        backup_first: true
      };

      const result = await tools['wipeKnowledgeGraph'](input);

      expect(result.success).toBe(true);
      expect(result.entities_removed).toBe(2);
      expect(result.relationships_removed).toBe(0);
      expect(result.backup_file).toBeDefined();
      expect(result.backup_file).toMatch(/knowledge-graph-backup-.*\.json/);
    });

    it('should wipe all entities and relationships', async () => {
      const input: WipeKnowledgeGraphInput = {
        repository_path: testRepoPath,
        confirm: true,
        backup_first: false
      };

      const result = await tools['wipeKnowledgeGraph'](input);

      expect(result.success).toBe(true);
      expect(result.entities_removed).toBe(2);

      // Verify all data is actually wiped
      const kgService = await getKGService(db);
      const entities = await kgService.getAllEntities();
      expect(entities).toHaveLength(0);
    });

    it('should skip backup when backup_first=false', async () => {
      const input: WipeKnowledgeGraphInput = {
        repository_path: testRepoPath,
        confirm: true,
        backup_first: false
      };

      const result = await tools['wipeKnowledgeGraph'](input);

      expect(result.success).toBe(true);
      expect(result.backup_file).toBeUndefined();
    });
  });

  describe('Round-trip export/import (data integrity)', () => {
    it('should preserve all data through export/wipe/restore cycle', async () => {
      // Export
      const exportInput: ExportKnowledgeGraphInput = {
        repository_path: testRepoPath,
        output_format: 'json',
        include_embeddings: true
      };
      const exportResult = await tools['exportKnowledgeGraph'](exportInput);
      const exportedData = exportResult.data as any;

      // Record original data
      const kgService = await getKGService(db);
      const originalEntities = await kgService.getAllEntities();

      // Wipe
      const wipeInput: WipeKnowledgeGraphInput = {
        repository_path: testRepoPath,
        confirm: true,
        backup_first: false
      };
      await tools['wipeKnowledgeGraph'](wipeInput);

      // Verify wiped
      const entitiesAfterWipe = await kgService.getAllEntities();
      expect(entitiesAfterWipe).toHaveLength(0);

      // Restore (this would need import_knowledge_graph implementation)
      // For now, manually restore to verify data integrity
      for (const entity of exportedData.entities) {
        await kgService.createEntity({
          id: entity.id,
          type: entity.type,
          name: entity.name,
          description: entity.description,
          importanceScore: entity.importance_score,
          confidenceScore: entity.confidence_score,
          properties: entity.properties,
          discoveredBy: entity.discovered_by,
          embedding: entity.embedding
        });
      }

      // Verify restoration
      const restoredEntities = await kgService.getAllEntities();
      expect(restoredEntities).toHaveLength(originalEntities.length);
      expect(restoredEntities[0].name).toBe(originalEntities[0].name);
      expect(restoredEntities[0].description).toBe(originalEntities[0].description);
    });
  });
});