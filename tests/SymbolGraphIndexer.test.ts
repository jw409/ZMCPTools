import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import * as knowledgeGraphTools from '../src/tools/knowledgeGraphTools.js';

// Mock the entire module
vi.mock('../src/tools/knowledgeGraphTools.js');

describe('SymbolGraphIndexer', () => {
  let tempDir: string;
  let indexer: SymbolGraphIndexer;

  beforeEach(() => {
    tempDir = join(tmpdir(), `zmcp-symbol-graph-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    indexer = new SymbolGraphIndexer();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await indexer.close();
    } catch (error) {}
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {}
  });

  // ... (existing tests) ...

  describe('API Conformance Linking', () => {
    test('should link backend and frontend symbols to an OpenAPI spec', async () => {
      // Spy on the specific functions for this test
      const storeMock = vi.spyOn(knowledgeGraphTools, 'storeKnowledgeMemory').mockResolvedValue({ success: true, entity_id: 'mock-id' });
      const relationshipMock = vi.spyOn(knowledgeGraphTools, 'createKnowledgeRelationship').mockResolvedValue({ success: true, relationship_id: 'mock-id' });
      vi.spyOn(indexer, 'generatePendingEmbeddings' as any).mockResolvedValue();

      // 1. Setup: Create dummy files
      const openapiSpecPath = join(tempDir, 'openapi.json');
      const backendPyPath = join(tempDir, 'main.py');
      const frontendTsPath = join(tempDir, 'apiClient.ts');

      const openapiSpec = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/users/{id}': {
            get: { summary: 'Get a user by ID', operationId: 'get_user_by_id' },
          },
        },
      };
      writeFileSync(openapiSpecPath, JSON.stringify(openapiSpec, null, 2));

      const backendCode = `
from fastapi import FastAPI
app = FastAPI()
@app.get("/users/{id}")
def get_user(id: str):
    return {"id": id, "name": "Test User"}
`;
      writeFileSync(backendPyPath, backendCode);

      const frontendCode = "import fetch from 'node-fetch';\n" +
        "export async function fetchUser(id: string) {\n" +
        "  const response = await fetch('/users/' + id);\n" +
        "  return response.json();\n" +
        "}\n";
      writeFileSync(frontendTsPath, frontendCode);

      await indexer.initialize(tempDir);

      // 2. Execution
      await indexer.indexRepository(tempDir, { openapi_spec: openapiSpecPath });

      // 3. Assertions
      expect(storeMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entity_type: 'api_endpoint',
          entity_name: 'GET /users/{id}',
        })
      );

      expect(relationshipMock).toHaveBeenCalledTimes(2);

      expect(relationshipMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ relationship_type: 'implements_endpoint' })
      );

      expect(relationshipMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ relationship_type: 'calls_endpoint' })
      );
    }, 20000);
  });
});
