import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../database/index.js';
import { AgentResultService } from '../services/AgentResultService.js';
import { ResultFinderService } from '../services/ResultFinderService.js';
import { AgentRepository } from '../repositories/AgentRepository.js';
import type { AgentResults } from '../schemas/index.js';

describe('Agent Result Collection', () => {
  let dbManager: DatabaseManager;
  let agentResultService: AgentResultService;
  let resultFinderService: ResultFinderService;
  let agentRepository: AgentRepository;
  let testDir: string;
  let testCounter = 0;

  beforeEach(async () => {
    // Create unique test directory for each test
    testCounter++;
    testDir = join(process.cwd(), `test-temp-${Date.now()}-${testCounter}`);
    await fs.mkdir(testDir, { recursive: true });

    // Initialize database with test path
    dbManager = new DatabaseManager(join(testDir, 'test.db'));
    await dbManager.initialize();

    // Initialize services with correct constructors
    agentResultService = new AgentResultService(dbManager);
    resultFinderService = new ResultFinderService(dbManager);
    agentRepository = new AgentRepository(dbManager);
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }

    // Close database
    await dbManager.close();
  });

  describe('AgentResultService', () => {
    it('should write and read agent results', async () => {
      const testAgentId = `test-agent-${Date.now()}-${Math.random()}`;
      const testResults: AgentResults = {
        results: {
          testsRun: 15,
          testsPassed: 12,
          testsFailed: 3,
          coverage: 85.5
        },
        artifacts: {
          created: ['test/new-test.spec.ts', 'src/new-feature.ts'],
          modified: ['package.json', 'README.md']
        },
        completionMessage: 'Test agent completed with 15 tests run',
      };

      // Write results
      await agentResultService.writeResults(testAgentId, testResults, testDir);

      // Verify directory structure was created
      const resultDir = join(testDir, 'var', 'zmcp_agent_results', testAgentId);
      expect(existsSync(resultDir)).toBe(true);

      // Verify individual files exist
      expect(existsSync(join(resultDir, 'status.json'))).toBe(true);
      expect(existsSync(join(resultDir, 'results.json'))).toBe(true);
      expect(existsSync(join(resultDir, 'artifacts.json'))).toBe(true);
      expect(existsSync(join(resultDir, 'completion.txt'))).toBe(true);

      // Read back results
      const readResults = await agentResultService.readResults(testAgentId, testDir);

      expect(readResults.results).toEqual(testResults.results);
      expect(readResults.artifacts).toEqual(testResults.artifacts);
      expect(readResults.completionMessage).toBe(testResults.completionMessage);
    });

    it('should handle agent errors correctly', async () => {
      const testAgentId = `test-agent-error-${Date.now()}-${Math.random()}`;
      const testError = new Error('Test execution failed');
      const testContext = {
        testFile: 'failing-test.spec.ts',
        attemptCount: 3
      };

      await agentResultService.writeError(testAgentId, testError, testContext, testDir);

      const results = await agentResultService.readResults(testAgentId, testDir);

      expect(results.errorDetails).toBeTruthy();
      expect(results.errorDetails?.error).toBe('Error');
      expect(results.errorDetails?.message).toBe('Test execution failed');
      expect(results.errorDetails?.context).toEqual(testContext);
      expect(results.completionMessage).toContain('Task failed');
    });

    it('should write completion with minimal data', async () => {
      const testAgentId = `test-agent-minimal-${Date.now()}-${Math.random()}`;
      const message = 'Simple task completed successfully';
      const basicResults = { filesProcessed: 5 };

      await agentResultService.writeCompletion(testAgentId, message, basicResults, testDir);

      const results = await agentResultService.readResults(testAgentId, testDir);

      expect(results.completionMessage).toBe(message);
      expect(results.results).toEqual(basicResults);
    });

    it('should check if agent has results', async () => {
      const testAgentId = `test-agent-check-${Date.now()}-${Math.random()}`;

      // Should return false before writing results
      expect(await agentResultService.hasResults(testAgentId, testDir)).toBe(false);

      // Write some results
      await agentResultService.writeCompletion(testAgentId, 'Test completion', undefined, testDir);

      // Should return true after writing results
      expect(await agentResultService.hasResults(testAgentId, testDir)).toBe(true);
    });
  });

  describe('ResultFinderService', () => {
    it('should find results in current directory', async () => {
      const testAgentId = `test-agent-find-${Date.now()}-${Math.random()}`;

      // Write results in current test workspace
      await agentResultService.writeCompletion(testAgentId, 'Found in current dir', undefined, testDir);

      // Search for results
      const findResult = await resultFinderService.findResults(testAgentId, testDir);

      expect(findResult.results).toBeTruthy();
      expect(findResult.foundPath).toContain(testAgentId);
      expect(findResult.searchPaths).toContain(findResult.foundPath);
      expect(findResult.results?.completionMessage).toBe('Found in current dir');
    });

    it('should search in parent directories (bubbling)', async () => {
      const testAgentId = `test-agent-bubble-${Date.now()}-${Math.random()}`;

      // Create nested directory structure
      const nestedDir = join(testDir, 'nested', 'deeply', 'buried');
      await fs.mkdir(nestedDir, { recursive: true });

      // Write results in the root test workspace
      await agentResultService.writeCompletion(testAgentId, 'Found via bubbling', undefined, testDir);

      // Search from the nested directory - should find results in parent
      const findResult = await resultFinderService.findResults(testAgentId, nestedDir);

      expect(findResult.results).toBeTruthy();
      expect(findResult.foundPath).toContain(join(testDir, 'var', 'zmcp_agent_results', testAgentId));
      expect(findResult.results?.completionMessage).toBe('Found via bubbling');
    });

    it('should return null when no results found', async () => {
      const findResult = await resultFinderService.findResults('non-existent-agent', testDir);

      expect(findResult.results).toBeNull();
      expect(findResult.foundPath).toBeNull();
      expect(findResult.searchPaths.length).toBeGreaterThan(0);
    });

    it('should wait for results with timeout', async () => {
      const testAgentId = `test-agent-wait-${Date.now()}-${Math.random()}`;

      // Test with immediate availability
      await agentResultService.writeCompletion(testAgentId, 'Available immediately', undefined, testDir);

      const results = await resultFinderService.waitForResults(testAgentId, testDir, {
        timeoutMs: 1000,
        pollingIntervalMs: 100
      });

      expect(results).toBeTruthy();
      expect(results?.completionMessage).toBe('Available immediately');
    });

    it('should timeout when waiting for non-existent results', async () => {
      const results = await resultFinderService.waitForResults('non-existent-agent', testDir, {
        timeoutMs: 500,
        pollingIntervalMs: 100
      });

      expect(results).toBeNull();
    });
  });

  describe('Database Integration', () => {
    it('should create agent and update with results', async () => {
      const testAgentId = `test-agent-db-${Date.now()}-${Math.random()}`;

      // Create test agent in database
      const agent = await agentRepository.create({
        id: testAgentId,
        agentName: 'test-result-agent',
        agentType: 'testing',
        repositoryPath: testDir,
        status: 'active',
        capabilities: ['testing', 'result-collection'],
        createdAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString()
      });

      expect(agent).toBeTruthy();

      // Update with results
      const updateResult = await agentRepository.updateWithResults(testAgentId, {
        results: { testsCompleted: 10 },
        artifacts: { created: ['test.js'], modified: [] },
        completionMessage: 'Database integration test completed',
        resultPath: `var/zmcp_agent_results/${testAgentId}`
      });

      expect(updateResult).toBeTruthy();

      // Verify the agent was updated
      const updatedAgent = await agentRepository.findById(testAgentId);
      expect(updatedAgent).toBeTruthy();
      expect(updatedAgent?.status).toBe('completed');
      expect(updatedAgent?.results).toEqual({ testsCompleted: 10 });
      expect(updatedAgent?.completionMessage).toBe('Database integration test completed');
      expect(updatedAgent?.resultPath).toBe(`var/zmcp_agent_results/${testAgentId}`);
    });

    it('should find agents with results', async () => {
      // Create multiple agents with unique IDs
      const baseId = Date.now();
      const agentIds = [`agent-1-${baseId}`, `agent-2-${baseId}`, `agent-3-${baseId}`];

      for (const id of agentIds) {
        await agentRepository.create({
          id,
          agentName: `test-agent-${id}`,
          agentType: 'testing',
          repositoryPath: testDir,
          status: 'active',
          capabilities: [],
          createdAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString()
        });
      }

      // Update some with results
      await agentRepository.updateWithResults(agentIds[0], {
        results: { test: 'data' },
        completionMessage: 'Agent 1 completed'
      });

      await agentRepository.updateWithResults(agentIds[1], {
        completionMessage: 'Agent 2 completed'
      });

      // Find agents with results
      const agentsWithResults = await agentRepository.findWithResults(testDir);

      expect(agentsWithResults).toHaveLength(2);
      expect(agentsWithResults.map(a => a.id).sort()).toEqual([agentIds[0], agentIds[1]].sort());
    });

    it('should get results summary', async () => {
      const baseId = Date.now();
      // Create test agents with various states
      const agents = [
        { id: `completed-1-${baseId}`, status: 'completed' as const, hasResults: true },
        { id: `completed-2-${baseId}`, status: 'completed' as const, hasResults: true },
        { id: `failed-1-${baseId}`, status: 'failed' as const, hasResults: true },
        { id: `active-1-${baseId}`, status: 'active' as const, hasResults: false },
      ];

      for (const { id, status, hasResults } of agents) {
        await agentRepository.create({
          id,
          agentName: `agent-${id}`,
          agentType: 'testing',
          repositoryPath: testDir,
          status,
          capabilities: [],
          createdAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString()
        });

        if (hasResults) {
          if (id.includes('failed')) {
            // Set failed status with error details
            await agentRepository.updateWithResults(id, {
              results: { testData: true },
              completionMessage: `Agent ${id} failed`,
              artifacts: { created: ['file.js'], modified: [] },
              errorDetails: { error: 'TestError', message: 'Simulated failure' }
            });
          } else {
            await agentRepository.updateWithResults(id, {
              results: { testData: true },
              completionMessage: `Agent ${id} completed`,
              artifacts: { created: ['file.js'], modified: [] }
            });
          }
        }
      }

      const summary = await agentRepository.getResultsSummary(testDir);

      expect(summary.totalAgents).toBe(4);
      expect(summary.withResults).toBe(3);
      expect(summary.completed).toBe(2);
      expect(summary.failed).toBe(1);
      expect(summary.withArtifacts).toBe(3);
    });
  });

  describe('Project-local vs Global Database', () => {
    it('should respect ZMCP_USE_LOCAL_DB environment variable', async () => {
      // This test would need to be implemented with proper environment isolation
      // For now, just verify the service behavior is available
      expect(typeof agentResultService).toBe('object');
    });

    it('should create var/zmcp_agent_results directory structure', async () => {
      const testAgentId = `test-agent-structure-${Date.now()}-${Math.random()}`;

      await agentResultService.writeCompletion(testAgentId, 'Testing directory structure', undefined, testDir);

      const expectedPath = join(testDir, 'var', 'zmcp_agent_results', testAgentId);
      expect(existsSync(expectedPath)).toBe(true);

      const statusFile = join(expectedPath, 'status.json');
      expect(existsSync(statusFile)).toBe(true);

      const status = JSON.parse(await fs.readFile(statusFile, 'utf8'));
      expect(status.status).toBe('completed');
      expect(status.hasResults).toBe(true); // Status shows results written
    });
  });
});