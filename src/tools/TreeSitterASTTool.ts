/**
 * Tree-sitter AST parsing and query tool
 * Exposes tree-sitter's language-agnostic parsing capabilities via MCP
 *
 * Core capabilities:
 * - Parse source code into AST
 * - Query AST using tree-sitter's S-expression query language
 * - Extract symbols, imports, exports, and structure
 * - Find patterns across multiple languages
 * - Support for TypeScript, Python, JSON, SQL, and more
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from 'child_process';
import { promisify } from 'util';
// Note: For initial implementation, we'll use TypeScript's compiler API for TS/JS files
// Tree-sitter native packages have version conflicts, so we'll add them progressively
import * as ts from "typescript";
import { getASTCache } from "../services/ASTCacheService.js";

// Schema for AST operations
const ASTOperationSchema = z.object({
  operation: z.enum([
    "parse",           // Parse file to AST
    "query",           // Query AST with S-expressions
    "extract_symbols", // Extract all symbols
    "extract_imports", // Extract imports/requires
    "extract_exports", // Extract exports
    "find_pattern",    // Find code patterns
    "get_structure",   // Get file structure outline
    "get_diagnostics"  // Get parse errors/warnings
  ]),
  file_path: z.string().describe("Path to the file to parse"),
  language: z.enum([
    "typescript",
    "javascript",
    "python",
    "json",
    "sql",
    "rust",
    "go",
    "java",
    "c",
    "cpp",
    "auto"  // Auto-detect from extension
  ]).optional().default("auto"),
  query: z.string().optional().describe("Tree-sitter query in S-expression format"),
  pattern: z.string().optional().describe("Code pattern to search for"),
  include_positions: z.boolean().optional().default(true).describe("Include line/column positions"),
  include_text: z.boolean().optional().default(false).describe("Include matched text content")
});

type ASTOperation = z.infer<typeof ASTOperationSchema>;

interface ParseResult {
  success: boolean;
  language: string;
  tree?: any;  // Parser.Tree type
  errors?: ParseError[];
}

interface ParseError {
  type: string;
  message: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}

interface Symbol {
  name: string;
  kind: string;  // function, class, method, variable, etc.
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text?: string;
}

interface QueryMatch {
  pattern: number;
  captures: Array<{
    name: string;
    node: any;
    text?: string;
  }>;
}

export class TreeSitterASTTool {
  private astCache = getASTCache();

  constructor() {
    // Initialize cache (lazy initialization on first use)
  }

  private async parseTypeScript(filePath: string, content: string): Promise<any> {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );
    return sourceFile;
  }

  /**
   * Parse Python file using subprocess to call Python AST parser
   */
  private async parsePythonViaSubprocess(filePath: string, timeoutMs: number = 5000): Promise<ParseResult> {
    try {
      // Find the Python AST parser script relative to this file
      const __dirname = path.dirname(new URL(import.meta.url).pathname);
      const parserScript = path.join(__dirname, '../../python/ast_parser.py');

      return new Promise((resolve, reject) => {
        const process = spawn('uv', ['run', 'python', parserScript, filePath], {
          cwd: path.resolve(__dirname, '../../..')
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let processKilled = false;

        // Set timeout to kill the process if it takes too long
        const timeout = setTimeout(() => {
          timedOut = true;
          processKilled = true;
          process.kill('SIGTERM');

          // Force kill after 1 second if SIGTERM doesn't work
          setTimeout(() => {
            if (!process.killed) {
              process.kill('SIGKILL');
            }
          }, 1000);

          resolve({
            success: false,
            language: 'python',
            errors: [{
              type: 'timeout_error',
              message: `Python AST parser timed out after ${timeoutMs}ms. File may be too large or complex.`,
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: 0 }
            }]
          });
        }, timeoutMs);

        process.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        process.on('close', (code) => {
          clearTimeout(timeout);

          // Don't process if we already timed out
          if (timedOut) {
            return;
          }

          if (code !== 0) {
            resolve({
              success: false,
              language: 'python',
              errors: [{
                type: 'subprocess_error',
                message: `Python AST parser exited with code ${code}: ${stderr}`,
                startPosition: { row: 0, column: 0 },
                endPosition: { row: 0, column: 0 }
              }]
            });
            return;
          }

          try {
            const result = JSON.parse(stdout);
            if (!result.success) {
              resolve({
                success: false,
                language: 'python',
                errors: [{
                  type: 'parse_error',
                  message: result.error || 'Unknown parse error',
                  startPosition: { row: result.line || 0, column: result.offset || 0 },
                  endPosition: { row: result.line || 0, column: result.offset || 0 }
                }]
              });
              return;
            }

            // Convert Python AST result to our format
            resolve({
              success: true,
              language: 'python',
              tree: {
                symbols: result.symbols
              },
              errors: undefined
            });
          } catch (error) {
            resolve({
              success: false,
              language: 'python',
              errors: [{
                type: 'json_parse_error',
                message: `Failed to parse AST parser output: ${error instanceof Error ? error.message : 'Unknown error'}`,
                startPosition: { row: 0, column: 0 },
                endPosition: { row: 0, column: 0 }
              }]
            });
          }
        });

        process.on('error', (error) => {
          clearTimeout(timeout);

          // Don't process if we already timed out
          if (timedOut) {
            return;
          }

          resolve({
            success: false,
            language: 'python',
            errors: [{
              type: 'spawn_error',
              message: `Failed to spawn Python AST parser: ${error.message}`,
              startPosition: { row: 0, column: 0 },
              endPosition: { row: 0, column: 0 }
            }]
          });
        });
      });
    } catch (error) {
      return {
        success: false,
        language: 'python',
        errors: [{
          type: 'subprocess_setup_error',
          message: error instanceof Error ? error.message : 'Unknown error setting up subprocess',
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 0 }
        }]
      };
    }
  }

  private supportsLanguage(language: string): boolean {
    // For now, only TypeScript/JavaScript are fully supported
    // Other languages will return basic structure
    return ['typescript', 'javascript', 'tsx', 'jsx'].includes(language);
  }

  private detectLanguage(filePath: string, content: string): string {
    const ext = path.extname(filePath).toLowerCase();

    const extMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.py': 'python',
      '.pyw': 'python',
      '.json': 'json',
      '.sql': 'sql',
      '.rs': 'rust',
      '.go': 'go',
      '.java': 'java',
      '.c': 'c',
      '.h': 'c',
      '.cpp': 'cpp',
      '.cc': 'cpp',
      '.cxx': 'cpp',
      '.hpp': 'cpp'
    };

    return extMap[ext] || 'unknown';
  }

  async parse(filePath: string, language?: string): Promise<ParseResult> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const detectedLanguage = language === 'auto' || !language
        ? this.detectLanguage(filePath, content)
        : language;

      // For TypeScript/JavaScript, use TypeScript compiler
      if (this.supportsLanguage(detectedLanguage)) {
        const sourceFile = await this.parseTypeScript(filePath, content);

        // Convert TypeScript AST to our format
        const rootNode = this.convertTsNodeToTreeSitterFormat(sourceFile);
        const tree = {
          rootNode,
          // Add tree-sitter compatible walk() method
          walk: () => this.createTreeCursor(rootNode)
        };

        return {
          success: true,
          language: detectedLanguage,
          tree,
          errors: undefined
        };
      }

      // For Python, use subprocess to call Python AST parser
      if (detectedLanguage === 'python') {
        return await this.parsePythonViaSubprocess(filePath);
      }

      // For other languages, return basic structure
      return {
        success: false,
        language: detectedLanguage,
        errors: [{
          type: 'unsupported_language',
          message: `Full AST parsing for ${detectedLanguage} not yet supported`,
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 0 }
        }]
      };
    } catch (error) {
      return {
        success: false,
        language: 'unknown',
        errors: [{
          type: 'read_error',
          message: error instanceof Error ? error.message : 'Failed to read file',
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 0 }
        }]
      };
    }
  }

  /**
   * Convert TypeScript AST node to tree-sitter-like format for compatibility
   */
  private convertTsNodeToTreeSitterFormat(node: ts.Node): any {
    const sourceFile = node.getSourceFile() || node as ts.SourceFile;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.pos);

    const converted: any = {
      type: this.getTsNodeType(node),
      startPosition: { row: line, column: character },
      endPosition: { row: line, column: character + (node.end - node.pos) },
      childCount: 0,
      children: [],
      child: (index: number) => converted.children[index],
      childForFieldName: (name: string) => null,
      text: node.getText ? node.getText() : ''
    };

    // Convert children
    const children: any[] = [];
    ts.forEachChild(node, child => {
      children.push(this.convertTsNodeToTreeSitterFormat(child));
    });

    converted.children = children;
    converted.childCount = children.length;

    return converted;
  }

  /**
   * Map TypeScript node kinds to tree-sitter-like type names
   */
  private getTsNodeType(node: ts.Node): string {
    switch (node.kind) {
      case ts.SyntaxKind.SourceFile: return 'program';
      case ts.SyntaxKind.ImportDeclaration: return 'import_statement';
      case ts.SyntaxKind.ExportDeclaration: return 'export_statement';
      case ts.SyntaxKind.ClassDeclaration: return 'class_declaration';
      case ts.SyntaxKind.InterfaceDeclaration: return 'interface_declaration';
      case ts.SyntaxKind.TypeAliasDeclaration: return 'type_alias_declaration';
      case ts.SyntaxKind.FunctionDeclaration: return 'function_declaration';
      case ts.SyntaxKind.MethodDeclaration: return 'method_definition';
      case ts.SyntaxKind.PropertyDeclaration: return 'property_declaration';
      case ts.SyntaxKind.VariableDeclaration: return 'variable_declaration';
      case ts.SyntaxKind.VariableStatement: return 'lexical_declaration';
      case ts.SyntaxKind.Parameter: return 'parameter';
      case ts.SyntaxKind.Block: return 'block';
      case ts.SyntaxKind.ArrowFunction: return 'arrow_function';
      case ts.SyntaxKind.Identifier: return 'identifier';
      default: return ts.SyntaxKind[node.kind];
    }
  }

  /**
   * Create a tree-sitter compatible cursor for tree traversal
   */
  private createTreeCursor(node: any): any {
    let currentNode = node;
    const nodeStack: any[] = [];

    return {
      get currentNode() {
        return currentNode;
      },

      gotoFirstChild(): boolean {
        if (currentNode.children && currentNode.children.length > 0) {
          nodeStack.push(currentNode);
          currentNode = currentNode.children[0];
          return true;
        }
        return false;
      },

      gotoNextSibling(): boolean {
        if (nodeStack.length === 0) return false;
        const parent = nodeStack[nodeStack.length - 1];
        const currentIndex = parent.children.indexOf(currentNode);
        if (currentIndex >= 0 && currentIndex < parent.children.length - 1) {
          currentNode = parent.children[currentIndex + 1];
          return true;
        }
        return false;
      },

      gotoParent(): boolean {
        if (nodeStack.length > 0) {
          currentNode = nodeStack.pop();
          return true;
        }
        return false;
      }
    };
  }

  async query(tree: any, queryString: string): Promise<QueryMatch[]> {
    // This would use tree-sitter's query API
    // Example query: "(function_declaration name: (identifier) @function.name)"
    const matches: QueryMatch[] = [];

    try {
      // In a real implementation, you'd use tree-sitter's Query class
      // const query = new Query(tree.language, queryString);
      // const matches = query.matches(tree.rootNode);

      // For now, return empty array as placeholder
      return matches;
    } catch (error) {
      console.error("Query error:", error);
      return [];
    }
  }

  /**
   * Extract symbols in hierarchical format with compact location encoding
   * Format: {"name": "Class", "kind": "class", "location": "line:col-line:col", "children": [...]}
   */
  async extractSymbols(tree: any, language: string): Promise<any[]> {
    // Python uses pre-extracted symbols from subprocess parser
    if (language === 'python' && tree.symbols && tree.symbols.symbols) {
      return tree.symbols.symbols.map((sym: any) => ({
        name: sym.name,
        kind: sym.kind || sym.type,
        location: this.compactLocation(sym.line || 0, sym.col || 0, sym.line || 0, sym.col || 0)
      }));
    }

    // TypeScript/JavaScript - build hierarchical structure
    const topLevelSymbols: any[] = [];
    const classMap = new Map<string, any>(); // Track classes for nesting methods
    const nodeToParentMap = new Map<any, string>(); // Map nodes to parent class names

    const cursor = tree.walk();

    // First pass: build parent map and collect classes
    const buildParentMap = (parentClassName: string | null = null) => {
      const node = cursor.currentNode;

      if (language === 'typescript' || language === 'javascript') {
        const nameNode = this.findNameInChildren(node);

        // Track current class context
        let currentClassName = parentClassName;
        if (node.type === 'class_declaration' && nameNode) {
          currentClassName = nameNode;
        }

        // Map this node to its parent class
        if (currentClassName && node.type === 'method_definition') {
          nodeToParentMap.set(node, currentClassName);
        }

        // Recursively process children
        if (cursor.gotoFirstChild()) {
          do {
            buildParentMap(currentClassName);
          } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
      } else {
        // For non-TS/JS, just recurse
        if (cursor.gotoFirstChild()) {
          do {
            buildParentMap(null);
          } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
      }
    };

    // Build the parent map
    buildParentMap();

    // Reset cursor to root
    const cursor2 = tree.walk();

    // Second pass: extract symbols using parent map
    const visitNode = () => {
      const node = cursor2.currentNode;

      if (language === 'typescript' || language === 'javascript') {
        const nameNode = this.findNameInChildren(node);

        if (node.type === 'class_declaration' && nameNode) {
          const classSymbol = {
            name: nameNode,
            kind: 'class',
            location: this.compactLocation(
              node.startPosition.row,
              node.startPosition.column,
              node.endPosition.row,
              node.endPosition.column
            ),
            children: [] as any[]
          };
          topLevelSymbols.push(classSymbol);
          classMap.set(nameNode, classSymbol);

        } else if (node.type === 'interface_declaration' && nameNode) {
          topLevelSymbols.push({
            name: nameNode,
            kind: 'interface',
            location: this.compactLocation(
              node.startPosition.row,
              node.startPosition.column,
              node.endPosition.row,
              node.endPosition.column
            )
          });

        } else if (node.type === 'function_declaration' && nameNode) {
          topLevelSymbols.push({
            name: nameNode,
            kind: 'function',
            location: this.compactLocation(
              node.startPosition.row,
              node.startPosition.column,
              node.endPosition.row,
              node.endPosition.column
            )
          });

        } else if (node.type === 'method_definition' && nameNode) {
          // Look up parent class from map
          const parentClass = nodeToParentMap.get(node);
          const methodSymbol = {
            name: nameNode,
            kind: 'method',
            location: this.compactLocation(
              node.startPosition.row,
              node.startPosition.column,
              node.endPosition.row,
              node.endPosition.column
            )
          };

          if (parentClass && classMap.has(parentClass)) {
            classMap.get(parentClass)!.children.push(methodSymbol);
          } else {
            // Orphaned method - add to top level
            topLevelSymbols.push(methodSymbol);
          }
        }
      }

      // Recursively visit children
      if (cursor2.gotoFirstChild()) {
        do {
          visitNode();
        } while (cursor2.gotoNextSibling());
        cursor2.gotoParent();
      }
    };

    visitNode();
    return topLevelSymbols;
  }

  /**
   * Compact location encoding: "startLine:startCol-endLine:endCol"
   * Example: "69:77-69:668" for single line, "85:1-1200:5" for multi-line
   */
  private compactLocation(startRow: number, startCol: number, endRow: number, endCol: number): string {
    return `${startRow}:${startCol}-${endRow}:${endCol}`;
  }

  /**
   * Helper to find name identifier in node children (for TypeScript AST nodes)
   */
  private findNameInChildren(node: any): string | null {
    // Look for identifier nodes in immediate children
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        if (child.type === 'identifier') {
          return child.text;
        }
      }
    }
    return null;
  }

  async extractImports(tree: any, language: string): Promise<string[]> {
    const imports: string[] = [];

    // Python uses a different tree format (from subprocess parser)
    if (language === 'python') {
      if (tree.symbols && tree.symbols.imports) {
        // Python AST parser already extracted imports
        return tree.symbols.imports.map((imp: any) => {
          // Return the full module path
          return imp.module || imp.from_module || imp.name || '';
        }).filter((imp: string) => imp.length > 0);
      }
      return imports;
    }

    // TypeScript/JavaScript use tree cursor
    const cursor = tree.walk();

    const visitNode = () => {
      const node = cursor.currentNode;

      // TypeScript/JavaScript imports
      if (language === 'typescript' || language === 'javascript') {
        if (node.type === 'import_statement') {
          // Find string literal in children (the import source)
          for (let i = 0; i < node.childCount; i++) {
            const child = node.children[i];
            if (child && child.text && (child.text.startsWith('"') || child.text.startsWith("'"))) {
              // Remove quotes from import path
              const importPath = child.text.replace(/['"]/g, '');
              imports.push(importPath);
              break;
            }
          }
        }
      }

      // Recursively visit children
      if (cursor.gotoFirstChild()) {
        do {
          visitNode();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    visitNode();
    return imports;
  }

  async extractExports(tree: any, language: string): Promise<string[]> {
    const exports: string[] = [];
    const cursor = tree.walk();

    const findNameInChildren = (node: any): string | null => {
      // Look for identifier nodes in children
      if (node.type === 'identifier') {
        return node.text;
      }

      // Search children
      if (node.children) {
        for (const child of node.children) {
          const name = findNameInChildren(child);
          if (name) return name;
        }
      }

      return null;
    };

    const visitNode = () => {
      const node = cursor.currentNode;

      // TypeScript/JavaScript exports
      if (language === 'typescript' || language === 'javascript') {
        if (node.type === 'export_statement' || node.type === 'ExportDeclaration') {
          // For TypeScript compiler AST, look for declarations in children
          if (node.children) {
            for (const child of node.children) {
              if (child.type === 'lexical_declaration' ||
                  child.type === 'function_declaration' ||
                  child.type === 'class_declaration' ||
                  child.type === 'interface_declaration' ||
                  child.type === 'type_alias_declaration' ||
                  child.type === 'FunctionDeclaration' ||
                  child.type === 'ClassDeclaration' ||
                  child.type === 'InterfaceDeclaration' ||
                  child.type === 'VariableStatement') {

                // Find the name (identifier) in the declaration
                const name = findNameInChildren(child);
                if (name) {
                  exports.push(name);
                }
              }

              // Handle export { name1, name2 } syntax
              if (child.type === 'ExportClause' || child.type === 'NamedExports') {
                const names = findNameInChildren(child);
                if (names) exports.push(names);
              }
            }
          }
        }
      }

      // Python doesn't have explicit exports, but we can track __all__
      else if (language === 'python') {
        if (node.type === 'assignment' && node.text.includes('__all__')) {
          // Parse __all__ = [...] to get exported names
          // For Python, look in children for list
          if (node.children) {
            for (const child of node.children) {
              if (child.type === 'list') {
                // Extract string literals from list children
                if (child.children) {
                  for (const item of child.children) {
                    if (item.type === 'string') {
                      exports.push(item.text.replace(/['"]/g, ''));
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Recursively visit children
      if (cursor.gotoFirstChild()) {
        do {
          visitNode();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    visitNode();
    return exports;
  }

  // MCP Tool interface - Consolidated for token efficiency (8 tools → 1 tool = 83% token reduction)
  getTools(): Tool[] {
    return [
      {
        name: "ast_analyze",
        description: "🔍 Analyze source code using tree-sitter AST parsing within project context.\n\nUSE FOR: Building project-local call graphs, import analysis, symbol search\nNOT FOR: API testing, Swagger validation, cross-project contracts\n\nOperations: parse (full AST with optimizations), query (S-expression patterns), extract_symbols (functions/classes), extract_imports, extract_exports, find_pattern (code search), get_structure (readable outline), get_diagnostics (syntax errors).\n\nSymbols are scoped to this repository and its import graph. Use extract_imports to understand cross-file relationships.",
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["parse", "query", "extract_symbols", "extract_imports", "extract_exports", "find_pattern", "get_structure", "get_diagnostics"],
              description: "Type of AST analysis: parse=full tree, query=S-expression search, extract_symbols=functions/classes/methods, extract_imports=import statements, extract_exports=exports, find_pattern=code pattern search, get_structure=outline, get_diagnostics=errors"
            },
            file_path: {
              type: "string",
              description: "Path to the source code file"
            },
            language: {
              type: "string",
              enum: ["typescript", "javascript", "python", "json", "sql", "rust", "go", "java", "c", "cpp", "auto"],
              description: "Programming language (auto-detected if omitted)"
            },
            // Operation-specific parameters (optional based on operation)
            query: {
              type: "string",
              description: "Tree-sitter S-expression query (for operation=query). Example: '(function_declaration name: (identifier) @fn)'"
            },
            pattern: {
              type: "string",
              description: "Code pattern to find (for operation=find_pattern). Example: 'console.log', 'useState', 'new ClassName'"
            },
            // Parse operation optimization flags
            compact: {
              type: "boolean",
              description: "Return compact tree filtering syntactic noise (default: false, for operation=parse)"
            },
            use_symbol_table: {
              type: "boolean",
              description: "Use symbolic representation for 30-50% token reduction (default: true, for operation=parse)"
            },
            max_depth: {
              type: "number",
              description: "Max tree depth for quick overview (for operation=parse)"
            },
            include_semantic_hash: {
              type: "boolean",
              description: "Add hash for duplicate detection (default: false, for operation=parse)"
            },
            omit_redundant_text: {
              type: "boolean",
              description: "Omit text from simple nodes to save tokens (default: true, for operation=parse)"
            },
            // General flags
            include_positions: {
              type: "boolean",
              description: "Include line/column positions (default: true)"
            },
            include_text: {
              type: "boolean",
              description: "Include matched text content (default: true, for operation=query)"
            }
          },
          required: ["operation", "file_path"]
        }
      }
    ];
  }

  /**
   * Execute AST operation based on tool name or operation parameter
   * Supports both legacy tool names (ast_parse, ast_query, etc.) and new operation-based approach
   * Uses SQLite cache with timestamp-based invalidation for performance
   */
  async executeByToolName(toolName: string, args: any): Promise<any> {
    const startTime = Date.now();
    const operation = args.operation || toolName.replace('ast_', '');
    let parseTimeMs = 0;
    let result: any = null;
    let cacheData: any = null; // Move outside try block for finally access
    let parseResult: any = null;

    try {
      // Try cache first for cacheable operations
      const cacheableOps = ['parse', 'extract_symbols', 'extract_imports', 'extract_exports', 'get_structure'];
      if (cacheableOps.includes(operation)) {
        const cached = await this.astCache.get(args.file_path);
        if (cached) {
          // Cache hit - return cached data for the requested operation
          switch (operation) {
            case 'parse':
            case 'ast_parse':
              return {
                success: true,
                language: cached.language,
                ...cached.parseResult,
                _cached: true
              };
            case 'extract_symbols':
            case 'ast_extract_symbols':
              return {
                success: true,
                language: cached.language,
                symbols: cached.symbols || [],
                _cached: true
              };
            case 'extract_imports':
            case 'ast_extract_imports':
              return {
                success: true,
                language: cached.language,
                imports: cached.imports || [],
                _cached: true
              };
            case 'extract_exports':
            case 'ast_extract_exports':
              return {
                success: true,
                language: cached.language,
                exports: cached.exports || [],
                _cached: true
              };
            case 'get_structure':
            case 'ast_get_structure':
              return {
                success: true,
                language: cached.language,
                structure: cached.structure || '',
                _cached: true
              };
          }
        }
      }

      // Cache miss - parse the file
      parseResult = await this.parse(args.file_path, args.language);
      parseTimeMs = Date.now() - startTime;

      if (!parseResult.success || !parseResult.tree) {
        return {
          success: false,
          errors: parseResult.errors
        };
      }

      // Prepare to collect data for caching
      cacheData = {
        language: parseResult.language
      };

    switch (operation) {
      case "parse":
      case "ast_parse": {
        let compactTree = this.createCompactTree(parseResult.tree.rootNode, parseResult.language);

        // Apply optimizations
        if (args.max_depth) {
          compactTree = this.applyDepthLimit(compactTree, args.max_depth);
        }

        if (args.omit_redundant_text !== false) {
          compactTree = this.omitRedundantText(compactTree);
        }

        const result: any = {
          success: true,
          language: parseResult.language,
          errors: parseResult.errors
        };

        // Apply symbol table optimization (default: true)
        if (args.use_symbol_table !== false) {
          const { tree, symbolTable } = this.buildSymbolTable(compactTree);
          result.compactTree = tree;
          result.symbolTable = symbolTable;
          result.optimization = {
            symbol_table_size: Object.keys(symbolTable).length,
            estimated_token_reduction: `${Math.min(Object.keys(symbolTable).length * 3, 50)}%`
          };
        } else {
          result.compactTree = compactTree;
        }

        // Add semantic hash for duplicate detection
        if (args.include_semantic_hash) {
          result.semantic_hash = this.generateSemanticHash(compactTree);
        }

        // Include structure if compact mode
        if (args.compact || args.use_symbol_table) {
          result.structure = this.getFileStructure(parseResult.tree, parseResult.language);
        } else {
          // Full AST without optimization
          result.ast = this.simplifyAST(parseResult.tree.rootNode);
        }

        cacheData.parseResult = result;
        return result;
      }

      case "query":
      case "ast_query":
        if (!args.query) {
          return { success: false, error: "Query string required" };
        }
        const matches = await this.query(parseResult.tree, args.query);
        return {
          success: true,
          matches,
          matchCount: matches.length
        };

      case "extract_symbols":
      case "ast_extract_symbols": {
        const symbols = await this.extractSymbols(parseResult.tree, parseResult.language);
        const result = {
          success: true,
          language: parseResult.language,
          symbols,
          symbolCount: symbols.length
        };
        cacheData.symbols = symbols;
        return result;
      }

      case "extract_imports":
      case "ast_extract_imports": {
        const imports = await this.extractImports(parseResult.tree, parseResult.language);
        const result = {
          success: true,
          language: parseResult.language,
          imports,
          importCount: imports.length
        };
        cacheData.imports = imports;
        return result;
      }

      case "extract_exports":
      case "ast_extract_exports": {
        const exports = await this.extractExports(parseResult.tree, parseResult.language);
        const result = {
          success: true,
          language: parseResult.language,
          exports,
          exportCount: exports.length
        };
        cacheData.exports = exports;
        return result;
      }

      case "find_pattern":
      case "ast_find_pattern":
        // TODO: Implement pattern finding using tree-sitter queries
        if (!args.pattern) {
          return { success: false, error: "Pattern required" };
        }
        return {
          success: true,
          message: "Pattern finding not yet implemented",
          pattern: args.pattern
        };

      case "get_structure":
      case "ast_get_structure": {
        const markdownStructure = this.getFileStructure(parseResult.tree, parseResult.language);
        const compactTree = this.createCompactTree(parseResult.tree.rootNode, parseResult.language);
        const result = {
          success: true,
          language: parseResult.language,
          structure: markdownStructure,
          statistics: this.gatherStatistics(compactTree)
        };
        cacheData.structure = markdownStructure;
        return result;
      }

      case "get_diagnostics":
      case "ast_get_diagnostics":
        return {
          success: parseResult.errors ? parseResult.errors.length === 0 : true,
          language: parseResult.language,
          errors: parseResult.errors || []
        };

      default:
        return {
          success: false,
          error: `Unknown operation: ${operation}`
        };
    }
    } finally {
      // Write to cache if we have cached data and successfully parsed
      if (cacheData && Object.keys(cacheData).length > 0 && args.file_path) {
        try {
          const stats = await fs.stat(args.file_path);
          const content = await fs.readFile(args.file_path, 'utf-8');
          const fileHash = require('crypto').createHash('sha256').update(content).digest('hex');

          await this.astCache.set({
            filePath: args.file_path,
            fileHash,
            lastModified: stats.mtime,
            language: cacheData.language || args.language || 'unknown',
            parseResult: cacheData.parseResult,
            symbols: cacheData.symbols,
            imports: cacheData.imports,
            exports: cacheData.exports,
            structure: cacheData.structure
          }, parseTimeMs);
        } catch (error: any) {
          // Don't fail the operation if caching fails
          // Logger already handles this in ASTCacheService
        }
      }
    }
  }

  // Legacy execute method for backward compatibility
  async execute(operation: ASTOperation): Promise<any> {
    // Map old operation to new tool names
    const toolNameMap: Record<string, string> = {
      'parse': 'ast_parse',
      'query': 'ast_query',
      'extract_symbols': 'ast_extract_symbols',
      'extract_imports': 'ast_extract_imports',
      'extract_exports': 'ast_extract_exports',
      'find_pattern': 'ast_find_pattern',
      'get_structure': 'ast_get_structure',
      'get_diagnostics': 'ast_get_diagnostics'
    };

    const toolName = toolNameMap[operation.operation];
    if (!toolName) {
      return { success: false, error: `Unknown operation: ${operation.operation}` };
    }

    // Convert operation parameters to args format
    const args = {
      file_path: operation.file_path,
      language: operation.language,
      query: operation.query,
      pattern: operation.pattern,
      include_positions: operation.include_positions,
      include_text: operation.include_text,
      compact: operation.operation === 'parse' && operation.include_text === false
    };

    return this.executeByToolName(toolName, args);
  }

  private simplifyAST(node: any): any {
    // Convert tree-sitter node to simpler JSON structure
    return {
      type: node.type,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      children: node.children.map((child: any) => this.simplifyAST(child))
    };
  }

  /**
   * Create a compact tree with only semantically significant nodes
   * Filters out syntactic noise like punctuation and statement wrappers
   */
  private createCompactTree(node: any, language: string): any | null {
    // Define semantically significant node types per language
    const significantNodes: Record<string, Set<string>> = {
      typescript: new Set([
        'program',
        'import_statement',
        'export_statement',
        'class_declaration',
        'interface_declaration',
        'type_alias_declaration',
        'enum_declaration',
        'function_declaration',
        'arrow_function',
        'method_definition',
        'property_declaration',
        'public_field_definition',
        'variable_declaration',
        'lexical_declaration',
        'parameter',
        'type_parameter',
        'extends_clause',
        'implements_clause',
        'decorator',
        'comment'
      ]),
      javascript: new Set([
        'program',
        'import_statement',
        'export_statement',
        'class_declaration',
        'function_declaration',
        'arrow_function',
        'method_definition',
        'field_definition',
        'variable_declaration',
        'lexical_declaration',
        'parameter',
        'extends_clause',
        'comment'
      ]),
      python: new Set([
        'module',
        'import_statement',
        'import_from_statement',
        'class_definition',
        'function_definition',
        'decorated_definition',
        'parameter',
        'default_parameter',
        'typed_parameter',
        'assignment',
        'expression_statement',
        'return_statement',
        'raise_statement',
        'assert_statement',
        'if_statement',
        'for_statement',
        'while_statement',
        'with_statement',
        'try_statement',
        'comment'
      ])
    };

    // Nodes to always exclude (syntactic noise)
    const noiseNodes = new Set([
      'block',
      'statement_block',
      'expression_statement',
      'parenthesized_expression',
      'formal_parameters',
      'arguments',
      '{', '}', '(', ')', ';', ',', ':', '.',
      'template_string',
      'template_substitution'
    ]);

    // Check if this node should be excluded
    if (noiseNodes.has(node.type)) {
      // Still traverse children to find significant nodes within
      const children: any[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          const compactChild = this.createCompactTree(child, language);
          if (compactChild) {
            children.push(compactChild);
          }
        }
      }
      // If we found significant children, return them directly (flattening)
      if (children.length === 1) {
        return children[0];
      } else if (children.length > 1) {
        // Return a wrapper node only if multiple significant children
        return {
          type: 'group',
          children
        };
      }
      return null;
    }

    // Get the set of significant nodes for this language
    const significant = significantNodes[language] || significantNodes.typescript;

    // Check if this node is significant
    const isSignificant = significant.has(node.type) ||
                          node.type.includes('declaration') ||
                          node.type.includes('definition') ||
                          node.type.includes('statement') && !node.type.includes('expression_statement');

    if (!isSignificant && node.type !== 'program' && node.type !== 'module') {
      // Not significant, but traverse children
      const children: any[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          const compactChild = this.createCompactTree(child, language);
          if (compactChild) {
            children.push(compactChild);
          }
        }
      }
      // Return children directly if any found
      if (children.length === 1) {
        return children[0];
      } else if (children.length > 1) {
        return {
          type: 'group',
          children
        };
      }
      return null;
    }

    // This is a significant node - build compact representation
    const compactNode: any = {
      type: node.type,
      line: node.startPosition.row + 1
    };

    // Extract name for named nodes
    const nameNode = node.childForFieldName?.('name');
    if (nameNode) {
      compactNode.name = nameNode.text;
    } else if (node.type === 'import_statement' || node.type === 'import_from_statement') {
      // For imports, get the module/source
      const sourceNode = node.childForFieldName?.('source') || node.childForFieldName?.('module_name');
      if (sourceNode) {
        compactNode.name = sourceNode.text.replace(/['"]/g, '');
      }
    } else if (node.type === 'variable_declaration' || node.type === 'lexical_declaration') {
      // For variable declarations, try to get the identifier
      const declarator = node.child(1); // Usually the declarator is the second child
      if (declarator) {
        const id = declarator.childForFieldName?.('name') || declarator.child(0);
        if (id && id.type === 'identifier') {
          compactNode.name = id.text;
        }
      }
    }

    // Add modifiers if present
    const modifiers: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && ['export', 'async', 'static', 'public', 'private', 'protected', 'readonly', 'const', 'let', 'var'].includes(child.type)) {
        modifiers.push(child.type);
      }
    }
    if (modifiers.length > 0) {
      compactNode.modifiers = modifiers;
    }

    // Process children
    const children: any[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        const compactChild = this.createCompactTree(child, language);
        if (compactChild) {
          children.push(compactChild);
        }
      }
    }

    if (children.length > 0) {
      compactNode.children = children;
    }

    return compactNode;
  }

  /**
   * Generate semantic hash for a node (for duplicate detection)
   * Hashes the structure and names, not the exact text
   */
  private generateSemanticHash(node: any): string {
    const crypto = require('crypto');
    const hashContent: string[] = [];

    const traverse = (n: any): void => {
      if (!n) return;
      // Include type and name, but not exact text or positions
      hashContent.push(n.type);
      if (n.name) hashContent.push(n.name);
      if (n.modifiers) hashContent.push(...n.modifiers);
      if (n.children) {
        n.children.forEach((child: any) => traverse(child));
      }
    };

    traverse(node);
    const hashString = hashContent.join('|');
    return crypto.createHash('sha256').update(hashString).digest('hex').substring(0, 16);
  }

  /**
   * Build symbol table from compact tree
   * Maps repeated strings to short symbols (@1, @2, etc.)
   */
  private buildSymbolTable(compactTree: any): { tree: any; symbolTable: Record<string, string> } {
    const stringCounts: Map<string, number> = new Map();
    const symbolTable: Record<string, string> = {};
    let symbolIndex = 1;

    // First pass: count string occurrences
    const countStrings = (node: any): void => {
      if (!node) return;
      if (node.name && typeof node.name === 'string' && node.name.length > 5) {
        stringCounts.set(node.name, (stringCounts.get(node.name) || 0) + 1);
      }
      if (node.children) {
        node.children.forEach((child: any) => countStrings(child));
      }
    };

    countStrings(compactTree);

    // Build symbol table for strings that appear 3+ times
    for (const [str, count] of stringCounts.entries()) {
      if (count >= 3) {
        const symbol = `@${symbolIndex++}`;
        symbolTable[symbol] = str;
      }
    }

    // Second pass: replace strings with symbols
    const replaceWithSymbols = (node: any): any => {
      if (!node) return node;

      const newNode = { ...node };

      // Replace name if it's in symbol table
      if (newNode.name && typeof newNode.name === 'string') {
        for (const [symbol, str] of Object.entries(symbolTable)) {
          if (str === newNode.name) {
            newNode.name = symbol;
            break;
          }
        }
      }

      if (newNode.children) {
        newNode.children = newNode.children.map((child: any) => replaceWithSymbols(child));
      }

      return newNode;
    };

    const optimizedTree = replaceWithSymbols(compactTree);
    return { tree: optimizedTree, symbolTable };
  }

  /**
   * Apply depth-limited pruning
   * Only traverse to specified depth for quick overviews
   */
  private applyDepthLimit(node: any, maxDepth: number, currentDepth: number = 0): any | null {
    if (currentDepth >= maxDepth) {
      // At max depth, return node without children
      const { children, ...nodeWithoutChildren } = node;
      return {
        ...nodeWithoutChildren,
        _depth_limited: true,
        _child_count: children?.length || 0
      };
    }

    if (!node.children || node.children.length === 0) {
      return node;
    }

    return {
      ...node,
      children: node.children
        .map((child: any) => this.applyDepthLimit(child, maxDepth, currentDepth + 1))
        .filter((child: any) => child !== null)
    };
  }

  /**
   * Remove redundant text from simple nodes
   */
  private omitRedundantText(node: any): any {
    if (!node) return node;

    const newNode = { ...node };

    // For simple identifier nodes, type and name are sufficient
    const simpleTypes = new Set(['identifier', 'parameter', 'property_declaration']);
    if (simpleTypes.has(node.type)) {
      delete newNode.text;
    }

    if (newNode.children) {
      newNode.children = newNode.children.map((child: any) => this.omitRedundantText(child));
    }

    return newNode;
  }

  /**
   * Generate a human-readable Markdown structure from the compact tree
   */
  private getFileStructure(tree: any, language: string): string {
    const compactTree = this.createCompactTree(tree.rootNode, language);
    if (!compactTree) {
      return "# File Structure\n\nNo significant structure found.";
    }

    const lines: string[] = ["# File Structure\n"];

    const renderNode = (node: any, indent: number = 0): void => {
      if (!node) return;

      const indentStr = "  ".repeat(indent);
      const prefix = indent === 0 ? "## " : indent === 1 ? "### " : "- ";

      // Format the node for display
      let display = "";

      switch (node.type) {
        case 'program':
        case 'module':
          // Don't display root node, just process children
          if (node.children) {
            node.children.forEach((child: any) => renderNode(child, indent));
          }
          return;

        case 'import_statement':
        case 'import_from_statement':
          display = `📦 Import: \`${node.name || 'unknown'}\``;
          break;

        case 'export_statement':
          display = `📤 Export${node.name ? `: \`${node.name}\`` : ''}`;
          break;

        case 'class_declaration':
        case 'class_definition':
          display = `🏗️ Class: **${node.name || 'anonymous'}**`;
          break;

        case 'interface_declaration':
          display = `📋 Interface: **${node.name || 'anonymous'}**`;
          break;

        case 'type_alias_declaration':
          display = `🏷️ Type: **${node.name || 'anonymous'}**`;
          break;

        case 'function_declaration':
        case 'function_definition':
          display = `🔧 Function: **${node.name || 'anonymous'}**`;
          break;

        case 'arrow_function':
          display = `➡️ Arrow Function${node.name ? `: **${node.name}**` : ''}`;
          break;

        case 'method_definition':
          display = `⚙️ Method: **${node.name || 'anonymous'}**`;
          break;

        case 'property_declaration':
        case 'public_field_definition':
        case 'field_definition':
          display = `📌 Property: \`${node.name || 'unknown'}\``;
          break;

        case 'variable_declaration':
        case 'lexical_declaration':
          display = `📝 Variable: \`${node.name || 'unknown'}\``;
          break;

        case 'parameter':
        case 'typed_parameter':
          display = `▪️ Param: \`${node.name || node.type}\``;
          break;

        case 'decorator':
          display = `🎨 Decorator`;
          break;

        case 'comment':
          display = `💬 Comment`;
          break;

        case 'group':
          // Just process children for group nodes
          if (node.children) {
            node.children.forEach((child: any) => renderNode(child, indent));
          }
          return;

        default:
          // For other significant nodes, show type and name if available
          display = node.name ? `${node.type}: **${node.name}**` : node.type;
      }

      // Add modifiers if present
      if (node.modifiers && node.modifiers.length > 0) {
        display = `[${node.modifiers.join(', ')}] ${display}`;
      }

      // Add line number
      if (node.line) {
        display += ` *(line ${node.line})*`;
      }

      lines.push(`${indentStr}${prefix}${display}`);

      // Render children
      if (node.children && node.children.length > 0) {
        // Group children by type for better organization
        const childGroups: Record<string, any[]> = {};

        node.children.forEach((child: any) => {
          const groupKey = child.type || 'other';
          if (!childGroups[groupKey]) {
            childGroups[groupKey] = [];
          }
          childGroups[groupKey].push(child);
        });

        // Render imports first, then exports, then other declarations
        const renderOrder = [
          'import_statement', 'import_from_statement',
          'export_statement',
          'class_declaration', 'class_definition',
          'interface_declaration', 'type_alias_declaration',
          'function_declaration', 'function_definition',
          'method_definition',
          'property_declaration', 'public_field_definition', 'field_definition',
          'variable_declaration', 'lexical_declaration'
        ];

        // Render in priority order
        renderOrder.forEach(type => {
          if (childGroups[type]) {
            childGroups[type].forEach((child: any) => renderNode(child, indent + 1));
            delete childGroups[type];
          }
        });

        // Render remaining types
        Object.values(childGroups).forEach(group => {
          group.forEach((child: any) => renderNode(child, indent + 1));
        });
      }
    };

    renderNode(compactTree, 0);

    // Add summary statistics
    lines.push("\n## Summary");
    const stats = this.gatherStatistics(compactTree);
    lines.push(`- **Imports**: ${stats.imports}`);
    lines.push(`- **Exports**: ${stats.exports}`);
    lines.push(`- **Classes**: ${stats.classes}`);
    lines.push(`- **Functions**: ${stats.functions}`);
    lines.push(`- **Interfaces**: ${stats.interfaces}`);

    return lines.join("\n");
  }

  /**
   * Gather statistics from the compact tree
   */
  private gatherStatistics(node: any): any {
    const stats = {
      imports: 0,
      exports: 0,
      classes: 0,
      functions: 0,
      interfaces: 0,
      methods: 0,
      properties: 0
    };

    const traverse = (n: any): void => {
      if (!n) return;

      switch (n.type) {
        case 'import_statement':
        case 'import_from_statement':
          stats.imports++;
          break;
        case 'export_statement':
          stats.exports++;
          break;
        case 'class_declaration':
        case 'class_definition':
          stats.classes++;
          break;
        case 'function_declaration':
        case 'function_definition':
        case 'arrow_function':
          stats.functions++;
          break;
        case 'interface_declaration':
          stats.interfaces++;
          break;
        case 'method_definition':
          stats.methods++;
          break;
        case 'property_declaration':
        case 'public_field_definition':
        case 'field_definition':
          stats.properties++;
          break;
      }

      if (n.children) {
        n.children.forEach((child: any) => traverse(child));
      }
    };

    traverse(node);
    return stats;
  }
}