#!/usr/bin/env python3
"""
Comprehensive integration test for the updated unified search tool
Tests real file indexing, BM25, semantic search, and automatic routing
"""

import asyncio
import json
import subprocess
import time
from pathlib import Path
from typing import Dict, List, Any, Optional

class RealUnifiedSearchTester:
    """Test the actual unified search tool with real file indexing"""

    def __init__(self):
        self.repository_path = "/home/jw/dev/game1/ZMCPTools"
        self.mcp_command = ["node", "/home/jw/dev/game1/ZMCPTools/dist/server/index.js"]

    async def call_mcp_tool(self, tool_name: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Call an MCP tool and return the result"""
        request = {
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": params
            }
        }

        try:
            # Start MCP process
            process = subprocess.Popen(
                self.mcp_command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd="/home/jw/dev/game1/ZMCPTools"
            )

            # Send request
            stdout, stderr = process.communicate(input=json.dumps(request) + "\n", timeout=30)

            if stderr:
                print(f"MCP stderr: {stderr}")

            # Parse response
            for line in stdout.strip().split('\n'):
                if line:
                    try:
                        response = json.loads(line)
                        if "result" in response:
                            content = response["result"].get("content", [])
                            if content and content[0].get("type") == "text":
                                return json.loads(content[0]["text"])
                    except json.JSONDecodeError:
                        continue

            return None

        except subprocess.TimeoutExpired:
            process.kill()
            print("MCP call timed out")
            return None
        except Exception as e:
            print(f"MCP call failed: {e}")
            return None

    async def test_bm25_search(self) -> Dict[str, Any]:
        """Test BM25 search with exact code symbols"""
        print("🔍 Testing BM25 Search (Exact Keyword Matching)")

        # Test with exact function name that should exist in ZMCPTools
        query = "searchKnowledgeGraphUnified"

        result = await self.call_mcp_tool("search_knowledge_graph_unified", {
            "repository_path": self.repository_path,
            "query": query,
            "use_bm25": True,
            "use_qwen3_embeddings": False,
            "use_reranker": False,
            "final_limit": 5
        })

        success = False
        found_target_file = False

        if result and result.get("success"):
            results = result.get("results", [])
            print(f"  ✅ Found {len(results)} results")

            # Check if we found the unifiedSearchTool.ts file
            for res in results:
                file_path = res.get("file_path", "")
                if "unifiedSearchTool.ts" in file_path:
                    found_target_file = True
                    print(f"  ✅ Found target file: {file_path}")
                    break

            if found_target_file:
                success = True
                print(f"  ✅ BM25 search successfully found exact function name")
            else:
                print(f"  ⚠️ BM25 search didn't find expected file")

            # Show auto-routing analysis
            auto_routing = result.get("metadata", {}).get("auto_routing_analysis", {})
            print(f"  🤖 Auto-routing: {auto_routing.get('reasoning', 'N/A')}")
        else:
            print(f"  ❌ BM25 search failed: {result}")

        return {
            "test": "bm25_search",
            "success": success,
            "found_target": found_target_file,
            "result_count": len(result.get("results", [])) if result else 0,
            "timing": result.get("performance_metrics", {}).get("stage_timings", {}) if result else {}
        }

    async def test_semantic_search(self) -> Dict[str, Any]:
        """Test semantic search with conceptual queries"""
        print("🧠 Testing Semantic Search (Conceptual Understanding)")

        # Test with conceptual query
        query = "code that orchestrates multiple agents"

        result = await self.call_mcp_tool("search_knowledge_graph_unified", {
            "repository_path": self.repository_path,
            "query": query,
            "use_bm25": False,
            "use_qwen3_embeddings": True,
            "use_reranker": False,
            "final_limit": 5
        })

        success = False
        found_relevant = False

        if result and result.get("success"):
            results = result.get("results", [])
            print(f"  ✅ Found {len(results)} results")

            # Check if we found orchestration-related files
            for res in results:
                file_path = res.get("file_path", "")
                if any(keyword in file_path.lower() for keyword in ["orchestrat", "agent", "spawn"]):
                    found_relevant = True
                    print(f"  ✅ Found relevant file: {file_path}")
                    break

            if found_relevant:
                success = True
                print(f"  ✅ Semantic search found conceptually relevant files")
            else:
                print(f"  ⚠️ Semantic search didn't find expected orchestration files")

            # Show auto-routing analysis
            auto_routing = result.get("metadata", {}).get("auto_routing_analysis", {})
            print(f"  🤖 Auto-routing: {auto_routing.get('reasoning', 'N/A')}")
        else:
            print(f"  ❌ Semantic search failed: {result}")

        return {
            "test": "semantic_search",
            "success": success,
            "found_relevant": found_relevant,
            "result_count": len(result.get("results", [])) if result else 0,
            "timing": result.get("performance_metrics", {}).get("stage_timings", {}) if result else {}
        }

    async def test_hybrid_search(self) -> Dict[str, Any]:
        """Test hybrid search combining BM25 and semantic"""
        print("⚖️ Testing Hybrid Search (BM25 + Semantic)")

        # Test with mixed query
        query = "spawn_agent implementation details"

        result = await self.call_mcp_tool("search_knowledge_graph_unified", {
            "repository_path": self.repository_path,
            "query": query,
            "use_bm25": True,
            "use_qwen3_embeddings": True,
            "use_reranker": False,
            "final_limit": 5
        })

        success = False
        has_both_types = False

        if result and result.get("success"):
            results = result.get("results", [])
            print(f"  ✅ Found {len(results)} results")

            # Check for both keyword and semantic matches
            keyword_matches = sum(1 for res in results if res.get("search_method", "").startswith("bm25"))
            semantic_matches = sum(1 for res in results if "semantic" in res.get("search_method", ""))

            print(f"  📊 Keyword matches: {keyword_matches}, Semantic matches: {semantic_matches}")

            if keyword_matches > 0 and semantic_matches > 0:
                has_both_types = True
                success = True
                print(f"  ✅ Hybrid search successfully combined both methods")

            # Show auto-routing analysis
            auto_routing = result.get("metadata", {}).get("auto_routing_analysis", {})
            print(f"  🤖 Auto-routing: {auto_routing.get('reasoning', 'N/A')}")
        else:
            print(f"  ❌ Hybrid search failed: {result}")

        return {
            "test": "hybrid_search",
            "success": success,
            "has_both_types": has_both_types,
            "result_count": len(result.get("results", [])) if result else 0,
            "timing": result.get("performance_metrics", {}).get("stage_timings", {}) if result else {}
        }

    async def test_auto_routing(self) -> Dict[str, Any]:
        """Test automatic query routing logic"""
        print("🤖 Testing Automatic Query Routing")

        test_cases = [
            {
                "query": "getUserById",
                "expected_bm25": True,
                "expected_semantic": False,
                "description": "Code function name should prefer BM25"
            },
            {
                "query": "how to implement user authentication",
                "expected_bm25": False,
                "expected_semantic": True,
                "description": "Natural language question should prefer semantic"
            },
            {
                "query": "async function database connection patterns",
                "expected_bm25": True,
                "expected_semantic": True,
                "description": "Mixed query should use hybrid"
            }
        ]

        routing_results = []

        for case in test_cases:
            print(f"  Testing: '{case['query']}'")

            result = await self.call_mcp_tool("search_knowledge_graph_unified", {
                "repository_path": self.repository_path,
                "query": case["query"],
                "use_bm25": True,  # Use defaults to see what routing suggests
                "use_qwen3_embeddings": True,
                "use_reranker": False,
                "final_limit": 3
            })

            if result and result.get("success"):
                auto_routing = result.get("metadata", {}).get("auto_routing_analysis", {})
                suggested_bm25 = auto_routing.get("suggested_bm25", False)
                suggested_semantic = auto_routing.get("suggested_semantic", False)
                reasoning = auto_routing.get("reasoning", "")

                # Check if routing matches expectations
                bm25_correct = suggested_bm25 == case["expected_bm25"]
                semantic_correct = suggested_semantic == case["expected_semantic"]

                print(f"    Expected: BM25={case['expected_bm25']}, Semantic={case['expected_semantic']}")
                print(f"    Suggested: BM25={suggested_bm25}, Semantic={suggested_semantic}")
                print(f"    Reasoning: {reasoning}")
                print(f"    Result: {'✅' if bm25_correct and semantic_correct else '⚠️'}")

                routing_results.append({
                    "query": case["query"],
                    "correct": bm25_correct and semantic_correct,
                    "reasoning": reasoning
                })
            else:
                print(f"    ❌ Failed to get routing suggestion")
                routing_results.append({
                    "query": case["query"],
                    "correct": False,
                    "reasoning": "Failed"
                })

        success = all(r["correct"] for r in routing_results)

        return {
            "test": "auto_routing",
            "success": success,
            "cases_passed": sum(1 for r in routing_results if r["correct"]),
            "total_cases": len(routing_results),
            "details": routing_results
        }

    async def test_reranker_precision(self) -> Dict[str, Any]:
        """Test reranker for improved precision"""
        print("🎯 Testing Reranker Precision")

        query = "error handling and validation logic patterns"

        # Test without reranker
        result_without = await self.call_mcp_tool("search_knowledge_graph_unified", {
            "repository_path": self.repository_path,
            "query": query,
            "use_bm25": True,
            "use_qwen3_embeddings": True,
            "use_reranker": False,
            "final_limit": 5
        })

        # Test with reranker
        result_with = await self.call_mcp_tool("search_knowledge_graph_unified", {
            "repository_path": self.repository_path,
            "query": query,
            "use_bm25": True,
            "use_qwen3_embeddings": True,
            "use_reranker": True,
            "final_limit": 5
        })

        success = False
        reranker_improved = False

        if result_without and result_with and result_without.get("success") and result_with.get("success"):
            without_count = len(result_without.get("results", []))
            with_count = len(result_with.get("results", []))

            print(f"  📊 Without reranker: {without_count} results")
            print(f"  📊 With reranker: {with_count} results")

            # Check if reranker stage was actually used
            with_timings = result_with.get("performance_metrics", {}).get("stage_timings", {})
            reranker_time = with_timings.get("reranker_ms", 0)

            if reranker_time > 0:
                reranker_improved = True
                success = True
                print(f"  ✅ Reranker successfully processed results ({reranker_time:.0f}ms)")
            else:
                print(f"  ⚠️ Reranker was not used or failed")
        else:
            print(f"  ❌ Reranker test failed")

        return {
            "test": "reranker_precision",
            "success": success,
            "reranker_used": reranker_improved,
            "timing": result_with.get("performance_metrics", {}).get("stage_timings", {}) if result_with else {}
        }

    async def run_comprehensive_test(self) -> Dict[str, Any]:
        """Run all integration tests"""
        print("🧪 Running Comprehensive Integration Tests")
        print("=" * 50)

        test_results = []

        # Run all test methods
        tests = [
            self.test_bm25_search,
            self.test_semantic_search,
            self.test_hybrid_search,
            self.test_auto_routing,
            self.test_reranker_precision
        ]

        for test_func in tests:
            try:
                result = await test_func()
                test_results.append(result)
                print()  # Add spacing
            except Exception as e:
                print(f"❌ Test {test_func.__name__} failed: {e}")
                test_results.append({
                    "test": test_func.__name__,
                    "success": False,
                    "error": str(e)
                })
                print()

        # Generate summary
        total_tests = len(test_results)
        passed_tests = sum(1 for r in test_results if r.get("success", False))

        print("📊 TEST SUMMARY")
        print("=" * 30)
        print(f"✅ Passed: {passed_tests}/{total_tests}")
        print(f"❌ Failed: {total_tests - passed_tests}/{total_tests}")

        for result in test_results:
            status = "✅" if result.get("success", False) else "❌"
            test_name = result.get("test", "unknown")
            print(f"{status} {test_name}")

        overall_success = passed_tests == total_tests

        if overall_success:
            print("\n🎉 ALL TESTS PASSED! The unified search integration is working correctly.")
        else:
            print(f"\n⚠️ {total_tests - passed_tests} tests failed. Please check the implementation.")

        return {
            "overall_success": overall_success,
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "test_details": test_results
        }

async def main():
    """Main test execution"""
    tester = RealUnifiedSearchTester()

    try:
        results = await tester.run_comprehensive_test()

        if results["overall_success"]:
            print(f"\n✅ Integration test suite completed successfully!")
            return 0
        else:
            print(f"\n❌ Integration test suite failed!")
            return 1

    except Exception as e:
        print(f"❌ Test suite failed with error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    exit(asyncio.run(main()))