#!/usr/bin/env python3
"""
Direct test of knowledge graph functionality by interacting with the MCP tools database
"""

import sqlite3
import json
import uuid
from datetime import datetime
import os

DB_PATH = os.path.expanduser("~/.mcptools/data/claude_mcp_tools.db")

def store_knowledge_memory(repo_path, agent_id, memory_type, title, content):
    """Store a knowledge memory in the database"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    memory_id = str(uuid.uuid4())
    timestamp = datetime.now().isoformat()
    
    # Insert into memories table with correct schema
    cursor.execute("""
        INSERT INTO memories (
            id, repositoryPath, agentId, memoryType, title, content,
            tags, context, confidence, relevanceScore
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        memory_id, repo_path, agent_id, memory_type, title, content,
        json.dumps(["test", "knowledge-graph"]), 
        json.dumps({"test": True, "timestamp": timestamp}),
        0.8, 1.0
    ))
    
    conn.commit()
    conn.close()
    return memory_id

def search_knowledge_basic(repo_path, query):
    """Search knowledge with basic text search"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Search in memories
    cursor.execute("""
        SELECT id, title, content, memoryType, confidence, createdAt
        FROM memories
        WHERE repositoryPath = ? 
        AND (title LIKE ? OR content LIKE ?)
        ORDER BY confidence DESC, createdAt DESC
        LIMIT 10
    """, (repo_path, f"%{query}%", f"%{query}%"))
    
    memories = cursor.fetchall()
    
    # Search in knowledge_entities
    cursor.execute("""
        SELECT id, name, description, entityType, importanceScore
        FROM knowledge_entities
        WHERE repositoryPath = ?
        AND (name LIKE ? OR description LIKE ?)
        ORDER BY importanceScore DESC
        LIMIT 10
    """, (repo_path, f"%{query}%", f"%{query}%"))
    
    entities = cursor.fetchall()
    
    conn.close()
    return memories, entities

def list_all_knowledge(repo_path):
    """List all knowledge for a repository"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Count memories
    cursor.execute("""
        SELECT COUNT(*) FROM memories WHERE repositoryPath = ?
    """, (repo_path,))
    memory_count = cursor.fetchone()[0]
    
    # Count entities
    cursor.execute("""
        SELECT COUNT(*) FROM knowledge_entities WHERE repositoryPath = ?
    """, (repo_path,))
    entity_count = cursor.fetchone()[0]
    
    # Get recent memories
    cursor.execute("""
        SELECT id, title, memoryType, createdAt 
        FROM memories 
        WHERE repositoryPath = ?
        ORDER BY createdAt DESC
        LIMIT 5
    """, (repo_path,))
    recent_memories = cursor.fetchall()
    
    conn.close()
    return memory_count, entity_count, recent_memories

def main():
    repo_path = "/home/jw/dev/game1"
    agent_id = "test-agent-" + str(uuid.uuid4())[:8]
    
    print("🧪 Testing Knowledge Graph Direct Database Access")
    print(f"Database: {DB_PATH}")
    print(f"Repository: {repo_path}")
    print(f"Agent ID: {agent_id}")
    print("="*60)
    
    # Check current state
    print("\n📊 Current Knowledge State:")
    mem_count, ent_count, recent = list_all_knowledge(repo_path)
    print(f"  - Knowledge memories: {mem_count}")
    print(f"  - Knowledge entities: {ent_count}")
    if recent:
        print("  - Recent memories:")
        for mem in recent:
            print(f"    • {mem[1]} ({mem[2]}) - {mem[3]}")
    
    # Store test memories
    print("\n📝 Storing Test Knowledge Memories...")
    
    test_data = [
        ("technical_decision", "Database Choice for Game State", 
         "Decided to use SQLite for local game state storage with JSON columns for flexibility. This allows offline play and easy synchronization."),
        ("implementation_pattern", "React State Management Pattern", 
         "Using React Context API with useReducer for global game state. This pattern scales better than useState for complex state logic."),
        ("error_pattern", "WebSocket Connection Issues", 
         "Found that WebSocket connections drop after 30 seconds of inactivity. Implemented heartbeat mechanism to maintain connection."),
        ("best_practice", "Testing Strategy for Game Logic", 
         "Unit test game mechanics separately from UI. Use integration tests for player actions and state transitions."),
        ("architecture_decision", "Microservices vs Monolith", 
         "Chose monolithic architecture for MVP to reduce complexity. Plan to extract services once we reach 10k users.")
    ]
    
    stored_ids = []
    for memory_type, title, content in test_data:
        memory_id = store_knowledge_memory(repo_path, agent_id, memory_type, title, content)
        stored_ids.append(memory_id)
        print(f"  ✅ Stored: {title} (ID: {memory_id[:8]}...)")
    
    # Test searches
    print("\n🔍 Testing Basic Search...")
    
    search_terms = ["game state", "React", "WebSocket", "testing", "architecture", "pattern"]
    
    for term in search_terms:
        memories, entities = search_knowledge_basic(repo_path, term)
        print(f"\n  Query: '{term}'")
        print(f"  Found {len(memories)} memories, {len(entities)} entities")
        
        if memories:
            print("  Memories:")
            for mem in memories[:3]:
                print(f"    • {mem[1]} ({mem[3]}) - Score: {mem[4]}")
                print(f"      Preview: {mem[2][:100]}...")
        
        if entities:
            print("  Entities:")
            for ent in entities[:3]:
                print(f"    • {ent[1]} ({ent[3]}) - Score: {ent[4]}")
    
    # Final state
    print("\n📊 Final Knowledge State:")
    mem_count, ent_count, recent = list_all_knowledge(repo_path)
    print(f"  - Knowledge memories: {mem_count} (added {len(test_data)})")
    print(f"  - Knowledge entities: {ent_count}")
    
    print("\n✅ Test completed successfully!")
    print("\n💡 Next steps:")
    print("  1. Use MCP tools via claude CLI for production use")
    print("  2. Re-index for semantic search: cd /home/jw/dev/ZMCPTools && tsx reindex-entities.js")
    print("  3. Check ~/.mcptools/data/claude_mcp_tools.db for stored data")

if __name__ == "__main__":
    main()