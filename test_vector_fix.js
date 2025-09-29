#!/usr/bin/env node

/**
 * Simple test to check if vector database integration is fixed
 */

async function testVectorFix() {
  console.log('🧪 Testing vector database fix...');

  try {
    // Test TalentOS health
    const response = await fetch('http://localhost:8765/health');
    if (response.ok) {
      const health = await response.json();
      console.log('✅ TalentOS service healthy:', health.status);
      console.log('🔧 Available models:', health.models_available.join(', '));
      console.log('💾 VRAM free:', health.vram_free_gb.toFixed(1), 'GB');

      // Test Qwen3 embedding
      const embedResponse = await fetch('http://localhost:8765/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'test embedding with qwen3',
          model: 'qwen3_06b'
        })
      });

      if (embedResponse.ok) {
        const embedResult = await embedResponse.json();
        console.log(`✅ Qwen3 embedding successful: ${embedResult.embedding.length} dimensions`);
        console.log('🚀 Ready for enhanced vector search!');
      } else {
        console.log('❌ Qwen3 embedding failed:', embedResponse.status);
      }

    } else {
      console.log('❌ TalentOS service not responding');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testVectorFix();