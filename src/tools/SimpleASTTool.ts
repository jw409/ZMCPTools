/**
 * Simple AST parsing tool using TypeScript compiler API
 * Provides AST parsing without external dependencies
 *
 * Core capabilities:
 * - Parse TypeScript/JavaScript into AST
 * - Extract symbols, imports, exports, and structure
 * - Generate compact tree representation for LLMs
 * - Support for multiple languages (extensible)
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as ts from "typescript";

interface ParseResult {
  success: boolean;
  language: string;
  tree?: any;
  compactTree?: any;
  errors?: ParseError[];
}

interface ParseError {
  type: string;
  message: string;
  line: number;
  column: number;
}

interface Symbol {
  name: string;
  type: string; // function, class, method, variable, etc.
  line: number;
  modifiers?: string[];
}

export class SimpleASTTool {

  /**
   * Detect language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const extMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.py': 'python',
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

  /**
   * Parse source file into AST
   */
  async parse(filePath: string, language?: string): Promise<ParseResult> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.parseFromContent(content, filePath, language);
    } catch (error) {
      return {
        success: false,
        language: 'unknown',
        errors: [{
          type: 'read_error',
          message: error instanceof Error ? error.message : 'Failed to read file',
          line: 0,
          column: 0
        }]
      };
    }
  }

  /**
   * Parse source code from content (no file I/O)
   * Useful for benchmarking or when content is already in memory
   */
  parseFromContent(content: string, filePath: string, language?: string): ParseResult {
    try {
      const detectedLanguage = language || this.detectLanguage(filePath);

      // For now, only support TypeScript/JavaScript
      if (!['typescript', 'javascript'].includes(detectedLanguage)) {
        // For other languages, return a simple structure
        return {
          success: true,
          language: detectedLanguage,
          tree: { type: 'unsupported', message: `Parser for ${detectedLanguage} not yet implemented` }
        };
      }

      // Parse with TypeScript compiler (lightweight - no full program creation)
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );

      // Create compact tree
      const compactTree = this.createCompactTree(sourceFile);

      return {
        success: true,
        language: detectedLanguage,
        tree: sourceFile,
        compactTree
      };
    } catch (error) {
      return {
        success: false,
        language: 'unknown',
        errors: [{
          type: 'parse_error',
          message: error instanceof Error ? error.message : 'Failed to parse content',
          line: 0,
          column: 0
        }]
      };
    }
  }

  /**
   * Extract symbols from TypeScript AST
   */
  async extractSymbols(sourceFile: ts.SourceFile): Promise<Symbol[]> {
    const symbols: Symbol[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.pos);
        symbols.push({
          name: node.name.text,
          type: 'function',
          line: line + 1,
          modifiers: node.modifiers?.map(m => ts.SyntaxKind[m.kind]) || []
        });
      } else if (ts.isClassDeclaration(node) && node.name) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.pos);
        symbols.push({
          name: node.name.text,
          type: 'class',
          line: line + 1,
          modifiers: node.modifiers?.map(m => ts.SyntaxKind[m.kind]) || []
        });
      } else if (ts.isInterfaceDeclaration(node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.pos);
        symbols.push({
          name: node.name.text,
          type: 'interface',
          line: line + 1,
          modifiers: node.modifiers?.map(m => ts.SyntaxKind[m.kind]) || []
        });
      } else if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach(decl => {
          if (ts.isIdentifier(decl.name)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(decl.pos);
            symbols.push({
              name: decl.name.text,
              type: 'variable',
              line: line + 1,
              modifiers: node.modifiers?.map(m => ts.SyntaxKind[m.kind]) || []
            });
          }
        });
      } else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.pos);
        symbols.push({
          name: node.name.text,
          type: 'method',
          line: line + 1,
          modifiers: node.modifiers?.map(m => ts.SyntaxKind[m.kind]) || []
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return symbols;
  }

  /**
   * Extract imports from TypeScript AST
   */
  async extractImports(sourceFile: ts.SourceFile): Promise<string[]> {
    const imports: string[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          imports.push(moduleSpecifier.text);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return imports;
  }

  /**
   * Extract exports from TypeScript AST
   */
  async extractExports(sourceFile: ts.SourceFile): Promise<string[]> {
    const exports: string[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          exports.push(`export from ${node.moduleSpecifier.text}`);
        } else {
          exports.push('export');
        }
      } else if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isFunctionDeclaration(node) && node.name) {
          exports.push(`export function ${node.name.text}`);
        } else if (ts.isClassDeclaration(node) && node.name) {
          exports.push(`export class ${node.name.text}`);
        } else if (ts.isInterfaceDeclaration(node)) {
          exports.push(`export interface ${node.name.text}`);
        } else if (ts.isVariableStatement(node)) {
          node.declarationList.declarations.forEach(decl => {
            if (ts.isIdentifier(decl.name)) {
              exports.push(`export ${decl.name.text}`);
            }
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return exports;
  }

  /**
   * Create compact tree representation (filter syntactic noise)
   */
  private createCompactTree(sourceFile: ts.SourceFile): any {
    const significantKinds = new Set([
      ts.SyntaxKind.SourceFile,
      ts.SyntaxKind.ImportDeclaration,
      ts.SyntaxKind.ExportDeclaration,
      ts.SyntaxKind.ClassDeclaration,
      ts.SyntaxKind.InterfaceDeclaration,
      ts.SyntaxKind.TypeAliasDeclaration,
      ts.SyntaxKind.FunctionDeclaration,
      ts.SyntaxKind.MethodDeclaration,
      ts.SyntaxKind.PropertyDeclaration,
      ts.SyntaxKind.VariableDeclaration,
      ts.SyntaxKind.VariableStatement,
      ts.SyntaxKind.ArrowFunction,
      ts.SyntaxKind.Constructor
    ]);

    const createCompactNode = (node: ts.Node): any | null => {
      if (!significantKinds.has(node.kind)) {
        // Check children for significant nodes
        const children: any[] = [];
        ts.forEachChild(node, child => {
          const compactChild = createCompactNode(child);
          if (compactChild) {
            children.push(compactChild);
          }
        });
        return children.length > 0 ? { type: 'group', children } : null;
      }

      const { line } = sourceFile.getLineAndCharacterOfPosition(node.pos);
      const result: any = {
        type: ts.SyntaxKind[node.kind],
        line: line + 1
      };

      // Add name if available
      if ('name' in node && node.name && ts.isIdentifier(node.name)) {
        result.name = node.name.text;
      }

      // Add modifiers if available (check for specific node types that have modifiers)
      if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) ||
          ts.isInterfaceDeclaration(node) || ts.isVariableStatement(node) ||
          ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) {
        if (node.modifiers) {
          result.modifiers = Array.from(node.modifiers).map((m: ts.Modifier) => ts.SyntaxKind[m.kind]);
        }
      }

      // Add children
      const children: any[] = [];
      ts.forEachChild(node, child => {
        const compactChild = createCompactNode(child);
        if (compactChild) {
          children.push(compactChild);
        }
      });

      if (children.length > 0) {
        result.children = children;
      }

      return result;
    };

    return createCompactNode(sourceFile);
  }

  /**
   * Generate Markdown structure from compact tree
   */
  getFileStructure(compactTree: any, language: string): string {
    const lines: string[] = ['# File Structure\n'];

    const renderNode = (node: any, indent: number = 0): void => {
      if (!node) return;

      const indentStr = '  '.repeat(indent);
      const prefix = indent > 0 ? '- ' : '';
      let display = '';

      switch (node.type) {
        case 'ImportDeclaration':
          display = `📦 Import${node.name ? `: \`${node.name}\`` : ''}`;
          break;
        case 'ExportDeclaration':
          display = `📤 Export${node.name ? `: \`${node.name}\`` : ''}`;
          break;
        case 'ClassDeclaration':
          display = `🏗️ Class: **${node.name || 'anonymous'}**`;
          break;
        case 'InterfaceDeclaration':
          display = `📐 Interface: **${node.name || 'anonymous'}**`;
          break;
        case 'FunctionDeclaration':
          display = `🔧 Function: **${node.name || 'anonymous'}**`;
          break;
        case 'MethodDeclaration':
          display = `⚙️ Method: **${node.name || 'anonymous'}**`;
          break;
        case 'PropertyDeclaration':
          display = `📌 Property: \`${node.name || 'unknown'}\``;
          break;
        case 'VariableDeclaration':
        case 'VariableStatement':
          display = `📝 Variable${node.name ? `: \`${node.name}\`` : ''}`;
          break;
        case 'group':
          // Process children without displaying group
          if (node.children) {
            node.children.forEach((child: any) => renderNode(child, indent));
          }
          return;
        default:
          if (node.children && node.children.length > 0) {
            // Process children for other node types
            node.children.forEach((child: any) => renderNode(child, indent));
            return;
          }
          return;
      }

      // Add modifiers
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
        node.children.forEach((child: any) => renderNode(child, indent + 1));
      }
    };

    renderNode(compactTree, 0);

    // Add summary
    lines.push('\n## Summary');
    const stats = this.gatherStatistics(compactTree);
    lines.push(`- **Imports**: ${stats.imports}`);
    lines.push(`- **Exports**: ${stats.exports}`);
    lines.push(`- **Classes**: ${stats.classes}`);
    lines.push(`- **Functions**: ${stats.functions}`);
    lines.push(`- **Interfaces**: ${stats.interfaces}`);

    return lines.join('\n');
  }

  /**
   * Gather statistics from compact tree
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
        case 'ImportDeclaration':
          stats.imports++;
          break;
        case 'ExportDeclaration':
          stats.exports++;
          break;
        case 'ClassDeclaration':
          stats.classes++;
          break;
        case 'FunctionDeclaration':
        case 'ArrowFunction':
          stats.functions++;
          break;
        case 'InterfaceDeclaration':
          stats.interfaces++;
          break;
        case 'MethodDeclaration':
          stats.methods++;
          break;
        case 'PropertyDeclaration':
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

  /**
   * Get MCP tools
   */
  getTools(): Tool[] {
    return [
      {
        name: "ast_parse",
        description: "Parse source code into an Abstract Syntax Tree. Returns compact structure for TypeScript/JavaScript.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the source code file"
            },
            compact: {
              type: "boolean",
              description: "Return compact tree only (default: true)"
            }
          },
          required: ["file_path"]
        }
      },
      {
        name: "ast_extract_symbols",
        description: "Extract all symbols (functions, classes, methods, interfaces) from TypeScript/JavaScript code.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the source code file"
            }
          },
          required: ["file_path"]
        }
      },
      {
        name: "ast_extract_imports",
        description: "Extract all import statements from TypeScript/JavaScript code.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the source code file"
            }
          },
          required: ["file_path"]
        }
      },
      {
        name: "ast_extract_exports",
        description: "Extract all export statements from TypeScript/JavaScript code.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the source code file"
            }
          },
          required: ["file_path"]
        }
      },
      {
        name: "ast_get_structure",
        description: "Get a Markdown-formatted overview of TypeScript/JavaScript code structure.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the source code file"
            }
          },
          required: ["file_path"]
        }
      }
    ];
  }

  /**
   * Execute AST operation based on tool name
   */
  async executeByToolName(toolName: string, args: any): Promise<any> {
    const parseResult = await this.parse(args.file_path);

    if (!parseResult.success || !parseResult.tree) {
      return {
        success: false,
        errors: parseResult.errors
      };
    }

    switch (toolName) {
      case "ast_parse":
        return {
          success: true,
          language: parseResult.language,
          compactTree: parseResult.compactTree,
          structure: this.getFileStructure(parseResult.compactTree, parseResult.language)
        };

      case "ast_extract_symbols":
        if (!['typescript', 'javascript'].includes(parseResult.language)) {
          return { success: false, error: `Symbol extraction not supported for ${parseResult.language}` };
        }
        const symbols = await this.extractSymbols(parseResult.tree);
        return {
          success: true,
          symbols,
          symbolCount: symbols.length
        };

      case "ast_extract_imports":
        if (!['typescript', 'javascript'].includes(parseResult.language)) {
          return { success: false, error: `Import extraction not supported for ${parseResult.language}` };
        }
        const imports = await this.extractImports(parseResult.tree);
        return {
          success: true,
          imports,
          importCount: imports.length
        };

      case "ast_extract_exports":
        if (!['typescript', 'javascript'].includes(parseResult.language)) {
          return { success: false, error: `Export extraction not supported for ${parseResult.language}` };
        }
        const exports = await this.extractExports(parseResult.tree);
        return {
          success: true,
          exports,
          exportCount: exports.length
        };

      case "ast_get_structure":
        if (parseResult.compactTree) {
          return {
            success: true,
            structure: this.getFileStructure(parseResult.compactTree, parseResult.language),
            statistics: this.gatherStatistics(parseResult.compactTree)
          };
        }
        return {
          success: false,
          error: "Could not generate structure"
        };

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`
        };
    }
  }
}