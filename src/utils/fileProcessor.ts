import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, extname, basename } from 'path';

export interface FileProcessorOptions {
  encoding?: BufferEncoding;
  skipInvalidRows?: boolean;
  validateSchema?: boolean;
  outputPath?: string;
  transformations?: TransformationConfig[];
}

export interface TransformationConfig {
  type: 'filter' | 'map' | 'validate' | 'sort' | 'group';
  field?: string;
  condition?: (value: any) => boolean;
  transform?: (value: any) => any;
  validator?: (value: any) => boolean;
  sortBy?: string;
  groupBy?: string;
}

export interface ProcessingResult {
  success: boolean;
  data?: any;
  errors?: string[];
  warnings?: string[];
  metadata: {
    inputFile: string;
    outputFile?: string;
    processingTime: number;
    recordsProcessed: number;
    recordsValid: number;
    format: string;
  };
}

export class FileProcessorError extends Error {
  constructor(
    message: string,
    public code: string,
    public file?: string,
    public line?: number
  ) {
    super(message);
    this.name = 'FileProcessorError';
  }
}

export class FileProcessor {
  private options: FileProcessorOptions;

  constructor(options: FileProcessorOptions = {}) {
    this.options = {
      encoding: 'utf8',
      skipInvalidRows: false,
      validateSchema: true,
      ...options
    };
  }

  /**
   * Process a file with specified transformations
   */
  async processFile(filePath: string, options?: FileProcessorOptions): Promise<ProcessingResult> {
    const startTime = Date.now();
    const mergedOptions = { ...this.options, ...options };
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Validate file exists
      if (!existsSync(filePath)) {
        throw new FileProcessorError(
          `File not found: ${filePath}`,
          'FILE_NOT_FOUND',
          filePath
        );
      }

      // Determine file format
      const format = this.detectFileFormat(filePath);
      
      // Read and parse file
      const rawData = this.readFile(filePath, mergedOptions.encoding);
      let parsedData = this.parseContent(rawData, format);

      // Apply transformations
      if (mergedOptions.transformations) {
        parsedData = await this.applyTransformations(
          parsedData,
          mergedOptions.transformations,
          errors,
          warnings
        );
      }

      // Validate if required
      if (mergedOptions.validateSchema) {
        this.validateData(parsedData, format, errors, warnings);
      }

      // Write output if specified
      let outputFile: string | undefined;
      if (mergedOptions.outputPath) {
        outputFile = mergedOptions.outputPath;
        const outputFormat = this.detectFileFormat(outputFile);
        await this.writeOutput(parsedData, outputFile, outputFormat);
      }

      const processingTime = Math.max(Date.now() - startTime, 1);

      return {
        success: errors.length === 0,
        data: parsedData,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        metadata: {
          inputFile: filePath,
          outputFile,
          processingTime,
          recordsProcessed: Array.isArray(parsedData) ? parsedData.length : 1,
          recordsValid: Array.isArray(parsedData) ? parsedData.length - errors.length : 1,
          format
        }
      };

    } catch (error) {
      const processingTime = Math.max(Date.now() - startTime, 1);
      
      return {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: warnings.length > 0 ? warnings : undefined,
        metadata: {
          inputFile: filePath,
          processingTime,
          recordsProcessed: 0,
          recordsValid: 0,
          format: 'unknown'
        }
      };
    }
  }

  /**
   * Process multiple files in batch
   */
  async processFiles(filePaths: string[], options?: FileProcessorOptions): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];
    
    for (const filePath of filePaths) {
      const result = await this.processFile(filePath, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Transform data with specified operations
   */
  async transformData(
    data: any[],
    transformations: TransformationConfig[]
  ): Promise<any[]> {
    return this.applyTransformations(data, transformations, [], []);
  }

  private detectFileFormat(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    
    switch (ext) {
      case '.json':
        return 'json';
      case '.csv':
        return 'csv';
      case '.txt':
        return 'text';
      case '.log':
        return 'log';
      default:
        return 'text';
    }
  }

  private readFile(filePath: string, encoding: BufferEncoding = 'utf8'): string {
    try {
      return readFileSync(filePath, encoding);
    } catch (error) {
      throw new FileProcessorError(
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        'READ_ERROR',
        filePath
      );
    }
  }

  private parseContent(content: string, format: string): any {
    switch (format) {
      case 'json':
        return this.parseJSON(content);
      case 'csv':
        return this.parseCSV(content);
      case 'text':
      case 'log':
        return this.parseText(content);
      default:
        return content;
    }
  }

  private parseJSON(content: string): any {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new FileProcessorError(
        `Invalid JSON format: ${error instanceof Error ? error.message : String(error)}`,
        'PARSE_ERROR'
      );
    }
  }

  private parseCSV(content: string): any[] {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const data: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row: any = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      
      data.push(row);
    }

    return data;
  }

  private parseText(content: string): string[] {
    return content.split('\n').filter(line => line.trim());
  }

  private async applyTransformations(
    data: any,
    transformations: TransformationConfig[],
    errors: string[],
    warnings: string[]
  ): Promise<any> {
    let result = data;

    for (const transformation of transformations) {
      try {
        result = await this.applyTransformation(result, transformation);
      } catch (error) {
        const errorMsg = `Transformation failed: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        
        if (!this.options.skipInvalidRows) {
          throw new FileProcessorError(errorMsg, 'TRANSFORM_ERROR');
        }
      }
    }

    return result;
  }

  private async applyTransformation(data: any, config: TransformationConfig): Promise<any> {
    if (!Array.isArray(data)) {
      throw new FileProcessorError(
        'Transformations can only be applied to arrays',
        'INVALID_DATA_TYPE'
      );
    }

    switch (config.type) {
      case 'filter':
        return config.condition ? data.filter(config.condition) : data;
      
      case 'map':
        return config.transform ? data.map(config.transform) : data;
      
      case 'validate':
        return config.validator ? data.filter(config.validator) : data;
      
      case 'sort':
        return config.sortBy ? 
          data.sort((a, b) => {
            const aVal = a[config.sortBy!];
            const bVal = b[config.sortBy!];
            return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
          }) : data;
      
      case 'group':
        return config.groupBy ? this.groupBy(data, config.groupBy) : data;
      
      default:
        throw new FileProcessorError(
          `Unknown transformation type: ${config.type}`,
          'INVALID_TRANSFORMATION'
        );
    }
  }

  private groupBy(data: any[], field: string): Record<string, any[]> {
    return data.reduce((groups, item) => {
      const key = item[field];
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
      return groups;
    }, {} as Record<string, any[]>);
  }

  private validateData(data: any, format: string, errors: string[], warnings: string[]): void {
    if (format === 'json') {
      if (Array.isArray(data)) {
        data.forEach((item, index) => {
          if (typeof item !== 'object' || item === null) {
            warnings.push(`Invalid object at index ${index}`);
          }
        });
      }
    }

    if (format === 'csv') {
      if (!Array.isArray(data)) {
        errors.push('CSV data must be an array');
        return;
      }

      data.forEach((row, index) => {
        if (typeof row !== 'object' || row === null) {
          errors.push(`Invalid row at index ${index}`);
        }
      });
    }
  }

  private async writeOutput(data: any, outputPath: string, format: string): Promise<void> {
    let content: string;

    switch (format) {
      case 'json':
        content = JSON.stringify(data, null, 2);
        break;
      case 'csv':
        content = this.formatAsCSV(data);
        break;
      default:
        content = Array.isArray(data) ? data.join('\n') : String(data);
    }

    try {
      writeFileSync(outputPath, content, 'utf8');
    } catch (error) {
      throw new FileProcessorError(
        `Failed to write output: ${error instanceof Error ? error.message : String(error)}`,
        'WRITE_ERROR',
        outputPath
      );
    }
  }

  private formatAsCSV(data: any[]): string {
    if (!Array.isArray(data) || data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const rows = data.map(row => 
      headers.map(header => String(row[header] || '')).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }
}

// Convenience functions for common operations
export const fileProcessor = new FileProcessor();

export async function processFile(
  filePath: string,
  options?: FileProcessorOptions
): Promise<ProcessingResult> {
  return fileProcessor.processFile(filePath, options);
}

export async function processFiles(
  filePaths: string[],
  options?: FileProcessorOptions
): Promise<ProcessingResult[]> {
  return fileProcessor.processFiles(filePaths, options);
}

export async function transformData(
  data: any[],
  transformations: TransformationConfig[]
): Promise<any[]> {
  return fileProcessor.transformData(data, transformations);
}