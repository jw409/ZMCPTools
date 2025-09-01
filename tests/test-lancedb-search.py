#!/usr/bin/env python3
"""Test LanceDB search directly with embeddings"""

import lancedb
from pathlib import Path
import numpy as np
from transformers import pipeline

print("=== TESTING LANCEDB SEARCH WITH EMBEDDINGS ===\n")

# Connect to LanceDB
db_path = Path.home() / ".mcptools/lancedb"
db = lancedb.connect(str(db_path))
table = db.open_table("knowledge_graph")

# Get data
df = table.to_pandas()
print(f"Total documents in LanceDB: {len(df)}")

# Find our test entities
test_entities = df[df['id'].isin([
    '8e11f818-4420-4c00-8cde-37a96bae8202',  # Authentication System
    'f7cf8bf5-1232-4495-b53d-a29c728bb845',  # Database Connection Error
    '2cabf624-71af-4310-b93d-fa11996eb61f',  # React State Management Pattern
    'b8e1e3dd-05d0-4335-aea7-c2dc93cdfc64'   # Connection Pool Optimization
])]

print(f"\nFound {len(test_entities)} test entities")
for _, row in test_entities.iterrows():
    print(f"  - {row['id']}: {row['content'][:60]}...")

# Load the same embedding model
print("\n1. Loading embedding model...")
model = pipeline('feature-extraction', model='Xenova/all-MiniLM-L6-v2')

# Test queries
test_queries = [
    "authentication security cookies",
    "database connection pool optimization",
    "React state management hooks"
]

for query in test_queries:
    print(f"\n2. Testing query: '{query}'")
    
    # Generate embedding for query
    embedding_result = model(query)
    # Extract the embedding (it's nested in the result)
    query_embedding = np.array(embedding_result[0]).mean(axis=0)  # Mean pooling
    print(f"   Query embedding shape: {query_embedding.shape}")
    
    # Search using LanceDB
    results = table.search(query_embedding).limit(5).to_pandas()
    
    print(f"   Found {len(results)} results:")
    for idx, row in results.iterrows():
        distance = row.get('_distance', 'N/A')
        similarity = 1 - distance if distance != 'N/A' else 'N/A'
        print(f"   {idx+1}. ID: {row['id']}")
        print(f"      Content: {row['content'][:80]}...")
        print(f"      Distance: {distance}, Similarity: {similarity}")
        
    # Check if any are our test entities
    matching_test = results[results['id'].isin(test_entities['id'])]
    if len(matching_test) > 0:
        print(f"   ✅ Found {len(matching_test)} test entities in results!")
    else:
        print(f"   ❌ No test entities found in results")

print("\n=== ANALYSIS ===")
print("The issue is likely that:")
print("1. The embedding model in TypeScript generates different embeddings")
print("2. The similarity threshold is too high (0.7 default)")
print("3. The distance-to-similarity conversion is incorrect")