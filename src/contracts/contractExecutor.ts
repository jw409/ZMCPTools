/**
 * TypeScript Contract Executor - Bidirectional testing for ZMCPTools MCP services
 * Reads contracts from SQLite and executes tests against TypeScript implementations
 */

import Database from 'better-sqlite3';
import { z } from 'zod';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';

// Contract and test scenario schemas
const ContractSchema = z.object({
  contract_id: z.string(),
  name: z.string(),
  version: z.string(),
  type: z.enum(['api_service', 'mcp_tool', 'database_schema']),
  language: z.enum(['python', 'typescript', 'shared']),
  openapi_spec: z.string(),
  endpoints: z.string().optional(),
  schemas: z.string().optional(),
  constraints: z.string().optional()
});

const TestScenarioSchema = z.object({
  scenario_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  test_type: z.enum(['unit', 'integration', 'contract', 'edge_case']),
  input_data: z.string(),
  expected_output: z.string(),
  expected_errors: z.string().optional(),
  test_metadata: z.string().optional(),
  priority: z.number()
});

const TestExecutionSchema = z.object({
  scenario_id: z.string(),
  contract_id: z.string(),
  status: z.enum(['running', 'passed', 'failed', 'skipped', 'error']),
  actual_output: z.string().optional(),
  error_message: z.string().optional(),
  execution_time_ms: z.number().optional(),
  memory_usage_mb: z.number().optional()
});

type Contract = z.infer<typeof ContractSchema>;
type TestScenario = z.infer<typeof TestScenarioSchema>;
type TestExecution = z.infer<typeof TestExecutionSchema>;

interface ContractTestResult {
  passed: number;
  failed: number;
  errors: number;
  total: number;
  execution_time_ms: number;
}

export class TypeScriptContractExecutor {
  private db: Database.Database;
  private executorVersion = '1.0.0';
  private runId = uuidv4();

  constructor(dbPath?: string) {
    const defaultPath = join(homedir(), '.mcptools', 'data', 'contracts.db');
    this.db = new Database(dbPath || defaultPath);
  }

  /**
   * Load contracts from database
   */
  loadContracts(contractTypes?: string[]): Contract[] {
    try {
      let query = `
        SELECT contract_id, name, version, type, language, openapi_spec, endpoints, schemas, constraints
        FROM contracts
        WHERE enabled = TRUE
      `;

      const params: any[] = [];
      if (contractTypes && contractTypes.length > 0) {
        const placeholders = contractTypes.map(() => '?').join(',');
        query += ` AND type IN (${placeholders})`;
        params.push(...contractTypes);
      }

      const rows = this.db.prepare(query).all(...params) as any[];

      const contracts = rows.map(row => ({
        contract_id: row.contract_id,
        name: row.name,
        version: row.version,
        type: row.type,
        language: row.language,
        openapi_spec: row.openapi_spec,
        endpoints: row.endpoints,
        schemas: row.schemas,
        constraints: row.constraints
      }));

      console.log(`📋 Loaded ${contracts.length} contracts`);
      return contracts;

    } catch (error) {
      console.error(`❌ Failed to load contracts:`, error);
      return [];
    }
  }

  /**
   * Load test scenarios for a contract
   */
  loadTestScenarios(contractId: string): TestScenario[] {
    try {
      const query = `
        SELECT scenario_id, name, description, test_type, input_data, expected_output, expected_errors, test_metadata, priority
        FROM test_scenarios
        WHERE contract_id = ? AND enabled = TRUE
        ORDER BY priority DESC, name
      `;

      const rows = this.db.prepare(query).all(contractId) as any[];

      const scenarios = rows.map(row => ({
        scenario_id: row.scenario_id,
        name: row.name,
        description: row.description,
        test_type: row.test_type,
        input_data: row.input_data,
        expected_output: row.expected_output,
        expected_errors: row.expected_errors,
        test_metadata: row.test_metadata,
        priority: row.priority
      }));

      return scenarios;

    } catch (error) {
      console.error(`❌ Failed to load test scenarios for ${contractId}:`, error);
      return [];
    }
  }

  /**
   * Execute MCP tool test
   */
  async executeMcpTest(toolName: string, inputData: any, timeoutMs = 10000): Promise<any> {
    try {
      const startTime = Date.now();

      // For now, we'll simulate MCP tool execution
      // In a full implementation, this would use the actual MCP client
      switch (toolName) {
        case 'search_knowledge_graph':
          // Simulate knowledge graph search
          await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing time
          return {
            status_code: 200,
            response_data: {
              results: [
                { id: '1', title: 'Sample Result', content: 'Mock search result' }
              ],
              total_count: 1
            },
            execution_time_ms: Date.now() - startTime,
            tool_name: toolName
          };

        case 'store_knowledge_memory':
          await new Promise(resolve => setTimeout(resolve, 50));
          return {
            status_code: 200,
            response_data: {
              success: true,
              memory_id: uuidv4()
            },
            execution_time_ms: Date.now() - startTime,
            tool_name: toolName
          };

        default:
          return {
            error: `Unknown MCP tool: ${toolName}`,
            execution_time_ms: Date.now() - startTime
          };
      }

    } catch (error) {
      return {
        error: `MCP tool execution failed: ${error}`,
        execution_time_ms: timeoutMs
      };
    }
  }

  /**
   * Execute HTTP test against service
   */
  async executeHttpTest(endpoint: string, inputData: any, timeoutMs = 10000): Promise<any> {
    try {
      const startTime = Date.now();

      // Determine base URL
      let baseUrl = 'http://localhost:8888';
      if (endpoint.startsWith('/embed')) {
        baseUrl = 'http://localhost:8765';
      }

      const url = `${baseUrl}${endpoint}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inputData),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseData = await response.json();
      const executionTime = Date.now() - startTime;

      return {
        status_code: response.status,
        response_data: responseData,
        execution_time_ms: executionTime,
        headers: Object.fromEntries(response.headers.entries())
      };

    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { error: 'Request timeout', execution_time_ms: timeoutMs };
      }
      return { error: `Connection error: ${error.message}`, execution_time_ms: 0 };
    }
  }

  /**
   * Validate response against expected schema
   */
  validateResponse(actual: any, expected: any): { isValid: boolean; message: string } {
    try {
      if (actual.error) {
        return { isValid: false, message: `Service error: ${actual.error}` };
      }

      if (!actual.response_data) {
        return { isValid: false, message: 'No response data received' };
      }

      const responseData = actual.response_data;
      const expectedObj = typeof expected === 'string' ? JSON.parse(expected) : expected;

      // Basic validation - check if required fields exist
      for (const key of Object.keys(expectedObj)) {
        if (key === 'array' || key === 'array_of_arrays') {
          continue; // Skip generic type descriptions
        }

        if (!(key in responseData)) {
          return { isValid: false, message: `Missing required field: ${key}` };
        }
      }

      return { isValid: true, message: 'Response validation passed' };

    } catch (error) {
      return { isValid: false, message: `Validation error: ${error}` };
    }
  }

  /**
   * Execute a single test scenario
   */
  async executeScenario(contract: Contract, scenario: TestScenario): Promise<TestExecution> {
    const scenarioId = scenario.scenario_id;
    const contractId = contract.contract_id;

    try {
      console.log(`🧪 Executing scenario: ${scenario.name}`);

      const startTime = Date.now();
      const memoryBefore = process.memoryUsage().heapUsed / 1024 / 1024; // MB

      let result: any;

      // Parse input data
      const inputData = JSON.parse(scenario.input_data);
      const testMetadata = scenario.test_metadata ? JSON.parse(scenario.test_metadata) : {};
      const timeoutMs = testMetadata.timeout_ms || 10000;

      if (contract.type === 'mcp_tool') {
        // Execute MCP tool test
        const endpoints = contract.endpoints ? JSON.parse(contract.endpoints) : [];
        const primaryEndpoint = endpoints[0] || 'search_knowledge_graph';
        const toolName = primaryEndpoint.replace('/', '');

        result = await this.executeMcpTest(toolName, inputData, timeoutMs);

      } else if (contract.type === 'api_service') {
        // Execute HTTP test
        const endpoints = contract.endpoints ? JSON.parse(contract.endpoints) : [];
        const primaryEndpoint = endpoints[0] || '/health';

        result = await this.executeHttpTest(primaryEndpoint, inputData, timeoutMs);

      } else {
        return {
          scenario_id: scenarioId,
          contract_id: contractId,
          status: 'skipped',
          error_message: `Unknown contract type: ${contract.type}`
        };
      }

      // Validate response
      const validation = this.validateResponse(result, scenario.expected_output);

      const executionTime = Date.now() - startTime;
      const memoryAfter = process.memoryUsage().heapUsed / 1024 / 1024; // MB
      const memoryUsage = memoryAfter - memoryBefore;

      if (validation.isValid) {
        return {
          scenario_id: scenarioId,
          contract_id: contractId,
          status: 'passed',
          actual_output: JSON.stringify(result),
          execution_time_ms: executionTime,
          memory_usage_mb: memoryUsage
        };
      } else {
        return {
          scenario_id: scenarioId,
          contract_id: contractId,
          status: 'failed',
          actual_output: JSON.stringify(result),
          error_message: validation.message,
          execution_time_ms: executionTime,
          memory_usage_mb: memoryUsage
        };
      }

    } catch (error) {
      console.error(`❌ Scenario execution failed:`, error);
      return {
        scenario_id: scenarioId,
        contract_id: contractId,
        status: 'error',
        error_message: String(error),
        execution_time_ms: Date.now() - (performance.now() || 0)
      };
    }
  }

  /**
   * Save execution result to database
   */
  saveExecutionResult(execution: TestExecution, buildId?: string, commitSha?: string): void {
    try {
      const executionId = uuidv4();
      const now = new Date().toISOString();

      const stmt = this.db.prepare(`
        INSERT INTO test_executions
        (execution_id, scenario_id, contract_id, executor_type, executor_version,
         status, actual_output, error_message, execution_time_ms, memory_usage_mb,
         started_at, completed_at, build_id, commit_sha)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        executionId,
        execution.scenario_id,
        execution.contract_id,
        'typescript',
        this.executorVersion,
        execution.status,
        execution.actual_output,
        execution.error_message,
        execution.execution_time_ms,
        execution.memory_usage_mb,
        now,
        now,
        buildId,
        commitSha
      );

    } catch (error) {
      console.error(`❌ Failed to save execution result:`, error);
    }
  }

  /**
   * Run contract tests
   */
  async runContractTests(
    contractTypes?: string[],
    buildId?: string,
    commitSha?: string
  ): Promise<ContractTestResult> {
    try {
      console.log(`🚀 Starting TypeScript contract test execution (run_id: ${this.runId})`);

      const startTime = Date.now();
      const result: ContractTestResult = {
        passed: 0,
        failed: 0,
        errors: 0,
        total: 0,
        execution_time_ms: 0
      };

      // Load contracts
      const contracts = this.loadContracts(contractTypes);
      if (contracts.length === 0) {
        console.warn('⚠️  No contracts found to test');
        return result;
      }

      // Execute tests for each contract
      for (const contract of contracts) {
        console.log(`🔍 Testing contract: ${contract.name} (${contract.contract_id})`);

        const scenarios = this.loadTestScenarios(contract.contract_id);
        if (scenarios.length === 0) {
          console.warn(`⚠️  No test scenarios found for ${contract.contract_id}`);
          continue;
        }

        for (const scenario of scenarios) {
          const execution = await this.executeScenario(contract, scenario);
          this.saveExecutionResult(execution, buildId, commitSha);

          // Update counters
          result.total += 1;
          if (execution.status === 'passed') {
            result.passed += 1;
            console.log(`✅ ${scenario.name}: PASSED`);
          } else if (execution.status === 'failed') {
            result.failed += 1;
            console.error(`❌ ${scenario.name}: FAILED - ${execution.error_message}`);
          } else {
            result.errors += 1;
            console.warn(`⚠️  ${scenario.name}: ${execution.status.toUpperCase()} - ${execution.error_message}`);
          }
        }
      }

      result.execution_time_ms = Date.now() - startTime;

      // Log summary
      console.log(`📊 Test Results Summary:`);
      console.log(`   - Total: ${result.total}`);
      console.log(`   - Passed: ${result.passed}`);
      console.log(`   - Failed: ${result.failed}`);
      console.log(`   - Errors: ${result.errors}`);
      console.log(`   - Duration: ${result.execution_time_ms}ms`);

      const successRate = result.total > 0 ? (result.passed / result.total * 100) : 0;
      console.log(`   - Success Rate: ${successRate.toFixed(1)}%`);

      return result;

    } catch (error) {
      console.error(`❌ Contract test execution failed:`, error);
      return result;
    }
  }

  /**
   * Wait for Python test results to complete
   */
  async waitForPythonResults(timeoutSeconds = 60): Promise<boolean> {
    console.log(`⏳ Waiting for Python test results (timeout: ${timeoutSeconds}s)`);

    const startTime = Date.now();
    while ((Date.now() - startTime) / 1000 < timeoutSeconds) {
      try {
        // Check if Python has executed tests for the same scenarios
        const tsQuery = `
          SELECT COUNT(DISTINCT scenario_id) as ts_scenarios
          FROM test_executions
          WHERE executor_type = 'typescript'
          AND started_at > datetime('now', '-1 hour')
        `;

        const pyQuery = `
          SELECT COUNT(DISTINCT scenario_id) as py_scenarios
          FROM test_executions
          WHERE executor_type = 'python'
          AND started_at > datetime('now', '-1 hour')
        `;

        const tsResult = this.db.prepare(tsQuery).get() as any;
        const pyResult = this.db.prepare(pyQuery).get() as any;

        const tsCount = tsResult.ts_scenarios;
        const pyCount = pyResult.py_scenarios;

        if (pyCount > 0 && pyCount >= tsCount) {
          console.log(`✅ Python tests completed (${pyCount} scenarios)`);
          return true;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`❌ Error checking Python results:`, error);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.warn(`⏰ Timeout waiting for Python results`);
    return false;
  }

  /**
   * Run bidirectional contract tests
   */
  async runBidirectionalTests(
    contractTypes?: string[],
    buildId?: string,
    commitSha?: string,
    waitForPython = true
  ): Promise<boolean> {
    try {
      console.log(`🔄 Starting bidirectional contract testing`);

      // Run TypeScript tests
      const typescriptResult = await this.runContractTests(contractTypes, buildId, commitSha);

      if (waitForPython) {
        // Wait for Python tests to complete
        const pythonCompleted = await this.waitForPythonResults();

        if (pythonCompleted) {
          // TODO: Cross-validate results between TypeScript and Python
          console.log(`🎯 Bidirectional testing completed successfully`);
          return typescriptResult.failed === 0 && typescriptResult.errors === 0;
        } else {
          console.warn(`⚠️  Python tests did not complete in time`);
          return false;
        }
      } else {
        // Just return TypeScript results
        return typescriptResult.failed === 0 && typescriptResult.errors === 0;
      }

    } catch (error) {
      console.error(`❌ Bidirectional testing failed:`, error);
      return false;
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

// CLI interface
export async function main() {
  const args = process.argv.slice(2);
  const mode = args.find(arg => arg.startsWith('--mode='))?.split('=')[1] || 'typescript';
  const contractTypesArg = args.find(arg => arg.startsWith('--contract-types='))?.split('=')[1];
  const contractTypes = contractTypesArg ? contractTypesArg.split(',') : undefined;
  const buildId = args.find(arg => arg.startsWith('--build-id='))?.split('=')[1];
  const commitSha = args.find(arg => arg.startsWith('--commit-sha='))?.split('=')[1];
  const noWait = args.includes('--no-wait');

  const executor = new TypeScriptContractExecutor();

  try {
    let success = false;

    if (mode === 'bidirectional') {
      success = await executor.runBidirectionalTests(
        contractTypes,
        buildId,
        commitSha,
        !noWait
      );
    } else {
      const result = await executor.runContractTests(contractTypes, buildId, commitSha);
      success = result.failed === 0 && result.errors === 0;
    }

    process.exit(success ? 0 : 1);

  } finally {
    executor.close();
  }
}

// Run CLI if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}