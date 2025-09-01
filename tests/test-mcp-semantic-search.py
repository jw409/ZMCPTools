#!/usr/bin/env python3
"""Test semantic search through MCP tools to find the issue"""

import subprocess
import json

print("=== TESTING MCP SEMANTIC SEARCH ===\n")

# Test queries
test_queries = [
    {
        "query": "authentication cookies security",
        "desc": "Should find Authentication System entity"
    },
    {
        "query": "database connection pool PostgreSQL",
        "desc": "Should find Database Connection Error and Solution"
    },
    {
        "query": "React state management performance",
        "desc": "Should find React State Management Pattern"
    }
]

for test in test_queries:
    print(f"\nTest: {test['desc']}")
    print(f"Query: '{test['query']}'")
    
    # Call the MCP tool directly using subprocess
    cmd = [
        "uv", "run", "python", "-c",
        f"""
import sys
sys.path.append('/home/jw/dev/game1/ZMCPTools/src')
from database import DatabaseManager
from services.KnowledgeGraphService import KnowledgeGraphService
from services.VectorSearchService import VectorSearchService
import asyncio

async def test():
    # Initialize services
    db = DatabaseManager()
    await db.initialize()
    
    vector_service = VectorSearchService(db)
    await vector_service.initialize()
    
    kg_service = KnowledgeGraphService(db, vector_service)
    
    # Test semantic search
    results = await kg_service.searchEntities({{
        'query': '{test['query']}',
        'useSemanticSearch': True,
        'repositoryPath': '/home/jw/dev/game1',
        'threshold': 0.3,
        'limit': 5
    }})
    
    print(f"Results: {{len(results.get('entities', []))}} entities found")
    for entity in results.get('entities', [])[:3]:
        print(f"  - {{entity['name']}}: {{entity['description'][:60]}}...")
    
    # Also try without repository path filter
    print("\\nTrying without repository path filter...")
    results2 = await kg_service.searchEntities({{
        'query': '{test['query']}',
        'useSemanticSearch': True,
        'threshold': 0.3,
        'limit': 5
    }})
    print(f"Results: {{len(results2.get('entities', []))}} entities found")

asyncio.run(test())
"""
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.stdout:
            print("Output:")
            print(result.stdout)
        if result.stderr:
            print("Errors:")
            print(result.stderr[:500])  # Limit error output
    except subprocess.TimeoutExpired:
        print("❌ Command timed out")
    except Exception as e:
        print(f"❌ Error: {e}")

print("\n=== Testing with lower threshold ===")

# Try one more test with very low threshold
cmd = [
    "node", "-e",
    """
const searchKnowledgeGraph = require('/home/jw/dev/game1/ZMCPTools/dist/index.js').searchKnowledgeGraph;

(async () => {
    try {
        const result = await searchKnowledgeGraph({
            repository_path: '/home/jw/dev/game1',
            query: 'authentication',
            use_semantic_search: true,
            threshold: 0.1,
            limit: 10
        });
        console.log('Search result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    }
})();
"""
]

try:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if result.stdout:
        print("Node.js test output:")
        print(result.stdout)
    if result.stderr:
        print("Node.js test errors:")
        print(result.stderr[:500])
except Exception as e:
    print(f"❌ Node test error: {e}")