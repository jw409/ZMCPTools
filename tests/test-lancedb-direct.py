#!/usr/bin/env python3
"""Test LanceDB directly to see if embeddings exist"""

import lancedb
from pathlib import Path

# Connect to LanceDB
db_path = Path.home() / ".mcptools/lancedb"
print(f"Connecting to LanceDB at: {db_path}")

try:
    # Connect to the database
    db = lancedb.connect(str(db_path))
    
    # List tables
    tables = db.table_names()
    print(f"\nTables in LanceDB: {tables}")
    
    if "knowledge_graph" in tables:
        # Open the knowledge_graph table
        table = db.open_table("knowledge_graph")
        
        # Get table info
        print(f"\nTable schema:")
        print(table.schema)
        
        # Count rows
        count = table.count_rows()
        print(f"\nTotal rows in knowledge_graph table: {count}")
        
        # Try to get a few rows
        if count > 0:
            print("\nSample data (first 3 rows):")
            df = table.to_pandas()
            print(df.head(3))
            
            # Check if embeddings exist
            if "vector" in df.columns or "embedding" in df.columns:
                print("\n✅ Embeddings column found!")
                embedding_col = "vector" if "vector" in df.columns else "embedding"
                print(f"Embedding dimension: {len(df[embedding_col].iloc[0]) if len(df) > 0 else 'N/A'}")
            else:
                print("\n❌ No embeddings column found!")
                print(f"Available columns: {list(df.columns)}")
        else:
            print("\n⚠️  Table is empty!")
    else:
        print("\n❌ knowledge_graph table not found!")
        
except Exception as e:
    print(f"\nError connecting to LanceDB: {e}")
    print("\nThis might mean:")
    print("1. LanceDB Python package is not installed")
    print("2. The database is corrupted")
    print("3. Permission issues")