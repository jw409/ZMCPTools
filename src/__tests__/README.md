# File AST Resource Tests

This directory contains comprehensive tests for the `file://*/ast` MCP resource implementation in ZMCPTools.

## Test File: `fileResourceAST.test.ts`

### Coverage

The test suite includes **43 tests** covering:

#### 1. Basic AST Parsing (5 tests)
- TypeScript file parsing
- JavaScript file parsing  
- Python file parsing (subprocess-based)
- Unsupported language handling
- Non-existent file error handling

#### 2. Query Parameters - Compact Mode (2 tests)
- Compact mode enabled (`compact=true`)
- Full AST mode (`compact=false`)

#### 3. Query Parameters - Symbol Table (2 tests)
- Symbol table for token reduction (default behavior)
- Symbol table disabled (`use_symbol_table=false`)

#### 4. Query Parameters - Max Depth (2 tests)
- Depth limiting with `max_depth=2`
- Shallow overview with `max_depth=1`

#### 5. Query Parameters - Semantic Hash (2 tests)
- Semantic hash generation (`include_semantic_hash=true`)
- Semantic hash omission (default)

#### 6. Query Parameters - Redundant Text (2 tests)
- Redundant text omission (default)
- Redundant text inclusion (`omit_redundant_text=false`)

#### 7. Combined Query Parameters (2 tests)
- Multiple optimizations together
- All optimizations disabled

#### 8. Symbol Extraction (`file://*/symbols`) (3 tests)
- TypeScript symbol extraction
- JavaScript symbol extraction
- Position information inclusion

#### 9. Import Extraction (`file://*/imports`) (2 tests)
- TypeScript import extraction
- JavaScript require extraction

#### 10. Export Extraction (`file://*/exports`) (2 tests)
- TypeScript export extraction
- JavaScript module.exports extraction

#### 11. File Structure (`file://*/structure`) (2 tests)
- Markdown structure generation
- Line number inclusion

#### 12. Diagnostics (`file://*/diagnostics`) (2 tests)
- Valid file diagnostics (no errors)
- Syntax error detection

#### 13. URI Format Validation (3 tests)
- Invalid URI rejection
- Unknown aspect rejection
- Special characters in file paths

#### 14. Error Handling (3 tests)
- Missing file graceful handling
- Binary file handling
- Empty file handling

#### 15. Integration with ResourceManager (3 tests)
- Resource listing verification
- Query parameter metadata validation
- All file aspects listed

#### 16. Language Detection (4 tests)
- TypeScript detection (.ts)
- JavaScript detection (.js)
- Python detection (.py)
- Unknown extension handling

#### 17. Performance and Optimization (2 tests)
- Large file handling with depth limits
- Symbol table for repeated identifiers

### Test Setup

The tests use:
- **Framework**: Vitest
- **Database**: In-memory SQLite via DatabaseManager
- **Test Files**: Dynamically created TypeScript, JavaScript, Python, and test files
- **Cleanup**: Automatic cleanup in `afterAll` hook

### Running Tests

```bash
# Run all AST resource tests
pnpm run test:run src/__tests__/fileResourceAST.test.ts

# Run with UI
pnpm run test:ui src/__tests__/fileResourceAST.test.ts
```

### Key Features Tested

1. **AST Parsing**: Full AST generation with TypeScript compiler for TS/JS files
2. **Optimization Parameters**: Compact mode, symbol table, max depth, redundant text omission
3. **Symbol Extraction**: Functions, classes, interfaces, methods, properties
4. **Import/Export Analysis**: Module dependency tracking
5. **Structure Generation**: Human-readable Markdown outlines
6. **Diagnostics**: Syntax error detection and reporting
7. **Error Handling**: Graceful failures for invalid files, unsupported languages
8. **URI Validation**: Proper URI format enforcement
9. **Language Detection**: Automatic language detection from file extensions
10. **Performance**: Optimization strategies for large files

### Notes

- Python parsing depends on subprocess availability and may fail gracefully
- Symbol table only includes repeated strings (3+ occurrences)
- Some symbol extraction features are limited in the current implementation
- Tests handle both success and graceful failure cases
