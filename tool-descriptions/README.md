# Tool Description System

## Architecture

### Compressed Descriptions (Default)
**Location**: `compressed/`
**Token Budget**: ~40 tokens per tool (~3k total for all tools)
**Format**: TL;DR + Quick Params + Docs Ref

**Purpose**: Maximum decision value with minimum tokens. Loaded by default in all sessions.

### Augmented Descriptions (Evidence-Based)
**Location**: `augmented/`
**Token Budget**: ~200 tokens per tool (loaded on-demand only)
**Format**: Persuasive "catnip" language with metaphors, examples, use cases

**Purpose**: Overcome LLM bias toward verbose descriptions. Only loaded when evidence shows tool is underused.

### Usage Metrics (Scavenger Data)
**Location**: `../tool-usage-metrics/`
**Format**: JSONL with session_id, tool_name, context, usage_decision, outcome

**Purpose**: Evidence collection for Teacher to identify underused tools.

## Compression Format

```json
{
  "name": "search_knowledge_graph_unified",
  "tldr": "Hybrid BM25 + semantic search with optional reranker",
  "quick_params": "repository_path, query, [use_bm25, use_gpu_embeddings, use_reranker]",
  "docs_ref": "ZMCPTools/TOOL_LIST.md#L142-189",
  "description": "Load on demand from {docs_ref}"
}
```

## Augmentation Trigger Criteria

**When to load augmented description**:
1. Scavenger data shows tool underused in >70% of optimal contexts
2. Teacher identifies pattern: "Alternative tool used when X was better choice"
3. System loads augmented description for next session
4. Monitor: Does usage increase? Does outcome improve?
5. Keep augmentation if successful, revert if ineffective

## Token Savings

**Before**: 17.9k tokens for all MCP tool descriptions (8.9% of context)
**After**: ~3k tokens compressed (1.5% of context)
**Reduction**: 83% token savings
**On-demand**: Load ~200 token augmentation only when evidence shows it's needed

## Implementation Status

- [x] Directory structure created
- [x] CLAUDE.md hook added
- [x] Compression specification documented
- [ ] Convert existing tool descriptions to compressed format
- [ ] Scavenger integration for usage tracking
- [ ] Teacher integration for underuse detection
- [ ] Augmentation loader (load persuasive version on-demand)

## Example: search_knowledge_graph_unified

**Compressed (40 tokens)**:
```
search_knowledge_graph_unified: Hybrid BM25 + semantic search with optional reranker
Params: repository_path, query, [use_bm25, use_gpu_embeddings, use_reranker]
Docs: ZMCPTools/TOOL_LIST.md#L142-189
```

**Augmented (200 tokens, loaded only when underused)**:
See `augmented/search_knowledge_graph_unified-persuasive.md`
