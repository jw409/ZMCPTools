# MCP Resource Registry

## Registered Resources (11 total)

### File Resources (6)
| URI Template | Test Coverage | Description |
|--------------|---------------|-------------|
| `file://*/ast` | ✅ fileResourceAST.test.ts (43 tests) | Parse source file to AST with optimizations |
| `file://*/symbols` | ✅ treeSitterAST.test.ts (87 tests) | Extract symbols (functions, classes, etc.) |
| `file://*/imports` | ✅ fileResourceImports.test.ts (28 tests) | Extract import statements |
| `file://*/exports` | ⚠️ fileResourceExports.test.ts (30 tests, 18 failing) | Extract export statements |
| `file://*/structure` | ✅ fileResourceStructure.test.ts (27 tests) | Markdown code outline |
| `file://*/diagnostics` | ✅ treeSitterAST.test.ts (included) | Syntax errors and parse diagnostics |

### Project Resources (2)
| URI Template | Test Coverage | Description |
|--------------|---------------|-------------|
| `project://*/structure` | ✅ projectResourceStructure.test.ts (35 tests) | Directory tree with ignore patterns |
| `project://*/summary` | ✅ projectResourceStructure.test.ts (included) | AI-optimized project overview |

### Knowledge Resources (3)
| URI Template | Test Coverage | Description |
|--------------|---------------|-------------|
| `knowledge://search` | ✅ knowledgeSearchResource.test.ts (23 tests) | Hybrid BM25 + semantic search |
| `knowledge://entity/*/related` | ❌ No tests yet | Graph traversal for related entities |
| `knowledge://status` | ❌ No tests yet | Knowledge graph statistics |

### Agent Resources (2) - NOT TESTED
| URI Template | Test Coverage | Description |
|--------------|---------------|-------------|
| `agents://list` | ❌ No tests | List spawned agents with filtering |
| `agents://*/status` | ❌ No tests | Detailed agent status |

## Test Coverage Summary

**Tested**: 9/11 resources (82%)
**Passing**: 8/9 tested resources (89%)
**Total Tests**: 273 tests

### Partial Implementation
- `file://*/exports` - 18/30 tests failing (40% passing)
  - ✅ **Working**: Named function/class/const exports
  - ❌ **Not yet**: Default exports, re-exports, type-only exports, destructuring, namespace exports
  - **Reason**: TypeScript AST doesn't map 1:1 to tree-sitter field names
  - **Impact**: Basic export detection works for most common cases
  - **Next steps**: Enhance `extractExports()` to handle TS compiler AST structure for edge cases

### Missing Tests
- `knowledge://entity/*/related` - Graph traversal
- `knowledge://status` - Stats endpoint
- `agents://list` - Agent listing
- `agents://*/status` - Agent monitoring

## Storage Architecture

All file:// resources now use **SQLite cache with timestamp invalidation**:

- **Cache location**:
  - DomU: `{project}/var/storage/sqlite/ast_cache.db`
  - Dom0: `~/dev/game1/var/storage/sqlite/ast_cache.db`

- **Invalidation**: mtime + SHA256 hash check
- **Performance**: 80-95% hit rate expected
- **Cached operations**: parse, extract_symbols, extract_imports, extract_exports, get_structure

See [AST_STORAGE_ARCHITECTURE.md](./AST_STORAGE_ARCHITECTURE.md) for details.

## Next Steps

1. **Fix failing tests**: `file://*/exports` (18 failures)
2. **Add missing tests**:
   - Knowledge graph related entities
   - Knowledge graph status
   - Agent list/status resources
3. **Validate cache performance**: Monitor hit rates in production
4. **Document test patterns**: Create testing guide for new resources
