# File Processor Utility

A comprehensive TypeScript utility for processing, transforming, and manipulating files across multiple formats with robust error handling and performance monitoring.

## Overview

The `FileProcessor` utility provides a unified interface for working with JSON, CSV, text, and log files. It supports complex data transformations, batch processing, and produces detailed processing results with metadata.

## Features

- **Multi-format support**: JSON, CSV, text, and log files
- **Data transformations**: Filter, map, validate, sort, and group operations
- **Error handling**: Comprehensive error reporting with detailed context
- **Type safety**: Full TypeScript support with strict typing
- **Performance monitoring**: Processing time and record count tracking
- **Batch processing**: Process multiple files in sequence
- **Output generation**: Write processed data to various formats
- **Validation**: Optional schema validation for data integrity

## Installation

```typescript
import { FileProcessor, processFile, processFiles, transformData } from './utils/fileProcessor';
```

## Quick Start

### Basic File Processing

```typescript
import { processFile } from './utils/fileProcessor';

// Process a JSON file
const result = await processFile('data.json');

if (result.success) {
  console.log('Data:', result.data);
  console.log('Processing time:', result.metadata.processingTime, 'ms');
} else {
  console.error('Errors:', result.errors);
}
```

### With Transformations

```typescript
import { processFile, TransformationConfig } from './utils/fileProcessor';

const transformations: TransformationConfig[] = [
  {
    type: 'filter',
    condition: (item) => item.age > 18
  },
  {
    type: 'sort',
    sortBy: 'name'
  }
];

const result = await processFile('users.json', { transformations });
```

## API Reference

### FileProcessor Class

#### Constructor

```typescript
new FileProcessor(options?: FileProcessorOptions)
```

**Options:**
- `encoding`: File encoding (default: 'utf8')
- `skipInvalidRows`: Skip invalid rows instead of failing (default: false)
- `validateSchema`: Enable schema validation (default: true)
- `outputPath`: Path for output file
- `transformations`: Array of transformation configurations

#### Methods

##### processFile(filePath, options?)

Process a single file with optional transformations.

```typescript
async processFile(filePath: string, options?: FileProcessorOptions): Promise<ProcessingResult>
```

**Parameters:**
- `filePath`: Path to the file to process
- `options`: Optional processing options

**Returns:** `ProcessingResult` with success status, data, errors, and metadata

##### processFiles(filePaths, options?)

Process multiple files in batch.

```typescript
async processFiles(filePaths: string[], options?: FileProcessorOptions): Promise<ProcessingResult[]>
```

##### transformData(data, transformations)

Apply transformations to data without file I/O.

```typescript
async transformData(data: any[], transformations: TransformationConfig[]): Promise<any[]>
```

### Processing Result

```typescript
interface ProcessingResult {
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
```

### Transformation Types

#### Filter

Filter data based on a condition function.

```typescript
{
  type: 'filter',
  condition: (item: any) => boolean
}
```

**Example:**
```typescript
{
  type: 'filter',
  condition: (user) => user.age >= 18 && user.active
}
```

#### Map

Transform each item in the dataset.

```typescript
{
  type: 'map',
  transform: (item: any) => any
}
```

**Example:**
```typescript
{
  type: 'map',
  transform: (user) => ({
    ...user,
    fullName: `${user.firstName} ${user.lastName}`,
    isAdult: user.age >= 18
  })
}
```

#### Sort

Sort data by a specific field.

```typescript
{
  type: 'sort',
  sortBy: string
}
```

**Example:**
```typescript
{
  type: 'sort',
  sortBy: 'createdAt'
}
```

#### Group

Group data by a specific field.

```typescript
{
  type: 'group',
  groupBy: string
}
```

**Example:**
```typescript
{
  type: 'group',
  groupBy: 'department'
}
```

#### Validate

Validate data items and keep only valid ones.

```typescript
{
  type: 'validate',
  validator: (item: any) => boolean
}
```

**Example:**
```typescript
{
  type: 'validate',
  validator: (user) => user.email && user.email.includes('@')
}
```

## File Format Support

### JSON Files

- **Extensions**: `.json`
- **Parsing**: Native JSON.parse()
- **Output**: Pretty-printed JSON with 2-space indentation
- **Validation**: Structure validation for arrays and objects

### CSV Files

- **Extensions**: `.csv`
- **Parsing**: Simple comma-separated parsing with header row
- **Output**: Standard CSV format with headers
- **Validation**: Row structure validation

### Text Files

- **Extensions**: `.txt`
- **Parsing**: Line-by-line parsing
- **Output**: Line-separated text
- **Validation**: Basic line validation

### Log Files

- **Extensions**: `.log`
- **Parsing**: Line-by-line parsing (same as text)
- **Output**: Line-separated log entries
- **Validation**: Basic line validation

## Error Handling

### FileProcessorError

Custom error class with additional context:

```typescript
class FileProcessorError extends Error {
  code: string;
  file?: string;
  line?: number;
}
```

### Error Codes

- `FILE_NOT_FOUND`: File does not exist
- `READ_ERROR`: Cannot read file
- `PARSE_ERROR`: Cannot parse file content
- `WRITE_ERROR`: Cannot write output file
- `TRANSFORM_ERROR`: Transformation failed
- `INVALID_DATA_TYPE`: Invalid data type for transformation
- `INVALID_TRANSFORMATION`: Unknown transformation type

## Advanced Usage

### Complex Transformation Pipeline

```typescript
const transformations: TransformationConfig[] = [
  // First, filter active users
  {
    type: 'filter',
    condition: (user) => user.active === true
  },
  // Add computed fields
  {
    type: 'map',
    transform: (user) => ({
      ...user,
      fullName: `${user.firstName} ${user.lastName}`,
      ageGroup: user.age < 30 ? 'young' : user.age < 50 ? 'middle' : 'senior'
    })
  },
  // Sort by age
  {
    type: 'sort',
    sortBy: 'age'
  },
  // Group by age group
  {
    type: 'group',
    groupBy: 'ageGroup'
  }
];

const result = await processFile('users.json', { transformations });
```

### Batch Processing with Output

```typescript
const files = ['users1.json', 'users2.json', 'users3.json'];
const results = await processFiles(files, {
  transformations: [
    {
      type: 'filter',
      condition: (user) => user.verified === true
    }
  ]
});

// Process results
results.forEach((result, index) => {
  if (result.success) {
    console.log(`File ${files[index]}: ${result.metadata.recordsProcessed} records`);
  } else {
    console.error(`File ${files[index]} failed:`, result.errors);
  }
});
```

### Error Recovery

```typescript
const processor = new FileProcessor({
  skipInvalidRows: true,
  validateSchema: false
});

const result = await processor.processFile('problematic-data.json', {
  transformations: [
    {
      type: 'validate',
      validator: (item) => item.id && item.name
    }
  ]
});

// Check for warnings about skipped rows
if (result.warnings && result.warnings.length > 0) {
  console.warn('Warnings:', result.warnings);
}
```

## Performance Considerations

- **Memory**: Large files are processed in memory; consider chunking for very large datasets
- **CPU**: Transformations are applied sequentially; complex transformations may impact performance
- **I/O**: File reading/writing is synchronous; consider async alternatives for high-concurrency scenarios

## Testing

The utility includes comprehensive tests covering:

- All file format processing
- Transformation types and combinations
- Error handling scenarios
- Batch processing
- Performance monitoring
- Edge cases and validation

Run tests with:
```bash
npm test src/utils/fileProcessor.test.ts
```

## Examples

### Example 1: Data Cleaning

```typescript
// Clean and validate user data
const result = await processFile('raw-users.csv', {
  transformations: [
    {
      type: 'validate',
      validator: (user) => user.email && user.email.includes('@')
    },
    {
      type: 'map',
      transform: (user) => ({
        ...user,
        email: user.email.toLowerCase(),
        name: user.name.trim()
      })
    }
  ],
  outputPath: 'clean-users.json'
});
```

### Example 2: Log Analysis

```typescript
// Process log files to extract errors
const result = await processFile('application.log', {
  transformations: [
    {
      type: 'filter',
      condition: (line) => line.includes('[ERROR]')
    },
    {
      type: 'map',
      transform: (line) => {
        const timestamp = line.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)?.[0];
        const message = line.split('[ERROR]')[1]?.trim();
        return { timestamp, message, level: 'ERROR' };
      }
    }
  ],
  outputPath: 'errors.json'
});
```

### Example 3: Data Aggregation

```typescript
// Group sales data by region
const result = await processFile('sales.json', {
  transformations: [
    {
      type: 'group',
      groupBy: 'region'
    },
    {
      type: 'map',
      transform: (regionData) => {
        const totalSales = regionData.reduce((sum, sale) => sum + sale.amount, 0);
        return {
          region: regionData[0].region,
          totalSales,
          recordCount: regionData.length
        };
      }
    }
  ]
});
```

## Contributing

When contributing to the FileProcessor utility:

1. Add tests for new features
2. Update documentation
3. Follow TypeScript best practices
4. Handle errors gracefully
5. Include performance considerations

## License

This utility is part of the ClaudeMcpTools project and follows the project's licensing terms.