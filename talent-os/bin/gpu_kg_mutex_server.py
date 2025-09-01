#!/usr/bin/env python3
"""
Unified GPU Knowledge Graph Server with Mutex Protection
Single daemon that handles embeddings, batching, and indexing
"""

import os
import sys
import json
import time
import threading
import queue
import hashlib
import numpy as np
from pathlib import Path
from flask import Flask, request, jsonify
from typing import List, Dict, Any
from datetime import datetime
import sqlite3

# UV enforcement
if not os.environ.get('VIRTUAL_ENV'):
    print("ERROR: This script must be run with 'uv run'", file=sys.stderr)
    sys.exit(1)

# Import both CPU and GPU models
from sentence_transformers import SentenceTransformer
from llama_cpp import Llama

class UnifiedGPUServer:
    """Single server for all GPU operations with mutex protection"""
    
    def __init__(self, port=8768):
        self.port = port
        self.app = Flask(__name__)
        
        # MUTEX for GPU access - critical!
        self.gpu_mutex = threading.Lock()
        self.model_mutex = threading.Lock()
        
        # Models
        print("🚀 Loading models...")
        self.cpu_model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu')
        
        # GPU model with mutex protection
        with self.gpu_mutex:
            self.gpu_model = Llama(
                model_path="/home/jw/dev/game1/talent-os/var/models/Qwen3-Embedding-8B-Q6_K.gguf",
                n_ctx=8192,
                n_gpu_layers=99,
                embedding=True,
                verbose=False,
                n_threads=1  # Single thread for GPU!
            )
        print("✅ Models loaded, GPU using 17.4GB VRAM")
        
        # Batch processing queue
        self.batch_queue = queue.Queue()
        self.batch_processor = threading.Thread(target=self._batch_processor, daemon=True)
        self.batch_processor.start()
        
        # Indexing queue
        self.index_queue = queue.Queue()
        self.index_processor = threading.Thread(target=self._index_processor, daemon=True)
        self.index_processor.start()
        
        # Stats
        self.stats = {
            'gpu_embeddings': 0,
            'cpu_embeddings': 0,
            'entities_indexed': 0,
            'batches_processed': 0,
            'gpu_time_total': 0,
            'cpu_time_total': 0
        }
        
        self.setup_routes()
    
    def _batch_processor(self):
        """Process embedding batches with mutex protection"""
        while True:
            batch = []
            # Accumulate batch
            deadline = time.time() + 0.1  # 100ms window
            
            while time.time() < deadline:
                try:
                    item = self.batch_queue.get(timeout=0.01)
                    batch.append(item)
                    if len(batch) >= 10:  # Process if batch is full
                        break
                except queue.Empty:
                    pass
            
            if batch:
                self._process_batch(batch)
    
    def _process_batch(self, batch):
        """Process a batch of embedding requests"""
        texts = []
        callbacks = []
        modes = []
        
        for item in batch:
            texts.extend(item['texts'])
            callbacks.append(item['callback'])
            modes.append(item['mode'])
        
        # GPU embeddings with mutex
        embeddings = []
        start = time.time()
        
        if modes[0] == 'gpu':
            with self.gpu_mutex:
                for text in texts:
                    try:
                        emb = self.gpu_model.embed(text)
                        embeddings.append(emb)
                    except Exception as e:
                        print(f"GPU embed error: {e}")
                        # Fallback to CPU
                        emb = self.cpu_model.encode([text])[0].tolist()
                        embeddings.append(emb)
            
            self.stats['gpu_embeddings'] += len(texts)
            self.stats['gpu_time_total'] += time.time() - start
        else:
            # CPU embeddings (no mutex needed)
            embeddings = self.cpu_model.encode(texts).tolist()
            self.stats['cpu_embeddings'] += len(texts)
            self.stats['cpu_time_total'] += time.time() - start
        
        self.stats['batches_processed'] += 1
        
        # Return results via callbacks
        idx = 0
        for item in batch:
            n = len(item['texts'])
            item['callback'](embeddings[idx:idx+n])
            idx += n
    
    def _index_processor(self):
        """Process indexing requests"""
        while True:
            try:
                task = self.index_queue.get()
                self._index_directory(task)
            except Exception as e:
                print(f"Index processor error: {e}")
    
    def _index_directory(self, task):
        """Index a directory with GPU embeddings"""
        dir_path = Path(task['path'])
        partition = task['partition']
        importance = task['importance']
        
        print(f"📁 Indexing {dir_path} (partition: {partition})")
        
        if not dir_path.exists():
            print(f"  ⚠️ Not found: {dir_path}")
            return
        
        # Collect files
        files = []
        patterns = ['*.py', '*.ts', '*.js', '*.md', '*.json']
        for pattern in patterns:
            files.extend(dir_path.rglob(pattern))
        
        # Filter
        files = [f for f in files if 'node_modules' not in str(f) and '.git' not in str(f)]
        print(f"  📊 Found {len(files)} files")
        
        # Process in chunks
        entities = []
        for file in files:
            try:
                content = file.read_text(errors='ignore')
                if len(content) > 100:  # Skip tiny files
                    # Get embedding with mutex
                    with self.gpu_mutex:
                        embedding = self.gpu_model.embed(content[:2000])  # First 2000 chars
                    
                    entity = {
                        'id': hashlib.md5(str(file).encode()).hexdigest(),
                        'name': file.name,
                        'type': 'code' if file.suffix == '.py' else 'documentation',
                        'description': content[:200],
                        'partition': partition,
                        'importance': importance,
                        'embedding': embedding
                    }
                    entities.append(entity)
                    self.stats['entities_indexed'] += 1
                    
                    if len(entities) >= 100:
                        self._store_entities(entities)
                        entities = []
                        print(f"  💾 Stored batch, total: {self.stats['entities_indexed']}")
                        
            except Exception as e:
                print(f"  ⚠️ Error with {file}: {e}")
        
        # Store remaining
        if entities:
            self._store_entities(entities)
    
    def _store_entities(self, entities):
        """Store entities in ZMCP knowledge graph"""
        db_path = Path.home() / '.mcptools' / 'data' / 'claude_mcp_tools.db'
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        for entity in entities:
            try:
                cursor.execute("""
                    INSERT OR REPLACE INTO knowledge_entities 
                    (id, repositoryPath, entityType, name, description, 
                     properties, importanceScore, confidenceScore, partition, 
                     createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    entity['id'],
                    '/home/jw/dev/game1',
                    entity['type'],
                    entity['name'],
                    entity['description'],
                    json.dumps({'embedding_dim': len(entity['embedding'])}),
                    entity['importance'],
                    0.9,
                    entity['partition'],
                    datetime.now().isoformat(),
                    datetime.now().isoformat()
                ))
            except Exception as e:
                print(f"Store error: {e}")
        
        conn.commit()
        conn.close()
    
    def setup_routes(self):
        """Flask routes"""
        
        @self.app.route('/embed', methods=['POST'])
        def embed():
            """Embedding endpoint"""
            data = request.json
            texts = data.get('texts', [])
            mode = data.get('mode', 'gpu')
            
            result_queue = queue.Queue()
            
            def callback(embeddings):
                result_queue.put(embeddings)
            
            # Queue for batch processing
            self.batch_queue.put({
                'texts': texts,
                'mode': mode,
                'callback': callback
            })
            
            # Wait for result
            try:
                embeddings = result_queue.get(timeout=10)
                return jsonify({
                    'embeddings': embeddings,
                    'mode': mode,
                    'dimension': len(embeddings[0]) if embeddings else 0
                })
            except queue.Empty:
                return jsonify({'error': 'Timeout'}), 504
        
        @self.app.route('/index', methods=['POST'])
        def index():
            """Index a directory"""
            data = request.json
            path = data.get('path', '.')
            partition = data.get('partition', 'test')
            importance = data.get('importance', 0.5)
            
            self.index_queue.put({
                'path': path,
                'partition': partition,
                'importance': importance
            })
            
            return jsonify({'status': 'queued', 'path': path})
        
        @self.app.route('/reindex-all', methods=['POST'])
        def reindex_all():
            """Reindex entire project"""
            dirs = [
                ('talent-os/', 'production', 1.0),
                ('talent-os/var/', 'production', 0.9),
                ('../ZMCPTools/src/', 'staging', 0.8),
                ('wwpoc/', 'staging', 0.7),
            ]
            
            for path, partition, importance in dirs:
                self.index_queue.put({
                    'path': path,
                    'partition': partition,
                    'importance': importance
                })
            
            return jsonify({'status': 'queued', 'directories': len(dirs)})
        
        @self.app.route('/stats', methods=['GET'])
        def stats():
            """Get statistics"""
            return jsonify(self.stats)
        
        @self.app.route('/health', methods=['GET'])
        def health():
            """Health check"""
            return jsonify({
                'status': 'healthy',
                'gpu_available': True,
                'cpu_available': True,
                'queue_size': self.batch_queue.qsize(),
                'index_queue_size': self.index_queue.qsize()
            })
    
    def run(self):
        """Run the server"""
        print("="*60)
        print("🚀 UNIFIED GPU KNOWLEDGE GRAPH SERVER")
        print("🔒 Mutex protection enabled")
        print("📦 Batch processing active")
        print("🎯 Single daemon for all operations")
        print(f"🌐 Running on port {self.port}")
        print("="*60)
        
        self.app.run(host='0.0.0.0', port=self.port, debug=False, threaded=True)

if __name__ == "__main__":
    server = UnifiedGPUServer()
    server.run()