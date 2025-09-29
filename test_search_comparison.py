#!/usr/bin/env python3

import sqlite3
import time
import sys

def analyze_search_patterns():
    """Quick analysis of search patterns using the knowledge graph database"""

    db_path = "/home/jw/.mcptools/data/claude_mcp_tools.db"

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        print("🔍 Quick Search Pattern Analysis")
        print("=" * 40)

        # Get entity type distribution
        cursor.execute("""
            SELECT entityType, count(*) as count
            FROM knowledge_entities
            GROUP BY entityType
            ORDER BY count DESC
        """)

        types = cursor.fetchall()
        print(f"\n📊 Entity Distribution ({sum(t[1] for t in types)} total):")
        for entity_type, count in types[:8]:
            print(f"  {entity_type}: {count}")

        # Test code-like queries
        code_queries = [
            "bootstrap_layer1.py",
            "start_embedding_service",
            "knowledge_entities",
            "StateManager"
        ]

        print(f"\n📝 CODE QUERY PATTERNS:")
        print("-" * 30)

        code_exact_matches = 0
        code_partial_matches = 0

        for query in code_queries:
            # Test exact name matching
            cursor.execute("""
                SELECT name, entityType FROM knowledge_entities
                WHERE name = ? LIMIT 1
            """, (query,))
            exact = cursor.fetchone()

            # Test partial matching
            cursor.execute("""
                SELECT name, entityType FROM knowledge_entities
                WHERE name LIKE ? OR description LIKE ?
                LIMIT 3
            """, (f"%{query}%", f"%{query}%"))
            partial = cursor.fetchall()

            if exact:
                code_exact_matches += 1
                print(f"  ✅ '{query}' → EXACT: {exact[0]} ({exact[1]})")
            elif partial:
                code_partial_matches += 1
                print(f"  ⚠️  '{query}' → PARTIAL: {len(partial)} matches")
                for p in partial[:2]:
                    print(f"      - {p[0]} ({p[1]})")
            else:
                print(f"  ❌ '{query}' → NO MATCHES")

        # Test documentation queries
        doc_queries = [
            "embedding strategy",
            "monitoring guide",
            "security practices",
            "installation"
        ]

        print(f"\n📚 DOCUMENTATION QUERY PATTERNS:")
        print("-" * 35)

        doc_matches = 0

        for query in doc_queries:
            cursor.execute("""
                SELECT name, entityType, description FROM knowledge_entities
                WHERE (name LIKE ? OR description LIKE ?)
                AND entityType = 'documentation'
                LIMIT 3
            """, (f"%{query}%", f"%{query}%"))
            results = cursor.fetchall()

            if results:
                doc_matches += 1
                print(f"  ✅ '{query}' → {len(results)} documentation matches")
                for r in results[:2]:
                    print(f"      - {r[0]}")
            else:
                print(f"  ❌ '{query}' → NO MATCHES")

        # Analysis and recommendations
        print(f"\n🎯 ANALYSIS:")
        print("-" * 15)

        code_success_rate = (code_exact_matches + code_partial_matches) / len(code_queries) * 100
        doc_success_rate = doc_matches / len(doc_queries) * 100

        print(f"Code queries success: {code_success_rate:.0f}% ({code_exact_matches} exact, {code_partial_matches} partial)")
        print(f"Doc queries success: {doc_success_rate:.0f}%")

        print(f"\n💡 RECOMMENDATIONS:")
        print("-" * 20)

        if code_exact_matches > 0:
            print("✅ Code queries benefit from EXACT matching (BM25)")
            print("   → Use 70-80% BM25 weight for file/function/class queries")

        if doc_matches > 0:
            print("✅ Documentation queries found in semantic content")
            print("   → Use 70-80% semantic weight for concept/guide queries")

        print(f"\n🚨 CURRENT HYBRID SEARCH ISSUE:")
        print("   Fixed 70% semantic / 30% BM25 is suboptimal")
        print("   Need CONTENT-AWARE weighting:")
        print("   • Code patterns (camelCase, .py, functions) → BM25 priority")
        print("   • Natural language (how to, guide, strategy) → Semantic priority")

        # Check if entities have good descriptions for semantic search
        cursor.execute("""
            SELECT count(*) as total,
                   sum(case when description is not null and length(description) > 10 then 1 else 0 end) as with_desc
            FROM knowledge_entities
        """)
        desc_stats = cursor.fetchone()

        desc_percentage = (desc_stats[1] / desc_stats[0]) * 100 if desc_stats[0] > 0 else 0
        print(f"\n📈 SEMANTIC POTENTIAL:")
        print(f"   {desc_percentage:.0f}% of entities have good descriptions")

        if desc_percentage > 50:
            print("   → Semantic search should work well for descriptive queries")
        else:
            print("   → Limited semantic potential, BM25 may be more reliable")

        conn.close()

    except Exception as e:
        print(f"❌ Error: {e}")
        return False

    return True

if __name__ == '__main__':
    analyze_search_patterns()