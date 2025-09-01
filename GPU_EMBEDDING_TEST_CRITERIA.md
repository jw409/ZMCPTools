# GPU Embedding Model Test Criteria for Knowledge Graph

## Problem: Previous tests were too simplistic
Basic cosine similarity tests don't capture real-world knowledge graph needs:
- Finding conceptually related code across different languages
- Connecting documentation to implementation
- Understanding semantic relationships between error patterns and solutions
- Linking architectural decisions to their consequences

## Proper Test Criteria

### 1. Cross-Domain Semantic Understanding
**Test**: Can the model connect related concepts across different contexts?

```python
test_pairs = [
    # Should have HIGH similarity despite different domains
    ("React useState hook for managing form state", 
     "Vue.js reactive data binding in component"),
    
    ("PostgreSQL JSONB indexing performance", 
     "MongoDB document query optimization"),
    
    ("JWT authentication token refresh strategy",
     "OAuth2 access token renewal mechanism"),
    
    # Should have LOW similarity despite similar words
    ("Python import error in module", 
     "Java import statement syntax"),
    
    ("Database migration failed", 
     "Bird migration patterns")
]
```

### 2. Code-to-Documentation Matching
**Test**: Can it link documentation to actual implementations?

```python
doc_to_code_tests = [
    {
        "doc": "The authentication middleware validates JWT tokens on protected routes",
        "code_samples": [
            "const authMiddleware = (req, res, next) => { jwt.verify(token) }",  # Should match
            "router.post('/login', async (req, res) => { })",  # Should not match
            "SELECT * FROM users WHERE id = ?",  # Should not match
        ]
    }
]
```

### 3. Error Pattern Recognition
**Test**: Can it group similar errors and link to solutions?

```python
error_pattern_tests = [
    {
        "error": "TypeError: Cannot read property 'map' of undefined",
        "similar_errors": [
            "TypeError: Cannot read properties of undefined (reading 'length')",  # HIGH
            "Uncaught TypeError: undefined is not iterable",  # HIGH
            "SyntaxError: Unexpected token '}'",  # LOW
        ],
        "solutions": [
            "Add null check before array operations",  # Should match
            "Initialize state with empty array instead of undefined",  # Should match
            "Check API response structure before accessing nested properties",  # Should match
            "Update npm packages to latest version",  # Should NOT match
        ]
    }
]
```

### 4. Architectural Decision Records (ADR) Linking
**Test**: Can it connect decisions to their implementations and outcomes?

```python
adr_tests = [
    {
        "decision": "Use event sourcing for audit trail requirements",
        "should_match": [
            "class EventStore implements AuditLog",
            "Every state change is stored as an immutable event",
            "Replay events to reconstruct system state"
        ],
        "should_not_match": [
            "REST API endpoint for user creation",
            "CSS styling for event display",
            "Unit test for email validation"
        ]
    }
]
```

### 5. Temporal Relevance
**Test**: Can it understand version-specific or time-sensitive information?

```python
temporal_tests = [
    {
        "query": "React 18 concurrent rendering",
        "should_rank_higher": [
            "useTransition hook for non-blocking updates",
            "Suspense boundaries in React 18"
        ],
        "should_rank_lower": [
            "React 16 lifecycle methods",
            "componentWillMount deprecated"
        ]
    }
]
```

### 6. Multi-hop Reasoning
**Test**: Can it traverse conceptual relationships?

```python
multihop_tests = [
    {
        "start": "User reports slow page load",
        "chain": [
            "Performance profiling shows N+1 queries",  # Step 1
            "Database query optimization needed",  # Step 2
            "Implement eager loading with includes",  # Step 3
        ],
        "should_find_related": [
            "ActiveRecord includes method",
            "Sequelize eager loading",
            "GraphQL DataLoader pattern"
        ]
    }
]
```

### 7. Real Knowledge Graph Queries
**Test**: Actual queries from our codebase

```python
real_world_tests = [
    {
        "query": "ZMCP agent coordination",
        "expected_entities": [
            "spawn_agent function",
            "orchestrate_objective",
            "agent room communication",
            "task dependencies"
        ]
    },
    {
        "query": "GPU embedding integration", 
        "expected_entities": [
            "RTX 5090 configuration",
            "sentence-transformers",
            "CUDA memory management",
            "Fooocus venv setup"
        ]
    }
]
```

## Scoring Metrics

### Precision & Recall
- **Precision**: Of the results returned, how many are actually relevant?
- **Recall**: Of all relevant items, how many were found?
- **F1 Score**: Harmonic mean of precision and recall

### Ranking Quality (NDCG)
- Normalized Discounted Cumulative Gain
- Measures if the most relevant results appear first

### Semantic Coherence
- Average similarity within clusters of related concepts
- Should be high for related items, low for unrelated

### Speed vs Quality Trade-off
```python
def calculate_efficiency_score(model_name, results):
    quality_score = results['f1_score']
    speed_ms = results['avg_query_time_ms']
    vram_gb = results['vram_usage_gb']
    
    # Penalize slow models and memory hogs
    efficiency = quality_score * (100 / speed_ms) * (8 / vram_gb)
    return efficiency
```

## Benchmark Implementation

```python
class KnowledgeGraphEmbeddingBenchmark:
    def __init__(self, model_name):
        self.model = load_model(model_name)
        self.results = {}
    
    def run_all_tests(self):
        self.test_cross_domain_semantics()
        self.test_code_documentation_matching()
        self.test_error_pattern_recognition()
        self.test_adr_linking()
        self.test_temporal_relevance()
        self.test_multihop_reasoning()
        self.test_real_queries()
        
    def generate_report(self):
        # Create detailed report with:
        # - Confusion matrices for each test category
        # - Precision/Recall curves
        # - Example successes and failures
        # - Recommendations for production use
```

## Expected Outcomes

### Good Model Should:
1. Score >0.8 F1 on cross-domain semantic tests
2. Successfully link 70%+ of docs to correct code
3. Group error patterns with >0.85 precision
4. Handle multi-hop reasoning with <20% degradation per hop
5. Process queries in <100ms for real-time use
6. Fit in available VRAM (32GB for RTX 5090)

### Red Flags:
- Model that's good at keyword matching but fails semantic understanding
- High VRAM usage (>20GB) for marginal quality improvement  
- Query times >200ms making real-time use impractical
- Poor performance on domain-specific terminology (our actual code/docs)

## Models to Test (Updated Priority)

1. **Alibaba-NLP/gte-Qwen2-7B-instruct** - Claimed SOTA, but needs verification
2. **BAAI/bge-m3** - Multilingual, good for diverse codebases
3. **nomic-ai/nomic-embed-text-v1.5** - Optimized for semantic search
4. **sentence-transformers/all-mpnet-base-v2** - Baseline, proven reliable
5. **jina-embeddings-v2-base-en** - Good for long documents

The winner should become the default for ZMCP knowledge graph.