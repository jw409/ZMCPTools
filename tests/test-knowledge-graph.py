#!/usr/bin/env python3
"""
Test script for knowledge graph functionality
"""

import json
import subprocess
import time

def run_mcp_tool(tool_name, params):
    """Run an MCP tool and return the result"""
    
    command_map = {
        "store_knowledge_memory": ("memory", "store"),
        "search_knowledge_graph": ("memory", "search")
    }
    
    if tool_name not in command_map:
        print(f"Unknown tool: {tool_name}")
        return None
        
    command, action = command_map[tool_name]
    
    # Base command
    cmd = ['uv', 'run', 'python', 'talent-os/bin/run_zmcp.py', command, action]
    
    # Convert params dict to list of CLI args
    for key, value in params.items():
        arg_key = f"--{key.replace('_', '-')}"
        cmd.append(arg_key)
        # Handle boolean flags that don't have a value
        if isinstance(value, bool) and value is True:
            continue
        cmd.append(str(value))

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.stdout:
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                print(f"Non-JSON output from {tool_name}: {result.stdout}")
                return None
        if result.returncode != 0:
            print(f"Error running {tool_name}: {result.stderr}")
            return None
        return None
    except Exception as e:
        print(f"Exception running {tool_name}: {e}")
        return None

def test_knowledge_graph():
    """Test knowledge graph store and search functionality"""
    
    print("🧪 Testing Knowledge Graph Functionality\n")
    
    # Test 1: Store some knowledge memories
    print("1. Storing test knowledge memories...")
    
    test_memories = [
        {
            "memory_type": "technical_decision",
            "title": "Database Choice PostgreSQL",
            "content": "We chose PostgreSQL for the user data because it has excellent JSON support and scales well with our expected load of 10k users"
        },
        {
            "memory_type": "error_pattern",
            "title": "React useState Loop Issue",
            "content": "useState hooks in UserDashboard component caused infinite re-renders when updating nested objects. Solution: use useReducer instead"
        },
        {
            "memory_type": "implementation_pattern",
            "title": "Authentication Flow JWT",
            "content": "JWT tokens stored in httpOnly cookies with CSRF protection provides the best security for our SPA architecture"
        },
        {
            "memory_type": "optimization",
            "title": "Image Loading Performance",
            "content": "Lazy loading images with Intersection Observer API reduced initial page load by 40%. Critical for mobile users"
        }
    ]
    
    for memory in test_memories:
        params = {
            "key": memory["title"],
            "value": json.dumps(memory) # Store the whole object as a JSON string
        }
        
        result = run_mcp_tool("store_knowledge_memory", params)
        if result and result.get('success'):
            print(f"  ✅ Stored: {memory['title']}")
        else:
            print(f"  ❌ Failed to store: {memory['title']}")
            print(f"     Reason: {result.get('error') if result else 'Unknown'}")

    print("\n2. Testing basic search (text matching)...")
    
    basic_searches = [
        ("PostgreSQL", "Should find database decision"),
        ("useState", "Should find React error pattern"),
        ("JWT", "Should find authentication pattern"),
        ("performance", "Should find optimization note"),
        ("nonexistent", "Should find nothing")
    ]
    
    for query, description in basic_searches:
        params = {
            "query": query
        }
        
        result = run_mcp_tool("search_knowledge_graph", params)
        if result and 'entities' in result:
            count = len(result['entities'])
            print(f"  Query '{query}': Found {count} results - {description}")
            if count > 0:
                print(f"    First result: {result['entities'][0].get('name', 'Unknown')}")
        else:
            print(f"  Query '{query}': Error or no results")

    print("\n3. Testing semantic search (vector similarity)...")
    
    semantic_searches = [
        ("database selection criteria", "Should find PostgreSQL decision"),
        ("React component rendering issues", "Should find useState loop"),
        ("security best practices", "Should find JWT authentication"),
        ("web performance optimization", "Should find image loading"),
        ("how to make pizza", "Should find nothing relevant")
    ]
    
    for query, description in semantic_searches:
        params = {
            "query": query,
            "semantic_search": True,
            "limit": 2
        }
        
        result = run_mcp_tool("search_knowledge_graph", params)
        if result and 'entities' in result:
            count = len(result['entities'])
            print(f"  Query '{query}': Found {count} results - {description}")
            if count > 0 and 'score' in result['entities'][0]:
                print(f"    Best match: {result['entities'][0].get('name', 'Unknown')} (score: {result['entities'][0]['score']:.3f})")
        else:
            print(f"  Query '{query}': Error or no results")

    print("\n4. Testing entity relationships...")
    print("  (Skipping relationship test - not supported by this tool)")
    
    print("\n✅ Knowledge Graph Test Complete!")

if __name__ == "__main__":
    test_knowledge_graph()