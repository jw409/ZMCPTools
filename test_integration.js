#!/usr/bin/env node

/**
 * Test script to validate TalentOS integration fix
 */

import { TalentOSEmbeddingFunction } from './dist/services/TalentOSEmbeddingFunction.js';

async function testTalentOSIntegration() {
  console.log('🧪 Testing TalentOS integration...');

  // Test TalentOS embedding function
  const embeddingFunction = new TalentOSEmbeddingFunction({
    modelName: 'gemma_embed',
    endpoint: 'http://localhost:8765'
  });

  try {
    // Test availability
    const available = await embeddingFunction.checkAvailability();
    console.log(`✅ TalentOS service available: ${available}`);

    if (available) {
      // Test service status
      const status = await embeddingFunction.getServiceStatus();
      console.log('📊 Service status:', JSON.stringify(status, null, 2));

      // Test embedding generation
      console.log('🔍 Testing embedding generation...');
      const embeddings = await embeddingFunction.embed(['test text for embedding']);
      console.log(`✅ Generated embedding with ${embeddings[0].length} dimensions`);
    } else {
      console.log('❌ TalentOS service not available');
    }

  } catch (error) {
    console.error('❌ Error testing TalentOS integration:', error.message);
  }
}

testTalentOSIntegration().then(() => {
  console.log('🏁 Test completed');
});