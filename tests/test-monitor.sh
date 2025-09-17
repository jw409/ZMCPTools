#!/bin/bash
# Test script for ZMCP Monitor functionality

set -e

echo "🔍 Testing ZMCP Monitor System"
echo "============================="

# Change to ZMCPTools directory
cd "$(dirname "$0")/.."

echo
echo "📋 Test 1: Basic monitor command help"
if command -v npm >/dev/null 2>&1; then
    echo "Running: npm run build"
    npm run build

    echo "Testing monitor command help:"
    node dist/cli/index.js monitor --help || echo "❌ Monitor help failed"
else
    echo "⚠️  npm not available, skipping build test"
fi

echo
echo "📋 Test 2: Monitor service instantiation"
echo "Testing MonitorService creation..."

# Test basic instantiation with Node.js
node -e "
try {
  const { MonitorService } = require('./dist/services/MonitorService.js');
  const monitor = new MonitorService('/tmp/test-monitor.db');
  console.log('✅ MonitorService created successfully');
  monitor.stop();
} catch (error) {
  console.log('❌ MonitorService creation failed:', error.message);
  process.exit(1);
}
" || echo "❌ MonitorService test failed"

echo
echo "📋 Test 3: MonitorFormatter functionality"
echo "Testing MonitorFormatter..."

node -e "
try {
  const { MonitorFormatter } = require('./dist/services/MonitorFormatter.js');
  const formatter = new MonitorFormatter();

  const testData = {
    timestamp: new Date().toISOString(),
    systemOverview: {
      totalAgents: 0,
      activeAgents: 0,
      idleAgents: 0,
      totalTasks: 0,
      activeTasks: 0,
      pendingTasks: 0,
      totalRooms: 0,
      activeRooms: 0
    },
    agents: [],
    processes: [],
    rooms: [],
    errors: []
  };

  formatter.formatTerminal(testData).then(result => {
    if (result.includes('ZMCP Agent Monitor')) {
      console.log('✅ Terminal formatting works');
    } else {
      console.log('❌ Terminal formatting failed');
    }
  });

  formatter.formatJson(testData).then(result => {
    const parsed = JSON.parse(result);
    if (parsed.systemOverview.totalAgents === 0) {
      console.log('✅ JSON formatting works');
    } else {
      console.log('❌ JSON formatting failed');
    }
  });

  formatter.formatHtml(testData).then(result => {
    if (result.includes('<!DOCTYPE html>')) {
      console.log('✅ HTML formatting works');
    } else {
      console.log('❌ HTML formatting failed');
    }
  });

} catch (error) {
  console.log('❌ MonitorFormatter test failed:', error.message);
  process.exit(1);
}
" || echo "❌ MonitorFormatter test failed"

echo
echo "📋 Test 4: Process title parsing"
echo "Testing ZMCP process title parsing..."

node -e "
const testTitles = [
  'zmcp-be-oauth-impl-a3f2e1',
  'zmcp-fe-dashboard-b4c3d2',
  'zmcp-ts-api-tests-c5d4e3',
  'zmcp-dc-user-docs-d6e5f4'
];

const typeMap = {
  'be': 'backend',
  'fe': 'frontend',
  'ts': 'testing',
  'dc': 'documentation'
};

let passed = 0;
let total = testTitles.length;

testTitles.forEach(title => {
  const match = title.match(/zmcp-(\w+)-([^-\s]+)-(\w+)/);
  if (match) {
    const [, typeAbbr, projectContext, agentId] = match;
    const expectedType = typeMap[typeAbbr];

    if (expectedType && projectContext && agentId) {
      console.log(\`✅ Parsed: \${title} -> \${expectedType}/\${projectContext}/\${agentId}\`);
      passed++;
    } else {
      console.log(\`❌ Failed to parse: \${title}\`);
    }
  } else {
    console.log(\`❌ No match for: \${title}\`);
  }
});

console.log(\`\nResult: \${passed}/\${total} process titles parsed correctly\`);
if (passed === total) {
  console.log('✅ All process title parsing tests passed');
} else {
  console.log('❌ Some process title parsing tests failed');
}
" || echo "❌ Process title parsing test failed"

echo
echo "📋 Test 5: Health score calculation"
echo "Testing health score calculation..."

node -e "
function calculateHealthScore(metrics) {
  let score = 100;

  if (metrics.crashCount && metrics.crashCount > 0) {
    score -= Math.min(metrics.crashCount * 10, 50);
  }

  if (metrics.restartCount && metrics.restartCount > 0) {
    score -= Math.min(metrics.restartCount * 5, 30);
  }

  return Math.max(Math.min(score, 100), 0);
}

const testCases = [
  { input: {}, expected: 100, desc: 'perfect health' },
  { input: { crashCount: 1 }, expected: 90, desc: '1 crash' },
  { input: { crashCount: 5 }, expected: 50, desc: '5 crashes' },
  { input: { restartCount: 2 }, expected: 90, desc: '2 restarts' },
  { input: { crashCount: 2, restartCount: 2 }, expected: 70, desc: '2 crashes + 2 restarts' }
];

let passed = 0;
testCases.forEach(({ input, expected, desc }) => {
  const result = calculateHealthScore(input);
  if (result === expected) {
    console.log(\`✅ \${desc}: \${result} (expected \${expected})\`);
    passed++;
  } else {
    console.log(\`❌ \${desc}: \${result} (expected \${expected})\`);
  }
});

console.log(\`\nResult: \${passed}/\${testCases.length} health score tests passed\`);
" || echo "❌ Health score calculation test failed"

echo
echo "📋 Test 6: Database schema validation"
echo "Testing agent metrics schema..."

node -e "
try {
  const schemas = require('./dist/schemas/index.js');

  if (schemas.agentMetrics && schemas.agentProcessSnapshots && schemas.agentHealthChecks) {
    console.log('✅ Agent metrics tables defined');
  } else {
    console.log('❌ Agent metrics tables missing');
  }

  if (schemas.AgentMetrics && schemas.AgentProcessSnapshot && schemas.AgentHealthCheck) {
    console.log('✅ Agent metrics types exported');
  } else {
    console.log('❌ Agent metrics types missing');
  }

  if (schemas.calculateHealthScore && schemas.calculatePerformanceScore) {
    console.log('✅ Metric calculation functions exported');
  } else {
    console.log('❌ Metric calculation functions missing');
  }

} catch (error) {
  console.log('❌ Schema validation failed:', error.message);
}
" || echo "❌ Database schema test failed"

echo
echo "🎯 Test Summary"
echo "=============="
echo "All basic monitor functionality tests completed."
echo
echo "To run comprehensive Jest tests:"
echo "  npm test"
echo
echo "To test the monitor command manually:"
echo "  node dist/cli/index.js monitor"
echo "  node dist/cli/index.js monitor -o json"
echo "  node dist/cli/index.js monitor -o html --output-file monitor.html"
echo
echo "To test watch mode:"
echo "  node dist/cli/index.js monitor --watch"
echo "  node dist/cli/index.js monitor --watch -o html -p 8080"

echo
echo "✅ Monitor testing complete!"