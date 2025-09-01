# ZMCP Knowledge Graph GPU Embedding Integration Plan

## Current State Analysis

### Problems Identified:
1. **No GPU Usage**: ZMCP uses CPU-based `Xenova/all-MiniLM-L6-v2` model (line 74 in VectorSearchService.ts)
2. **Basic SQLite Storage**: Knowledge graph has minimal data (160 entities, 5 relationships)
3. **No Semantic Search**: Current implementation uses basic text matching, not embeddings
4. **Disconnected Systems**: GPU embedding service exists in TalentOS but not integrated with ZMCP
5. **Dashboard Issues**: unified_orchestration_dashboard.py has hardcoded paths, no real monitoring

### Existing GPU Resources:
- RTX 5090 with 32GB VRAM available
- GPU embedding service at `/home/jw/dev/game1/talent-os/bin/gpu_embedding_service.py`
- Qwen3-8B embedding model configuration exists
- Fooocus venv with RTX 5090 PyTorch support at `/home/jw/dev/game1/.venv/`

## Implementation Plan

### Phase 1: GPU Embedding Service Bridge (Priority 1)
**Goal**: Create a bridge between ZMCP TypeScript and TalentOS GPU Python services

1. **Create GPU Embedding Bridge** (`src/services/GPUEmbeddingBridge.ts`)
   - Spawn Python subprocess using Fooocus venv
   - Use JSON-RPC or stdio for TypeScript ↔ Python communication
   - Cache embeddings in LanceDB for performance
   
2. **Modify VectorSearchService.ts**
   - Add `embeddingProvider: 'gpu' | 'cpu' | 'openai'` option
   - When 'gpu' selected, use GPUEmbeddingBridge
   - Fall back to CPU if GPU unavailable

3. **Create Python GPU Embedding Server** (`talent-os/bin/zmcp_gpu_embedding_server.py`)
   ```python
   #!/usr/bin/env python3
   # Runs in Fooocus venv with RTX 5090 support
   import json
   import sys
   from sentence_transformers import SentenceTransformer
   
   # Use Qwen3-8B or best available model
   model = SentenceTransformer('Alibaba-NLP/gte-Qwen2-7B-instruct', device='cuda')
   ```

### Phase 2: Model Benchmarking (Priority 2)
**Goal**: Determine which embedding model is actually best

1. **Test Candidates**:
   - Qwen3-8B-Embedding (claimed best)
   - Alibaba-NLP/gte-Qwen2-7B-instruct (7B parameters)
   - BAAI/bge-large-en-v1.5 (335M parameters)
   - sentence-transformers/all-mpnet-base-v2 (110M parameters)
   
2. **Benchmark Metrics**:
   - Embedding quality (semantic similarity tests)
   - Speed (embeddings per second)
   - Memory usage (VRAM consumption)
   - Accuracy on knowledge graph queries

3. **Create Benchmark Script** (`test_gpu_embedding_models.py`)

### Phase 3: Knowledge Graph Migration (Priority 3)
**Goal**: Migrate existing knowledge to GPU-powered vector storage

1. **Export Current Data**:
   ```bash
   sqlite3 ~/.mcptools/data/claude_mcp_tools.db ".dump knowledge_entities" > kg_backup.sql
   ```

2. **Re-embed with GPU**:
   - Load all entities
   - Generate GPU embeddings for each
   - Store in LanceDB with vector indices

3. **Verify Migration**:
   - Test semantic search accuracy
   - Compare with old text search
   - Ensure no data loss

### Phase 4: Dashboard Replacement (Priority 4)
**Goal**: Archive old dashboard, extract useful patterns

**Good Ideas to Harvest from unified_orchestration_dashboard.py**:
- Context switching between dom0/wwpoc (lines 36-50)
- Real-time stream monitoring concept (lines 31-33)
- Agent status visualization (lines 75-79)
- Task approval workflow (lines 85-87)

**Create New Minimal Monitor**:
- Simple CLI tool using rich/textual
- Focus on actual working features
- Use ZMCP room messages for real-time updates

### Phase 5: Integration Testing (Priority 5)
1. Test GPU embedding service stability
2. Verify semantic search quality improvement
3. Benchmark query performance
4. Monitor VRAM usage
5. Test fallback to CPU when GPU unavailable

## Configuration Changes

### ZMCPTools package.json additions:
```json
{
  "scripts": {
    "gpu:test": "node --experimental-modules test-gpu-embeddings.js",
    "gpu:benchmark": "uv run python talent-os/bin/test_gpu_embedding_models.py"
  }
}
```

### Environment Variables:
```bash
export ZMCP_EMBEDDING_PROVIDER=gpu
export ZMCP_GPU_MODEL=Alibaba-NLP/gte-Qwen2-7B-instruct
export ZMCP_FALLBACK_TO_CPU=true
```

## Success Metrics
1. ✅ Semantic search returns relevant results (not just text matches)
2. ✅ Query latency < 100ms for knowledge graph searches
3. ✅ GPU utilization visible in nvidia-smi during embedding
4. ✅ Knowledge graph has 1000+ entities after refresh
5. ✅ Old dashboard archived, new monitor working

## Rollback Plan
If GPU integration fails:
1. Keep CPU embedding as fallback (already in place)
2. Revert to SQLite text search
3. Document issues for future attempts
4. Use cloud embedding APIs as alternative

## Next Steps
1. Get Gemini's input on this plan
2. Start with Phase 1 (GPU Bridge)
3. Run benchmarks to pick best model
4. Migrate knowledge graph data
5. Archive old dashboard