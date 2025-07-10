# HuggingFace.js Transformers Integration Guide

This document provides comprehensive guidance for integrating HuggingFace.js Transformers library (@xenova/transformers) for semantic text embeddings in ClaudeMcpTools.

## Table of Contents

- [Installation and Setup](#installation-and-setup)
- [Available Models for Text Embeddings](#available-models-for-text-embeddings)
- [Multi-language BERT Models](#multi-language-bert-models)
- [Usage Examples](#usage-examples)
- [Best Practices](#best-practices)
- [Model Recommendations](#model-recommendations)
- [Browser vs Node.js Usage](#browser-vs-nodejs-usage)
- [Performance Considerations](#performance-considerations)

## Installation and Setup

### NPM Installation

```bash
npm install @xenova/transformers
```

### Basic Setup

```typescript
import { pipeline, env } from '@xenova/transformers';

// Configure environment
env.allowLocalModels = false; // Use remote models
env.allowRemoteModels = true;
env.backends.onnx.wasm.wasmPaths = '/path/to/wasm/files/';
```

### Environment Configuration

The library supports various configuration options:

```typescript
// For Node.js usage
env.backends.onnx.wasm.numThreads = 4; // Use multiple threads
env.cacheDir = './models/'; // Local model cache directory

// For browser usage
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
```

## Available Models for Text Embeddings

### Sentence Transformers Models

These models are specifically designed for semantic similarity tasks:

1. **sentence-transformers/all-MiniLM-L6-v2**
   - Size: ~23MB
   - Dimensions: 384
   - Best for: General semantic similarity
   - Languages: English (primarily)

2. **sentence-transformers/all-mpnet-base-v2**
   - Size: ~438MB
   - Dimensions: 768
   - Best for: High-quality embeddings
   - Languages: English

3. **sentence-transformers/all-MiniLM-L12-v2**
   - Size: ~34MB
   - Dimensions: 384
   - Best for: Balance of speed and quality
   - Languages: English

### BERT-based Models

1. **bert-base-uncased**
   - Size: ~440MB
   - Dimensions: 768
   - Best for: Traditional BERT embeddings
   - Languages: English

2. **distilbert-base-uncased**
   - Size: ~268MB
   - Dimensions: 768
   - Best for: Faster inference
   - Languages: English

## Multi-language BERT Models

### Multilingual Models

1. **sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2**
   - Size: ~278MB
   - Dimensions: 384
   - Languages: 50+ languages
   - Best for: Cross-lingual semantic search

2. **sentence-transformers/distiluse-base-multilingual-cased**
   - Size: ~540MB
   - Dimensions: 512
   - Languages: 15+ languages
   - Best for: High-quality multilingual embeddings

3. **bert-base-multilingual-cased**
   - Size: ~714MB
   - Dimensions: 768
   - Languages: 104 languages
   - Best for: Comprehensive multilingual support

### Language-Specific Models

```typescript
// Chinese
const chineseModel = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';

// German
const germanModel = 'sentence-transformers/distiluse-base-multilingual-cased';

// French
const frenchModel = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
```

## Usage Examples

### Basic Text Embedding Generation

```typescript
import { pipeline } from '@xenova/transformers';

class HuggingFaceEmbeddings {
  private model: any;
  private modelName: string;

  constructor(modelName = 'sentence-transformers/all-MiniLM-L6-v2') {
    this.modelName = modelName;
  }

  async initialize() {
    this.model = await pipeline('feature-extraction', this.modelName);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.model) {
      await this.initialize();
    }

    const embeddings = [];
    
    for (const text of texts) {
      const output = await this.model(text, { pooling: 'mean', normalize: true });
      embeddings.push(Array.from(output.data));
    }

    return embeddings;
  }

  async embedSingle(text: string): Promise<number[]> {
    const embeddings = await this.embed([text]);
    return embeddings[0];
  }
}
```

### Advanced Usage with Preprocessing

```typescript
class AdvancedHuggingFaceEmbeddings {
  private model: any;
  private tokenizer: any;

  async initialize(modelName: string) {
    // Load model and tokenizer
    this.model = await pipeline('feature-extraction', modelName);
  }

  preprocessText(text: string): string {
    // Clean and normalize text
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  async embedWithPreprocessing(texts: string[]): Promise<number[][]> {
    const processedTexts = texts.map(text => this.preprocessText(text));
    return this.embed(processedTexts);
  }

  async embed(texts: string[]): Promise<number[][]> {
    const embeddings = [];
    
    for (const text of texts) {
      const output = await this.model(text, {
        pooling: 'mean',
        normalize: true,
        return_tensors: false
      });
      
      embeddings.push(Array.from(output.data));
    }

    return embeddings;
  }
}
```

### Batch Processing for Performance

```typescript
class BatchedEmbeddings {
  private model: any;
  private batchSize: number;

  constructor(batchSize = 32) {
    this.batchSize = batchSize;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const allEmbeddings: number[][] = [];
    
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchEmbeddings = await this.processBatch(batch);
      allEmbeddings.push(...batchEmbeddings);
    }
    
    return allEmbeddings;
  }

  private async processBatch(batch: string[]): Promise<number[][]> {
    // Process batch concurrently
    const promises = batch.map(text => this.model(text, {
      pooling: 'mean',
      normalize: true
    }));
    
    const results = await Promise.all(promises);
    return results.map(result => Array.from(result.data));
  }
}
```

## Best Practices

### Model Selection

1. **For General Use**: Use `sentence-transformers/all-MiniLM-L6-v2`
   - Good balance of speed, size, and quality
   - Optimized for semantic similarity

2. **For High Quality**: Use `sentence-transformers/all-mpnet-base-v2`
   - Better quality embeddings
   - Larger model size

3. **For Multilingual**: Use `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
   - Supports 50+ languages
   - Good cross-lingual performance

### Performance Optimization

```typescript
class OptimizedEmbeddings {
  private model: any;
  private cache = new Map<string, number[]>();

  async embed(text: string): Promise<number[]> {
    // Check cache first
    if (this.cache.has(text)) {
      return this.cache.get(text)!;
    }

    const embedding = await this.generateEmbedding(text);
    
    // Cache result
    this.cache.set(text, embedding);
    
    return embedding;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const output = await this.model(text, {
      pooling: 'mean',
      normalize: true
    });
    
    return Array.from(output.data);
  }

  clearCache() {
    this.cache.clear();
  }
}
```

### Error Handling

```typescript
class RobustEmbeddings {
  async embed(text: string): Promise<number[]> {
    try {
      const output = await this.model(text, {
        pooling: 'mean',
        normalize: true
      });
      
      return Array.from(output.data);
    } catch (error) {
      console.error('Embedding generation failed:', error);
      
      // Fallback to simple hash-based embedding
      return this.fallbackEmbedding(text);
    }
  }

  private fallbackEmbedding(text: string): number[] {
    // Simple fallback based on text characteristics
    const chars = text.split('');
    const embedding = new Array(384).fill(0);
    
    chars.forEach((char, index) => {
      const charCode = char.charCodeAt(0);
      embedding[index % 384] += charCode / 1000;
    });
    
    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / norm);
  }
}
```

## Model Recommendations

### For Documentation Search (Recommended)

```typescript
// Best overall choice for documentation search
const RECOMMENDED_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

// Alternative for higher quality
const HIGH_QUALITY_MODEL = 'sentence-transformers/all-mpnet-base-v2';

// For multilingual documentation
const MULTILINGUAL_MODEL = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
```

### Model Comparison

| Model | Size | Dimensions | Speed | Quality | Multilingual |
|-------|------|------------|-------|---------|--------------|
| all-MiniLM-L6-v2 | 23MB | 384 | Fast | Good | No |
| all-mpnet-base-v2 | 438MB | 768 | Slow | Excellent | No |
| paraphrase-multilingual-MiniLM-L12-v2 | 278MB | 384 | Medium | Good | Yes |
| distiluse-base-multilingual-cased | 540MB | 512 | Medium | Very Good | Yes |

## Browser vs Node.js Usage

### Node.js Configuration

```typescript
import { env } from '@xenova/transformers';

// Node.js specific configuration
env.backends.onnx.wasm.numThreads = require('os').cpus().length;
env.cacheDir = './node_modules/.cache/transformers';
env.allowLocalModels = true;
```

### Browser Configuration

```typescript
import { env } from '@xenova/transformers';

// Browser specific configuration
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
env.allowRemoteModels = true;
env.allowLocalModels = false;
```

### Universal Implementation

```typescript
class UniversalEmbeddings {
  constructor() {
    this.configureEnvironment();
  }

  private configureEnvironment() {
    if (typeof window !== 'undefined') {
      // Browser environment
      env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
    } else {
      // Node.js environment
      env.backends.onnx.wasm.numThreads = require('os').cpus().length;
      env.cacheDir = './models';
    }
  }
}
```

## Performance Considerations

### Memory Management

```typescript
class MemoryEfficientEmbeddings {
  private model: any;
  private maxCacheSize = 1000;
  private cache = new Map<string, number[]>();

  async embed(text: string): Promise<number[]> {
    // Manage cache size
    if (this.cache.size > this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    if (this.cache.has(text)) {
      return this.cache.get(text)!;
    }

    const embedding = await this.generateEmbedding(text);
    this.cache.set(text, embedding);
    
    return embedding;
  }

  dispose() {
    this.cache.clear();
    // Clean up model resources
    if (this.model && typeof this.model.dispose === 'function') {
      this.model.dispose();
    }
  }
}
```

### Initialization Strategy

```typescript
class LazyEmbeddings {
  private modelPromise: Promise<any> | null = null;
  private modelName: string;

  constructor(modelName = 'sentence-transformers/all-MiniLM-L6-v2') {
    this.modelName = modelName;
  }

  private getModel(): Promise<any> {
    if (!this.modelPromise) {
      this.modelPromise = pipeline('feature-extraction', this.modelName);
    }
    return this.modelPromise;
  }

  async embed(text: string): Promise<number[]> {
    const model = await this.getModel();
    const output = await model(text, {
      pooling: 'mean',
      normalize: true
    });
    
    return Array.from(output.data);
  }
}
```

## Integration with LanceDB

### Complete Integration Example

```typescript
import { pipeline } from '@xenova/transformers';

export class HuggingFaceEmbeddingFunction {
  private model: any;
  private modelName: string;
  private cache = new Map<string, number[]>();

  constructor(modelName = 'sentence-transformers/all-MiniLM-L6-v2') {
    this.modelName = modelName;
  }

  async initialize() {
    if (!this.model) {
      this.model = await pipeline('feature-extraction', this.modelName);
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.initialize();
    
    const embeddings: number[][] = [];
    
    for (const text of texts) {
      // Check cache
      if (this.cache.has(text)) {
        embeddings.push(this.cache.get(text)!);
        continue;
      }

      // Generate embedding
      const output = await this.model(text, {
        pooling: 'mean',
        normalize: true
      });
      
      const embedding = Array.from(output.data);
      this.cache.set(text, embedding);
      embeddings.push(embedding);
    }
    
    return embeddings;
  }

  ndims(): number {
    // Return dimensions based on model
    switch (this.modelName) {
      case 'sentence-transformers/all-MiniLM-L6-v2':
      case 'sentence-transformers/all-MiniLM-L12-v2':
      case 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2':
        return 384;
      case 'sentence-transformers/all-mpnet-base-v2':
      case 'bert-base-uncased':
      case 'distilbert-base-uncased':
      case 'bert-base-multilingual-cased':
        return 768;
      case 'sentence-transformers/distiluse-base-multilingual-cased':
        return 512;
      default:
        return 384; // Default
    }
  }
}
```

This implementation provides a solid foundation for semantic embeddings in ClaudeMcpTools, replacing the simple hash-based approach with real neural embeddings that capture semantic meaning.

## Implementation Status

✅ **IMPLEMENTED**: The `LanceDBService` in ClaudeMcpTools now uses real HuggingFace Transformers embeddings!

### What was changed:

1. **Replaced SimpleEmbeddingFunction**: The fake embedding function that used character codes and word lengths has been completely replaced with `HuggingFaceEmbeddingFunction`.

2. **Real Semantic Embeddings**: Now uses `sentence-transformers/all-MiniLM-L6-v2` by default, which provides 384-dimensional semantic embeddings that capture actual meaning.

3. **Model Cache Configuration**: Embeddings models are cached in `~/.mcptools/data/model_cache/` for efficient reuse.

4. **Embedding Cache**: Includes intelligent caching of computed embeddings to avoid recomputing the same text.

5. **Fallback Support**: Includes error handling with fallback embeddings if the model fails to load.

6. **Environment Configuration**: Properly configured for Node.js with optimized thread usage.

### Result:
Documentation search now finds semantically similar content instead of returning the "init" document for everything. The search actually understands the meaning of your queries!