#!/usr/bin/env python3
"""Test knowledge graph embeddings directly"""

import sqlite3
import json
import os
from pathlib import Path

# Check SQLite database
db_path = Path.home() / ".mcptools/data/claude_mcp_tools.db"
print(f"Checking database: {db_path}")

if db_path.exists():
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    # Check knowledge entities
    cursor.execute("SELECT COUNT(*) FROM knowledge_entities")
    count = cursor.fetchone()[0]
    print(f"Total knowledge entities: {count}")
    
    # Get recent entities
    cursor.execute("""
        SELECT id, entityType, name, description, createdAt 
        FROM knowledge_entities 
        ORDER BY createdAt DESC 
        LIMIT 5
    """)
    
    print("\nRecent entities:")
    for row in cursor.fetchall():
        print(f"  - {row[1]}: {row[2]} (ID: {row[0]})")
        print(f"    Description: {row[3][:100]}...")
        print(f"    Created: {row[4]}")
    
    conn.close()
else:
    print("Database not found!")

# Check LanceDB
lancedb_path = Path.home() / ".mcptools/lancedb/knowledge_graph.lance"
print(f"\nChecking LanceDB: {lancedb_path}")

if lancedb_path.exists():
    print("LanceDB collection exists")
    
    # List files in the collection
    files = list(lancedb_path.glob("*"))
    print(f"Number of files in collection: {len(files)}")
    for f in sorted(files)[:5]:
        print(f"  - {f.name}")
else:
    print("LanceDB collection not found!")

print("\nTo debug further, we need to check if embeddings are being generated when entities are stored.")