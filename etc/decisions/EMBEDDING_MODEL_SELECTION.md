# Embedding Model Selection and Configuration

## Current State (Updated 2025-09-29)

### ✅ What's Working:
1. **GPU Acceleration**: TalentOS embedding service running on port 8765
2. **Current Model**: EmbeddingGemma-300M (768D) - `gemma_embed`
3. **Performance**: ~50ms per embedding (16x faster than CPU baseline)
4. **Integration**: MCP server auto-detects GPU service with CPU fallback
5. **Stability**: Service managed via systemd, responsive and reliable

### 🔄 Available Models:
- **gemma_embed**: EmbeddingGemma-300M (768D) - **Currently Active**
- **minilm**: MiniLM-L6-v2 (384D) - CPU fallback
- **nomic**: Nomic Embed v1.5 (1024D) - Available
- **reranker**: BGE Reranker Large - Available

### ⚠️ Known Issues:
- **Qwen3 models**: Disabled due to service hang issues (see Issue #25)

### GPU Resources:
- RTX 5090 with 32GB VRAM available
- Current VRAM usage: ~1.16GB (gemma_embed loaded)
- Remaining capacity: ~30GB available for additional models

## How to Swap Embedding Models

### Quick Model Change
1. **Edit TalentOS service config** (`talent-os/bin/start_embedding_service.py`):
   ```python
   # Change priority to pre-load different model
   MODEL_CONFIGS = {
       'gemma_embed': {'path': 'google/embeddinggemma-300m', 'priority': 1},  # Current
       'nomic': {'path': 'nomic-ai/nomic-embed-text-v1.5', 'priority': 2},     # Alternative
   }
   ```

2. **Restart embedding service**:
   ```bash
   systemctl --user restart embedding-service
   curl http://localhost:8765/health  # Verify new model loaded
   ```

3. **Update MCP default** (optional - service auto-detects):
   ```typescript
   // In src/services/VectorSearchService.ts
   modelName: config.modelName || "nomic"  // Change from "gemma_embed"
   ```

4. **Rebuild MCP server** (if you changed TypeScript):
   ```bash
   cd ZMCPTools && npm run build
   ```

### Model Tradeoff Framework

**Choose based on your priorities:**

| Priority | Model Size | Example | VRAM | Speed | Quality |
|----------|------------|---------|------|-------|---------|
| **Speed** | Small (300M) | gemma_embed | ~1GB | Fastest | Good |
| **Balance** | Medium (600M-4B) | (Qwen3 when fixed) | 2-8GB | Fast | Better |
| **Quality** | Large (7B+) | Future options | 8-15GB | Slower | Best |

**Current recommendation**: `gemma_embed` (300M) provides excellent speed/quality balance at minimal VRAM cost.

## Benchmarking New Models

### Evaluation Metrics
When testing a new embedding model, measure:

1. **Throughput**: Embeddings per second (docs/sec)
2. **VRAM Usage**: GPU memory consumption (GB)
3. **Efficiency**: Throughput per GB VRAM (docs/sec/GB)
4. **Query Quality**: Precision/recall on test queries
5. **Latency**: Wall clock time for single embedding (ms)

### Benchmark Script Template
```bash
# Test a new model
curl -X POST http://localhost:8765/embed \
  -H "Content-Type: application/json" \
  -d '{"text":"test semantic search quality","model":"new_model_name"}' \
  -w "\nTime: %{time_total}s\n"

# Monitor VRAM during test
watch -n 1 nvidia-smi
```

### Quality Testing
Create test queries against your actual knowledge graph:
```bash
# Search with current model
mcp__zmcp-tools__search_knowledge_graph . "authentication patterns"

# Compare results after model swap
# Rate precision: Are top results relevant?
# Rate recall: Did it miss important results?
```

## Verification Commands

### Check Service Status
```bash
# Embedding service health
systemctl --user status embedding-service
curl http://localhost:8765/health | uv run python -m json.tool

# See loaded models
curl http://localhost:8765/models

# Check VRAM usage
nvidia-smi --query-gpu=memory.used,memory.free --format=csv
```

### Test Integration
```bash
# Direct embedding test
curl -X POST http://localhost:8765/embed \
  -H "Content-Type: application/json" \
  -d '{"text":"semantic search test","model":"gemma_embed"}'

# MCP knowledge graph search (tests full integration)
# Use via Claude Code MCP tools
```

## Performance Baseline

**Current System (gemma_embed):**
- Latency: ~50ms per embedding
- VRAM: ~1.16GB
- Speed: 16x faster than CPU baseline (MiniLM ~800ms)
- Dimensions: 768D
- Status: ✅ Stable and working

**CPU Fallback (MiniLM):**
- Latency: ~800ms per embedding
- VRAM: 0GB (CPU only)
- Dimensions: 384D
- Status: ✅ Automatic fallback when GPU unavailable

## Adding New Models

To add a new embedding model to the service:

1. **Update service config** (`talent-os/bin/start_embedding_service.py`):
   ```python
   MODEL_CONFIGS = {
       'your_model': {
           'path': 'huggingface/model-name',
           'type': 'sentence_transformer',  # or 'gemma_embed', etc.
           'priority': 3,  # Lower = loads earlier
           'vram_threshold_gb': 2.0
       }
   }
   ```

2. **Test loading**:
   ```bash
   systemctl --user restart embedding-service
   journalctl --user -u embedding-service -f  # Watch logs
   curl http://localhost:8765/models  # Verify available
   ```

3. **Benchmark** (see "Benchmarking New Models" section above)

4. **Update MCP default** if you want it as primary model

## Troubleshooting

**Service won't start:**
- Check logs: `journalctl --user -u embedding-service -n 50`
- Verify CUDA: `nvidia-smi`
- Check model paths in config

**Model loads but hangs:**
- Known issue with Qwen3 models (see Issue #25)
- Test with curl first before using in production
- Monitor CPU usage: `top` (should not spike to 96%+)

**Poor semantic search quality:**
- Try different model (see tradeoff framework)
- Verify embeddings have correct dimensions
- Check if knowledge graph has sufficient data
- Test query precision/recall manually