# Phase 5 Test Plan - Contract-First Metadata Indexing

## Test Execution Order

### 1. Python AST Parser Tests (Standalone)
**File**: `ZMCPTools/python/ast_parser.py`

```bash
# Test 1: Valid Python file with functions/classes
uv run python ZMCPTools/python/ast_parser.py talent-os/bin/morning.py

# Test 2: File with syntax errors
echo "def broken(" > /tmp/test_broken.py
uv run python ZMCPTools/python/ast_parser.py /tmp/test_broken.py

# Test 3: Empty file
touch /tmp/test_empty.py
uv run python ZMCPTools/python/ast_parser.py /tmp/test_empty.py

# Test 4: File with imports
cat > /tmp/test_imports.py << 'EOF'
import os
from pathlib import Path
import sys as system
from typing import List, Dict

def test_func():
    pass
EOF
uv run python ZMCPTools/python/ast_parser.py /tmp/test_imports.py

# Test 5: File with classes and methods
cat > /tmp/test_classes.py << 'EOF'
class MyClass:
    def __init__(self):
        pass

    def public_method(self):
        pass

    def _private_method(self):
        pass

class ChildClass(MyClass):
    pass
EOF
uv run python ZMCPTools/python/ast_parser.py /tmp/test_classes.py
```

**Expected Results**:
- Test 1: Success with functions extracted
- Test 2: `success: false` with syntax error details
- Test 3: Success with empty symbols
- Test 4: Success with imports list
- Test 5: Success with classes and methods

---

### 2. Contract Indexing Service Tests
**File**: `ZMCPTools/src/services/ContractIndexingService.ts`

**Manual TypeScript Test**:
```typescript
// Create: ZMCPTools/test-contract-indexing.ts
import { ContractIndexingService } from './src/services/ContractIndexingService.js';

async function testContractIndexing() {
  const service = new ContractIndexingService('/home/jw/dev/game1');

  console.log('Test 1: Find contract files');
  const files = await service.findContractFiles();
  console.log('Found:', files);

  console.log('\nTest 2: Parse port_registry.json');
  const portSchema = await service.parseContractFile(files[0]);
  console.log('Ports found:', portSchema?.ports?.length);

  console.log('\nTest 3: Index all contracts');
  const result = await service.indexContracts('/home/jw/dev/game1');
  console.log('Result:', result);

  console.log('\nTest 4: Search for port 8765');
  const port = service.getPort(8765);
  console.log('Port 8765:', port);

  console.log('\nTest 5: Search for generate_docs tool');
  const tool = service.getTool('generate_docs');
  console.log('Tool:', tool);
}

testContractIndexing().catch(console.error);
```

```bash
cd ZMCPTools
npm run build
node dist/test-contract-indexing.js
```

**Expected Results**:
- Test 1: Array of contract JSON paths
- Test 2: Schema object with ports array
- Test 3: Indexing result with counts
- Test 4: Port 8765 details
- Test 5: generate_docs tool details

---

### 3. Migration SQL Tests
**File**: `ZMCPTools/src/migrations/add_contract_tables.sql`

```bash
# Test 1: Verify SQL syntax
sqlite3 /tmp/test_migration.db < ZMCPTools/src/migrations/add_contract_tables.sql

# Test 2: Check tables created
sqlite3 /tmp/test_migration.db ".tables"

# Test 3: Check indexes created
sqlite3 /tmp/test_migration.db ".indexes contract_ports"

# Test 4: Test FTS5 table
sqlite3 /tmp/test_migration.db "SELECT * FROM contracts_fts LIMIT 1"

# Test 5: Insert test data and verify triggers
sqlite3 /tmp/test_migration.db << 'EOF'
INSERT INTO contract_ports (port, service_name, status, schema_file)
VALUES (8765, 'Test Service', 'production', 'test.json');

SELECT * FROM contracts_fts WHERE service_name MATCH 'Test';
EOF
```

**Expected Results**:
- Test 1: No errors
- Test 2: All 5 tables listed
- Test 3: Indexes shown
- Test 4: Empty result (no errors)
- Test 5: FTS5 trigger populated data

---

### 4. TreeSitter Python Integration Tests
**File**: `ZMCPTools/src/tools/TreeSitterASTTool.ts`

**Manual TypeScript Test**:
```typescript
// Create: ZMCPTools/test-treesitter-python.ts
import { TreeSitterASTTool } from './src/tools/TreeSitterASTTool.js';

async function testPythonParsing() {
  const tool = new TreeSitterASTTool();

  console.log('Test 1: Parse Python file');
  const result = await tool.parse('/home/jw/dev/game1/talent-os/bin/morning.py', 'python');
  console.log('Success:', result.success);
  console.log('Language:', result.language);
  console.log('Functions found:', result.tree?.symbols?.functions?.length);

  console.log('\nTest 2: Parse TypeScript file (for comparison)');
  const tsResult = await tool.parse('/home/jw/dev/game1/ZMCPTools/src/index.ts', 'typescript');
  console.log('Success:', tsResult.success);

  console.log('\nTest 3: Parse invalid Python');
  const badResult = await tool.parse('/tmp/test_broken.py', 'python');
  console.log('Success:', badResult.success);
  console.log('Errors:', badResult.errors);
}

testPythonParsing().catch(console.error);
```

```bash
cd ZMCPTools
npm run build
node dist/test-treesitter-python.js
```

**Expected Results**:
- Test 1: Success, functions array populated
- Test 2: Success (TypeScript still works)
- Test 3: Failure with syntax error details

---

### 5. Integration Tests
**Test end-to-end workflow**:

```bash
# Setup: Build ZMCPTools
cd ZMCPTools
npm run build

# Test 1: Can Python AST parser be found?
ls -la ZMCPTools/python/ast_parser.py

# Test 2: Is parser executable?
uv run python ZMCPTools/python/ast_parser.py --help 2>&1 || echo "No help, but exists"

# Test 3: Can TypeScript import new services?
cd ZMCPTools
npm run typecheck 2>&1 | grep -i "contract" || echo "No contract errors"

# Test 4: Are new schemas exported?
node -e "const s = require('./dist/schemas/index.js'); console.log('contractPorts' in s ? 'PASS' : 'FAIL');"
```

---

## Success Criteria

### Must Pass:
- ✅ Python AST parser extracts functions/classes from valid files
- ✅ Python AST parser reports syntax errors correctly
- ✅ ContractIndexingService finds and parses contract JSONs
- ✅ ContractIndexingService validates paths
- ✅ Migration SQL creates all tables without errors
- ✅ FTS5 triggers populate search index
- ✅ TreeSitterASTTool calls Python subprocess successfully
- ✅ No TypeScript compilation errors

### Performance Targets:
- Python AST parsing: <500ms per file
- Contract indexing: <2 seconds for all contracts
- SQL migration: <1 second

### Known Issues to Document (Not Blockers):
- Path to Python parser hardcoded (needs config)
- No caching of AST results yet
- FTS5 search not yet integrated into UnifiedSearchTool

---

## Execution Plan

1. Run Python AST parser tests (5 tests)
2. Fix any Python errors
3. Create and run Contract indexing test script
4. Fix any TypeScript errors
5. Run SQL migration tests
6. Fix any SQL errors
7. Create and run TreeSitter integration test
8. Fix any integration errors
9. Run end-to-end integration tests
10. Document remaining issues

**Estimated Time**: 30-45 minutes total
