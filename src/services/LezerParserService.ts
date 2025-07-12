/**
 * Universal code parser using Lezer for robust AST-based analysis
 * Supports multiple programming languages with improved reliability over Tree-sitter
 * Drop-in replacement for TreeSitterParser with better performance and stability
 */

import { parser as javascriptParser } from '@lezer/javascript';
import { parser as cssParser } from '@lezer/css';
import { parser as htmlParser } from '@lezer/html';
import { parser as jsonParser } from '@lezer/json';
import { parser as pythonParser } from '@lezer/python';
import { parser as javaParser } from '@lezer/java';
import { parser as cppParser } from '@lezer/cpp';
import { parser as rustParser } from '@lezer/rust';
import { parser as phpParser } from '@lezer/php';
import { LRParser } from '@lezer/lr';
import type { SyntaxNode, Tree } from '@lezer/common';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';

export interface ParsedSymbol {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'constant' | 'enum' | 'method';
  line: number;
  column: number;
  isExported: boolean;
  signature?: string;
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  imports: string[];
  exports: string[];
  language: string;
  parseSuccess: boolean;
}

/**
 * Lezer-based parser with language detection and AST analysis
 * Compatible with TreeSitterParser interface for drop-in replacement
 */
export class LezerParserService {
  private parsers: Map<string, LRParser> = new Map();
  private languageMap: Map<string, string> = new Map();

  constructor() {
    this.initializeParsers();
  }

  /**
   * Initialize all available language parsers
   */
  private initializeParsers(): void {
    // JavaScript/TypeScript (Lezer JavaScript parser handles both)
    this.registerLanguage(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'], javascriptParser, 'javascript');
    
    // Python
    this.registerLanguage(['.py', '.pyi', '.py3'], pythonParser, 'python');
    
    // Java
    this.registerLanguage(['.java'], javaParser, 'java');
    
    // C++/C (using cpp parser for both)
    this.registerLanguage(['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.c', '.h'], cppParser, 'cpp');
    
    // Rust
    this.registerLanguage(['.rs'], rustParser, 'rust');
    
    // Web languages
    this.registerLanguage(['.php', '.php3', '.php4', '.php5', '.phtml'], phpParser, 'php');
    this.registerLanguage(['.html', '.htm', '.xhtml'], htmlParser, 'html');
    this.registerLanguage(['.css', '.scss', '.sass'], cssParser, 'css');
    
    // Data languages
    this.registerLanguage(['.json', '.jsonc'], jsonParser, 'json');
  }

  /**
   * Register a language parser for specific file extensions
   */
  private registerLanguage(extensions: string[], parser: LRParser, languageName: string): void {
    for (const ext of extensions) {
      this.parsers.set(ext.toLowerCase(), parser);
      this.languageMap.set(ext.toLowerCase(), languageName);
    }
  }

  /**
   * Parse a file and extract symbols, imports, and exports
   */
  public async parseFile(filePath: string, content: string): Promise<ParseResult> {
    const extension = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath).toLowerCase();
    
    // Check for special filenames
    let parser = this.parsers.get(extension) || this.parsers.get(filename);
    let language = this.languageMap.get(extension) || this.languageMap.get(filename) || 'unknown';
    
    if (!parser) {
      // Fallback for unsupported languages
      return this.fallbackParse(content, language);
    }

    try {
      const tree = parser.parse(content);
      const rootNode = tree.topNode;
      
      const symbols = this.extractSymbols(rootNode, language, content);
      const imports = this.extractImports(rootNode, language, content);
      const exports = this.extractExports(rootNode, language, content, symbols);
      
      return {
        symbols,
        imports,
        exports,
        language,
        parseSuccess: true
      };
    } catch (error) {
      console.warn(`Lezer parsing failed for ${filePath}:`, error);
      return this.fallbackParse(content, language);
    }
  }

  /**
   * Extract symbols (functions, classes, etc.) from AST
   */
  private extractSymbols(node: SyntaxNode, language: string, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    const lines = content.split('\n');
    
    this.traverseNode(node, (node: SyntaxNode) => {
      const symbol = this.extractSymbolFromNode(node, language, content, lines);
      if (symbol) {
        symbols.push(symbol);
      }
    });
    
    return symbols;
  }

  /**
   * Extract symbol information from a specific node
   */
  private extractSymbolFromNode(node: SyntaxNode, language: string, content: string, lines: string[]): ParsedSymbol | null {
    const nodeType = node.type.name;
    const nodeText = content.slice(node.from, node.to);
    
    // Calculate line and column from position
    const { line, column } = this.getLineColumn(node.from, content);
    
    switch (language) {
      case 'javascript':
        return this.extractJavaScriptSymbol(node, nodeType, nodeText, line, column, content);
      
      case 'python':
        return this.extractPythonSymbol(node, nodeType, nodeText, line, column, content);
      
      case 'java':
        return this.extractJavaSymbol(node, nodeType, nodeText, line, column, content);
      
      case 'cpp':
        return this.extractCppSymbol(node, nodeType, nodeText, line, column, content);
      
      case 'rust':
        return this.extractRustSymbol(node, nodeType, nodeText, line, column, content);
      
      case 'php':
        return this.extractPhpSymbol(node, nodeType, nodeText, line, column, content);
      
      default:
        return this.extractGenericSymbol(node, nodeType, nodeText, line, column, content);
    }
  }

  /**
   * Extract JavaScript/TypeScript symbols
   */
  private extractJavaScriptSymbol(node: SyntaxNode, nodeType: string, nodeText: string, line: number, column: number, content: string): ParsedSymbol | null {
    const name = this.extractIdentifierName(node, content);
    if (!name) return null;

    switch (nodeType) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunction':
        return {
          name,
          type: 'function',
          line,
          column,
          isExported: false, // Will be determined later
          signature: nodeText.split('\n')[0].slice(0, 100)
        };
      
      case 'ClassDeclaration':
        return {
          name,
          type: 'class',
          line,
          column,
          isExported: false,
          signature: `class ${name}`
        };
      
      case 'MethodDeclaration':
        return {
          name,
          type: 'method',
          line,
          column,
          isExported: false,
          signature: nodeText.split('\n')[0].slice(0, 100)
        };
      
      case 'InterfaceDeclaration':
        return {
          name,
          type: 'interface',
          line,
          column,
          isExported: false,
          signature: `interface ${name}`
        };
      
      case 'TypeDefinition':
        return {
          name,
          type: 'type',
          line,
          column,
          isExported: false,
          signature: `type ${name}`
        };
      
      case 'VariableDeclaration':
        // For variable declarations, we need to extract from VariableDefinition child
        let varChild = node.firstChild;
        while (varChild) {
          if (varChild.type.name === 'VariableDefinition') {
            const varName = content.slice(varChild.from, varChild.to);
            const { line: varLine, column: varColumn } = this.getLineColumn(varChild.from, content);
            return {
              name: varName,
              type: 'variable',
              line: varLine,
              column: varColumn,
              isExported: false,
              signature: nodeText.split('\n')[0]
            };
          }
          varChild = varChild.nextSibling;
        }
        return null;
      
      case 'VariableDefinition':
        // Direct variable definition (e.g., in class declarations, function parameters)
        return {
          name,
          type: 'variable',
          line,
          column,
          isExported: false,
          signature: nodeText
        };
    }
    
    return null;
  }

  /**
   * Extract Python symbols
   */
  private extractPythonSymbol(node: SyntaxNode, nodeType: string, nodeText: string, line: number, column: number, content: string): ParsedSymbol | null {
    const name = this.extractPythonIdentifierName(node, content);
    if (!name) return null;

    switch (nodeType) {
      case 'FunctionDefinition':
        return {
          name,
          type: 'function',
          line,
          column,
          isExported: true, // Python functions are exported by default
          signature: nodeText.split('\n')[0]
        };
      
      case 'ClassDefinition':
        return {
          name,
          type: 'class',
          line,
          column,
          isExported: true,
          signature: `class ${name}`
        };
      
      case 'AssignStatement':
        // Extract variable assignment
        return {
          name,
          type: 'variable',
          line,
          column,
          isExported: true,
          signature: nodeText.split('\n')[0]
        };
    }
    
    return null;
  }

  /**
   * Extract identifier name from a Python node (slightly different structure)
   */
  private extractPythonIdentifierName(node: SyntaxNode, content: string): string | null {
    // For Python, look for VariableName child nodes
    let current: SyntaxNode | null = node.firstChild;
    while (current) {
      if (current.type.name === 'VariableName') {
        return content.slice(current.from, current.to);
      }
      current = current.nextSibling;
    }
    
    return null;
  }

  /**
   * Extract Java symbols
   */
  private extractJavaSymbol(node: SyntaxNode, nodeType: string, nodeText: string, line: number, column: number, content: string): ParsedSymbol | null {
    const name = this.extractIdentifierName(node, content);
    if (!name) return null;

    switch (nodeType) {
      case 'MethodDeclaration':
        return {
          name,
          type: 'method',
          line,
          column,
          isExported: nodeText.includes('public'),
          signature: nodeText.split('\n')[0]
        };
      
      case 'ClassDeclaration':
        return {
          name,
          type: 'class',
          line,
          column,
          isExported: nodeText.includes('public'),
          signature: `class ${name}`
        };
      
      case 'InterfaceDeclaration':
        return {
          name,
          type: 'interface',
          line,
          column,
          isExported: nodeText.includes('public'),
          signature: `interface ${name}`
        };
    }
    
    return null;
  }

  /**
   * Extract C++ symbols
   */
  private extractCppSymbol(node: SyntaxNode, nodeType: string, nodeText: string, line: number, column: number, content: string): ParsedSymbol | null {
    const name = this.extractIdentifierName(node, content);
    if (!name) return null;

    switch (nodeType) {
      case 'FunctionDefinition':
      case 'FunctionDeclarator':
        return {
          name,
          type: 'function',
          line,
          column,
          isExported: true, // C++ functions are generally exported
          signature: nodeText.split('\n')[0]
        };
      
      case 'ClassDefinition':
      case 'StructDefinition':
        return {
          name,
          type: 'class',
          line,
          column,
          isExported: true,
          signature: `class ${name}`
        };
    }
    
    return null;
  }

  /**
   * Extract Rust symbols
   */
  private extractRustSymbol(node: SyntaxNode, nodeType: string, nodeText: string, line: number, column: number, content: string): ParsedSymbol | null {
    const name = this.extractIdentifierName(node, content);
    if (!name) return null;

    switch (nodeType) {
      case 'FunctionItem':
        return {
          name,
          type: 'function',
          line,
          column,
          isExported: nodeText.includes('pub '),
          signature: nodeText.split('\n')[0]
        };
      
      case 'StructItem':
        return {
          name,
          type: 'class', // Treat structs as classes
          line,
          column,
          isExported: nodeText.includes('pub '),
          signature: `struct ${name}`
        };
      
      case 'EnumItem':
        return {
          name,
          type: 'enum',
          line,
          column,
          isExported: nodeText.includes('pub '),
          signature: `enum ${name}`
        };
    }
    
    return null;
  }

  /**
   * Extract PHP symbols
   */
  private extractPhpSymbol(node: SyntaxNode, nodeType: string, nodeText: string, line: number, column: number, content: string): ParsedSymbol | null {
    const name = this.extractIdentifierName(node, content);
    if (!name) return null;

    switch (nodeType) {
      case 'FunctionDefinition':
        return {
          name,
          type: 'function',
          line,
          column,
          isExported: true,
          signature: nodeText.split('\n')[0]
        };
      
      case 'ClassDeclaration':
        return {
          name,
          type: 'class',
          line,
          column,
          isExported: true,
          signature: `class ${name}`
        };
    }
    
    return null;
  }

  /**
   * Generic symbol extraction for unknown languages
   */
  private extractGenericSymbol(node: SyntaxNode, nodeType: string, nodeText: string, line: number, column: number, content: string): ParsedSymbol | null {
    const name = this.extractIdentifierName(node, content);
    if (!name) return null;

    if (nodeType.toLowerCase().includes('function') || nodeType.toLowerCase().includes('method')) {
      return {
        name,
        type: 'function',
        line,
        column,
        isExported: false,
        signature: nodeText.split('\n')[0].slice(0, 100)
      };
    }
    
    return null;
  }

  /**
   * Extract identifier name from a node
   */
  private extractIdentifierName(node: SyntaxNode, content: string): string | null {
    // Look for identifier child nodes - Lezer uses different naming conventions
    let current: SyntaxNode | null = node.firstChild;
    while (current) {
      if (current.type.name === 'Identifier' || 
          current.type.name === 'TypeIdentifier' ||
          current.type.name === 'VariableDefinition' ||
          current.type.name === 'PropertyDefinition') {
        // Get the text content of the identifier
        return content.slice(current.from, current.to);
      }
      current = current.nextSibling;
    }
    
    return null;
  }

  /**
   * Extract imports from AST
   */
  private extractImports(node: SyntaxNode, language: string, content: string): string[] {
    const imports: string[] = [];
    
    this.traverseNode(node, (node: SyntaxNode) => {
      const importName = this.extractImportFromNode(node, language, content);
      if (importName) {
        imports.push(importName);
      }
    });
    
    return Array.from(new Set(imports)); // Remove duplicates
  }

  /**
   * Extract import from a specific node
   */
  private extractImportFromNode(node: SyntaxNode, language: string, content: string): string | null {
    const nodeType = node.type.name;
    const nodeText = content.slice(node.from, node.to);

    switch (language) {
      case 'javascript':
        if (nodeType === 'ImportDeclaration') {
          const match = nodeText.match(/from\s+['"]([^'"]+)['"]/);
          return match ? match[1] : null;
        }
        break;
      
      case 'python':
        if (nodeType === 'ImportStatement' || nodeType === 'ImportFromStatement') {
          const match = nodeText.match(/(?:from\s+(\S+)\s+)?import\s+(\S+)/);
          return match ? (match[1] || match[2]) : null;
        }
        break;
      
      case 'java':
        if (nodeType === 'ImportDeclaration') {
          const match = nodeText.match(/import\s+([^;]+);/);
          return match ? match[1].trim() : null;
        }
        break;
      
      case 'rust':
        if (nodeType === 'UseDeclaration') {
          const match = nodeText.match(/use\s+([^;]+);/);
          return match ? match[1].trim() : null;
        }
        break;
    }
    
    return null;
  }

  /**
   * Extract exports from AST
   */
  private extractExports(node: SyntaxNode, language: string, content: string, symbols: ParsedSymbol[]): string[] {
    const exports: string[] = [];
    
    this.traverseNode(node, (node: SyntaxNode) => {
      const exportName = this.extractExportFromNode(node, language, content, symbols);
      if (exportName) {
        exports.push(exportName);
      }
    });
    
    return exports;
  }

  /**
   * Extract export from a specific node
   */
  private extractExportFromNode(node: SyntaxNode, language: string, content: string, symbols: ParsedSymbol[]): string | null {
    const nodeType = node.type.name;
    const nodeText = content.slice(node.from, node.to);

    if (language === 'javascript') {
      if (nodeType === 'ExportDeclaration') {
        // Mark related symbols as exported
        this.markSymbolsAsExported(nodeText, symbols);
        
        // Extract export names - handle both direct exports and named exports
        const exportNames: string[] = [];
        
        // Check for export group (e.g., export { TestClass, testFunction })
        let child = node.firstChild;
        while (child) {
          if (child.type.name === 'ExportGroup') {
            let groupChild = child.firstChild;
            while (groupChild) {
              if (groupChild.type.name === 'VariableName') {
                const name = content.slice(groupChild.from, groupChild.to);
                exportNames.push(name);
              }
              groupChild = groupChild.nextSibling;
            }
          } else if (child.type.name === 'VariableName' || child.type.name === 'VariableDefinition') {
            // Handle direct exports like export default testVariable
            const name = content.slice(child.from, child.to);
            exportNames.push(name);
          }
          child = child.nextSibling;
        }
        
        return exportNames.length > 0 ? exportNames.join(', ') : null;
      }
    }
    
    return null;
  }

  /**
   * Mark symbols as exported based on export statements
   */
  private markSymbolsAsExported(exportText: string, symbols: ParsedSymbol[]): void {
    for (const symbol of symbols) {
      if (exportText.includes(symbol.name)) {
        symbol.isExported = true;
      }
    }
  }

  /**
   * Get line and column from string position
   */
  private getLineColumn(position: number, content: string): { line: number; column: number } {
    const beforePosition = content.slice(0, position);
    const lines = beforePosition.split('\n');
    
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1
    };
  }

  /**
   * Traverse all nodes in the tree
   */
  private traverseNode(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    
    let child = node.firstChild;
    while (child) {
      this.traverseNode(child, callback);
      child = child.nextSibling;
    }
  }

  /**
   * Fallback parsing for unsupported file types
   */
  private fallbackParse(content: string, language: string): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: string[] = [];
    const exports: string[] = [];
    
    // Only basic parsing for truly unsupported files
    if (language === 'unknown') {
      return { symbols, imports, exports, language, parseSuccess: false };
    }
    
    return { symbols, imports, exports, language, parseSuccess: false };
  }

  /**
   * Get all supported file extensions
   */
  public getSupportedExtensions(): string[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * Analyze a file and return FileAnalysis compatible format
   */
  public async analyzeFile(filePath: string): Promise<any | null> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const stats = await fs.stat(filePath);
      
      // Generate content hash
      const hash = createHash('sha256').update(content).digest('hex');
      
      // Parse with Lezer
      const parseResult = await this.parseFile(filePath, content);
      
      if (!parseResult.parseSuccess) {
        return null;
      }
      
      return {
        filePath,
        hash,
        lastModified: stats.mtime,
        symbols: parseResult.symbols,
        imports: parseResult.imports,
        exports: parseResult.exports,
        size: stats.size,
        language: parseResult.language
      };
    } catch (error) {
      console.warn(`Failed to analyze file ${filePath}:`, error);
      return null;
    }
  }
}