#!/usr/bin/env python3
"""
Content Type Benchmark
Tests whether semantic search performs better on different file types:
- Code files (.ts, .py, .js) - should favor BM25
- Documentation (.md, .txt) - should favor semantic search
- Configuration (.json, .yaml) - mixed
"""

import asyncio
import os
import re
from pathlib import Path
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass

@dataclass
class ContentTypeQuery:
    query_id: str
    query_text: str
    expected_file_type: str  # 'code', 'docs', 'config'
    relevant_docs: List[str]
    reasoning: str

class ContentTypeBenchmark:
    """Test search performance across different content types"""

    def __init__(self, repository_path: str):
        self.repository_path = Path(repository_path)
        self.file_contents = {}
        self.load_file_contents()

    def load_file_contents(self):
        """Load actual file contents for semantic analysis"""
        print("📁 Loading file contents...")

        for root, dirs, files in os.walk(self.repository_path):
            dirs[:] = [d for d in dirs if d not in ['node_modules', 'dist', 'build', '.git', 'coverage']]

            for file in files:
                if any(file.endswith(ext) for ext in ['.md', '.ts', '.py', '.js', '.json', '.txt']):
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, self.repository_path)

                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()[:5000]  # First 5k chars
                            self.file_contents[rel_path] = content
                    except:
                        pass

        print(f"📄 Loaded content from {len(self.file_contents)} files")

    def get_content_type_queries(self) -> List[ContentTypeQuery]:
        """Queries designed to test different content types"""

        return [
            # Documentation queries - should favor semantic search
            ContentTypeQuery(
                query_id="planning_concept",
                query_text="planning and task management strategies",
                expected_file_type="docs",
                relevant_docs=["CLAUDE.md", "README.md", "docs/unified_search_llm_prompt.md"],
                reasoning="Conceptual content about planning should be found in documentation"
            ),
            ContentTypeQuery(
                query_id="architecture_overview",
                query_text="system architecture and design patterns",
                expected_file_type="docs",
                relevant_docs=["README.md", "CLAUDE.md", "docs/unified_search_llm_prompt.md"],
                reasoning="High-level architecture discussions are in documentation"
            ),
            ContentTypeQuery(
                query_id="usage_instructions",
                query_text="how to use and configure the system",
                expected_file_type="docs",
                relevant_docs=["README_REPRODUCIBLE_BENCHMARK.md", "CLAUDE.md"],
                reasoning="Usage instructions are conceptual and in documentation"
            ),

            # Code queries - should favor BM25
            ContentTypeQuery(
                query_id="function_implementation",
                query_text="searchKnowledgeGraphUnified function implementation",
                expected_file_type="code",
                relevant_docs=["ZMCPTools/src/tools/unifiedSearchTool.ts"],
                reasoning="Exact function names should be found via keyword search"
            ),
            ContentTypeQuery(
                query_id="class_definition",
                query_text="RealFileIndexingService class definition",
                expected_file_type="code",
                relevant_docs=["ZMCPTools/src/services/RealFileIndexingService.ts"],
                reasoning="Exact class names should be found via keyword search"
            ),
            ContentTypeQuery(
                query_id="import_statements",
                query_text="EmbeddingClient import and usage",
                expected_file_type="code",
                relevant_docs=["ZMCPTools/src/services/EmbeddingClient.ts", "ZMCPTools/src/services/RealFileIndexingService.ts"],
                reasoning="Import statements are exact keywords"
            ),

            # Mixed/Configuration queries
            ContentTypeQuery(
                query_id="configuration_setup",
                query_text="service configuration and endpoints",
                expected_file_type="config",
                relevant_docs=["package.json", "CLAUDE.md"],
                reasoning="Configuration can be both keywords and concepts"
            )
        ]

    def search_bm25_content(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """BM25-style search on actual file content"""
        results = []
        query_words = [w.lower() for w in re.findall(r'\w+', query)]

        for file_path, content in self.file_contents.items():
            content_lower = content.lower()

            # Calculate keyword density score
            score = 0.0
            for word in query_words:
                # Count occurrences in content
                word_count = content_lower.count(word)
                if word_count > 0:
                    # TF-IDF approximation
                    tf = word_count / len(content_lower.split())
                    score += tf * 10  # Boost for multiple occurrences

                # Boost for filename matches
                if word in file_path.lower():
                    score += 2.0

                # Boost for title/header matches in MD files
                if file_path.endswith('.md'):
                    lines = content.split('\n')[:10]  # First 10 lines
                    for line in lines:
                        if word in line.lower() and ('#' in line or line.isupper()):
                            score += 1.5

            if score > 0:
                results.append({
                    "file_path": file_path,
                    "score": score,
                    "match_type": "bm25_content",
                    "content_type": self.classify_file_type(file_path)
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def search_semantic_content(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Semantic search on file content"""
        results = []

        # Semantic concepts to look for
        query_concepts = self.extract_semantic_concepts(query)

        for file_path, content in self.file_contents.items():
            score = 0.0

            # Look for semantic concepts rather than exact keywords
            content_concepts = self.extract_semantic_concepts(content)

            # Calculate concept overlap
            for query_concept in query_concepts:
                for content_concept in content_concepts:
                    if self.concepts_related(query_concept, content_concept):
                        score += 1.0

            # Boost for documentation files when query is conceptual
            if self.is_conceptual_query(query) and file_path.endswith('.md'):
                score *= 2.0

            # Penalize code files for conceptual queries
            if self.is_conceptual_query(query) and self.classify_file_type(file_path) == 'code':
                score *= 0.3

            if score > 0.1:
                results.append({
                    "file_path": file_path,
                    "score": score,
                    "match_type": "semantic_content",
                    "content_type": self.classify_file_type(file_path)
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def extract_semantic_concepts(self, text: str) -> List[str]:
        """Extract semantic concepts from text"""
        # Simple concept extraction - look for key themes
        concepts = []

        # Planning and management concepts
        if any(word in text.lower() for word in ['plan', 'strategy', 'manage', 'organize', 'workflow']):
            concepts.append('planning')

        # Architecture concepts
        if any(word in text.lower() for word in ['architecture', 'design', 'pattern', 'structure', 'system']):
            concepts.append('architecture')

        # Search concepts
        if any(word in text.lower() for word in ['search', 'query', 'find', 'retrieve', 'index']):
            concepts.append('search')

        # Implementation concepts
        if any(word in text.lower() for word in ['implement', 'function', 'class', 'method', 'code']):
            concepts.append('implementation')

        # Configuration concepts
        if any(word in text.lower() for word in ['config', 'setup', 'endpoint', 'service', 'port']):
            concepts.append('configuration')

        # Documentation concepts
        if any(word in text.lower() for word in ['usage', 'how to', 'guide', 'instruction', 'tutorial']):
            concepts.append('documentation')

        return concepts

    def concepts_related(self, concept1: str, concept2: str) -> bool:
        """Check if two concepts are semantically related"""
        # Simple semantic relationships
        relationships = {
            'planning': ['architecture', 'documentation'],
            'architecture': ['planning', 'implementation'],
            'search': ['implementation', 'configuration'],
            'implementation': ['search', 'configuration'],
            'configuration': ['search', 'implementation'],
            'documentation': ['planning', 'architecture']
        }

        return concept1 == concept2 or concept2 in relationships.get(concept1, [])

    def is_conceptual_query(self, query: str) -> bool:
        """Determine if a query is conceptual vs specific"""
        conceptual_indicators = [
            'strategy', 'pattern', 'approach', 'how to', 'design',
            'architecture', 'overview', 'concept', 'planning'
        ]
        return any(indicator in query.lower() for indicator in conceptual_indicators)

    def classify_file_type(self, file_path: str) -> str:
        """Classify file into content type"""
        if any(file_path.endswith(ext) for ext in ['.md', '.txt', '.rst']):
            return 'docs'
        elif any(file_path.endswith(ext) for ext in ['.ts', '.js', '.py', '.java', '.cpp']):
            return 'code'
        elif any(file_path.endswith(ext) for ext in ['.json', '.yaml', '.yml', '.xml']):
            return 'config'
        else:
            return 'other'

    def analyze_results_by_content_type(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze which content types were returned"""
        type_counts = {'docs': 0, 'code': 0, 'config': 0, 'other': 0}

        for result in results:
            content_type = result.get('content_type', 'other')
            type_counts[content_type] += 1

        total = len(results)
        type_percentages = {k: (v/total*100 if total > 0 else 0) for k, v in type_counts.items()}

        return {
            'counts': type_counts,
            'percentages': type_percentages,
            'top_files': [r['file_path'] for r in results[:5]]
        }

    async def run_content_type_benchmark(self) -> Dict[str, Any]:
        """Run benchmark comparing search methods on different content types"""
        print("🔬 Running Content Type Search Benchmark")
        print("Testing: BM25 vs Semantic on Code vs Documentation")
        print("=" * 60)

        queries = self.get_content_type_queries()
        results = {}

        for query in queries:
            print(f"\n📋 Query: {query.query_text}")
            print(f"   Expected: {query.expected_file_type} files")
            print(f"   Reasoning: {query.reasoning}")

            # Test both search methods
            bm25_results = self.search_bm25_content(query.query_text, 10)
            semantic_results = self.search_semantic_content(query.query_text, 10)

            # Analyze content type distribution
            bm25_analysis = self.analyze_results_by_content_type(bm25_results)
            semantic_analysis = self.analyze_results_by_content_type(semantic_results)

            # Check relevance
            bm25_relevant = len([r for r in bm25_results if r['file_path'] in query.relevant_docs])
            semantic_relevant = len([r for r in semantic_results if r['file_path'] in query.relevant_docs])

            print(f"\n   BM25 Results:")
            print(f"     Content Types: {bm25_analysis['percentages']}")
            print(f"     Relevant Files Found: {bm25_relevant}/{len(query.relevant_docs)}")
            print(f"     Top Files: {bm25_analysis['top_files'][:3]}")

            print(f"\n   Semantic Results:")
            print(f"     Content Types: {semantic_analysis['percentages']}")
            print(f"     Relevant Files Found: {semantic_relevant}/{len(query.relevant_docs)}")
            print(f"     Top Files: {semantic_analysis['top_files'][:3]}")

            # Determine winner
            expected_type = query.expected_file_type
            bm25_score = bm25_analysis['percentages'].get(expected_type, 0) + (bm25_relevant * 20)
            semantic_score = semantic_analysis['percentages'].get(expected_type, 0) + (semantic_relevant * 20)

            winner = "BM25" if bm25_score > semantic_score else "Semantic"
            print(f"   🏆 Winner: {winner} (BM25: {bm25_score:.1f}, Semantic: {semantic_score:.1f})")

            results[query.query_id] = {
                'query': query.query_text,
                'expected_type': expected_type,
                'bm25_analysis': bm25_analysis,
                'semantic_analysis': semantic_analysis,
                'bm25_relevant': bm25_relevant,
                'semantic_relevant': semantic_relevant,
                'winner': winner,
                'bm25_score': bm25_score,
                'semantic_score': semantic_score
            }

        # Overall analysis
        print(f"\n📊 OVERALL ANALYSIS")
        print("=" * 60)

        winners = [r['winner'] for r in results.values()]
        bm25_wins = winners.count('BM25')
        semantic_wins = winners.count('Semantic')

        print(f"BM25 Wins: {bm25_wins}")
        print(f"Semantic Wins: {semantic_wins}")

        # Analyze by content type
        for content_type in ['docs', 'code', 'config']:
            type_queries = [r for r in results.values() if r['expected_type'] == content_type]
            if type_queries:
                type_winners = [q['winner'] for q in type_queries]
                bm25_type_wins = type_winners.count('BM25')
                semantic_type_wins = type_winners.count('Semantic')
                print(f"\n{content_type.upper()} files:")
                print(f"  BM25 wins: {bm25_type_wins}/{len(type_queries)}")
                print(f"  Semantic wins: {semantic_type_wins}/{len(type_queries)}")

        recommendation = self.make_recommendation(results)
        print(f"\n💡 RECOMMENDATION:")
        print(f"   {recommendation}")

        return {
            'results': results,
            'summary': {
                'bm25_wins': bm25_wins,
                'semantic_wins': semantic_wins,
                'recommendation': recommendation
            }
        }

    def make_recommendation(self, results: Dict[str, Any]) -> str:
        """Make a recommendation based on results"""
        doc_queries = [r for r in results.values() if r['expected_type'] == 'docs']
        code_queries = [r for r in results.values() if r['expected_type'] == 'code']

        doc_semantic_wins = len([q for q in doc_queries if q['winner'] == 'Semantic'])
        code_bm25_wins = len([q for q in code_queries if q['winner'] == 'BM25'])

        if doc_semantic_wins > len(doc_queries) * 0.6 and code_bm25_wins > len(code_queries) * 0.6:
            return "Use HYBRID: BM25 for code, Semantic for documentation"
        elif len([r for r in results.values() if r['winner'] == 'BM25']) > len(results) * 0.7:
            return "Use BM25 ONLY: Consistently outperforms semantic search"
        else:
            return "Results inconclusive - need more testing"

async def main():
    repository_path = "/home/jw/dev/game1"
    benchmark = ContentTypeBenchmark(repository_path)

    try:
        results = await benchmark.run_content_type_benchmark()

        with open("content_type_benchmark_results.json", 'w') as f:
            import json
            json.dump(results, f, indent=2)

        print(f"\n✅ Content Type Benchmark completed!")
        print(f"   Results saved to content_type_benchmark_results.json")

        return 0

    except Exception as e:
        print(f"❌ Benchmark failed: {e}")
        return 1

if __name__ == "__main__":
    exit(asyncio.run(main()))