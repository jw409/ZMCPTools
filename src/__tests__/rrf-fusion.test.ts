/**
 * RRF (Reciprocal Rank Fusion) Tests
 *
 * Validates that RRF fusion properly combines BM25 and semantic search results
 * according to Cormack & Clarke 2009 algorithm.
 *
 * Test Strategy:
 * 1. Simulate ranked result lists from BM25 and semantic sources
 * 2. Verify RRF score calculation
 * 3. Compare against naive weighted fusion
 * 4. Test edge cases (single source, no overlap, etc.)
 */

import { describe, it, expect, beforeAll } from 'vitest';

// RRF implementation for testing (extracted from unifiedSearchTool.ts logic)
function computeRRF(
  bm25Results: Array<{ id: string; score: number }>,
  semanticResults: Array<{ id: string; score: number }>,
  k: number = 60
): Array<{ id: string; rrfScore: number; bm25Rank?: number; semanticRank?: number }> {

  // Build rank maps (results must be sorted by score)
  const bm25Ranks = new Map(bm25Results.map((r, idx) => [r.id, idx + 1]));
  const semanticRanks = new Map(semanticResults.map((r, idx) => [r.id, idx + 1]));

  // Collect all unique document IDs
  const allIds = new Set([...bm25Ranks.keys(), ...semanticRanks.keys()]);

  const results = [];
  for (const id of allIds) {
    const bm25Rank = bm25Ranks.get(id);
    const semanticRank = semanticRanks.get(id);

    // RRF contributions
    const bm25Contribution = bm25Rank ? 1 / (k + bm25Rank) : 0;
    const semanticContribution = semanticRank ? 1 / (k + semanticRank) : 0;

    const rrfScore = bm25Contribution + semanticContribution;

    results.push({ id, rrfScore, bm25Rank, semanticRank });
  }

  return results.sort((a, b) => b.rrfScore - a.rrfScore);
}

describe('RRF Fusion Algorithm', () => {

  it('should compute correct RRF scores for overlapping results', () => {
    const bm25 = [
      { id: 'file1.ts', score: 10.0 },  // rank 1
      { id: 'file2.ts', score: 8.0 },   // rank 2
      { id: 'file3.ts', score: 6.0 }    // rank 3
    ];

    const semantic = [
      { id: 'file2.ts', score: 0.95 },  // rank 1
      { id: 'file1.ts', score: 0.85 },  // rank 2
      { id: 'file4.ts', score: 0.75 }   // rank 3
    ];

    const results = computeRRF(bm25, semantic, 60);

    // file2: 1/(60+2) + 1/(60+1) = 0.0161 + 0.0164 = 0.0325
    // file1: 1/(60+1) + 1/(60+2) = 0.0164 + 0.0161 = 0.0325
    // file3: 1/(60+3) + 0 = 0.0159
    // file4: 0 + 1/(60+3) = 0.0159

    expect(results[0].id).toMatch(/file[12]\.ts/); // Both have same score
    expect(results[0].rrfScore).toBeCloseTo(0.0325, 4);
    expect(results[1].id).toMatch(/file[12]\.ts/);
    expect(results[1].rrfScore).toBeCloseTo(0.0325, 4);
    expect(results[2].rrfScore).toBeCloseTo(0.0159, 4);
    expect(results[3].rrfScore).toBeCloseTo(0.0159, 4);
  });

  it('should handle documents appearing in only one source', () => {
    const bm25 = [{ id: 'file1.ts', score: 10.0 }];
    const semantic = [{ id: 'file2.ts', score: 0.95 }];

    const results = computeRRF(bm25, semantic, 60);

    // file1: 1/61 = 0.0164, file2: 1/61 = 0.0164
    expect(results).toHaveLength(2);
    expect(results[0].rrfScore).toBeCloseTo(0.0164, 4);
    expect(results[1].rrfScore).toBeCloseTo(0.0164, 4);
  });

  it('should boost documents that appear in both sources', () => {
    const bm25 = [
      { id: 'file1.ts', score: 10.0 },  // rank 1
      { id: 'file2.ts', score: 8.0 }    // rank 2
    ];

    const semantic = [
      { id: 'file1.ts', score: 0.95 },  // rank 1 (appears in both!)
      { id: 'file3.ts', score: 0.75 }   // rank 2
    ];

    const results = computeRRF(bm25, semantic, 60);

    // file1 appears in both sources, should rank first
    expect(results[0].id).toBe('file1.ts');

    // file1: 1/61 + 1/61 = 0.0328
    // file2: 1/62 + 0 = 0.0161
    // file3: 0 + 1/62 = 0.0161
    expect(results[0].rrfScore).toBeCloseTo(0.0328, 4);
    expect(results[0].bm25Rank).toBe(1);
    expect(results[0].semanticRank).toBe(1);
  });

  it('should handle empty result sets gracefully', () => {
    const bm25: Array<{ id: string; score: number }> = [];
    const semantic = [{ id: 'file1.ts', score: 0.95 }];

    const results = computeRRF(bm25, semantic, 60);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('file1.ts');
    expect(results[0].rrfScore).toBeCloseTo(0.0164, 4);
  });

  it('should be scale-invariant (ranks matter, not scores)', () => {
    // Test 1: Large score differences
    const bm25_large = [
      { id: 'file1.ts', score: 1000 },
      { id: 'file2.ts', score: 1 }
    ];

    // Test 2: Small score differences
    const bm25_small = [
      { id: 'file1.ts', score: 1.001 },
      { id: 'file2.ts', score: 1.000 }
    ];

    const semantic = [
      { id: 'file2.ts', score: 0.95 },
      { id: 'file1.ts', score: 0.85 }
    ];

    const results1 = computeRRF(bm25_large, semantic, 60);
    const results2 = computeRRF(bm25_small, semantic, 60);

    // Rankings should be identical despite different score scales
    expect(results1.map(r => r.id)).toEqual(results2.map(r => r.id));
    expect(results1.map(r => r.rrfScore)).toEqual(results2.map(r => r.rrfScore));
  });
});

describe('RRF vs Naive Weighted Fusion', () => {

  function computeNaive(
    bm25Results: Array<{ id: string; score: number }>,
    semanticResults: Array<{ id: string; score: number }>,
    bm25Weight: number = 0.3,
    semanticWeight: number = 0.7
  ): Array<{ id: string; naiveScore: number }> {
    const resultMap = new Map();

    bm25Results.forEach(r => {
      resultMap.set(r.id, { id: r.id, naiveScore: r.score * bm25Weight });
    });

    semanticResults.forEach(r => {
      const existing = resultMap.get(r.id);
      if (existing) {
        existing.naiveScore += r.score * semanticWeight;
      } else {
        resultMap.set(r.id, { id: r.id, naiveScore: r.score * semanticWeight });
      }
    });

    return Array.from(resultMap.values()).sort((a, b) => b.naiveScore - a.naiveScore);
  }

  it('should handle score scale differences better than naive fusion', () => {
    // BM25 scores are typically 0-20, semantic scores are 0-1
    const bm25 = [
      { id: 'file1.ts', score: 15.0 },  // High BM25
      { id: 'file2.ts', score: 2.0 }    // Low BM25
    ];

    const semantic = [
      { id: 'file2.ts', score: 0.98 },  // High semantic
      { id: 'file1.ts', score: 0.50 }   // Medium semantic
    ];

    const rrf = computeRRF(bm25, semantic, 60);
    const naive = computeNaive(bm25, semantic, 0.3, 0.7);

    // Naive fusion:
    // file1: 15*0.3 + 0.50*0.7 = 4.5 + 0.35 = 4.85
    // file2: 2*0.3 + 0.98*0.7 = 0.6 + 0.686 = 1.286
    // Naive prefers file1 (dominated by BM25 scale)

    // RRF:
    // file1: 1/61 + 1/62 = 0.0164 + 0.0161 = 0.0325
    // file2: 1/62 + 1/61 = 0.0161 + 0.0164 = 0.0325
    // RRF treats both equally (rank-based)

    expect(naive[0].id).toBe('file1.ts'); // Naive biased by BM25 scale
    expect(rrf[0].rrfScore).toBeCloseTo(0.0325, 4); // RRF balanced
    expect(rrf[1].rrfScore).toBeCloseTo(0.0325, 4);
  });

  it('should promote consensus results more than naive fusion', () => {
    const bm25 = [
      { id: 'consensus.ts', score: 10.0 },  // rank 1
      { id: 'bm25only.ts', score: 9.0 }     // rank 2
    ];

    const semantic = [
      { id: 'consensus.ts', score: 0.90 },  // rank 1 (appears in both!)
      { id: 'semanticonly.ts', score: 0.85 } // rank 2
    ];

    const rrf = computeRRF(bm25, semantic, 60);
    const naive = computeNaive(bm25, semantic, 0.3, 0.7);

    // consensus.ts should rank first in both, but RRF gives bigger boost
    expect(rrf[0].id).toBe('consensus.ts');
    expect(naive[0].id).toBe('consensus.ts');

    // RRF: consensus gets 1/61 + 1/61 = 0.0328
    //      others get 1/62 = 0.0161
    // Ratio: 0.0328 / 0.0161 = 2.04x boost

    // Naive: consensus gets 10*0.3 + 0.90*0.7 = 3.63
    //        bm25only gets 9*0.3 = 2.7
    // Ratio: 3.63 / 2.7 = 1.34x boost

    const rrfBoost = rrf[0].rrfScore / rrf[1].rrfScore;
    expect(rrfBoost).toBeGreaterThan(1.5); // RRF gives stronger consensus boost
  });
});

describe('RRF Parameter Sensitivity', () => {

  it('should allow k parameter tuning', () => {
    const bm25 = [{ id: 'file1.ts', score: 10 }];
    const semantic = [{ id: 'file1.ts', score: 0.9 }];

    const results_k10 = computeRRF(bm25, semantic, 10);
    const results_k60 = computeRRF(bm25, semantic, 60);
    const results_k100 = computeRRF(bm25, semantic, 100);

    // Smaller k = higher scores (1/11 vs 1/61 vs 1/101)
    expect(results_k10[0].rrfScore).toBeGreaterThan(results_k60[0].rrfScore);
    expect(results_k60[0].rrfScore).toBeGreaterThan(results_k100[0].rrfScore);

    // k=60 is standard default (good balance)
    expect(results_k60[0].rrfScore).toBeCloseTo(0.0328, 4);
  });
});
