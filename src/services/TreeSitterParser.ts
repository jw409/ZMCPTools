/**
 * Universal code parser using Tree-sitter for robust AST-based analysis
 * Supports 20+ programming languages with fallback for unsupported file types
 */

import Parser from 'tree-sitter';
import * as path from 'path';

// Language parsers
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
import Cpp from 'tree-sitter-cpp';
import C from 'tree-sitter-c';
import Rust from 'tree-sitter-rust';
import Go from 'tree-sitter-go';
import Kotlin from 'tree-sitter-kotlin';
import Dart from 'tree-sitter-dart';
import PHP from 'tree-sitter-php';
import Ruby from 'tree-sitter-ruby';
import Bash from 'tree-sitter-bash';
import HTML from 'tree-sitter-html';
import CSS from 'tree-sitter-css';
import JSON from 'tree-sitter-json';
import YAML from 'tree-sitter-yaml';
import TOML from 'tree-sitter-toml';
// import Dockerfile from 'tree-sitter-dockerfile';
// import Markdown from 'tree-sitter-markdown';

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
 * Universal Tree-sitter based parser with language detection and AST analysis
 */
export class TreeSitterParser {
  private parsers: Map<string, Parser> = new Map();
  private languageMap: Map<string, any> = new Map();

  constructor() {
    this.initializeParsers();
  }

  /**
   * Initialize all available language parsers
   */
  private initializeParsers(): void {
    // JavaScript/TypeScript
    this.registerLanguage(['.js', '.jsx', '.mjs', '.cjs'], JavaScript, 'javascript');
    this.registerLanguage(['.ts', '.tsx'], TypeScript.typescript, 'typescript');
    
    // System languages
    this.registerLanguage(['.py', '.pyi', '.py3'], Python, 'python');
    this.registerLanguage(['.java'], Java, 'java');
    this.registerLanguage(['.cpp', '.cc', '.cxx', '.hpp', '.hxx'], Cpp, 'cpp');
    this.registerLanguage(['.c', '.h'], C, 'c');
    this.registerLanguage(['.rs'], Rust, 'rust');
    this.registerLanguage(['.go'], Go, 'go');
    
    // Mobile/Modern languages
    this.registerLanguage(['.kt', '.kts'], Kotlin, 'kotlin');
    this.registerLanguage(['.dart'], Dart, 'dart');
    
    // Web languages
    this.registerLanguage(['.php', '.php3', '.php4', '.php5', '.phtml'], PHP, 'php');
    this.registerLanguage(['.rb', '.ruby', '.rbw'], Ruby, 'ruby');
    this.registerLanguage(['.html', '.htm', '.xhtml'], HTML, 'html');
    this.registerLanguage(['.css', '.scss', '.sass'], CSS, 'css');
    
    // Data/Config languages
    this.registerLanguage(['.json', '.jsonc'], JSON, 'json');
    this.registerLanguage(['.yaml', '.yml'], YAML, 'yaml');
    this.registerLanguage(['.toml'], TOML, 'toml');
    
    // Scripts/Containers
    this.registerLanguage(['.sh', '.bash', '.zsh'], Bash, 'bash');
    // this.registerLanguage(['dockerfile', '.dockerfile'], Dockerfile, 'dockerfile');
    // this.registerLanguage(['.md', '.markdown'], Markdown, 'markdown');
  }

  /**
   * Register a language parser for specific file extensions
   */
  private registerLanguage(extensions: string[], language: any, languageName: string): void {
    try {
      const parser = new Parser();
      parser.setLanguage(language);
      
      for (const ext of extensions) {
        this.parsers.set(ext.toLowerCase(), parser);
        this.languageMap.set(ext.toLowerCase(), languageName);
      }
    } catch (error) {
      console.warn(`Failed to register language ${languageName}:`, error);
      // Skip this language - it will fall back to unsupported parsing
    }
  }

  /**
   * Parse a file and extract symbols, imports, and exports
   */
  public async parseFile(filePath: string, content: string): Promise<ParseResult> {
    const extension = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath).toLowerCase();
    
    // Check for special filenames (like Dockerfile)
    let parser = this.parsers.get(extension) || this.parsers.get(filename);
    let language = this.languageMap.get(extension) || this.languageMap.get(filename) || 'unknown';
    
    if (!parser) {
      // Fallback for unsupported languages
      return this.fallbackParse(content, language);
    }

    try {
      const tree = parser.parse(content);
      const rootNode = tree.rootNode;
      
      const symbols = this.extractSymbols(rootNode, language);
      const imports = this.extractImports(rootNode, language);
      const exports = this.extractExports(rootNode, language, symbols);
      
      return {
        symbols,
        imports,
        exports,
        language,
        parseSuccess: true
      };
    } catch (error) {
      console.warn(`Tree-sitter parsing failed for ${filePath}:`, error);
      return this.fallbackParse(content, language);
    }
  }

  /**
   * Extract symbols (functions, classes, etc.) from AST
   */
  private extractSymbols(node: Parser.SyntaxNode, language: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];
    
    const traverse = (node: Parser.SyntaxNode) => {
      // Language-specific symbol extraction
      switch (language) {
        case 'javascript':
        case 'typescript':
          this.extractJSSymbols(node, symbols);
          break;
        case 'python':
          this.extractPythonSymbols(node, symbols);
          break;
        case 'java':
          this.extractJavaSymbols(node, symbols);
          break;
        case 'rust':
          this.extractRustSymbols(node, symbols);
          break;
        case 'go':
          this.extractGoSymbols(node, symbols);
          break;
        case 'cpp':
        case 'c':
          this.extractCSymbols(node, symbols);
          break;
        default:
          this.extractGenericSymbols(node, symbols);
      }
      
      // Recursively traverse child nodes
      for (const child of node.children) {
        traverse(child);
      }
    };
    
    traverse(node);
    return symbols;
  }

  /**
   * Extract JavaScript/TypeScript symbols
   */
  private extractJSSymbols(node: Parser.SyntaxNode, symbols: ParsedSymbol[]): void {
    switch (node.type) {
      case 'function_declaration':
      case 'function_expression':
      case 'arrow_function':
        const funcName = this.getNameFromNode(node);
        if (funcName) {
          symbols.push({
            name: funcName,
            type: 'function',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: false, // Will be determined later
            signature: node.text.split('\n')[0].slice(0, 100)
          });
        }
        break;
        
      case 'class_declaration':
        const className = this.getNameFromNode(node);
        if (className) {
          symbols.push({
            name: className,
            type: 'class',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: false,
            signature: `class ${className}`
          });
        }
        break;
        
      case 'interface_declaration':
        const interfaceName = this.getNameFromNode(node);
        if (interfaceName) {
          symbols.push({
            name: interfaceName,
            type: 'interface',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: false,
            signature: `interface ${interfaceName}`
          });
        }
        break;
        
      case 'type_alias_declaration':
        const typeName = this.getNameFromNode(node);
        if (typeName) {
          symbols.push({
            name: typeName,
            type: 'type',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: false,
            signature: `type ${typeName}`
          });
        }
        break;
    }
  }

  /**
   * Extract Python symbols
   */
  private extractPythonSymbols(node: Parser.SyntaxNode, symbols: ParsedSymbol[]): void {
    switch (node.type) {
      case 'function_definition':
        const funcName = this.getNameFromNode(node);
        if (funcName) {
          symbols.push({
            name: funcName,
            type: 'function',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: true, // Python functions are exported by default
            signature: node.text.split('\n')[0]
          });
        }
        break;
        
      case 'class_definition':
        const className = this.getNameFromNode(node);
        if (className) {
          symbols.push({
            name: className,
            type: 'class',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: true,
            signature: `class ${className}`
          });
        }
        break;
    }
  }

  /**
   * Extract Java symbols
   */
  private extractJavaSymbols(node: Parser.SyntaxNode, symbols: ParsedSymbol[]): void {
    switch (node.type) {
      case 'method_declaration':
        const methodName = this.getNameFromNode(node);
        if (methodName) {
          symbols.push({
            name: methodName,
            type: 'method',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: node.text.includes('public'),
            signature: node.text.split('\n')[0]
          });
        }
        break;
        
      case 'class_declaration':
        const className = this.getNameFromNode(node);
        if (className) {
          symbols.push({
            name: className,
            type: 'class',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: node.text.includes('public'),
            signature: `class ${className}`
          });
        }
        break;
        
      case 'interface_declaration':
        const interfaceName = this.getNameFromNode(node);
        if (interfaceName) {
          symbols.push({
            name: interfaceName,
            type: 'interface',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: node.text.includes('public'),
            signature: `interface ${interfaceName}`
          });
        }
        break;
    }
  }

  /**
   * Extract Rust symbols
   */
  private extractRustSymbols(node: Parser.SyntaxNode, symbols: ParsedSymbol[]): void {
    switch (node.type) {
      case 'function_item':
        const funcName = this.getNameFromNode(node);
        if (funcName) {
          symbols.push({
            name: funcName,
            type: 'function',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: node.text.includes('pub '),
            signature: node.text.split('\n')[0]
          });
        }
        break;
        
      case 'struct_item':
        const structName = this.getNameFromNode(node);
        if (structName) {
          symbols.push({
            name: structName,
            type: 'class', // Treat structs as classes
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: node.text.includes('pub '),
            signature: `struct ${structName}`
          });
        }
        break;
        
      case 'enum_item':
        const enumName = this.getNameFromNode(node);
        if (enumName) {
          symbols.push({
            name: enumName,
            type: 'enum',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: node.text.includes('pub '),
            signature: `enum ${enumName}`
          });
        }
        break;
    }
  }

  /**
   * Extract Go symbols
   */
  private extractGoSymbols(node: Parser.SyntaxNode, symbols: ParsedSymbol[]): void {
    switch (node.type) {
      case 'function_declaration':
        const funcName = this.getNameFromNode(node);
        if (funcName) {
          symbols.push({
            name: funcName,
            type: 'function',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: funcName[0] === funcName[0].toUpperCase(), // Go export convention
            signature: node.text.split('\n')[0]
          });
        }
        break;
        
      case 'type_declaration':
        const typeName = this.getNameFromNode(node);
        if (typeName) {
          symbols.push({
            name: typeName,
            type: 'type',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: typeName[0] === typeName[0].toUpperCase(),
            signature: `type ${typeName}`
          });
        }
        break;
    }
  }

  /**
   * Extract C/C++ symbols
   */
  private extractCSymbols(node: Parser.SyntaxNode, symbols: ParsedSymbol[]): void {
    switch (node.type) {
      case 'function_definition':
      case 'function_declarator':
        const funcName = this.getNameFromNode(node);
        if (funcName) {
          symbols.push({
            name: funcName,
            type: 'function',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: true, // C functions are generally exported
            signature: node.text.split('\n')[0]
          });
        }
        break;
        
      case 'struct_specifier':
        const structName = this.getNameFromNode(node);
        if (structName) {
          symbols.push({
            name: structName,
            type: 'class',
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1,
            isExported: true,
            signature: `struct ${structName}`
          });
        }
        break;
    }
  }

  /**
   * Generic symbol extraction for unknown languages
   */
  private extractGenericSymbols(node: Parser.SyntaxNode, symbols: ParsedSymbol[]): void {
    // Extract any node that looks like a definition
    if (node.type.includes('function') || node.type.includes('method')) {
      const name = this.getNameFromNode(node);
      if (name) {
        symbols.push({
          name,
          type: 'function',
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          isExported: false,
          signature: node.text.split('\n')[0].slice(0, 100)
        });
      }
    }
  }

  /**
   * Extract name from AST node (looks for identifier children)
   */
  private getNameFromNode(node: Parser.SyntaxNode): string | null {
    // Look for identifier child node
    for (const child of node.children) {
      if (child.type === 'identifier' || child.type === 'type_identifier') {
        return child.text;
      }
    }
    
    // Fallback: look deeper in nested nodes
    for (const child of node.children) {
      const name = this.getNameFromNode(child);
      if (name) return name;
    }
    
    return null;
  }

  /**
   * Extract imports from AST
   */
  private extractImports(node: Parser.SyntaxNode, language: string): string[] {
    const imports: string[] = [];
    
    const traverse = (node: Parser.SyntaxNode) => {
      switch (language) {
        case 'javascript':
        case 'typescript':
          if (node.type === 'import_statement') {
            const source = this.extractStringFromNode(node, 'string');
            if (source) imports.push(source);
          }
          break;
          
        case 'python':
          if (node.type === 'import_statement' || node.type === 'import_from_statement') {
            const moduleName = this.extractModuleName(node);
            if (moduleName) imports.push(moduleName);
          }
          break;
          
        case 'java':
          if (node.type === 'import_declaration') {
            const packageName = this.extractStringFromNode(node, 'scoped_identifier');
            if (packageName) imports.push(packageName);
          }
          break;
          
        case 'rust':
          if (node.type === 'use_declaration') {
            const crateName = this.extractStringFromNode(node, 'scoped_identifier');
            if (crateName) imports.push(crateName);
          }
          break;
          
        case 'go':
          if (node.type === 'import_spec') {
            const packagePath = this.extractStringFromNode(node, 'interpreted_string_literal');
            if (packagePath) imports.push(packagePath);
          }
          break;
      }
      
      for (const child of node.children) {
        traverse(child);
      }
    };
    
    traverse(node);
    return Array.from(new Set(imports)); // Remove duplicates
  }

  /**
   * Extract exports from AST
   */
  private extractExports(node: Parser.SyntaxNode, language: string, symbols: ParsedSymbol[]): string[] {
    const exports: string[] = [];
    
    // Mark symbols as exported and collect export names
    const traverse = (node: Parser.SyntaxNode) => {
      if (language === 'javascript' || language === 'typescript') {
        if (node.type === 'export_statement') {
          // Mark related symbols as exported
          this.markSymbolsAsExported(node, symbols);
          
          // Extract export names
          const exportName = this.extractExportName(node);
          if (exportName) exports.push(exportName);
        }
      }
      
      for (const child of node.children) {
        traverse(child);
      }
    };
    
    traverse(node);
    return exports;
  }

  /**
   * Mark symbols as exported based on export statements
   */
  private markSymbolsAsExported(exportNode: Parser.SyntaxNode, symbols: ParsedSymbol[]): void {
    // This is a simplified implementation - would need more sophisticated logic
    // to properly match exports to symbols
    for (const symbol of symbols) {
      if (exportNode.text.includes(symbol.name)) {
        symbol.isExported = true;
      }
    }
  }

  /**
   * Extract export name from export statement
   */
  private extractExportName(node: Parser.SyntaxNode): string | null {
    // Look for exported identifier
    for (const child of node.children) {
      if (child.type === 'identifier') {
        return child.text;
      }
    }
    return null;
  }

  /**
   * Extract string content from specific node types
   */
  private extractStringFromNode(node: Parser.SyntaxNode, targetType: string): string | null {
    for (const child of node.children) {
      if (child.type === targetType) {
        return child.text.replace(/['"]/g, ''); // Remove quotes
      }
    }
    return null;
  }

  /**
   * Extract module name from Python import statements
   */
  private extractModuleName(node: Parser.SyntaxNode): string | null {
    for (const child of node.children) {
      if (child.type === 'dotted_name' || child.type === 'identifier') {
        return child.text;
      }
    }
    return null;
  }

  /**
   * Fallback parsing for unsupported file types (minimal regex)
   */
  private fallbackParse(content: string, language: string): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: string[] = [];
    const exports: string[] = [];
    
    // Only basic parsing for truly unsupported files like .txt, .log, etc.
    if (language === 'unknown') {
      // Don't parse unknown files
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
      const content = await import('fs/promises').then(fs => fs.readFile(filePath, 'utf8'));
      const stats = await import('fs/promises').then(fs => fs.stat(filePath));
      
      // Generate content hash
      const hash = require('crypto').createHash('sha256').update(content).digest('hex');
      
      // Parse with Tree-sitter
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