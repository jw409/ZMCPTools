# Knowledge Graph Entry Points Analysis

## Current Entry Points (Found)

### 1. **MCP Tool Interface** (PRIMARY - What Claude uses)
- **Location**: Called via `mcp__zmcp-tools__store_knowledge_memory` and related tools
- **Backend**: `/home/jw/dev/game1/ZMCPTools/src/tools/knowledgeGraphTools.ts`
- **Service**: `/home/jw/dev/game1/ZMCPTools/src/services/VectorSearchService.ts`
- **Database**: `~/.mcptools/data/claude_mcp_tools.db`
- **Status**: ✅ WORKING but using CPU embeddings (Xenova/all-MiniLM-L6-v2)

### 2. **Direct TypeScript Service**
- **Location**: `/home/jw/dev/game1/ZMCPTools/src/services/KnowledgeGraphService.ts`
- **Vector Service**: `/home/jw/dev/game1/ZMCPTools/src/services/VectorSearchService.ts`
- **LanceDB Service**: `/home/jw/dev/game1/ZMCPTools/src/services/LanceDBService.ts`
- **Status**: ⚠️ Uses LanceDB but CPU embeddings

### 3. **Python Management Script** (NEW - Just created)
- **Location**: `/home/jw/dev/game1/ZMCPTools/scripts/knowledge_graph_manager.py`
- **Purpose**: Backup, flush, populate, migrate, search
- **Status**: ✅ WORKING for management, no embedding yet

### 4. **Test Scripts**
- `/home/jw/dev/game1/ZMCPTools/tests/test_knowledge_graph_direct.py`
- `/home/jw/dev/game1/ZMCPTools/tests/test-kg-embeddings.py`
- **Status**: 🔍 Test files, not production entry points

## Priority Order for GPU Integration

### Priority 1: Fix the MCP Tool Backend (What Claude Actually Uses)
**WHY**: This is the primary interface Claude uses to store/search knowledge
**WHAT TO FIX**: 
- `/home/jw/dev/game1/ZMCPTools/src/services/VectorSearchService.ts`
- Add GPU embedding provider option
- Create bridge to Python GPU service

### Priority 2: Create GPU Embedding Server
**WHY**: Needed by Priority 1 to actually do GPU embeddings
**WHAT TO CREATE**:
- FastAPI server at `talent-os/bin/zmcp_gpu_embedding_server.py`
- Run on port 8001
- Use Fooocus venv with RTX 5090

### Priority 3: Update LanceDB Service
**WHY**: Stores the actual vectors from GPU embeddings
**WHAT TO FIX**:
- `/home/jw/dev/game1/ZMCPTools/src/services/LanceDBService.ts`
- Handle larger dimension vectors from GPU models
- Optimize for GPU embedding sizes

### Priority 4: Migration Tool
**WHY**: Need to migrate existing 165 entities to GPU embeddings
**WHAT TO USE**:
- `/home/jw/dev/game1/ZMCPTools/scripts/knowledge_graph_manager.py migrate`
- Already has export functionality
- Need to add GPU embedding step

### Priority 5: Benchmark & Select Best Model
**WHY**: Determine which GPU model to use in production
**WHAT TO RUN**:
- `/home/jw/dev/game1/talent-os/bin/benchmark_embedding_models.py`
- Test Qwen3, BGE, Nomic models
- Pick winner for production

## What We're NOT Touching (Yet)
- Test files - they'll be updated after main implementation
- Old dashboard - will be archived after GPU integration works
- Direct database access - keep using MCP tools as primary interface

## Next Immediate Steps
1. Create the FastAPI GPU embedding server (Priority 2)
2. Modify VectorSearchService.ts to use it (Priority 1)
3. Test with a few entities
4. Run benchmark to pick best model (Priority 5)
5. Migrate all 165 entities (Priority 4)

## The Key Insight
**The MCP tool interface is what matters most** - that's what Claude uses. Everything else is secondary. The CPU embedding in VectorSearchService.ts line 74 is the bottleneck we need to fix.