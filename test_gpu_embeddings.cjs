#!/usr/bin/env node

/**
 * GPU Embeddings Test - Hulk Smash Mode 🔥
 * Tests TalentOS GPU integration end-to-end
 */

const fs = require('fs');
const path = require('path');

console.log('🔥 HULK SMASH GPU EMBEDDING TEST STARTING...\n');

// Test 1: Direct TalentOS API
async function testDirectTalentOS() {
    console.log('🚀 Test 1: Direct TalentOS API');

    const testText = "GPU embedding test for ZMCPTools project";
    const payload = {
        text: testText,
        model: "gemma_embed"
    };

    try {
        const response = await fetch('http://localhost:8765/embed', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        console.log(`✅ Direct TalentOS SUCCESS!`);
        console.log(`   📏 Dimensions: ${result.dimensions}`);
        console.log(`   🎯 Model: ${result.model}`);
        console.log(`   📊 Embedding length: ${result.embeddings[0].length}`);
        console.log(`   🔢 First 5 values: [${result.embeddings[0].slice(0, 5).map(x => x.toFixed(4)).join(', ')}...]`);

        return true;
    } catch (error) {
        console.log(`❌ Direct TalentOS FAILED: ${error.message}`);
        return false;
    }
}

// Test 2: Configuration validation
async function testConfiguration() {
    console.log('\n🔧 Test 2: Configuration Validation');

    try {
        // Check config file
        const configPath = '.zmcp-config.json';
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            console.log('✅ Config file exists');
            console.log(`   📍 TalentOS endpoint: ${config.gpu_embeddings?.talentos_endpoint}`);
            console.log(`   🎯 Model: ${config.gpu_embeddings?.model}`);
            console.log(`   📏 Dimensions: ${config.gpu_embeddings?.dimensions}`);
        } else {
            console.log('⚠️  No config file found (will use defaults)');
        }

        // Check project-local storage
        const dbPath = './var/db/zmcp_local.db';
        console.log(`📂 Database path: ${dbPath}`);
        console.log(`   📁 Directory exists: ${fs.existsSync('./var/db/')}`);

        // Check MCP server build
        const serverPath = './dist/server/index.js';
        if (fs.existsSync(serverPath)) {
            const serverContent = fs.readFileSync(serverPath, 'utf8');
            const talentosRefs = (serverContent.match(/TalentOSEmbeddingFunction/g) || []).length;
            console.log(`✅ MCP server built with ${talentosRefs} TalentOS references`);
        } else {
            console.log('❌ MCP server build not found');
        }

        return true;
    } catch (error) {
        console.log(`❌ Configuration validation FAILED: ${error.message}`);
        return false;
    }
}

// Test 3: Stress test embeddings
async function stressTestEmbeddings() {
    console.log('\n💪 Test 3: Stress Test GPU Embeddings');

    const testTexts = [
        "First test embedding for performance measurement",
        "Second test with different content to verify consistency",
        "Third test with technical content: GPU acceleration, CUDA, embeddings",
        "Fourth test with special characters: 🚀 ⚡ 🔥 💻 📊",
        "Fifth test with longer content that should still process quickly on GPU"
    ];

    let successCount = 0;
    let totalTime = 0;

    for (let i = 0; i < testTexts.length; i++) {
        const startTime = Date.now();

        try {
            const response = await fetch('http://localhost:8765/embed', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: testTexts[i],
                    model: "gemma_embed"
                }),
                signal: AbortSignal.timeout(5000)
            });

            if (response.ok) {
                const result = await response.json();
                const duration = Date.now() - startTime;
                totalTime += duration;
                successCount++;

                console.log(`✅ Test ${i + 1}: ${duration}ms (${result.dimensions}D)`);
            } else {
                console.log(`❌ Test ${i + 1}: HTTP ${response.status}`);
            }

        } catch (error) {
            console.log(`❌ Test ${i + 1}: ${error.message}`);
        }
    }

    const avgTime = successCount > 0 ? totalTime / successCount : 0;
    console.log(`\n📊 Stress Test Results:`);
    console.log(`   ✅ Success rate: ${successCount}/${testTexts.length} (${(successCount/testTexts.length*100).toFixed(1)}%)`);
    console.log(`   ⚡ Average time: ${avgTime.toFixed(1)}ms`);
    console.log(`   🚀 Performance: ${avgTime < 100 ? 'EXCELLENT' : avgTime < 500 ? 'GOOD' : 'NEEDS IMPROVEMENT'}`);

    return successCount === testTexts.length;
}

// Test 4: TalentOS service health
async function testServiceHealth() {
    console.log('\n🏥 Test 4: TalentOS Service Health');

    try {
        const response = await fetch('http://localhost:8765/health', {
            signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
            const health = await response.json();
            console.log('✅ TalentOS Service Healthy');
            console.log(`   🖥️  Device: ${health.device}`);
            console.log(`   📊 VRAM Usage: ${health.vram_usage_gb.toFixed(2)}GB`);
            console.log(`   📊 VRAM Free: ${health.vram_free_gb.toFixed(2)}GB`);
            console.log(`   🎯 Models Available: ${health.models_available.join(', ')}`);
            console.log(`   ⚡ Models Loaded: ${Object.entries(health.models_loaded).filter(([k,v]) => v).map(([k,v]) => k).join(', ')}`);

            return health.device === 'cuda' && health.status === 'healthy';
        } else {
            console.log(`❌ Health check failed: HTTP ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Health check failed: ${error.message}`);
        return false;
    }
}

// Main test runner
async function runAllTests() {
    console.log('🔥💪 HULK SMASH GPU EMBEDDING COMPREHENSIVE TEST\n');

    const results = [];

    results.push(await testServiceHealth());
    results.push(await testConfiguration());
    results.push(await testDirectTalentOS());
    results.push(await stressTestEmbeddings());

    const passedTests = results.filter(Boolean).length;
    const totalTests = results.length;

    console.log('\n' + '='.repeat(60));
    console.log('🏁 FINAL RESULTS');
    console.log('='.repeat(60));
    console.log(`📊 Tests Passed: ${passedTests}/${totalTests} (${(passedTests/totalTests*100).toFixed(1)}%)`);

    if (passedTests === totalTests) {
        console.log('🎉 🔥 HULK SMASH SUCCESS! GPU EMBEDDINGS FULLY OPERATIONAL! 🔥 🎉');
        console.log('✅ Ready for production use with TalentOS GPU acceleration!');
    } else {
        console.log('⚠️  Some tests failed - investigation needed');
        console.log('❌ GPU embeddings may have issues');
    }

    console.log('\n🚀 Test completed. GPU embeddings status validated.');

    process.exit(passedTests === totalTests ? 0 : 1);
}

// Handle Node.js environment
if (typeof fetch === 'undefined') {
    console.log('⚠️  fetch not available, installing node-fetch...');
    try {
        global.fetch = require('node-fetch');
    } catch (e) {
        console.log('❌ node-fetch not available. Please run: npm install node-fetch');
        process.exit(1);
    }
}

// Run the tests
runAllTests().catch(error => {
    console.error('💥 Test runner crashed:', error);
    process.exit(1);
});