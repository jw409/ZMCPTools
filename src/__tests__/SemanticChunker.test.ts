import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SemanticChunker, Chunk } from '../services/SemanticChunker';

// Mock the global fetch
global.fetch = vi.fn();

const mockFetch = (response: any, ok = true) => {
  (fetch as vi.Mock).mockResolvedValue({
    ok,
    json: () => Promise.resolve(response),
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
  });
};

// Mock token counts based on text length for simplicity
const mockCountTokens = (text: string) => {
    return Math.ceil(text.length / 4);
}

describe('SemanticChunker', () => {
  let chunker: SemanticChunker;

  beforeEach(() => {
    chunker = new SemanticChunker({
      targetTokens: 100,
      overlapPercentage: 0.1,
      embeddingServiceUrl: 'http://localhost:8765',
      model: 'test-model',
    });

    // Mock fetch to return token count based on text length
    (fetch as vi.Mock).mockImplementation((url, options) => {
        if (url.endsWith('/count_tokens')) {
            const body = JSON.parse(options.body as string);
            const tokenCount = mockCountTokens(body.text);
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ token_count: tokenCount }),
            });
        }
        return Promise.reject(new Error(`Unhandled fetch call to ${url}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not chunk a document that is smaller than the target size', async () => {
    const smallDocument = 'This is a small document.';
    const chunks = await chunker.chunkDocument('doc1', smallDocument, 'Small Doc');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(smallDocument);
    expect(chunks[0].metadata.tokenCount).toBe(Math.ceil(smallDocument.length / 4));
  });

  it('should chunk a large document into multiple parts', async () => {
    const largeDocument = 'a'.repeat(1000); // Approx 250 tokens
    const chunks = await chunker.chunkDocument('doc2', largeDocument, 'Large Doc');

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].metadata.title).toBe('Large Doc');
    expect(chunks[1].metadata.title).toBe('Large Doc (part 2)');
  });

  it('should handle overlap between chunks', async () => {
    const document = 'a'.repeat(500); // Approx 125 tokens, should create 2 chunks
    const chunks = await chunker.chunkDocument('doc3', document, 'Overlap Doc');

    expect(chunks.length).toBe(2);

    const chunk1 = chunks[0];
    const chunk2 = chunks[1];

    // overlap is 10% of 100 tokens = 10 tokens. 10 tokens * 4 chars/token = 40 chars
    const expectedOverlap = 40;
    const actualOverlap = chunk1.metadata.endOffset - chunk2.metadata.startOffset;

    expect(actualOverlap).toBeGreaterThan(0);
    expect(actualOverlap).toBeLessThanOrEqual(expectedOverlap + 5); // Allow for some buffer
  });

  it('should use markdown boundaries for chunking', async () => {
    const markdown = `# Title\n${'a'.repeat(400)}\n\n## Section 2\n${'b'.repeat(400)}`;
    const chunks = await chunker.chunkDocument('doc4', markdown, 'Markdown Doc', 'markdown');

    expect(chunks.length).toBe(2);
    expect(chunks[0].text).toContain('# Title');
    expect(chunks[1].text).toContain('## Section 2');
  });

  it('should use binary search to reduce chunk size if it exceeds token limit', async () => {
    chunker = new SemanticChunker({
      targetTokens: 100,
      tokenLimit: 120, // Set a specific limit
      overlapPercentage: 0.1,
      embeddingServiceUrl: 'http://localhost:8765',
      model: 'test-model',
    });

    const longText = 'a'.repeat(600);
    // Mock countTokens to initially report a large size, then smaller sizes
    (fetch as vi.Mock).mockImplementation((url, options) => {
        if (url.endsWith('/count_tokens')) {
            const body = JSON.parse(options.body as string);
            const text = body.text;
            if (text.length > 500) { // Initial large chunk
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ token_count: 150 }) });
            }
            // Subsequent calls during binary search
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ token_count: mockCountTokens(text) }) });
        }
        return Promise.reject(new Error(`Unhandled fetch call to ${url}`));
    });

    const chunks = await chunker.chunkDocument('doc5', longText, 'Binary Search Doc');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].metadata.tokenCount).toBeLessThanOrEqual(100);
  });

  it('should handle the final chunk correctly', async () => {
    const text = 'a'.repeat(450);
    const chunks = await chunker.chunkDocument('doc6', text, 'Final Chunk Doc');
    expect(chunks.length).toBe(2);
    expect(chunks[1].text.length).toBeLessThan(400);
  });

  it('should generate chunk statistics', async () => {
    const document = 'a'.repeat(1000);
    const chunks = await chunker.chunkDocument('doc7', document, 'Stats Doc');
    const stats = chunker.getChunkStats(chunks);

    expect(stats.totalChunks).toBe(chunks.length);
    expect(stats.totalTokens).toBeGreaterThan(0);
    expect(stats.avgTokens).toBeGreaterThan(0);
    expect(stats.minTokens).toBeGreaterThan(0);
    expect(stats.maxTokens).toBeGreaterThan(0);
  });

  it('should generate a title correctly', () => {
    const title = chunker.generateTitle('/path/to/repo', 'file', 'src/index.ts', { relativePath: 'src/index.ts' });
    expect(title).toBe('repo: src/index.ts');
  });
});