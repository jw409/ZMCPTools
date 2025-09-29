#!/usr/bin/env python3
"""
Simple integration test for unified search tool using claude CLI
Tests real file indexing, BM25, semantic search, and automatic routing
"""

import subprocess
import json
import time

def call_unified_search(query, use_bm25=True, use_semantic=True, use_reranker=False):
    """Call unified search via claude CLI"""
    args = {
        "repository_path": "/home/jw/dev/game1/ZMCPTools",
        "query": query,
        "use_bm25": use_bm25,
        "use_qwen3_embeddings": use_semantic,
        "use_reranker": use_reranker,
        "final_limit": 3,
        "include_metrics": True
    }

    prompt = f"""Use the search_knowledge_graph_unified tool with these exact parameters:
{json.dumps(args, indent=2)}

Return only the raw tool response as JSON, no additional text."""

    cmd = ["claude", "-p", prompt]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            return True, result.stdout.strip()
        else:
            return False, result.stderr
    except Exception as e:
        return False, str(e)

def test_bm25_search():
    """Test BM25 keyword search"""
    print("🔍 Testing BM25 Search")

    # Search for exact function name that should exist
    query = "searchKnowledgeGraphUnified"
    success, response = call_unified_search(query, use_bm25=True, use_semantic=False)

    if success:
        try:
            data = json.loads(response)
            if data.get("success"):
                results = data.get("results", [])
                print(f"  ✅ Found {len(results)} results")

                # Check if we found the target file
                found_target = any("unifiedSearchTool" in res.get("file_path", "") for res in results)
                if found_target:
                    print("  ✅ Found target file with function name")
                    return True
                else:
                    print("  ⚠️ Results found but target file not in top results")
                    for res in results:
                        print(f"    - {res.get('file_path', 'Unknown')}")
            else:
                print(f"  ❌ Search failed: {data.get('error', 'Unknown error')}")
        except json.JSONDecodeError:
            print(f"  ❌ Invalid response: {response[:100]}...")
    else:
        print(f"  ❌ CLI call failed: {response}")

    return False

def test_semantic_search():
    """Test semantic search"""
    print("🧠 Testing Semantic Search")

    # Search for conceptual query
    query = "code that orchestrates multiple agents"
    success, response = call_unified_search(query, use_bm25=False, use_semantic=True)

    if success:
        try:
            data = json.loads(response)
            if data.get("success"):
                results = data.get("results", [])
                print(f"  ✅ Found {len(results)} results")

                # Check if we found orchestration-related files
                found_relevant = any(
                    any(keyword in res.get("file_path", "").lower()
                        for keyword in ["orchestrat", "agent", "spawn"])
                    for res in results
                )
                if found_relevant:
                    print("  ✅ Found orchestration-related files")
                    return True
                else:
                    print("  ⚠️ Results found but no obvious orchestration files")
                    for res in results:
                        print(f"    - {res.get('file_path', 'Unknown')}")
            else:
                print(f"  ❌ Search failed: {data.get('error', 'Unknown error')}")
        except json.JSONDecodeError:
            print(f"  ❌ Invalid response: {response[:100]}...")
    else:
        print(f"  ❌ CLI call failed: {response}")

    return False

def test_auto_routing():
    """Test automatic query routing"""
    print("🤖 Testing Auto-Routing")

    # Test with code function name (should prefer BM25)
    query = "getUserById"
    success, response = call_unified_search(query, use_bm25=True, use_semantic=True)

    if success:
        try:
            data = json.loads(response)
            if data.get("success"):
                auto_routing = data.get("metadata", {}).get("auto_routing_analysis", {})
                reasoning = auto_routing.get("reasoning", "")
                suggested_bm25 = auto_routing.get("suggested_bm25", False)

                print(f"  Query: '{query}'")
                print(f"  Reasoning: {reasoning}")
                print(f"  Suggested BM25: {suggested_bm25}")

                if suggested_bm25 and "BM25" in reasoning:
                    print("  ✅ Correctly suggested BM25 for code symbol")
                    return True
                else:
                    print("  ⚠️ Auto-routing didn't prefer BM25 for code symbol")
            else:
                print(f"  ❌ Search failed: {data.get('error', 'Unknown error')}")
        except json.JSONDecodeError:
            print(f"  ❌ Invalid response: {response[:100]}...")
    else:
        print(f"  ❌ CLI call failed: {response}")

    return False

def test_file_indexing():
    """Test that real files are being indexed and returned"""
    print("📁 Testing File Indexing")

    # Search for something that should definitely be in ZMCPTools
    query = "MCP"
    success, response = call_unified_search(query, use_bm25=True, use_semantic=False)

    if success:
        try:
            data = json.loads(response)
            if data.get("success"):
                results = data.get("results", [])
                indexing_stats = data.get("metadata", {}).get("indexing_stats", {})

                print(f"  ✅ Indexed {indexing_stats.get('indexed_files', 0)} files")
                print(f"  ✅ Found {len(results)} search results")

                # Check that results have real file paths
                has_real_paths = any(
                    res.get("file_path", "").endswith((".ts", ".js", ".py", ".md"))
                    for res in results
                )

                if has_real_paths:
                    print("  ✅ Results contain real file paths")
                    for res in results[:2]:
                        print(f"    - {res.get('file_path', 'Unknown')}")
                    return True
                else:
                    print("  ⚠️ Results don't contain expected file paths")
            else:
                print(f"  ❌ Search failed: {data.get('error', 'Unknown error')}")
        except json.JSONDecodeError:
            print(f"  ❌ Invalid response: {response[:100]}...")
    else:
        print(f"  ❌ CLI call failed: {response}")

    return False

def main():
    """Run integration tests"""
    print("🧪 Testing Unified Search Integration via Claude CLI")
    print("="*60)

    tests = [
        ("File Indexing", test_file_indexing),
        ("BM25 Search", test_bm25_search),
        ("Semantic Search", test_semantic_search),
        ("Auto-Routing", test_auto_routing)
    ]

    results = []

    for test_name, test_func in tests:
        print(f"\n{test_name}:")
        try:
            success = test_func()
            results.append((test_name, success))
        except Exception as e:
            print(f"  ❌ Test failed with exception: {e}")
            results.append((test_name, False))

    print(f"\n📊 INTEGRATION TEST SUMMARY")
    print("="*40)

    passed = sum(1 for _, success in results if success)
    total = len(results)

    for test_name, success in results:
        status = "✅" if success else "❌"
        print(f"{status} {test_name}")

    print(f"\nPassed: {passed}/{total}")

    if passed == total:
        print("🎉 ALL INTEGRATION TESTS PASSED!")
        print("The unified search tool is working correctly with real file indexing.")
        return 0
    else:
        print(f"⚠️ {total - passed} tests failed. Check the implementation.")
        return 1

if __name__ == "__main__":
    exit(main())