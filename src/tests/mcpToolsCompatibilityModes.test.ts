/**
 * MCP Server Compatibility Modes Test
 *
 * Verifies that the correct tools are exposed in each compatibility mode:
 * - Standard: Base tools + SharedState
 * - OpenRouter: Base tools + FileSystem + ResourceWrappers
 * - Gemini: Base tools + ResourceWrappers
 * - Agent: Base tools + SharedState
 */

import { describe, it, expect } from 'vitest';
import { McpToolsServer } from '../server/McpServer.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('MCP Server Compatibility Modes', () => {
  const createTestServer = (options: any) => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'zmcp-mode-test-'));
    const testDbPath = path.join(tempDir, 'test.db');

    const server = new McpToolsServer({
      name: 'zmcp-tools-test',
      version: '1.0.0',
      databasePath: testDbPath,
      repositoryPath: process.cwd(),
      transport: 'stdio',
      ...options
    });

    return { server, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
  };

  describe('Standard Mode (default)', () => {
    it('should have base tools + SharedState tools', () => {
      const { server, cleanup } = createTestServer({});

      const tools = server.getAvailableTools();
      const toolNames = tools.map(t => t.name);

      // Base tools (always present)
      expect(toolNames).toContain('store_knowledge_memory');
      expect(toolNames).toContain('search_knowledge_graph_gpu');
      expect(toolNames).toContain('index_symbol_graph');

      // SharedState tools (only in Standard/Agent mode)
      expect(toolNames).toContain('todo_write');
      expect(toolNames).toContain('todo_read');
      expect(toolNames).toContain('broadcast_progress');
      expect(toolNames).toContain('register_artifact');

      // Should NOT have FileSystem tools
      expect(toolNames).not.toContain('read_file');
      expect(toolNames).not.toContain('write_file');

      // Should NOT have ResourceWrapper tools (Standard mode uses resources directly)
      expect(toolNames).not.toContain('get_file_symbols');
      expect(toolNames).not.toContain('get_knowledge_search');

      console.log(`Standard mode: ${toolNames.length} tools`);
      cleanup();
    });
  });

  describe('OpenRouter Compatibility Mode', () => {
    it('should have base tools + FileSystem + ResourceWrappers + CommunicationTools', () => {
      const { server, cleanup } = createTestServer({ openrouterCompat: true });

      const tools = server.getAvailableTools();
      const toolNames = tools.map(t => t.name);

      // Base tools
      expect(toolNames).toContain('store_knowledge_memory');
      expect(toolNames).toContain('index_symbol_graph');

      // FileSystem tools (OpenRouter specific)
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');

      // ResourceWrapper tools (OpenRouter specific)
      expect(toolNames).toContain('get_file_symbols');
      expect(toolNames).toContain('get_file_imports');
      expect(toolNames).toContain('get_knowledge_search');
      expect(toolNames).toContain('get_vector_collections');

      // CommunicationTools (OpenRouter agents need coordination)
      expect(toolNames).toContain('join_room');
      expect(toolNames).toContain('send_message');
      expect(toolNames).toContain('wait_for_messages');
      expect(toolNames).toContain('list_rooms');

      // Should NOT have SharedState tools
      expect(toolNames).not.toContain('todo_write');
      expect(toolNames).not.toContain('todo_read');

      console.log(`OpenRouter mode: ${toolNames.length} tools`);
      cleanup();
    });

    it('should have all 16 resource wrapper tools', () => {
      const { server, cleanup } = createTestServer({ openrouterCompat: true });

      const tools = server.getAvailableTools();
      const toolNames = tools.map(t => t.name);

      const expectedWrappers = [
        // File Analysis (5)
        'get_file_symbols',
        'get_file_imports',
        'get_file_exports',
        'get_file_structure',
        'get_file_diagnostics',
        // Project Analysis (3)
        'get_project_structure',
        'get_project_dependencies',
        'get_project_dependents',
        // Symbol Graph (3)
        'get_symbols_list',
        'get_symbols_search',
        'get_symbols_stats',
        // Knowledge Graph (2)
        'get_knowledge_search',
        'get_knowledge_status',
        // Vector Search (3)
        'get_vector_collections',
        'get_vector_search',
        'get_vector_status'
      ];

      for (const wrapper of expectedWrappers) {
        expect(toolNames).toContain(wrapper);
      }

      expect(expectedWrappers).toHaveLength(16);
      cleanup();
    });
  });

  describe('Gemini Compatibility Mode', () => {
    it('should have base tools + ResourceWrappers (no FileSystem)', () => {
      const { server, cleanup } = createTestServer({ geminiCompat: true });

      const tools = server.getAvailableTools();
      const toolNames = tools.map(t => t.name);

      // Base tools
      expect(toolNames).toContain('store_knowledge_memory');
      expect(toolNames).toContain('index_symbol_graph');

      // ResourceWrapper tools (Gemini specific)
      expect(toolNames).toContain('get_file_symbols');
      expect(toolNames).toContain('get_knowledge_search');
      expect(toolNames).toContain('get_vector_collections');

      // Should NOT have SharedState tools
      expect(toolNames).not.toContain('todo_write');
      expect(toolNames).not.toContain('todo_read');

      // Should NOT have FileSystem tools
      expect(toolNames).not.toContain('read_file');
      expect(toolNames).not.toContain('write_file');

      console.log(`Gemini mode: ${toolNames.length} tools`);
      cleanup();
    });
  });

  describe('Agent Mode', () => {
    it('should have base tools + SharedState + CommunicationTools', () => {
      const { server, cleanup } = createTestServer({ includeAgentTools: true });

      const tools = server.getAvailableTools();
      const toolNames = tools.map(t => t.name);

      // Base tools
      expect(toolNames).toContain('store_knowledge_memory');
      expect(toolNames).toContain('index_symbol_graph');

      // SharedState tools (Agent mode supports coordination)
      expect(toolNames).toContain('todo_write');
      expect(toolNames).toContain('todo_read');
      expect(toolNames).toContain('broadcast_progress');
      expect(toolNames).toContain('register_artifact');

      // CommunicationTools (Agent mode needs inter-agent coordination)
      expect(toolNames).toContain('join_room');
      expect(toolNames).toContain('send_message');
      expect(toolNames).toContain('wait_for_messages');
      expect(toolNames).toContain('list_rooms');

      // Should NOT have FileSystem tools
      expect(toolNames).not.toContain('read_file');
      expect(toolNames).not.toContain('write_file');

      // Should NOT have ResourceWrapper tools
      expect(toolNames).not.toContain('get_file_symbols');

      console.log(`Agent mode: ${toolNames.length} tools`);
      cleanup();
    });
  });

  describe('Tool Count Expectations', () => {
    it('should match expected tool counts for each mode', () => {
      // Standard mode
      const standard = createTestServer({});
      const standardTools = standard.server.getAvailableTools();
      console.log(`Standard: ${standardTools.length} tools (15 base + 4 SharedState = 19)`);
      expect(standardTools.length).toBeGreaterThanOrEqual(19);
      standard.cleanup();

      // OpenRouter mode
      const openrouter = createTestServer({ openrouterCompat: true });
      const openrouterTools = openrouter.server.getAvailableTools();
      console.log(`OpenRouter: ${openrouterTools.length} tools (16 base + 2 FileSystem + 16 ResourceWrappers + 10 Communication = 44)`);
      expect(openrouterTools.length).toBeGreaterThanOrEqual(44);
      openrouter.cleanup();

      // Gemini mode
      const gemini = createTestServer({ geminiCompat: true });
      const geminiTools = gemini.server.getAvailableTools();
      console.log(`Gemini: ${geminiTools.length} tools (16 base + 16 ResourceWrappers = 32)`);
      expect(geminiTools.length).toBeGreaterThanOrEqual(32);
      gemini.cleanup();

      // Agent mode
      const agent = createTestServer({ includeAgentTools: true });
      const agentTools = agent.server.getAvailableTools();
      console.log(`Agent: ${agentTools.length} tools (16 base + 4 SharedState + 10 Communication = 30)`);
      expect(agentTools.length).toBeGreaterThanOrEqual(30);
      agent.cleanup();
    });
  });

  describe('Mode Exclusivity', () => {
    it('SharedState and ResourceWrappers should be mutually exclusive', () => {
      // Standard has SharedState, not ResourceWrappers
      const standard = createTestServer({});
      const standardTools = standard.server.getAvailableTools().map(t => t.name);
      expect(standardTools).toContain('todo_write');
      expect(standardTools).not.toContain('get_file_symbols');
      standard.cleanup();

      // OpenRouter has ResourceWrappers, not SharedState
      const openrouter = createTestServer({ openrouterCompat: true });
      const openrouterTools = openrouter.server.getAvailableTools().map(t => t.name);
      expect(openrouterTools).toContain('get_file_symbols');
      expect(openrouterTools).not.toContain('todo_write');
      openrouter.cleanup();
    });

    it('FileSystem tools only in OpenRouter mode', () => {
      const modes = [
        { name: 'Standard', options: {} },
        { name: 'OpenRouter', options: { openrouterCompat: true } },
        { name: 'Gemini', options: { geminiCompat: true } },
        { name: 'Agent', options: { includeAgentTools: true } }
      ];

      for (const mode of modes) {
        const { server, cleanup } = createTestServer(mode.options);
        const toolNames = server.getAvailableTools().map(t => t.name);

        if (mode.name === 'OpenRouter') {
          expect(toolNames).toContain('read_file');
          expect(toolNames).toContain('write_file');
        } else {
          expect(toolNames).not.toContain('read_file');
          expect(toolNames).not.toContain('write_file');
        }

        cleanup();
      }
    });
  });
});
