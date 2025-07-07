import { promises as fs, constants } from 'fs';
import { join, relative, resolve, extname, dirname } from 'path';
import { stat, lstat, readdir } from 'fs/promises';

// Type definitions
export interface ListFilesOptions {
  ignorePatterns?: string[];
  includeHidden?: boolean;
  recursive?: boolean;
  maxDepth?: number;
}

export interface FindFilesOptions {
  directory?: string;
  ignorePatterns?: string[];
  includeContent?: boolean;
  caseSensitive?: boolean;
}

export interface ReplaceOptions {
  fuzzyMatch?: boolean;
  preserveIndentation?: boolean;
  createBackup?: boolean;
  dryRun?: boolean;
}

export interface FileInfo {
  path: string;
  name: string;
  size: number;
  type: 'file' | 'directory' | 'symlink';
  lastModified: Date;
  isHidden: boolean;
}

export interface ReplaceResult {
  success: boolean;
  replacements: number;
  files: string[];
  errors: string[];
}

// Default ignore patterns for common project types
const DEFAULT_IGNORE_PATTERNS = [
  '.git',
  '.git/**',
  'node_modules',
  'node_modules/**',
  '.DS_Store',
  'Thumbs.db',
  '*.tmp',
  '*.temp',
  '*.log',
  'dist',
  'dist/**',
  'build',
  'build/**',
  '.next',
  '.next/**',
  '.nuxt',
  '.nuxt/**',
  '.vscode',
  '.vscode/**',
  '.idea',
  '.idea/**',
  '*.pyc',
  '__pycache__',
  '__pycache__/**',
  '.pytest_cache',
  '.pytest_cache/**',
  'coverage',
  'coverage/**',
  '.nyc_output',
  '.nyc_output/**',
  '*.min.js',
  '*.min.css',
  '.env',
  '.env.local',
  '.env.*.local',
  '*.lock',
  'yarn-error.log',
  'npm-debug.log*',
  'lerna-debug.log*'
];

export class FileOperationsService {
  private readonly defaultIgnorePatterns: string[];

  constructor(customIgnorePatterns: string[] = []) {
    this.defaultIgnorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...customIgnorePatterns];
  }

  /**
   * List files and directories with smart ignore patterns
   */
  async listFiles(directory: string, options: ListFilesOptions = {}): Promise<FileInfo[]> {
    const {
      ignorePatterns = [],
      includeHidden = false,
      recursive = true,
      maxDepth = 50
    } = options;

    const allIgnorePatterns = [...this.defaultIgnorePatterns, ...ignorePatterns];
    const result: FileInfo[] = [];

    try {
      await this.scanDirectory(
        resolve(directory),
        resolve(directory),
        result,
        allIgnorePatterns,
        includeHidden,
        recursive,
        maxDepth,
        0
      );

      return result.sort((a, b) => {
        // Sort directories first, then files
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (error) {
      console.error(`Error listing files in ${directory}:`, error);
      throw new Error(`Failed to list files in ${directory}: ${error}`);
    }
  }

  /**
   * Find files matching glob-like patterns
   */
  async findFiles(pattern: string, options: FindFilesOptions = {}): Promise<string[]> {
    const {
      directory = process.cwd(),
      ignorePatterns = [],
      includeContent = false,
      caseSensitive = false
    } = options;

    try {
      const allFiles = await this.listFiles(directory, {
        ignorePatterns,
        includeHidden: false,
        recursive: true
      });

      const fileList = allFiles
        .filter(file => file.type === 'file')
        .map(file => file.path);

      const matchedFiles: string[] = [];

      for (const filePath of fileList) {
        const relativePath = relative(resolve(directory), filePath);
        
        if (this.matchesPattern(relativePath, pattern, caseSensitive)) {
          if (includeContent) {
            try {
              const content = await fs.readFile(filePath, 'utf-8');
              if (this.matchesPattern(content, pattern, caseSensitive)) {
                matchedFiles.push(filePath);
              }
            } catch (error) {
              // Skip files that can't be read as text
              continue;
            }
          } else {
            matchedFiles.push(filePath);
          }
        }
      }

      return matchedFiles;
    } catch (error) {
      console.error(`Error finding files with pattern ${pattern}:`, error);
      throw new Error(`Failed to find files with pattern ${pattern}: ${error}`);
    }
  }

  /**
   * Easy replace with fuzzy string replacement across files
   */
  async easyReplace(
    searchText: string,
    replaceText: string,
    options: ReplaceOptions = {}
  ): Promise<ReplaceResult> {
    const {
      fuzzyMatch = true,
      preserveIndentation = true,
      createBackup = false,
      dryRun = false
    } = options;

    const result: ReplaceResult = {
      success: true,
      replacements: 0,
      files: [],
      errors: []
    };

    try {
      // For now, we'll implement a simple version that requires specifying files
      // In a full implementation, this would scan the current directory
      const directory = process.cwd();
      const files = await this.findFiles('**/*.{ts,js,json,md,txt}', { directory });

      for (const filePath of files) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          let newContent = content;
          let replacementCount = 0;

          if (fuzzyMatch) {
            // Implement fuzzy matching - normalize whitespace
            const normalizedSearch = this.normalizeWhitespace(searchText);
            const lines = content.split('\n');
            const newLines: string[] = [];

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const normalizedLine = this.normalizeWhitespace(line);
              
              if (normalizedLine.includes(normalizedSearch)) {
                let replacement = replaceText;
                
                if (preserveIndentation) {
                  const indentation = this.extractIndentation(line);
                  replacement = this.applyIndentation(replaceText, indentation);
                }
                
                newLines.push(line.replace(searchText, replacement));
                replacementCount++;
              } else {
                newLines.push(line);
              }
            }
            
            newContent = newLines.join('\n');
          } else {
            // Simple exact replacement
            const regex = new RegExp(this.escapeRegExp(searchText), 'g');
            newContent = content.replace(regex, replaceText);
            replacementCount = (content.match(regex) || []).length;
          }

          if (replacementCount > 0) {
            if (createBackup && !dryRun) {
              await fs.copyFile(filePath, `${filePath}.backup`);
            }

            if (!dryRun) {
              await fs.writeFile(filePath, newContent, 'utf-8');
            }

            result.files.push(filePath);
            result.replacements += replacementCount;
          }
        } catch (error) {
          const errorMsg = `Error processing file ${filePath}: ${error}`;
          result.errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      if (result.errors.length > 0) {
        result.success = false;
      }

      return result;
    } catch (error) {
      console.error('Error in easyReplace:', error);
      return {
        success: false,
        replacements: 0,
        files: [],
        errors: [`Failed to perform replacement: ${error}`]
      };
    }
  }

  /**
   * Private helper methods
   */
  private async scanDirectory(
    currentPath: string,
    basePath: string,
    result: FileInfo[],
    ignorePatterns: string[],
    includeHidden: boolean,
    recursive: boolean,
    maxDepth: number,
    currentDepth: number
  ): Promise<void> {
    if (currentDepth >= maxDepth) {
      return;
    }

    const entries = await readdir(currentPath);

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const relativePath = relative(basePath, fullPath);

      // Check if entry should be ignored
      if (this.shouldIgnore(relativePath, entry, ignorePatterns, includeHidden)) {
        continue;
      }

      try {
        const stats = await lstat(fullPath);
        const fileInfo: FileInfo = {
          path: fullPath,
          name: entry,
          size: stats.size,
          type: stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : 'file',
          lastModified: stats.mtime,
          isHidden: entry.startsWith('.')
        };

        result.push(fileInfo);

        // Recursively scan subdirectories
        if (recursive && stats.isDirectory() && !stats.isSymbolicLink()) {
          await this.scanDirectory(
            fullPath,
            basePath,
            result,
            ignorePatterns,
            includeHidden,
            recursive,
            maxDepth,
            currentDepth + 1
          );
        }
      } catch (error) {
        // Skip entries that can't be accessed
        console.warn(`Unable to access ${fullPath}: ${error}`);
      }
    }
  }

  private shouldIgnore(
    relativePath: string,
    entryName: string,
    ignorePatterns: string[],
    includeHidden: boolean
  ): boolean {
    // Check hidden files
    if (!includeHidden && entryName.startsWith('.')) {
      return true;
    }

    // Check ignore patterns
    for (const pattern of ignorePatterns) {
      if (this.matchesIgnorePattern(relativePath, pattern) || 
          this.matchesIgnorePattern(entryName, pattern)) {
        return true;
      }
    }

    return false;
  }

  private matchesIgnorePattern(path: string, pattern: string): boolean {
    // Convert glob-like pattern to regex
    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedPattern = pattern.replace(/\\/g, '/');

    // Handle exact matches
    if (normalizedPattern === normalizedPath) {
      return true;
    }

    // Handle directory patterns (ending with /**)
    if (normalizedPattern.endsWith('/**')) {
      const basePattern = normalizedPattern.slice(0, -3);
      return normalizedPath.startsWith(basePattern + '/') || normalizedPath === basePattern;
    }

    // Handle wildcard patterns
    const regexPattern = normalizedPattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  }

  private matchesPattern(text: string, pattern: string, caseSensitive: boolean): boolean {
    const searchText = caseSensitive ? text : text.toLowerCase();
    const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();

    // Simple glob-like matching
    if (pattern.includes('*') || pattern.includes('?')) {
      const regexPattern = searchPattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(regexPattern);
      return regex.test(searchText);
    }

    return searchText.includes(searchPattern);
  }

  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private extractIndentation(line: string): string {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  private applyIndentation(text: string, indentation: string): string {
    return text.split('\n').map((line, index) => {
      if (index === 0) return line;
      return indentation + line;
    }).join('\n');
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Public utility methods
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    try {
      const stats = await stat(path);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const destDir = dirname(destination);
    await this.createDirectory(destDir);
    await fs.copyFile(source, destination);
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.unlink(filePath);
  }

  async deleteDirectory(dirPath: string): Promise<void> {
    await fs.rmdir(dirPath, { recursive: true });
  }

  getFileExtension(filePath: string): string {
    return extname(filePath);
  }

  getFileName(filePath: string): string {
    return filePath.split(/[/\\]/).pop() || '';
  }

  getDirectoryName(filePath: string): string {
    return dirname(filePath);
  }
}

// Export a default instance
export const fileOperationsService = new FileOperationsService();