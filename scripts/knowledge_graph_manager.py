#!/usr/bin/env python3
"""
Knowledge Graph Management Script for ZMCP
Provides forward migration, editing, flushing, and repopulation capabilities
"""

import sqlite3
import json
import sys
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any

class KnowledgeGraphManager:
    def __init__(self, db_path: str = None):
        """Initialize with database path"""
        if not db_path:
            db_path = Path.home() / ".mcptools/data/claude_mcp_tools.db"
        self.db_path = db_path
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        
    def backup(self, backup_path: str = None):
        """Create backup of current knowledge graph"""
        if not backup_path:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = f"knowledge_graph_backup_{timestamp}.json"
            
        entities = self.export_entities()
        relationships = self.export_relationships()
        
        backup_data = {
            "timestamp": datetime.now().isoformat(),
            "entity_count": len(entities),
            "relationship_count": len(relationships),
            "entities": entities,
            "relationships": relationships
        }
        
        with open(backup_path, 'w') as f:
            json.dump(backup_data, f, indent=2)
            
        print(f"✅ Backup created: {backup_path}")
        print(f"   Entities: {len(entities)}")
        print(f"   Relationships: {len(relationships)}")
        return backup_path
    
    def export_entities(self) -> List[Dict]:
        """Export all entities"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM knowledge_entities 
            ORDER BY createdAt DESC
        """)
        
        entities = []
        for row in cursor.fetchall():
            entity = dict(row)
            # Parse JSON fields
            if entity.get('properties'):
                try:
                    entity['properties'] = json.loads(entity['properties'])
                except:
                    pass
            entities.append(entity)
        return entities
    
    def export_relationships(self) -> List[Dict]:
        """Export all relationships"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM knowledge_relationships 
            ORDER BY createdAt DESC
        """)
        
        relationships = []
        for row in cursor.fetchall():
            rel = dict(row)
            # Parse JSON fields
            if rel.get('properties'):
                try:
                    rel['properties'] = json.loads(rel['properties'])
                except:
                    pass
            relationships.append(rel)
        return relationships
    
    def flush(self, confirm: bool = False):
        """Flush all data from knowledge graph"""
        if not confirm:
            response = input("⚠️ This will DELETE all knowledge graph data. Type 'yes' to confirm: ")
            if response.lower() != 'yes':
                print("Aborted.")
                return
                
        # Backup first
        backup_path = self.backup()
        
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM knowledge_relationships")
        cursor.execute("DELETE FROM knowledge_entities")
        self.conn.commit()
        
        print("🗑️ Knowledge graph flushed")
        print(f"   Backup saved to: {backup_path}")
    
    def populate_from_discoveries(self):
        """Populate knowledge graph with discovered environment info"""
        discoveries = [
            {
                "type": "configuration",
                "name": "ZMCP Database Location",
                "description": "ZMCP stores all data in SQLite at ~/.mcptools/data/",
                "properties": {
                    "main_db": "~/.mcptools/data/claude_mcp_tools.db",
                    "lancedb": "~/.mcptools/lancedb/",
                    "logs": "~/.mcptools/logs/"
                }
            },
            {
                "type": "tool",
                "name": "ZMCP GPU Embedding Service",
                "description": "FastAPI service for GPU-accelerated embeddings",
                "properties": {
                    "port": "8001",
                    "models": "Qwen2-7B,bge-m3,nomic-embed",
                    "venv": "/home/jw/dev/game1/.venv/"
                }
            },
            {
                "type": "pattern",
                "name": "Multi-Agent Orchestration Pattern",
                "description": "Use orchestrate_objective for complex tasks requiring 3+ steps",
                "properties": {
                    "cost_reduction": "85-90% with foundation sessions",
                    "agent_types": "backend,frontend,testing,documentation,devops,analysis"
                }
            },
            {
                "type": "insight",
                "name": "Dashboard Deprecation",
                "description": "unified_orchestration_dashboard.py should be archived, extract context switching and room monitoring concepts",
                "properties": {
                    "good_ideas": "context_switching,stream_monitoring,agent_status",
                    "problems": "hardcoded_paths,no_real_monitoring,port_8888_default"
                }
            }
        ]
        
        cursor = self.conn.cursor()
        
        for disc in discoveries:
            # Check if already exists
            cursor.execute("""
                SELECT id FROM knowledge_entities 
                WHERE entity_name = ? AND entity_type = ?
            """, (disc["name"], disc["type"]))
            
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO knowledge_entities 
                    (id, repository_path, agent_id, entity_type, entity_name, 
                     entity_description, properties, importance_score, confidence_score, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    self.generate_id(),
                    ".",
                    "knowledge-manager",
                    disc["type"],
                    disc["name"],
                    disc["description"],
                    json.dumps(disc["properties"]),
                    0.8,
                    0.9,
                    datetime.now().isoformat()
                ))
                print(f"✅ Added: {disc['name']}")
            else:
                print(f"⏭️ Skipped (exists): {disc['name']}")
                
        self.conn.commit()
    
    def stats(self):
        """Show knowledge graph statistics"""
        cursor = self.conn.cursor()
        
        # Entity stats
        cursor.execute("SELECT COUNT(*) as count FROM knowledge_entities")
        entity_count = cursor.fetchone()["count"]
        
        cursor.execute("""
            SELECT entityType, COUNT(*) as count 
            FROM knowledge_entities 
            GROUP BY entityType 
            ORDER BY count DESC
        """)
        entity_types = cursor.fetchall()
        
        # Relationship stats
        cursor.execute("SELECT COUNT(*) as count FROM knowledge_relationships")
        rel_count = cursor.fetchone()["count"]
        
        cursor.execute("""
            SELECT relationshipType, COUNT(*) as count 
            FROM knowledge_relationships 
            GROUP BY relationshipType 
            ORDER BY count DESC
        """)
        rel_types = cursor.fetchall()
        
        print("\n📊 Knowledge Graph Statistics")
        print("="*50)
        print(f"Total Entities: {entity_count}")
        print(f"Total Relationships: {rel_count}")
        
        print("\n📌 Entity Types:")
        for row in entity_types:
            print(f"  {row['entityType']}: {row['count']}")
            
        print("\n🔗 Relationship Types:")
        for row in rel_types:
            print(f"  {row['relationshipType']}: {row['count']}")
    
    def search(self, query: str):
        """Search knowledge graph"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM knowledge_entities 
            WHERE name LIKE ? 
               OR description LIKE ?
               OR properties LIKE ?
            ORDER BY importanceScore DESC
            LIMIT 10
        """, (f"%{query}%", f"%{query}%", f"%{query}%"))
        
        results = cursor.fetchall()
        print(f"\n🔍 Search results for '{query}':")
        print("="*50)
        
        for row in results:
            entity = dict(row)
            print(f"\n📌 {entity['name']} ({entity['entityType']})")
            print(f"   {entity['description'][:100] if entity['description'] else 'No description'}...")
            if entity.get('properties'):
                try:
                    props = json.loads(entity['properties'])
                    print(f"   Properties: {', '.join(props.keys())}")
                except:
                    pass
    
    def migrate_to_gpu_embeddings(self):
        """Prepare entities for GPU embedding migration"""
        entities = self.export_entities()
        
        migration_data = []
        for entity in entities:
            # Combine relevant text fields for embedding
            text_content = f"{entity['entity_name']} {entity['entity_description']}"
            
            if entity.get('properties'):
                if isinstance(entity['properties'], dict):
                    text_content += " " + " ".join(str(v) for v in entity['properties'].values())
                    
            migration_data.append({
                "id": entity['id'],
                "text": text_content,
                "metadata": {
                    "type": entity['entity_type'],
                    "name": entity['entity_name'],
                    "importance": entity.get('importance_score', 0.5)
                }
            })
        
        output_path = "knowledge_graph_for_embedding.json"
        with open(output_path, 'w') as f:
            json.dump(migration_data, f, indent=2)
            
        print(f"✅ Prepared {len(migration_data)} entities for GPU embedding")
        print(f"   Output: {output_path}")
        print("\nNext steps:")
        print("1. Run GPU embedding service: uv run talent-os/bin/zmcp_gpu_embedding_server.py")
        print("2. Process entities through embedding service")
        print("3. Store vectors in LanceDB for semantic search")
        
        return output_path
    
    def generate_id(self):
        """Generate UUID-like ID"""
        import uuid
        return str(uuid.uuid4())

def main():
    parser = argparse.ArgumentParser(description="ZMCP Knowledge Graph Manager")
    parser.add_argument("command", choices=["stats", "backup", "flush", "populate", "search", "migrate"],
                       help="Command to execute")
    parser.add_argument("--query", help="Search query")
    parser.add_argument("--confirm", action="store_true", help="Skip confirmation prompts")
    
    args = parser.parse_args()
    
    manager = KnowledgeGraphManager()
    
    if args.command == "stats":
        manager.stats()
    elif args.command == "backup":
        manager.backup()
    elif args.command == "flush":
        manager.flush(confirm=args.confirm)
    elif args.command == "populate":
        manager.populate_from_discoveries()
    elif args.command == "search":
        if not args.query:
            print("Error: --query required for search")
            sys.exit(1)
        manager.search(args.query)
    elif args.command == "migrate":
        manager.migrate_to_gpu_embeddings()

if __name__ == "__main__":
    main()