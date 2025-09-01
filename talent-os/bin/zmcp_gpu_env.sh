#!/bin/bash
# ZMCP GPU Embedding Configuration
export ZMCP_EMBEDDING_URL="http://localhost:8767/embed"
export ZMCP_EMBEDDING_MODE="gpu"
export ZMCP_EMBEDDING_DIMENSIONS="4096"
export ZMCP_GPU_SERVICE="http://localhost:8765/embed"
export ZMCP_USE_GPU="true"
echo "🚀 ZMCP configured for GPU embeddings (RTX 5090, Qwen3-8B, 4096d)"
