#!/usr/bin/env python3
"""
ZMCP-Qwen Bridge Service
Bridges ZMCP's embedding requests to GPU/CPU/Both modes
Provides cross-validation and quality metrics
"""

import os
import sys
import json
import time
import requests
import numpy as np
from flask import Flask, request, jsonify
from typing import List, Dict, Any
import threading
from queue import Queue
from dataclasses import dataclass
import hashlib

# UV enforcement
if not os.environ.get('VIRTUAL_ENV'):
    print("ERROR: This script must be run with 'uv run'", file=sys.stderr)
    sys.exit(1)

# Import CPU embedding model
from sentence_transformers import SentenceTransformer

@dataclass
class EmbeddingRequest:
    """Queued embedding request"""
    texts: List[str]
    mode: str  # 'cpu', 'gpu', 'both', 'cross-validate'
    request_id: str
    timestamp: float
    callback: Any = None

class ZMCPQwenBridge:
    """Bridge service that provides flexible embedding options"""
    
    def __init__(self, port=8767):
        self.port = port
        self.app = Flask(__name__)
        
        # CPU model (matches ZMCP's default)
        self.cpu_model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu')
        
        # GPU service endpoint
        self.gpu_url = "http://localhost:8765/embed"
        
        # Batch accumulator
        self.batch_queue = Queue()
        self.batch_size = 10  # Accumulate 10 queries before processing
        self.batch_timeout = 0.1  # 100ms max wait
        self.pending_batches = {}
        
        # Metrics
        self.metrics = {
            'cpu_requests': 0,
            'gpu_requests': 0,
            'both_requests': 0,
            'cross_validations': 0,
            'total_embeddings': 0,
            'gpu_failures': 0,
            'cpu_time': 0,
            'gpu_time': 0,
            'similarity_scores': []
        }
        
        # Start batch processor thread
        self.batch_thread = threading.Thread(target=self._batch_processor, daemon=True)
        self.batch_thread.start()
        
        self.setup_routes()
        
    def _batch_processor(self):
        """Process batches with accumulation and pipelining"""
        current_batch = []
        last_process_time = time.time()
        
        while True:
            try:
                # Try to get items from queue
                timeout = max(0.01, self.batch_timeout - (time.time() - last_process_time))
                
                try:
                    req = self.batch_queue.get(timeout=timeout)
                    current_batch.append(req)
                except:
                    pass  # Timeout is fine
                
                # Process if we have enough or timeout reached
                should_process = (
                    len(current_batch) >= self.batch_size or
                    (len(current_batch) > 0 and time.time() - last_process_time > self.batch_timeout)
                )
                
                if should_process and current_batch:
                    self._process_batch(current_batch)
                    current_batch = []
                    last_process_time = time.time()
                    
            except Exception as e:
                print(f"Batch processor error: {e}")
                time.sleep(0.1)
    
    def _process_batch(self, batch: List[EmbeddingRequest]):
        """Process a batch of embedding requests"""
        # Combine all texts
        all_texts = []
        text_to_request = {}
        
        for req in batch:
            for text in req.texts:
                all_texts.append(text)
                text_to_request[text] = req
        
        print(f"📦 Processing batch of {len(all_texts)} texts from {len(batch)} requests")
        
        # Get embeddings based on mode
        results = {}
        for req in batch:
            mode = req.mode
            
            if mode == 'cpu':
                embeddings = self._get_cpu_embeddings(req.texts)
                results[req.request_id] = {'embeddings': embeddings, 'mode': 'cpu', 'dimension': 384}
                
            elif mode == 'gpu':
                embeddings = self._get_gpu_embeddings(req.texts)
                results[req.request_id] = {'embeddings': embeddings, 'mode': 'gpu', 'dimension': 4096}
                
            elif mode == 'both':
                cpu_emb = self._get_cpu_embeddings(req.texts)
                gpu_emb = self._get_gpu_embeddings(req.texts)
                results[req.request_id] = {
                    'cpu_embeddings': cpu_emb,
                    'gpu_embeddings': gpu_emb,
                    'mode': 'both',
                    'cpu_dimension': 384,
                    'gpu_dimension': 4096
                }
                self.metrics['both_requests'] += 1
                
            elif mode == 'cross-validate':
                cpu_emb = self._get_cpu_embeddings(req.texts)
                gpu_emb = self._get_gpu_embeddings(req.texts)
                
                # Calculate similarity between CPU and GPU embeddings
                similarities = self._cross_validate(cpu_emb, gpu_emb)
                
                results[req.request_id] = {
                    'cpu_embeddings': cpu_emb,
                    'gpu_embeddings': gpu_emb,
                    'mode': 'cross-validate',
                    'similarities': similarities,
                    'avg_similarity': np.mean(similarities),
                    'cpu_dimension': 384,
                    'gpu_dimension': 4096
                }
                self.metrics['cross_validations'] += 1
                self.metrics['similarity_scores'].extend(similarities)
        
        # Store results
        self.pending_batches.update(results)
    
    def _get_cpu_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Get CPU embeddings"""
        start = time.time()
        embeddings = self.cpu_model.encode(texts, batch_size=len(texts))
        elapsed = time.time() - start
        
        self.metrics['cpu_requests'] += 1
        self.metrics['cpu_time'] += elapsed
        self.metrics['total_embeddings'] += len(texts)
        
        return embeddings.tolist()
    
    def _get_gpu_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Get GPU embeddings"""
        try:
            start = time.time()
            response = requests.post(self.gpu_url, json={'texts': texts}, timeout=30)
            elapsed = time.time() - start
            
            if response.status_code == 200:
                data = response.json()
                self.metrics['gpu_requests'] += 1
                self.metrics['gpu_time'] += elapsed
                return data['embeddings']
            else:
                self.metrics['gpu_failures'] += 1
                # Fallback to CPU
                return self._get_cpu_embeddings(texts)
                
        except Exception as e:
            print(f"GPU embedding failed: {e}, falling back to CPU")
            self.metrics['gpu_failures'] += 1
            return self._get_cpu_embeddings(texts)
    
    def _cross_validate(self, cpu_embeddings, gpu_embeddings) -> List[float]:
        """Calculate similarity between CPU and GPU embeddings"""
        similarities = []
        
        for cpu_emb, gpu_emb in zip(cpu_embeddings, gpu_embeddings):
            # Normalize to unit vectors
            cpu_norm = np.array(cpu_emb) / np.linalg.norm(cpu_emb)
            
            # Project GPU embedding to CPU dimension for comparison
            gpu_proj = np.array(gpu_emb[:384])  # Take first 384 dims
            gpu_norm = gpu_proj / np.linalg.norm(gpu_proj)
            
            # Cosine similarity
            similarity = np.dot(cpu_norm, gpu_norm)
            similarities.append(float(similarity))
        
        return similarities
    
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/embed', methods=['POST'])
        def embed():
            """Main embedding endpoint with mode selection"""
            data = request.json
            texts = data.get('texts', [])
            mode = data.get('mode', 'gpu')  # Default to GPU!
            
            if not texts:
                return jsonify({'error': 'No texts provided'}), 400
            
            # Generate request ID
            request_id = hashlib.md5(f"{time.time()}{texts[0]}".encode()).hexdigest()[:8]
            
            # Create request
            req = EmbeddingRequest(
                texts=texts,
                mode=mode,
                request_id=request_id,
                timestamp=time.time()
            )
            
            # For single text, process immediately
            if len(texts) == 1 and mode in ['cpu', 'gpu']:
                if mode == 'cpu':
                    embeddings = self._get_cpu_embeddings(texts)
                    return jsonify({
                        'embeddings': embeddings,
                        'mode': 'cpu',
                        'dimension': 384,
                        'request_id': request_id
                    })
                else:
                    embeddings = self._get_gpu_embeddings(texts)
                    return jsonify({
                        'embeddings': embeddings,
                        'mode': 'gpu',
                        'dimension': 4096,
                        'request_id': request_id
                    })
            
            # Add to batch queue
            self.batch_queue.put(req)
            
            # Wait for result (with timeout)
            start_wait = time.time()
            while time.time() - start_wait < 5:  # 5 second timeout
                if request_id in self.pending_batches:
                    result = self.pending_batches.pop(request_id)
                    return jsonify(result)
                time.sleep(0.01)
            
            return jsonify({'error': 'Timeout waiting for batch processing'}), 504
        
        @self.app.route('/metrics', methods=['GET'])
        def metrics():
            """Get service metrics"""
            avg_cpu_time = self.metrics['cpu_time'] / max(1, self.metrics['cpu_requests'])
            avg_gpu_time = self.metrics['gpu_time'] / max(1, self.metrics['gpu_requests'])
            
            return jsonify({
                'cpu_requests': self.metrics['cpu_requests'],
                'gpu_requests': self.metrics['gpu_requests'],
                'both_requests': self.metrics['both_requests'],
                'cross_validations': self.metrics['cross_validations'],
                'total_embeddings': self.metrics['total_embeddings'],
                'gpu_failures': self.metrics['gpu_failures'],
                'avg_cpu_time': avg_cpu_time,
                'avg_gpu_time': avg_gpu_time,
                'gpu_availability': self.metrics['gpu_failures'] < 5,
                'avg_similarity': np.mean(self.metrics['similarity_scores']) if self.metrics['similarity_scores'] else 0,
                'queue_size': self.batch_queue.qsize()
            })
        
        @self.app.route('/config', methods=['POST'])
        def config():
            """Update configuration"""
            data = request.json
            
            if 'batch_size' in data:
                self.batch_size = data['batch_size']
            if 'batch_timeout' in data:
                self.batch_timeout = data['batch_timeout']
            
            return jsonify({
                'batch_size': self.batch_size,
                'batch_timeout': self.batch_timeout
            })
        
        @self.app.route('/health', methods=['GET'])
        def health():
            """Health check"""
            # Check GPU service
            gpu_healthy = False
            try:
                resp = requests.get("http://localhost:8765/health", timeout=1)
                gpu_healthy = resp.status_code == 200
            except:
                pass
            
            return jsonify({
                'status': 'healthy',
                'cpu_available': True,
                'gpu_available': gpu_healthy,
                'queue_size': self.batch_queue.qsize(),
                'pending_results': len(self.pending_batches)
            })
    
    def run(self):
        """Run the service"""
        print("🌉 ZMCP-Qwen Bridge Service Starting...")
        print(f"📊 Modes: cpu (384d), gpu (4096d), both, cross-validate")
        print(f"📦 Batch size: {self.batch_size}, timeout: {self.batch_timeout}s")
        print(f"🎯 Default mode: GPU (4096 dimensions, local RTX 5090)")
        print(f"🚀 Running on port {self.port}")
        
        self.app.run(host='0.0.0.0', port=self.port, debug=False)

if __name__ == "__main__":
    bridge = ZMCPQwenBridge()
    bridge.run()