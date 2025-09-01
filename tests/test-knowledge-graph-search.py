#!/usr/bin/env python3
"""
Test knowledge graph search functionality
"""

import subprocess
import json

def test_search(query, use_semantic=False, description=""):
    """Test knowledge graph search"""
    print(f"\n{'='*60}")
    print(f"🔍 {description}")
    print(f"Query: '{query}'")
    print(f"Mode: {'Semantic' if use_semantic else 'Basic'}")
    print(f"{'='*60}")
    
    # Prepare the MCP tool call
    tool_args = {
        "repository_path": "/home/jw/dev/game1",
        "query": query,
        "use_semantic_search": use_semantic,
        "include_relationships": False,
        "limit": 5
    }
    
    # Use the Task agent to call the MCP tool
    prompt = f"""Use the mcp__zmcp-tools__search_knowledge_graph tool with these exact parameters:
{json.dumps(tool_args, indent=2)}

Return only the raw tool response, no additional text."""
    
    # Run claude with the prompt
    cmd = ["claude", "-p", prompt]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            print("✅ Search completed successfully")
            print("\nResults:")
            print(result.stdout)
        else:
            print("❌ Search failed")
            print("Error:", result.stderr)
    except Exception as e:
        print(f"❌ Error running search: {e}")

def main():
    print("🧪 Testing Knowledge Graph Search Functionality")
    
    # Test 1: Basic search with query
    test_search(
        "pattern",
        use_semantic=False,
        description="Test 1: Basic text search for 'pattern'"
    )
    
    # Test 2: Basic search with different query
    test_search(
        "integration",
        use_semantic=False,
        description="Test 2: Basic text search for 'integration'"
    )
    
    # Test 3: Basic search that should return nothing
    test_search(
        "nonexistent",
        use_semantic=False,
        description="Test 3: Basic text search for non-existent term"
    )
    
    # Test 4: Semantic search (will fail without vectors)
    test_search(
        "MCP agents TalentOS",
        use_semantic=True,
        description="Test 4: Semantic search (expect no results without re-indexing)"
    )
    
    print("\n" + "="*60)
    print("📊 Test Summary:")
    print("- Basic search should now filter by query text")
    print("- Semantic search needs re-indexing to work")
    print("- To re-index: cd /home/jw/dev/ZMCPTools && tsx /home/jw/dev/game1/reindex-entities.js")

if __name__ == "__main__":
    main()