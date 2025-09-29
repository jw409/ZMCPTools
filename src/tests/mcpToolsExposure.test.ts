/**
 * MCP Tools Exposure Test
 *
 * Verifies that all expected tools are properly exposed by the MCP server
 * by directly testing the server's getAvailableTools() method.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseManager } from '../database/index.js';
import { McpToolsServer } from '../server/McpServer.js';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('MCP Server Tool Exposure', () => {
  let server: McpToolsServer;
  let exposedTools: string[] = [];
  let tempDir: string;

  beforeAll(async () => {
    // Create temporary database for testing
    tempDir = mkdtempSync(path.join(tmpdir(), 'zmcp-exposure-test-'));
    const testDbPath = path.join(tempDir, 'test.db');

    // Initialize server with test database
    server = new McpToolsServer({
      name: 'zmcp-tools-test',
      version: '1.0.0',
      databasePath: testDbPath,
      transport: 'stdio'
    });

    // Don't start the server, just get available tools
    const tools = server.getAvailableTools();
    exposedTools = tools.map(t => t.name);
  });

  afterAll(() => {
    // Clean up temp directory
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should expose update_knowledge_entity tool', () => {
    expect(exposedTools).toContain('update_knowledge_entity');
  });

  it('should expose export_knowledge_graph tool', () => {
    expect(exposedTools).toContain('export_knowledge_graph');
  });

  it('should expose wipe_knowledge_graph tool', () => {
    expect(exposedTools).toContain('wipe_knowledge_graph');
  });

  it('should expose core knowledge graph tools', () => {
    expect(exposedTools).toContain('store_knowledge_memory');
    expect(exposedTools).toContain('search_knowledge_graph');
    expect(exposedTools).toContain('create_knowledge_relationship');
  });

  it('should expose GPU-accelerated tools', () => {
    // These are from gpuKnowledgeTools
    expect(exposedTools).toContain('gpu_semantic_search');
  });

  it('should list all exposed tools for debugging', () => {
    console.log('All exposed tools:', exposedTools);
    expect(exposedTools.length).toBeGreaterThan(0);
  });
});