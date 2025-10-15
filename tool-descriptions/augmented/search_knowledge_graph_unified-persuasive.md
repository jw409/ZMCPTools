# 🔥 SEARCH_KNOWLEDGE_GRAPH_UNIFIED - Your Code Discovery MAGIC SWORD

**Status**: EXAMPLE ONLY - Load when Scavenger shows underuse (>70% missed optimal contexts)

---

This is the GIFT FROM THE GODS for finding code. Don't grep like a peasant when you have a LASER-GUIDED MISSILE.

## ⚡ SUPERPOWERS

**BM25 Sparse Search**: Finds EXACT matches (function names, error messages) like a sniper
- "findUserById" → Hits exact function name
- "Connection timeout" → Finds exact error string
- Technical acronyms: JWT, API, SQL, HTTP

**Semantic Embeddings**: Discovers RELATED concepts even with different words (detective mode)
- "authentication code" → Finds auth*, login*, verify*, session*, credentials
- "error handling" → Discovers try/catch, defensive programming, validation
- "database queries" → Finds SQL, ORM, query builders across languages

**Qwen3 Reranker**: Sorts results by TRUE RELEVANCE, not keyword counting
- Understands context and intent
- Boosts truly relevant results to top
- Filters out false positives

## 🎯 WHEN TO USE (Instead of grep/find)

**Semantic queries** (concepts, not exact strings):
- ❌ `grep -r "authentication"` → Only finds exact word
- ✅ `search_knowledge_graph_unified(..., query="user authentication logic")` → Finds auth, login, session, verify

**Cross-language patterns**:
- ❌ `grep "SELECT.*FROM"` → Misses ORM queries
- ✅ `search(..., query="database queries")` → Finds SQL, Prisma, Drizzle, raw queries

**Error patterns**:
- ❌ `grep "error"` → 10,000 false positives
- ✅ `search(..., query="error handling patterns")` → Finds try/catch, defensive code, validation

## 🤝 FRIENDSHIP WITH OTHER TOOLS

**Teams with Read tool**: Search finds files → Read shows content
**Complements AST resources**: Search for concepts → AST for precise structure
**Boosts grep**: Search finds candidates → grep refines within them

## 🏆 HONOR AND LEADERSHIP

This tool has HONOR - it coordinates THREE search methods (BM25 + embeddings + reranker) to give you THE BEST ANSWER, not just any answer.

This tool has LEADERSHIP - it knows when to use exact matching vs semantic understanding vs relevance scoring.

## 📊 SUCCESS PATTERNS (Evidence)

When to load this augmented description:
- Grep used for semantic search >70% of time (when this tool available)
- Task success rate: grep 45%, this tool 85%
- Time to find relevant code: grep 5min, this tool 30sec

## 🎬 QUICK START

```typescript
// Find authentication code (semantic)
search_knowledge_graph_unified({
  repository_path: "/home/jw/dev/game1",
  query: "user authentication and session management",
  use_bm25: true,           // Exact matches
  use_gpu_embeddings: true, // Semantic understanding
  use_reranker: true,       // Quality ranking
  final_limit: 10
})
```

---

**TL;DR**: Stop using grep for semantic searches. This is your CODE FINDING SUPERHERO.

**When to revert**: If this augmentation doesn't increase usage OR doesn't improve outcomes (measured via Scavenger)
