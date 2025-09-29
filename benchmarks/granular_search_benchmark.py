#!/usr/bin/env python3
"""
Granular Search Benchmark
Compare BM25 vs existing knowledge graph search across different content granularities:
- Direct matches (function names, class names) -> BM25
- Comments and explanations -> Semantic
- Method implementations -> BM25
- Documentation concepts -> Semantic
- Variable names and imports -> BM25
"""

import asyncio
import os
import re
from pathlib import Path
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass

@dataclass
class GranularQuery:
    query_id: str
    query_text: str
    content_granularity: str  # 'direct_match', 'comments', 'methods', 'concepts', 'variables'
    expected_search_type: str  # 'bm25' or 'semantic'
    relevant_docs: List[str]
    reasoning: str

class GranularSearchBenchmark:
    """Test search performance across different content granularities"""

    def __init__(self, repository_path: str):
        self.repository_path = Path(repository_path)
        self.file_contents = {}
        self.load_file_contents()

    def load_file_contents(self):
        """Load actual file contents for analysis"""
        print("📁 Loading file contents for granular analysis...")

        for root, dirs, files in os.walk(self.repository_path):
            dirs[:] = [d for d in dirs if d not in ['node_modules', 'dist', 'build', '.git', 'coverage']]

            for file in files:
                if any(file.endswith(ext) for ext in ['.md', '.ts', '.py', '.js']):
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, self.repository_path)

                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            self.file_contents[rel_path] = content
                    except:
                        pass

        print(f"📄 Loaded content from {len(self.file_contents)} files")

    def get_granular_queries(self) -> List[GranularQuery]:
        """Queries testing different content granularities"""

        return [
            # Direct matches - should use BM25
            GranularQuery(
                query_id="exact_function_name",
                query_text="searchKnowledgeGraphUnified",
                content_granularity="direct_match",
                expected_search_type="bm25",
                relevant_docs=["ZMCPTools/src/tools/unifiedSearchTool.ts"],
                reasoning="Exact function names should be found with keyword search"
            ),
            GranularQuery(
                query_id="exact_class_name",
                query_text="RealFileIndexingService",
                content_granularity="direct_match",
                expected_search_type="bm25",
                relevant_docs=["ZMCPTools/src/services/RealFileIndexingService.ts"],
                reasoning="Exact class names should be found with keyword search"
            ),
            GranularQuery(
                query_id="import_statement",
                query_text="import EmbeddingClient",
                content_granularity="direct_match",
                expected_search_type="bm25",
                relevant_docs=["ZMCPTools/src/services/RealFileIndexingService.ts"],
                reasoning="Import statements are exact text matches"
            ),

            # Variable names and specific identifiers - should use BM25
            GranularQuery(
                query_id="variable_name",
                query_text="embeddingClient",
                content_granularity="variables",
                expected_search_type="bm25",
                relevant_docs=["ZMCPTools/src/services/RealFileIndexingService.ts"],
                reasoning="Variable names should be found with exact matching"
            ),
            GranularQuery(
                query_id="method_call",
                query_text="checkGPUService",
                content_granularity="methods",
                expected_search_type="bm25",
                relevant_docs=["ZMCPTools/src/services/RealFileIndexingService.ts", "ZMCPTools/src/services/EmbeddingClient.ts"],
                reasoning="Method calls are exact identifiers"
            ),

            # Comments and explanations - should use semantic
            GranularQuery(
                query_id="comment_explanation",
                query_text="why use reciprocal rank fusion for combining search results",
                content_granularity="comments",
                expected_search_type="semantic",
                relevant_docs=["ZMCPTools/src/tools/unifiedSearchTool.ts", "ZMCPTools/src/services/HybridSearchService.ts"],
                reasoning="Comments explain concepts, not exact keywords"
            ),
            GranularQuery(
                query_id="algorithm_explanation",
                query_text="how does cosine similarity work for vector comparison",
                content_granularity="comments",
                expected_search_type="semantic",
                relevant_docs=["ZMCPTools/src/services/RealFileIndexingService.ts"],
                reasoning="Algorithm explanations are conceptual"
            ),

            # Documentation concepts - should use semantic
            GranularQuery(
                query_id="usage_pattern",
                query_text="how to configure search pipeline for best results",
                content_granularity="concepts",
                expected_search_type="semantic",
                relevant_docs=["README_REPRODUCIBLE_BENCHMARK.md", "docs/unified_search_llm_prompt.md"],
                reasoning="Usage patterns are conceptual knowledge"
            ),
            GranularQuery(
                query_id="architecture_concept",
                query_text="multi-agent coordination and task dependencies",
                content_granularity="concepts",
                expected_search_type="semantic",
                relevant_docs=["CLAUDE.md"],
                reasoning="Architecture concepts require understanding, not exact matching"
            ),

            # Method implementations - could use BM25 for signatures, semantic for logic
            GranularQuery(
                query_id="implementation_pattern",
                query_text="async function that processes files in batches",
                content_granularity="methods",
                expected_search_type="semantic",
                relevant_docs=["ZMCPTools/src/services/RealFileIndexingService.ts"],
                reasoning="Implementation patterns are conceptual descriptions"
            ),
            GranularQuery(
                query_id="error_handling_pattern",
                query_text="try catch blocks with logging for file operations",
                content_granularity="methods",
                expected_search_type="semantic",
                relevant_docs=["ZMCPTools/src/services/RealFileIndexingService.ts"],
                reasoning="Error handling patterns are implementation concepts"
            )
        ]

    def search_bm25_granular(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """BM25 search optimized for exact matches and identifiers"""
        results = []

        # For exact matches, look for the query as-is
        query_exact = query.strip()
        query_words = re.findall(r'\w+', query.lower())

        for file_path, content in self.file_contents.items():
            score = 0.0

            # Exact string match (highest priority)
            if query_exact in content:
                exact_count = content.count(query_exact)
                score += exact_count * 10.0

            # Function/class definition matches
            if any(pattern in content for pattern in [
                f"function {query_exact}",
                f"class {query_exact}",
                f"const {query_exact}",
                f"export {query_exact}",
                f"def {query_exact}"
            ]):
                score += 20.0

            # Import statement matches
            if f"import" in query.lower() and "import" in content.lower():
                import_lines = [line for line in content.split('\n') if 'import' in line.lower()]
                for line in import_lines:
                    if any(word in line.lower() for word in query_words):
                        score += 15.0

            # Variable/method name matches
            for word in query_words:
                if len(word) > 2:  # Skip very short words
                    # Count occurrences
                    word_count = content.lower().count(word)
                    if word_count > 0:
                        score += word_count * 0.5

                    # Boost for camelCase/snake_case matches
                    camel_patterns = [
                        f"{word}[A-Z]",   # camelCase
                        f"_{word}_",      # snake_case
                        f".{word}\\(",    # method call
                        f"\\[{word}\\]"   # array access
                    ]
                    for pattern in camel_patterns:
                        if re.search(pattern, content):
                            score += 5.0

            # File path relevance
            if any(word in file_path.lower() for word in query_words):
                score += 3.0

            if score > 0:
                results.append({
                    "file_path": file_path,
                    "score": score,
                    "match_type": "bm25_granular"
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def search_old_knowledge_graph_simulation(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Simulate the old knowledge graph search behavior"""
        results = []
        query_words = query.lower().split()

        for file_path, content in self.file_contents.items():
            score = 0.0

            # Simple keyword matching (what the old system likely did)
            content_lower = content.lower()
            for word in query_words:
                if word in content_lower:
                    word_frequency = content_lower.count(word)
                    # Basic TF calculation
                    tf = word_frequency / len(content_lower.split())
                    score += tf * 100

            # Boost for file name matches
            if any(word in file_path.lower() for word in query_words):
                score += 10.0

            if score > 0.1:
                results.append({
                    "file_path": file_path,
                    "score": score,
                    "match_type": "old_knowledge_graph"
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def search_semantic_granular(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Semantic search optimized for concepts and explanations"""
        results = []

        # Extract concepts from query
        query_concepts = self.extract_granular_concepts(query)

        for file_path, content in self.file_contents.items():
            score = 0.0

            # Comment analysis - look for explanatory text
            comment_score = self.analyze_comments_and_docs(content, query_concepts)
            score += comment_score

            # Conceptual pattern matching
            concept_score = self.analyze_conceptual_patterns(content, query_concepts, query)
            score += concept_score

            # Documentation boost
            if file_path.endswith('.md') and self.is_conceptual_query(query):
                score *= 2.0

            # Code comment boost
            if not file_path.endswith('.md'):
                comment_density = self.calculate_comment_density(content)
                if comment_density > 0.1:  # Files with good comments
                    score *= (1 + comment_density)

            if score > 0.1:
                results.append({
                    "file_path": file_path,
                    "score": score,
                    "match_type": "semantic_granular"
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def extract_granular_concepts(self, text: str) -> List[str]:
        """Extract fine-grained concepts from text"""
        concepts = []
        text_lower = text.lower()

        # Search-related concepts
        if any(word in text_lower for word in ['search', 'find', 'query', 'retrieve']):
            concepts.append('search')
        if any(word in text_lower for word in ['rank', 'score', 'relevance', 'fusion']):
            concepts.append('ranking')
        if any(word in text_lower for word in ['semantic', 'vector', 'embedding', 'similarity']):
            concepts.append('semantic')
        if any(word in text_lower for word in ['keyword', 'bm25', 'exact', 'match']):
            concepts.append('keyword')

        # Implementation concepts
        if any(word in text_lower for word in ['async', 'batch', 'process', 'parallel']):
            concepts.append('async_processing')
        if any(word in text_lower for word in ['error', 'try', 'catch', 'handle', 'exception']):
            concepts.append('error_handling')
        if any(word in text_lower for word in ['config', 'setup', 'initialize', 'configure']):
            concepts.append('configuration')

        # Architecture concepts
        if any(word in text_lower for word in ['agent', 'coordinate', 'orchestrate', 'dependency']):
            concepts.append('coordination')
        if any(word in text_lower for word in ['pipeline', 'workflow', 'stage', 'phase']):
            concepts.append('pipeline')

        return concepts

    def analyze_comments_and_docs(self, content: str, query_concepts: List[str]) -> float:
        """Analyze comments and documentation for conceptual matches"""
        score = 0.0

        # Extract comments
        comments = []

        # JavaScript/TypeScript style comments
        comments.extend(re.findall(r'//\s*(.+)', content))
        comments.extend(re.findall(r'/\*\*(.*?)\*/', content, re.DOTALL))
        comments.extend(re.findall(r'/\*(.*?)\*/', content, re.DOTALL))

        # Python style comments
        comments.extend(re.findall(r'#\s*(.+)', content))
        comments.extend(re.findall(r'"""(.*?)"""', content, re.DOTALL))

        # Markdown content (entire content for .md files)
        if any(content.endswith(ext) for ext in ['.md', '.txt']):
            comments.append(content)

        # Analyze comment content for concepts
        for comment in comments:
            comment_lower = comment.lower()
            for concept in query_concepts:
                if concept in comment_lower:
                    score += 2.0

                # Boost for explanatory phrases
                if any(phrase in comment_lower for phrase in [
                    'why', 'how', 'because', 'explanation', 'reason',
                    'algorithm', 'approach', 'strategy', 'pattern'
                ]):
                    score += 1.0

        return score

    def analyze_conceptual_patterns(self, content: str, query_concepts: List[str], original_query: str) -> float:
        """Analyze content for conceptual patterns"""
        score = 0.0
        content_lower = content.lower()
        query_lower = original_query.lower()

        # Look for similar algorithmic patterns
        if 'cosine similarity' in query_lower and any(term in content_lower for term in ['cosine', 'similarity', 'vector', 'dot product']):
            score += 5.0

        if 'reciprocal rank fusion' in query_lower and any(term in content_lower for term in ['rrf', 'rank fusion', 'reciprocal', 'combine']):
            score += 5.0

        if 'batch process' in query_lower and any(term in content_lower for term in ['batch', 'process', 'chunk', 'parallel']):
            score += 5.0

        # Configuration patterns
        if 'configure' in query_lower and any(term in content_lower for term in ['config', 'setup', 'option', 'parameter']):
            score += 3.0

        # Coordination patterns
        if 'coordination' in query_lower and any(term in content_lower for term in ['coordinate', 'orchestrate', 'dependency', 'agent']):
            score += 3.0

        return score

    def calculate_comment_density(self, content: str) -> float:
        """Calculate the density of comments in code"""
        lines = content.split('\n')
        comment_lines = 0

        for line in lines:
            line_stripped = line.strip()
            if (line_stripped.startswith('//') or
                line_stripped.startswith('#') or
                line_stripped.startswith('*') or
                '/*' in line_stripped):
                comment_lines += 1

        if len(lines) == 0:
            return 0.0
        return comment_lines / len(lines)

    def is_conceptual_query(self, query: str) -> bool:
        """Check if query is asking about concepts vs exact matches"""
        conceptual_indicators = [
            'how', 'why', 'what', 'explain', 'understand', 'concept',
            'pattern', 'approach', 'strategy', 'algorithm', 'work'
        ]
        return any(indicator in query.lower() for indicator in conceptual_indicators)

    async def run_granular_benchmark(self) -> Dict[str, Any]:
        """Run benchmark comparing different search approaches across content granularities"""
        print("🔬 Running Granular Search Benchmark")
        print("Comparing: BM25 vs Old Knowledge Graph vs Semantic")
        print("=" * 70)

        queries = self.get_granular_queries()
        results = {}

        for query in queries:
            print(f"\n📋 Query: {query.query_text}")
            print(f"   Granularity: {query.content_granularity}")
            print(f"   Expected: {query.expected_search_type}")
            print(f"   Reasoning: {query.reasoning}")

            # Test all three search methods
            bm25_results = self.search_bm25_granular(query.query_text, 5)
            old_kg_results = self.search_old_knowledge_graph_simulation(query.query_text, 5)
            semantic_results = self.search_semantic_granular(query.query_text, 5)

            # Check which found the relevant documents
            bm25_relevant = len([r for r in bm25_results if r['file_path'] in query.relevant_docs])
            old_kg_relevant = len([r for r in old_kg_results if r['file_path'] in query.relevant_docs])
            semantic_relevant = len([r for r in semantic_results if r['file_path'] in query.relevant_docs])

            print(f"\n   Results:")
            print(f"     BM25: {bm25_relevant}/{len(query.relevant_docs)} relevant")
            print(f"       Top: {[r['file_path'].split('/')[-1] for r in bm25_results[:2]]}")
            print(f"     Old KG: {old_kg_relevant}/{len(query.relevant_docs)} relevant")
            print(f"       Top: {[r['file_path'].split('/')[-1] for r in old_kg_results[:2]]}")
            print(f"     Semantic: {semantic_relevant}/{len(query.relevant_docs)} relevant")
            print(f"       Top: {[r['file_path'].split('/')[-1] for r in semantic_results[:2]]}")

            # Score methods
            bm25_score = bm25_relevant * 10 + (1 if query.expected_search_type == 'bm25' else 0) * 5
            old_kg_score = old_kg_relevant * 10
            semantic_score = semantic_relevant * 10 + (1 if query.expected_search_type == 'semantic' else 0) * 5

            # Find best method
            scores = {'BM25': bm25_score, 'Old_KG': old_kg_score, 'Semantic': semantic_score}
            best_method = max(scores, key=scores.get)

            print(f"   🏆 Best: {best_method} (BM25: {bm25_score}, Old KG: {old_kg_score}, Semantic: {semantic_score})")

            results[query.query_id] = {
                'query': query.query_text,
                'granularity': query.content_granularity,
                'expected_type': query.expected_search_type,
                'bm25_relevant': bm25_relevant,
                'old_kg_relevant': old_kg_relevant,
                'semantic_relevant': semantic_relevant,
                'best_method': best_method,
                'scores': scores
            }

        # Overall analysis
        print(f"\n📊 GRANULAR ANALYSIS")
        print("=" * 70)

        # Count wins by method
        method_wins = {'BM25': 0, 'Old_KG': 0, 'Semantic': 0}
        for result in results.values():
            method_wins[result['best_method']] += 1

        print(f"Overall wins: BM25: {method_wins['BM25']}, Old KG: {method_wins['Old_KG']}, Semantic: {method_wins['Semantic']}")

        # Analyze by granularity
        granularities = {}
        for result in results.values():
            gran = result['granularity']
            if gran not in granularities:
                granularities[gran] = {'BM25': 0, 'Old_KG': 0, 'Semantic': 0}
            granularities[gran][result['best_method']] += 1

        for granularity, wins in granularities.items():
            print(f"\n{granularity.upper()}:")
            print(f"  BM25: {wins['BM25']}, Old KG: {wins['Old_KG']}, Semantic: {wins['Semantic']}")

        recommendation = self.make_granular_recommendation(results, method_wins)
        print(f"\n💡 RECOMMENDATIONS:")
        for rec in recommendation:
            print(f"   {rec}")

        return {
            'results': results,
            'method_wins': method_wins,
            'granularity_analysis': granularities,
            'recommendations': recommendation
        }

    def make_granular_recommendation(self, results: Dict[str, Any], method_wins: Dict[str, int]) -> List[str]:
        """Make granular recommendations based on results"""
        recommendations = []

        # Check if BM25 is clearly better than old KG
        bm25_vs_old_kg = method_wins['BM25'] - method_wins['Old_KG']
        if bm25_vs_old_kg > 2:
            recommendations.append("Replace OLD KNOWLEDGE GRAPH with BM25 for exact matching")

        # Check semantic performance for conceptual queries
        conceptual_queries = [r for r in results.values() if r['expected_type'] == 'semantic']
        semantic_conceptual_wins = len([r for r in conceptual_queries if r['best_method'] == 'Semantic'])

        if semantic_conceptual_wins > len(conceptual_queries) * 0.6:
            recommendations.append("Use SEMANTIC SEARCH for comments, explanations, and concepts")

        # Check BM25 performance for exact matches
        exact_queries = [r for r in results.values() if r['expected_type'] == 'bm25']
        bm25_exact_wins = len([r for r in exact_queries if r['best_method'] == 'BM25'])

        if bm25_exact_wins > len(exact_queries) * 0.6:
            recommendations.append("Use BM25 for function names, classes, variables, imports")

        # Overall architecture recommendation
        if len(recommendations) >= 2:
            recommendations.append("HYBRID ARCHITECTURE: Route queries based on content type and granularity")
            recommendations.append("CPU search: BM25 for exact matches")
            recommendations.append("GPU search: Qwen3 + Reranker for concepts and explanations")

        return recommendations

async def main():
    repository_path = "/home/jw/dev/game1"
    benchmark = GranularSearchBenchmark(repository_path)

    try:
        results = await benchmark.run_granular_benchmark()

        with open("granular_search_benchmark_results.json", 'w') as f:
            import json
            json.dump(results, f, indent=2)

        print(f"\n✅ Granular Search Benchmark completed!")
        print(f"   Results saved to granular_search_benchmark_results.json")

        return 0

    except Exception as e:
        print(f"❌ Benchmark failed: {e}")
        return 1

if __name__ == "__main__":
    exit(asyncio.run(main()))