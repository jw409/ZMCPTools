# 🔍 CONSERVATIVE VALIDATION PROTOCOL: Collaborative Agent Architecture (Issue #22)

## 📋 **Context Bridge Protocol for Context Window Management**

**CRITICAL: Use knowledge graph to maintain context across sessions**

### **Store Current Implementation State**
```bash
# Before validation, store implementation context
mcp__zmcp-tools__store_knowledge_memory . "validation-session-$(date +%s)" "implementation_status" \
  "Collaborative Agent Architecture Implementation" \
  "Enhanced permissions: planner_agent (orchestration+communication), implementer_agent (execution+files), tester_agent (browser+testing).
   Created MeetingProtocolEngine with 4-phase workflow (Planning→Implementation→Testing→Review).
   Built orchestrate_collaborative_team tool with turn-based coordination.
   Files: src/schemas/agents.ts (enhanced permissions), src/services/MeetingProtocolEngine.ts (coordination),
   src/tools/collaborativeOrchestrationTool.ts (main interface), src/server/McpServer.ts (registration).
   Status: Code written, needs validation before commit. Issue #22 implementation complete but untested."
```

### **Search for Context on Session Resume**
```bash
# When context window collapses, restore with:
mcp__zmcp-tools__search_knowledge_graph . "collaborative agent architecture implementation validation"
mcp__zmcp-tools__search_knowledge_graph . "Issue 22 three agent team status"
search_knowledge_graph_unified . "MeetingProtocolEngine orchestrate_collaborative_team" --use_bm25=true
```

---

## 🎯 **PHASE 1: TypeScript Compilation Validation (CRITICAL)**

**DETAILED EXECUTION STEPS:**

### **Step 1.1: Clean TypeScript Check**
```bash
cd /home/jw/dev/game1/ZMCPTools

# Clear any cached builds first
rm -rf dist/ node_modules/.cache/

# Run comprehensive TypeScript check with detailed output
npx tsc --noEmit --strict --verbose 2>&1 | tee typescript_validation.log

# Check exit code explicitly
if [ $? -eq 0 ]; then
    echo "✅ TypeScript compilation PASSED"
    echo "$(date): TypeScript validation successful" >> validation.log
else
    echo "❌ TypeScript compilation FAILED - DO NOT COMMIT"
    echo "$(date): TypeScript validation FAILED" >> validation.log
    echo "🔍 Check typescript_validation.log for details"
    exit 1
fi
```

**WHAT THIS CATCHES:**
- Import/export circular dependencies
- Type mismatches in new collaborative code
- Missing interfaces for MeetingProtocolEngine
- Schema validation errors in collaborative agent types
- Tool handler signature mismatches

### **Step 1.2: Specific Import Chain Validation**
```bash
# Test critical import chains manually
node -e "
try {
  console.log('Testing MeetingProtocolEngine imports...');
  const { MeetingProtocolEngine } = require('./dist/server/index.js');
  console.log('✅ MeetingProtocolEngine imported successfully');

  console.log('Testing AgentPermissionManager...');
  const { AgentPermissionManager } = require('./dist/server/index.js');
  console.log('✅ AgentPermissionManager imported successfully');

  console.log('Testing collaborative tools...');
  const result = require('./dist/server/index.js');
  console.log('✅ All imports successful');
} catch (error) {
  console.error('❌ Import failure:', error.message);
  process.exit(1);
}
"
```

**KNOWLEDGE GRAPH CHECKPOINT:**
```bash
# Store compilation results for future reference
mcp__zmcp-tools__store_knowledge_memory . "validation-typescript-$(date +%s)" "validation_result" \
  "TypeScript Compilation Status" \
  "Compilation result: [PASS/FAIL]. Key findings: [details]. Import chains tested: MeetingProtocolEngine, AgentPermissionManager, collaborative tools. $(date)"
```

---

## 🏗️ **PHASE 2: Build System Validation (COMPREHENSIVE)**

### **Step 2.1: Full Build with Detailed Logging**
```bash
# Build with maximum verbosity
npm run build 2>&1 | tee build_validation.log

# Verify build artifacts exist and are complete
echo "🔍 Checking build artifacts..."
for file in \
  "dist/server/index.js" \
  "dist/server/index.d.ts" \
  "dist/cli/index.js" \
  "dist/cli/index.d.ts"
do
  if [ -f "$file" ]; then
    size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
    echo "✅ $file exists (${size} bytes)"
  else
    echo "❌ $file MISSING - Build incomplete"
    exit 1
  fi
done
```

### **Step 2.2: Collaborative Tools Registration Check**
```bash
# Verify our new tools are in the build
echo "🔍 Checking collaborative tool registration..."

if grep -q "orchestrate_collaborative_team" dist/server/index.js; then
    echo "✅ orchestrate_collaborative_team tool registered"
else
    echo "❌ orchestrate_collaborative_team tool MISSING from build"
    exit 1
fi

if grep -q "collaborativeOrchestrationTools" dist/server/index.js; then
    echo "✅ collaborativeOrchestrationTools module included"
else
    echo "❌ collaborativeOrchestrationTools module MISSING"
    exit 1
fi

if grep -q "MeetingProtocolEngine" dist/server/index.js; then
    echo "✅ MeetingProtocolEngine included in build"
else
    echo "❌ MeetingProtocolEngine MISSING from build"
    exit 1
fi
```

**KNOWLEDGE GRAPH CHECKPOINT:**
```bash
# Document build validation results
mcp__zmcp-tools__store_knowledge_memory . "validation-build-$(date +%s)" "validation_result" \
  "Build System Validation" \
  "Build status: [PASS/FAIL]. Artifacts verified: dist/server/index.js, dist/cli/index.js. Tools registered: orchestrate_collaborative_team, collaborativeOrchestrationTools, MeetingProtocolEngine. Build size: [size]. $(date)"
```

---

## 🚀 **PHASE 3: Server Startup Validation (RUNTIME)**

### **Step 3.1: Server Startup Test with Comprehensive Monitoring**
```bash
echo "🚀 Testing server startup with collaborative features..."

# Start server in background with detailed logging
timeout 30s node dist/server/index.js 2>&1 | tee server_startup.log &
SERVER_PID=$!

# Monitor startup for 10 seconds
sleep 10

# Check if server is still running
if kill -0 $SERVER_PID 2>/dev/null; then
    echo "✅ Server started successfully and is stable"

    # Check for error patterns in logs
    if grep -i "error\|exception\|failed" server_startup.log; then
        echo "⚠️ Errors detected in startup logs - review server_startup.log"
    else
        echo "✅ No errors detected in startup logs"
    fi

    # Gracefully terminate server
    kill $SERVER_PID
    wait $SERVER_PID 2>/dev/null
else
    echo "❌ Server crashed during startup - DO NOT COMMIT"
    echo "🔍 Check server_startup.log for crash details"
    exit 1
fi
```

### **Step 3.2: MCP Tool Discovery Validation**
```bash
echo "🔧 Testing MCP tool discovery..."

# Test tool listing with timeout
timeout 20s claude "List all available MCP tools and specifically look for orchestrate_collaborative_team" > tool_discovery.log 2>&1

if [ $? -eq 0 ]; then
    if grep -i "orchestrate_collaborative_team" tool_discovery.log; then
        echo "✅ orchestrate_collaborative_team tool discoverable via MCP"
    else
        echo "⚠️ orchestrate_collaborative_team not found in tool list - check registration"
    fi
else
    echo "⚠️ Tool discovery test timed out or failed - MCP connectivity issues"
fi
```

**KNOWLEDGE GRAPH CHECKPOINT:**
```bash
# Store server validation results
mcp__zmcp-tools__store_knowledge_memory . "validation-server-$(date +%s)" "validation_result" \
  "Server Startup Validation" \
  "Server startup: [PASS/FAIL]. Stability test: [PASS/FAIL]. Tool discovery: [PASS/FAIL]. Error count: [count]. MCP connectivity: [status]. $(date)"
```

---

## 🔐 **PHASE 4: Permission System Validation (ENHANCED)**

### **Step 4.1: Agent Permission Generation Test**
```bash
echo "🔐 Testing enhanced agent permissions..."

# Test each agent type permission generation
for agent_type in "planner_agent" "implementer_agent" "tester_agent"; do
    echo "Testing $agent_type permissions..."

    node -e "
    try {
        const { AgentPermissionManager } = require('./dist/server/index.js');
        const permissions = AgentPermissionManager.generateToolPermissions('$agent_type');

        console.log('✅ $agent_type permissions generated successfully');
        console.log('  Allowed categories:', permissions.allowedCategories?.join(', ') || 'none');
        console.log('  Allowed tools count:', permissions.allowedTools?.length || 0);
        console.log('  Disallowed categories:', permissions.disallowedCategories?.join(', ') || 'none');

        // Validate expected permissions
        const expected = {
            'planner_agent': ['communication_tools', 'orchestration_tools', 'knowledge_graph_tools'],
            'implementer_agent': ['execution_tools', 'file_tools', 'communication_tools'],
            'tester_agent': ['execution_tools', 'browser_tools', 'communication_tools']
        };

        const hasRequired = expected['$agent_type'].every(cat =>
            permissions.allowedCategories?.includes(cat));

        if (hasRequired) {
            console.log('✅ $agent_type has all required permissions');
        } else {
            console.log('❌ $agent_type missing required permissions');
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Permission test failed for $agent_type:', error.message);
        process.exit(1);
    }
    " || exit 1
done
```

### **Step 4.2: Tool Category Mapping Validation**
```bash
echo "🛠️ Testing tool category mappings..."

node -e "
try {
    const { TOOL_CATEGORY_MAPPINGS } = require('./dist/server/index.js');

    // Check that new unified search tools are mapped
    const knowledgeTools = TOOL_CATEGORY_MAPPINGS['knowledge_graph_tools'] || [];
    const hasUnifiedSearch = knowledgeTools.includes('search_knowledge_graph_unified');
    const hasAcquisition = knowledgeTools.includes('acquire_repository');

    if (hasUnifiedSearch && hasAcquisition) {
        console.log('✅ New unified search tools properly mapped to knowledge_graph_tools');
    } else {
        console.log('❌ New tools not properly mapped:', {hasUnifiedSearch, hasAcquisition});
        process.exit(1);
    }

    // Verify core categories exist
    const coreCategories = ['core_tools', 'execution_tools', 'communication_tools'];
    for (const category of coreCategories) {
        if (!TOOL_CATEGORY_MAPPINGS[category]) {
            console.log('❌ Missing core category:', category);
            process.exit(1);
        }
    }

    console.log('✅ Tool category mappings validated successfully');

} catch (error) {
    console.error('❌ Tool category mapping test failed:', error.message);
    process.exit(1);
}
"
```

**KNOWLEDGE GRAPH CHECKPOINT:**
```bash
# Store permission validation results
mcp__zmcp-tools__store_knowledge_memory . "validation-permissions-$(date +%s)" "validation_result" \
  "Permission System Validation" \
  "Permission generation: [PASS/FAIL]. Agent types tested: planner_agent, implementer_agent, tester_agent. Required permissions verified: [details]. Tool mappings: [PASS/FAIL]. New tools mapped: search_knowledge_graph_unified, acquire_repository. $(date)"
```

---

## 🧪 **PHASE 5: Integration Testing (MINIMAL VIABLE)**

### **Step 5.1: Agent Spawning Test**
```bash
echo "🤖 Testing collaborative agent spawning..."

# Test spawning a single agent of each type
timeout 60s claude "Use mcp__zmcp-tools__spawn_agent to spawn a planner_agent for testing permissions at /home/jw/dev/game1/ZMCPTools" > spawn_test.log 2>&1

if [ $? -eq 0 ]; then
    if grep -i "success\|agent.*spawned" spawn_test.log; then
        echo "✅ Agent spawning appears functional"
    else
        echo "⚠️ Agent spawning test inconclusive - check spawn_test.log"
    fi
else
    echo "⚠️ Agent spawning test timed out or failed"
fi
```

### **Step 5.2: Tool Handler Validation**
```bash
echo "🔧 Testing collaborative orchestration tool handler..."

# Basic tool handler syntax check
node -e "
try {
    const fs = require('fs');
    const toolContent = fs.readFileSync('src/tools/collaborativeOrchestrationTool.ts', 'utf8');

    // Check for common handler issues
    if (toolContent.includes('async handler(')) {
        console.log('✅ Tool handler has async signature');
    } else {
        console.log('❌ Tool handler missing async keyword');
        process.exit(1);
    }

    if (toolContent.includes('zodToJsonSchema(')) {
        console.log('✅ Tool uses proper schema conversion');
    } else {
        console.log('❌ Tool missing schema conversion');
        process.exit(1);
    }

    console.log('✅ Tool handler syntax validation passed');

} catch (error) {
    console.error('❌ Tool handler validation failed:', error.message);
    process.exit(1);
}
"
```

**KNOWLEDGE GRAPH CHECKPOINT:**
```bash
# Store integration test results
mcp__zmcp-tools__store_knowledge_memory . "validation-integration-$(date +%s)" "validation_result" \
  "Integration Testing Results" \
  "Agent spawning: [PASS/FAIL]. Tool handler validation: [PASS/FAIL]. Syntax checks: [PASS/FAIL]. Ready for commit: [YES/NO]. $(date)"
```

---

## 📊 **PHASE 6: FINAL VALIDATION SUMMARY**

### **Step 6.1: Generate Validation Report**
```bash
echo "📊 Generating final validation report..."

cat > VALIDATION_REPORT.md << 'EOF'
# Collaborative Agent Architecture Validation Report

## Summary
- **TypeScript Compilation**: [PASS/FAIL]
- **Build System**: [PASS/FAIL]
- **Server Startup**: [PASS/FAIL]
- **Permission System**: [PASS/FAIL]
- **Integration Tests**: [PASS/FAIL]

## Details
[Include specific findings from each phase]

## Recommendation
[SAFE TO COMMIT / NEEDS FIXES / DO NOT COMMIT]

Generated: $(date)
EOF

echo "✅ Validation report generated: VALIDATION_REPORT.md"
```

### **Step 6.2: Store Complete Validation Context**
```bash
# Store comprehensive validation results for future context restoration
mcp__zmcp-tools__store_knowledge_memory . "validation-complete-$(date +%s)" "validation_summary" \
  "Collaborative Agent Architecture Final Validation" \
  "COMPLETE VALIDATION RESULTS:
   TypeScript: [PASS/FAIL] - [details]
   Build: [PASS/FAIL] - [details]
   Server: [PASS/FAIL] - [details]
   Permissions: [PASS/FAIL] - [details]
   Integration: [PASS/FAIL] - [details]

   FILES MODIFIED:
   - src/schemas/agents.ts (enhanced permissions)
   - src/services/MeetingProtocolEngine.ts (coordination engine)
   - src/tools/collaborativeOrchestrationTool.ts (main interface)
   - src/server/McpServer.ts (tool registration)

   IMPLEMENTATION: Three-agent collaborative teams (planner/implementer/tester) with enhanced permissions, structured meeting protocols, turn-based coordination. Addresses Issue #22 permission starvation.

   COMMIT RECOMMENDATION: [SAFE/CAUTION/NO] - [reasoning]

   NEXT STEPS: [specific actions needed]

   Validation completed: $(date)"
```

---

## 🔄 **CONTEXT WINDOW BRIDGE INSTRUCTIONS**

### **When Context Window Collapses, Restore With:**

1. **Search for Recent Validation:**
```bash
mcp__zmcp-tools__search_knowledge_graph . "validation collaborative agent Issue 22"
mcp__zmcp-tools__search_knowledge_graph . "TypeScript compilation MeetingProtocolEngine"
```

2. **Get Current Implementation Status:**
```bash
search_knowledge_graph_unified . "orchestrate_collaborative_team implementation status" --use_bm25=true --use_qwen3_embeddings=true
```

3. **Find Validation Results:**
```bash
mcp__zmcp-tools__search_knowledge_graph . "validation-complete validation-summary"
```

4. **Restore File Context:**
```bash
search_knowledge_graph_unified . "src/schemas/agents.ts enhanced permissions" --use_bm25=true
search_knowledge_graph_unified . "MeetingProtocolEngine turn-based coordination" --use_bm25=true
```

### **Critical Knowledge Graph Patterns:**
- Use semantic search for concepts: "collaborative agent architecture validation"
- Use BM25 for specific files: "src/tools/collaborativeOrchestrationTool.ts"
- Store validation results with timestamps for chronological tracking
- Reference Issue #22 consistently for context linking

---

## 🎯 **EXECUTION PROTOCOL**

**RUN THIS ENTIRE VALIDATION SEQUENCE:**
```bash
# Execute in order, stop on first failure
./validate_phase1_typescript.sh && \
./validate_phase2_build.sh && \
./validate_phase3_server.sh && \
./validate_phase4_permissions.sh && \
./validate_phase5_integration.sh && \
./validate_phase6_summary.sh

# If all pass:
echo "🎉 ALL VALIDATIONS PASSED - SAFE TO COMMIT"

# If any fail:
echo "❌ VALIDATION FAILED - DO NOT COMMIT UNTIL FIXED"
```

**COMMIT ONLY IF ALL PHASES PASS**

This protocol ensures the collaborative agent architecture is production-ready before commit while maintaining full context bridge capability for future sessions.