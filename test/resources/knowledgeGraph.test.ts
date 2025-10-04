/**
 * Knowledge Graph Resources Test Suite
 * Tests the MCP resource migration for knowledge graph (Issue #35 Phase 3)
 *
 * Test levels:
 * 1. Smoke: Resources are registered and discoverable
 * 2. E2E: MCP Client can query resources (simulates LLM behavior)
 * 3. Data: Responses contain expected structure and data
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'path';

describe('Knowledge Graph Resources (MCP Protocol)', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // Start MCP server as subprocess (simulates how LLM connects)
    const serverPath = join(__dirname, '../../dist/server/index.js');

    transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        ...process.env,
        ZMCP_USE_LOCAL_STORAGE: 'true', // Use project-local storage
      },
    });

    client = new Client(
      {
        name: 'test-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  describe('Smoke Tests: Resource Discovery', () => {
    test('LLM can discover knowledge://search resource', async () => {
      const resources = await client.listResources();

      const knowledgeSearch = resources.resources.find(
        (r) => r.uri === 'knowledge://search'
      );

      expect(knowledgeSearch).toBeDefined();
      expect(knowledgeSearch?.name).toBe('Knowledge Graph Search');
      expect(knowledgeSearch?.description).toContain('hybrid');
      expect(knowledgeSearch?.description).toContain('BM25');
      expect(knowledgeSearch?.mimeType).toBe('application/json');
    });

    test('LLM can discover knowledge://entity/*/related resource', async () => {
      const resources = await client.listResources();

      const relatedEntities = resources.resources.find(
        (r) => r.uri === 'knowledge://entity/*/related'
      );

      expect(relatedEntities).toBeDefined();
      expect(relatedEntities?.name).toBe('Related Entities');
      expect(relatedEntities?.mimeType).toBe('application/json');
    });

    test('LLM can discover knowledge://status resource', async () => {
      const resources = await client.listResources();

      const status = resources.resources.find(
        (r) => r.uri === 'knowledge://status'
      );

      expect(status).toBeDefined();
      expect(status?.name).toBe('Knowledge Graph Status');
      expect(status?.mimeType).toBe('application/json');
    });

    test('OLD tools are NOT registered (migration complete)', async () => {
      const tools = await client.listTools();

      const toolNames = tools.tools.map((t) => t.name);

      // These should be gone (migrated to resources)
      expect(toolNames).not.toContain('search_knowledge_graph');
      expect(toolNames).not.toContain('find_related_entities');
      expect(toolNames).not.toContain('get_memory_status');

      // These should remain (write operations)
      expect(toolNames).toContain('store_knowledge_memory');
      expect(toolNames).toContain('create_knowledge_relationship');
    });
  });

  describe('E2E Tests: LLM Queries Resources', () => {
    test('LLM can query knowledge://search with parameters', async () => {
      const response = await client.readResource({
        uri: 'knowledge://search?query=contract&limit=5&threshold=0.7',
      });

      expect(response).toBeDefined();
      expect(response.contents).toHaveLength(1);

      const content = response.contents[0];
      expect(content.mimeType).toBe('application/json');

      const data = JSON.parse(content.text);
      console.log('DEBUG: knowledge://search response:', JSON.stringify(data, null, 2));

      expect(data).toHaveProperty('query', 'contract');
      expect(data).toHaveProperty('results');
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('search_params');
      expect(data).toHaveProperty('timestamp');

      // Verify search params are respected
      expect(data.search_params).toMatchObject({
        useBm25: true,
        useEmbeddings: true,
        useReranker: false,
        threshold: 0.7,
      });
    });

    test('LLM can query knowledge://search with hybrid search disabled', async () => {
      const response = await client.readResource({
        uri: 'knowledge://search?query=test&use_bm25=false&use_embeddings=true',
      });

      const content = response.contents[0];
      const data = JSON.parse(content.text);

      expect(data.search_params.useBm25).toBe(false);
      expect(data.search_params.useEmbeddings).toBe(true);
    });

    test('LLM receives error for query without required parameter', async () => {
      const response = await client.readResource({
        uri: 'knowledge://search', // Missing ?query=
      });

      const content = response.contents[0];
      const data = JSON.parse(content.text);

      expect(data).toHaveProperty('error');
      expect(data.error).toContain('required');
    });

    test('LLM can query knowledge://status', async () => {
      const response = await client.readResource({
        uri: 'knowledge://status',
      });

      const content = response.contents[0];
      expect(content.mimeType).toBe('application/json');

      const data = JSON.parse(content.text);
      console.log('DEBUG: knowledge://status response:', JSON.stringify(data, null, 2));

      expect(data).toHaveProperty('total_entities');
      expect(data).toHaveProperty('total_relationships');
      expect(data).toHaveProperty('quality_metrics');
      expect(data).toHaveProperty('storage_info');
      expect(data).toHaveProperty('index_freshness');
      expect(data).toHaveProperty('timestamp');

      // Verify freshness strategy is documented
      expect(data.index_freshness.stale_check_method).toContain('mtime');
    });
  });

  describe('Data Validation: Real Indexed Content', () => {
    test('Search returns entities with expected structure', async () => {
      const response = await client.readResource({
        uri: 'knowledge://search?query=port&limit=10',
      });

      const content = response.contents[0];
      const data = JSON.parse(content.text);

      if (data.results && data.results.length > 0) {
        const entity = data.results[0];

        // Verify entity structure
        expect(entity).toHaveProperty('id');
        expect(entity).toHaveProperty('type');
        expect(entity).toHaveProperty('name');
        expect(entity).toHaveProperty('description');
        expect(entity).toHaveProperty('importance');
        expect(entity).toHaveProperty('confidence');

        // Verify importance/confidence are valid scores
        expect(entity.importance).toBeGreaterThanOrEqual(0);
        expect(entity.importance).toBeLessThanOrEqual(1);
        expect(entity.confidence).toBeGreaterThanOrEqual(0);
        expect(entity.confidence).toBeLessThanOrEqual(1);
      }
    });

    test('Status reports realistic entity counts', async () => {
      const response = await client.readResource({
        uri: 'knowledge://status',
      });

      const content = response.contents[0];
      const data = JSON.parse(content.text);

      // Should have some entities if setup script ran
      expect(typeof data.total_entities).toBe('number');
      expect(typeof data.total_relationships).toBe('number');

      // Quality metrics should exist
      expect(data.quality_metrics).toBeDefined();
      expect(typeof data.quality_metrics.avg_importance).toBe('number');
      expect(typeof data.quality_metrics.avg_confidence).toBe('number');
    });
  });

  describe('Performance: Resource Queries', () => {
    test('knowledge://search completes within reasonable time', async () => {
      const start = Date.now();

      await client.readResource({
        uri: 'knowledge://search?query=embedding&limit=10',
      });

      const elapsed = Date.now() - start;

      // Should complete within 2 seconds (target from META_DOCUMENTATION_MAP.md)
      expect(elapsed).toBeLessThan(2000);
    });

    test('knowledge://status completes within reasonable time', async () => {
      const start = Date.now();

      await client.readResource({
        uri: 'knowledge://status',
      });

      const elapsed = Date.now() - start;

      // Should be fast (just metadata query)
      expect(elapsed).toBeLessThan(500);
    });
  });
});
