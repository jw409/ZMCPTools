/**
 * MCP Tools for project analysis and file operations
 * Exposes analysis functionality through the MCP protocol for agent use
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import type { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { FileOperationsService, type ListFilesOptions, type FindFilesOptions, type ReplaceOptions } from '../services/FileOperationsService.js';
import { FoundationCacheService } from '../services/FoundationCacheService.js';
import { TreeSummaryService, type DirectoryNode } from '../services/TreeSummaryService.js';
import { AnalysisResponseSchema, createSuccessResponse, createErrorResponse, type AnalysisResponse, ProjectStructureInfoSchema, ProjectSummarySchema, FileSymbolsSchema, type ProjectStructureInfo, type ProjectSummary, type FileSymbols } from '../schemas/toolResponses.js';

// Import centralized request schemas
import {
  AnalyzeProjectStructureSchema,
  GenerateProjectSummarySchema,
  AnalyzeFileSymbolsSchema,
  ListFilesSchema,
  FindFilesSchema,
  EasyReplaceSchema,
  CleanupOrphanedProjectsSchema
} from '../schemas/toolRequests.js';

// Promisified fs operations for legacy compatibility
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

export class AnalysisMcpTools {
  private fileOpsService: FileOperationsService;
  private treeSummaryService: TreeSummaryService;

  constructor(
    private knowledgeGraphService: KnowledgeGraphService,
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
        inputSchema: AnalyzeProjectStructureSchema.shape,
        outputSchema: AnalysisResponseSchema.shape
      },
      {
        name: 'generate_project_summary',
        description: 'Generate AI-optimized project overview and analysis',
        inputSchema: GenerateProjectSummarySchema.shape,
        outputSchema: AnalysisResponseSchema.shape
      },
      {
        name: 'analyze_file_symbols',
        description: 'Extract and analyze symbols (functions, classes, etc.) from code files',
        inputSchema: AnalyzeFileSymbolsSchema.shape,
        outputSchema: AnalysisResponseSchema.shape
      },
      {
        name: 'list_files',
        description: 'List files in a directory with smart ignore patterns',
        inputSchema: ListFilesSchema.shape,
        outputSchema: AnalysisResponseSchema.shape
      },
      {
        name: 'find_files',
        description: 'Search for files by pattern with optional content matching',
        inputSchema: FindFilesSchema.shape,
        outputSchema: AnalysisResponseSchema.shape
      },
      {
        name: 'easy_replace',
        description: 'Fuzzy string replacement in files with smart matching',
        inputSchema: EasyReplaceSchema.shape,
        outputSchema: AnalysisResponseSchema.shape
      },
      {
        name: 'cleanup_orphaned_projects',
        description: 'Clean up orphaned or unused project directories',
        inputSchema: CleanupOrphanedProjectsSchema.shape,
        outputSchema: AnalysisResponseSchema.shape
      }
    ];
  }

  /**
   * Handle MCP tool calls for analysis functionality
   */
  async handleToolCall(name: string, args: any): Promise<AnalysisResponse> {
    const startTime = Date.now();
    
    try {
      let result: any;
      
      switch (name) {
        case 'analyze_project_structure':
          result = await this.analyzeProjectStructure(args);
          break;
        
        case 'generate_project_summary':
          result = await this.generateProjectSummary(args);
          break;
        
        case 'analyze_file_symbols':
          result = await this.analyzeFileSymbols(args);
          break;
        
        case 'list_files':
          result = await this.listFiles(args);
          break;
        
        case 'find_files':
          result = await this.findFiles(args);
          break;
        
        case 'easy_replace':
          result = await this.easyReplace(args);
          break;
        
        case 'cleanup_orphaned_projects':
          result = await this.cleanupOrphanedProjects(args);
          break;
        
        default:
          throw new Error(`Unknown analysis tool: ${name}`);
      }
      
      const executionTime = Date.now() - startTime;
      
      return createSuccessResponse(
        `Successfully executed ${name}`,
        result,
        executionTime
      ) as AnalysisResponse;
      
    } catch (error) {
      return createErrorResponse(
        `Failed to execute ${name}`,
        error instanceof Error ? error.message : 'Unknown error occurred',
        'ANALYSIS_ERROR'
      ) as AnalysisResponse;
    }
  }

  private async analyzeProjectStructure(args: any): Promise<any> {
    const params = AnalyzeProjectStructureSchema.parse(args);
    
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
          project_info: cachedStructure.structure,
          summary_generated: params.generate_summary,
          summary_path: params.generate_summary ? path.join(projectPath, '.treesummary', 'structure.txt') : null,
          cached: true
        };
      }
    }
    
    const combinedExcludePatterns = await this.getCombinedExcludePatterns(projectPath, params.exclude_patterns);
    const structure = await this.buildProjectStructure(projectPath, params.max_depth, combinedExcludePatterns);
    
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
      
      // Write tree summary inside the .treesummary directory structure
      const summaryPath = path.join(projectPath, '.treesummary', 'structure.txt');
      const summaryContent = this.generateTreeSummary(structure);
      await writeFile(summaryPath, summaryContent, 'utf8');
    }

    return {
      project_info: structure,
      summary_generated: params.generate_summary,
      summary_path: params.generate_summary ? path.join(projectPath, '.treesummary', 'structure.txt') : null,
      cached: false
    };
  }

  private async generateProjectSummary(args: any): Promise<any> {
    const params = GenerateProjectSummarySchema.parse(args);
    
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
          summary: cachedSummary,
          cached: true
        };
      }
    }
    
    const projectName = path.basename(projectPath);
    
    // Use TreeSummaryService for enhanced analysis
    const overview = await this.treeSummaryService.getProjectOverview(projectPath);
    
    // Build basic structure if not available from overview
    let structure: DirectoryNode | ProjectStructureInfo = overview.structure;
    if (!structure) {
      const defaultExcludePatterns = ['node_modules/**', '.git/**'];
      const combinedExcludePatterns = await this.getCombinedExcludePatterns(projectPath, defaultExcludePatterns);
      structure = await this.buildProjectStructure(projectPath, 5, combinedExcludePatterns);
    }
    
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
      summary,
      cached: false
    };
  }

  private async analyzeFileSymbols(args: any): Promise<any> {
    const params = AnalyzeFileSymbolsSchema.parse(args);
    
    const filePath = path.resolve(params.file_path);
    const content = await readFile(filePath, 'utf8');
    const symbols = this.extractSymbols(content, params.symbol_types);

    return {
      symbols: {
        file_path: filePath,
        symbols
      }
    };
  }

  private async listFiles(args: any): Promise<any> {
    const params = ListFilesSchema.parse(args);
    
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
      files,
      analysis_data: {
        fileInfos,
        count: files.length,
        directory: dirPath
      }
    };
  }

  private async findFiles(args: any): Promise<any> {
    const params = FindFilesSchema.parse(args);
    
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
      files: matches,
      analysis_data: {
        matches: results,
        count: results.length,
        pattern: params.pattern
      }
    };
  }

  private async easyReplace(args: any): Promise<any> {
    const params = EasyReplaceSchema.parse(args);
    
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
      replaced_count: replacementCount,
      analysis_data: {
        file_path: filePath,
        backup_created: params.backup
      }
    };
  }

  private async cleanupOrphanedProjects(args: any): Promise<any> {
    const params = CleanupOrphanedProjectsSchema.parse(args);
    
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
      cleanup_results: {
        orphaned_projects: orphanedProjects,
        count: orphanedProjects.length,
        dry_run: params.dry_run,
        threshold_date: threshold.toISOString()
      }
    };
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

  /**
   * Read and parse .claudeignore file from a directory
   */
  private async readClaudeIgnore(directory: string): Promise<string[]> {
    try {
      const claudeIgnorePath = path.join(directory, '.claudeignore');
      const content = await readFile(claudeIgnorePath, 'utf8');
      
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')) // Remove empty lines and comments
        .map(pattern => {
          // Convert .claudeignore patterns to glob patterns for AnalysisMcpTools
          if (pattern.endsWith('/')) {
            // Directory patterns
            return [pattern.slice(0, -1), pattern + '**'];
          } else if (pattern.includes('*')) {
            // Already a glob pattern
            return [pattern];
          } else {
            // File or directory patterns - add both exact and recursive versions
            return [pattern, pattern + '/**'];
          }
        })
        .flat();
    } catch (error) {
      // .claudeignore file doesn't exist or can't be read, return empty array
      return [];
    }
  }

  /**
   * Get combined exclude patterns including .claudeignore
   */
  private async getCombinedExcludePatterns(projectPath: string, excludePatterns: string[]): Promise<string[]> {
    const claudeIgnorePatterns = await this.readClaudeIgnore(projectPath);
    return [...excludePatterns, ...claudeIgnorePatterns];
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