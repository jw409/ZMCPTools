/**
 * MCP Tools for project analysis and file operations
 * Exposes analysis functionality through the MCP protocol for agent use
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import type { MemoryService } from '../services/MemoryService.js';
import { FileOperationsService, type ListFilesOptions, type FindFilesOptions, type ReplaceOptions } from '../services/FileOperationsService.js';
import { FoundationCacheService } from '../services/FoundationCacheService.js';
import { TreeSummaryService } from '../services/TreeSummaryService.js';

// Promisified fs operations for legacy compatibility
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

// Validation schemas
const AnalyzeProjectStructureSchema = z.object({
  project_path: z.string().default('.'),
  include_patterns: z.array(z.string()).default(['**/*']),
  exclude_patterns: z.array(z.string()).default(['node_modules/**', '.git/**', 'dist/**', 'build/**']),
  max_depth: z.number().default(10),
  generate_summary: z.boolean().default(true)
});

const GenerateProjectSummarySchema = z.object({
  project_path: z.string().default('.'),
  include_readme: z.boolean().default(true),
  include_package_info: z.boolean().default(true),
  include_git_info: z.boolean().default(true),
  output_path: z.string().optional()
});

const AnalyzeFileSymbolsSchema = z.object({
  file_path: z.string(),
  symbol_types: z.array(z.enum(['functions', 'classes', 'interfaces', 'types', 'variables', 'imports'])).default(['functions', 'classes'])
});

const ListFilesSchema = z.object({
  directory: z.string().default('.'),
  recursive: z.boolean().default(false),
  include_patterns: z.array(z.string()).default(['*']),
  exclude_patterns: z.array(z.string()).default([])
});

const FindFilesSchema = z.object({
  pattern: z.string(),
  directory: z.string().default('.'),
  case_sensitive: z.boolean().default(false),
  include_content: z.boolean().default(false)
});

const EasyReplaceSchema = z.object({
  file_path: z.string(),
  old_text: z.string(),
  new_text: z.string(),
  fuzzy_match: z.boolean().default(true),
  backup: z.boolean().default(true)
});

const CleanupOrphanedProjectsSchema = z.object({
  base_path: z.string().default(process.env.HOME || '.'),
  days_threshold: z.number().default(30),
  dry_run: z.boolean().default(true)
});

export interface ProjectStructureInfo {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
  children?: ProjectStructureInfo[];
  lastModified?: Date;
}

export interface ProjectSummary {
  name: string;
  path: string;
  description?: string;
  framework?: string;
  language?: string;
  dependencies?: Record<string, string>;
  structure: ProjectStructureInfo;
  gitInfo?: {
    branch?: string;
    lastCommit?: string;
    remotes?: string[];
  };
  stats: {
    totalFiles: number;
    totalDirectories: number;
    totalSize: number;
    fileTypes: Record<string, number>;
  };
}

export interface FileSymbols {
  file_path: string;
  symbols: {
    functions: Array<{ name: string; line: number; signature?: string }>;
    classes: Array<{ name: string; line: number; methods?: string[] }>;
    interfaces: Array<{ name: string; line: number; properties?: string[] }>;
    types: Array<{ name: string; line: number; definition?: string }>;
    variables: Array<{ name: string; line: number; type?: string }>;
    imports: Array<{ name: string; from: string; line: number }>;
  };
}

export class AnalysisMcpTools {
  private fileOpsService: FileOperationsService;
  private treeSummaryService: TreeSummaryService;

  constructor(
    private memoryService: MemoryService,
    private repositoryPath: string,
    private foundationCache?: FoundationCacheService
  ) {
    this.fileOpsService = new FileOperationsService();
    this.treeSummaryService = new TreeSummaryService(foundationCache);
  }

  /**
   * Get all analysis-related MCP tools
   */
  getTools(): Tool[] {
    return [
      {
        name: 'analyze_project_structure',
        description: 'Analyze project structure and generate a comprehensive overview',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              default: '.',
              description: 'Path to the project directory'
            },
            include_patterns: {
              type: 'array',
              items: { type: 'string' },
              default: ['**/*'],
              description: 'Glob patterns for files to include'
            },
            exclude_patterns: {
              type: 'array',
              items: { type: 'string' },
              default: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
              description: 'Glob patterns for files to exclude'
            },
            max_depth: {
              type: 'number',
              default: 10,
              description: 'Maximum directory depth to analyze'
            },
            generate_summary: {
              type: 'boolean',
              default: true,
              description: 'Generate a .treesummary file'
            }
          },
          required: []
        }
      },
      {
        name: 'generate_project_summary',
        description: 'Generate AI-optimized project overview and analysis',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: {
              type: 'string',
              default: '.',
              description: 'Path to the project directory'
            },
            include_readme: {
              type: 'boolean',
              default: true,
              description: 'Include README content in summary'
            },
            include_package_info: {
              type: 'boolean',
              default: true,
              description: 'Include package.json/requirements.txt info'
            },
            include_git_info: {
              type: 'boolean',
              default: true,
              description: 'Include Git repository information'
            },
            output_path: {
              type: 'string',
              description: 'Path to save the summary file'
            }
          },
          required: []
        }
      },
      {
        name: 'analyze_file_symbols',
        description: 'Extract and analyze symbols (functions, classes, etc.) from code files',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to analyze'
            },
            symbol_types: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['functions', 'classes', 'interfaces', 'types', 'variables', 'imports']
              },
              default: ['functions', 'classes'],
              description: 'Types of symbols to extract'
            }
          },
          required: ['file_path']
        }
      },
      {
        name: 'list_files',
        description: 'List files in a directory with smart ignore patterns',
        inputSchema: {
          type: 'object',
          properties: {
            directory: {
              type: 'string',
              default: '.',
              description: 'Directory to list files from'
            },
            recursive: {
              type: 'boolean',
              default: false,
              description: 'List files recursively'
            },
            include_patterns: {
              type: 'array',
              items: { type: 'string' },
              default: ['*'],
              description: 'Patterns for files to include'
            },
            exclude_patterns: {
              type: 'array',
              items: { type: 'string' },
              default: [],
              description: 'Patterns for files to exclude'
            }
          },
          required: []
        }
      },
      {
        name: 'find_files',
        description: 'Search for files by pattern with optional content matching',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Search pattern (supports glob patterns)'
            },
            directory: {
              type: 'string',
              default: '.',
              description: 'Directory to search in'
            },
            case_sensitive: {
              type: 'boolean',
              default: false,
              description: 'Case sensitive pattern matching'
            },
            include_content: {
              type: 'boolean',
              default: false,
              description: 'Include file content previews in results'
            }
          },
          required: ['pattern']
        }
      },
      {
        name: 'easy_replace',
        description: 'Fuzzy string replacement in files with smart matching',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to modify'
            },
            old_text: {
              type: 'string',
              description: 'Text to replace (supports fuzzy matching)'
            },
            new_text: {
              type: 'string',
              description: 'Replacement text'
            },
            fuzzy_match: {
              type: 'boolean',
              default: true,
              description: 'Enable fuzzy matching for old_text'
            },
            backup: {
              type: 'boolean',
              default: true,
              description: 'Create backup before replacing'
            }
          },
          required: ['file_path', 'old_text', 'new_text']
        }
      },
      {
        name: 'cleanup_orphaned_projects',
        description: 'Clean up orphaned or unused project directories',
        inputSchema: {
          type: 'object',
          properties: {
            base_path: {
              type: 'string',
              default: process.env.HOME || '.',
              description: 'Base directory to search for projects'
            },
            days_threshold: {
              type: 'number',
              default: 30,
              description: 'Consider projects older than this many days as orphaned'
            },
            dry_run: {
              type: 'boolean',
              default: true,
              description: 'Only report what would be cleaned up, don\'t actually delete'
            }
          },
          required: []
        }
      }
    ];
  }

  /**
   * Handle MCP tool calls for analysis functionality
   */
  async handleToolCall(name: string, arguments_: any): Promise<any> {
    try {
      switch (name) {
        case 'analyze_project_structure':
          return await this.analyzeProjectStructure(arguments_);
        
        case 'generate_project_summary':
          return await this.generateProjectSummary(arguments_);
        
        case 'analyze_file_symbols':
          return await this.analyzeFileSymbols(arguments_);
        
        case 'list_files':
          return await this.listFiles(arguments_);
        
        case 'find_files':
          return await this.findFiles(arguments_);
        
        case 'easy_replace':
          return await this.easyReplace(arguments_);
        
        case 'cleanup_orphaned_projects':
          return await this.cleanupOrphanedProjects(arguments_);
        
        default:
          throw new Error(`Unknown analysis tool: ${name}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private async analyzeProjectStructure(args: any): Promise<any> {
    const params = AnalyzeProjectStructureSchema.parse(args);
    
    try {
      const projectPath = path.resolve(params.project_path);
      
      // Try to get cached analysis first if foundation cache is available
      if (this.foundationCache) {
        const cacheKey = `structure_${projectPath}_${params.max_depth}_${JSON.stringify(params.exclude_patterns)}`;
        const cachedStructure = await this.foundationCache.getCachedAnalysis(
          projectPath,
          cacheKey,
          'project_structure'
        );
        
        if (cachedStructure) {
          return {
            success: true,
            structure: cachedStructure.structure,
            summary_generated: params.generate_summary,
            summary_path: params.generate_summary ? path.join(projectPath, '.treesummary') : null,
            cached: true
          };
        }
      }
      
      const structure = await this.buildProjectStructure(projectPath, params.max_depth, params.exclude_patterns);
      
      // Cache the result if foundation cache is available
      if (this.foundationCache) {
        const cacheKey = `structure_${projectPath}_${params.max_depth}_${JSON.stringify(params.exclude_patterns)}`;
        await this.foundationCache.cacheAnalysisResult(
          projectPath,
          cacheKey,
          'project_structure',
          { structure, params }
        );
      }
      
      if (params.generate_summary) {
        // Use TreeSummaryService for better integration
        await this.treeSummaryService.updateProjectMetadata(projectPath);
        
        const summaryPath = path.join(projectPath, '.treesummary');
        const summaryContent = this.generateTreeSummary(structure);
        await writeFile(summaryPath, summaryContent, 'utf8');
      }

      return {
        success: true,
        structure,
        summary_generated: params.generate_summary,
        summary_path: params.generate_summary ? path.join(projectPath, '.treesummary') : null,
        cached: false
      };
    } catch (error) {
      throw new Error(`Failed to analyze project structure: ${error}`);
    }
  }

  private async generateProjectSummary(args: any): Promise<ProjectSummary> {
    const params = GenerateProjectSummarySchema.parse(args);
    
    try {
      const projectPath = path.resolve(params.project_path);
      
      // Try to get cached summary first if foundation cache is available
      if (this.foundationCache) {
        const cacheKey = `summary_${projectPath}_${JSON.stringify(params)}`;
        const cachedSummary = await this.foundationCache.getCachedAnalysis(
          projectPath,
          cacheKey,
          'project_summary'
        );
        
        if (cachedSummary) {
          return {
            success: true,
            summary: cachedSummary,
            cached: true
          } as any;
        }
      }
      
      const projectName = path.basename(projectPath);
      
      // Use TreeSummaryService for enhanced analysis
      const overview = await this.treeSummaryService.getProjectOverview(projectPath);
      
      // Build basic structure if not available from overview
      const structure = overview.structure || await this.buildProjectStructure(projectPath, 5, ['node_modules/**', '.git/**']);
      
      // Calculate stats
      const stats = this.calculateProjectStats(structure);
      
      // Get package info
      let dependencies: Record<string, string> = {};
      let framework = 'Unknown';
      let language = 'Unknown';
      
      if (params.include_package_info) {
        const packageInfo = await this.getPackageInfo(projectPath);
        dependencies = packageInfo.dependencies;
        framework = packageInfo.framework;
        language = packageInfo.language;
      }

      // Get git info
      let gitInfo;
      if (params.include_git_info) {
        gitInfo = await this.getGitInfo(projectPath);
      }

      // Get description from README
      let description;
      if (params.include_readme) {
        description = await this.getReadmeDescription(projectPath);
      }

      const summary: ProjectSummary = {
        name: projectName,
        path: projectPath,
        description,
        framework,
        language,
        dependencies,
        structure,
        gitInfo,
        stats
      };
      
      // Cache the result if foundation cache is available
      if (this.foundationCache) {
        const cacheKey = `summary_${projectPath}_${JSON.stringify(params)}`;
        await this.foundationCache.cacheAnalysisResult(
          projectPath,
          cacheKey,
          'project_summary',
          summary
        );
      }

      // Save summary if output path provided
      if (params.output_path) {
        await writeFile(params.output_path, JSON.stringify(summary, null, 2), 'utf8');
      }

      return {
        success: true,
        summary,
        cached: false
      } as any;
    } catch (error) {
      throw new Error(`Failed to generate project summary: ${error}`);
    }
  }

  private async analyzeFileSymbols(args: any): Promise<FileSymbols> {
    const params = AnalyzeFileSymbolsSchema.parse(args);
    
    try {
      const filePath = path.resolve(params.file_path);
      const content = await readFile(filePath, 'utf8');
      const symbols = this.extractSymbols(content, params.symbol_types);

      return {
        success: true,
        symbols: {
          file_path: filePath,
          symbols
        }
      } as any;
    } catch (error) {
      throw new Error(`Failed to analyze file symbols: ${error}`);
    }
  }

  private async listFiles(args: any): Promise<any> {
    const params = ListFilesSchema.parse(args);
    
    try {
      const dirPath = path.resolve(params.directory);
      const options: ListFilesOptions = {
        recursive: params.recursive,
        ignorePatterns: params.exclude_patterns,
        includeHidden: false
      };

      const fileInfos = await this.fileOpsService.listFiles(dirPath, options);
      
      // Convert FileInfo[] to simple string paths for compatibility
      const files = fileInfos.map(info => info.path);

      return {
        success: true,
        files,
        fileInfos, // Include detailed info too
        count: files.length,
        directory: dirPath
      };
    } catch (error) {
      throw new Error(`Failed to list files: ${error}`);
    }
  }

  private async findFiles(args: any): Promise<any> {
    const params = FindFilesSchema.parse(args);
    
    try {
      const searchDir = path.resolve(params.directory);
      const options: FindFilesOptions = {
        directory: searchDir,
        caseSensitive: params.case_sensitive,
        includeContent: params.include_content
      };

      const matches = await this.fileOpsService.findFiles(params.pattern, options);
      
      const results = [];
      for (const filePath of matches) {
        const result: any = { path: filePath };
        
        if (params.include_content) {
          try {
            const content = await readFile(filePath, 'utf8');
            result.preview = content.substring(0, 500) + (content.length > 500 ? '...' : '');
          } catch {
            result.preview = '[Could not read file]';
          }
        }
        
        results.push(result);
      }

      return {
        success: true,
        matches: results,
        count: results.length,
        pattern: params.pattern
      };
    } catch (error) {
      throw new Error(`Failed to find files: ${error}`);
    }
  }

  private async easyReplace(args: any): Promise<any> {
    const params = EasyReplaceSchema.parse(args);
    
    try {
      // First copy the file to use in replacement options
      const filePath = path.resolve(params.file_path);
      
      // Use our new FileOperationsService for replacement
      const options: ReplaceOptions = {
        fuzzyMatch: params.fuzzy_match,
        preserveIndentation: true,
        createBackup: params.backup,
        dryRun: false
      };

      // For single file replacement, we need to implement this differently
      // since easyReplace in the service works across multiple files
      const content = await readFile(filePath, 'utf8');
      
      // Create backup if requested
      if (params.backup) {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        await writeFile(backupPath, content, 'utf8');
      }

      let newContent: string;
      if (params.fuzzy_match) {
        // Use the fuzzy replace logic
        newContent = this.fuzzyReplace(content, params.old_text, params.new_text);
      } else {
        // Exact replacement
        newContent = content.replace(new RegExp(this.escapeRegExp(params.old_text), 'g'), params.new_text);
      }

      const replacementCount = (content.match(new RegExp(this.escapeRegExp(params.old_text), 'g')) || []).length;
      
      if (replacementCount > 0) {
        await writeFile(filePath, newContent, 'utf8');
      }

      return {
        success: true,
        file_path: filePath,
        replacements_made: replacementCount,
        backup_created: params.backup
      };
    } catch (error) {
      throw new Error(`Failed to perform easy replace: ${error}`);
    }
  }

  private async cleanupOrphanedProjects(args: any): Promise<any> {
    const params = CleanupOrphanedProjectsSchema.parse(args);
    
    try {
      const basePath = path.resolve(params.base_path);
      const threshold = new Date(Date.now() - params.days_threshold * 24 * 60 * 60 * 1000);
      
      const orphanedProjects = await this.findOrphanedProjects(basePath, threshold);
      
      if (!params.dry_run) {
        // Actually delete the projects (implement carefully)
        for (const project of orphanedProjects) {
          // This would need proper implementation with recursive deletion
          console.warn('Actual deletion not implemented for safety');
        }
      }

      return {
        success: true,
        orphaned_projects: orphanedProjects,
        count: orphanedProjects.length,
        dry_run: params.dry_run,
        threshold_date: threshold.toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to cleanup orphaned projects: ${error}`);
    }
  }

  // Helper methods
  private async buildProjectStructure(dirPath: string, maxDepth: number, excludePatterns: string[], currentDepth = 0): Promise<ProjectStructureInfo> {
    if (currentDepth >= maxDepth) {
      return {
        path: dirPath,
        name: path.basename(dirPath),
        type: 'directory',
        children: []
      };
    }

    try {
      const stats = await stat(dirPath);
      const isDirectory = stats.isDirectory();

      if (!isDirectory) {
        return {
          path: dirPath,
          name: path.basename(dirPath),
          type: 'file',
          size: stats.size,
          extension: path.extname(dirPath),
          lastModified: stats.mtime
        };
      }

      const entries = await readdir(dirPath);
      const children: ProjectStructureInfo[] = [];

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        
        // Check if should be excluded
        if (this.shouldExclude(entryPath, excludePatterns)) {
          continue;
        }

        const child = await this.buildProjectStructure(entryPath, maxDepth, excludePatterns, currentDepth + 1);
        children.push(child);
      }

      return {
        path: dirPath,
        name: path.basename(dirPath),
        type: 'directory',
        children,
        lastModified: stats.mtime
      };
    } catch (error) {
      return {
        path: dirPath,
        name: path.basename(dirPath),
        type: 'directory',
        children: []
      };
    }
  }

  private shouldExclude(filePath: string, excludePatterns: string[]): boolean {
    const relativePath = path.relative(process.cwd(), filePath);
    return excludePatterns.some(pattern => {
      // Simple glob-like matching
      const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      return regex.test(relativePath);
    });
  }

  private generateTreeSummary(structure: ProjectStructureInfo): string {
    const lines: string[] = [];
    
    const traverse = (node: ProjectStructureInfo, indent = 0) => {
      const prefix = '  '.repeat(indent);
      const icon = node.type === 'directory' ? '📁' : '📄';
      lines.push(`${prefix}${icon} ${node.name}`);
      
      if (node.children) {
        for (const child of node.children) {
          traverse(child, indent + 1);
        }
      }
    };

    traverse(structure);
    return lines.join('\n');
  }

  private calculateProjectStats(structure: ProjectStructureInfo): { totalFiles: number; totalDirectories: number; totalSize: number; fileTypes: Record<string, number> } {
    let totalFiles = 0;
    let totalDirectories = 0;
    let totalSize = 0;
    const fileTypes: Record<string, number> = {};

    const traverse = (node: ProjectStructureInfo) => {
      if (node.type === 'file') {
        totalFiles++;
        totalSize += node.size || 0;
        const ext = node.extension || 'no-extension';
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
      } else {
        totalDirectories++;
        if (node.children) {
          for (const child of node.children) {
            traverse(child);
          }
        }
      }
    };

    traverse(structure);
    return { totalFiles, totalDirectories, totalSize, fileTypes };
  }

  private async getPackageInfo(projectPath: string): Promise<{ dependencies: Record<string, string>; framework: string; language: string }> {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const requirementsTxtPath = path.join(projectPath, 'requirements.txt');
    
    try {
      if (await this.fileExists(packageJsonPath)) {
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
        return {
          dependencies: { ...packageJson.dependencies, ...packageJson.devDependencies },
          framework: this.detectFramework(packageJson),
          language: 'JavaScript/TypeScript'
        };
      } else if (await this.fileExists(requirementsTxtPath)) {
        const requirements = await readFile(requirementsTxtPath, 'utf8');
        const dependencies: Record<string, string> = {};
        requirements.split('\n').forEach(line => {
          const [pkg, version] = line.trim().split('==');
          if (pkg) dependencies[pkg] = version || 'latest';
        });
        return {
          dependencies,
          framework: 'Python',
          language: 'Python'
        };
      }
    } catch (error) {
      // Ignore errors
    }

    return { dependencies: {}, framework: 'Unknown', language: 'Unknown' };
  }

  private detectFramework(packageJson: any): string {
    if (packageJson.dependencies?.react) return 'React';
    if (packageJson.dependencies?.vue) return 'Vue';
    if (packageJson.dependencies?.angular) return 'Angular';
    if (packageJson.dependencies?.svelte) return 'Svelte';
    if (packageJson.dependencies?.express) return 'Express';
    if (packageJson.dependencies?.next) return 'Next.js';
    return 'Node.js';
  }

  private async getGitInfo(projectPath: string): Promise<{ branch?: string; lastCommit?: string; remotes?: string[] } | undefined> {
    // Simple git info extraction - would need proper git library for production
    try {
      const gitPath = path.join(projectPath, '.git');
      if (await this.fileExists(gitPath)) {
        return {
          branch: 'main', // Placeholder
          lastCommit: 'abc123', // Placeholder
          remotes: ['origin'] // Placeholder
        };
      }
    } catch (error) {
      // Ignore errors
    }
    return undefined;
  }

  private async getReadmeDescription(projectPath: string): Promise<string | undefined> {
    const readmePaths = ['README.md', 'README.txt', 'readme.md', 'readme.txt'];
    
    for (const readmePath of readmePaths) {
      try {
        const fullPath = path.join(projectPath, readmePath);
        if (await this.fileExists(fullPath)) {
          const content = await readFile(fullPath, 'utf8');
          // Extract first paragraph or line as description
          const lines = content.split('\n').filter(line => line.trim());
          return lines[0]?.replace(/^#\s*/, '') || undefined;
        }
      } catch (error) {
        // Continue to next file
      }
    }
    return undefined;
  }

  private extractSymbols(content: string, symbolTypes: string[]): any {
    const symbols: any = {
      functions: [],
      classes: [],
      interfaces: [],
      types: [],
      variables: [],
      imports: []
    };

    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      
      if (symbolTypes.includes('functions')) {
        const functionMatch = line.match(/(?:function|const|let|var)\s+(\w+)\s*[=\(]/);
        if (functionMatch) {
          symbols.functions.push({
            name: functionMatch[1],
            line: lineNumber,
            signature: line.trim()
          });
        }
      }

      if (symbolTypes.includes('classes')) {
        const classMatch = line.match(/class\s+(\w+)/);
        if (classMatch) {
          symbols.classes.push({
            name: classMatch[1],
            line: lineNumber
          });
        }
      }

      if (symbolTypes.includes('interfaces')) {
        const interfaceMatch = line.match(/interface\s+(\w+)/);
        if (interfaceMatch) {
          symbols.interfaces.push({
            name: interfaceMatch[1],
            line: lineNumber
          });
        }
      }

      if (symbolTypes.includes('imports')) {
        const importMatch = line.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
          symbols.imports.push({
            name: line.trim(),
            from: importMatch[1],
            line: lineNumber
          });
        }
      }
    });

    return symbols;
  }

  private async getFiles(dirPath: string, recursive: boolean, includePatterns: string[], excludePatterns: string[]): Promise<string[]> {
    const files: string[] = [];
    
    const processDirectory = async (currentPath: string) => {
      try {
        const entries = await readdir(currentPath);
        
        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry);
          const stats = await stat(entryPath);
          
          if (stats.isDirectory() && recursive) {
            if (!this.shouldExclude(entryPath, excludePatterns)) {
              await processDirectory(entryPath);
            }
          } else if (stats.isFile()) {
            if (!this.shouldExclude(entryPath, excludePatterns)) {
              files.push(entryPath);
            }
          }
        }
      } catch (error) {
        // Ignore permission errors
      }
    };

    await processDirectory(dirPath);
    return files;
  }

  private async searchFiles(dirPath: string, pattern: string, caseSensitive: boolean): Promise<string[]> {
    const files = await this.getFiles(dirPath, true, ['*'], []);
    const regex = new RegExp(pattern.replace(/\*/g, '.*'), caseSensitive ? 'g' : 'gi');
    
    return files.filter(file => regex.test(path.basename(file)));
  }

  private fuzzyReplace(content: string, oldText: string, newText: string): string {
    // Simple fuzzy replacement - normalize whitespace
    const normalizedOld = oldText.replace(/\s+/g, ' ').trim();
    const normalizedContent = content.replace(/\s+/g, ' ');
    
    if (normalizedContent.includes(normalizedOld)) {
      return content.replace(new RegExp(this.escapeRegExp(oldText), 'g'), newText);
    }
    
    // If exact match fails, try line-by-line fuzzy matching
    const lines = content.split('\n');
    const oldLines = oldText.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      if (this.linesMatch(lines.slice(i, i + oldLines.length), oldLines)) {
        lines.splice(i, oldLines.length, ...newText.split('\n'));
        break;
      }
    }
    
    return lines.join('\n');
  }

  private linesMatch(contentLines: string[], oldLines: string[]): boolean {
    if (contentLines.length !== oldLines.length) return false;
    
    return contentLines.every((line, index) => {
      const normalizedContent = line.trim().replace(/\s+/g, ' ');
      const normalizedOld = oldLines[index].trim().replace(/\s+/g, ' ');
      return normalizedContent === normalizedOld;
    });
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async findOrphanedProjects(basePath: string, threshold: Date): Promise<string[]> {
    const orphaned: string[] = [];
    
    try {
      const entries = await readdir(basePath);
      
      for (const entry of entries) {
        const entryPath = path.join(basePath, entry);
        const stats = await stat(entryPath);
        
        if (stats.isDirectory() && stats.mtime < threshold) {
          // Check if it looks like a project directory
          const hasPackageJson = await this.fileExists(path.join(entryPath, 'package.json'));
          const hasGit = await this.fileExists(path.join(entryPath, '.git'));
          
          if (hasPackageJson || hasGit) {
            orphaned.push(entryPath);
          }
        }
      }
    } catch (error) {
      // Ignore permission errors
    }
    
    return orphaned;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}