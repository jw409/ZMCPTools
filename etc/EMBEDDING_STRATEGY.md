# ZMCP Embedding Strategy

## Executive Summary

ZMCP knowledge graph uses **EmbeddingGemma-300M** (768D vectors) for GPU-accelerated semantic search. This pragmatic choice balances performance (767 docs/sec), integration simplicity, and VRAM efficiency while providing production-quality semantic capabilities.

## Model Selection: Gemma3-300M (768D)

### Rationale
- **Already Integrated**: Port 8765 embedding service operational
- **Proven Performance**: 767 docs/sec throughput, 445 docs/sec/GB efficiency
- **VRAM Efficient**: Only 1.7GB usage
- **Vector Quality**: 768-dimensional embeddings provide excellent semantic search
- **Ecosystem**: Google model with strong tooling support

### Benchmark Context (Reference Only)
Testing on RTX 5090 with 785 real project files showed:

| Model | Throughput | VRAM | Efficiency | Status |
|-------|------------|------|------------|--------|
| **Gemma3-300M** | **767 docs/sec** | **1.7GB** | **445 docs/sec/GB** | ✅ **SELECTED** |
| Qwen3-0.6B | 1,637 docs/sec | 1.7GB | 938 docs/sec/GB | 📊 Benchmark winner |
| Qwen3-4B | 762 docs/sec | 8.4GB | 91 docs/sec/GB | ⚡ Reranker candidate |

**Note**: While Qwen3-0.6B showed superior benchmark performance (2x throughput), we chose Gemma3 for pragmatic integration reasons. Future migration path exists if needed.

## Architecture

### GPU Service Integration
- **Port**: 8765 (systemd-managed embedding-service)
- **Endpoint**: POST /embed with batch support
- **Health Check**: GET /health with VRAM monitoring
- **Models Available**: gemma3_06b (768D), minilm_l6_v2, nomic_embed, bge_reranker

### Fallback Chain
1. **Primary**: GPU service (Gemma3) - 767 docs/sec
2. **Secondary**: CPU embeddings with warning - ~100 docs/sec
3. **Tertiary**: Hash-based fallback for degraded operation

### Service Management
```bash
# Start GPU embedding service
systemctl --user start embedding-service

# Check status and VRAM
systemctl --user status embedding-service
curl http://localhost:8765/health

# Monitor performance
journalctl --user -u embedding-service -f
```

## LanceDB Storage Strategy

### Project-Local Collections
```
var/storage/lancedb/
├── knowledge_graph_gemma3.lance/   # Primary (768D Gemma3)
├── knowledge_graph_minilm.lance/   # CPU fallback (384D)
└── metadata.json                   # Collection tracking
```

### Bubble-Up Pattern
- **Project discoveries**: Stored in `./var/storage/lancedb/`
- **Parent bubbling**: Search `../var/storage/lancedb/` if not found locally
- **Global fallback**: `~/.mcptools/data/` for legacy/shared knowledge
- **Authority scoring**: Project facts start at 0.35, increase with validation

### Collection Management
```typescript
// GPU-accelerated search (primary)
const results = await searchKnowledgeGraph(
  repositoryPath: ".",
  query: "authentication flow",
  useGpu: true  // Uses knowledge_graph_gemma3
);

// CPU fallback
const results = await searchKnowledgeGraph(
  repositoryPath: ".",
  query: "authentication flow",
  useGpu: false  // Uses knowledge_graph_minilm
);
```

## Performance Targets

### Embedding Generation
- **Throughput**: >750 docs/sec (Gemma3 proven: 767 docs/sec)
- **Latency**: <50ms single document
- **VRAM**: <2GB per model instance
- **Batch Processing**: 8.5 docs/sec sustained, 1GB batches tested

### Search Performance
- **Vector Search**: <100ms for top-50 results
- **Total Latency**: <150ms end-to-end (no reranker currently)
- **VRAM Budget**: ~2GB (Gemma3 only, 30GB remaining on RTX 5090)

## Integration Points

### MCP Tools
- `store_knowledge_memory`: Auto-detects GPU, dual-writes to gemma3/minilm
- `search_knowledge_graph`: Uses gemma3 by default, fallback to minilm
- `search_knowledge_graph_gpu`: Explicit GPU-only search (fails if unavailable)

### MCPLogger Integration
- All embedding operations logged with model info
- Errors observable via `logs://zmcp-tools/errors` resource
- Tool calls tracked in `logs://zmcp-tools/tool-calls`

### Service Dependencies
```bash
# Check embedding service before operations
curl -s http://localhost:8765/health | jq '.status'

# If unhealthy, automatic fallback to CPU
# Logged as: "GPU service unavailable, using CPU fallback"
```

## Future Enhancements (Deferred)

### Two-Stage Retrieval (Optional)
- **Stage 1**: Fast Gemma3 embedding search (current)
- **Stage 2**: Precision reranking with Qwen3-4B or BGE-Reranker
- **Impact**: +8.4GB VRAM, ~150ms additional latency
- **Decision**: Implement when search quality requires it

### Model Migration Path
- **If needed**: Switch to Qwen3-0.6B (2x performance)
- **Process**: Re-index to new collection, maintain backward compatibility
- **Trigger**: Performance bottleneck or quality issues
- **Cost**: ~1-2 hours re-indexing for medium projects

### Multi-Model Support
- **Current**: Single model (Gemma3) with CPU fallback
- **Future**: Per-model LanceDB instances (qwen3_06b.lance, gemma_embed.lance)
- **Benefit**: Query routing based on use case (speed vs quality)

## Best Practices

### When to Use GPU Embeddings
✅ **Use GPU for**:
- Code semantic search
- Documentation indexing
- Large-scale knowledge graph builds
- Real-time agent queries

❌ **Use CPU fallback for**:
- GPU service unavailable
- Low-priority background tasks
- Development/testing environments
- Small datasets (<100 documents)

### VRAM Management
- **Monitor**: Check /health endpoint before heavy operations
- **Batch**: Use batch processing for >20 documents
- **Queue**: Single model instance, no parallel model loading
- **Fallback**: Automatic degradation if VRAM exhausted

### Error Handling
- **GPU unavailable**: Automatic CPU fallback with warning log
- **Service timeout**: 30-second timeout, then fallback
- **Quality degradation**: Log model used in results metadata

## Monitoring & Observability

### Key Metrics
```bash
# Embedding throughput
curl http://localhost:8765/health | jq '.throughput'

# VRAM usage
nvidia-smi --query-gpu=memory.used --format=csv

# MCP error logs
# Via MCP resource: logs://zmcp-tools/errors?category=knowledge-graph
```

### Success Criteria
- ✅ Gemma3 achieving >750 docs/sec
- ✅ <150ms search latency
- ✅ <2GB VRAM usage
- ✅ 100% project isolation (bubble-up verified)
- ✅ Automatic GPU→CPU fallback working

## References

- Benchmark Report: `talent-os/benchmarks/COMPREHENSIVE_COMPARISON_REPORT.md`
- Service Config: `talent-os/bin/start_embedding_service.py`
- MCP Integration: `ZMCPTools/src/services/EmbeddingClient.ts`
- Storage Design: `ZMCPTools/src/services/LanceDBService.ts`

---

**Last Updated**: 2025-10-03 (mcp-logging-infrastructure branch)
**Status**: Production-ready with Gemma3-300M
**Future Consideration**: Qwen3-0.6B migration path documented but deferred
