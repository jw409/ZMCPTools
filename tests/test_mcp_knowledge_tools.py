#!/usr/bin/env python3
"""
Test MCP knowledge graph tools via claude CLI
This demonstrates the proper way to use store_knowledge_memory and search_knowledge_graph
"""

import subprocess
import json
import time

def call_mcp_tool(tool_name, args):
    """Call an MCP tool via claude CLI"""
    prompt = f"""Use the {tool_name} tool with these exact parameters:
{json.dumps(args, indent=2)}

Return only the raw tool response as JSON, no additional text."""
    
    cmd = ["claude", "-p", prompt]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return True, result.stdout.strip()
        else:
            return False, result.stderr
    except Exception as e:
        return False, str(e)

def store_test_memory(agent_id, memory_type, title, content):
    """Store a memory using MCP tools"""
    print(f"\n📝 Storing: {title}")
    
    args = {
        "repository_path": "/home/jw/dev/game1",
        "agent_id": agent_id,
        "memory_type": memory_type,
        "title": title,
        "content": content,
        "tags": ["test", "knowledge-graph", memory_type],
        "context": {
            "test_run": True,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        }
    }
    
    success, response = call_mcp_tool("mcp__zmcp-tools__store_knowledge_memory", args)
    
    if success:
        print(f"  ✅ Stored successfully")
        print(f"  Response: {response[:100]}...")
    else:
        print(f"  ❌ Failed to store: {response}")
    
    return success

def search_knowledge(query, use_semantic=False):
    """Search knowledge using MCP tools"""
    print(f"\n🔍 Searching for: '{query}' ({'Semantic' if use_semantic else 'Basic'} mode)")
    
    args = {
        "repository_path": "/home/jw/dev/game1",
        "query": query,
        "use_semantic_search": use_semantic,
        "include_relationships": True,
        "limit": 5
    }
    
    success, response = call_mcp_tool("mcp__zmcp-tools__search_knowledge_graph", args)
    
    if success:
        print(f"  ✅ Search completed")
        try:
            # Try to parse and display results nicely
            data = json.loads(response)
            if isinstance(data, dict):
                if "memories" in data:
                    print(f"  Found {len(data['memories'])} memories:")
                    for mem in data['memories'][:3]:
                        print(f"    • {mem.get('title', 'No title')} ({mem.get('memoryType', 'unknown')})")
                if "entities" in data:
                    print(f"  Found {len(data['entities'])} entities:")
                    for ent in data['entities'][:3]:
                        print(f"    • {ent.get('name', 'No name')} ({ent.get('entityType', 'unknown')})")
            else:
                print(f"  Raw response: {response[:200]}...")
        except json.JSONDecodeError:
            print(f"  Raw response: {response[:200]}...")
    else:
        print(f"  ❌ Search failed: {response}")
    
    return success

def main():
    print("🧪 Testing MCP Knowledge Graph Tools via Claude CLI")
    print("="*60)
    
    agent_id = "mcp-test-agent"
    
    # Phase 1: Store test memories
    print("\n📚 Phase 1: Storing Knowledge Memories")
    
    test_memories = [
        ("technical_insight", "MCP Agent Architecture", 
         "MCP agents use a foundation session ID for cost optimization. Sharing sessions across agents can reduce costs by 85-90%."),
        ("implementation_pattern", "Multi-Agent Orchestration", 
         "Use orchestrate_objective() for complex tasks requiring 3+ steps. Single agents are for simple operations only."),
        ("best_practice", "Knowledge Graph Usage", 
         "Always search existing knowledge before implementing. Store insights immediately when discovered."),
        ("error_pattern", "Agent Communication Failures", 
         "Agents may fail to communicate if not in the same room. Always use join_room() before send_message()."),
        ("architecture_decision", "TalentOS Integration", 
         "TalentOS provides the execution layer while MCP tools handle orchestration and knowledge management.")
    ]
    
    stored_count = 0
    for memory_type, title, content in test_memories:
        if store_test_memory(agent_id, memory_type, title, content):
            stored_count += 1
        time.sleep(1)  # Small delay between calls
    
    print(f"\n✅ Stored {stored_count}/{len(test_memories)} memories successfully")
    
    # Phase 2: Search for memories
    print("\n\n📚 Phase 2: Searching Knowledge Graph")
    
    search_queries = [
        ("MCP", False),
        ("agent", False),
        ("cost optimization", False),
        ("orchestration", False),
        ("TalentOS", False),
        ("multi-agent coordination", True)  # Try semantic search
    ]
    
    search_count = 0
    for query, use_semantic in search_queries:
        if search_knowledge(query, use_semantic):
            search_count += 1
        time.sleep(1)  # Small delay between calls
    
    print(f"\n✅ Completed {search_count}/{len(search_queries)} searches successfully")
    
    # Summary
    print("\n" + "="*60)
    print("📊 Test Summary:")
    print(f"  - Stored {stored_count} knowledge memories")
    print(f"  - Performed {search_count} searches")
    print("\n💡 Key Insights:")
    print("  1. MCP tools are accessed via claude CLI with specific tool names")
    print("  2. Tool names follow pattern: mcp__zmcp-tools__<function_name>")
    print("  3. Both basic and semantic search are supported")
    print("  4. Knowledge is persisted in ~/.mcptools/data/claude_mcp_tools.db")
    print("\n🚀 Next Steps:")
    print("  1. Re-index for better semantic search: cd /home/jw/dev/ZMCPTools && tsx reindex-entities.js")
    print("  2. Use these tools in production via claude CLI")
    print("  3. Integrate with multi-agent orchestration workflows")

if __name__ == "__main__":
    main()