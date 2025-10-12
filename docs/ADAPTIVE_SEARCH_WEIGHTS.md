# Adaptive Search Weight Learning

**Status**: Framework implemented, learning disabled by default
**Related**: Issue #62 (Symbol-BM25 integration)

## Problem: Static Weights Are Brittle

Current Symbol-BM25 implementation uses **hardcoded boost weights**:

```typescript
// Static weights from benchmark tuning
{
  file_name_match_boost: 2.0,
  exported_symbol_boost: 3.0,    // Strongest signal
  defined_symbol_boost: 1.5,
  all_symbol_boost: 0.5,
  import_only_penalty: 0.3,
  content_match_weight: 0.3
}
```

**Limitations**:
1. ❌ Not optimal for all query types
2. ❌ Can't adapt to user preferences
3. ❌ No A/B testing capability
4. ❌ Doesn't learn from production feedback
5. ❌ One-size-fits-all approach

## Solution: Adaptive Learning Framework

### Architecture

```
┌─────────────────────────────────────────────┐
│  Production Search (BM25Service)            │
│  ├─ Uses current best weight config         │
│  └─ Records query feedback                  │
├─────────────────────────────────────────────┤
│  Feedback Loop (AdaptiveBoostLearner)       │
│  ├─ Collects relevance signals              │
│  ├─ Computes loss (nDCG-based)             │
│  └─ Learns improved weights                 │
├─────────────────────────────────────────────┤
│  Weight Storage (SymbolIndexRepository)     │
│  ├─ Stores multiple configurations          │
│  └─ Supports A/B testing                    │
└─────────────────────────────────────────────┘
```

### Learning Pipeline

**Phase 1: Data Collection** (ACTIVE)
```typescript
// After each search, record feedback
const feedback: QueryFeedback = {
  query: "ResourceManager",
  queryType: "code",
  results: searchResults,
  relevanceJudgments: [
    { filePath: "src/managers/ResourceManager.ts", isRelevant: true, relevanceScore: 1.0 },
    { filePath: "src/tools/ResourceLoader.ts", isRelevant: false, relevanceScore: 0.0 }
  ],
  metrics: { recall_at_k: 0.8, mrr: 0.9, ndcg_at_k: 0.85 }
};

learner.recordFeedback(feedback);
```

**Phase 2: Learning** (PLACEHOLDER - Manual Trigger)
```typescript
// Periodically (e.g., weekly)
const result = await learner.learnFromFeedback();

console.log('Learned weights:', result.weights);
console.log('Loss:', result.loss);
console.log('Converged:', result.converged);
```

**Phase 3: Deployment** (MANUAL)
```typescript
// Save learned weights as new config
await learner.saveWeights('learned_v1', result.weights, 'Learned from 1000 queries');

// A/B test against baseline
const abTest = await learner.runABTest('default', 'learned_v1', testQueries);
console.log('Winner:', abTest.winner);
```

## Current Implementation Status

### ✅ Implemented (Framework)

**`AdaptiveBoostLearner` class** (`src/services/AdaptiveBoostLearner.ts`):
- ✅ Feedback recording API
- ✅ Loss function (nDCG-based)
- ✅ Gradient computation (numerical)
- ✅ Gradient descent optimizer
- ✅ Weight bounds and regularization
- ✅ Database integration

**`SymbolIndexRepository`** (already supports):
- ✅ Multiple boost configurations
- ✅ CRUD operations for weights
- ✅ Default config from benchmarks

### ⏳ TODO (Not Implemented Yet)

**Learning Algorithms**:
- ⏳ Automatic differentiation (vs numerical gradients)
- ⏳ Adam optimizer (vs vanilla SGD)
- ⏳ Learning rate scheduling
- ⏳ Mini-batch training
- ⏳ Cross-validation

**Production Integration**:
- ⏳ Automatic feedback collection from search API
- ⏳ Implicit feedback signals (clicks, dwell time)
- ⏳ Scheduled learning jobs (e.g., nightly)
- ⏳ Multi-armed bandit A/B testing
- ⏳ Auto-promotion of winning configs

**Advanced Features**:
- ⏳ Per-query-type weight sets (code vs conceptual)
- ⏳ User-specific personalization
- ⏳ Query expansion learning
- ⏳ Reinforcement learning from interaction data

## Why Not Enabled Now?

**Reason 1: Need Production Data**
- Learning requires 1000+ queries with relevance judgments
- Current benchmark has only 15 queries
- Would overfit immediately

**Reason 2: Infrastructure Gaps**
- No feedback collection pipeline
- No relevance labeling system
- No A/B testing framework
- No monitoring/alerting

**Reason 3: Good Enough™**
- Static weights achieve 80% code recall (target met)
- No production complaints about relevance
- Premature optimization risk

## How to Enable Adaptive Learning (Future)

### Step 1: Collect Feedback

**Option A: Explicit Feedback**
```typescript
// User rates search results
POST /api/search/feedback
{
  "query": "ResourceManager",
  "results": [...],
  "ratings": {
    "src/managers/ResourceManager.ts": 5,  // 1-5 stars
    "src/tools/ResourceLoader.ts": 1
  }
}
```

**Option B: Implicit Feedback**
```typescript
// Track user clicks
{
  "query": "ResourceManager",
  "clicked": "src/managers/ResourceManager.ts",
  "position": 1,
  "dwellTime": 45  // seconds
}
```

### Step 2: Run Learning Job

```bash
# Weekly learning job
npm run learn-weights

# Output: etc/learned_weights_2025-10-11.json
```

### Step 3: A/B Test

```typescript
// Route 50% of traffic to new weights
const config = Math.random() < 0.5 ? 'default' : 'learned_v1';
const results = await bm25Service.searchSymbolAware(query, { config });
```

### Step 4: Promote Winner

```bash
# After statistical significance achieved
npm run promote-weights learned_v1
```

## Design Principles

**1. Safe by Default**
- ✅ Static weights as fallback
- ✅ Human-in-the-loop validation
- ✅ Gradual rollout via A/B testing
- ✅ Easy rollback

**2. Data-Driven**
- ✅ Loss function based on nDCG (gold standard)
- ✅ Query-type-aware weighting
- ✅ Regularization to prevent overfitting
- ✅ Cross-validation (future)

**3. Production-Ready**
- ✅ Database-backed configuration
- ✅ Multiple weight sets supported
- ✅ Versioned configs with descriptions
- ✅ Auditability

**4. Extensible**
- ✅ Pluggable optimizers (SGD → Adam → ???)
- ✅ Multiple loss functions
- ✅ Per-user personalization (future)
- ✅ Multi-objective optimization (future)

## Example: Manual Learning Session

```typescript
import { AdaptiveBoostLearner } from './services/AdaptiveBoostLearner.js';
import { DatabaseConnectionManager } from './database/index.js';

// Initialize
const dbManager = await DatabaseConnectionManager.getInstance();
const learner = new AdaptiveBoostLearner(dbManager.getDatabase());

// Record feedback from production searches
for (const search of productionSearches) {
  learner.recordFeedback({
    query: search.query,
    queryType: search.type,
    results: search.results,
    relevanceJudgments: search.userRatings,  // From explicit feedback
    metrics: search.metrics
  });
}

// Learn improved weights
const result = await learner.learnFromFeedback();

if (result.converged) {
  // Save for A/B testing
  await learner.saveWeights('learned_2025_10_11', result.weights);

  console.log('New weights ready for A/B test');
  console.log('Expected improvement:', result.loss);
}
```

## Metrics to Track

**Learning Effectiveness**:
- Loss convergence over iterations
- Validation set nDCG
- Per-query-type improvements

**Production Impact**:
- A/B test win rate
- User satisfaction (if surveyed)
- Click-through rate (CTR)
- Dwell time on results

**System Health**:
- Learning job duration
- Memory usage
- Weight stability (avoid oscillation)

## References

- **Original issue**: #62 (Symbol-BM25 integration)
- **Benchmark results**: SEARCH_BENCHMARK_FINDINGS.md
- **Weight storage**: SymbolIndexRepository.getBoostConfig()
- **Learning class**: AdaptiveBoostLearner.ts

## Conclusion

**Current state**: Static weights (80% code recall, proven)
**Future state**: Adaptive weights (learned from production feedback)
**Migration path**: Framework ready, waiting for production data

The adaptive learning framework is **implemented but disabled** - a placeholder for future enhancement when production feedback data becomes available.
