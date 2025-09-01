#!/usr/bin/env python3
"""Debug semantic search end-to-end"""

import lancedb
import sqlite3
from pathlib import Path
import json

print("=== SEMANTIC SEARCH DEBUG ===\n")

# 1. Check what's in SQLite
db_path = Path.home() / ".mcptools/data/claude_mcp_tools.db"
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# Get our test entities
cursor.execute("""
    SELECT id, entityType, name, description 
    FROM knowledge_entities 
    WHERE name IN ('Authentication System', 'React State Management Pattern', 
                   'Database Connection Error', 'Connection Pool Optimization')
    ORDER BY createdAt DESC
""")

test_entities = cursor.fetchall()
print(f"1. Test entities in SQLite ({len(test_entities)} found):")
entity_ids = []
for entity in test_entities:
    entity_ids.append(entity[0])
    print(f"   ID: {entity[0]}")
    print(f"   Type: {entity[1]}, Name: {entity[2]}")
    print(f"   Desc: {entity[3][:80]}...")
    print()

# 2. Check what's in LanceDB
lance_path = Path.home() / ".mcptools/lancedb"
db = lancedb.connect(str(lance_path))
table = db.open_table("knowledge_graph")

print(f"\n2. Checking LanceDB for these entity IDs...")
df = table.to_pandas()

# Check if our test entities are in LanceDB
for entity_id in entity_ids:
    matches = df[df['id'] == entity_id]
    if len(matches) > 0:
        print(f"   ✅ Found {entity_id} in LanceDB")
        # Show the content that was embedded
        print(f"      Content: {matches.iloc[0]['content'][:100]}...")
        # Check vector exists
        vector = matches.iloc[0]['vector']
        print(f"      Vector: {len(vector)} dimensions, first 5 values: {vector[:5]}")
    else:
        print(f"   ❌ NOT FOUND {entity_id} in LanceDB")

# 3. Try a direct vector search in LanceDB
print(f"\n3. Testing direct vector search in LanceDB...")

# Get a sample vector from our test entity
auth_entity = df[df['content'].str.contains('Authentication', case=False, na=False)]
if len(auth_entity) > 0:
    print(f"   Found {len(auth_entity)} entities with 'Authentication' in content")
    
    # Use the first one's vector for search
    query_vector = auth_entity.iloc[0]['vector']
    print(f"   Using vector from entity: {auth_entity.iloc[0]['id']}")
    
    # Perform vector search
    results = table.search(query_vector).limit(5).to_pandas()
    print(f"\n   Vector search results (top 5):")
    for idx, row in results.iterrows():
        print(f"   {idx+1}. ID: {row['id']}")
        print(f"      Content: {row['content'][:80]}...")
        print(f"      Distance: {row.get('_distance', 'N/A')}")
else:
    print("   ❌ No authentication-related entities found to use as query")

# 4. Check metadata format
print(f"\n4. Checking metadata format in LanceDB...")
sample_metadata = df.iloc[0]['metadata'] if len(df) > 0 else None
if sample_metadata:
    try:
        metadata = json.loads(sample_metadata)
        print(f"   Sample metadata structure: {json.dumps(metadata, indent=2)}")
    except:
        print(f"   Raw metadata: {sample_metadata}")

# 5. Check for repository path issues
print(f"\n5. Checking repository paths...")
if 'metadata' in df.columns:
    repo_paths = set()
    for _, row in df.iterrows():
        try:
            metadata = json.loads(row['metadata'])
            if 'repositoryPath' in metadata:
                repo_paths.add(metadata['repositoryPath'])
        except:
            pass
    print(f"   Found {len(repo_paths)} unique repository paths:")
    for path in repo_paths:
        print(f"   - {path}")

conn.close()
print("\n=== END DEBUG ===")