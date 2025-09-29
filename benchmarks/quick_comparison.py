#!/usr/bin/env python3
"""
Quick BM25 vs Knowledge Graph Comparison
Focus on just the files we know exist to get fast, clear results
"""

import os
import re
from pathlib import Path

def test_exact_searches():
    """Test exact function/class name searches"""

    # Files we know exist
    test_files = {
        "ZMCPTools/src/tools/unifiedSearchTool.ts": None,
        "ZMCPTools/src/services/RealFileIndexingService.ts": None,
        "ZMCPTools/src/services/EmbeddingClient.ts": None,
        "CLAUDE.md": None,
        "README.md": None
    }

    # Load their content
    repo_path = "/home/jw/dev/game1"
    for file_path in test_files.keys():
        full_path = os.path.join(repo_path, file_path)
        if os.path.exists(full_path):
            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    test_files[file_path] = f.read()
            except:
                pass

    print("🔬 Quick BM25 vs Knowledge Graph Comparison")
    print("=" * 50)

    # Test queries
    tests = [
        {
            "query": "searchKnowledgeGraphUnified",
            "expected_file": "ZMCPTools/src/tools/unifiedSearchTool.ts",
            "type": "exact_function"
        },
        {
            "query": "RealFileIndexingService",
            "expected_file": "ZMCPTools/src/services/RealFileIndexingService.ts",
            "type": "exact_class"
        },
        {
            "query": "cosineSimilarity",
            "expected_file": "ZMCPTools/src/services/RealFileIndexingService.ts",
            "type": "method_name"
        },
        {
            "query": "GPU embedding service implementation",
            "expected_file": "CLAUDE.md",
            "type": "conceptual"
        },
        {
            "query": "agent coordination and task management",
            "expected_file": "CLAUDE.md",
            "type": "conceptual"
        }
    ]

    for test in tests:
        print(f"\n📋 Query: {test['query']}")
        print(f"   Type: {test['type']}")
        print(f"   Expected: {test['expected_file']}")

        bm25_scores = search_bm25(test['query'], test_files)
        kg_scores = search_old_kg(test['query'], test_files)

        print(f"\n   BM25 Results:")
        for i, (file, score) in enumerate(bm25_scores[:3]):
            marker = "✅" if file == test['expected_file'] else "  "
            print(f"   {marker} {i+1}. {file.split('/')[-1]}: {score:.2f}")

        print(f"\n   Old KG Results:")
        for i, (file, score) in enumerate(kg_scores[:3]):
            marker = "✅" if file == test['expected_file'] else "  "
            print(f"   {marker} {i+1}. {file.split('/')[-1]}: {score:.2f}")

        # Check which found the target
        bm25_found = any(file == test['expected_file'] for file, _ in bm25_scores[:5])
        kg_found = any(file == test['expected_file'] for file, _ in kg_scores[:5])

        if bm25_found and not kg_found:
            winner = "BM25"
        elif kg_found and not bm25_found:
            winner = "Old KG"
        elif bm25_found and kg_found:
            bm25_rank = next(i for i, (file, _) in enumerate(bm25_scores) if file == test['expected_file'])
            kg_rank = next(i for i, (file, _) in enumerate(kg_scores) if file == test['expected_file'])
            winner = "BM25" if bm25_rank < kg_rank else "Old KG"
        else:
            winner = "Neither"

        print(f"   🏆 Winner: {winner}")

    return True

def search_bm25(query, files):
    """BM25-style search with exact matching priority"""
    results = []
    query_exact = query.strip()
    query_words = re.findall(r'\w+', query.lower())

    for file_path, content in files.items():
        if content is None:
            continue

        score = 0.0

        # Exact string match (highest priority)
        if query_exact in content:
            exact_count = content.count(query_exact)
            score += exact_count * 50.0

        # Function/class definition matches
        patterns = [
            f"export.*{query_exact}",
            f"function {query_exact}",
            f"class {query_exact}",
            f"const {query_exact}",
            f"def {query_exact}"
        ]
        for pattern in patterns:
            if re.search(pattern, content, re.IGNORECASE):
                score += 100.0

        # Word-level matching
        for word in query_words:
            if len(word) > 2:
                word_count = content.lower().count(word)
                if word_count > 0:
                    score += word_count * 2.0

        # File name relevance
        if any(word in file_path.lower() for word in query_words):
            score += 10.0

        if score > 0:
            results.append((file_path, score))

    return sorted(results, key=lambda x: x[1], reverse=True)

def search_old_kg(query, files):
    """Simulate old knowledge graph search behavior"""
    results = []
    query_words = query.lower().split()

    for file_path, content in files.items():
        if content is None:
            continue

        score = 0.0
        content_lower = content.lower()

        # Simple TF-like scoring
        for word in query_words:
            if word in content_lower:
                word_frequency = content_lower.count(word)
                tf = word_frequency / len(content_lower.split())
                score += tf * 1000  # Scale up for visibility

        # File name boost
        if any(word in file_path.lower() for word in query_words):
            score += 50.0

        if score > 0:
            results.append((file_path, score))

    return sorted(results, key=lambda x: x[1], reverse=True)

if __name__ == "__main__":
    test_exact_searches()