/**
 * Contract Indexing Service
 * Parses etc/contracts/*.json files and indexes metadata for fast search
 * Validates paths, ports, and schema references
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { Logger } from '../utils/logger.js';

const logger = new Logger('contract-indexing');

export interface ContractPort {
  port: number;
  service_name: string;
  status: string;
  health_status?: string;
  description?: string;
  notes?: string;
}

export interface ContractTool {
  name: string;
  path: string;
  purpose?: string;
  status: string;
  owner?: string;
  trust?: string;
  verified?: string;
  journal_aware?: boolean;
  scope?: string;
}

export interface ContractSchema {
  file_path: string;
  schema_type: 'port_registry' | 'tool_registry' | 'unknown';
  version: string;
  scope: string;
  last_updated: string;
  ports?: ContractPort[];
  tools?: ContractTool[];
}

export interface PathValidationResult {
  path: string;
  exists: boolean;
  type?: 'file' | 'directory' | 'missing';
  error?: string;
}

export interface IndexingResult {
  success: boolean;
  schemas_indexed: number;
  ports_indexed: number;
  tools_indexed: number;
  path_validations: PathValidationResult[];
  errors: string[];
  indexing_time_ms: number;
}

export class ContractIndexingService {
  private contractsDir: string;
  private indexed: Map<string, ContractSchema> = new Map();

  constructor(repositoryPath: string) {
    this.contractsDir = path.join(repositoryPath, 'etc', 'contracts');
  }

  /**
   * Find all contract JSON files
   */
  async findContractFiles(): Promise<string[]> {
    try {
      const pattern = path.join(this.contractsDir, '*.json');
      const files = await glob(pattern, { absolute: true });
      return files;
    } catch (error) {
      logger.error('Error finding contract files', { error });
      return [];
    }
  }

  /**
   * Parse a contract JSON file
   */
  async parseContractFile(filePath: string): Promise<ContractSchema | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Detect schema type from filename
      const fileName = path.basename(filePath);
      let schema_type: 'port_registry' | 'tool_registry' | 'unknown' = 'unknown';

      if (fileName.includes('port')) {
        schema_type = 'port_registry';
      } else if (fileName.includes('tool')) {
        schema_type = 'tool_registry';
      }

      const schema: ContractSchema = {
        file_path: filePath,
        schema_type,
        version: data.version || '1.0.0',
        scope: data.scope || 'dom0',
        last_updated: data.last_updated || new Date().toISOString(),
        ports: data.ports || [],
        tools: data.tools || []
      };

      return schema;
    } catch (error) {
      logger.error('Error parsing contract file', { filePath, error });
      return null;
    }
  }

  /**
   * Validate that paths in contract actually exist
   */
  async validatePaths(schema: ContractSchema, repositoryPath: string): Promise<PathValidationResult[]> {
    const results: PathValidationResult[] = [];

    // Validate tool paths
    if (schema.tools) {
      for (const tool of schema.tools) {
        const fullPath = path.join(repositoryPath, tool.path);
        try {
          const stats = await fs.stat(fullPath);
          results.push({
            path: tool.path,
            exists: true,
            type: stats.isDirectory() ? 'directory' : 'file'
          });
        } catch (error) {
          results.push({
            path: tool.path,
            exists: false,
            type: 'missing',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    return results;
  }

  /**
   * Index all contract files
   */
  async indexContracts(repositoryPath: string): Promise<IndexingResult> {
    const startTime = Date.now();
    const result: IndexingResult = {
      success: true,
      schemas_indexed: 0,
      ports_indexed: 0,
      tools_indexed: 0,
      path_validations: [],
      errors: [],
      indexing_time_ms: 0
    };

    try {
      const contractFiles = await this.findContractFiles();
      logger.info('Found contract files', { count: contractFiles.length });

      for (const filePath of contractFiles) {
        const schema = await this.parseContractFile(filePath);

        if (schema) {
          this.indexed.set(filePath, schema);
          result.schemas_indexed++;
          result.ports_indexed += schema.ports?.length || 0;
          result.tools_indexed += schema.tools?.length || 0;

          // Validate paths
          const validations = await this.validatePaths(schema, repositoryPath);
          result.path_validations.push(...validations);
        } else {
          result.errors.push(`Failed to parse: ${filePath}`);
        }
      }

      result.indexing_time_ms = Date.now() - startTime;
      logger.info('Contract indexing complete', result);

    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      logger.error('Contract indexing failed', { error });
    }

    result.indexing_time_ms = Date.now() - startTime;
    return result;
  }

  /**
   * Search contracts by keyword
   */
  searchContracts(query: string): ContractSchema[] {
    const lowerQuery = query.toLowerCase();
    const results: ContractSchema[] = [];

    for (const schema of this.indexed.values()) {
      // Search ports
      if (schema.ports) {
        for (const port of schema.ports) {
          if (
            port.service_name.toLowerCase().includes(lowerQuery) ||
            port.port.toString().includes(query) ||
            port.description?.toLowerCase().includes(lowerQuery)
          ) {
            results.push(schema);
            break;
          }
        }
      }

      // Search tools
      if (schema.tools) {
        for (const tool of schema.tools) {
          if (
            tool.name.toLowerCase().includes(lowerQuery) ||
            tool.path.toLowerCase().includes(lowerQuery) ||
            tool.purpose?.toLowerCase().includes(lowerQuery)
          ) {
            results.push(schema);
            break;
          }
        }
      }
    }

    return results;
  }

  /**
   * Get specific port by number
   */
  getPort(portNumber: number): ContractPort | null {
    for (const schema of this.indexed.values()) {
      if (schema.ports) {
        const port = schema.ports.find(p => p.port === portNumber);
        if (port) return port;
      }
    }
    return null;
  }

  /**
   * Get specific tool by name
   */
  getTool(toolName: string): ContractTool | null {
    for (const schema of this.indexed.values()) {
      if (schema.tools) {
        const tool = schema.tools.find(t => t.name === toolName);
        if (tool) return tool;
      }
    }
    return null;
  }

  /**
   * Get all indexed schemas
   */
  getAllSchemas(): ContractSchema[] {
    return Array.from(this.indexed.values());
  }
}
